// Assinantes da Identidade de ponta a ponta (01b, etapa 13; CA-01, CA-02, CA-06, CA-07,
// CA-10; P4, S10, S15, S73, S92, S93): o evento sai da outbox de verdade, é entregue pelo
// `EntregadorDeEventos` (deduplicação em `eventos_processados`) e o e-mail chega ao Mailpit do
// `infra/docker-compose.yml` pelo SMTP real, com os modelos reais. O código que chega no
// e-mail serve no caso de uso (verificação, redefinição); o nome com HTML sai escapado no HTML
// e igual no texto puro.
//
// Cada teste usa e-mails únicos e apaga só as mensagens deles (a caixa do Mailpit é a mesma do
// desenvolvimento).
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { PinoLogger } from 'nestjs-pino';
import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  type Assinante,
  EntregadorDeEventos,
  type EventoPublicado,
} from '../../../src/compartilhado/eventos/assinantes.ts';
import { PublicadorDeEventosNaOutbox } from '../../../src/compartilhado/infra/publicador-na-outbox.ts';
import { RepositorioDeAuditoriaPrisma } from '../../../src/compartilhado/infra/repositorio-de-auditoria-prisma.ts';
import { EnviadorDeEmailSmtp } from '../../../src/compartilhado/infra/smtp.adaptador.ts';
import {
  AvisarCadastroRepetidoAssinante,
  chaveDoAvisoDeCadastroRepetido,
} from '../../../src/modulos/identidade/aplicacao/assinantes/avisar-cadastro-repetido.assinante.ts';
import { AvisarSegundoFatorFreadoAssinante } from '../../../src/modulos/identidade/aplicacao/assinantes/avisar-segundo-fator-freado.assinante.ts';
import { TETO_DE_CODIGOS_POR_DIA } from '../../../src/modulos/identidade/aplicacao/assinantes/comum.ts';
import { EnviarCodigoDeRecuperacaoAssinante } from '../../../src/modulos/identidade/aplicacao/assinantes/enviar-codigo-de-recuperacao.assinante.ts';
import { EnviarCodigoDeVerificacaoAssinante } from '../../../src/modulos/identidade/aplicacao/assinantes/enviar-codigo-de-verificacao.assinante.ts';
import { GerarExportacaoAssinante } from '../../../src/modulos/identidade/aplicacao/assinantes/gerar-exportacao.assinante.ts';
import { CriarAdminCasoDeUso } from '../../../src/modulos/identidade/aplicacao/cadastro/criar-admin.caso-de-uso.ts';
import { chaveDoFreioPorOrigem } from '../../../src/modulos/identidade/aplicacao/sessao/comum.ts';
import { chaveDoFreioDeSegundoFator } from '../../../src/modulos/identidade/aplicacao/segundo-fator/comum.ts';
import { Email } from '../../../src/modulos/identidade/dominio/email.ts';
import {
  ASSUNTOS,
  ModelosDeEmailDaIdentidadeEmHtml,
} from '../../../src/modulos/identidade/infra/email/modelos/modelos-de-email-da-identidade.ts';
import {
  apagarContasDoTeste,
  cadastrar,
  conectarDono,
  type ContaDeTeste,
  type DocumentosDeTeste,
  emailUnico,
  montarPilha,
  OUTRA_SENHA,
  operadorAdmin,
  prepararAdmin,
  semearDocumentos,
  T0,
  UM_MINUTO,
} from './pilha-de-casos-de-uso.ts';

const SMTP_TESTE = process.env['SMTP_URL_TESTE'] ?? 'smtp://127.0.0.1:1025';
const API_DO_MAILPIT = process.env['MAILPIT_API_TESTE'] ?? 'http://127.0.0.1:8025';
const PASTA_DA_API = fileURLToPath(new URL('../../../', import.meta.url));

const NOME_COM_TAG = '<img src=x onerror=alert(1)>';
const NOME_COM_E_COMERCIAL = 'Zé & Cia';

