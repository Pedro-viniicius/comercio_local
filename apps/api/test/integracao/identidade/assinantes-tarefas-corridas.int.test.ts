// Etapa 13 do 01b, o que ficava de fora dos testes do dev, contra o Postgres de teste (CA-01,
// CA-02, CA-06, CA-07, CA-11; S15, S92, S5, P16): corridas entre duas requisições (duas
// pilhas = dois pools), a escada inteira do freio de segundo fator sem mexer na tabela, a
// tarefa de anonimização com o SQL de verdade e o prazo de 30 minutos do código do e-mail.
//
// O e-mail sai por um `EnviadorDeEmailFalso` (o SMTP real já é coberto em `assinantes.int.test.ts`),
// com os modelos reais: o código que chega serve nos casos de uso.
import type { PinoLogger } from 'nestjs-pino';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EntregadorDeEventos,
  type EventoPublicado,
} from '../../../src/compartilhado/eventos/assinantes.ts';
import { PublicadorDeEventosNaOutbox } from '../../../src/compartilhado/infra/publicador-na-outbox.ts';
import { RepositorioDeAuditoriaPrisma } from '../../../src/compartilhado/infra/repositorio-de-auditoria-prisma.ts';
import {
  AvisarCadastroRepetidoAssinante,
  chaveDoAvisoDeCadastroRepetido,
} from '../../../src/modulos/identidade/aplicacao/assinantes/avisar-cadastro-repetido.assinante.ts';
import { AvisarSegundoFatorFreadoAssinante } from '../../../src/modulos/identidade/aplicacao/assinantes/avisar-segundo-fator-freado.assinante.ts';
import { EnviarCodigoDeRecuperacaoAssinante } from '../../../src/modulos/identidade/aplicacao/assinantes/enviar-codigo-de-recuperacao.assinante.ts';
import { EnviarCodigoDeVerificacaoAssinante } from '../../../src/modulos/identidade/aplicacao/assinantes/enviar-codigo-de-verificacao.assinante.ts';
import { CriarAdminCasoDeUso } from '../../../src/modulos/identidade/aplicacao/cadastro/criar-admin.caso-de-uso.ts';
import { chaveDoFreioPorOrigem } from '../../../src/modulos/identidade/aplicacao/sessao/comum.ts';
import { chaveDoFreioDeSegundoFator } from '../../../src/modulos/identidade/aplicacao/segundo-fator/comum.ts';
import { ApagarContasNaoVerificadasTarefa } from '../../../src/modulos/identidade/aplicacao/tarefas/apagar-nao-verificadas.tarefa.ts';
import { AnonimizarContasTarefa } from '../../../src/modulos/identidade/aplicacao/tarefas/anonimizar-contas.tarefa.ts';
import { VALIDADE_DO_CODIGO_EM_MS } from '../../../src/modulos/identidade/dominio/codigo-de-verificacao.ts';
import { Email } from '../../../src/modulos/identidade/dominio/email.ts';
import {
  ASSUNTOS,
  ModelosDeEmailDaIdentidadeEmHtml,
} from '../../../src/modulos/identidade/infra/email/modelos/modelos-de-email-da-identidade.ts';
import { EnviadorDeEmailFalso } from '../../fakes/compartilhado/enviador-de-email-falso.ts';
import {
  apagarContasDoTeste,
  cadastrar,
  conectarDono,
  type ContaDeTeste,
  type DocumentosDeTeste,
  emailUnico,
  esperarAlguemNaTrava,
  montarPilha,
  operadorAdmin,
  OUTRA_SENHA,
  pausarDepois,
  prepararAdmin,
  semearDocumentos,
  T0,
  totpDe,
  UM_DIA,
  UM_MINUTO,
} from './pilha-de-casos-de-uso.ts';

const pA = montarPilha();
const pB = montarPilha();
const modelos = new ModelosDeEmailDaIdentidadeEmHtml();

function loggerSilencioso(): PinoLogger {
  const nada = () => undefined;
  return { setContext: nada, info: nada, warn: nada, error: nada } as unknown as PinoLogger;
}

function entregadorDe(p: typeof pA): EntregadorDeEventos {
  return new EntregadorDeEventos(p.unidade, p.relogio, loggerSilencioso());
}

let dono: pg.Client;
let docs: DocumentosDeTeste;
const contasDoTeste: string[] = [];
const freiosDoTeste: string[] = [];

