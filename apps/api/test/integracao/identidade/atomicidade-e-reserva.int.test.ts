// Reserva da tentativa, portas atômicas de conta e travas dos casos de uso da Identidade
// (01b, grupo C, rodada 2; CA-04, CA-05, CA-06, CA-09, CA-10, CA-11; S91, S94, S95, S97, S99,
// Q23-api, Q24-api, A-R7, A-R8) contra o Postgres de teste, com os repositórios Prisma e a
// cripto reais. Duas pilhas = dois pools = duas requisições; a primeira para num ponto escolhido
// DENTRO da transação (ou, no login, no Argon2 fora dela) e o teste só a libera depois de a
// segunda ter terminado ou estar esperando uma trava.
//
// O que se confere: o estado final no banco (nada gravado pela metade quando a conta sai de
// `ativa` no meio), a resposta de cada requisição e a ausência de erro 5xx (deadlock, P2025).
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chaveDoFreioPorEmail } from '../../../src/modulos/identidade/aplicacao/comum/chaves.ts';
import { chaveDoFreioPorOrigem } from '../../../src/modulos/identidade/aplicacao/sessao/comum.ts';
import { Email } from '../../../src/modulos/identidade/dominio/email.ts';
import {
  apagarContasDoTeste,
  cadastrar,
  conectarDono,
  type ContaDeTeste,
  type DocumentosDeTeste,
  esperarAlguemNaTrava,
  eventosDaConta,
  inserirCodigo,
  montarPilha,
  OUTRA_SENHA,
  pausarAntes,
  pausarDepois,
  type Pilha,
  prepararAdmin,
  semearDocumentos,
  sessoesDaConta,
  sessoesVivas,
  T0,
  totpDe,
  UM_DIA,
  UM_MINUTO,
} from './pilha-de-casos-de-uso.ts';

const a = montarPilha();
const b = montarPilha();
let dono: pg.Client;
let docs: DocumentosDeTeste;
const contasDoTeste: string[] = [];
const freiosDoTeste: string[] = [];

beforeAll(async () => {
  dono = await conectarDono();
  docs = await semearDocumentos(dono);
});

afterAll(async () => {
  await apagarContasDoTeste(dono, contasDoTeste, freiosDoTeste);
  await dono
    .query(
      "DELETE FROM compartilhado.auditoria WHERE acao = 'segundo_fator_reconfigurado' AND recurso_id = ANY($1::text[])",
      [contasDoTeste],
    )
    .catch(() => undefined);
  await docs.remover();
  await dono.end();
  await Promise.all([a.prisma.$disconnect(), b.prisma.$disconnect()]);
});

beforeEach(() => {
  a.relogio.definir(T0);
  b.relogio.definir(T0);
});

/** Avança o relógio das duas pilhas (as duas requisições veem a mesma hora). */
function avancar(ms: number): void {
  a.relogio.avancar(ms);
  b.relogio.avancar(ms);
}

let proximoIp = 20;
/** IP de documentação único por chamada, com o freio de origem dele já marcado para limpeza. */
function ipNovo(): string {
  proximoIp += 1;
  const ip = `192.0.2.${proximoIp % 250}`;
  freiosDoTeste.push(chaveDoFreioPorOrigem(a.servicos.cifrador, ip));
  return ip;
}

function chaveDoEmail(email: string): string {
  return chaveDoFreioPorEmail(a.servicos.cifrador, Email.criar(email));
}

async function novaConta(): Promise<ContaDeTeste> {
  const conta = await cadastrar(a, docs);
  contasDoTeste.push(conta.id);
  freiosDoTeste.push(chaveDoEmail(conta.email));
  return conta;
}

/** Conta com o perfil `admin` (como a CLI de promoção faria), sem segundo fator. */
async function novoAdminSemSegundoFator(): Promise<ContaDeTeste> {
  const conta = await novaConta();
  const carregada = await a.repos.contas.buscarPorId(conta.id);
  if (carregada === null) throw new Error('conta sumiu');
  carregada.concederAdmin(a.relogio.agora());
  await a.repos.contas.atualizar(carregada);
  freiosDoTeste.push(a.servicos.cifrador.hmac('bloqueio_segundo_fator', [conta.id]));
  return conta;
}

/** Admin com o segundo fator confirmado e uma sessão do painel viva. */
async function novoAdmin() {
  const admin = await prepararAdmin(a, docs, ipNovo());
  contasDoTeste.push(admin.conta.id);
  freiosDoTeste.push(
    chaveDoEmail(admin.conta.email),
    a.servicos.cifrador.hmac('bloqueio_segundo_fator', [admin.conta.id]),
  );
  return admin;
}

function entrarNoApp(pilha: Pilha, conta: ContaDeTeste, senha = conta.senha, ip = ipNovo()) {
  return pilha.casos.entrar.executar({ email: conta.email, senha, cliente: 'app_consumidor', ip });
}

function entrarNoPainel(pilha: Pilha, conta: ContaDeTeste, senha = conta.senha) {
  return pilha.casos.entrar.executar({
    email: conta.email,
    senha,
    cliente: 'painel',
    ip: ipNovo(),
  });
}

async function loginNoApp(pilha: Pilha, conta: ContaDeTeste) {
  const r = await entrarNoApp(pilha, conta);
  if (r.tipo !== 'sessao') throw new Error(`login de teste devolveu ${r.tipo}`);
  const claims = await pilha.servicos.emissor.verificar(
    r.sessao.tokenAcesso,
    pilha.relogio.agora(),
  );
  if (claims === null) throw new Error('token de acesso de teste não verifica');
  return { ...r.sessao, sid: claims.sid };
}

