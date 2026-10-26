// Autorização pela API inteira (plano 01b, etapa 19; CA-08, S7):
//
// - `GET /v1/admin/conta`: só admin com segundo fator; os outros recebem 403 e o log da
//   recusa leva só o id da conta (nada de e-mail, nome, telefone ou token);
// - isolamento entre duas contas, recurso por recurso, com o helper reutilizável
//   (`test/helpers/autorizacao.ts`): uma conta nunca lê nem mexe no que é da outra.
import { contaSchema, privacidadeSchema } from '@bairrin/contratos';
import { describe, expect, it } from 'vitest';
import { type Ator, type CasoDeIsolamento, conferirIsolamento } from '../../helpers/autorizacao.ts';
import { sensiveisEncontrados } from '../../helpers/captura-de-log.ts';
import { GerarExportacaoCasoDeUso } from '../../../src/modulos/identidade/aplicacao/privacidade/gerar-exportacao.ts';
import { Email } from '../../../src/modulos/identidade/dominio/email.ts';
import { problemaDe } from './api-http.ts';
import {
  type AdminComSessao,
  type ContaComSessao,
  usarCenarioHttp,
  valoresPessoaisDe,
} from './cenario-http.ts';
import { eventosDaConta, sessoesVivas } from './pilha-de-casos-de-uso.ts';

const cenario = usarCenarioHttp();

function como(ator: { tokenAcesso: string }) {
  const { http } = cenario.api;
  return {
    get: (caminho: string) =>
      http
        .get(caminho)
        .set('Authorization', `Bearer ${ator.tokenAcesso}`)
        .set('X-Forwarded-For', cenario.ip()),
    post: (caminho: string) =>
      http
        .post(caminho)
        .set('Authorization', `Bearer ${ator.tokenAcesso}`)
        .set('X-Forwarded-For', cenario.ip()),
    delete: (caminho: string) =>
      http
        .delete(caminho)
        .set('Authorization', `Bearer ${ator.tokenAcesso}`)
        .set('X-Forwarded-For', cenario.ip()),
  };
}

/** As linhas do log da recusa de admin (a guarda ou as guardas de perfil e de segundo fator). */
function recusasDeAdminNoLog(): Record<string, unknown>[] {
  return cenario.api
    .registrosDoLog()
    .filter((registro) => typeof registro['msg'] === 'string')
    .filter((registro) => String(registro['msg']).startsWith('acesso negado'));
}

function tokensDe(sessao: ContaComSessao | AdminComSessao) {
  return [
    { rotulo: 'token de acesso', valor: sessao.tokenAcesso },
    { rotulo: 'token de renovação', valor: sessao.tokenRenovacao },
  ];
}

describe('GET /v1/admin/conta (CA-08)', () => {
  it('admin com segundo fator: 200 com os dados da conta, `admin` entre os perfis e e-mail mascarado', async () => {
    const admin = await cenario.adminNoPainel();
    const resposta = await como(admin).get('/v1/admin/conta').expect(200);
    const conta = contaSchema.parse(resposta.body);
    expect(conta).toEqual({
      nome: admin.conta.nome,
      emailMascarado: Email.criar(admin.conta.email).mascarado,
      perfis: expect.arrayContaining(['admin', 'consumidor']) as string[],
    });
    expect(resposta.text).not.toContain(admin.conta.email);
  });

  it.each([
    ['conta sem admin (app)', 'consumidor'],
    ['conta admin que entrou pelo app (sem admin nem segundo fator no token)', 'admin-no-app'],
  ] as const)('%s → 403, e o log da recusa traz só o id da conta', async (_nome, quem) => {
    let sessao: ContaComSessao;
    if (quem === 'consumidor') {
      sessao = await cenario.contaNoApp();
    } else {
      const admin = await cenario.adminNoPainel();
      sessao = await cenario.entrarNoApp(admin.conta);
    }
    const antes = recusasDeAdminNoLog().length;

    const resposta = await como(sessao).get('/v1/admin/conta').expect(403);
    expect(problemaDe(resposta.body).codigo).toBe('sem_permissao');

    const recusas = recusasDeAdminNoLog().slice(antes);
    expect(recusas).toHaveLength(1);
    const [recusa] = recusas;
    expect(recusa?.['contaId']).toBe(sessao.conta.id);
    // Nenhum dado pessoal nem token em lugar nenhum do log, nem na resposta.
    expect(
      sensiveisEncontrados({ log: cenario.api.textoDoLog(), resposta: resposta.text }, [
        ...valoresPessoaisDe(sessao.conta),
        ...tokensDe(sessao),
      ]),
    ).toEqual([]);
    // A recusa não revoga a sessão: no app, ela continua.
    await como(sessao).get('/v1/conta').expect(200);
  });
});

// ---------------------------------------------------------------------------
// Isolamento entre contas (S7, CA-08)

interface Par {
  readonly dona: ContaComSessao;
  readonly outra: ContaComSessao;
}

/** Os casos guardam a sessão de cada ator pelo token, para conferir com o banco depois. */
const sessoesPorToken = new Map<string, ContaComSessao>();

async function duasContas(): Promise<Par> {
  const [dona, outra] = await Promise.all([cenario.contaNoApp(), cenario.contaNoApp()]);
  sessoesPorToken.set(dona.tokenAcesso, dona);
  sessoesPorToken.set(outra.tokenAcesso, outra);
  return { dona, outra };
}

function sessaoDo(ator: Ator): ContaComSessao {
  const sessao = sessoesPorToken.get(ator.tokenAcesso);
  if (sessao === undefined) throw new Error(`sessão desconhecida para ${ator.rotulo}`);
  return sessao;
}