function loggerSilencioso(): PinoLogger {
  const nada = () => undefined;
  return { setContext: nada, info: nada, warn: nada, error: nada } as unknown as PinoLogger;
}

const p = montarPilha();
const enviador = new EnviadorDeEmailSmtp({
  SMTP_URL: SMTP_TESTE,
  EMAIL_REMETENTE: 'nao-responda@bairrin.com.br',
  NODE_ENV: 'test',
});
const modelos = new ModelosDeEmailDaIdentidadeEmHtml();
const entregador = new EntregadorDeEventos(p.unidade, p.relogio, loggerSilencioso());
const publicador = new PublicadorDeEventosNaOutbox(p.unidade, p.relogio);
const { contas, codigos, bloqueios } = p.repos;
const { cifrador, gerador } = p.servicos;
const assinantes = {
  verificacao: new EnviarCodigoDeVerificacaoAssinante(
    p.unidade,
    p.relogio,
    contas,
    codigos,
    cifrador,
    gerador,
    modelos,
    enviador,
  ),
  recuperacao: new EnviarCodigoDeRecuperacaoAssinante(
    p.unidade,
    p.relogio,
    contas,
    codigos,
    cifrador,
    gerador,
    modelos,
    enviador,
  ),
  cadastroRepetido: new AvisarCadastroRepetidoAssinante(
    p.unidade,
    p.relogio,
    contas,
    bloqueios,
    cifrador,
    modelos,
    enviador,
  ),
  exportacao: new GerarExportacaoAssinante(
    p.unidade,
    contas,
    p.casos.gerarExportacao,
    modelos,
    enviador,
  ),
  segundoFator: new AvisarSegundoFatorFreadoAssinante(p.unidade, contas, modelos, enviador),
};
const criarAdmin = new CriarAdminCasoDeUso(
  p.unidade,
  p.relogio,
  contas,
  new RepositorioDeAuditoriaPrisma(p.unidade, p.relogio),
  publicador,
  gerador,
);

let dono: pg.Client;
let docs: DocumentosDeTeste;
const contasDoTeste: string[] = [];
const freiosDoTeste: string[] = [];
const caixasDoTeste: string[] = [];

beforeAll(async () => {
  dono = await conectarDono();
  docs = await semearDocumentos(dono);
});

afterEach(async () => {
  for (const caixa of caixasDoTeste.splice(0)) {
    await fetch(`${API_DO_MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${caixa}"`)}`, {
      method: 'DELETE',
    });
  }
});

afterAll(async () => {
  await dono.query(
    `DELETE FROM compartilhado.eventos_processados WHERE evento_id IN
       (SELECT id FROM compartilhado.outbox WHERE agregado_id = ANY($1::uuid[]))`,
    [contasDoTeste],
  );
  await apagarContasDoTeste(dono, contasDoTeste, freiosDoTeste);
  await dono
    .query(
      "DELETE FROM compartilhado.auditoria WHERE acao = 'admin_criado' AND recurso_id = ANY($1::text[])",
      [contasDoTeste],
    )
    .catch(() => undefined);
  await docs.remover();
  await dono.end();
  enviador.onModuleDestroy();
  await p.prisma.$disconnect();
});

beforeEach(() => {
  p.relogio.definir(T0);
});

// ---------------------------------------------------------------------------
// Ajudas

interface MensagemDoMailpit {
  ID: string;
  To: { Address: string }[];
  Subject: string;
  Text: string;
  HTML: string;
  Attachments: unknown[];
}

/** As mensagens para o endereço, da mais antiga para a mais nova. */
async function mensagensPara(endereco: string, esperadas = 0): Promise<MensagemDoMailpit[]> {
  const limite = Date.now() + 3_000;
  for (;;) {
    const busca = await fetch(
      `${API_DO_MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${endereco}"`)}`,
    );
    expect(busca.ok).toBe(true);
    const { messages } = (await busca.json()) as { messages: { ID: string }[] };
    if (messages.length >= esperadas || Date.now() > limite) {
      const lidas = await Promise.all(
        messages.map(async ({ ID }) => {
          const resposta = await fetch(`${API_DO_MAILPIT}/api/v1/message/${ID}`);
          return (await resposta.json()) as MensagemDoMailpit;
        }),
      );
      return lidas.reverse();
    }
    await new Promise((resolver) => setTimeout(resolver, 50));
  }
}