async function lerConta(contaId: string) {
  const { rows } = await dono.query<{
    status: string;
    senha_hash: string | null;
    email_verificado_em: Date | null;
    ultimo_login_em: Date | null;
    desativada_em: Date | null;
  }>(
    'SELECT status::text, senha_hash, email_verificado_em, ultimo_login_em, desativada_em FROM identidade.contas WHERE id = $1::uuid',
    [contaId],
  );
  const linha = rows[0];
  if (linha === undefined) throw new Error('conta sumiu');
  return linha;
}

async function lerFreio(chave: string, tipo: 'email' | 'ip' | 'segundo_fator' = 'email') {
  const { rows } = await dono.query<{
    falhas: number;
    nivel: number;
    bloqueado_ate: Date | null;
  }>(
    'SELECT falhas, nivel, bloqueado_ate FROM identidade.bloqueios_login WHERE chave_hmac = $1 AND tipo = $2::identidade.tipo_de_bloqueio',
    [chave, tipo],
  );
  return rows[0] ?? null;
}

/** O que o dono do banco faz por fora de qualquer caso de uso: tira a conta de `ativa`. */
async function desativarComoDono(contaId: string): Promise<void> {
  await dono.query(
    "UPDATE identidade.contas SET status = 'desativada', desativada_em = $2 WHERE id = $1::uuid",
    [contaId, T0],
  );
}

async function tiposDeEvento(contaId: string): Promise<string[]> {
  return (await eventosDaConta(dono, contaId)).map((e) => e.tipo);
}

/** Os desafios do 2FA da conta (mesma tabela dos códigos de e-mail), pelo que importa. */
async function desafiosDaConta(contaId: string) {
  const { rows } = await dono.query<{
    finalidade: string;
    tentativas: number;
    usado_em: Date | null;
  }>(
    `SELECT finalidade::text, tentativas, usado_em FROM identidade.codigos_verificacao
      WHERE conta_id = $1::uuid AND finalidade IN ('desafio_configurar', 'desafio_verificar')
      ORDER BY criado_em, id`,
    [contaId],
  );
  return rows;
}

/**
 * Segura o Argon2 de `verificar` da pilha: a próxima chamada avisa que chegou e espera
 * `liberar()`. Como o login e a exclusão conferem a senha FORA da transação (S91), é entre o
 * `chegou` e o `liberar` que outra requisição muda a conta.
 */
function segurarOHashDe(pilha: Pilha) {
  const { hasher } = pilha.servicos;
  const original = hasher.verificar.bind(hasher);
  let avisar: () => void = () => undefined;
  let soltar: () => void = () => undefined;
  const chegou = new Promise<void>((resolver) => {
    avisar = resolver;
  });
  const solta = new Promise<void>((resolver) => {
    soltar = resolver;
  });
  hasher.verificar = async (senha, hash) => {
    hasher.verificar = original;
    avisar();
    await solta;
    return original(senha, hash);
  };
  return { chegou, liberar: soltar };
}

// ---------------------------------------------------------------------------

describe('reserva da tentativa: o limiar do freio continua exato (CA-04, S91)', () => {
  it('quatro falhas e a senha certa na quinta tentativa entram e zeram a contagem; cinco falhas seguidas freiam, até com a senha certa', async () => {
    const conta = await novaConta();
    const chave = chaveDoEmail(conta.email);
    const errar = async (vezes: number) => {
      for (let i = 0; i < vezes; i++) {
        expect(await entrarNoApp(a, conta, OUTRA_SENHA)).toEqual({ tipo: 'credenciais_invalidas' });
      }
    };

    await errar(4);
    expect(await lerFreio(chave)).toMatchObject({ falhas: 4, nivel: 0, bloqueado_ate: null });
    // A quinta tentativa é a certa: a reserva soma a quinta falha, o sucesso desfaz tudo.
    expect((await entrarNoApp(a, conta)).tipo).toBe('sessao');
    expect(await lerFreio(chave)).toBeNull();

    // Contagem do zero: quatro erros de novo e a certa ainda entra.
    await errar(4);
    expect((await entrarNoApp(a, conta)).tipo).toBe('sessao');

    await errar(5);
    expect(await lerFreio(chave)).toMatchObject({ nivel: 1 });
    expect(await entrarNoApp(a, conta)).toEqual({ tipo: 'freado', segundosDeEspera: 60 });
    avancar(UM_MINUTO);
    expect((await entrarNoApp(a, conta)).tipo).toBe('sessao');
  });

  it('a senha certa devolve a falha reservada ao freio da origem; os erros dos outros continuam contando', async () => {
    const conta = await novaConta();
    const ip = ipNovo();
    const chaveDaOrigem = chaveDoFreioPorOrigem(a.servicos.cifrador, ip);
    for (let i = 0; i < 3; i++) {
      await a.casos.entrar.executar({
        email: `ninguem.${i}.${conta.id.slice(0, 8)}@exemplo.com.br`,
        senha: OUTRA_SENHA,
        cliente: 'app_consumidor',
        ip,
      });
      freiosDoTeste.push(chaveDoEmail(`ninguem.${i}.${conta.id.slice(0, 8)}@exemplo.com.br`));
    }
    expect((await lerFreio(chaveDaOrigem, 'ip'))?.falhas).toBe(3);

    expect((await entrarNoApp(a, conta, conta.senha, ip)).tipo).toBe('sessao');
    expect((await lerFreio(chaveDaOrigem, 'ip'))?.falhas).toBe(3);
  });

  it('49 falhas da origem e um login certo: o login entra, mas a reserva foi a 50ª falha e a espera de 1 min da origem fica (falha fechada, decisão documentada)', async () => {
    const conta = await novaConta();
    const ip = ipNovo();
    const chaveDaOrigem = chaveDoFreioPorOrigem(a.servicos.cifrador, ip);
    const emails = Array.from(
      { length: 49 },
      (_, i) => `rajada.${i}.${conta.id.slice(0, 8)}@exemplo.com.br`,
    );
    for (const email of emails) freiosDoTeste.push(chaveDoEmail(email));
    await Promise.all(
      emails.map((email) =>
        a.casos.entrar.executar({ email, senha: OUTRA_SENHA, cliente: 'app_consumidor', ip }),
      ),
    );
    expect((await lerFreio(chaveDaOrigem, 'ip'))?.falhas).toBe(49);

    expect((await entrarNoApp(a, conta, conta.senha, ip)).tipo).toBe('sessao');
    expect(await lerFreio(chaveDaOrigem, 'ip')).toMatchObject({
      falhas: 0,
      nivel: 1,
      bloqueado_ate: new Date(T0.getTime() + UM_MINUTO),
    });
    // O e-mail da conta, esse sim, zerou com a senha certa.
    expect(await lerFreio(chaveDoEmail(conta.email))).toBeNull();
    expect(await entrarNoApp(a, conta, conta.senha, ip)).toEqual({
      tipo: 'freado',
      segundosDeEspera: 60,
    });
  });
});

