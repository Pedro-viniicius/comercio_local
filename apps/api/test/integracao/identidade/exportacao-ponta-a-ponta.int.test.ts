// Exportação dos dados pela API inteira (plano 01b, etapa 19; CA-10, S10, S98):
//
// - ponta a ponta: a rota grava o pedido na outbox, o `EntregadorDeEventos` da própria
//   aplicação o entrega ao assinante que o módulo registrou, a cópia nasce cifrada, o e-mail
//   de aviso chega ao Mailpit sem a cópia nem link com segredo, e a tela de Privacidade
//   passa a mostrar até quando baixar; o download então dá 200 uma vez só;
// - corrida de verdade nos downloads: a primeira requisição para DEPOIS de ler a cópia
//   (`buscarDisponivel`) e antes de marcá-la (`marcarBaixada`), a segunda faz o download
//   inteiro, e só então a primeira segue. O UPDATE condicional tem de entregar o arquivo a uma
//   só;
// - a cópia nova apaga a antiga não baixada enquanto um download dela está no meio.
//
// Cada teste usa e-mails únicos e apaga só as mensagens deles (a caixa do Mailpit é a mesma do
// desenvolvimento).
import { privacidadeSchema } from '@bairrin/contratos';
import { afterEach, describe, expect, it } from 'vitest';
import {
  EntregadorDeEventos,
  type EventoPublicado,
  RegistroDeAssinantes,
} from '../../../src/compartilhado/eventos/assinantes.ts';
import { RepositorioDeExportacoes } from '../../../src/modulos/identidade/dominio/repositorios.ts';
import { sensiveisEncontrados } from '../../helpers/captura-de-log.ts';
import { type ContaComSessao, usarCenarioHttp, valoresPessoaisDe } from './cenario-http.ts';
import { pausarDepois, T0, UM_DIA } from './pilha-de-casos-de-uso.ts';

const API_DO_MAILPIT = process.env['MAILPIT_API_TESTE'] ?? 'http://127.0.0.1:8025';

const cenario = usarCenarioHttp();
const caixasDoTeste: string[] = [];

afterEach(async () => {
  for (const caixa of caixasDoTeste.splice(0)) {
    await fetch(`${API_DO_MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${caixa}"`)}`, {
      method: 'DELETE',
    });
  }
});

function como(sessao: { tokenAcesso: string }) {
  const { http } = cenario.api;
  const comToken = <T extends { set(nome: string, valor: string): T }>(pedido: T) =>
    pedido
      .set('Authorization', `Bearer ${sessao.tokenAcesso}`)
      .set('X-Forwarded-For', cenario.ip());
  return {
    get: (caminho: string) => comToken(http.get(caminho)),
    post: (caminho: string) => comToken(http.post(caminho)),
  };
}

interface MensagemDoMailpit {
  ID: string;
  To: { Address: string }[];
  Subject: string;
  Text: string;
  HTML: string;
}

async function mensagensPara(
  endereco: string,
  esperadas: number,
  esperaEmMs = 5_000,
): Promise<MensagemDoMailpit[]> {
  const limite = Date.now() + esperaEmMs;
  for (;;) {
    const busca = await fetch(
      `${API_DO_MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${endereco}"`)}`,
    );
    expect(busca.ok).toBe(true);
    const { messages } = (await busca.json()) as { messages: { ID: string }[] };
    if (messages.length >= esperadas || Date.now() > limite) {
      return Promise.all(
        messages.map(async ({ ID }) => {
          const resposta = await fetch(`${API_DO_MAILPIT}/api/v1/message/${ID}`);
          return (await resposta.json()) as MensagemDoMailpit;
        }),
      );
    }
    await new Promise((resolver) => setTimeout(resolver, 50));
  }
}

