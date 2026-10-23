// Ponta a ponta pelo módulo real (plano 01b, etapa 16; CA-01, CA-02, CA-06; revisão do `qa`):
// a API sobe inteira (`AppModule` com o `IdentidadeModule`), a rota grava o evento na outbox,
// o `EntregadorDeEventos` da própria aplicação entrega o evento aos assinantes que o módulo
// registrou (`RegistroDeAssinantes`) e o e-mail chega ao Mailpit pelo SMTP real. O código que
// veio no e-mail serve na rota seguinte. Prova a ligação do `IdentidadeModule` (assinantes
// registrados, modelos de e-mail, enviador) que os testes por caso de uso não exercitam.
//
// Cada teste usa e-mails únicos e apaga só as mensagens deles (a caixa do Mailpit é a mesma do
// desenvolvimento).
import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  EntregadorDeEventos,
  type EventoPublicado,
  RegistroDeAssinantes,
} from '../../../src/compartilhado/eventos/assinantes.ts';
import { chaveDoAvisoDeCadastroRepetido } from '../../../src/modulos/identidade/aplicacao/assinantes/avisar-cadastro-repetido.assinante.ts';
import { Email } from '../../../src/modulos/identidade/dominio/email.ts';
import { type ApiDeTeste, ipNovo, problemaDe, sessaoDe, subirApi } from './api-http.ts';
import {
  apagarContasDoTeste,
  conectarDono,
  type DocumentosDeTeste,
  emailUnico,
  montarPilha,
  NOME_PADRAO,
  OUTRA_SENHA,
  type Pilha,
  SENHA,
  semearDocumentos,
  sessoesVivas,
  T0,
} from './pilha-de-casos-de-uso.ts';

const API_DO_MAILPIT = process.env['MAILPIT_API_TESTE'] ?? 'http://127.0.0.1:8025';

let p: Pilha;
let dono: pg.Client;
let docs: DocumentosDeTeste;
let api: ApiDeTeste;
const contasDoTeste: string[] = [];
const freiosDoTeste: string[] = [];
const caixasDoTeste: string[] = [];

beforeAll(async () => {
  p = montarPilha();
  dono = await conectarDono();
  docs = await semearDocumentos(dono);
  api = await subirApi();
});

beforeEach(() => {
  api.relogio.definir(T0);
});