/** O código de 6 dígitos que veio no texto puro do e-mail. */
function codigoDoEmail(mensagem: MensagemDoMailpit | undefined): string {
  const achado = /\b(\d{6})\b/.exec(mensagem?.Text ?? '');
  if (achado?.[1] === undefined) throw new Error('o e-mail não trouxe código');
  return achado[1];
}

/** O evento mais recente do tipo para a conta, lido da outbox como o relay o entrega. */
async function eventoDaOutbox(contaId: string, tipo: string): Promise<EventoPublicado> {
  const { rows } = await dono.query<{
    id: string;
    tipo: string;
    versao: number;
    agregado_id: string;
    payload: EventoPublicado['payload'];
    ocorrido_em: Date;
  }>(
    `SELECT id::text, tipo, versao, agregado_id::text, payload, ocorrido_em
       FROM compartilhado.outbox WHERE agregado_id = $1::uuid AND tipo = $2
      ORDER BY ocorrido_em DESC, id DESC LIMIT 1`,
    [contaId, tipo],
  );
  const linha = rows[0];
  if (linha === undefined) throw new Error(`sem ${tipo} na outbox`);
  return {
    id: linha.id,
    tipo: linha.tipo,
    versao: linha.versao,
    agregadoId: linha.agregado_id,
    payload: linha.payload,
    ocorridoEm: linha.ocorrido_em.toISOString(),
  };
}

async function entregar(assinante: Assinante, contaId: string, tipo: string) {
  return entregador.entregar(assinante, await eventoDaOutbox(contaId, tipo));
}

let proximoIp = 10;
function ipNovo(): string {
  proximoIp += 1;
  const ip = `192.0.2.${proximoIp % 250}`;
  freiosDoTeste.push(chaveDoFreioPorOrigem(cifrador, ip));
  return ip;
}

async function novaConta(opcoes: { nome?: string } = {}): Promise<ContaDeTeste> {
  const email = emailUnico('assinante');
  caixasDoTeste.push(email);
  const conta = await cadastrar(p, docs, { ...opcoes, email });
  contasDoTeste.push(conta.id);
  freiosDoTeste.push(cifrador.hmac('bloqueio_email', [email]));
  freiosDoTeste.push(chaveDoAvisoDeCadastroRepetido(cifrador, Email.criar(email)));
  return conta;
}

// ---------------------------------------------------------------------------

