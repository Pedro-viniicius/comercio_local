// Ciclo de vida da conta de ponta a ponta (01b, etapas 6 a 11; CA-01 a CA-06, CA-09 a CA-12):
// cadastro → verificação → login → renovação → logout → recuperação → 2FA do admin →
// privacidade → exclusão → anonimização, com os casos de uso ligados aos repositórios Prisma
// e à cripto reais (Argon2id, HMAC, AES-GCM, JWT, TOTP) no Postgres de teste. Os testes de
// unidade dos casos de uso usam fakes; aqui se confere o que o banco guardou de verdade.
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  FalhaNaAnonimizacao,
  RegistroDeAnonimizadores,
} from '../../../src/compartilhado/titular/anonimizador-de-titular.ts';
import { AnonimizadorDeIdentidade } from '../../../src/modulos/identidade/aplicacao/privacidade/anonimizador-identidade.ts';
import { AnonimizarContaCasoDeUso } from '../../../src/modulos/identidade/aplicacao/privacidade/anonimizar-conta.ts';
import { Email } from '../../../src/modulos/identidade/dominio/email.ts';
import {
  apagarContasDoTeste,
  cadastrar,
  conectarDono,
  type ContaDeTeste,
  type DocumentosDeTeste,
  emailUnico,
  eventosDaConta,
  inserirCodigo,
  montarPilha,
  NOME_PADRAO,
  OUTRA_SENHA,
  prepararAdmin,
  SENHA,
  semearDocumentos,
  sessoesDaConta,
  sessoesVivas,
  T0,
  TELEFONE_PADRAO,
  totpDe,
  UM_DIA,
  UM_MINUTO,
} from './pilha-de-casos-de-uso.ts';

const p = montarPilha();
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
  await p.prisma.$disconnect();
});

beforeEach(() => {
  p.relogio.definir(T0);
});

let proximoIp = 100;
function ipNovo(): string {
  proximoIp += 1;
  return `203.0.113.${proximoIp % 250}`;
}

async function novaConta(
  opcoes: { email?: string; senha?: string; nome?: string; telefone?: string } = {},
) {
  const conta = await cadastrar(p, docs, opcoes);
  contasDoTeste.push(conta.id);
  freiosDoTeste.push(p.servicos.cifrador.hmac('bloqueio_email', [conta.email]));
  return conta;
}

function entrarNoApp(conta: { email: string }, senha: string, ip = ipNovo()) {
  return p.casos.entrar.executar({ email: conta.email, senha, cliente: 'app_consumidor', ip });
}

async function loginNoApp(conta: ContaDeTeste) {
  const r = await entrarNoApp(conta, conta.senha);
  if (r.tipo !== 'sessao') throw new Error(`login de teste devolveu ${r.tipo}`);
  const claims = await p.servicos.emissor.verificar(r.sessao.tokenAcesso, p.relogio.agora());
  if (claims === null) throw new Error('token de acesso de teste não verifica');
  return { ...r.sessao, sid: claims.sid, claims };
}

async function linhaDaConta(contaId: string) {
  const { rows } = await dono.query<{
    nome: string;
    email_normalizado: string;
    telefone_e164: string | null;
    senha_hash: string | null;
    email_verificado_em: Date | null;
    ultimo_login_em: Date | null;
    status: string;
    desativada_em: Date | null;
    anonimizada_em: Date | null;
  }>('SELECT * FROM identidade.contas WHERE id = $1::uuid', [contaId]);
  const linha = rows[0];
  if (linha === undefined) throw new Error('conta não encontrada');
  return linha;
}

function payloadDoToken(token: string): Record<string, unknown> {
  const meio = token.split('.')[1] ?? '';
  return JSON.parse(Buffer.from(meio, 'base64url').toString('utf8')) as Record<string, unknown>;
}

const ACEITES = () => ({ termos: docs.termos.versao, privacidade: docs.privacidade.versao });

// ---------------------------------------------------------------------------