describe('senha trocada durante a conferência (S91)', () => {
  it('login: a redefinição confirma enquanto o Argon2 confere a senha antiga; o login recusa e a senha nova entra', async () => {
    const conta = await novaConta();
    await inserirCodigo(a, conta.id, 'recuperacao_senha', '135790');
    const ip = ipNovo();
    const gate = segurarOHashDe(a);
    const login = a.casos.entrar.executar({
      email: conta.email,
      senha: conta.senha,
      cliente: 'app_consumidor',
      ip,
    });
    await gate.chegou;
    expect(
      await b.casos.redefinirSenha.executar({
        email: conta.email,
        codigo: '135790',
        novaSenha: OUTRA_SENHA,
      }),
    ).toEqual({ tipo: 'redefinida' });
    gate.liberar();

    expect(await login).toEqual({ tipo: 'credenciais_invalidas' });
    expect(await sessoesDaConta(dono, conta.id)).toEqual([]);
    expect((await lerConta(conta.id)).ultimo_login_em).toBeNull();
    // A falha reservada fica na origem: a senha conferida era a de antes.
    expect((await lerFreio(chaveDoFreioPorOrigem(a.servicos.cifrador, ip), 'ip'))?.falhas).toBe(1);
    expect((await entrarNoApp(a, conta, OUTRA_SENHA)).tipo).toBe('sessao');
  });

  it('exclusão: a redefinição confirma enquanto o Argon2 confere a senha antiga; a exclusão recusa com senha_incorreta e a conta segue ativa', async () => {
    const conta = await novaConta();
    await inserirCodigo(a, conta.id, 'recuperacao_senha', '246802');
    const gate = segurarOHashDe(a);
    const exclusao = a.casos.solicitarExclusao.executar({ contaId: conta.id, senha: conta.senha });
    await gate.chegou;
    expect(
      await b.casos.redefinirSenha.executar({
        email: conta.email,
        codigo: '246802',
        novaSenha: OUTRA_SENHA,
      }),
    ).toEqual({ tipo: 'redefinida' });
    gate.liberar();

    expect(await exclusao).toEqual({ tipo: 'senha_incorreta' });
    expect((await lerConta(conta.id)).status).toBe('ativa');
    expect(await tiposDeEvento(conta.id)).not.toContain('identidade.ContaDesativada');
    const { rows } = await dono.query(
      'SELECT 1 FROM identidade.solicitacoes_titular WHERE conta_id = $1::uuid',
      [conta.id],
    );
    expect(rows).toEqual([]);
    expect(
      await a.casos.solicitarExclusao.executar({ contaId: conta.id, senha: OUTRA_SENHA }),
    ).toEqual({ tipo: 'desativada' });
  });
});