beforeAll(async () => {
  dono = await conectarDono();
  docs = await semearDocumentos(dono);
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
  await pA.prisma.$disconnect();
  await pB.prisma.$disconnect();
});

beforeEach(() => {
  pA.relogio.definir(T0);
  pB.relogio.definir(T0);
});

// ---------------------------------------------------------------------------
// Ajudas

/** Todos os eventos do tipo para a conta, lidos da outbox como o relay os entrega, do mais antigo ao mais novo. */
async function eventosDaOutbox(contaId: string, tipo: string): Promise<EventoPublicado[]> {
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
      ORDER BY ocorrido_em, id`,
    [contaId, tipo],
  );
  return rows.map((linha) => ({
    id: linha.id,
    tipo: linha.tipo,
    versao: linha.versao,
    agregadoId: linha.agregado_id,
    payload: linha.payload,
    ocorridoEm: linha.ocorrido_em.toISOString(),
  }));
}

let proximoIp = 40;
function ipNovo(): string {
  proximoIp += 1;
  const ip = `198.51.100.${proximoIp % 250}`;
  freiosDoTeste.push(chaveDoFreioPorOrigem(pA.servicos.cifrador, ip));
  return ip;
}

async function novaConta(opcoes: { nome?: string } = {}): Promise<ContaDeTeste> {
  const email = emailUnico('etapa13');
  const conta = await cadastrar(pA, docs, { ...opcoes, email });
  contasDoTeste.push(conta.id);
  freiosDoTeste.push(pA.servicos.cifrador.hmac('bloqueio_email', [email]));
  freiosDoTeste.push(chaveDoAvisoDeCadastroRepetido(pA.servicos.cifrador, Email.criar(email)));
  return conta;
}

async function linhaDaConta(contaId: string) {
  const { rows } = await dono.query<{
    status: string;
    nome: string;
    email_normalizado: string;
    telefone_e164: string | null;
    senha_hash: string | null;
    desativada_em: Date | null;
    anonimizada_em: Date | null;
  }>(
    `SELECT status::text, nome, email_normalizado, telefone_e164, senha_hash, desativada_em, anonimizada_em
       FROM identidade.contas WHERE id = $1::uuid`,
    [contaId],
  );
  const linha = rows[0];
  if (linha === undefined) throw new Error('conta não encontrada');
  return linha;
}

/** O código de 6 dígitos que veio no texto puro do e-mail. */
function codigoDoEmail(texto: string): string {
  const achado = /\b(\d{6})\b/.exec(texto);
  if (achado?.[1] === undefined) throw new Error('o e-mail não trouxe código');
  return achado[1];
}

/** Um código de 6 dígitos que o app autenticador não aceita agora (nem no passo vizinho). */
function codigoErrado(segredo: string, quando: Date): string {
  const aceitos = [-30_000, 0, 30_000].map((delta) =>
    totpDe(segredo, new Date(quando.getTime() + delta)),
  );
  return ['000000', '111111'].find((candidato) => !aceitos.includes(candidato)) ?? '222222';
}

// ---------------------------------------------------------------------------

describe('aviso de cadastro repetido: duas entregas ao mesmo tempo (S15)', () => {
  it('dois avisos do mesmo e-mail em duas requisições: sai um só, o segundo espera a marca do primeiro', async () => {
    const conta = await novaConta();
    const repetir = () =>
      pA.casos.criarConta.executar({
        nome: 'Quem Tentou',
        email: conta.email,
        telefone: '(35) 98888-0000',
        senha: OUTRA_SENHA,
        aceites: { termos: docs.termos.versao, privacidade: docs.privacidade.versao },
      });
    await repetir();
    await repetir();
    const [primeiro, segundo] = await eventosDaOutbox(
      conta.id,
      'identidade.CadastroRepetidoTentado',
    );
    if (primeiro === undefined || segundo === undefined) throw new Error('faltou evento na outbox');

    const enviador = new EnviadorDeEmailFalso();
    const montar = (p: typeof pA) =>
      new AvisarCadastroRepetidoAssinante(
        p.unidade,
        p.relogio,
        p.repos.contas,
        p.repos.bloqueios,
        p.servicos.cifrador,
        modelos,
        enviador,
      );
    const assinanteA = montar(pA);
    const assinanteB = montar(pB);
    // A para logo depois de ler a marca (com a trava): B, com outro evento do mesmo e-mail, tem
    // de esperar e, ao ler, já achar a marca gravada por A.
    const pausa = pausarDepois(pA.repos.bloqueios, 'buscarParaAtualizar');
    const entregaA = entregadorDe(pA).entregar(assinanteA, primeiro);
    await pausa.chegou;
    const entregaB = entregadorDe(pB).entregar(assinanteB, segundo);
    await esperarAlguemNaTrava(dono);
    pausa.liberar();

    await expect(Promise.all([entregaA, entregaB])).resolves.toEqual(['tratado', 'tratado']);

    expect(enviador.enviadas).toHaveLength(1);
    expect(enviador.enviadas[0]?.para).toBe(conta.email);
  });
});

describe('tarefa de anonimização contra o banco (CA-11, S5)', () => {
  function tarefaDe(p: typeof pA, logger: PinoLogger): AnonimizarContasTarefa {
    return new AnonimizarContasTarefa(
      p.relogio,
      p.repos.contas,
      p.repos.solicitacoes,
      p.casos.anonimizarConta,
      logger,
    );
  }

  /** Conta criada há 40 dias que pediu a exclusão `diasAtras` dias antes de T0 (senha certa, sem pendência). */
  async function contaDesativadaHa(diasAtras: number): Promise<ContaDeTeste> {
    pA.relogio.definir(new Date(T0.getTime() - 40 * UM_DIA));
    const conta = await novaConta();
    pA.relogio.definir(new Date(T0.getTime() - diasAtras * UM_DIA));
    await expect(
      pA.casos.solicitarExclusao.executar({ contaId: conta.id, senha: conta.senha }),
    ).resolves.toEqual({ tipo: 'desativada' });
    pA.relogio.definir(T0);
    return conta;
  }

  it('anonimiza as desativadas, alerta só a de mais de 25 dias, deixa a que aguarda pendência e é idempotente', async () => {
    const antiga = await contaDesativadaHa(26);
    const recente = await contaDesativadaHa(1);
    // Pendência: a conta continua ativa e a exclusão aguarda.
    const comPendencia = await novaConta();
    pA.servicos.pendencias.definir(comPendencia.id, [
      { modulo: 'pedidos', tipo: 'pedido_em_andamento' },
    ]);
    await expect(
      pA.casos.solicitarExclusao.executar({
        contaId: comPendencia.id,
        senha: comPendencia.senha,
      }),
    ).resolves.toMatchObject({ tipo: 'com_pendencias' });
    const logger = { setContext: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const tarefa = tarefaDe(pA, logger as unknown as PinoLogger);

    const resultado = await tarefa.executar();

    expect(resultado.alertas).toBeGreaterThanOrEqual(1);
    for (const conta of [antiga, recente]) {
      const linha = await linhaDaConta(conta.id);
      expect(linha).toMatchObject({
        status: 'anonimizada',
        telefone_e164: null,
        senha_hash: null,
        nome: 'Conta anonimizada',
      });
      expect(linha.email_normalizado).not.toContain(conta.email.split('@')[0]);
      expect(linha.anonimizada_em).toEqual(T0);
    }
    const { rows: solicitacoes } = await dono.query<{ conta_id: string; status: string }>(
      `SELECT conta_id::text, status::text FROM identidade.solicitacoes_titular
        WHERE conta_id = ANY($1::uuid[]) AND tipo = 'exclusao'`,
      [[antiga.id, recente.id, comPendencia.id]],
    );
    expect(Object.fromEntries(solicitacoes.map((s) => [s.conta_id, s.status]))).toEqual({
      [antiga.id]: 'concluida',
      [recente.id]: 'concluida',
      [comPendencia.id]: 'aguardando_pendencias',
    });
    expect((await linhaDaConta(comPendencia.id)).status).toBe('ativa');

    // O alerta cita a conta de 26 dias e só ela, com o id e o prazo, sem dado pessoal.
    const alertas = logger.warn.mock.calls.map(([dados]) => dados as { contaId?: string });
    expect(alertas.filter((dados) => dados.contaId === antiga.id)).toHaveLength(1);
    expect(alertas.filter((dados) => dados.contaId === recente.id)).toHaveLength(0);
    const registrado = JSON.stringify([logger.warn.mock.calls, logger.error.mock.calls]);
    for (const pessoal of [antiga.email, antiga.nome, antiga.telefone, antiga.senha]) {
      expect(registrado).not.toContain(pessoal);
    }

    // Segunda execução: nada a anonimizar das duas, e um só `ContaAnonimizada` por conta.
    const segunda = await tarefa.executar();
    expect(segunda.anonimizadas).toBe(0);
    for (const conta of [antiga, recente]) {
      expect(await eventosDaOutbox(conta.id, 'identidade.ContaAnonimizada')).toHaveLength(1);
    }
  });

  it('duas execuções ao mesmo tempo (duas máquinas): cada conta é anonimizada uma vez, sem falha nem evento repetido', async () => {
    const contas = [
      await contaDesativadaHa(3),
      await contaDesativadaHa(2),
      await contaDesativadaHa(2),
      await contaDesativadaHa(1),
    ];
    const loggerA = { setContext: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const loggerB = { setContext: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    // A para com a primeira conta travada: B, que lista as mesmas exclusões, tem de esperar a
    // trava dessa conta e, quando entrar, achá-la já anonimizada (sem segundo `ContaAnonimizada`).
    const pausa = pausarDepois(pA.repos.contas, 'buscarPorIdParaAtualizar');
    const execucaoA = tarefaDe(pA, loggerA as unknown as PinoLogger).executar();
    await pausa.chegou;
    const execucaoB = tarefaDe(pB, loggerB as unknown as PinoLogger).executar();
    await esperarAlguemNaTrava(dono);
    pausa.liberar();
    const [a, b] = await Promise.all([execucaoA, execucaoB]);

    expect([a.falhas, b.falhas]).toEqual([0, 0]);
    expect(loggerA.error).not.toHaveBeenCalled();
    expect(loggerB.error).not.toHaveBeenCalled();
    expect(a.anonimizadas + b.anonimizadas).toBeGreaterThanOrEqual(contas.length);
    for (const conta of contas) {
      expect((await linhaDaConta(conta.id)).status).toBe('anonimizada');
      expect(await eventosDaOutbox(conta.id, 'identidade.ContaAnonimizada')).toHaveLength(1);
    }
  });
});

describe('freio do segundo fator: a escada inteira, sem mexer na tabela (S92, P16)', () => {
  it('1, 5 e 15 min avisam e mantêm a senha; a quarta espera, já no máximo, apaga a senha, e a recuperação pelo e-mail devolve o acesso', async () => {
    const admin = await prepararAdmin(pA, docs, ipNovo());
    contasDoTeste.push(admin.conta.id);
    freiosDoTeste.push(
      pA.servicos.cifrador.hmac('bloqueio_email', [admin.conta.email]),
      chaveDoFreioDeSegundoFator(pA.servicos.cifrador, admin.conta.id),
    );
    const { conta, segredo } = admin;
    const entrarNoPainel = async () => {
      const login = await pA.casos.entrar.executar({
        email: conta.email,
        senha: conta.senha,
        cliente: 'painel',
        ip: ipNovo(),
      });
      if (login.tipo !== 'desafio') throw new Error(`login devolveu ${login.tipo}`);
      return login.desafio.desafio;
    };
    const cincoErros = async () => {
      const desafio = await entrarNoPainel();
      for (let i = 0; i < 5; i += 1) {
        await pA.casos.verificarSegundoFator.executar({
          desafio,
          codigo: codigoErrado(segredo, pA.relogio.agora()),
        });
      }
    };
    const eventosDoFreio = async () => eventosDaOutbox(conta.id, 'identidade.SegundoFatorFreado');
    const senhaGravada = async () => (await linhaDaConta(conta.id)).senha_hash !== null;
    // Cada espera é entregue ao assinante logo que acontece, como o worker faria.
    const enviador = new EnviadorDeEmailFalso();
    const aviso = new AvisarSegundoFatorFreadoAssinante(
      pA.unidade,
      pA.repos.contas,
      modelos,
      enviador,
    );
    const entregador = entregadorDe(pA);
    const entregarUltimoAviso = async () => {
      const eventos = await eventosDoFreio();
      const ultimo = eventos.at(-1);
      if (ultimo === undefined) throw new Error('sem SegundoFatorFreado');
      await entregador.entregar(aviso, ultimo);
      return eventos.length;
    };

    await cincoErros(); // nível 1: 1 min
    expect(await entregarUltimoAviso()).toBe(1);
    pA.relogio.avancar(UM_MINUTO);
    await cincoErros(); // nível 2: 5 min
    expect(await entregarUltimoAviso()).toBe(2);
    pA.relogio.avancar(5 * UM_MINUTO);
    await cincoErros(); // nível 3: 15 min, a primeira chegada ao máximo
    expect(await entregarUltimoAviso()).toBe(3);
    expect(await senhaGravada()).toBe(true);

    // Durante a espera de 15 min o código nem é conferido: `freado`, sem evento e sem apagar a senha.
    pA.relogio.avancar(10 * UM_MINUTO);
    const durante = await entrarNoPainel();
    await expect(
      pA.casos.verificarSegundoFator.executar({
        desafio: durante,
        codigo: codigoErrado(segredo, pA.relogio.agora()),
      }),
    ).resolves.toMatchObject({ tipo: 'freado' });
    expect(await eventosDoFreio()).toHaveLength(3);
    expect(await senhaGravada()).toBe(true);

    // Fim da espera, dentro da calma: cinco erros aciona o freio de novo no nível máximo.
    pA.relogio.avancar(5 * UM_MINUTO);
    await cincoErros();
    expect(await entregarUltimoAviso()).toBe(4);
    expect(await senhaGravada()).toBe(false);
    await expect(
      pA.casos.entrar.executar({
        email: conta.email,
        senha: conta.senha,
        cliente: 'painel',
        ip: ipNovo(),
      }),
    ).resolves.toEqual({ tipo: 'credenciais_invalidas' });

    // Os três primeiros avisos só alertam; o do quarto manda recuperar a senha.
    expect(enviador.enviadas.map((m) => m.assunto)).toEqual([
      ASSUNTOS.segundoFatorFreado,
      ASSUNTOS.segundoFatorFreado,
      ASSUNTOS.segundoFatorFreado,
      ASSUNTOS.senhaRemovida,
    ]);
    expect(enviador.enviadas.every((m) => m.para === conta.email)).toBe(true);

    // Recuperação: o código do e-mail define a senha nova, e o segundo fator já configurado segue valendo.
    await pA.casos.solicitarRecuperacao.executar({ email: conta.email });
    const recuperacao = new EnviarCodigoDeRecuperacaoAssinante(
      pA.unidade,
      pA.relogio,
      pA.repos.contas,
      pA.repos.codigos,
      pA.servicos.cifrador,
      pA.servicos.gerador,
      modelos,
      enviador,
    );
    const [pedido] = await eventosDaOutbox(conta.id, 'identidade.RecuperacaoSolicitada');
    if (pedido === undefined) throw new Error('sem RecuperacaoSolicitada');
    await entregador.entregar(recuperacao, pedido);
    const email = enviador.enviadas.at(-1);
    expect(email?.assunto).toBe(ASSUNTOS.codigoDeRecuperacao);
    await expect(
      pA.casos.redefinirSenha.executar({
        email: conta.email,
        codigo: codigoDoEmail(email?.texto ?? ''),
        novaSenha: OUTRA_SENHA,
        ip: ipNovo(),
      }),
    ).resolves.toEqual({ tipo: 'redefinida' });
    pA.relogio.avancar(16 * UM_MINUTO);
    const novoLogin = await pA.casos.entrar.executar({
      email: conta.email,
      senha: OUTRA_SENHA,
      cliente: 'painel',
      ip: ipNovo(),
    });
    if (novoLogin.tipo !== 'desafio') throw new Error(`login devolveu ${novoLogin.tipo}`);
    expect(novoLogin.desafio.etapa).toBe('verificar');
    await expect(
      pA.casos.verificarSegundoFator.executar({
        desafio: novoLogin.desafio.desafio,
        codigo: totpDe(segredo, pA.relogio.agora()),
      }),
    ).resolves.toMatchObject({ tipo: 'concluido' });
  });
});

describe('seed:admin: duas execuções ao mesmo tempo (CA-07, S106)', () => {
  const montar = (p: typeof pA) =>
    new CriarAdminCasoDeUso(
      p.unidade,
      p.relogio,
      p.repos.contas,
      new RepositorioDeAuditoriaPrisma(p.unidade, p.relogio),
      new PublicadorDeEventosNaOutbox(p.unidade, p.relogio),
      p.servicos.gerador,
    );

  it('uma cria o admin, a outra recebe email_ja_cadastrado; um só evento, uma só auditoria e nada pessoal nela', async () => {
    const email = emailUnico('admin-corrida');
    freiosDoTeste.push(pA.servicos.cifrador.hmac('bloqueio_email', [email]));
    // Depois do primeiro admin, o operador é obrigatório e é o ator da auditoria (S106).
    const operador = await operadorAdmin(pA, docs);
    contasDoTeste.push(operador.id);
    const entrada = {
      nome: 'Admin Corrida',
      telefone: '(35) 97777-4321',
      operadorId: operador.id,
    };

    const [a, b] = await Promise.all([
      montar(pA).executar({ ...entrada, email: email.toUpperCase() }),
      montar(pB).executar({ ...entrada, email: ` ${email} ` }),
    ]);

    const tipos = [a.tipo, b.tipo].sort();
    expect(tipos).toEqual(['criado', 'email_ja_cadastrado']);
    const criado = [a, b].find((r) => r.tipo === 'criado');
    if (criado?.tipo !== 'criado') throw new Error('nenhum admin criado');
    contasDoTeste.push(criado.contaId);
    const { rows: contas } = await dono.query(
      'SELECT 1 FROM identidade.contas WHERE email_normalizado = $1',
      [email],
    );
    expect(contas).toHaveLength(1);
    expect(await eventosDaOutbox(criado.contaId, 'identidade.RecuperacaoSolicitada')).toHaveLength(
      1,
    );
    const { rows: auditoria } = await dono.query(
      "SELECT * FROM compartilhado.auditoria WHERE acao = 'admin_criado' AND recurso_id = $1",
      [criado.contaId],
    );
    expect(auditoria).toHaveLength(1);
    const gravado = JSON.stringify(auditoria);
    for (const pessoal of ['Admin Corrida', email, '97777', '4321']) {
      expect(gravado).not.toContain(pessoal);
    }
    expect(auditoria[0]).toMatchObject({ ator_tipo: 'admin', ator_id: operador.id });
    expect(gravado).toContain('"cli"');
  });

  it('primeiro admin, e-mails diferentes: a segunda espera a trava da primeira, que cria com ator sistema, e recebe operador_obrigatorio', async () => {
    const emails = [emailUnico('primeiro-admin-a'), emailUnico('primeiro-admin-b')];
    // O banco pode ter admin ativo deixado por outros arquivos: a mesma consulta, na transação
    // do caso de uso, mas só sobre as contas deste teste (sem admin ativo no começo).
    const espioes = [pA, pB].map((p) =>
      vi.spyOn(p.repos.contas, 'existeAdminAtivo').mockImplementation(async () => {
        const admin = await p.unidade.cliente().perfilDaConta.findFirst({
          where: { perfil: 'admin', conta: { status: 'ativa', emailNormalizado: { in: emails } } },
          select: { contaId: true },
        });
        return admin !== null;
      }),
    );
    const entrada = { nome: 'Primeiro Admin', telefone: '(35) 97777-4321', operadorId: null };
    try {
      const pausa = pausarDepois(pA.repos.contas, 'travarCriacaoDeAdmin');
      const primeira = montar(pA).executar({ ...entrada, email: emails[0] ?? '' });
      await pausa.chegou;
      const segunda = montar(pB).executar({ ...entrada, email: emails[1] ?? '' });
      await esperarAlguemNaTrava(dono);
      pausa.liberar();

      const criada = await primeira;
      if (criada.tipo !== 'criado') throw new Error(`a primeira devolveu ${criada.tipo}`);
      contasDoTeste.push(criada.contaId);
      expect(await segunda).toEqual({ tipo: 'operador_obrigatorio' });
      const { rows: contas } = await dono.query<{ email_normalizado: string }>(
        'SELECT email_normalizado FROM identidade.contas WHERE email_normalizado = ANY($1::text[])',
        [emails],
      );
      expect(contas.map((c) => c.email_normalizado)).toEqual([emails[0]]);
      const { rows: auditoria } = await dono.query(
        "SELECT ator_tipo, ator_id FROM compartilhado.auditoria WHERE acao = 'admin_criado' AND recurso_id = $1",
        [criada.contaId],
      );
      expect(auditoria).toEqual([{ ator_tipo: 'sistema', ator_id: null }]);
    } finally {
      for (const espiao of espioes) espiao.mockRestore();
    }
  });
});

describe('código de recuperação: 30 minutos (CA-06)', () => {
  it('serve até um instante antes dos 30 min e não serve depois; o e-mail diz 30 minutos', async () => {
    const conta = await novaConta();
    const enviador = new EnviadorDeEmailFalso();
    const recuperacao = new EnviarCodigoDeRecuperacaoAssinante(
      pA.unidade,
      pA.relogio,
      pA.repos.contas,
      pA.repos.codigos,
      pA.servicos.cifrador,
      pA.servicos.gerador,
      modelos,
      enviador,
    );
    const entregador = entregadorDe(pA);
    const pedir = async (): Promise<string> => {
      await pA.casos.solicitarRecuperacao.executar({ email: conta.email });
      const pedidos = await eventosDaOutbox(conta.id, 'identidade.RecuperacaoSolicitada');
      const ultimo = pedidos.at(-1);
      if (ultimo === undefined) throw new Error('sem RecuperacaoSolicitada');
      await entregador.entregar(recuperacao, ultimo);
      const email = enviador.enviadas.at(-1);
      expect(email?.texto).toContain(`${VALIDADE_DO_CODIGO_EM_MS / UM_MINUTO} minutos`);
      return codigoDoEmail(email?.texto ?? '');
    };
    const redefinir = (codigo: string) =>
      pA.casos.redefinirSenha.executar({
        email: conta.email,
        codigo,
        novaSenha: OUTRA_SENHA,
        ip: ipNovo(),
      });

    const vencido = await pedir();
    pA.relogio.avancar(VALIDADE_DO_CODIGO_EM_MS + 1);
    await expect(redefinir(vencido)).resolves.toEqual({ tipo: 'codigo_invalido' });

    // Um dia depois, para a ordem dos eventos na outbox (`ocorrido_em`) não depender do acaso.
    pA.relogio.definir(new Date(T0.getTime() + UM_DIA));
    const dentroDoPrazo = await pedir();
    pA.relogio.avancar(VALIDADE_DO_CODIGO_EM_MS - 1);
    await expect(redefinir(dentroDoPrazo)).resolves.toEqual({ tipo: 'redefinida' });
  });
});

// Por último: o expurgo roda na tabela inteira, com o `now()` do banco, e levaria junto as contas
// deste arquivo que tenham mais de 7 dias de `criada_em` (as de `T0`, daqui a alguns dias).
describe('expurgo: tudo o que é da conta sai junto (P1-dono, S8)', () => {
  it('apaga consentimentos, sessões com o histórico de tokens, códigos, solicitações e exportações, e deixa a conta de fora que não é expurgável', async () => {
    const { rows } = await dono.query<{ agora: Date }>('SELECT now() AS agora');
    const agoraDoBanco = rows[0]?.agora ?? new Date();
    pA.relogio.definir(new Date(agoraDoBanco.getTime() - 8 * UM_DIA));
    const conta = await novaConta();
    const login = await pA.casos.entrar.executar({
      email: conta.email,
      senha: conta.senha,
      cliente: 'app_consumidor',
      ip: ipNovo(),
    });
    if (login.tipo !== 'sessao') throw new Error(`login devolveu ${login.tipo}`);
    // Uma rotação: grava o histórico de tokens usados da sessão.
    await pA.casos.renovar.executar({
      tokenRenovacao: login.sessao.tokenRenovacao,
      cliente: 'app_consumidor',
    });
    await pA.casos.solicitarExportacao.executar({ contaId: conta.id });
    const { rows: pedidos } = await dono.query<{ id: string }>(
      "SELECT id::text FROM identidade.solicitacoes_titular WHERE conta_id = $1::uuid AND tipo = 'exportacao'",
      [conta.id],
    );
    await pA.casos.gerarExportacao.executar({
      contaId: conta.id,
      solicitacaoId: pedidos[0]?.id ?? '',
    });
    await pA.casos.reenviarVerificacao.executar({ contaId: conta.id });
    const codigoGravado = new EnviarCodigoDeVerificacaoAssinante(
      pA.unidade,
      pA.relogio,
      pA.repos.contas,
      pA.repos.codigos,
      pA.servicos.cifrador,
      pA.servicos.gerador,
      modelos,
      new EnviadorDeEmailFalso(),
    );
    const [reenvio] = await eventosDaOutbox(conta.id, 'identidade.VerificacaoReenviada');
    if (reenvio === undefined) throw new Error('sem VerificacaoReenviada');
    await entregadorDe(pA).entregar(codigoGravado, reenvio);
    const tabelas = [
      'identidade.perfis_conta',
      'identidade.consentimentos',
      'identidade.sessoes',
      'identidade.codigos_verificacao',
      'identidade.solicitacoes_titular',
      'identidade.exportacoes_titular',
    ];
    const contar = async (tabela: string): Promise<number> => {
      const { rows: linhas } = await dono.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM ${tabela} WHERE conta_id = $1::uuid`,
        [conta.id],
      );
      return linhas[0]?.n ?? 0;
    };
    const { rows: historico } = await dono.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM identidade.tokens_de_renovacao_usados t
         JOIN identidade.sessoes s ON s.id = t.sessao_id WHERE s.conta_id = $1::uuid`,
      [conta.id],
    );
    for (const tabela of tabelas) expect(await contar(tabela), tabela).toBeGreaterThan(0);
    expect(historico[0]?.n).toBeGreaterThan(0);

    pA.relogio.definir(agoraDoBanco);
    const resultado = await new ApagarContasNaoVerificadasTarefa(
      pA.unidade,
      pA.relogio,
      pA.repos.contas,
      loggerSilencioso(),
    ).executar();

    expect(resultado.apagadas).toBeGreaterThanOrEqual(1);
    for (const tabela of tabelas) expect(await contar(tabela), tabela).toBe(0);
    const { rows: restou } = await dono.query(
      'SELECT 1 FROM identidade.contas WHERE id = $1::uuid',
      [conta.id],
    );
    expect(restou).toEqual([]);
  });
});

describe('evento que chega depois do expurgo da conta (P1-dono)', () => {
  it('ContaCriada e RecuperacaoSolicitada de uma conta já expurgada: tratados sem erro, sem e-mail e sem código novo', async () => {
    // A conta nasce com `criada_em` oito dias antes do `now()` do banco: o expurgo (e a trigger) a apagam.
    const { rows } = await dono.query<{ agora: Date }>('SELECT now() AS agora');
    const agoraDoBanco = rows[0]?.agora ?? new Date();
    pA.relogio.definir(new Date(agoraDoBanco.getTime() - 8 * UM_DIA));
    const conta = await novaConta();
    await pA.casos.solicitarRecuperacao.executar({ email: conta.email });
    pA.relogio.definir(agoraDoBanco);
    const expurgo = new ApagarContasNaoVerificadasTarefa(
      pA.unidade,
      pA.relogio,
      pA.repos.contas,
      loggerSilencioso(),
    );
    await expurgo.executar();
    const { rows: restou } = await dono.query(
      'SELECT 1 FROM identidade.contas WHERE id = $1::uuid',
      [conta.id],
    );
    expect(restou).toEqual([]);

    const enviador = new EnviadorDeEmailFalso();
    const entregador = entregadorDe(pA);
    const verificacao = new EnviarCodigoDeVerificacaoAssinante(
      pA.unidade,
      pA.relogio,
      pA.repos.contas,
      pA.repos.codigos,
      pA.servicos.cifrador,
      pA.servicos.gerador,
      modelos,
      enviador,
    );
    const recuperacao = new EnviarCodigoDeRecuperacaoAssinante(
      pA.unidade,
      pA.relogio,
      pA.repos.contas,
      pA.repos.codigos,
      pA.servicos.cifrador,
      pA.servicos.gerador,
      modelos,
      enviador,
    );
    const [criada] = await eventosDaOutbox(conta.id, 'identidade.ContaCriada');
    const [pedido] = await eventosDaOutbox(conta.id, 'identidade.RecuperacaoSolicitada');
    if (criada === undefined || pedido === undefined) throw new Error('faltou evento na outbox');

    await expect(entregador.entregar(verificacao, criada)).resolves.toBe('tratado');
    await expect(entregador.entregar(recuperacao, pedido)).resolves.toBe('tratado');

    expect(enviador.enviadas).toEqual([]);
  });
});