/** Os eventos da conta na outbox, como o relay os entrega aos assinantes. */
async function eventosParaEntregar(contaId: string): Promise<EventoPublicado[]> {
  const { rows } = await cenario.dono.query<{
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

/**
 * Entrega os `ExportacaoSolicitada` da conta aos assinantes registrados para o tipo; devolve
 * quem recebeu. Só esse tipo: o cadastro também deixou um `ContaCriada`, que mandaria o e-mail
 * de verificação e confundiria a contagem de mensagens.
 */
async function entregarEventosDaConta(contaId: string): Promise<string[]> {
  const registro = cenario.api.app.get(RegistroDeAssinantes, { strict: false });
  const entregador = cenario.api.app.get(EntregadorDeEventos, { strict: false });
  const entregues: string[] = [];
  const pedidos = (await eventosParaEntregar(contaId)).filter(
    ({ tipo }) => tipo === 'identidade.ExportacaoSolicitada',
  );
  for (const evento of pedidos) {
    for (const assinante of registro.assinantesDe(evento.tipo)) {
      await entregador.entregar(assinante, evento);
      entregues.push(`${evento.tipo} -> ${assinante.nome}`);
    }
  }
  return entregues;
}

/** Conta nova que pediu a cópia pela rota e já teve o evento entregue ao assinante real. */
async function contaComCopiaGerada(): Promise<ContaComSessao> {
  const sessao = await cenario.contaNoApp();
  caixasDoTeste.push(sessao.conta.email);
  await como(sessao).post('/v1/privacidade/exportacao').expect(202);
  return sessao;
}

describe('exportação ponta a ponta pela API e pelo assinante real (CA-10, S10)', () => {
  it('pedido → assinante gera a cópia → e-mail de aviso sem a cópia → Privacidade mostra o prazo → download 200 uma vez', async () => {
    const sessao = await contaComCopiaGerada();
    const { conta } = sessao;

    // Antes de o assinante rodar, a cópia não existe.
    const antes = await como(sessao).get('/v1/privacidade').expect(200);
    expect(privacidadeSchema.parse(antes.body).exportacaoDisponivelAte).toBeNull();
    await como(sessao).get('/v1/privacidade/exportacao/arquivo').expect(404);

    const entregues = await entregarEventosDaConta(conta.id);
    expect(entregues).toContain('identidade.ExportacaoSolicitada -> identidade.gerar-exportacao');

    const depois = await como(sessao).get('/v1/privacidade').expect(200);
    expect(privacidadeSchema.parse(depois.body).exportacaoDisponivelAte).toBe(
      new Date(T0.getTime() + 7 * UM_DIA).toISOString(),
    );

    // O aviso por e-mail: um só, para o titular, sem a cópia, o hash, o segredo ou link com token.
    const mensagens = await mensagensPara(conta.email, 1);
    expect(mensagens).toHaveLength(1);
    const [aviso] = mensagens;
    expect(aviso?.To.map((destino) => destino.Address)).toEqual([conta.email]);
    expect(aviso?.Subject.trim()).not.toBe('');
    const corpoDoEmail = `${aviso?.Text ?? ''}\n${aviso?.HTML ?? ''}`;
    expect(
      sensiveisEncontrados({ email: corpoDoEmail }, [
        { rotulo: 'senha', valor: conta.senha },
        { rotulo: 'telefone', valor: conta.telefone },
        { rotulo: 'token de acesso', valor: sessao.tokenAcesso },
        { rotulo: 'token de renovação', valor: sessao.tokenRenovacao },
        { rotulo: 'hash de senha', valor: '$argon2' },
        { rotulo: 'chave do arquivo', valor: '"identidade"' },
      ]),
    ).toEqual([]);
    expect(corpoDoEmail).not.toMatch(/[?&](token|codigo|sid|arquivo)=/i);

    // O arquivo sai pela rota com sessão: 200 uma vez, depois 404.
    const baixada = await como(sessao).get('/v1/privacidade/exportacao/arquivo').expect(200);
    const arquivo = JSON.parse(baixada.text) as { identidade: { conta: { id: string } } };
    expect(arquivo.identidade.conta.id).toBe(conta.id);
    await como(sessao).get('/v1/privacidade/exportacao/arquivo').expect(404);
  });

  it('o evento entregue duas vezes (reentrega do relay) não manda um segundo e-mail nem troca a cópia', async () => {
    const sessao = await contaComCopiaGerada();
    const { conta } = sessao;

    await entregarEventosDaConta(conta.id);
    const primeira = await como(sessao).get('/v1/privacidade').expect(200);
    await entregarEventosDaConta(conta.id);

    const mensagens = await mensagensPara(conta.email, 2, 1_000);
    expect(mensagens).toHaveLength(1);
    const segunda = await como(sessao).get('/v1/privacidade').expect(200);
    expect(segunda.body).toEqual(primeira.body);
    await como(sessao).get('/v1/privacidade/exportacao/arquivo').expect(200);
  });

  it('conta que pediu a cópia e excluiu antes de o assinante rodar: nenhuma cópia, nenhum e-mail', async () => {
    const sessao = await contaComCopiaGerada();
    const { conta } = sessao;
    await como(sessao).post('/v1/privacidade/exclusao').send({ senha: conta.senha }).expect(202);

    await entregarEventosDaConta(conta.id);

    const { rows } = await cenario.dono.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM identidade.exportacoes_titular WHERE conta_id = $1::uuid',
      [conta.id],
    );
    expect(rows[0]?.n).toBe(0);
    expect(await mensagensPara(conta.email, 0)).toHaveLength(0);
  });
});

describe('downloads simultâneos de verdade (S10)', () => {
  it('a 1ª requisição para entre a leitura e a marcação, a 2ª baixa inteira: só a 2ª recebe o arquivo, a 1ª dá 404', async () => {
    const sessao = await contaComCopiaGerada();
    await entregarEventosDaConta(sessao.conta.id);
    const repositorio = cenario.api.app.get(RepositorioDeExportacoes);
    const pausa = pausarDepois(repositorio, 'buscarDisponivel');

    const primeira = como(sessao)
      .get('/v1/privacidade/exportacao/arquivo')
      .then((resposta) => resposta);
    await pausa.chegou;
    // A 1ª já leu a cópia (decifra e marca logo depois); a 2ª faz tudo no meio.
    const segunda = await como(sessao).get('/v1/privacidade/exportacao/arquivo');
    pausa.liberar();
    const resposta1 = await primeira;

    expect(segunda.status).toBe(200);
    expect(JSON.parse(segunda.text)).toHaveProperty('identidade.conta.id', sessao.conta.id);
    expect(resposta1.status).toBe(404);
    // O 404 do perdedor não leva nenhum pedaço da cópia.
    expect(
      sensiveisEncontrados({ perdedora: resposta1.text }, valoresPessoaisDe(sessao.conta)),
    ).toEqual([]);
    // E a cópia segue marcada como baixada uma única vez: nada disponível depois.
    const { rows } = await cenario.dono.query<{ baixada: boolean }>(
      `SELECT baixada_em IS NOT NULL AS baixada
         FROM identidade.exportacoes_titular WHERE conta_id = $1::uuid`,
      [sessao.conta.id],
    );
    expect(rows).toEqual([{ baixada: true }]);
    await como(sessao).get('/v1/privacidade/exportacao/arquivo').expect(404);
  });

  it('com a cópia antiga em download no meio, uma cópia nova a apaga: o download antigo dá 404, nunca o arquivo velho', async () => {
    const sessao = await contaComCopiaGerada();
    await entregarEventosDaConta(sessao.conta.id);
    const repositorio = cenario.api.app.get(RepositorioDeExportacoes);
    const pausa = pausarDepois(repositorio, 'buscarDisponivel');

    const antigo = como(sessao)
      .get('/v1/privacidade/exportacao/arquivo')
      .then((resposta) => resposta);
    await pausa.chegou;
    // O repositório trocou a cópia por outra (S98: a anterior não baixada é apagada).
    expect(await repositorio.apagarNaoBaixadas(sessao.conta.id)).toBe(1);
    pausa.liberar();

    const resposta = await antigo;
    expect(resposta.status).toBe(404);
    expect(resposta.text).not.toContain(sessao.conta.id);
  });
});