afterEach(async () => {
  for (const caixa of caixasDoTeste.splice(0)) {
    await fetch(`${API_DO_MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${caixa}"`)}`, {
      method: 'DELETE',
    });
  }
});

afterAll(async () => {
  await api?.fechar();
  if (dono !== undefined) {
    await dono.query(
      `DELETE FROM compartilhado.eventos_processados WHERE evento_id IN
         (SELECT id FROM compartilhado.outbox WHERE agregado_id = ANY($1::uuid[]))`,
      [contasDoTeste],
    );
    await apagarContasDoTeste(dono, contasDoTeste, freiosDoTeste);
    await docs?.remover();
    await dono.end();
  }
  await p?.prisma.$disconnect();
});

interface MensagemDoMailpit {
  ID: string;
  To: { Address: string }[];
  Subject: string;
  Text: string;
  HTML: string;
}

async function mensagensPara(endereco: string, esperadas: number): Promise<MensagemDoMailpit[]> {
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

function codigoDoEmail(mensagem: MensagemDoMailpit | undefined): string {
  const achado = /\b(\d{6})\b/.exec(mensagem?.Text ?? '');
  if (achado?.[1] === undefined) throw new Error('o e-mail não trouxe código');
  return achado[1];
}

/** Os eventos da conta na outbox, como o relay os entrega aos assinantes. */
async function eventosDaOutbox(contaId: string): Promise<EventoPublicado[]> {
  const { rows } = await dono.query<{
    id: string;
    tipo: string;
    versao: number;
    agregado_id: string;
    payload: EventoPublicado['payload'];
    ocorrido_em: Date;
  }>(
    `SELECT id::text, tipo, versao, agregado_id::text, payload, ocorrido_em
       FROM compartilhado.outbox WHERE agregado_id = $1::uuid ORDER BY ocorrido_em, id`,
    [contaId],
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

/** Entrega cada evento da conta aos assinantes que o módulo registrou para o tipo dele. */
async function entregarEventosDaConta(contaId: string): Promise<string[]> {
  const registro = api.app.get(RegistroDeAssinantes, { strict: false });
  const entregador = api.app.get(EntregadorDeEventos, { strict: false });
  const entregues: string[] = [];
  for (const evento of await eventosDaOutbox(contaId)) {
    for (const assinante of registro.assinantesDe(evento.tipo)) {
      await entregador.entregar(assinante, evento);
      entregues.push(`${evento.tipo} -> ${assinante.nome}`);
    }
  }
  return entregues;
}

async function contaDoEmail(email: string) {
  const conta = await p.repos.contas.buscarPorEmail(Email.criar(email));
  if (conta === null) throw new Error('conta não gravada');
  if (!contasDoTeste.includes(conta.id)) {
    contasDoTeste.push(conta.id);
    freiosDoTeste.push(
      p.servicos.cifrador.hmac('bloqueio_email', [email]),
      chaveDoAvisoDeCadastroRepetido(p.servicos.cifrador, Email.criar(email)),
    );
  }
  return conta;
}

function corpoDoCadastro(email: string, extra: Record<string, unknown> = {}) {
  return {
    nome: NOME_PADRAO,
    email,
    telefone: '(35) 99999-1234',
    senha: SENHA,
    aceites: { termos: docs.termos.versao, privacidade: docs.privacidade.versao },
    ...extra,
  };
}

function ip(): string {
  return ipNovo(p, freiosDoTeste);
}

describe('CA-01 ponta a ponta: cadastro pela rota, e-mail pelo assinante registrado, verificação pela rota', () => {
  it('o código que chega no e-mail verifica a conta e a sessão nova diz `emailVerificado`', async () => {
    const email = emailUnico('e2e');
    caixasDoTeste.push(email);
    await api.http
      .post('/v1/contas')
      .set('X-Forwarded-For', ip())
      .send(corpoDoCadastro(email))
      .expect(202);
    const conta = await contaDoEmail(email);

    const entregues = await entregarEventosDaConta(conta.id);
    expect(entregues).toEqual([
      'identidade.ContaCriada -> identidade.enviar-codigo-de-verificacao',
    ]);
    const [mensagem] = await mensagensPara(email, 1);
    expect(mensagem?.To.map((t) => t.Address)).toEqual([email]);
    const codigo = codigoDoEmail(mensagem);
    // O e-mail não carrega a senha nem o telefone.
    expect(`${mensagem?.Text}${mensagem?.HTML}`).not.toContain(SENHA);
    expect(`${mensagem?.Text}${mensagem?.HTML}`).not.toContain('99999-1234');

    const login = await api.http
      .post('/v1/sessoes')
      .set('X-Forwarded-For', ip())
      .send({ email, senha: SENHA, cliente: 'app_consumidor' })
      .expect(200);
    const sessao = sessaoDe(login.body);
    expect(sessao.emailVerificado).toBe(false);

    const verificada = await api.http
      .post('/v1/conta/verificacao-email')
      .set('Authorization', `Bearer ${sessao.tokenAcesso}`)
      .send({ codigo })
      .expect(200);
    expect(sessaoDe(verificada.body).emailVerificado).toBe(true);
    // O mesmo código não serve duas vezes (a sessão nova verifica de novo: 400).
    const repetida = await api.http
      .post('/v1/conta/verificacao-email')
      .set('Authorization', `Bearer ${sessaoDe(verificada.body).tokenAcesso}`)
      .send({ codigo });
    expect(repetida.status).toBe(400);
  });

  it('entregar duas vezes o mesmo evento não manda dois e-mails', async () => {
    const email = emailUnico('e2e');
    caixasDoTeste.push(email);
    await api.http
      .post('/v1/contas')
      .set('X-Forwarded-For', ip())
      .send(corpoDoCadastro(email))
      .expect(202);
    const conta = await contaDoEmail(email);
    await entregarEventosDaConta(conta.id);
    await entregarEventosDaConta(conta.id);
    expect(await mensagensPara(email, 2)).toHaveLength(1);
  });
});

describe('CA-02 ponta a ponta: cadastro repetido avisa o dono, sem dado de quem tentou', () => {
  it('o dono recebe um aviso; o nome, o telefone e a senha de quem tentou não aparecem', async () => {
    const email = emailUnico('e2e');
    caixasDoTeste.push(email);
    await api.http
      .post('/v1/contas')
      .set('X-Forwarded-For', ip())
      .send(corpoDoCadastro(email))
      .expect(202);
    const conta = await contaDoEmail(email);
    await entregarEventosDaConta(conta.id);
    await api.http
      .post('/v1/contas')
      .set('X-Forwarded-For', ip())
      .send(
        corpoDoCadastro(email, {
          nome: 'Intruso Qa Silva',
          telefone: '(11) 98888-7777',
          senha: OUTRA_SENHA,
        }),
      )
      .expect(202);

    const entregues = await entregarEventosDaConta(conta.id);
    expect(entregues).toContain(
      'identidade.CadastroRepetidoTentado -> identidade.avisar-cadastro-repetido',
    );
    const mensagens = await mensagensPara(email, 2);
    expect(mensagens).toHaveLength(2);
    const aviso = mensagens.find((m) => m.Subject !== mensagens[0]?.Subject) ?? mensagens[1];
    const texto = `${aviso?.Subject}${aviso?.Text}${aviso?.HTML}`;
    for (const proibido of ['Intruso', '98888', OUTRA_SENHA]) {
      expect(texto).not.toContain(proibido);
    }
  });
});

describe('CA-06 ponta a ponta: recuperação e redefinição pelas rotas', () => {
  it('o código do e-mail redefine a senha uma vez, revoga as sessões e a senha nova entra', async () => {
    const email = emailUnico('e2e');
    caixasDoTeste.push(email);
    await api.http
      .post('/v1/contas')
      .set('X-Forwarded-For', ip())
      .send(corpoDoCadastro(email))
      .expect(202);
    const conta = await contaDoEmail(email);
    await entregarEventosDaConta(conta.id);
    await api.http
      .post('/v1/sessoes')
      .set('X-Forwarded-For', ip())
      .send({ email, senha: SENHA, cliente: 'app_consumidor' })
      .expect(200);

    await api.http
      .post('/v1/senha/recuperacao')
      .set('X-Forwarded-For', ip())
      .send({ email })
      .expect(202);
    await entregarEventosDaConta(conta.id);
    const mensagens = await mensagensPara(email, 2);
    expect(mensagens).toHaveLength(2);
    const codigo = codigoDoEmail(mensagens.at(-1));

    await api.http
      .post('/v1/senha/redefinicao')
      .set('X-Forwarded-For', ip())
      .send({ email, codigo, novaSenha: OUTRA_SENHA })
      .expect(204);
    expect(await sessoesVivas(dono, conta.id)).toBe(0);
    const reuso = await api.http
      .post('/v1/senha/redefinicao')
      .set('X-Forwarded-For', ip())
      .send({ email, codigo, novaSenha: 'terceira-senha-azul-31' });
    expect(reuso.status).toBe(400);
    expect(problemaDe(reuso.body).codigo).toBe('validacao');
    await api.http
      .post('/v1/sessoes')
      .set('X-Forwarded-For', ip())
      .send({ email, senha: SENHA, cliente: 'app_consumidor' })
      .expect(401);
    await api.http
      .post('/v1/sessoes')
      .set('X-Forwarded-For', ip())
      .send({ email, senha: OUTRA_SENHA, cliente: 'app_consumidor' })
      .expect(200);
  });

  it('e-mail sem conta: a rota responde 202 igual e não sai evento nem e-mail', async () => {
    const email = emailUnico('e2e-sem-conta');
    caixasDoTeste.push(email);
    freiosDoTeste.push(p.servicos.cifrador.hmac('bloqueio_email', [email]));
    const antes = await dono.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM compartilhado.outbox WHERE tipo = 'identidade.RecuperacaoSolicitada'",
    );
    await api.http
      .post('/v1/senha/recuperacao')
      .set('X-Forwarded-For', ip())
      .send({ email })
      .expect(202);
    const depois = await dono.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM compartilhado.outbox WHERE tipo = 'identidade.RecuperacaoSolicitada'",
    );
    expect(depois.rows[0]?.n).toBe(antes.rows[0]?.n);
    expect(await mensagensPara(email, 0)).toHaveLength(0);
  });
});