describe('a conta sai de ativa no meio: a porta devolve false e a transação desfaz tudo (S95)', () => {
  it('redefinição: o código não é gasto, o freio não zera, a senha e os desafios ficam, e nada é publicado', async () => {
    const admin = await novoAdminSemSegundoFator();
    // O desafio de configurar nasce no login (que zera o freio); depois, dois códigos errados
    // deixam o freio com 2 falhas e o código com 2 tentativas.
    const login = await entrarNoPainel(a, admin);
    if (login.tipo !== 'desafio') throw new Error(`login do admin devolveu ${login.tipo}`);
    await inserirCodigo(a, admin.id, 'recuperacao_senha', '112233');
    for (let i = 0; i < 2; i++) {
      expect(
        await a.casos.redefinirSenha.executar({
          email: admin.email,
          codigo: '000000',
          novaSenha: OUTRA_SENHA,
        }),
      ).toEqual({ tipo: 'codigo_invalido' });
    }
    const antes = await lerConta(admin.id);

    const pausa = pausarAntes(a.repos.contas, 'gravarSenhaRedefinida');
    const redefinicao = a.casos.redefinirSenha.executar({
      email: admin.email,
      codigo: '112233',
      novaSenha: OUTRA_SENHA,
    });
    await pausa.chegou;
    await desativarComoDono(admin.id);
    pausa.liberar();

    expect(await redefinicao).toEqual({ tipo: 'codigo_invalido' });
    const { rows } = await dono.query<{ usado_em: Date | null; tentativas: number }>(
      "SELECT usado_em, tentativas FROM identidade.codigos_verificacao WHERE conta_id = $1::uuid AND finalidade = 'recuperacao_senha'",
      [admin.id],
    );
    expect(rows).toEqual([{ usado_em: null, tentativas: 2 }]);
    expect(await lerFreio(chaveDoEmail(admin.email))).toMatchObject({ falhas: 2 });
    const depois = await lerConta(admin.id);
    expect(depois.senha_hash).toBe(antes.senha_hash);
    expect(depois.email_verificado_em).toBeNull();
    expect(await tiposDeEvento(admin.id)).not.toContain('identidade.SenhaRedefinida');
    // O desafio emitido no login segue vivo: a invalidação (S94) também foi desfeita.
    expect(await desafiosDaConta(admin.id)).toEqual([
      { finalidade: 'desafio_configurar', tentativas: 0, usado_em: null },
    ]);
  });

  it('exclusão: a solicitação não é gravada, o evento não sai e o freio não zera', async () => {
    const conta = await novaConta();
    await loginNoApp(a, conta);
    for (let i = 0; i < 2; i++) {
      expect(
        await a.casos.solicitarExclusao.executar({ contaId: conta.id, senha: OUTRA_SENHA }),
      ).toEqual({ tipo: 'senha_incorreta' });
    }

    const pausa = pausarAntes(a.repos.contas, 'gravarDesativacao');
    const exclusao = a.casos.solicitarExclusao.executar({ contaId: conta.id, senha: conta.senha });
    await pausa.chegou;
    await desativarComoDono(conta.id);
    pausa.liberar();

    expect(await exclusao).toEqual({ tipo: 'conta_indisponivel' });
    const { rows } = await dono.query(
      'SELECT 1 FROM identidade.solicitacoes_titular WHERE conta_id = $1::uuid',
      [conta.id],
    );
    expect(rows).toEqual([]);
    expect(await tiposDeEvento(conta.id)).not.toContain('identidade.ContaDesativada');
    // A reserva (transação anterior) ficou, e o zeramento da senha certa foi desfeito.
    expect(await lerFreio(chaveDoEmail(conta.email))).toMatchObject({ falhas: 3 });
    // As sessões da conta não foram tocadas pela exclusão desfeita.
    expect(await sessoesVivas(dono, conta.id)).toBe(1);
  });

  it('reconfiguração do 2FA: o segundo fator, os códigos, as sessões e os desafios ficam, e nem evento nem auditoria saem', async () => {
    const admin = await novoAdmin();
    const operador = await novoAdminSemSegundoFator();
    avancar(60_000);
    const login = await entrarNoPainel(a, admin.conta);
    if (login.tipo !== 'desafio') throw new Error(`login do admin devolveu ${login.tipo}`);
    expect(login.desafio.etapa).toBe('verificar');

    const pausa = pausarAntes(a.repos.contas, 'gravarSenhaRemovida');
    const reconfiguracao = a.casos.reconfigurarSegundoFator.executar({
      conta: { contaId: admin.conta.id },
      operadorId: operador.id,
    });
    await pausa.chegou;
    await desativarComoDono(admin.conta.id);
    pausa.liberar();

    expect(await reconfiguracao).toEqual({ tipo: 'conta_inativa' });
    const fator = await dono.query<{ confirmado_em: Date | null }>(
      'SELECT confirmado_em FROM identidade.segundo_fator WHERE conta_id = $1::uuid',
      [admin.conta.id],
    );
    expect(fator.rows[0]?.confirmado_em).not.toBeNull();
    const codigos = await dono.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM identidade.codigos_recuperacao WHERE conta_id = $1::uuid AND usado_em IS NULL',
      [admin.conta.id],
    );
    expect(codigos.rows[0]?.n).toBe(10);
    expect(await sessoesVivas(dono, admin.conta.id)).toBe(1);
    expect((await lerConta(admin.conta.id)).senha_hash).not.toBeNull();
    expect((await desafiosDaConta(admin.conta.id)).filter((d) => d.usado_em === null)).toHaveLength(
      1,
    );
    expect(await tiposDeEvento(admin.conta.id)).not.toContain('identidade.RecuperacaoSolicitada');
    const auditoria = await dono.query(
      "SELECT 1 FROM compartilhado.auditoria WHERE acao = 'segundo_fator_reconfigurado' AND recurso_id = $1",
      [admin.conta.id],
    );
    expect(auditoria.rows).toEqual([]);
  });

  it('login: a conta desativada depois da senha conferida não abre sessão e o resultado é o mesmo de qualquer credencial inválida', async () => {
    const conta = await novaConta();
    const gate = segurarOHashDe(a);
    const login = entrarNoApp(a, conta);
    await gate.chegou;
    await desativarComoDono(conta.id);
    gate.liberar();

    expect(await login).toEqual({ tipo: 'credenciais_invalidas' });
    expect(await sessoesDaConta(dono, conta.id)).toEqual([]);
    expect((await lerConta(conta.id)).ultimo_login_em).toBeNull();
  });
});

