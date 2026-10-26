// Cenário comum dos testes transversais das rotas da Identidade (plano 01b, etapa 19): a
// API inteira (`subirApi`), a pilha de casos de uso para preparar contas, o dono do banco
// para ler e limpar, e atalhos para contas com sessão nos apps e no painel. Não é um teste:
// fica fora do filtro `*.int.test.ts`.
//
// Uso: `const cenario = usarCenarioHttp()` no topo do arquivo registra o `beforeAll`, o
// `beforeEach` (relógio em `T0`) e o `afterAll` (limpeza das contas e dos freios criados).
import { randomInt } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Type } from '@nestjs/common';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import type { ValorSensivel } from '../../helpers/captura-de-log.ts';
import type { Ator } from '../../helpers/autorizacao.ts';
import { type ApiDeTeste, ipNovo, ORIGEM_DO_PAINEL, sessaoDe, subirApi } from './api-http.ts';
import {
  apagarContasDoTeste,
  cadastrar,
  type ContaDeTeste,
  conectarDono,
  type DocumentosDeTeste,
  montarPilha,
  OUTRA_SENHA,
  type Pilha,
  prepararAdmin,
  semearDocumentos,
  T0,
} from './pilha-de-casos-de-uso.ts';

/** Conta com uma sessão aberta num app. */
export interface ContaComSessao {
  readonly conta: ContaDeTeste;
  readonly tokenAcesso: string;
  readonly tokenRenovacao: string;
}

/** Conta admin com o segundo fator configurado e uma sessão do painel (`admin`, `mfa`). */
export interface AdminComSessao {
  readonly conta: ContaDeTeste;
  readonly segredo: string;
  readonly recuperacao: readonly string[];
  readonly tokenAcesso: string;
  readonly tokenRenovacao: string;
}

export interface CenarioHttp {
  readonly p: Pilha;
  readonly dono: pg.Client;
  readonly docs: DocumentosDeTeste;
  readonly api: ApiDeTeste;
  /** Um IP novo por requisição, para os limites por IP de um teste não pegarem outro. */
  ip(): string;
  /** Põe a conta (e os freios dela) na limpeza do `afterAll`. */
  anotar(conta: { id: string; email: string }): void;
  /** Cadastra pelo caso de uso (com o hash real). */
  novaConta(): Promise<ContaDeTeste>;
  /** Cadastra e entra num app pela rota. */
  contaNoApp(cliente?: 'app_consumidor' | 'app_lojista'): Promise<ContaComSessao>;
  /** Entra num app pela rota com uma conta já cadastrada. */
  entrarNoApp(
    conta: ContaDeTeste,
    cliente?: 'app_consumidor' | 'app_lojista',
  ): Promise<ContaComSessao>;
  /** Conta admin com 2FA e a sessão do painel aberta pela confirmação. */
  adminNoPainel(): Promise<AdminComSessao>;
  /** O ator do helper de isolamento: token e valores pessoais da conta. */
  ator(rotulo: string, sessao: ContaComSessao | AdminComSessao): Ator;
}

/** Seis letras sorteadas, com a primeira maiúscula (o nome só aceita letras). */
function sobrenomeUnico(): string {
  const letras = 'abcdefghijklmnopqrstuvwxyz';
  const sorteadas = Array.from({ length: 6 }, () => letras[randomInt(letras.length)]).join('');
  return `${sorteadas.charAt(0).toUpperCase()}${sorteadas.slice(1)}`;
}

/** Os valores pessoais e a senha da conta, para as varreduras (CA-12). */
export function valoresPessoaisDe(conta: ContaDeTeste): ValorSensivel[] {
  return [
    { rotulo: 'e-mail', valor: conta.email },
    { rotulo: 'nome', valor: conta.nome },
    { rotulo: 'telefone', valor: conta.telefone },
    { rotulo: 'senha', valor: conta.senha },
  ];
}

