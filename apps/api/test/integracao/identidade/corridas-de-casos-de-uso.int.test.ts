// Corridas entre casos de uso da Identidade (01b, etapas 8 a 11; R1, R7, R8, S8, S14) contra o
// Postgres de teste, com os repositórios Prisma e a cripto reais. Cada caso usa duas pilhas
// (dois pools): a primeira requisição para num ponto escolhido, DENTRO da transação (o que ela
// já travou fica travado), a segunda começa, e o teste só libera a primeira depois de conferir
// que a segunda ou terminou ou está esperando uma trava. A ordem é controlada, não sorteada.
//
// O que se confere em cada corrida é o estado final e a resposta de cada requisição: nenhuma
// sessão viva em conta desativada (S8), nenhuma conta ressuscitada, nenhum erro 5xx por corrida
// legítima, nenhuma tentativa de código perdida ou contada em dobro.
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DesafioDeSegundoFator } from '../../../src/modulos/identidade/dominio/desafio-de-segundo-fator.ts';
import { Email } from '../../../src/modulos/identidade/dominio/email.ts';
import {
  apagarContasDoTeste,
  cadastrar,
  conectarDono,
  type ContaDeTeste,
  type DocumentosDeTeste,
  emailUnico,
  esperarAlguemNaTrava,
  inserirCodigo,
  montarPilha,
  OUTRA_SENHA,
  pausarAntes,
  pausarAntesDaChamada,
  type Pilha,
  prepararAdmin,
  SENHA,
  semearDocumentos,
  sessoesDaConta,
  sessoesVivas,
  T0,
  totpDe,
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
  await docs.remover();
  await dono.end();
  await Promise.all([a.prisma.$disconnect(), b.prisma.$disconnect()]);
});

beforeEach(() => {
  a.relogio.definir(T0);
  b.relogio.definir(T0);
});

let proximoIp = 10;
/** IP de documentação único por chamada: o freio por origem não passa de um caso para o outro. */
function ipNovo(): string {
  proximoIp += 1;
  return `198.51.100.${proximoIp % 250}`;
}

async function novaConta(opcoes: { senha?: string } = {}): Promise<ContaDeTeste> {
  const conta = await cadastrar(a, docs, opcoes);
  contasDoTeste.push(conta.id);
  freiosDoTeste.push(a.servicos.cifrador.hmac('bloqueio_email', [conta.email]));
  return conta;
}