describe('segundo fator com a conta fora de ativa no meio (A-R8)', () => {
  it('verificar: sem sessão, o código TOTP não é gasto, o desafio não é usado e a resposta é desafio_invalido', async () => {
    const admin = await novoAdmin();
    avancar(60_000);
    const login = await entrarNoPainel(a, admin.conta);
    if (login.tipo !== 'desafio') throw new Error(`login do admin devolveu ${login.tipo}`);
    const passoAntes = await dono.query<{ ultimo_passo_usado: number | null }>(
      'SELECT ultimo_passo_usado FROM identidade.segundo_fator WHERE conta_id = $1::uuid',
      [admin.conta.id],
    );

    const pausa = pausarAntes(a.repos.contas, 'gravarUltimoLogin');
    const verificacao = a.casos.verificarSegundoFator.executar({
      desafio: login.desafio.desafio,
      codigo: totpDe(admin.segredo, a.relogio.agora()),
    });
    await pausa.chegou;
    await desativarComoDono(admin.conta.id);
    pausa.liberar();

    expect(await verificacao).toEqual({ tipo: 'desafio_invalido' });
    const sessoes = await sessoesDaConta(dono, admin.conta.id);
    expect(sessoes).toHaveLength(1);
    const passoDepois = await dono.query<{ ultimo_passo_usado: number | null }>(
      'SELECT ultimo_passo_usado FROM identidade.segundo_fator WHERE conta_id = $1::uuid',
      [admin.conta.id],
    );
    expect(passoDepois.rows).toEqual(passoAntes.rows);
    expect((await desafiosDaConta(admin.conta.id)).at(-1)).toEqual({
      finalidade: 'desafio_verificar',
      tentativas: 0,
      usado_em: null,
    });
  });

  it('confirmar a configuração: o 2FA não fica confirmado, nenhum código de recuperação é gravado e não há sessão', async () => {
    const conta = await novoAdminSemSegundoFator();
    const login = await entrarNoPainel(a, conta);
    if (login.tipo !== 'desafio') throw new Error(`login do admin devolveu ${login.tipo}`);
    const configuracao = await a.casos.iniciarConfiguracao.executar({
      desafio: login.desafio.desafio,
    });
    if (configuracao.tipo !== 'configuracao') throw new Error('configuração recusada');

    const pausa = pausarAntes(a.repos.contas, 'gravarUltimoLogin');
    const confirmacao = a.casos.confirmarConfiguracao.executar({
      desafio: login.desafio.desafio,
      codigo: totpDe(configuracao.segredoBase32, a.relogio.agora()),
    });
    await pausa.chegou;
    await desativarComoDono(conta.id);
    pausa.liberar();

    expect(await confirmacao).toEqual({ tipo: 'desafio_invalido' });
    const fator = await dono.query<{
      confirmado_em: Date | null;
      ultimo_passo_usado: number | null;
    }>(
      'SELECT confirmado_em, ultimo_passo_usado FROM identidade.segundo_fator WHERE conta_id = $1::uuid',
      [conta.id],
    );
    expect(fator.rows).toEqual([{ confirmado_em: null, ultimo_passo_usado: null }]);
    const codigos = await dono.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM identidade.codigos_recuperacao WHERE conta_id = $1::uuid',
      [conta.id],
    );
    expect(codigos.rows[0]?.n).toBe(0);
    expect(await sessoesDaConta(dono, conta.id)).toEqual([]);
  });
});

describe('a redefinição invalida os desafios do 2FA (S94)', () => {
  it('desafio de verificar emitido com a senha antiga não conclui depois da redefinição, nem com o TOTP certo; o login novo funciona', async () => {
    const admin = await novoAdmin();
    avancar(60_000);
    const login = await entrarNoPainel(a, admin.conta);
    if (login.tipo !== 'desafio') throw new Error(`login do admin devolveu ${login.tipo}`);
    expect(login.desafio.etapa).toBe('verificar');

    await inserirCodigo(a, admin.conta.id, 'recuperacao_senha', '908070');
    expect(
      await b.casos.redefinirSenha.executar({
        email: admin.conta.email,
        codigo: '908070',
        novaSenha: OUTRA_SENHA,
      }),
    ).toEqual({ tipo: 'redefinida' });

    expect(
      await a.casos.verificarSegundoFator.executar({
        desafio: login.desafio.desafio,
        codigo: totpDe(admin.segredo, a.relogio.agora()),
      }),
    ).toEqual({ tipo: 'desafio_invalido' });
    const novoLogin = await entrarNoPainel(a, admin.conta, OUTRA_SENHA);
    if (novoLogin.tipo !== 'desafio') throw new Error(`login novo devolveu ${novoLogin.tipo}`);
    const concluido = await a.casos.verificarSegundoFator.executar({
      desafio: novoLogin.desafio.desafio,
      codigo: totpDe(admin.segredo, a.relogio.agora()),
    });
    expect(concluido.tipo).toBe('concluido');
  });

  it('desafio de configurar emitido com a senha antiga também deixa de valer', async () => {
    const conta = await novoAdminSemSegundoFator();
    const login = await entrarNoPainel(a, conta);
    if (login.tipo !== 'desafio') throw new Error(`login do admin devolveu ${login.tipo}`);
    expect(login.desafio.etapa).toBe('configurar');

    await inserirCodigo(a, conta.id, 'recuperacao_senha', '564738');
    expect(
      await b.casos.redefinirSenha.executar({
        email: conta.email,
        codigo: '564738',
        novaSenha: OUTRA_SENHA,
      }),
    ).toEqual({ tipo: 'redefinida' });

    expect(await a.casos.iniciarConfiguracao.executar({ desafio: login.desafio.desafio })).toEqual({
      tipo: 'desafio_invalido',
    });
  });

  it('verificação do 2FA em andamento e redefinição ao mesmo tempo: sem deadlock, as duas respondem e nenhuma sessão sobrevive à troca de senha', async () => {
    const admin = await novoAdmin();
    avancar(60_000);
    const login = await entrarNoPainel(a, admin.conta);
    if (login.tipo !== 'desafio') throw new Error(`login do admin devolveu ${login.tipo}`);
    await inserirCodigo(a, admin.conta.id, 'recuperacao_senha', '102938');

    // A verificação trava o desafio e o freio do 2FA e para antes de gravar o login na conta.
    const pausa = pausarAntes(a.repos.contas, 'gravarUltimoLogin');
    const verificacao = a.casos.verificarSegundoFator.executar({
      desafio: login.desafio.desafio,
      codigo: totpDe(admin.segredo, a.relogio.agora()),
    });
    await pausa.chegou;
    const redefinicao = b.casos.redefinirSenha
      .executar({ email: admin.conta.email, codigo: '102938', novaSenha: OUTRA_SENHA })
      .then(
        (resultado) => resultado,
        (erro: unknown) => ({ tipo: 'erro', erro }) as const,
      );
    await esperarAlguemNaTrava(dono);
    pausa.liberar();

    expect((await verificacao).tipo).toBe('concluido');
    expect(await redefinicao).toEqual({ tipo: 'redefinida' });
    // Quem tinha a senha antiga e concluiu o 2FA no meio perde a sessão que acabou de abrir.
    expect(await sessoesVivas(dono, admin.conta.id)).toBe(0);
  });
});