async function copiaProntaDe(sessao: ContaComSessao): Promise<void> {
  await como(sessao).post('/v1/privacidade/exportacao').expect(202);
  const eventos = await eventosDaConta(cenario.dono, sessao.conta.id);
  const pedido = eventos.find(({ tipo }) => tipo === 'identidade.ExportacaoSolicitada');
  const { solicitacaoId } = pedido?.payload as { solicitacaoId: string };
  const gerada = await cenario.api.app
    .get(GerarExportacaoCasoDeUso)
    .executar({ contaId: sessao.conta.id, solicitacaoId });
  expect(gerada.tipo).toBe('gerada');
}

const CASOS: readonly CasoDeIsolamento<unknown>[] = [
  {
    nome: 'GET /v1/conta',
    preparar: () => Promise.resolve(undefined),
    tentarComoOutra: (outra) => como(outra).get('/v1/conta'),
    // A outra recebe a própria conta (o nome dela), nunca a da dona.
    statusAceitos: [200],
    conferirIntacto: async (dona) => {
      const resposta = await como(dona).get('/v1/conta').expect(200);
      expect(contaSchema.parse(resposta.body).nome).toBe(sessaoDo(dona).conta.nome);
    },
  },
  {
    nome: 'GET /v1/privacidade',
    preparar: (dona) => copiaProntaDe(sessaoDo(dona)),
    tentarComoOutra: async (outra) => {
      const resposta = await como(outra).get('/v1/privacidade').expect(200);
      // A cópia pronta é da dona: a outra não vê prazo de cópia nenhum.
      expect(privacidadeSchema.parse(resposta.body).exportacaoDisponivelAte).toBeNull();
      return resposta;
    },
    statusAceitos: [200],
    conferirIntacto: async (dona) => {
      const resposta = await como(dona).get('/v1/privacidade').expect(200);
      expect(privacidadeSchema.parse(resposta.body).exportacaoDisponivelAte).not.toBeNull();
    },
  },
  {
    nome: 'GET /v1/privacidade/exportacao/arquivo',
    preparar: (dona) => copiaProntaDe(sessaoDo(dona)),
    tentarComoOutra: (outra) => como(outra).get('/v1/privacidade/exportacao/arquivo'),
    statusAceitos: [404],
    conferirIntacto: async (dona) => {
      // A cópia da dona não foi gasta: ela ainda baixa a dela, uma vez.
      const resposta = await como(dona).get('/v1/privacidade/exportacao/arquivo').expect(200);
      expect(resposta.text).toContain(sessaoDo(dona).conta.email);
    },
  },
  {
    nome: 'POST /v1/privacidade/exportacao',
    preparar: (dona) => copiaProntaDe(sessaoDo(dona)),
    // O pedido da dona nas últimas 24 h não segura o da outra (o limite é por conta).
    tentarComoOutra: (outra) => como(outra).post('/v1/privacidade/exportacao'),
    statusAceitos: [202],
    conferirIntacto: async (dona) => {
      await como(dona).post('/v1/privacidade/exportacao').expect(429);
      await como(dona).get('/v1/privacidade/exportacao/arquivo').expect(200);
    },
  },
  {
    nome: 'POST /v1/privacidade/exclusao (com a senha da dona)',
    preparar: () => Promise.resolve(undefined),
    tentarComoOutra: (outra) => {
      const dona = [...sessoesPorToken.values()].find(
        (sessao) => sessao.tokenAcesso !== outra.tokenAcesso,
      );
      return como(outra)
        .post('/v1/privacidade/exclusao')
        .send({ senha: dona?.conta.senha ?? '' });
    },
    // A senha da dona não serve para excluir a outra conta, e muito menos a da dona.
    statusAceitos: [400],
    conferirIntacto: async (dona) => {
      await como(dona).get('/v1/conta').expect(200);
      expect(await sessoesVivas(cenario.dono, sessaoDo(dona).conta.id)).toBe(1);
    },
  },
  {
    nome: 'DELETE /v1/sessoes/atual',
    preparar: () => Promise.resolve(undefined),
    tentarComoOutra: (outra) => como(outra).delete('/v1/sessoes/atual'),
    // A outra encerra a própria sessão; a da dona segue.
    statusAceitos: [204],
    conferirIntacto: async (dona) => {
      await como(dona).get('/v1/conta').expect(200);
      expect(await sessoesVivas(cenario.dono, sessaoDo(dona).conta.id)).toBe(1);
    },
  },
  {
    nome: 'POST /v1/conta/verificacao-email/reenvio',
    preparar: () => Promise.resolve(undefined),
    tentarComoOutra: (outra) => como(outra).post('/v1/conta/verificacao-email/reenvio'),
    statusAceitos: [202],
    conferirIntacto: async (dona) => {
      // O reenvio da outra não vira evento da dona.
      const eventos = await eventosDaConta(cenario.dono, sessaoDo(dona).conta.id);
      expect(eventos.map(({ tipo }) => tipo)).not.toContain('identidade.VerificacaoReenviada');
    },
  },
];

describe('isolamento entre duas contas, por recurso (S7, CA-08)', () => {
  it.each(CASOS.map((caso) => [caso.nome, caso] as const))('%s', async (_nome, caso) => {
    sessoesPorToken.clear();
    const { dona, outra } = await duasContas();
    await conferirIsolamento(caso, cenario.ator('dona', dona), cenario.ator('outra', outra));
  });
});