describe('cadastro (CA-01, CA-02)', () => {
  it('grava a conta com o celular em E.164, hash Argon2id, perfil consumidor, os dois aceites e ContaCriada só com o id', async () => {
    const conta = await novaConta();
    const linha = await linhaDaConta(conta.id);

    expect(linha).toMatchObject({
      nome: NOME_PADRAO,
      email_normalizado: conta.email,
      telefone_e164: TELEFONE_PADRAO,
      status: 'ativa',
      email_verificado_em: null,
      ultimo_login_em: null,
    });
    expect(linha.senha_hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(linha.senha_hash).not.toContain(SENHA);

    const perfis = await dono.query<{ perfil: string }>(
      'SELECT perfil::text FROM identidade.perfis_conta WHERE conta_id = $1::uuid',
      [conta.id],
    );
    expect(perfis.rows).toEqual([{ perfil: 'consumidor' }]);

    const aceites = await dono.query<{ documento_id: string; aceito_em: Date }>(
      'SELECT documento_id::text, aceito_em FROM identidade.consentimentos WHERE conta_id = $1::uuid ORDER BY documento_id',
      [conta.id],
    );
    expect(aceites.rows.map((r) => r.documento_id).sort()).toEqual(
      [docs.termos.id, docs.privacidade.id].sort(),
    );
    expect(aceites.rows.every((r) => r.aceito_em.getTime() === T0.getTime())).toBe(true);

    expect(await eventosDaConta(dono, conta.id)).toEqual([
      { tipo: 'identidade.ContaCriada', payload: { contaId: conta.id } },
    ]);
  });

  it('versão aceita diferente da vigente: aceites_divergentes e nada gravado', async () => {
    const email = emailUnico();
    const resultado = await p.casos.criarConta.executar({
      nome: NOME_PADRAO,
      email,
      telefone: TELEFONE_PADRAO,
      senha: SENHA,
      aceites: { termos: 'versao-antiga', privacidade: docs.privacidade.versao },
    });
    expect(resultado).toEqual({ tipo: 'aceites_divergentes', documentos: ['termos'] });
    expect(await p.repos.contas.buscarPorEmail(Email.criar(email))).toBeNull();
  });

  it('e-mail repetido responde igual, não altera a conta e avisa o dono, também com a conta desativada (CA-02)', async () => {
    const conta = await novaConta();
    const antes = await linhaDaConta(conta.id);
    const resposta = await p.casos.criarConta.executar({
      nome: 'Outra Pessoa',
      email: conta.email,
      telefone: '+5511988887777',
      senha: OUTRA_SENHA,
      aceites: ACEITES(),
    });
    const emailNovo = emailUnico();
    const nova = await p.casos.criarConta.executar({
      nome: 'Pessoa Nova',
      email: emailNovo,
      telefone: TELEFONE_PADRAO,
      senha: SENHA,
      aceites: ACEITES(),
    });
    const criada = await p.repos.contas.buscarPorEmail(Email.criar(emailNovo));
    if (criada !== null) contasDoTeste.push(criada.id);
    expect(resposta).toEqual(nova);
    expect(await linhaDaConta(conta.id)).toEqual(antes);
    expect(await eventosDaConta(dono, conta.id)).toEqual([
      { tipo: 'identidade.CadastroRepetidoTentado', payload: { contaId: conta.id } },
      { tipo: 'identidade.ContaCriada', payload: { contaId: conta.id } },
    ]);

    await p.casos.solicitarExclusao.executar({ contaId: conta.id, senha: conta.senha });
    const sobreDesativada = await p.casos.criarConta.executar({
      nome: 'Outra Pessoa',
      email: conta.email,
      telefone: '+5511988887777',
      senha: OUTRA_SENHA,
      aceites: ACEITES(),
    });
    expect(sobreDesativada).toEqual(resposta);
    expect((await linhaDaConta(conta.id)).nome).toBe(NOME_PADRAO);
  });
});

describe('login e tokens (CA-03, CA-04)', () => {
  it('app: token de acesso de 15 min com os claims certos, sessão de 30 dias, e o token de renovação só existe como HMAC', async () => {
    const conta = await novaConta();
    const sessao = await loginNoApp(conta);

    const payload = payloadDoToken(sessao.tokenAcesso);
    expect(Number(payload['exp']) - Number(payload['iat'])).toBe(900);
    expect(sessao.claims).toMatchObject({
      contaId: conta.id,
      perfis: ['consumidor'],
      mfa: false,
      emailVerificado: false,
    });
    expect(sessao.expiraEm).toEqual(new Date(T0.getTime() + 15 * UM_MINUTO));
    expect(sessao.emailVerificado).toBe(false);

    const [linha] = await sessoesDaConta(dono, conta.id);
    expect(linha).toMatchObject({ cliente: 'app_consumidor', mfa: false, revogada_em: null });
    expect(linha?.expira_em).toEqual(new Date(T0.getTime() + 30 * UM_DIA));
    expect(linha?.expira_absoluto_em).toBeNull();
    const bruto = await dono.query<{ texto: string }>(
      'SELECT row_to_json(s)::text AS texto FROM identidade.sessoes s WHERE conta_id = $1::uuid',
      [conta.id],
    );
    expect(bruto.rows[0]?.texto).not.toContain(sessao.tokenRenovacao);
    expect((await linhaDaConta(conta.id)).ultimo_login_em).toEqual(T0);
  });

  it('a mesma resposta para e-mail inexistente, senha errada, conta desativada, anonimizada e sem senha (CA-04)', async () => {
    const certa = await novaConta();
    const desativada = await novaConta();
    const anonimizada = await novaConta();
    const semSenha = await novaConta();
    await p.casos.solicitarExclusao.executar({ contaId: desativada.id, senha: desativada.senha });
    await p.casos.solicitarExclusao.executar({ contaId: anonimizada.id, senha: anonimizada.senha });
    await p.casos.anonimizarConta.executar({ contaId: anonimizada.id });
    await dono.query('UPDATE identidade.contas SET senha_hash = NULL WHERE id = $1::uuid', [
      semSenha.id,
    ]);

    const respostas = [
      await entrarNoApp({ email: emailUnico() }, SENHA),
      await entrarNoApp(certa, OUTRA_SENHA),
      await entrarNoApp(desativada, desativada.senha),
      await entrarNoApp(anonimizada, anonimizada.senha),
      await entrarNoApp(semSenha, SENHA),
    ];
    for (const resposta of respostas) expect(resposta).toEqual({ tipo: 'credenciais_invalidas' });
  });

  it('5 falhas dão espera de 1, 5 e 15 min, e a quarta rodada continua em 15 min; a senha certa só entra depois da espera', async () => {
    const conta = await novaConta();
    const ip = ipNovo();
    const esperas: number[] = [];
    for (const espera of [60, 300, 900, 900]) {
      for (let i = 0; i < 5; i++) {
        expect(await entrarNoApp(conta, OUTRA_SENHA, ip)).toEqual({
          tipo: 'credenciais_invalidas',
        });
      }
      const freado = await entrarNoApp(conta, conta.senha, ip);
      expect(freado).toEqual({ tipo: 'freado', segundosDeEspera: espera });
      esperas.push(espera);
      p.relogio.avancar(espera * 1000);
    }
    expect(esperas).toEqual([60, 300, 900, 900]);
    expect((await entrarNoApp(conta, conta.senha, ip)).tipo).toBe('sessao');
  });

  it('50 falhas de uma origem, com e-mails diferentes, freiam a origem inteira (CA-04, S14)', async () => {
    const ip = '192.0.2.77';
    freiosDoTeste.push(p.servicos.cifrador.hmac('bloqueio_ip', ['ipv4:192.0.2.77']));
    const conta = await novaConta();
    for (let i = 0; i < 50; i++) {
      const email = `inexistente${i}.${emailUnico('x')}`;
      freiosDoTeste.push(p.servicos.cifrador.hmac('bloqueio_email', [email]));
      expect(await entrarNoApp({ email }, SENHA, ip)).toEqual({ tipo: 'credenciais_invalidas' });
    }
    expect(await entrarNoApp(conta, conta.senha, ip)).toEqual({
      tipo: 'freado',
      segundosDeEspera: 60,
    });
    // Outra origem não é afetada.
    expect((await entrarNoApp(conta, conta.senha, '192.0.2.78')).tipo).toBe('sessao');
  });

  it('no IPv6, endereços do mesmo /64 dividem o freio de origem', async () => {
    freiosDoTeste.push(p.servicos.cifrador.hmac('bloqueio_ip', ['ipv6:2001:db8:abcd:12::/64']));
    const conta = await novaConta();
    for (let i = 0; i < 50; i++) {
      const email = `inexistente${i}.${emailUnico('v6')}`;
      freiosDoTeste.push(p.servicos.cifrador.hmac('bloqueio_email', [email]));
      const ip = i % 2 === 0 ? '2001:db8:abcd:12::1' : '2001:db8:abcd:12:ffff::2';
      await entrarNoApp({ email }, SENHA, ip);
    }
    expect(await entrarNoApp(conta, conta.senha, '2001:db8:abcd:12:1:2:3:4')).toEqual({
      tipo: 'freado',
      segundosDeEspera: 60,
    });
  });
});

describe('renovação e logout (CA-03, CA-05)', () => {
  it('renovar troca o token, devolve token de acesso novo, desliza a validade e grava o último login', async () => {
    const conta = await novaConta();
    const sessao = await loginNoApp(conta);
    p.relogio.avancar(10 * UM_DIA);

    const r = await p.casos.renovar.executar({
      tokenRenovacao: sessao.tokenRenovacao,
      cliente: 'app_consumidor',
    });
    if (r.tipo !== 'renovada') throw new Error('renovação recusada');
    expect(r.sessao.tokenRenovacao).not.toBe(sessao.tokenRenovacao);
    expect(r.sessao.tokenAcesso).not.toBe(sessao.tokenAcesso);
    const [linha] = await sessoesDaConta(dono, conta.id);
    expect(linha?.id).toBe(sessao.sid);
    expect(linha?.expira_em).toEqual(new Date(p.relogio.agora().getTime() + 30 * UM_DIA));
    expect((await linhaDaConta(conta.id)).ultimo_login_em).toEqual(p.relogio.agora());
    const claims = await p.servicos.emissor.verificar(r.sessao.tokenAcesso, p.relogio.agora());
    expect(claims?.sid).toBe(sessao.sid);
  });

  it('o token de um app apresentado como outro cliente é recusado, sem revogar a sessão', async () => {
    const conta = await novaConta();
    const sessao = await loginNoApp(conta);
    for (const cliente of ['painel', 'app_lojista'] as const) {
      expect(
        await p.casos.renovar.executar({ tokenRenovacao: sessao.tokenRenovacao, cliente }),
      ).toEqual({
        tipo: 'invalida',
      });
    }
    expect(await sessoesVivas(dono, conta.id)).toBe(1);
    expect(
      (
        await p.casos.renovar.executar({
          tokenRenovacao: sessao.tokenRenovacao,
          cliente: 'app_consumidor',
        })
      ).tipo,
    ).toBe('renovada');
  });

  it('sessão sem uso por mais de 30 dias não renova', async () => {
    const conta = await novaConta();
    const sessao = await loginNoApp(conta);
    p.relogio.avancar(30 * UM_DIA);
    expect(
      await p.casos.renovar.executar({
        tokenRenovacao: sessao.tokenRenovacao,
        cliente: 'app_consumidor',
      }),
    ).toEqual({ tipo: 'invalida' });
  });

  it('logout pelo sid invalida a renovação; repetir e sair com token desconhecido não dão erro', async () => {
    const conta = await novaConta();
    const sessao = await loginNoApp(conta);
    await p.casos.encerrar.executar({ contaId: conta.id, sid: sessao.sid });
    await p.casos.encerrar.executar({ contaId: conta.id, sid: sessao.sid });
    await p.casos.encerrar.executar({ tokenRenovacao: 'token-que-nunca-existiu' });
    await p.casos.encerrar.executar({
      contaId: conta.id,
      sid: '00000000-0000-4000-8000-000000000000',
    });
    await p.casos.encerrar.executar({ contaId: conta.id, sid: 'nao-e-uuid' });

    expect(
      await p.casos.renovar.executar({
        tokenRenovacao: sessao.tokenRenovacao,
        cliente: 'app_consumidor',
      }),
    ).toEqual({ tipo: 'invalida' });
    const [linha] = await sessoesDaConta(dono, conta.id);
    expect(linha?.motivo_revogacao).toBe('logout');
  });

  it('o sid de outra conta não revoga a sessão alheia', async () => {
    const dona = await novaConta();
    const intrusa = await novaConta();
    const sessao = await loginNoApp(dona);
    await p.casos.encerrar.executar({ contaId: intrusa.id, sid: sessao.sid });
    expect(await sessoesVivas(dono, dona.id)).toBe(1);
  });

  it('logout pelo token de renovação (cookie do painel) revoga a sessão, também com um token já trocado duas vezes atrás (S80, S77)', async () => {
    const conta = await novaConta();
    const sessao = await loginNoApp(conta);
    let atual = sessao.tokenRenovacao;
    for (let i = 0; i < 3; i++) {
      p.relogio.avancar(2 * UM_MINUTO);
      const r = await p.casos.renovar.executar({
        tokenRenovacao: atual,
        cliente: 'app_consumidor',
      });
      if (r.tipo !== 'renovada') throw new Error('renovação recusada');
      atual = r.sessao.tokenRenovacao;
    }
    // O primeiro token já saiu da sessão e só existe no histórico da família.
    await p.casos.encerrar.executar({ tokenRenovacao: sessao.tokenRenovacao });
    expect(await sessoesVivas(dono, conta.id)).toBe(0);
    expect(
      await p.casos.renovar.executar({ tokenRenovacao: atual, cliente: 'app_consumidor' }),
    ).toEqual({ tipo: 'invalida' });
  });
});

describe('sessão do painel: inatividade e teto (S9, CA-03)', () => {
  async function sessaoDoPainel() {
    const admin = await prepararAdmin(p, docs, ipNovo());
    contasDoTeste.push(admin.conta.id);
    freiosDoTeste.push(
      p.servicos.cifrador.hmac('bloqueio_email', [admin.conta.email]),
      p.servicos.cifrador.hmac('bloqueio_segundo_fator', [admin.conta.id]),
    );
    return admin;
  }

  it('30 min sem uso encerram a sessão (29 min 59 s ainda renovam), e cada renovação empurra o fim por mais 30 min', async () => {
    const admin = await sessaoDoPainel();
    p.relogio.avancar(30 * UM_MINUTO - 1_000);
    const renovada = await p.casos.renovar.executar({
      tokenRenovacao: admin.sessao.tokenRenovacao,
      cliente: 'painel',
    });
    if (renovada.tipo !== 'renovada') throw new Error('renovação recusada');
    const [linha] = await sessoesDaConta(dono, admin.conta.id);
    expect(linha?.expira_em).toEqual(new Date(p.relogio.agora().getTime() + 30 * UM_MINUTO));

    p.relogio.avancar(30 * UM_MINUTO);
    expect(
      await p.casos.renovar.executar({
        tokenRenovacao: renovada.sessao.tokenRenovacao,
        cliente: 'painel',
      }),
    ).toEqual({ tipo: 'invalida' });
  });

  it('mesmo com uso contínuo, a sessão não passa de 12 h desde o login', async () => {
    const admin = await sessaoDoPainel();
    const teto = T0.getTime() + 12 * 60 * UM_MINUTO;
    let token = admin.sessao.tokenRenovacao;
    let ultimaAceitaEm = T0.getTime();
    for (let i = 0; i < 40; i++) {
      p.relogio.avancar(25 * UM_MINUTO);
      const r = await p.casos.renovar.executar({ tokenRenovacao: token, cliente: 'painel' });
      if (r.tipo === 'invalida') break;
      token = r.sessao.tokenRenovacao;
      ultimaAceitaEm = p.relogio.agora().getTime();
    }
    expect(ultimaAceitaEm).toBeLessThan(teto);
    expect(ultimaAceitaEm).toBeGreaterThan(teto - 30 * UM_MINUTO);
    const [linha] = await sessoesDaConta(dono, admin.conta.id);
    expect(linha?.expira_em.getTime()).toBeLessThanOrEqual(teto);
  });
});

describe('verificação de e-mail (CA-01)', () => {
  it('código certo verifica o e-mail e troca a sessão por uma nova da mesma família, com emailVerificado', async () => {
    const conta = await novaConta();
    const sessao = await loginNoApp(conta);
    await inserirCodigo(p, conta.id, 'verificacao_email', '482913');

    const r = await p.casos.verificarEmail.executar({
      contaId: conta.id,
      sid: sessao.sid,
      codigo: '482913',
    });
    if (r.tipo !== 'verificado') throw new Error(`verificação devolveu ${r.tipo}`);
    expect(r.sessao.emailVerificado).toBe(true);
    const claims = await p.servicos.emissor.verificar(r.sessao.tokenAcesso, p.relogio.agora());
    expect(claims).toMatchObject({ emailVerificado: true, mfa: false, perfis: ['consumidor'] });
    expect((await linhaDaConta(conta.id)).email_verificado_em).toEqual(T0);

    const sessoes = await sessoesDaConta(dono, conta.id);
    expect(sessoes).toHaveLength(2);
    expect(sessoes.map((s) => s.motivo_revogacao).sort()).toEqual([null, 'substituida']);
    expect(await sessoesVivas(dono, conta.id)).toBe(1);
    expect(
      await p.casos.renovar.executar({
        tokenRenovacao: sessao.tokenRenovacao,
        cliente: 'app_consumidor',
      }),
    ).toEqual({ tipo: 'invalida' });
  });

  it('o código de uma conta não verifica outra, e cinco erros queimam o código, mesmo com o certo depois', async () => {
    const dona = await novaConta();
    const outra = await novaConta();
    const sessaoDaOutra = await loginNoApp(outra);
    await inserirCodigo(p, dona.id, 'verificacao_email', '135790');
    await inserirCodigo(p, outra.id, 'verificacao_email', '246810');

    expect(
      await p.casos.verificarEmail.executar({
        contaId: outra.id,
        sid: sessaoDaOutra.sid,
        codigo: '135790',
      }),
    ).toEqual({ tipo: 'codigo_invalido' });
    expect((await linhaDaConta(dona.id)).email_verificado_em).toBeNull();
    expect((await linhaDaConta(outra.id)).email_verificado_em).toBeNull();

    // Quatro erros somados ao anterior = cinco: o código certo já não vale.
    for (let i = 0; i < 4; i++) {
      await p.casos.verificarEmail.executar({
        contaId: outra.id,
        sid: sessaoDaOutra.sid,
        codigo: '000000',
      });
    }
    expect(
      await p.casos.verificarEmail.executar({
        contaId: outra.id,
        sid: sessaoDaOutra.sid,
        codigo: '246810',
      }),
    ).toEqual({ tipo: 'codigo_invalido' });
    expect((await linhaDaConta(outra.id)).email_verificado_em).toBeNull();
  });

  it('o código vence aos 30 min (29 min 59 s ainda vale), e o reenvio só avisa conta ativa e não verificada', async () => {
    const conta = await novaConta();
    const sessao = await loginNoApp(conta);
    await inserirCodigo(p, conta.id, 'verificacao_email', '555111');
    p.relogio.avancar(30 * UM_MINUTO);
    expect(
      await p.casos.verificarEmail.executar({
        contaId: conta.id,
        sid: sessao.sid,
        codigo: '555111',
      }),
    ).toEqual({ tipo: 'codigo_invalido' });

    await inserirCodigo(p, conta.id, 'verificacao_email', '555222');
    p.relogio.avancar(30 * UM_MINUTO - 1_000);
    expect(
      (
        await p.casos.verificarEmail.executar({
          contaId: conta.id,
          sid: sessao.sid,
          codigo: '555222',
        })
      ).tipo,
    ).toBe('verificado');

    await p.casos.reenviarVerificacao.executar({ contaId: conta.id });
    const eventos = await eventosDaConta(dono, conta.id);
    expect(eventos.map((e) => e.tipo)).not.toContain('identidade.VerificacaoReenviada');

    const naoVerificada = await novaConta();
    await p.casos.reenviarVerificacao.executar({ contaId: naoVerificada.id });
    expect(await eventosDaConta(dono, naoVerificada.id)).toContainEqual({
      tipo: 'identidade.VerificacaoReenviada',
      payload: { contaId: naoVerificada.id },
    });
  });
});

describe('recuperação de senha (CA-05, CA-06)', () => {
  it('o pedido responde igual com ou sem conta, e só a conta ativa gera o evento', async () => {
    const ativa = await novaConta();
    const desativada = await novaConta();
    await p.casos.solicitarExclusao.executar({ contaId: desativada.id, senha: desativada.senha });

    for (const email of [ativa.email, desativada.email, emailUnico()]) {
      await expect(p.casos.solicitarRecuperacao.executar({ email })).resolves.toBeUndefined();
    }
    expect(await eventosDaConta(dono, ativa.id)).toContainEqual({
      tipo: 'identidade.RecuperacaoSolicitada',
      payload: { contaId: ativa.id },
    });
    expect((await eventosDaConta(dono, desativada.id)).map((e) => e.tipo)).not.toContain(
      'identidade.RecuperacaoSolicitada',
    );
  });

  it('código certo troca a senha, verifica o e-mail, revoga todas as sessões e só vale uma vez', async () => {
    const conta = await novaConta();
    const doApp = await loginNoApp(conta);
    const doOutroApp = await p.casos.entrar.executar({
      email: conta.email,
      senha: conta.senha,
      cliente: 'app_lojista',
      ip: ipNovo(),
    });
    expect(doOutroApp.tipo).toBe('sessao');
    expect(await sessoesVivas(dono, conta.id)).toBe(2);
    await inserirCodigo(p, conta.id, 'recuperacao_senha', '908070');

    expect(
      await p.casos.redefinirSenha.executar({
        email: conta.email,
        codigo: '908070',
        novaSenha: OUTRA_SENHA,
      }),
    ).toEqual({ tipo: 'redefinida' });
    expect(await sessoesVivas(dono, conta.id)).toBe(0);
    expect(
      (await sessoesDaConta(dono, conta.id)).every(
        (s) => s.motivo_revogacao === 'senha_redefinida',
      ),
    ).toBe(true);
    expect(
      await p.casos.renovar.executar({
        tokenRenovacao: doApp.tokenRenovacao,
        cliente: 'app_consumidor',
      }),
    ).toEqual({ tipo: 'invalida' });
    expect((await linhaDaConta(conta.id)).email_verificado_em).toEqual(T0);
    expect(await eventosDaConta(dono, conta.id)).toContainEqual({
      tipo: 'identidade.SenhaRedefinida',
      payload: { contaId: conta.id },
    });

    expect(await entrarNoApp(conta, conta.senha)).toEqual({ tipo: 'credenciais_invalidas' });
    expect((await entrarNoApp(conta, OUTRA_SENHA)).tipo).toBe('sessao');
    // Uso único: o mesmo código não redefine de novo.
    expect(
      await p.casos.redefinirSenha.executar({
        email: conta.email,
        codigo: '908070',
        novaSenha: SENHA,
      }),
    ).toEqual({ tipo: 'codigo_invalido' });
  });

  it('o código vale 30 min (29 min 59 s ainda vale), e e-mail sem conta, código errado e vencido dão a mesma resposta', async () => {
    const conta = await novaConta();
    await inserirCodigo(p, conta.id, 'recuperacao_senha', '313131');
    p.relogio.avancar(30 * UM_MINUTO);
    const vencido = await p.casos.redefinirSenha.executar({
      email: conta.email,
      codigo: '313131',
      novaSenha: OUTRA_SENHA,
    });
    const errado = await p.casos.redefinirSenha.executar({
      email: conta.email,
      codigo: '000001',
      novaSenha: OUTRA_SENHA,
    });
    const semConta = await p.casos.redefinirSenha.executar({
      email: emailUnico(),
      codigo: '313131',
      novaSenha: OUTRA_SENHA,
    });
    expect([vencido, errado, semConta]).toEqual(
      Array.from({ length: 3 }, () => ({ tipo: 'codigo_invalido' })),
    );

    p.relogio.definir(T0);
    await inserirCodigo(p, conta.id, 'recuperacao_senha', '414141');
    p.relogio.avancar(30 * UM_MINUTO - 1_000);
    expect(
      (
        await p.casos.redefinirSenha.executar({
          email: conta.email,
          codigo: '414141',
          novaSenha: OUTRA_SENHA,
        })
      ).tipo,
    ).toBe('redefinida');
  });

  it('cinco códigos errados queimam o código (o certo depois não vale) e o código de verificação não serve para recuperar', async () => {
    const conta = await novaConta();
    await inserirCodigo(p, conta.id, 'recuperacao_senha', '777000');
    for (let i = 0; i < 5; i++) {
      await p.casos.redefinirSenha.executar({
        email: conta.email,
        codigo: '000002',
        novaSenha: OUTRA_SENHA,
      });
    }
    p.relogio.avancar(15 * UM_MINUTO + 1_000);
    expect(
      await p.casos.redefinirSenha.executar({
        email: conta.email,
        codigo: '777000',
        novaSenha: OUTRA_SENHA,
      }),
    ).toEqual({ tipo: 'codigo_invalido' });

    p.relogio.definir(T0);
    const outra = await novaConta();
    await inserirCodigo(p, outra.id, 'verificacao_email', '888999');
    expect(
      await p.casos.redefinirSenha.executar({
        email: outra.email,
        codigo: '888999',
        novaSenha: OUTRA_SENHA,
      }),
    ).toEqual({ tipo: 'codigo_invalido' });
  });
});

describe('2FA do admin (CA-09, S1)', () => {
  it('conta sem perfil admin no painel recebe sem_acesso_painel, sem sessão nem desafio', async () => {
    const conta = await novaConta();
    const r = await p.casos.entrar.executar({
      email: conta.email,
      senha: conta.senha,
      cliente: 'painel',
      ip: ipNovo(),
    });
    expect(r).toEqual({ tipo: 'sem_acesso_painel', contaId: conta.id });
    expect(await sessoesDaConta(dono, conta.id)).toEqual([]);
  });

  it('configura antes de tudo: o admin sem 2FA só recebe o desafio de configurar, e a sessão nasce com mfa, admin e prazos do painel', async () => {
    const admin = await prepararAdmin(p, docs, ipNovo());
    contasDoTeste.push(admin.conta.id);
    freiosDoTeste.push(
      p.servicos.cifrador.hmac('bloqueio_email', [admin.conta.email]),
      p.servicos.cifrador.hmac('bloqueio_segundo_fator', [admin.conta.id]),
    );

    expect(admin.recuperacao).toHaveLength(10);
    expect(new Set(admin.recuperacao).size).toBe(10);
    const claims = await p.servicos.emissor.verificar(admin.sessao.tokenAcesso, p.relogio.agora());
    expect(claims).toMatchObject({ mfa: true });
    expect(claims?.perfis).toEqual(expect.arrayContaining(['admin', 'consumidor']));
    const [sessao] = await sessoesDaConta(dono, admin.conta.id);
    expect(sessao).toMatchObject({ cliente: 'painel', mfa: true });
    expect(sessao?.expira_em).toEqual(new Date(T0.getTime() + 30 * UM_MINUTO));
    expect(sessao?.expira_absoluto_em).toEqual(new Date(T0.getTime() + 12 * 60 * UM_MINUTO));

    // O segredo e os códigos de recuperação não ficam em claro no banco.
    const guardado = await dono.query<{ texto: string }>(
      `SELECT (SELECT row_to_json(s)::text FROM identidade.segundo_fator s WHERE conta_id = $1::uuid)
              || (SELECT string_agg(row_to_json(c)::text, '') FROM identidade.codigos_recuperacao c WHERE conta_id = $1::uuid) AS texto`,
      [admin.conta.id],
    );
    expect(guardado.rows[0]?.texto).not.toContain(admin.segredo);
    for (const codigo of admin.recuperacao) expect(guardado.rows[0]?.texto).not.toContain(codigo);
  });

  it('depois de configurado: o login pede o código; o mesmo passo não vale duas vezes; o seguinte vale; a renovação herda o mfa', async () => {
    const admin = await prepararAdmin(p, docs, ipNovo());
    contasDoTeste.push(admin.conta.id);
    freiosDoTeste.push(
      p.servicos.cifrador.hmac('bloqueio_email', [admin.conta.email]),
      p.servicos.cifrador.hmac('bloqueio_segundo_fator', [admin.conta.id]),
    );
    const entrar = async () => {
      const r = await p.casos.entrar.executar({
        email: admin.conta.email,
        senha: admin.conta.senha,
        cliente: 'painel',
        ip: ipNovo(),
      });
      if (r.tipo !== 'desafio') throw new Error(`login devolveu ${r.tipo}`);
      return r.desafio;
    };

    const mesmoPasso = await entrar();
    expect(mesmoPasso.etapa).toBe('verificar');
    // O passo do T0 foi gasto na confirmação.
    expect(
      await p.casos.verificarSegundoFator.executar({
        desafio: mesmoPasso.desafio,
        codigo: totpDe(admin.segredo, T0),
      }),
    ).toEqual({ tipo: 'codigo_errado', campo: 'codigo' });

    p.relogio.avancar(30_000);
    const seguinte = await p.casos.verificarSegundoFator.executar({
      desafio: mesmoPasso.desafio,
      codigo: totpDe(admin.segredo, p.relogio.agora()),
    });
    if (seguinte.tipo !== 'concluido') throw new Error(`verificação devolveu ${seguinte.tipo}`);
    const claims = await p.servicos.emissor.verificar(
      seguinte.sessao.tokenAcesso,
      p.relogio.agora(),
    );
    expect(claims).toMatchObject({ mfa: true });
    expect(claims?.perfis).toContain('admin');

    // O desafio é de uso único.
    p.relogio.avancar(30_000);
    expect(
      await p.casos.verificarSegundoFator.executar({
        desafio: mesmoPasso.desafio,
        codigo: totpDe(admin.segredo, p.relogio.agora()),
      }),
    ).toEqual({ tipo: 'desafio_invalido' });

    const renovada = await p.casos.renovar.executar({
      tokenRenovacao: seguinte.sessao.tokenRenovacao,
      cliente: 'painel',
    });
    if (renovada.tipo !== 'renovada') throw new Error('renovação recusada');
    const claimsRenovada = await p.servicos.emissor.verificar(
      renovada.sessao.tokenAcesso,
      p.relogio.agora(),
    );
    expect(claimsRenovada).toMatchObject({ mfa: true });
    expect(claimsRenovada?.perfis).toContain('admin');
  });

  it('admin nos apps entra sem poderes de admin, e a verificação de e-mail nunca devolve admin nem mfa', async () => {
    const admin = await prepararAdmin(p, docs, ipNovo());
    contasDoTeste.push(admin.conta.id);
    freiosDoTeste.push(
      p.servicos.cifrador.hmac('bloqueio_email', [admin.conta.email]),
      p.servicos.cifrador.hmac('bloqueio_segundo_fator', [admin.conta.id]),
    );
    const noApp = await entrarNoApp(admin.conta, admin.conta.senha);
    if (noApp.tipo !== 'sessao') throw new Error(`login no app devolveu ${noApp.tipo}`);
    const claimsDoApp = await p.servicos.emissor.verificar(
      noApp.sessao.tokenAcesso,
      p.relogio.agora(),
    );
    expect(claimsDoApp).toMatchObject({ mfa: false });
    expect(claimsDoApp?.perfis).not.toContain('admin');

    // Verificação de e-mail a partir da sessão do painel (com mfa): a sessão nova perde admin e mfa.
    const claimsDoPainel = await p.servicos.emissor.verificar(
      admin.sessao.tokenAcesso,
      p.relogio.agora(),
    );
    await inserirCodigo(p, admin.conta.id, 'verificacao_email', '121212');
    const verificada = await p.casos.verificarEmail.executar({
      contaId: admin.conta.id,
      sid: claimsDoPainel?.sid ?? '',
      codigo: '121212',
    });
    if (verificada.tipo !== 'verificado')
      throw new Error(`verificação devolveu ${verificada.tipo}`);
    const claimsNovos = await p.servicos.emissor.verificar(
      verificada.sessao.tokenAcesso,
      p.relogio.agora(),
    );
    expect(claimsNovos).toMatchObject({ mfa: false });
    expect(claimsNovos?.perfis).not.toContain('admin');
  });

  it('cinco códigos errados matam o desafio e o freio de segundo fator barra um desafio novo, até com o código certo', async () => {
    const admin = await prepararAdmin(p, docs, ipNovo());
    contasDoTeste.push(admin.conta.id);
    freiosDoTeste.push(
      p.servicos.cifrador.hmac('bloqueio_email', [admin.conta.email]),
      p.servicos.cifrador.hmac('bloqueio_segundo_fator', [admin.conta.id]),
    );
    p.relogio.avancar(60_000);
    const login = await p.casos.entrar.executar({
      email: admin.conta.email,
      senha: admin.conta.senha,
      cliente: 'painel',
      ip: ipNovo(),
    });
    if (login.tipo !== 'desafio') throw new Error(`login devolveu ${login.tipo}`);
    const tipos: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await p.casos.verificarSegundoFator.executar({
        desafio: login.desafio.desafio,
        codigo: '000000',
      });
      tipos.push(r.tipo);
    }
    expect(tipos).toEqual([
      'codigo_errado',
      'codigo_errado',
      'codigo_errado',
      'codigo_errado',
      'desafio_invalido',
    ]);
    // Desafio morto: o código certo também recebe o mesmo 401.
    expect(
      await p.casos.verificarSegundoFator.executar({
        desafio: login.desafio.desafio,
        codigo: totpDe(admin.segredo, p.relogio.agora()),
      }),
    ).toEqual({ tipo: 'desafio_invalido' });

    // A quinta falha do freio por conta barra um desafio novo, sem gastar tentativa.
    const novo = await p.casos.entrar.executar({
      email: admin.conta.email,
      senha: admin.conta.senha,
      cliente: 'painel',
      ip: ipNovo(),
    });
    if (novo.tipo !== 'desafio') throw new Error(`login devolveu ${novo.tipo}`);
    expect(
      await p.casos.verificarSegundoFator.executar({
        desafio: novo.desafio.desafio,
        codigo: totpDe(admin.segredo, p.relogio.agora()),
      }),
    ).toEqual({ tipo: 'freado', segundosDeEspera: 60 });
  });

  it('desafio de configurar não vale para verificar e o contrário; o configurar é recusado com o 2FA já confirmado (S1)', async () => {
    const admin = await prepararAdmin(p, docs, ipNovo());
    contasDoTeste.push(admin.conta.id);
    freiosDoTeste.push(
      p.servicos.cifrador.hmac('bloqueio_email', [admin.conta.email]),
      p.servicos.cifrador.hmac('bloqueio_segundo_fator', [admin.conta.id]),
    );
    p.relogio.avancar(60_000);
    const login = await p.casos.entrar.executar({
      email: admin.conta.email,
      senha: admin.conta.senha,
      cliente: 'painel',
      ip: ipNovo(),
    });
    if (login.tipo !== 'desafio') throw new Error(`login devolveu ${login.tipo}`);
    expect(login.desafio.etapa).toBe('verificar');
    expect(await p.casos.iniciarConfiguracao.executar({ desafio: login.desafio.desafio })).toEqual({
      tipo: 'desafio_invalido',
    });
    expect(
      await p.casos.confirmarConfiguracao.executar({
        desafio: login.desafio.desafio,
        codigo: totpDe(admin.segredo, p.relogio.agora()),
      }),
    ).toEqual({ tipo: 'desafio_invalido' });
    for (const lixo of ['', 'sem-ponto', 'nao-uuid.segredo', `${login.desafio.desafio}x`]) {
      expect(
        await p.casos.verificarSegundoFator.executar({ desafio: lixo, codigo: '000000' }),
      ).toEqual({
        tipo: 'desafio_invalido',
      });
    }
  });

  it('a CLI de reconfiguração apaga o 2FA e a senha, revoga as sessões, audita o operador sem e-mail e só devolve o login ao desafio de configurar depois da senha nova pelo e-mail (S97, S99)', async () => {
    const admin = await prepararAdmin(p, docs, ipNovo());
    contasDoTeste.push(admin.conta.id);
    freiosDoTeste.push(
      p.servicos.cifrador.hmac('bloqueio_email', [admin.conta.email]),
      p.servicos.cifrador.hmac('bloqueio_segundo_fator', [admin.conta.id]),
    );
    // Quem roda a CLI: outra conta admin (o operador vai para a auditoria).
    const operador = await novaConta();
    const doOperador = await p.repos.contas.buscarPorId(operador.id);
    if (doOperador === null) throw new Error('operador sumiu');
    doOperador.concederAdmin(p.relogio.agora());
    await p.repos.contas.atualizar(doOperador);
    expect(await sessoesVivas(dono, admin.conta.id)).toBe(1);

    const r = await p.casos.reconfigurarSegundoFator.executar({
      conta: { email: admin.conta.email },
      operadorId: operador.id,
    });
    expect(r).toEqual({ tipo: 'reconfigurado', contaId: admin.conta.id, sessoesRevogadas: 1 });
    expect(await sessoesVivas(dono, admin.conta.id)).toBe(0);
    expect((await linhaDaConta(admin.conta.id)).senha_hash).toBeNull();
    expect((await eventosDaConta(dono, admin.conta.id)).map((e) => e.tipo)).toContain(
      'identidade.RecuperacaoSolicitada',
    );
    const { rows } = await dono.query<{ ator_tipo: string; ator_id: string; texto: string }>(
      `SELECT ator_tipo::text, ator_id::text, row_to_json(a)::text AS texto
         FROM compartilhado.auditoria a WHERE recurso_id = $1`,
      [admin.conta.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ator_tipo: 'admin', ator_id: operador.id });
    for (const proibido of [admin.conta.email, admin.conta.nome, operador.email]) {
      expect(rows[0]?.texto).not.toContain(proibido);
    }

    // Só a senha não basta mais: a conta precisa do código enviado ao e-mail.
    p.relogio.avancar(60_000);
    const comSenhaAntiga = {
      email: admin.conta.email,
      senha: admin.conta.senha,
      cliente: 'painel' as const,
      ip: ipNovo(),
    };
    expect(await p.casos.entrar.executar(comSenhaAntiga)).toEqual({
      tipo: 'credenciais_invalidas',
    });
    await inserirCodigo(p, admin.conta.id, 'recuperacao_senha', '246813');
    expect(
      await p.casos.redefinirSenha.executar({
        email: admin.conta.email,
        codigo: '246813',
        novaSenha: OUTRA_SENHA,
      }),
    ).toEqual({ tipo: 'redefinida' });
    const login = await p.casos.entrar.executar({ ...comSenhaAntiga, senha: OUTRA_SENHA });
    if (login.tipo !== 'desafio') throw new Error(`login devolveu ${login.tipo}`);
    expect(login.desafio.etapa).toBe('configurar');

    // Pelo id da conta também; conta que não é admin, e-mail inexistente e operador que não é
    // admin não são reconfigurados.
    const comum = await novaConta();
    expect(
      await p.casos.reconfigurarSegundoFator.executar({
        conta: { email: comum.email },
        operadorId: operador.id,
      }),
    ).toEqual({ tipo: 'nao_e_admin' });
    expect(
      await p.casos.reconfigurarSegundoFator.executar({
        conta: { email: emailUnico() },
        operadorId: operador.id,
      }),
    ).toEqual({ tipo: 'conta_nao_encontrada' });
    expect(
      await p.casos.reconfigurarSegundoFator.executar({
        conta: { contaId: admin.conta.id },
        operadorId: comum.id,
      }),
    ).toEqual({ tipo: 'operador_invalido' });
    expect(
      await p.casos.reconfigurarSegundoFator.executar({
        conta: { contaId: admin.conta.id },
        operadorId: operador.id,
      }),
    ).toMatchObject({ tipo: 'reconfigurado', contaId: admin.conta.id });
  });
});