describe('reconfiguração do 2FA pela CLI (S97, S99)', () => {
  /** A CLI roda como uma conta admin ativa: o operador. */
  async function novoOperador(): Promise<ContaDeTeste> {
    return novoAdminSemSegundoFator();
  }

  it('só um admin ativo é operador: id desconhecido, conta comum e admin desativado não mudam nada', async () => {
    const admin = await novoAdmin();
    const comum = await novaConta();
    const desativado = await novoOperador();
    await desativarComoDono(desativado.id);

    for (const operadorId of ['3f6c1d0e-9b8a-4c55-8f3e-5a0a4f1f2b11', comum.id, desativado.id]) {
      expect(
        await a.casos.reconfigurarSegundoFator.executar({
          conta: { contaId: admin.conta.id },
          operadorId,
        }),
      ).toEqual({ tipo: 'operador_invalido' });
    }
    expect(await sessoesVivas(dono, admin.conta.id)).toBe(1);
    expect((await lerConta(admin.conta.id)).senha_hash).not.toBeNull();
    const fator = await dono.query(
      'SELECT 1 FROM identidade.segundo_fator WHERE conta_id = $1::uuid',
      [admin.conta.id],
    );
    expect(fator.rows).toHaveLength(1);
    expect(await tiposDeEvento(admin.conta.id)).not.toContain('identidade.RecuperacaoSolicitada');
  });

  it('o resultado, o evento e a auditoria levam só ids; os desafios vivos morrem; repetir não dá erro', async () => {
    const admin = await novoAdmin();
    const operador = await novoOperador();
    avancar(60_000);
    const login = await entrarNoPainel(a, admin.conta);
    if (login.tipo !== 'desafio') throw new Error(`login do admin devolveu ${login.tipo}`);

    const resultado = await a.casos.reconfigurarSegundoFator.executar({
      conta: { contaId: admin.conta.id },
      operadorId: operador.id,
    });
    expect(resultado).toEqual({
      tipo: 'reconfigurado',
      contaId: admin.conta.id,
      sessoesRevogadas: 1,
    });
    // O desafio de verificar emitido antes deixou de valer.
    expect((await desafiosDaConta(admin.conta.id)).every((d) => d.usado_em !== null)).toBe(true);
    expect(
      (await eventosDaConta(dono, admin.conta.id)).filter(
        (e) => e.tipo === 'identidade.RecuperacaoSolicitada',
      ),
    ).toEqual([{ tipo: 'identidade.RecuperacaoSolicitada', payload: { contaId: admin.conta.id } }]);
    const auditoria = await dono.query<{
      ator_tipo: string;
      ator_id: string;
      acao: string;
      depois: unknown;
      origem: string;
      texto: string;
    }>(
      `SELECT ator_tipo::text, ator_id::text, acao, depois, origem, row_to_json(a)::text AS texto
         FROM compartilhado.auditoria a WHERE recurso_id = $1`,
      [admin.conta.id],
    );
    expect(auditoria.rows).toHaveLength(1);
    expect(auditoria.rows[0]).toMatchObject({
      ator_tipo: 'admin',
      ator_id: operador.id,
      acao: 'segundo_fator_reconfigurado',
      depois: { sessoesRevogadas: 1, senhaRemovida: true },
      origem: 'cli',
    });
    for (const proibido of [
      admin.conta.email,
      admin.conta.nome,
      operador.email,
      admin.conta.telefone,
    ]) {
      expect(auditoria.rows[0]?.texto).not.toContain(proibido);
    }

    // Segunda execução: a conta continua admin e ativa, só que sem nada a revogar.
    expect(
      await a.casos.reconfigurarSegundoFator.executar({
        conta: { email: admin.conta.email },
        operadorId: operador.id,
      }),
    ).toEqual({ tipo: 'reconfigurado', contaId: admin.conta.id, sessoesRevogadas: 0 });
  });

  it('operador ou conta que não são UUID dão operador_invalido e conta_nao_encontrada, sem erro do banco', async () => {
    const admin = await novoAdmin();
    const operador = await novoOperador();
    expect(
      await a.casos.reconfigurarSegundoFator.executar({
        conta: { contaId: admin.conta.id },
        operadorId: 'nao-e-uuid',
      }),
    ).toEqual({ tipo: 'operador_invalido' });
    expect(
      await a.casos.reconfigurarSegundoFator.executar({
        conta: { contaId: 'nao-e-uuid' },
        operadorId: operador.id,
      }),
    ).toEqual({ tipo: 'conta_nao_encontrada' });
    expect(await sessoesVivas(dono, admin.conta.id)).toBe(1);
  });

  it('o e-mail lido da entrada padrão acha a conta mesmo em maiúsculas e com espaços, sem alterar outra conta', async () => {
    const admin = await novoAdmin();
    const outroAdmin = await novoAdmin();
    const operador = await novoOperador();
    expect(
      await a.casos.reconfigurarSegundoFator.executar({
        conta: { email: `  ${admin.conta.email.toUpperCase()}  ` },
        operadorId: operador.id,
      }),
    ).toMatchObject({ tipo: 'reconfigurado', contaId: admin.conta.id });
    expect(await sessoesVivas(dono, outroAdmin.conta.id)).toBe(1);
    expect((await lerConta(outroAdmin.conta.id)).senha_hash).not.toBeNull();
  });

  it('e-mail malformado não chega ao banco (email_invalido) e o resultado não repete o e-mail', async () => {
    const operador = await novoOperador();
    const resultado = await a.casos.reconfigurarSegundoFator.executar({
      conta: { email: 'isto não é e-mail' },
      operadorId: operador.id,
    });
    expect(resultado).toEqual({ tipo: 'email_invalido' });
  });

  it('verificação do 2FA em andamento e reconfiguração ao mesmo tempo: sem deadlock; no fim, nenhuma sessão viva e nenhum segundo fator', async () => {
    const admin = await novoAdmin();
    const operador = await novoOperador();
    avancar(60_000);
    const login = await entrarNoPainel(a, admin.conta);
    if (login.tipo !== 'desafio') throw new Error(`login do admin devolveu ${login.tipo}`);

    const pausa = pausarAntes(a.repos.contas, 'gravarUltimoLogin');
    const verificacao = a.casos.verificarSegundoFator.executar({
      desafio: login.desafio.desafio,
      codigo: totpDe(admin.segredo, a.relogio.agora()),
    });
    await pausa.chegou;
    const reconfiguracao = b.casos.reconfigurarSegundoFator
      .executar({ conta: { contaId: admin.conta.id }, operadorId: operador.id })
      .then(
        (resultado) => resultado,
        (erro: unknown) => ({ tipo: 'erro', erro }) as const,
      );
    await esperarAlguemNaTrava(dono);
    pausa.liberar();

    expect((await verificacao).tipo).toBe('concluido');
    // Na sessão do painel da confirmação e na que a verificação acabou de abrir.
    expect(await reconfiguracao).toEqual({
      tipo: 'reconfigurado',
      contaId: admin.conta.id,
      sessoesRevogadas: 2,
    });
    expect(await sessoesVivas(dono, admin.conta.id)).toBe(0);
    const fator = await dono.query(
      'SELECT 1 FROM identidade.segundo_fator WHERE conta_id = $1::uuid',
      [admin.conta.id],
    );
    expect(fator.rows).toEqual([]);
  });
});