/** Registra os ganchos do arquivo e devolve o cenário (os campos valem depois do `beforeAll`). */
export function usarCenarioHttp(
  opcoes: {
    controllers?: Type[];
    antesDeIniciar?: (app: NestExpressApplication) => void;
  } = {},
): CenarioHttp {
  let p: Pilha | undefined;
  let dono: pg.Client | undefined;
  let docs: DocumentosDeTeste | undefined;
  let api: ApiDeTeste | undefined;
  const contasDoTeste: string[] = [];
  const freiosDoTeste: string[] = [];

  const exigir = <T>(valor: T | undefined, nome: string): T => {
    if (valor === undefined) throw new Error(`${nome} só existe depois do beforeAll`);
    return valor;
  };

  beforeAll(async () => {
    p = montarPilha();
    dono = await conectarDono();
    docs = await semearDocumentos(dono);
    api = await subirApi(opcoes);
  });

  beforeEach(() => {
    api?.relogio.definir(T0);
  });

  afterAll(async () => {
    await api?.fechar();
    if (dono !== undefined) {
      await apagarContasDoTeste(dono, contasDoTeste, freiosDoTeste);
      await docs?.remover();
      await dono.end();
    }
    await p?.prisma.$disconnect();
  });

  const cenario: CenarioHttp = {
    get p() {
      return exigir(p, 'a pilha');
    },
    get dono() {
      return exigir(dono, 'o dono');
    },
    get docs() {
      return exigir(docs, 'os documentos');
    },
    get api() {
      return exigir(api, 'a API');
    },
    ip: () => ipNovo(cenario.p, freiosDoTeste),
    anotar(conta) {
      contasDoTeste.push(conta.id);
      freiosDoTeste.push(
        cenario.p.servicos.cifrador.hmac('bloqueio_email', [conta.email]),
        cenario.p.servicos.cifrador.hmac('bloqueio_segundo_fator', [conta.id]),
      );
    },
    async novaConta() {
      // Nome, celular e senha únicos: a varredura de uma conta não pode achar os dados da
      // outra, e a senha de uma não pode servir na outra.
      const conta = await cadastrar(cenario.p, cenario.docs, {
        nome: `Ana ${sobrenomeUnico()}`,
        telefone: `+55359${String(randomInt(10_000_000, 100_000_000))}`,
        senha: `cavalo-${sobrenomeUnico().toLowerCase()}-azul-72`,
      });
      cenario.anotar(conta);
      return conta;
    },
    async entrarNoApp(conta, cliente = 'app_consumidor') {
      const resposta = await cenario.api.http
        .post('/v1/sessoes')
        .set('X-Forwarded-For', cenario.ip())
        .send({ email: conta.email, senha: conta.senha, cliente })
        .expect(200);
      const sessao = sessaoDe(resposta.body);
      if (sessao.tokenRenovacao === undefined) throw new Error('sessão de app sem renovação');
      return { conta, tokenAcesso: sessao.tokenAcesso, tokenRenovacao: sessao.tokenRenovacao };
    },
    async contaNoApp(cliente = 'app_consumidor') {
      return cenario.entrarNoApp(await cenario.novaConta(), cliente);
    },
    async adminNoPainel() {
      const admin = await prepararAdmin(cenario.p, cenario.docs, cenario.ip());
      cenario.anotar(admin.conta);
      return {
        conta: admin.conta,
        segredo: admin.segredo,
        recuperacao: admin.recuperacao,
        tokenAcesso: admin.sessao.tokenAcesso,
        tokenRenovacao: admin.sessao.tokenRenovacao,
      };
    },
    ator(rotulo, sessao) {
      return {
        rotulo,
        tokenAcesso: sessao.tokenAcesso,
        valoresPessoais: valoresPessoaisDe(sessao.conta),
      };
    },
  };
  return cenario;
}

// ---------------------------------------------------------------------------
// Catálogo das rotas: como chegar a cada uma (CA-13, S7, S8)

/**
 * O que a rota exige para chegar ao pipe e ao caso de uso:
 * - `publica`: nada (`@Publico()`);
 * - `sessao`: `Authorization: Bearer` de uma sessão de app;
 * - `admin`: `Authorization: Bearer` da sessão do painel com `admin` e segundo fator;
 * - `cookie_do_painel`: `X-Cliente: painel` e a origem do painel (logout pelo cookie, S80).
 */
export type AcessoDaRota = 'publica' | 'sessao' | 'admin' | 'cookie_do_painel';

export interface PedidoDaRota {
  readonly acesso: AcessoDaRota;
  /**
   * Corpo válido na forma, com os campos certos (não precisa dar certo no caso de uso).
   * Sem `corpo`, a rota não tem corpo (aceita só `{}` ou nada).
   */
  readonly corpo?: (conta: ContaDeTeste) => Record<string, unknown>;
  /** Fora da varredura de corpo do CA-13, com o motivo. */
  readonly foraDoCa13?: string;
}