describe('código de verificação (CA-01, S73)', () => {
  it('ContaCriada: o código chega ao e-mail normalizado, sem o nome (S102), e o código verifica', async () => {
    const conta = await novaConta({ nome: NOME_COM_TAG });

    expect(await entregar(assinantes.verificacao, conta.id, 'identidade.ContaCriada')).toBe(
      'tratado',
    );

    const [mensagem] = await mensagensPara(conta.email, 1);
    expect(mensagem?.To.map((d) => d.Address)).toEqual([conta.email]);
    expect(mensagem?.Subject).toBe(ASSUNTOS.codigoDeVerificacao);
    expect(mensagem?.Text.startsWith('Olá!')).toBe(true);
    expect(mensagem?.Text).not.toContain(NOME_COM_TAG);
    expect(mensagem?.HTML).not.toContain('onerror');
    expect(mensagem?.HTML).not.toMatch(/<img/i);
    expect(mensagem?.Attachments).toEqual([]);

    const login = await p.casos.entrar.executar({
      email: conta.email,
      senha: conta.senha,
      cliente: 'app_consumidor',
      ip: ipNovo(),
    });
    if (login.tipo !== 'sessao') throw new Error(`login devolveu ${login.tipo}`);
    const claims = await p.servicos.emissor.verificar(login.sessao.tokenAcesso, T0);
    if (claims === null) throw new Error('token recusado');
    await expect(
      p.casos.verificarEmail.executar({
        contaId: conta.id,
        sid: claims.sid,
        codigo: codigoDoEmail(mensagem),
      }),
    ).resolves.toMatchObject({ tipo: 'verificado' });
  });

  it('a mesma entrega duas vezes não manda dois e-mails (eventos_processados)', async () => {
    const conta = await novaConta();
    const evento = await eventoDaOutbox(conta.id, 'identidade.ContaCriada');

    expect(await entregador.entregar(assinantes.verificacao, evento)).toBe('tratado');
    expect(await entregador.entregar(assinantes.verificacao, evento)).toBe('repetido');

    expect(await mensagensPara(conta.email, 2)).toHaveLength(1);
  });

  it('o reenvio invalida o código anterior no banco: só o último verifica', async () => {
    const conta = await novaConta();
    await entregar(assinantes.verificacao, conta.id, 'identidade.ContaCriada');
    p.relogio.avancar(UM_MINUTO);
    await p.casos.reenviarVerificacao.executar({ contaId: conta.id });
    await entregar(assinantes.verificacao, conta.id, 'identidade.VerificacaoReenviada');

    const [primeiro, segundo] = await mensagensPara(conta.email, 2);
    const { rows } = await dono.query<{ usado: boolean }>(
      `SELECT usado_em IS NOT NULL AS usado FROM identidade.codigos_verificacao
        WHERE conta_id = $1::uuid AND finalidade = 'verificacao_email' ORDER BY criado_em`,
      [conta.id],
    );
    expect(rows.map((r) => r.usado)).toEqual([true, false]);
    expect(codigoDoEmail(primeiro)).not.toBe(codigoDoEmail(segundo));
  });

  it(`o ${TETO_DE_CODIGOS_POR_DIA + 1}º código do dia não sai (S93), e o último continua valendo`, async () => {
    const conta = await novaConta();
    for (let envio = 0; envio < TETO_DE_CODIGOS_POR_DIA; envio += 1) {
      p.relogio.avancar(UM_MINUTO);
      await p.casos.reenviarVerificacao.executar({ contaId: conta.id });
      await entregar(assinantes.verificacao, conta.id, 'identidade.VerificacaoReenviada');
    }
    p.relogio.avancar(UM_MINUTO);
    await p.casos.reenviarVerificacao.executar({ contaId: conta.id });
    expect(
      await entregar(assinantes.verificacao, conta.id, 'identidade.VerificacaoReenviada'),
    ).toBe('tratado');

    expect(await mensagensPara(conta.email, TETO_DE_CODIGOS_POR_DIA + 1)).toHaveLength(
      TETO_DE_CODIGOS_POR_DIA,
    );
    const { rows } = await dono.query<{ total: number; vivos: number }>(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE usado_em IS NULL)::int AS vivos
         FROM identidade.codigos_verificacao
        WHERE conta_id = $1::uuid AND finalidade = 'verificacao_email'`,
      [conta.id],
    );
    expect(rows[0]).toEqual({ total: TETO_DE_CODIGOS_POR_DIA, vivos: 1 });
  });
});

describe('aviso de cadastro repetido (CA-02, P1-dono, S15)', () => {
  it('avisa o dono do e-mail não verificado, com as opções de entrar ou recuperar, uma vez por hora', async () => {
    const conta = await novaConta({ nome: NOME_COM_E_COMERCIAL });
    const repetir = () =>
      p.casos.criarConta.executar({
        nome: 'Quem Tentou',
        email: conta.email,
        telefone: '(35) 98888-0000',
        senha: OUTRA_SENHA,
        aceites: { termos: docs.termos.versao, privacidade: docs.privacidade.versao },
      });

    await repetir();
    await entregar(assinantes.cadastroRepetido, conta.id, 'identidade.CadastroRepetidoTentado');
    p.relogio.avancar(59 * UM_MINUTO);
    await repetir();
    await entregar(assinantes.cadastroRepetido, conta.id, 'identidade.CadastroRepetidoTentado');

    const mensagens = await mensagensPara(conta.email, 2);
    expect(mensagens).toHaveLength(1);
    const [aviso] = mensagens;
    expect(aviso?.Subject).toBe(ASSUNTOS.cadastroRepetido);
    expect(aviso?.Subject).not.toContain('Zé');
    // E-mail não verificado: a saudação vai sem o nome (S102).
    expect(aviso?.Text.startsWith('Olá!')).toBe(true);
    expect(`${aviso?.Text}${aviso?.HTML}`).not.toMatch(/Zé/);
    expect(aviso?.Text).toContain('Esqueci minha senha');
    // Nada do cadastro de quem tentou (nome, telefone) vai no aviso (S10).
    expect(`${aviso?.Text}${aviso?.HTML}`).not.toMatch(/Quem Tentou|98888/);

    p.relogio.avancar(UM_MINUTO);
    await repetir();
    await entregar(assinantes.cadastroRepetido, conta.id, 'identidade.CadastroRepetidoTentado');
    expect(await mensagensPara(conta.email, 2)).toHaveLength(2);
  });
});

describe('nome só para e-mail verificado (S102)', () => {
  it('antes da verificação, nenhum e-mail leva o nome escolhido no cadastro; depois, a saudação o usa', async () => {
    const isca = 'Acesse exemplo.com';
    const conta = await novaConta({ nome: isca });
    await entregar(assinantes.verificacao, conta.id, 'identidade.ContaCriada');
    await p.casos.criarConta.executar({
      nome: 'Quem Tentou',
      email: conta.email,
      telefone: '(35) 98888-0001',
      senha: OUTRA_SENHA,
      aceites: { termos: docs.termos.versao, privacidade: docs.privacidade.versao },
    });
    await entregar(assinantes.cadastroRepetido, conta.id, 'identidade.CadastroRepetidoTentado');
    await p.casos.solicitarRecuperacao.executar({ email: conta.email });
    await entregar(assinantes.recuperacao, conta.id, 'identidade.RecuperacaoSolicitada');

    const antes = await mensagensPara(conta.email, 3);
    expect(antes.map((m) => m.Subject).sort()).toEqual(
      [
        ASSUNTOS.cadastroRepetido,
        ASSUNTOS.codigoDeRecuperacao,
        ASSUNTOS.codigoDeVerificacao,
      ].sort(),
    );
    for (const mensagem of antes) {
      expect(mensagem.Text, mensagem.Subject).not.toContain(isca);
      expect(mensagem.HTML, mensagem.Subject).not.toContain(isca);
      expect(mensagem.Text.startsWith('Olá!'), mensagem.Subject).toBe(true);
    }

    // A redefinição pelo código do e-mail verifica o e-mail (P1-dono).
    const recuperacao = antes.find((m) => m.Subject === ASSUNTOS.codigoDeRecuperacao);
    await expect(
      p.casos.redefinirSenha.executar({
        email: conta.email,
        codigo: codigoDoEmail(recuperacao),
        novaSenha: OUTRA_SENHA,
        ip: ipNovo(),
      }),
    ).resolves.toEqual({ tipo: 'redefinida' });
    p.relogio.avancar(UM_MINUTO);
    await p.casos.solicitarRecuperacao.executar({ email: conta.email });
    await entregar(assinantes.recuperacao, conta.id, 'identidade.RecuperacaoSolicitada');

    const depois = await mensagensPara(conta.email, 4);
    expect(depois).toHaveLength(4);
    const novas = depois.filter((m) => !antes.some((a) => a.ID === m.ID));
    expect(novas).toHaveLength(1);
    expect(novas[0]?.Text).toContain(`Olá, ${isca}.`);
    expect(novas[0]?.HTML).toContain(`Olá, ${isca}.`);
  });
});

describe('código de recuperação (CA-06)', () => {
  it('o código do e-mail redefine a senha, uma vez só', async () => {
    const conta = await novaConta();
    await p.casos.solicitarRecuperacao.executar({ email: conta.email });

    await entregar(assinantes.recuperacao, conta.id, 'identidade.RecuperacaoSolicitada');

    const [mensagem] = await mensagensPara(conta.email, 1);
    expect(mensagem?.Subject).toBe(ASSUNTOS.codigoDeRecuperacao);
    const codigo = codigoDoEmail(mensagem);
    const redefinir = () =>
      p.casos.redefinirSenha.executar({
        email: conta.email,
        codigo,
        novaSenha: OUTRA_SENHA,
        ip: ipNovo(),
      });
    await expect(redefinir()).resolves.toEqual({ tipo: 'redefinida' });
    await expect(redefinir()).resolves.toEqual({ tipo: 'codigo_invalido' });
  });
});

describe('seed:admin (CA-07)', () => {
  it('cria o admin sem senha; ele não entra antes da redefinição; o código do e-mail define a senha e o painel pede o 2FA', async () => {
    const email = emailUnico('admin');
    caixasDoTeste.push(email);
    freiosDoTeste.push(cifrador.hmac('bloqueio_email', [email]));
    const operador = await operadorAdmin(p, docs);
    contasDoTeste.push(operador.id);
    const criado = await criarAdmin.executar({
      nome: 'Admin do Teste',
      email,
      telefone: '(35) 97777-1234',
      operadorId: operador.id,
    });
    if (criado.tipo !== 'criado') throw new Error(`seed:admin devolveu ${criado.tipo}`);
    contasDoTeste.push(criado.contaId);
    const { rows } = await dono.query<{ senha_hash: string | null; perfis: string[] }>(
      `SELECT c.senha_hash, array_agg(p.perfil::text ORDER BY p.perfil::text) AS perfis
         FROM identidade.contas c JOIN identidade.perfis_conta p ON p.conta_id = c.id
        WHERE c.id = $1::uuid GROUP BY c.senha_hash`,
      [criado.contaId],
    );
    expect(rows[0]).toEqual({ senha_hash: null, perfis: ['admin', 'consumidor'] });
    await expect(
      p.casos.entrar.executar({ email, senha: OUTRA_SENHA, cliente: 'painel', ip: ipNovo() }),
    ).resolves.toEqual({ tipo: 'credenciais_invalidas' });

    await entregar(assinantes.recuperacao, criado.contaId, 'identidade.RecuperacaoSolicitada');
    const [mensagem] = await mensagensPara(email, 1);
    await expect(
      p.casos.redefinirSenha.executar({
        email,
        codigo: codigoDoEmail(mensagem),
        novaSenha: OUTRA_SENHA,
        ip: ipNovo(),
      }),
    ).resolves.toEqual({ tipo: 'redefinida' });

    await expect(
      p.casos.entrar.executar({ email, senha: OUTRA_SENHA, cliente: 'painel', ip: ipNovo() }),
    ).resolves.toMatchObject({ tipo: 'desafio', desafio: { etapa: 'configurar' } });
  });

  /** Roda a CLI com a entrada padrão dada, sem o ambiente (nada chega a conectar). */
  const rodarCli = (argumentos: string[], linhas: string[]) =>
    spawnSync(process.execPath, ['src/cli/seed-admin.ts', ...argumentos], {
      cwd: PASTA_DA_API,
      env: { PATH: process.env['PATH'] ?? '' },
      input: linhas.map((linha) => `${linha}\n`).join(''),
      encoding: 'utf8',
    });

  it('a CLI com telefone inválido encerra com erro sem criar nada', async () => {
    const email = emailUnico('admin-cli');
    const resultado = rodarCli([], [email, email, 'Admin da CLI', '(35) 3531-1234']);

    expect(resultado.status).toBe(1);
    expect(resultado.stderr).toContain('Telefone inválido: nada foi criado.');
    expect(resultado.stdout).toBe('');
    const { rows } = await dono.query(
      'SELECT 1 FROM identidade.contas WHERE email_normalizado = $1',
      [email],
    );
    expect(rows).toEqual([]);
  });

  it('a CLI com os dois e-mails diferentes encerra com erro sem citar nenhum (S106)', () => {
    const email = emailUnico('admin-cli');
    const resultado = rodarCli([], [email, `outro.${email}`, 'Admin da CLI', '(35) 99999-1234']);

    expect(resultado.status).toBe(1);
    expect(resultado.stderr).toContain('Os dois e-mails não são iguais: nada foi criado.');
    expect(`${resultado.stdout}${resultado.stderr}`).not.toContain(email);
  });

  it('a CLI recusa nome e telefone por argumento (S108)', () => {
    const resultado = rodarCli(['--nome', 'Admin da CLI', '--telefone', '(35) 99999-1234'], []);

    expect(resultado.status).toBe(1);
    expect(resultado.stderr).toContain('Uso:');
  });
});

describe('exportação pronta (CA-10, S10)', () => {
  it('gera a cópia, avisa sem anexo nem conteúdo, e a cópia sai pela tela de Privacidade', async () => {
    const conta = await novaConta();
    await p.casos.solicitarExportacao.executar({ contaId: conta.id });

    expect(await entregar(assinantes.exportacao, conta.id, 'identidade.ExportacaoSolicitada')).toBe(
      'tratado',
    );

    const [aviso] = await mensagensPara(conta.email, 1);
    expect(aviso?.Subject).toBe(ASSUNTOS.exportacaoPronta);
    expect(aviso?.Attachments).toEqual([]);
    expect(aviso?.Text).toContain('Privacidade');
    expect(`${aviso?.Text}${aviso?.HTML}`).not.toMatch(/TELEFONE|\+5535|bairrin\.exportacao/);
    await expect(p.casos.baixarExportacao.executar({ contaId: conta.id })).resolves.toMatchObject({
      tipo: 'disponivel',
    });
  });
});

describe('senha apagada pelo freio do segundo fator revoga as sessões (S104)', () => {
  it('a sessão do app aberta antes recebe invalida na renovação, e a auditoria registra só ids', async () => {
    const admin = await prepararAdmin(p, docs, ipNovo());
    contasDoTeste.push(admin.conta.id);
    caixasDoTeste.push(admin.conta.email);
    const chaveDoFreio = chaveDoFreioDeSegundoFator(cifrador, admin.conta.id);
    freiosDoTeste.push(cifrador.hmac('bloqueio_email', [admin.conta.email]), chaveDoFreio);
    const noApp = await p.casos.entrar.executar({
      email: admin.conta.email,
      senha: admin.conta.senha,
      cliente: 'app_consumidor',
      ip: ipNovo(),
    });
    if (noApp.tipo !== 'sessao') throw new Error(`login no app devolveu ${noApp.tipo}`);

    // O freio já no nível máximo, fora da espera e dentro da calma, com quatro falhas na janela.
    await dono.query(
      `INSERT INTO identidade.bloqueios_login (chave_hmac, tipo, falhas, nivel, janela_inicio, bloqueado_ate)
       VALUES ($1, 'segundo_fator', 4, 3, $2, $3)
       ON CONFLICT (chave_hmac, tipo) DO UPDATE
          SET falhas = 4, nivel = 3, janela_inicio = $2, bloqueado_ate = $3`,
      [chaveDoFreio, T0, new Date(T0.getTime() - UM_MINUTO)],
    );
    const login = await p.casos.entrar.executar({
      email: admin.conta.email,
      senha: admin.conta.senha,
      cliente: 'painel',
      ip: ipNovo(),
    });
    if (login.tipo !== 'desafio') throw new Error(`login no painel devolveu ${login.tipo}`);
    await p.casos.verificarSegundoFator.executar({
      desafio: login.desafio.desafio,
      codigo: '000000',
    });

    await expect(
      p.casos.renovar.executar({
        tokenRenovacao: noApp.sessao.tokenRenovacao,
        cliente: 'app_consumidor',
      }),
    ).resolves.toEqual({ tipo: 'invalida' });
    const sessoes = await dono.query<{ revogadas: number; vivas: number }>(
      `SELECT count(*) FILTER (WHERE motivo_revogacao = 'segundo_fator_freado')::int AS revogadas,
              count(*) FILTER (WHERE revogada_em IS NULL)::int AS vivas
         FROM identidade.sessoes WHERE conta_id = $1::uuid`,
      [admin.conta.id],
    );
    expect(sessoes.rows[0]?.vivas).toBe(0);
    expect(sessoes.rows[0]?.revogadas).toBeGreaterThanOrEqual(1);
    const { rows: auditoria } = await dono.query<{
      ator_tipo: string;
      ator_id: string | null;
      depois: unknown;
      origem: string;
    }>(
      `SELECT ator_tipo, ator_id, depois, origem FROM compartilhado.auditoria
        WHERE acao = 'senha_removida_pelo_freio' AND recurso_id = $1`,
      [admin.conta.id],
    );
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]).toMatchObject({ ator_tipo: 'sistema', ator_id: null, origem: 'painel' });
    expect(auditoria[0]?.depois).toMatchObject({ causa: 'nivel_maximo', senhaRemovida: true });
    expect(JSON.stringify(auditoria)).not.toContain(admin.conta.email);
  });
});

describe('freio do segundo fator (S92, P16)', () => {
  it('a espera avisa o dono; acionado de novo no nível máximo, a senha é apagada e o aviso manda recuperar', async () => {
    const admin = await prepararAdmin(p, docs, ipNovo());
    contasDoTeste.push(admin.conta.id);
    caixasDoTeste.push(admin.conta.email);
    const chaveDoFreio = chaveDoFreioDeSegundoFator(cifrador, admin.conta.id);
    freiosDoTeste.push(cifrador.hmac('bloqueio_email', [admin.conta.email]), chaveDoFreio);
    const entrarNoPainel = async () => {
      const login = await p.casos.entrar.executar({
        email: admin.conta.email,
        senha: admin.conta.senha,
        cliente: 'painel',
        ip: ipNovo(),
      });
      if (login.tipo !== 'desafio') throw new Error(`login devolveu ${login.tipo}`);
      return login.desafio.desafio;
    };

    // Primeira espera: cinco códigos errados.
    const desafio = await entrarNoPainel();
    for (let i = 0; i < 5; i += 1) {
      await p.casos.verificarSegundoFator.executar({ desafio, codigo: '000000' });
    }
    await entregar(assinantes.segundoFator, admin.conta.id, 'identidade.SegundoFatorFreado');
    const [espera] = await mensagensPara(admin.conta.email, 1);
    expect(espera?.Subject).toBe(ASSUNTOS.segundoFatorFreado);

    // Um minuto depois, o freio já no nível máximo, fora da espera e dentro da calma, com
    // quatro falhas na janela: a quinta o aciona de novo.
    p.relogio.avancar(UM_MINUTO);
    await dono.query(
      `UPDATE identidade.bloqueios_login
          SET nivel = 3, falhas = 4, janela_inicio = $2, bloqueado_ate = $3
        WHERE chave_hmac = $1 AND tipo = 'segundo_fator'`,
      [chaveDoFreio, T0, new Date(T0.getTime() - UM_MINUTO)],
    );
    const outro = await entrarNoPainel();
    await p.casos.verificarSegundoFator.executar({ desafio: outro, codigo: '000000' });

    const { rows } = await dono.query<{ senha_hash: string | null }>(
      'SELECT senha_hash FROM identidade.contas WHERE id = $1::uuid',
      [admin.conta.id],
    );
    expect(rows[0]?.senha_hash).toBeNull();
    await entregar(assinantes.segundoFator, admin.conta.id, 'identidade.SegundoFatorFreado');
    const mensagens = await mensagensPara(admin.conta.email, 2);
    expect(mensagens.map((m) => m.Subject)).toEqual([
      ASSUNTOS.segundoFatorFreado,
      ASSUNTOS.senhaRemovida,
    ]);
    await expect(
      p.casos.entrar.executar({
        email: admin.conta.email,
        senha: admin.conta.senha,
        cliente: 'painel',
        ip: ipNovo(),
      }),
    ).resolves.toEqual({ tipo: 'credenciais_invalidas' });
  });
});