function entrarNoApp(pilha: Pilha, conta: ContaDeTeste, senha = conta.senha, ip = ipNovo()) {
  return pilha.casos.entrar.executar({
    email: conta.email,
    senha,
    cliente: 'app_consumidor',
    ip,
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
  }>(
    'SELECT status::text, senha_hash, email_verificado_em, ultimo_login_em FROM identidade.contas WHERE id = $1::uuid',
    [contaId],
  );
  const linha = rows[0];
  if (linha === undefined) throw new Error('conta sumiu');
  return linha;
}

async function lerFreio(chave: string, tipo = 'email') {
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

// ---------------------------------------------------------------------------

describe('freio do login (CA-04, S14, R1)', () => {
  it('login certo logo depois de outro do mesmo e-mail com falhas gravadas: os dois respondem, nenhum dá erro', async () => {
    const conta = await novaConta();
    for (let i = 0; i < 2; i++) {
      await entrarNoApp(a, conta, OUTRA_SENHA);
    }
    // A pausa fica na conclusão de A (a primeira `buscarPorId` do login; a reserva lê por
    // e-mail): A já conferiu a senha fora da transação e segura os freios. B, também com a
    // senha certa, espera a trava na reserva; A zera o freio (apaga a linha) e confirma; B
    // recria a linha, confere, conclui e zera de novo. Diferente do teste seguinte, aqui os
    // dois acertam a senha e o freio termina sem linha.
    const pausa = pausarAntes(a.repos.contas, 'buscarPorId');
    const primeiro = entrarNoApp(a, conta);
    await pausa.chegou;
    const segundo = entrarNoApp(b, conta).then(
      (resultado) => resultado,
      (erro: unknown) => ({ tipo: 'erro', erro }) as const,
    );
    await esperarAlguemNaTrava(dono);
    pausa.liberar();

    expect((await primeiro).tipo).toBe('sessao');
    const resposta = await segundo;
    expect(resposta.tipo).toBe('sessao');
    expect(await lerFreio(freiosDoTeste.at(-1) ?? '')).toBeNull();
  });

  it('login certo que vai apagar a linha do freio enquanto outro do mesmo e-mail espera a trava: o segundo recria o freio e nenhum dá erro (Q22-api)', async () => {
    const conta = await novaConta();
    const chave = freiosDoTeste.at(-1) ?? '';
    for (let i = 0; i < 2; i++) {
      await entrarNoApp(a, conta, OUTRA_SENHA);
    }
    // A reserva usa os dois primeiros `salvar` (e-mail e origem). O 3º é o da conclusão: o
    // freio por e-mail já está travado e a senha certa vai zerá-lo, ou seja, apagar a linha.
    // O segundo login chega nesse intervalo e espera a trava da linha que está para sumir.
    const pausa = pausarAntesDaChamada(a.repos.bloqueios, 'salvar', 3);
    const primeiro = entrarNoApp(a, conta);
    await pausa.chegou;
    const segundo = entrarNoApp(b, conta, OUTRA_SENHA).then(
      (resultado) => resultado,
      (erro: unknown) => ({ tipo: 'erro', erro }) as const,
    );
    await esperarAlguemNaTrava(dono);
    pausa.liberar();

    expect((await primeiro).tipo).toBe('sessao');
    expect(await segundo).toEqual({ tipo: 'credenciais_invalidas' });
    // O freio zerado pelo primeiro foi refeito do zero pelo segundo: uma falha só.
    expect(await lerFreio(chave)).toMatchObject({ falhas: 1, nivel: 0, bloqueado_ate: null });
  });

  it('oito logins errados ao mesmo tempo: cinco somam falha, três esbarram no freio e nenhum confere a senha depois da quinta', async () => {
    const conta = await novaConta();
    let conferencias = 0;
    const verificar = a.servicos.hasher.verificar.bind(a.servicos.hasher);
    a.servicos.hasher.verificar = async (senha, hash) => {
      conferencias += 1;
      return verificar(senha, hash);
    };
    try {
      const resultados = await Promise.all(
        Array.from({ length: 8 }, () => entrarNoApp(a, conta, OUTRA_SENHA)),
      );
      const tipos = resultados.map((r) => r.tipo).sort();
      expect(tipos).toEqual([
        'credenciais_invalidas',
        'credenciais_invalidas',
        'credenciais_invalidas',
        'credenciais_invalidas',
        'credenciais_invalidas',
        'freado',
        'freado',
        'freado',
      ]);
      expect(conferencias).toBe(5);
    } finally {
      a.servicos.hasher.verificar = verificar;
    }
    const freio = await lerFreio(a.servicos.cifrador.hmac('bloqueio_email', [conta.email]));
    expect(freio).toMatchObject({ nivel: 1 });
    expect(freio?.bloqueado_ate).toEqual(new Date(T0.getTime() + UM_MINUTO));
  });

  it('login, redefinição e exclusão somam no mesmo freio por e-mail (CA-04, CA-06, CA-11)', async () => {
    const conta = await novaConta();
    await inserirCodigo(a, conta.id, 'recuperacao_senha', '123456');

    for (let i = 0; i < 2; i++) {
      expect((await entrarNoApp(a, conta, OUTRA_SENHA)).tipo).toBe('credenciais_invalidas');
    }
    for (let i = 0; i < 2; i++) {
      const r = await a.casos.redefinirSenha.executar({
        email: conta.email,
        codigo: '000000',
        novaSenha: OUTRA_SENHA,
      });
      expect(r.tipo).toBe('codigo_invalido');
    }
    expect(
      await a.casos.solicitarExclusao.executar({ contaId: conta.id, senha: OUTRA_SENHA }),
    ).toEqual({
      tipo: 'senha_incorreta',
    });

    // Cinco falhas somadas: tudo freia, até com a senha e o código certos.
    expect(await entrarNoApp(a, conta)).toEqual({ tipo: 'freado', segundosDeEspera: 60 });
    expect(
      await a.casos.redefinirSenha.executar({
        email: conta.email,
        codigo: '123456',
        novaSenha: OUTRA_SENHA,
      }),
    ).toEqual({ tipo: 'freado', segundosDeEspera: 60 });
    expect(await a.casos.solicitarExclusao.executar({ contaId: conta.id, senha: SENHA })).toEqual({
      tipo: 'freado',
      segundosDeEspera: 60,
    });
    expect((await lerConta(conta.id)).status).toBe('ativa');
    // O código certo não foi gasto pelo pedido freado.
    const { rows } = await dono.query<{ usado_em: Date | null; tentativas: number }>(
      "SELECT usado_em, tentativas FROM identidade.codigos_verificacao WHERE conta_id = $1::uuid AND finalidade = 'recuperacao_senha'",
      [conta.id],
    );
    expect(rows[0]?.usado_em).toBeNull();
    expect(rows[0]?.tentativas).toBe(2);

    // Passada a espera, a senha certa volta a entrar.
    a.relogio.avancar(UM_MINUTO);
    expect((await entrarNoApp(a, conta)).tipo).toBe('sessao');
  });
});

describe('login × exclusão (S8, S14)', () => {
  it('login em andamento segura o freio; a exclusão espera, e a sessão que o login abriu sai revogada', async () => {
    const conta = await novaConta();
    // O login confere a senha fora da transação (S91): a pausa fica na conclusão, que segura
    // o freio por e-mail até abrir a sessão.
    const pausa = pausarAntes(a.repos.contas, 'gravarUltimoLogin');
    const login = entrarNoApp(a, conta);
    await pausa.chegou;
    const exclusao = b.casos.solicitarExclusao.executar({ contaId: conta.id, senha: conta.senha });
    await esperarAlguemNaTrava(dono);
    pausa.liberar();

    expect((await login).tipo).toBe('sessao');
    expect(await exclusao).toEqual({ tipo: 'desativada' });
    expect((await lerConta(conta.id)).status).toBe('desativada');
    expect(await sessoesVivas(dono, conta.id)).toBe(0);
  });

  it('exclusão em andamento: o login que chega depois não abre sessão nenhuma', async () => {
    const conta = await novaConta();
    const pausa = pausarAntes(a.repos.sessoes, 'revogarDaConta');
    const exclusao = a.casos.solicitarExclusao.executar({ contaId: conta.id, senha: conta.senha });
    await pausa.chegou;
    const login = entrarNoApp(b, conta);
    await esperarAlguemNaTrava(dono);
    pausa.liberar();

    expect(await exclusao).toEqual({ tipo: 'desativada' });
    expect(await login).toEqual({ tipo: 'credenciais_invalidas' });
    expect(await sessoesDaConta(dono, conta.id)).toEqual([]);
    expect((await lerConta(conta.id)).ultimo_login_em).toBeNull();
  });
});

describe('redefinição × exclusão (S8, S14)', () => {
  it('a exclusão pedida com a senha antiga, durante a redefinição, espera o freio, lê a senha nova e recusa a antiga: senha_incorreta', async () => {
    const conta = await novaConta();
    await inserirCodigo(a, conta.id, 'recuperacao_senha', '654321');
    // A redefinição grava só a senha e a verificação (S95), não a conta inteira.
    const pausa = pausarAntes(a.repos.contas, 'gravarSenhaRedefinida');
    const redefinicao = a.casos.redefinirSenha.executar({
      email: conta.email,
      codigo: '654321',
      novaSenha: OUTRA_SENHA,
    });
    await pausa.chegou;
    const exclusao = b.casos.solicitarExclusao.executar({ contaId: conta.id, senha: conta.senha });
    await esperarAlguemNaTrava(dono);
    pausa.liberar();

    expect(await redefinicao).toEqual({ tipo: 'redefinida' });
    expect(await exclusao).toEqual({ tipo: 'senha_incorreta' });
    expect((await lerConta(conta.id)).status).toBe('ativa');
  });

  it('a redefinição que chega com a exclusão em andamento não ressuscita a conta nem gasta o código', async () => {
    const conta = await novaConta();
    await inserirCodigo(a, conta.id, 'recuperacao_senha', '654321');
    const antes = await lerConta(conta.id);
    const pausa = pausarAntes(a.repos.sessoes, 'revogarDaConta');
    const exclusao = a.casos.solicitarExclusao.executar({ contaId: conta.id, senha: conta.senha });
    await pausa.chegou;
    const redefinicao = b.casos.redefinirSenha.executar({
      email: conta.email,
      codigo: '654321',
      novaSenha: OUTRA_SENHA,
    });
    await esperarAlguemNaTrava(dono);
    pausa.liberar();

    expect(await exclusao).toEqual({ tipo: 'desativada' });
    expect(await redefinicao).toEqual({ tipo: 'codigo_invalido' });
    const depois = await lerConta(conta.id);
    expect(depois.status).toBe('desativada');
    expect(depois.senha_hash).toBe(antes.senha_hash);
    expect(depois.email_verificado_em).toBeNull();
  });
});

describe('conta desativada por outro caminho no meio do login (S8)', () => {
  it('conta desativada depois da senha conferida: o login não abre sessão nem grava o último login', async () => {
    const conta = await novaConta();
    const pausa = pausarAntes(a.repos.contas, 'gravarUltimoLogin');
    const login = entrarNoApp(a, conta);
    await pausa.chegou;
    await dono.query(
      "UPDATE identidade.contas SET status = 'desativada', desativada_em = $2 WHERE id = $1::uuid",
      [conta.id, T0],
    );
    pausa.liberar();

    expect(await login).toEqual({ tipo: 'credenciais_invalidas' });
    expect(await sessoesDaConta(dono, conta.id)).toEqual([]);
    expect((await lerConta(conta.id)).ultimo_login_em).toBeNull();
  });
});

describe('verificação de e-mail × logout (S8)', () => {
  it('o logout confirma no meio: a verificação desfaz tudo e responde sessao_invalida, sem gastar o código', async () => {
    const conta = await novaConta();
    const sessao = await loginNoApp(a, conta);
    await inserirCodigo(a, conta.id, 'verificacao_email', '111222');

    const pausa = pausarAntes(a.repos.contas, 'gravarEmailVerificado');
    const verificacao = a.casos.verificarEmail.executar({
      contaId: conta.id,
      sid: sessao.sid,
      codigo: '111222',
    });
    await pausa.chegou;
    await b.casos.encerrar.executar({ contaId: conta.id, sid: sessao.sid });
    pausa.liberar();

    expect(await verificacao).toEqual({ tipo: 'sessao_invalida' });
    expect((await lerConta(conta.id)).email_verificado_em).toBeNull();
    const { rows } = await dono.query<{ usado_em: Date | null; tentativas: number }>(
      "SELECT usado_em, tentativas FROM identidade.codigos_verificacao WHERE conta_id = $1::uuid AND finalidade = 'verificacao_email'",
      [conta.id],
    );
    expect(rows).toEqual([{ usado_em: null, tentativas: 0 }]);
    const sessoes = await sessoesDaConta(dono, conta.id);
    expect(sessoes).toHaveLength(1);
    expect(sessoes[0]?.motivo_revogacao).toBe('logout');
  });
});

describe('renovação × outras requisições (R1, R7, S16, S77, S8)', () => {
  async function comSessao() {
    const conta = await novaConta();
    const sessao = await loginNoApp(a, conta);
    const antes = await sessoesDaConta(dono, conta.id);
    const loginAntes = (await lerConta(conta.id)).ultimo_login_em;
    a.relogio.avancar(UM_MINUTO);
    b.relogio.avancar(UM_MINUTO);
    return { conta, sessao, antes, loginAntes };
  }

  it('redefinição de senha confirma antes de a renovação gravar: renovação recusada, sessão segue revogada, login intocado', async () => {
    const { conta, sessao, antes, loginAntes } = await comSessao();
    await inserirCodigo(a, conta.id, 'recuperacao_senha', '222333');
    const pausa = pausarAntes(a.repos.contas, 'gravarUltimoLogin');
    const renovacao = a.casos.renovar.executar({
      tokenRenovacao: sessao.tokenRenovacao,
      cliente: 'app_consumidor',
    });
    await pausa.chegou;
    expect(
      await b.casos.redefinirSenha.executar({
        email: conta.email,
        codigo: '222333',
        novaSenha: OUTRA_SENHA,
      }),
    ).toEqual({ tipo: 'redefinida' });
    pausa.liberar();

    expect(await renovacao).toEqual({ tipo: 'invalida' });
    const depois = await sessoesDaConta(dono, conta.id);
    expect(depois).toHaveLength(1);
    expect(depois[0]).toMatchObject({
      token_hash: antes[0]?.token_hash,
      motivo_revogacao: 'senha_redefinida',
    });
    expect((await lerConta(conta.id)).ultimo_login_em).toEqual(loginAntes);
    expect(await sessoesVivas(dono, conta.id)).toBe(0);
  });

  it('exclusão confirma antes de a renovação gravar: renovação recusada e nenhuma sessão viva', async () => {
    const { conta, sessao, antes, loginAntes } = await comSessao();
    const pausa = pausarAntes(a.repos.contas, 'gravarUltimoLogin');
    const renovacao = a.casos.renovar.executar({
      tokenRenovacao: sessao.tokenRenovacao,
      cliente: 'app_consumidor',
    });
    await pausa.chegou;
    expect(
      await b.casos.solicitarExclusao.executar({ contaId: conta.id, senha: conta.senha }),
    ).toEqual({
      tipo: 'desativada',
    });
    pausa.liberar();

    expect(await renovacao).toEqual({ tipo: 'invalida' });
    const depois = await sessoesDaConta(dono, conta.id);
    expect(depois[0]?.token_hash).toBe(antes[0]?.token_hash);
    expect(await sessoesVivas(dono, conta.id)).toBe(0);
    expect((await lerConta(conta.id)).ultimo_login_em).toEqual(loginAntes);
  });

  it('logout confirma antes de a renovação gravar: renovação recusada, revogação de logout preservada', async () => {
    const { conta, sessao, antes } = await comSessao();
    const pausa = pausarAntes(a.repos.contas, 'gravarUltimoLogin');
    const renovacao = a.casos.renovar.executar({
      tokenRenovacao: sessao.tokenRenovacao,
      cliente: 'app_consumidor',
    });
    await pausa.chegou;
    await b.casos.encerrar.executar({ contaId: conta.id, sid: sessao.sid });
    pausa.liberar();

    expect(await renovacao).toEqual({ tipo: 'invalida' });
    const depois = await sessoesDaConta(dono, conta.id);
    expect(depois[0]).toMatchObject({
      token_hash: antes[0]?.token_hash,
      motivo_revogacao: 'logout',
    });
  });

  it('duas renovações com o mesmo token: as duas respondem com o mesmo par, e o histórico guarda uma linha', async () => {
    const { conta, sessao } = await comSessao();
    const pausa = pausarAntes(a.repos.contas, 'gravarUltimoLogin');
    const lenta = a.casos.renovar.executar({
      tokenRenovacao: sessao.tokenRenovacao,
      cliente: 'app_consumidor',
    });
    await pausa.chegou;
    const rapida = await b.casos.renovar.executar({
      tokenRenovacao: sessao.tokenRenovacao,
      cliente: 'app_consumidor',
    });
    pausa.liberar();
    const outra = await lenta;

    if (rapida.tipo !== 'renovada' || outra.tipo !== 'renovada') {
      throw new Error('as duas renovações deviam ser aceitas');
    }
    expect(outra.sessao.tokenRenovacao).toBe(rapida.sessao.tokenRenovacao);
    expect(outra.sessao.tokenAcesso).toBe(rapida.sessao.tokenAcesso);
    const { rows } = await dono.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM identidade.tokens_de_renovacao_usados u
         JOIN identidade.sessoes s ON s.id = u.sessao_id WHERE s.conta_id = $1::uuid`,
      [conta.id],
    );
    expect(rows[0]?.n).toBe(1);
    expect(await sessoesVivas(dono, conta.id)).toBe(1);
  });

  it('o token antigo reapresentado depois dos 60 s revoga a família, inclusive o token novo (S77)', async () => {
    const { conta, sessao } = await comSessao();
    const renovada = await a.casos.renovar.executar({
      tokenRenovacao: sessao.tokenRenovacao,
      cliente: 'app_consumidor',
    });
    if (renovada.tipo !== 'renovada') throw new Error('renovação de teste recusada');
    a.relogio.avancar(61_000);

    expect(
      await a.casos.renovar.executar({
        tokenRenovacao: sessao.tokenRenovacao,
        cliente: 'app_consumidor',
      }),
    ).toEqual({ tipo: 'invalida' });
    expect(
      await a.casos.renovar.executar({
        tokenRenovacao: renovada.sessao.tokenRenovacao,
        cliente: 'app_consumidor',
      }),
    ).toEqual({ tipo: 'invalida' });
    expect(await sessoesVivas(dono, conta.id)).toBe(0);
    expect((await sessoesDaConta(dono, conta.id))[0]?.motivo_revogacao).toBe('reuso_detectado');
  });
});

describe('2FA concorrente (R8, CA-09)', () => {
  /** Admin com segundo fator confirmado; devolve a conta, o segredo e os códigos de recuperação. */
  async function adminComSegundoFator() {
    const admin = await prepararAdmin(a, docs, ipNovo());
    contasDoTeste.push(admin.conta.id);
    freiosDoTeste.push(a.servicos.cifrador.hmac('bloqueio_email', [admin.conta.email]));
    freiosDoTeste.push(a.servicos.cifrador.hmac('bloqueio_segundo_fator', [admin.conta.id]));
    return admin;
  }

  /** Um desafio `verificar` gravado direto, sem invalidar os outros da conta (como o R8 pede). */
  async function desafioAvulso(contaId: string): Promise<string> {
    const id = a.servicos.gerador.novoId();
    const segredo = a.servicos.gerador.tokenOpaco();
    const desafio = DesafioDeSegundoFator.emitir({
      id,
      contaId,
      etapa: 'verificar',
      tokenHmac: a.servicos.cifrador.hmac('desafio_verificar', [contaId, segredo]),
      agora: a.relogio.agora(),
    });
    await a.unidade.executar(() => a.repos.desafios.inserir(desafio));
    return `${id}.${segredo}`;
  }

  it('dois desafios da mesma conta com o mesmo código do autenticador: um conclui, o outro recebe codigo_errado', async () => {
    const { conta, segredo } = await adminComSegundoFator();
    a.relogio.avancar(60_000);
    b.relogio.avancar(60_000);
    const codigo = totpDe(segredo, a.relogio.agora());
    const [desafioA, desafioB] = [await desafioAvulso(conta.id), await desafioAvulso(conta.id)];

    const pausa = pausarAntes(a.repos.segundoFator, 'salvar');
    const primeiro = a.casos.verificarSegundoFator.executar({ desafio: desafioA, codigo });
    await pausa.chegou;
    const segundo = b.casos.verificarSegundoFator.executar({ desafio: desafioB, codigo });
    await esperarAlguemNaTrava(dono);
    pausa.liberar();

    expect((await primeiro).tipo).toBe('concluido');
    expect(await segundo).toEqual({ tipo: 'codigo_errado', campo: 'codigo' });
    const comMfa = (await sessoesDaConta(dono, conta.id)).filter((s) => s.mfa);
    // A sessão da confirmação da configuração e a deste login.
    expect(comMfa).toHaveLength(2);
  });

  it('dois desafios com o mesmo código de recuperação: um conclui, o outro não, e o código fica gasto', async () => {
    const { conta, recuperacao } = await adminComSegundoFator();
    const codigo = recuperacao[0];
    if (codigo === undefined) throw new Error('sem código de recuperação');
    const [desafioA, desafioB] = [await desafioAvulso(conta.id), await desafioAvulso(conta.id)];

    const pausa = pausarAntes(a.repos.segundoFator, 'marcarCodigoDeRecuperacaoUsado');
    const primeiro = a.casos.verificarSegundoFator.executar({
      desafio: desafioA,
      codigoRecuperacao: codigo,
    });
    await pausa.chegou;
    const segundo = b.casos.verificarSegundoFator.executar({
      desafio: desafioB,
      codigoRecuperacao: codigo,
    });
    await esperarAlguemNaTrava(dono);
    pausa.liberar();

    expect((await primeiro).tipo).toBe('concluido');
    expect(await segundo).toEqual({ tipo: 'codigo_errado', campo: 'codigoRecuperacao' });
    const { rows } = await dono.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM identidade.codigos_recuperacao WHERE conta_id = $1::uuid AND usado_em IS NOT NULL',
      [conta.id],
    );
    expect(rows[0]?.n).toBe(1);
  });
});

describe('CLI de reconfiguração do 2FA × login (S97, A-R13)', () => {
  it('login nos apps na conclusão, com a senha antiga já conferida: a CLI espera o freio por e-mail e revoga também a sessão que ele abriu', async () => {
    const admin = await prepararAdmin(a, docs, ipNovo());
    contasDoTeste.push(admin.conta.id);
    freiosDoTeste.push(
      a.servicos.cifrador.hmac('bloqueio_email', [admin.conta.email]),
      a.servicos.cifrador.hmac('bloqueio_segundo_fator', [admin.conta.id]),
    );
    // O login para depois de reler a conta (ainda com senha) e antes de gravar o login e a
    // sessão, segurando o freio por e-mail.
    const pausa = pausarAntes(a.repos.contas, 'gravarUltimoLogin');
    const login = entrarNoApp(a, admin.conta);
    await pausa.chegou;
    const reconfiguracao = b.casos.reconfigurarSegundoFator.executar({
      conta: { contaId: admin.conta.id },
      operadorId: admin.conta.id,
    });
    // Sem a trava do freio por e-mail, a CLI terminaria aqui e o login gravaria a sessão
    // depois da revogação.
    await esperarAlguemNaTrava(dono);
    pausa.liberar();

    expect((await login).tipo).toBe('sessao');
    // A sessão do painel aberta na preparação e a deste login.
    expect(await reconfiguracao).toEqual({
      tipo: 'reconfigurado',
      contaId: admin.conta.id,
      sessoesRevogadas: 2,
    });
    expect(await sessoesVivas(dono, admin.conta.id)).toBe(0);
    expect((await lerConta(admin.conta.id)).senha_hash).toBeNull();
    // Quem chega depois relê a conta sem senha e não entra.
    expect(await entrarNoApp(a, admin.conta)).toEqual({ tipo: 'credenciais_invalidas' });
  });

  /** Admin com 2FA e os freios dele marcados para a limpeza. */
  async function adminDaCli() {
    const admin = await prepararAdmin(a, docs, ipNovo());
    contasDoTeste.push(admin.conta.id);
    freiosDoTeste.push(
      a.servicos.cifrador.hmac('bloqueio_email', [admin.conta.email]),
      a.servicos.cifrador.hmac('bloqueio_segundo_fator', [admin.conta.id]),
    );
    return admin;
  }

  it('a CLI já em andamento (segura o freio por e-mail): o login que chega depois espera, relê a conta sem senha e não abre sessão', async () => {
    const admin = await adminDaCli();
    // O login do painel da preparação já gravou um último login; o do app não pode mexer nele.
    const ultimoLoginAntes = (await lerConta(admin.conta.id)).ultimo_login_em;
    a.relogio.avancar(UM_MINUTO);
    b.relogio.avancar(UM_MINUTO);
    const pausa = pausarAntes(a.repos.contas, 'gravarSenhaRemovida');
    const reconfiguracao = a.casos.reconfigurarSegundoFator.executar({
      conta: { contaId: admin.conta.id },
      operadorId: admin.conta.id,
    });
    await pausa.chegou;
    // A reserva do login precisa do freio por e-mail, que a CLI já travou.
    const login = entrarNoApp(b, admin.conta).then(
      (resultado) => resultado,
      (erro: unknown) => ({ tipo: 'erro', erro }) as const,
    );
    await esperarAlguemNaTrava(dono);
    pausa.liberar();

    expect(await reconfiguracao).toMatchObject({ tipo: 'reconfigurado', sessoesRevogadas: 1 });
    expect(await login).toEqual({ tipo: 'credenciais_invalidas' });
    expect(await sessoesVivas(dono, admin.conta.id)).toBe(0);
    expect((await lerConta(admin.conta.id)).ultimo_login_em).toEqual(ultimoLoginAntes);
  });

  it('login no painel com a senha antiga já conferida, parado antes de emitir o desafio: a CLI espera e o desafio emitido não vale depois dela', async () => {
    const admin = await adminDaCli();
    a.relogio.avancar(UM_MINUTO);
    b.relogio.avancar(UM_MINUTO);
    // `emitirDesafioDeSegundoFator` invalida os vigentes e insere o novo: a pausa fica antes disso,
    // com os freios por e-mail e por origem travados pela conclusão do login.
    const pausa = pausarAntes(a.repos.desafios, 'invalidarVigentes');
    const login = a.casos.entrar.executar({
      email: admin.conta.email,
      senha: admin.conta.senha,
      cliente: 'painel',
      ip: ipNovo(),
    });
    await pausa.chegou;
    const reconfiguracao = b.casos.reconfigurarSegundoFator.executar({
      conta: { contaId: admin.conta.id },
      operadorId: admin.conta.id,
    });
    await esperarAlguemNaTrava(dono);
    pausa.liberar();

    const resposta = await login;
    if (resposta.tipo !== 'desafio') throw new Error(`login do painel devolveu ${resposta.tipo}`);
    expect(await reconfiguracao).toMatchObject({ tipo: 'reconfigurado' });
    // O desafio que o login emitiu antes da CLI terminar foi invalidado por ela: nem o código
    // certo do autenticador antigo conclui.
    expect(
      await a.casos.verificarSegundoFator.executar({
        desafio: resposta.desafio.desafio,
        codigo: totpDe(admin.segredo, a.relogio.agora()),
      }),
    ).toEqual({ tipo: 'desafio_invalido' });
    expect(await sessoesVivas(dono, admin.conta.id)).toBe(0);
  });

  it('redefinição de senha em andamento e CLI ao mesmo tempo: sem deadlock, sem sessão viva, sem segundo fator, e a senha termina a da redefinição', async () => {
    const admin = await adminDaCli();
    await inserirCodigo(a, admin.conta.id, 'recuperacao_senha', '246810');
    const pausa = pausarAntes(a.repos.contas, 'gravarSenhaRedefinida');
    const redefinicao = a.casos.redefinirSenha.executar({
      email: admin.conta.email,
      codigo: '246810',
      novaSenha: OUTRA_SENHA,
    });
    await pausa.chegou;
    const reconfiguracao = b.casos.reconfigurarSegundoFator
      .executar({ conta: { contaId: admin.conta.id }, operadorId: admin.conta.id })
      .then(
        (resultado) => resultado,
        (erro: unknown) => ({ tipo: 'erro', erro }) as const,
      );
    await esperarAlguemNaTrava(dono);
    pausa.liberar();

    expect(await redefinicao).toEqual({ tipo: 'redefinida' });
    expect((await reconfiguracao).tipo).toBe('reconfigurado');
    expect(await sessoesVivas(dono, admin.conta.id)).toBe(0);
    const fator = await dono.query(
      'SELECT 1 FROM identidade.segundo_fator WHERE conta_id = $1::uuid',
      [admin.conta.id],
    );
    expect(fator.rows).toEqual([]);
    // A CLI veio depois da redefinição e apagou a senha de novo: só o e-mail devolve o acesso.
    expect((await lerConta(admin.conta.id)).senha_hash).toBeNull();
  });
});

describe('cadastro concorrente (CA-01, CA-02)', () => {
  it('seis cadastros do mesmo e-mail ao mesmo tempo: uma conta, uma ContaCriada, cinco avisos, todos respondem aceito', async () => {
    const email = emailUnico();
    const aceites = { termos: docs.termos.versao, privacidade: docs.privacidade.versao };
    const pedidos = [a, b, a, b, a, b].map((pilha, indice) =>
      pilha.casos.criarConta.executar({
        nome: `Pessoa ${indice}`,
        email,
        telefone: '+5535999991234',
        senha: SENHA,
        aceites,
      }),
    );
    expect(await Promise.all(pedidos)).toEqual(
      Array.from({ length: 6 }, () => ({ tipo: 'aceito' })),
    );

    const conta = await a.repos.contas.buscarPorEmail(Email.criar(email));
    if (conta === null) throw new Error('nenhuma conta gravada');
    contasDoTeste.push(conta.id);
    const { rows } = await dono.query<{ tipo: string }>(
      'SELECT tipo FROM compartilhado.outbox WHERE agregado_id = $1::uuid',
      [conta.id],
    );
    const tipos = rows.map((r) => r.tipo).sort();
    expect(tipos.filter((t) => t === 'identidade.ContaCriada')).toHaveLength(1);
    expect(tipos.filter((t) => t === 'identidade.CadastroRepetidoTentado')).toHaveLength(5);
    const consentimentos = await dono.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM identidade.consentimentos WHERE conta_id = $1::uuid',
      [conta.id],
    );
    expect(consentimentos.rows[0]?.n).toBe(2);
  });
});

describe('privacidade concorrente (S10, CA-10, CA-11)', () => {
  it('dois downloads da exportação ao mesmo tempo: só um recebe o arquivo', async () => {
    const conta = await novaConta();
    const solicitada = await a.casos.solicitarExportacao.executar({ contaId: conta.id });
    expect(solicitada).toEqual({ tipo: 'solicitada' });
    const { rows } = await dono.query<{ id: string }>(
      "SELECT id::text FROM identidade.solicitacoes_titular WHERE conta_id = $1::uuid AND tipo = 'exportacao'",
      [conta.id],
    );
    const solicitacaoId = rows[0]?.id;
    if (solicitacaoId === undefined) throw new Error('solicitação não gravada');
    expect(
      await a.casos.gerarExportacao.executar({ contaId: conta.id, solicitacaoId }),
    ).toMatchObject({
      tipo: 'gerada',
    });

    const resultados = await Promise.all([
      a.casos.baixarExportacao.executar({ contaId: conta.id }),
      b.casos.baixarExportacao.executar({ contaId: conta.id }),
    ]);
    expect(resultados.map((r) => r.tipo).sort()).toEqual(['disponivel', 'indisponivel']);
  });

  it('dois pedidos de exportação ao mesmo tempo respeitam o limite de um por 24 h', async () => {
    const conta = await novaConta();
    const pausa = pausarAntes(a.repos.solicitacoes, 'inserir');
    const primeiro = a.casos.solicitarExportacao.executar({ contaId: conta.id });
    await pausa.chegou;
    const segundo = await b.casos.solicitarExportacao.executar({ contaId: conta.id });
    pausa.liberar();
    const resposta = await primeiro;

    expect([resposta.tipo, segundo.tipo].sort()).toEqual(['ja_solicitada', 'solicitada']);
    const { rows } = await dono.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM identidade.solicitacoes_titular WHERE conta_id = $1::uuid AND tipo = 'exportacao'",
      [conta.id],
    );
    expect(rows[0]?.n).toBe(1);
  });

  it('duas anonimizações da mesma conta ao mesmo tempo: sem erro e um único aviso ContaAnonimizada', async () => {
    const conta = await novaConta();
    expect(
      await a.casos.solicitarExclusao.executar({ contaId: conta.id, senha: conta.senha }),
    ).toEqual({
      tipo: 'desativada',
    });
    a.relogio.avancar(31 * 24 * 60 * UM_MINUTO);
    b.relogio.avancar(31 * 24 * 60 * UM_MINUTO);

    const resultados = await Promise.all([
      a.casos.anonimizarConta.executar({ contaId: conta.id }),
      b.casos.anonimizarConta.executar({ contaId: conta.id }),
    ]);
    expect(
      resultados.map((r) => r.tipo).every((t) => t === 'anonimizada' || t === 'ja_anonimizada'),
    ).toBe(true);
    expect((await a.repos.contas.buscarPorId(conta.id))?.status).toBe('anonimizada');
    const { rows } = await dono.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM compartilhado.outbox WHERE agregado_id = $1::uuid AND tipo = 'identidade.ContaAnonimizada'",
      [conta.id],
    );
    expect(rows[0]?.n).toBe(1);
  });
});