/** Senha que não é a de nenhuma conta de teste. */
export const SENHA_QUE_NAO_CONFERE = 'senha-que-nao-confere-37';

/**
 * Toda rota da aplicação, com o que ela exige. Os testes transversais conferem que a lista
 * cobre o inventário (`rotasDaAplicacao`): rota nova sem entrada aqui reprova.
 */
export const PEDIDOS_DAS_ROTAS: Readonly<Record<string, PedidoDaRota>> = {
  'GET /v1/saude': { acesso: 'publica', foraDoCa13: 'sonda do Fly, sem corpo nem dado' },
  'GET /v1/saude/pronto': { acesso: 'publica', foraDoCa13: 'sonda do Fly, sem corpo nem dado' },
  'POST /v1/contas': {
    acesso: 'publica',
    corpo: (conta) => ({
      nome: conta.nome,
      email: conta.email,
      telefone: conta.telefone,
      senha: conta.senha,
      aceites: { termos: 'v-qualquer', privacidade: 'v-qualquer' },
    }),
  },
  'POST /v1/sessoes': {
    acesso: 'publica',
    corpo: (conta) => ({ email: conta.email, senha: conta.senha, cliente: 'app_consumidor' }),
  },
  'POST /v1/sessoes/renovacao': {
    acesso: 'publica',
    corpo: () => ({ tokenRenovacao: 'token-qualquer', cliente: 'app_consumidor' }),
  },
  'DELETE /v1/sessoes/renovacao': { acesso: 'cookie_do_painel' },
  'DELETE /v1/sessoes/atual': { acesso: 'sessao' },
  'POST /v1/senha/recuperacao': { acesso: 'publica', corpo: (conta) => ({ email: conta.email }) },
  'POST /v1/senha/redefinicao': {
    acesso: 'publica',
    corpo: (conta) => ({ email: conta.email, codigo: '123456', novaSenha: OUTRA_SENHA }),
  },
  'POST /v1/segundo-fator/configuracao': { acesso: 'publica', corpo: () => ({ desafio: 'a.b' }) },
  'POST /v1/segundo-fator/confirmacao': {
    acesso: 'publica',
    corpo: () => ({ desafio: 'a.b', codigo: '123456' }),
  },
  'POST /v1/sessoes/segundo-fator': {
    acesso: 'publica',
    corpo: () => ({ desafio: 'a.b', codigo: '123456' }),
  },
  'POST /v1/conta/verificacao-email': { acesso: 'sessao', corpo: () => ({ codigo: '123456' }) },
  'POST /v1/conta/verificacao-email/reenvio': { acesso: 'sessao' },
  'GET /v1/conta': { acesso: 'sessao' },
  'GET /v1/privacidade': { acesso: 'sessao' },
  'POST /v1/privacidade/exportacao': { acesso: 'sessao' },
  'GET /v1/privacidade/exportacao/arquivo': { acesso: 'sessao' },
  'POST /v1/privacidade/exclusao': {
    acesso: 'sessao',
    corpo: () => ({ senha: SENHA_QUE_NAO_CONFERE }),
  },
  'GET /v1/admin/conta': { acesso: 'admin' },
};

/** O pedido da rota pronto para `.send()`: método, caminho, IP novo e os cabeçalhos do acesso. */
export function pedidoPara(
  cenario: CenarioHttp,
  nome: string,
  opcoes: { tokenAcesso?: string } = {},
) {
  const [metodo = '', caminho = ''] = nome.split(' ');
  const acesso = PEDIDOS_DAS_ROTAS[nome]?.acesso;
  const http = cenario.api.http;
  const pedido = (() => {
    switch (metodo) {
      case 'GET':
        return http.get(caminho);
      case 'POST':
        return http.post(caminho);
      case 'DELETE':
        return http.delete(caminho);
      default:
        throw new Error(`método sem pedido no cenário: ${metodo}`);
    }
  })().set('X-Forwarded-For', cenario.ip());
  if (opcoes.tokenAcesso !== undefined) pedido.set('Authorization', `Bearer ${opcoes.tokenAcesso}`);
  if (acesso === 'cookie_do_painel')
    pedido.set('X-Cliente', 'painel').set('Origin', ORIGEM_DO_PAINEL);
  return pedido;
}