describe('teto de 12 h do painel herdado pela verificação de e-mail (A-R7, S101)', () => {
  it('a sessão nova do painel mantém o teto do login, mesmo depois de horas de uso; nos apps não há teto', async () => {
    const admin = await novoAdmin();
    const teto = new Date(T0.getTime() + 12 * 60 * UM_MINUTO);
    let token = admin.sessao.tokenRenovacao;
    // 20 renovações a cada 25 min: ~8 h 20 min de uso contínuo.
    for (let i = 0; i < 20; i++) {
      avancar(25 * UM_MINUTO);
      const r = await a.casos.renovar.executar({ tokenRenovacao: token, cliente: 'painel' });
      if (r.tipo !== 'renovada') throw new Error('renovação do painel recusada');
      token = r.sessao.tokenRenovacao;
    }
    const antes = await sessoesDaConta(dono, admin.conta.id);
    const viva = antes.find((s) => s.revogada_em === null);
    if (viva === undefined) throw new Error('sem sessão viva');
    expect(viva.expira_absoluto_em).toEqual(teto);

    await inserirCodigo(a, admin.conta.id, 'verificacao_email', '314159');
    const resultado = await a.casos.verificarEmail.executar({
      contaId: admin.conta.id,
      sid: viva.id,
      codigo: '314159',
    });
    expect(resultado.tipo).toBe('verificado');

    const depois = (await sessoesDaConta(dono, admin.conta.id)).filter(
      (s) => s.revogada_em === null,
    );
    expect(depois).toHaveLength(1);
    // O teto é o do login, não "agora + 12 h".
    expect(depois[0]?.expira_absoluto_em).toEqual(teto);
    expect(depois[0]?.expira_em.getTime()).toBeLessThanOrEqual(teto.getTime());

    // Nos apps não existe teto absoluto, e a verificação não inventa um.
    const conta = await novaConta();
    const sessaoApp = await loginNoApp(a, conta);
    await inserirCodigo(a, conta.id, 'verificacao_email', '271828');
    expect(
      (
        await a.casos.verificarEmail.executar({
          contaId: conta.id,
          sid: sessaoApp.sid,
          codigo: '271828',
        })
      ).tipo,
    ).toBe('verificado');
    const sessoesApp = await sessoesDaConta(dono, conta.id);
    expect(sessoesApp.filter((s) => s.revogada_em === null)).toHaveLength(1);
    expect(sessoesApp.every((s) => s.expira_absoluto_em === null)).toBe(true);
  });
});

