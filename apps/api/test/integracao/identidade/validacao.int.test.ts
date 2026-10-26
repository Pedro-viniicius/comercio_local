// CA-13 em todas as rotas (plano 01b, etapa 19): payload com campo desconhecido ou inválido
// → 400 `validacao` com os campos e os motivos em português. A lista de rotas sai do
// inventário da aplicação (`rotasDaAplicacao`), não de uma lista à mão: rota nova sem
// entrada no catálogo do cenário reprova em `rotas-protegidas.int.test.ts`, e aqui entra
// sozinha. Cada rota recebe o acesso que pede (sessão de app, sessão de admin no painel,
// `X-Cliente: painel` com a origem), para a recusa ser do pipe, e não da guarda.
//
// Ficam de fora só as sondas do Fly (`/v1/saude`, `/v1/saude/pronto`): públicas, sem corpo
// e sem dado.
import type { CampoDoProblema } from '@bairrin/contratos';
import { describe, expect, it } from 'vitest';
import { rotasDaAplicacao } from '../../helpers/autorizacao.ts';
import { problemaDe } from './api-http.ts';
import {
  type AdminComSessao,
  type ContaComSessao,
  pedidoPara,
  PEDIDOS_DAS_ROTAS,
  usarCenarioHttp,
} from './cenario-http.ts';

const cenario = usarCenarioHttp();

/** O motivo do zod `ptBR` do contrato para campo desconhecido. */
const MOTIVO_DESCONHECIDO = 'Campo desconhecido.';

/** Palavras das mensagens padrão do zod em inglês: nenhuma pode sobrar num motivo. */
const MOTIVO_EM_INGLES = /\b(expected|received|invalid|required|unrecognized|string|number)\b/i;

function rotasDoCa13() {
  return rotasDaAplicacao(cenario.api.app)
    .map((rota) => ({ rota, pedido: PEDIDOS_DAS_ROTAS[rota.nome] }))
    .filter(({ pedido }) => pedido?.foraDoCa13 === undefined);
}

/** Sessão que a rota pede, nova a cada pedido (o 400 não pode depender de outro pedido). */
async function acessoPara(nome: string): Promise<{
  tokenAcesso?: string;
  sessao: ContaComSessao | AdminComSessao | null;
}> {
  switch (PEDIDOS_DAS_ROTAS[nome]?.acesso) {
    case 'sessao': {
      const sessao = await cenario.contaNoApp();
      return { tokenAcesso: sessao.tokenAcesso, sessao };
    }
    case 'admin': {
      const sessao = await cenario.adminNoPainel();
      return { tokenAcesso: sessao.tokenAcesso, sessao };
    }
    default:
      return { sessao: null };
  }
}

function conferirMotivos(campos: readonly CampoDoProblema[] | undefined, nome: string): void {
  expect(campos?.length, nome).toBeGreaterThan(0);
  for (const campo of campos ?? []) {
    expect(campo.motivo.trim(), `${nome} ${campo.campo}`).not.toBe('');
    expect(campo.motivo, `${nome} ${campo.campo}`).not.toMatch(MOTIVO_EM_INGLES);
  }
}

describe('CA-13: campo desconhecido em todas as rotas', () => {
  it('cobre as rotas da aplicação (menos as sondas do Fly)', () => {
    expect(rotasDoCa13().length).toBe(rotasDaAplicacao(cenario.api.app).length - 2);
  });

  it('cada rota, com o corpo certo e um campo a mais, responde 400 `desconhecido` só nesse campo', async () => {
    for (const { rota, pedido } of rotasDoCa13()) {
      const { tokenAcesso, sessao } = await acessoPara(rota.nome);
      const conta = sessao?.conta ?? (await cenario.novaConta());
      const corpo = { ...(pedido?.corpo?.(conta) ?? {}), intruso: 'x' };

      const resposta = await pedidoPara(
        cenario,
        rota.nome,
        tokenAcesso === undefined ? {} : { tokenAcesso },
      ).send(corpo);

      expect(resposta.status, rota.nome).toBe(400);
      const problema = problemaDe(resposta.body);
      expect(problema.codigo, rota.nome).toBe('validacao');
      expect(problema.campos, rota.nome).toEqual([
        { campo: 'intruso', codigo: 'desconhecido', motivo: MOTIVO_DESCONHECIDO },
      ]);
    }
  });
});

describe('CA-13: campo inválido em todas as rotas', () => {
  it('rota com corpo: cada campo com o tipo errado aparece em `campos`, com motivo em português', async () => {
    const comCorpo = rotasDoCa13().filter(({ pedido }) => pedido?.corpo !== undefined);
    expect(comCorpo.length).toBeGreaterThanOrEqual(9);
    for (const { rota, pedido } of comCorpo) {
      const { tokenAcesso, sessao } = await acessoPara(rota.nome);
      const conta = sessao?.conta ?? (await cenario.novaConta());
      const valido = pedido?.corpo?.(conta) ?? {};
      const invalido = Object.fromEntries(Object.keys(valido).map((campo) => [campo, 12345]));

      const resposta = await pedidoPara(
        cenario,
        rota.nome,
        tokenAcesso === undefined ? {} : { tokenAcesso },
      ).send(invalido);

      expect(resposta.status, rota.nome).toBe(400);
      const problema = problemaDe(resposta.body);
      expect(problema.codigo, rota.nome).toBe('validacao');
      const camposComErro = new Set(problema.campos?.map(({ campo }) => campo.split('.')[0]));
      expect(camposComErro, rota.nome).toEqual(new Set(Object.keys(valido)));
      conferirMotivos(problema.campos, rota.nome);
      // O valor enviado não volta na resposta.
      expect(resposta.text, rota.nome).not.toContain('12345');
    }
  });

  it('rota sem corpo: corpo que não é objeto (lista) → 400 com motivo em português', async () => {
    const semCorpo = rotasDoCa13().filter(({ pedido }) => pedido?.corpo === undefined);
    expect(semCorpo.map(({ rota }) => rota.nome)).toEqual(
      expect.arrayContaining(['GET /v1/conta', 'POST /v1/privacidade/exportacao']),
    );
    for (const { rota } of semCorpo) {
      const { tokenAcesso } = await acessoPara(rota.nome);
      const resposta = await pedidoPara(
        cenario,
        rota.nome,
        tokenAcesso === undefined ? {} : { tokenAcesso },
      ).send([1, 2]);

      expect(resposta.status, rota.nome).toBe(400);
      const problema = problemaDe(resposta.body);
      expect(problema.codigo, rota.nome).toBe('validacao');
      conferirMotivos(problema.campos, rota.nome);
    }
  });
});