describe('privacidade (CA-10)', () => {
  it('a consulta traz as versões vigentes, a data do aceite e, depois de gerada, o prazo da exportação', async () => {
    const conta = await novaConta();
    expect(await p.casos.consultarPrivacidade.executar({ contaId: conta.id })).toEqual({
      politica: { versao: docs.privacidade.versao, conteudo: 'Texto de privacidade do teste' },
      termos: { versao: docs.termos.versao },
      aceitoEm: T0.toISOString(),
      exportacaoDisponivelAte: null,
    });

    await p.casos.solicitarExportacao.executar({ contaId: conta.id });
    const solicitacaoId = await idDaSolicitacao(conta.id, 'exportacao');
    const gerada = await p.casos.gerarExportacao.executar({ contaId: conta.id, solicitacaoId });
    expect(gerada).toEqual({ tipo: 'gerada', expiraEm: new Date(T0.getTime() + 7 * UM_DIA) });
    expect(
      (await p.casos.consultarPrivacidade.executar({ contaId: conta.id })).exportacaoDisponivelAte,
    ).toBe(new Date(T0.getTime() + 7 * UM_DIA).toISOString());
  });

  it('exportação: 1 por 24 h, arquivo cifrado no banco, conteúdo só da própria conta e sem segredos, uso único e vencimento em 7 dias', async () => {
    const conta = await novaConta();
    const outra = await novaConta({ nome: 'Beatriz Lima' });
    expect(await p.casos.solicitarExportacao.executar({ contaId: conta.id })).toEqual({
      tipo: 'solicitada',
    });
    p.relogio.avancar(24 * 60 * UM_MINUTO - 1_000);
    expect(await p.casos.solicitarExportacao.executar({ contaId: conta.id })).toEqual({
      tipo: 'ja_solicitada',
      proximaEm: new Date(T0.getTime() + UM_DIA),
    });
    p.relogio.definir(T0);
    const solicitacaoId = await idDaSolicitacao(conta.id, 'exportacao');
    await p.casos.gerarExportacao.executar({ contaId: conta.id, solicitacaoId });

    const guardada = await dono.query<{ conteudo_cifrado: string }>(
      'SELECT conteudo_cifrado FROM identidade.exportacoes_titular WHERE conta_id = $1::uuid',
      [conta.id],
    );
    const cifrado = guardada.rows[0]?.conteudo_cifrado ?? '';
    expect(cifrado).toMatch(/^v1\./);
    expect(cifrado).not.toContain(conta.email);
    expect(cifrado).not.toContain(NOME_PADRAO);

    // A conta de outra pessoa não baixa o arquivo desta, e a data de vencimento é exclusiva.
    expect(await p.casos.baixarExportacao.executar({ contaId: outra.id })).toEqual({
      tipo: 'indisponivel',
    });
    p.relogio.avancar(7 * UM_DIA);
    expect(await p.casos.baixarExportacao.executar({ contaId: conta.id })).toEqual({
      tipo: 'indisponivel',
    });
    p.relogio.definir(new Date(T0.getTime() + 7 * UM_DIA - 1));
    const baixada = await p.casos.baixarExportacao.executar({ contaId: conta.id });
    if (baixada.tipo !== 'disponivel') throw new Error('exportação devia estar disponível');
    const arquivo = JSON.parse(baixada.json) as Record<string, unknown>;
    expect(arquivo).toMatchObject({
      formato: 'bairrin.exportacao-do-titular',
      versao: 1,
      identidade: {
        conta: {
          id: conta.id,
          nome: NOME_PADRAO,
          email: conta.email,
          telefone: TELEFONE_PADRAO,
          status: 'ativa',
        },
        perfis: [{ perfil: 'consumidor' }],
        segundoFator: { configurado: false, confirmadoEm: null },
      },
    });
    expect(baixada.json).not.toMatch(/argon2|senha|segredo|token|hmac/i);
    expect(baixada.json).not.toContain(outra.id);
    expect(baixada.json).not.toContain('Beatriz');
    const aceites = (arquivo['identidade'] as { aceites: { documento: string; versao: string }[] })
      .aceites;
    expect(aceites.map((a) => `${a.documento}:${a.versao}`).sort()).toEqual(
      [`termos:${docs.termos.versao}`, `privacidade:${docs.privacidade.versao}`].sort(),
    );
    // Uso único.
    expect(await p.casos.baixarExportacao.executar({ contaId: conta.id })).toEqual({
      tipo: 'indisponivel',
    });
  });

  async function idDaSolicitacao(contaId: string, tipo: string): Promise<string> {
    const { rows } = await dono.query<{ id: string }>(
      'SELECT id::text FROM identidade.solicitacoes_titular WHERE conta_id = $1::uuid AND tipo = $2::identidade.tipo_de_solicitacao ORDER BY solicitada_em DESC LIMIT 1',
      [contaId, tipo],
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('solicitação não encontrada');
    return id;
  }
});

describe('exclusão e anonimização (CA-11, CA-12)', () => {
  it('senha errada não desativa; pendência adia sem tocar na conta; sem pendência desativa na hora, revoga as sessões e reaproveita a solicitação', async () => {
    const conta = await novaConta();
    const sessao = await loginNoApp(conta);
    expect(
      await p.casos.solicitarExclusao.executar({ contaId: conta.id, senha: OUTRA_SENHA }),
    ).toEqual({
      tipo: 'senha_incorreta',
    });
    expect((await linhaDaConta(conta.id)).status).toBe('ativa');

    p.servicos.pendencias.definir(conta.id, [{ modulo: 'pedidos', tipo: 'pedido_em_andamento' }]);
    const adiada = await p.casos.solicitarExclusao.executar({
      contaId: conta.id,
      senha: conta.senha,
    });
    expect(adiada).toEqual({
      tipo: 'com_pendencias',
      pendencias: [{ modulo: 'pedidos', tipo: 'pedido_em_andamento' }],
    });
    await p.casos.solicitarExclusao.executar({ contaId: conta.id, senha: conta.senha });
    expect((await linhaDaConta(conta.id)).status).toBe('ativa');
    expect(await sessoesVivas(dono, conta.id)).toBe(1);
    expect(await solicitacoes(conta.id)).toEqual([
      { tipo: 'exclusao', status: 'aguardando_pendencias' },
    ]);

    p.servicos.pendencias.definir(conta.id, []);
    p.relogio.avancar(UM_DIA);
    expect(
      await p.casos.solicitarExclusao.executar({ contaId: conta.id, senha: conta.senha }),
    ).toEqual({
      tipo: 'desativada',
    });
    const linha = await linhaDaConta(conta.id);
    expect(linha).toMatchObject({ status: 'desativada', desativada_em: p.relogio.agora() });
    expect(await sessoesVivas(dono, conta.id)).toBe(0);
    expect(await solicitacoes(conta.id)).toEqual([{ tipo: 'exclusao', status: 'pendente' }]);
    expect(
      await p.casos.renovar.executar({
        tokenRenovacao: sessao.tokenRenovacao,
        cliente: 'app_consumidor',
      }),
    ).toEqual({ tipo: 'invalida' });
    expect(await entrarNoApp(conta, conta.senha)).toEqual({ tipo: 'credenciais_invalidas' });
    expect(await eventosDaConta(dono, conta.id)).toContainEqual({
      tipo: 'identidade.ContaDesativada',
      payload: { contaId: conta.id },
    });
  });

  it('consulta de pendências que falha desfaz tudo: a conta continua ativa, e a senha certa já zerou o freio só se a transação confirmou', async () => {
    const conta = await novaConta();
    p.servicos.pendencias.falharNaProxima();
    await expect(
      p.casos.solicitarExclusao.executar({ contaId: conta.id, senha: conta.senha }),
    ).rejects.toThrow('Falha simulada');
    expect((await linhaDaConta(conta.id)).status).toBe('ativa');
    expect(await solicitacoes(conta.id)).toEqual([]);
    expect(await sessoesDaConta(dono, conta.id)).toEqual([]);
  });

  it('anonimiza: apaga nome, e-mail, telefone, senha, sessões, códigos e exportações; preserva perfis, aceites e a solicitação; libera o e-mail', async () => {
    const conta = await novaConta();
    await loginNoApp(conta);
    await inserirCodigo(p, conta.id, 'verificacao_email', '010203');
    await p.casos.solicitarExportacao.executar({ contaId: conta.id });
    await p.casos.gerarExportacao.executar({
      contaId: conta.id,
      solicitacaoId: await idDaSolicitacaoDeExportacao(conta.id),
    });
    await p.casos.solicitarExclusao.executar({ contaId: conta.id, senha: conta.senha });
    const desativada = await linhaDaConta(conta.id);

    expect(await p.casos.anonimizarConta.executar({ contaId: conta.id })).toEqual({
      tipo: 'anonimizada',
    });
    const linha = await linhaDaConta(conta.id);
    expect(linha).toMatchObject({
      status: 'anonimizada',
      telefone_e164: null,
      senha_hash: null,
      desativada_em: desativada.desativada_em,
      anonimizada_em: T0,
    });
    for (const dado of [NOME_PADRAO, conta.email, TELEFONE_PADRAO, 'Júlia', 'Souza']) {
      expect(JSON.stringify(linha)).not.toContain(dado);
    }
    expect(linha.email_normalizado).not.toBe(conta.email);

    const contagem = async (tabela: string) =>
      (
        await dono.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM identidade.${tabela} WHERE conta_id = $1::uuid`,
          [conta.id],
        )
      ).rows[0]?.n;
    expect(await contagem('sessoes')).toBe(0);
    expect(await contagem('codigos_verificacao')).toBe(0);
    expect(await contagem('exportacoes_titular')).toBe(0);
    expect(await contagem('segundo_fator')).toBe(0);
    expect(await contagem('consentimentos')).toBe(2);
    expect(await contagem('perfis_conta')).toBe(1);
    expect(await solicitacoes(conta.id)).toEqual([
      { tipo: 'exclusao', status: 'concluida' },
      { tipo: 'exportacao', status: 'concluida' },
    ]);
    const concluida = await dono.query<{ concluida_em: Date | null }>(
      "SELECT concluida_em FROM identidade.solicitacoes_titular WHERE conta_id = $1::uuid AND tipo = 'exclusao'",
      [conta.id],
    );
    expect(concluida.rows[0]?.concluida_em).toEqual(T0);
    expect(await eventosDaConta(dono, conta.id)).toContainEqual({
      tipo: 'identidade.ContaAnonimizada',
      payload: { contaId: conta.id },
    });

    // Idempotente, e conta ativa nunca é anonimizada por aqui.
    expect(await p.casos.anonimizarConta.executar({ contaId: conta.id })).toEqual({
      tipo: 'ja_anonimizada',
    });
    const ativa = await novaConta();
    expect(await p.casos.anonimizarConta.executar({ contaId: ativa.id })).toEqual({
      tipo: 'conta_ativa',
    });
    expect(
      await p.casos.anonimizarConta.executar({ contaId: '00000000-0000-4000-8000-000000000001' }),
    ).toEqual({
      tipo: 'inexistente',
    });

    // O e-mail volta a estar livre para um cadastro novo, com outra conta.
    const nova = await cadastrar(p, docs, { email: conta.email });
    contasDoTeste.push(nova.id);
    expect(nova.id).not.toBe(conta.id);
    expect((await eventosDaConta(dono, nova.id)).map((e) => e.tipo)).toEqual([
      'identidade.ContaCriada',
    ]);
  });

  async function idDaSolicitacaoDeExportacao(contaId: string): Promise<string> {
    const { rows } = await dono.query<{ id: string }>(
      "SELECT id::text FROM identidade.solicitacoes_titular WHERE conta_id = $1::uuid AND tipo = 'exportacao'",
      [contaId],
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('solicitação não encontrada');
    return id;
  }

  async function solicitacoes(contaId: string) {
    const { rows } = await dono.query<{ tipo: string; status: string }>(
      'SELECT tipo::text, status::text FROM identidade.solicitacoes_titular WHERE conta_id = $1::uuid ORDER BY tipo',
      [contaId],
    );
    return rows;
  }

  it('anonimizador de outro módulo que falha desfaz tudo, e o erro não carrega e-mail, nome nem telefone', async () => {
    const conta = await novaConta();
    await p.casos.solicitarExclusao.executar({ contaId: conta.id, senha: conta.senha });
    const registro = new RegistroDeAnonimizadores();
    registro.registrar(
      new AnonimizadorDeIdentidade(
        p.repos.contas,
        p.repos.sessoes,
        p.repos.codigos,
        p.repos.segundoFator,
        p.repos.exportacoes,
        p.relogio,
      ),
    );
    registro.registrar({
      modulo: 'pedidos',
      anonimizar: () =>
        Promise.reject(new Error(`falhou para ${conta.email} ${NOME_PADRAO} ${TELEFONE_PADRAO}`)),
    });
    const anonimizar = new AnonimizarContaCasoDeUso(
      p.unidade,
      p.repos.contas,
      p.repos.solicitacoes,
      registro,
      // O publicador não é usado: a falha vem antes.
      { publicar: () => Promise.resolve() },
      p.relogio,
    );

    const erro = await anonimizar.executar({ contaId: conta.id }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(erro).toBeInstanceOf(FalhaNaAnonimizacao);
    const texto = `${(erro as Error).message}\n${(erro as Error).stack ?? ''}`;
    for (const dado of [conta.email, NOME_PADRAO, TELEFONE_PADRAO, 'Júlia']) {
      expect(texto).not.toContain(dado);
    }
    const linha = await linhaDaConta(conta.id);
    expect(linha).toMatchObject({
      status: 'desativada',
      nome: NOME_PADRAO,
      email_normalizado: conta.email,
    });
    expect(linha.senha_hash).not.toBeNull();
  });
});

describe('dado pessoal fora dos eventos, da auditoria e dos erros (CA-12)', () => {
  it('depois de todo o ciclo, nenhum evento da outbox traz nome, e-mail, telefone, senha, código ou token', async () => {
    const conta = await novaConta();
    const sessao = await loginNoApp(conta);
    await inserirCodigo(p, conta.id, 'verificacao_email', '674512');
    const verificada = await p.casos.verificarEmail.executar({
      contaId: conta.id,
      sid: sessao.sid,
      codigo: '674512',
    });
    await p.casos.reenviarVerificacao.executar({ contaId: conta.id });
    await p.casos.solicitarRecuperacao.executar({ email: conta.email });
    await inserirCodigo(p, conta.id, 'recuperacao_senha', '903456');
    await p.casos.redefinirSenha.executar({
      email: conta.email,
      codigo: '903456',
      novaSenha: OUTRA_SENHA,
    });
    await p.casos.criarConta.executar({
      nome: 'Intruso Qualquer',
      email: conta.email,
      telefone: '+5511977776666',
      senha: 'trem-bala-verde-5521',
      aceites: ACEITES(),
    });
    await p.casos.solicitarExportacao.executar({ contaId: conta.id });
    await p.casos.solicitarExclusao.executar({ contaId: conta.id, senha: OUTRA_SENHA });
    await p.casos.anonimizarConta.executar({ contaId: conta.id });

    const { rows } = await dono.query<{ linha: string }>(
      'SELECT row_to_json(o)::text AS linha FROM compartilhado.outbox o WHERE agregado_id = $1::uuid',
      [conta.id],
    );
    expect(rows.map((r) => (JSON.parse(r.linha) as { tipo: string }).tipo).sort()).toEqual([
      'identidade.CadastroRepetidoTentado',
      'identidade.ContaAnonimizada',
      'identidade.ContaCriada',
      'identidade.ContaDesativada',
      'identidade.ExportacaoSolicitada',
      'identidade.RecuperacaoSolicitada',
      'identidade.SenhaRedefinida',
    ]);
    const tokens =
      verificada.tipo === 'verificado'
        ? [verificada.sessao.tokenRenovacao, verificada.sessao.tokenAcesso]
        : [];
    const proibidos = [
      conta.email,
      conta.email.split('@')[0] ?? '',
      NOME_PADRAO,
      'Júlia',
      TELEFONE_PADRAO,
      '35999991234',
      SENHA,
      OUTRA_SENHA,
      '674512',
      '903456',
      'Intruso',
      '977776666',
      sessao.tokenRenovacao,
      sessao.tokenAcesso,
      ...tokens,
    ];
    for (const { linha } of rows) {
      for (const dado of proibidos) expect(linha).not.toContain(dado);
      const evento = JSON.parse(linha) as { payload: Record<string, unknown> };
      expect(Object.keys(evento.payload).sort()).toEqual(
        Object.keys(evento.payload).includes('solicitacaoId')
          ? ['contaId', 'solicitacaoId']
          : ['contaId'],
      );
    }
  });

  it('entradas com dado pessoal que o domínio recusa lançam erro sem repetir o valor', async () => {
    const intrusos = [
      { email: 'segredo@@exemplo.com', nome: NOME_PADRAO, telefone: TELEFONE_PADRAO },
      { email: emailUnico(), nome: 'Maria\u0000Segredinho', telefone: TELEFONE_PADRAO },
      { email: emailUnico(), nome: NOME_PADRAO, telefone: '+55 (35) 91111-2222 ligue-me' },
    ];
    for (const entrada of intrusos) {
      const erro = await p.casos.criarConta
        .executar({ ...entrada, senha: SENHA, aceites: ACEITES() })
        .then(
          () => null,
          (e: unknown) => e,
        );
      expect(erro).toBeInstanceOf(Error);
      const texto = `${(erro as Error).message}\n${(erro as Error).stack ?? ''}`;
      for (const dado of ['segredo@', 'Segredinho', 'ligue-me', '91111-2222', SENHA]) {
        expect(texto).not.toContain(dado);
      }
    }
    for (const lixo of ['segredo@@exemplo.com', ' ']) {
      const erro = await p.casos.entrar
        .executar({ email: lixo, senha: SENHA, cliente: 'app_consumidor', ip: ipNovo() })
        .then(
          () => null,
          (e: unknown) => e,
        );
      expect(erro).toBeInstanceOf(Error);
      expect(`${(erro as Error).message}${(erro as Error).stack ?? ''}`).not.toContain('segredo@');
    }
  });
});