describe('exportação com trava na conta (Q23-api, S98)', () => {
  async function solicitacoesDeExportacao(contaId: string): Promise<number> {
    const { rows } = await dono.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM identidade.solicitacoes_titular WHERE conta_id = $1::uuid AND tipo = 'exportacao'",
      [contaId],
    );
    return rows[0]?.n ?? 0;
  }

  async function idDaSolicitacao(contaId: string): Promise<string> {
    const { rows } = await dono.query<{ id: string }>(
      "SELECT id::text FROM identidade.solicitacoes_titular WHERE conta_id = $1::uuid AND tipo = 'exportacao' ORDER BY solicitada_em DESC LIMIT 1",
      [contaId],
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('solicitação não encontrada');
    return id;
  }

  it('dois pedidos com a trava da conta já tomada pelo primeiro: o segundo espera, recontar vê o primeiro e devolve ja_solicitada, com um pedido e um evento', async () => {
    const conta = await novaConta();
    // O primeiro já gravou o pedido e travou a conta, mas ainda não confirmou.
    const pausa = pausarDepois(a.repos.contas, 'buscarPorIdParaAtualizar');
    const primeiro = a.casos.solicitarExportacao.executar({ contaId: conta.id });
    await pausa.chegou;
    const segundo = b.casos.solicitarExportacao.executar({ contaId: conta.id });
    await esperarAlguemNaTrava(dono);
    pausa.liberar();

    expect(await primeiro).toEqual({ tipo: 'solicitada' });
    expect(await segundo).toEqual({
      tipo: 'ja_solicitada',
      proximaEm: new Date(T0.getTime() + UM_DIA),
    });
    expect(await solicitacoesDeExportacao(conta.id)).toBe(1);
    expect(
      (await tiposDeEvento(conta.id)).filter((t) => t === 'identidade.ExportacaoSolicitada'),
    ).toHaveLength(1);
  });

  it('seis pedidos ao mesmo tempo: um só é aceito, os outros cinco recebem ja_solicitada', async () => {
    const conta = await novaConta();
    const resultados = await Promise.all(
      [a, b, a, b, a, b].map((pilha) =>
        pilha.casos.solicitarExportacao.executar({ contaId: conta.id }),
      ),
    );
    expect(resultados.filter((r) => r.tipo === 'solicitada')).toHaveLength(1);
    expect(resultados.filter((r) => r.tipo === 'ja_solicitada')).toHaveLength(5);
    expect(await solicitacoesDeExportacao(conta.id)).toBe(1);
  });

  it('duas entregas do mesmo pedido ao gerador: uma gera, a outra espera a trava da conta e vê a solicitação concluída; fica uma cópia', async () => {
    const conta = await novaConta();
    await a.casos.solicitarExportacao.executar({ contaId: conta.id });
    const solicitacaoId = await idDaSolicitacao(conta.id);

    const pausa = pausarDepois(a.repos.contas, 'buscarPorIdParaAtualizar');
    const primeira = a.casos.gerarExportacao.executar({ contaId: conta.id, solicitacaoId });
    await pausa.chegou;
    const segunda = b.casos.gerarExportacao.executar({ contaId: conta.id, solicitacaoId });
    await esperarAlguemNaTrava(dono);
    pausa.liberar();

    expect([(await primeira).tipo, (await segunda).tipo].sort()).toEqual(['gerada', 'ignorada']);
    const copias = await dono.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM identidade.exportacoes_titular WHERE conta_id = $1::uuid',
      [conta.id],
    );
    expect(copias.rows[0]?.n).toBe(1);
  });

  it('um pedido novo, depois de 24 h, troca a cópia que ninguém baixou e preserva a que foi baixada', async () => {
    const conta = await novaConta();
    const copias = async () => {
      const { rows } = await dono.query<{ id: string; baixada: boolean }>(
        'SELECT id::text, baixada_em IS NOT NULL AS baixada FROM identidade.exportacoes_titular WHERE conta_id = $1::uuid ORDER BY criada_em, id',
        [conta.id],
      );
      return rows;
    };
    const gerar = async () => {
      await a.casos.solicitarExportacao.executar({ contaId: conta.id });
      const resultado = await a.casos.gerarExportacao.executar({
        contaId: conta.id,
        solicitacaoId: await idDaSolicitacao(conta.id),
      });
      expect(resultado.tipo).toBe('gerada');
    };

    await gerar();
    const [primeira] = await copias();
    avancar(UM_DIA);
    await gerar();
    // Ninguém baixou a primeira: a segunda a substitui, e a conta nunca fica com duas cópias vivas.
    const [segunda, ...resto] = await copias();
    expect(resto).toEqual([]);
    expect(segunda?.id).not.toBe(primeira?.id);

    expect((await a.casos.baixarExportacao.executar({ contaId: conta.id })).tipo).toBe(
      'disponivel',
    );
    avancar(UM_DIA);
    await gerar();
    const todas = await copias();
    expect(todas).toHaveLength(2);
    expect(todas.map((c) => c.baixada)).toEqual([true, false]);
  });
});

describe('anonimização com a conta travada (Q24-api)', () => {
  it('uma anonimização para com a trava da conta tomada; a segunda espera, lê anonimizada e responde ja_anonimizada, com um só aviso', async () => {
    const conta = await novaConta();
    expect(
      await a.casos.solicitarExclusao.executar({ contaId: conta.id, senha: conta.senha }),
    ).toEqual({ tipo: 'desativada' });
    avancar(31 * UM_DIA);

    const pausa = pausarDepois(a.repos.contas, 'buscarPorIdParaAtualizar');
    const primeira = a.casos.anonimizarConta.executar({ contaId: conta.id });
    await pausa.chegou;
    const segunda = b.casos.anonimizarConta.executar({ contaId: conta.id });
    await esperarAlguemNaTrava(dono);
    pausa.liberar();

    expect(await primeira).toEqual({ tipo: 'anonimizada' });
    expect(await segunda).toEqual({ tipo: 'ja_anonimizada' });
    expect(
      (await tiposDeEvento(conta.id)).filter((t) => t === 'identidade.ContaAnonimizada'),
    ).toHaveLength(1);
    expect((await lerConta(conta.id)).status).toBe('anonimizada');
  });
});

describe('o freio zerado não sobra no banco', () => {
  it('depois de todos os fluxos acima, nenhuma linha de freio zerada ficou para as chaves deste arquivo', async () => {
    const { rows } = await dono.query<{ chave_hmac: string; tipo: string }>(
      `SELECT chave_hmac, tipo::text FROM identidade.bloqueios_login
        WHERE chave_hmac = ANY($1::text[]) AND falhas = 0 AND nivel = 0 AND bloqueado_ate IS NULL`,
      [freiosDoTeste],
    );
    expect(rows).toEqual([]);
  });
});
