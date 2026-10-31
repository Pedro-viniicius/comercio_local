// Corridas da sessão do app (plano 01b, etapa 12; CA-03, CA-05, S11, Q18): logout, expiração e
// troca de conta que se cruzam com renovação, outro login e fila offline não vazia. Usa o
// `cliente-api` real com a API falsa: o que importa é o que o aparelho guarda e quando a tela de
// login aparece.
import { ErroDeApi } from '@bairrin/cliente-api';
import { z } from '@bairrin/contratos';
import { CHAVE_DA_REVOGACAO_PENDENTE, CHAVE_DA_SESSAO } from './armazenamento-seguro.ts';
import { CAMINHO_DE_ENTRAR, ErroAoLimparDadosDaConta } from './sessao-do-app.ts';
import { adiada, SEM_REDE, type RespostaFalsa } from './teste/api-falsa.ts';
import {
  CREDENCIAIS,
  criarCenario,
  esperarEstado,
  HA_UMA_HORA,
  montarSessao,
  SESSAO_A,
  SESSAO_A_RENOVADA,
  SESSAO_B,
  umaVoltaDoRelogio,
  type Cenario,
} from './teste/cenario.ts';
import { reiniciarEspioes } from './teste/espiao.ts';
import { secureStoreFalso } from './teste/secure-store-falso.ts';

jest.mock('expo-secure-store', () =>
  jest.requireActual<typeof import('./teste/secure-store-falso.ts')>(
    './teste/secure-store-falso.ts',
  ),
);
// A marca de instalação usa o FileSystem: com o espião, ela "existe" e o cofre não apaga nada.
jest.mock('expo-file-system', () =>
  jest
    .requireActual<typeof import('./teste/espiao.ts')>('./teste/espiao.ts')
    .espiao('expo-file-system'),
);

const OK_204: RespostaFalsa = { status: 204 };
const SEGUNDOS_B = { email: 'joao@exemplo.com', senha: 'outra senha qualquer' };

function guardada(chave: string): unknown {
  const valor = secureStoreFalso.itens.get(chave);
  return valor === undefined ? undefined : (JSON.parse(valor) as unknown);
}

/** Fila offline falsa com operações da conta A; `segurar` prende a próxima limpeza. */
function criarFilaDaContaA() {
  const fila = {
    operacoes: ['pedido-da-conta-a-1', 'pedido-da-conta-a-2'],
    limpezas: 0,
    segurar: undefined as Promise<void> | undefined,
    falhar: false,
    limpar: async () => {
      fila.limpezas += 1;
      await fila.segurar;
      if (fila.falhar) throw new Error('sem acesso');
      fila.operacoes.length = 0;
    },
  };
  return fila;
}

async function entrarComA(cenario: Cenario) {
  cenario.api.responder(`POST ${CAMINHO_DE_ENTRAR}`, () => ({ status: 200, corpo: SESSAO_A }));
  const sessao = montarSessao(cenario);
  await sessao.iniciar();
  await sessao.entrar(CREDENCIAIS);
  return sessao;
}

function vencida(sessao = SESSAO_A): string {
  return JSON.stringify({ ...sessao, expiraEm: HA_UMA_HORA });
}

beforeEach(() => {
  secureStoreFalso.reiniciar();
  reiniciarEspioes();
});

describe('logout durante a renovação', () => {
  it('ao abrir o app: a resposta tardia da renovação não regrava a sessão e o login só aparece depois do DELETE', async () => {
    secureStoreFalso.itens.set(CHAVE_DA_SESSAO, vencida());
    const cenario = criarCenario();
    const renovacao = adiada<RespostaFalsa>();
    const revogacao = adiada<RespostaFalsa>();
    cenario.api.responder('POST /v1/sessoes/renovacao', () => renovacao.promessa);
    cenario.api.responder('DELETE /v1/sessoes/atual', () => revogacao.promessa);
    const sessao = montarSessao(cenario);
    const estados: string[] = [];
    sessao.assinar(() => estados.push(sessao.obterSituacao().estado));

    const inicio = sessao.iniciar();
    await umaVoltaDoRelogio();
    const saida = sessao.sair();
    await umaVoltaDoRelogio();

    // Renovação e logout em voo: nada da conta guardado, e ainda sem tela de login.
    expect(sessao.obterSituacao().estado).toBe('carregando');
    expect(guardada(CHAVE_DA_SESSAO)).toBeUndefined();

    renovacao.resolver({ status: 200, corpo: SESSAO_A_RENOVADA });
    await inicio;
    await umaVoltaDoRelogio();
    // A renovação terminou, o DELETE não: a tela de login ainda não pode aparecer.
    expect(sessao.obterSituacao().estado).toBe('carregando');
    expect(guardada(CHAVE_DA_SESSAO)).toBeUndefined();
    expect(estados).not.toContain('com_sessao');

    revogacao.resolver(OK_204);
    await saida;
    expect(sessao.obterSituacao()).toEqual({ estado: 'sem_sessao', emailVerificado: null });
    expect(guardada(CHAVE_DA_SESSAO)).toBeUndefined();
    expect(guardada(CHAVE_DA_REVOGACAO_PENDENTE)).toBeUndefined();
    expect(estados).not.toContain('com_sessao');
    expect(estados.at(-1)).toBe('sem_sessao');
  });

  it('numa requisição com 401: a requisição falha, a sessão renovada não volta e nada da conta fica', async () => {
    const cenario = criarCenario();
    const sessao = await entrarComA(cenario);
    cenario.queryClient.setQueryData(['conta'], { nome: 'Maria' });
    const renovacao = adiada<RespostaFalsa>();
    cenario.api.responder('GET /v1/conta', () => ({ status: 401 }));
    cenario.api.responder('POST /v1/sessoes/renovacao', () => renovacao.promessa);
    cenario.api.responder('DELETE /v1/sessoes/atual', () => OK_204);

    const requisicao = sessao
      .requisitar({ caminho: '/v1/conta', esquema: z.unknown() })
      .catch((erro: unknown) => erro);
    await umaVoltaDoRelogio();
    await sessao.sair();
    renovacao.resolver({ status: 200, corpo: SESSAO_A_RENOVADA });

    // Sem repetir o GET com o token novo de uma sessão que o usuário encerrou.
    expect(await requisicao).toBeInstanceOf(ErroDeApi);
    await umaVoltaDoRelogio();
    expect(cenario.api.pedidos.filter((p) => p.caminho === '/v1/conta')).toHaveLength(1);
    expect(sessao.obterSituacao().estado).toBe('sem_sessao');
    expect(guardada(CHAVE_DA_SESSAO)).toBeUndefined();
    expect(JSON.stringify([...secureStoreFalso.itens])).not.toContain(
      SESSAO_A_RENOVADA.tokenRenovacao ?? 'x',
    );
    expect(cenario.queryClient.getQueryCache().getAll()).toEqual([]);
  });

  it('dois logouts ao mesmo tempo (toque duplo): nada pendente no fim e a tela de login só depois', async () => {
    const cenario = criarCenario();
    const sessao = await entrarComA(cenario);
    const revogacao = adiada<RespostaFalsa>();
    cenario.api.responder('DELETE /v1/sessoes/atual', () => revogacao.promessa);

    const primeiro = sessao.sair();
    const segundo = sessao.sair();
    await umaVoltaDoRelogio();
    expect(sessao.obterSituacao().estado).toBe('carregando');
    revogacao.resolver(OK_204);
    await Promise.all([primeiro, segundo]);

    expect(sessao.obterSituacao().estado).toBe('sem_sessao');
    expect(guardada(CHAVE_DA_SESSAO)).toBeUndefined();
    expect(guardada(CHAVE_DA_REVOGACAO_PENDENTE)).toBeUndefined();
  });
});

describe('logout com a fila offline lenta para apagar', () => {
  it('a tela de login só aparece depois que a fila da conta foi apagada', async () => {
    const fila = criarFilaDaContaA();
    const cenario = criarCenario({ filaOffline: fila });
    const sessao = await entrarComA(cenario);
    fila.operacoes = ['pedido-da-conta-a-1'];
    const limpeza = adiada<void>();
    fila.segurar = limpeza.promessa;
    cenario.api.responder('DELETE /v1/sessoes/atual', () => OK_204);

    const saida = sessao.sair();
    await umaVoltaDoRelogio();
    await umaVoltaDoRelogio();

    expect(sessao.obterSituacao().estado).toBe('carregando');
    expect(fila.operacoes).toHaveLength(1);

    limpeza.resolver();
    await saida;
    expect(sessao.obterSituacao().estado).toBe('sem_sessao');
    expect(fila.operacoes).toEqual([]);
  });
});

describe('expiração durante outras operações', () => {
  it('renovação recusada depois de um login novo não derruba a sessão nova', async () => {
    const cenario = criarCenario();
    const sessao = await entrarComA(cenario);
    const renovacao = adiada<RespostaFalsa>();
    cenario.api.responder('GET /v1/conta', () => ({ status: 401 }));
    cenario.api.responder('POST /v1/sessoes/renovacao', () => renovacao.promessa);
    cenario.api.responder('DELETE /v1/sessoes/atual', () => OK_204);
    cenario.api.responder(`POST ${CAMINHO_DE_ENTRAR}`, () => ({ status: 200, corpo: SESSAO_B }));

    const requisicao = sessao
      .requisitar({ caminho: '/v1/conta', esquema: z.unknown() })
      .catch((erro: unknown) => erro);
    await umaVoltaDoRelogio();
    await sessao.entrar(SEGUNDOS_B);
    renovacao.resolver({ status: 401 });
    await requisicao;
    await umaVoltaDoRelogio();

    expect(sessao.obterSituacao()).toEqual({ estado: 'com_sessao', emailVerificado: true });
    expect(guardada(CHAVE_DA_SESSAO)).toEqual(SESSAO_B);
  });

  it('renovação bem-sucedida da conta A depois da troca para B não sobrescreve B', async () => {
    const cenario = criarCenario();
    const sessao = await entrarComA(cenario);
    const renovacao = adiada<RespostaFalsa>();
    cenario.api.responder('GET /v1/conta', () => ({ status: 401 }));
    cenario.api.responder('POST /v1/sessoes/renovacao', () => renovacao.promessa);
    cenario.api.responder('DELETE /v1/sessoes/atual', () => OK_204);
    cenario.api.responder(`POST ${CAMINHO_DE_ENTRAR}`, () => ({ status: 200, corpo: SESSAO_B }));

    const requisicao = sessao
      .requisitar({ caminho: '/v1/conta', esquema: z.unknown() })
      .catch((erro: unknown) => erro);
    await umaVoltaDoRelogio();
    await sessao.entrar(SEGUNDOS_B);
    renovacao.resolver({ status: 200, corpo: SESSAO_A_RENOVADA });
    await requisicao;
    await umaVoltaDoRelogio();

    expect(guardada(CHAVE_DA_SESSAO)).toEqual(SESSAO_B);
    expect(sessao.obterSituacao()).toEqual({ estado: 'com_sessao', emailVerificado: true });
    // Nem a requisição da conta A é repetida com o token novo dela.
    expect(
      cenario.api.pedidos.some(
        (p) => p.cabecalhos.Authorization === `Bearer ${SESSAO_A_RENOVADA.tokenAcesso}`,
      ),
    ).toBe(false);
  });
});

describe('expiração com a fila offline lenta para apagar', () => {
  it('numa requisição: a tela de login só aparece depois que a fila da conta foi apagada', async () => {
    const fila = criarFilaDaContaA();
    const cenario = criarCenario({ filaOffline: fila });
    const sessao = await entrarComA(cenario);
    fila.operacoes = ['pedido-da-conta-a-1'];
    const limpeza = adiada<void>();
    fila.segurar = limpeza.promessa;
    cenario.api.responder('GET /v1/conta', () => ({ status: 401 }));
    cenario.api.responder('POST /v1/sessoes/renovacao', () => ({ status: 401 }));

    await sessao.requisitar({ caminho: '/v1/conta', esquema: z.unknown() }).catch(() => undefined);
    await umaVoltaDoRelogio();
    await umaVoltaDoRelogio();

    expect(sessao.obterSituacao().estado).not.toBe('sem_sessao');
    expect(fila.operacoes).toHaveLength(1);

    limpeza.resolver();
    await esperarEstado(sessao, 'sem_sessao');
    expect(fila.operacoes).toEqual([]);
  });

  it('ao abrir o app: continua carregando até a fila da conta ser apagada', async () => {
    secureStoreFalso.itens.set(CHAVE_DA_SESSAO, vencida());
    const fila = criarFilaDaContaA();
    const limpeza = adiada<void>();
    fila.segurar = limpeza.promessa;
    const cenario = criarCenario({ filaOffline: fila });
    cenario.api.responder('POST /v1/sessoes/renovacao', () => ({ status: 401 }));
    const sessao = montarSessao(cenario);

    const inicio = sessao.iniciar();
    await umaVoltaDoRelogio();
    await umaVoltaDoRelogio();

    expect(sessao.obterSituacao().estado).toBe('carregando');
    expect(fila.operacoes).toHaveLength(2);

    limpeza.resolver();
    await inicio;
    expect(sessao.obterSituacao().estado).toBe('sem_sessao');
    expect(fila.operacoes).toEqual([]);
  });
});

describe('SecureStore que falha ao gravar', () => {
  it('no login: a sessão vale em memória, o erro vira só a origem e nenhum token fica guardado', async () => {
    const cenario = criarCenario();
    cenario.api.responder(`POST ${CAMINHO_DE_ENTRAR}`, () => ({ status: 200, corpo: SESSAO_A }));
    cenario.api.responder('GET /v1/conta', () => ({ status: 200, corpo: { ok: true } }));
    const sessao = montarSessao(cenario);
    await sessao.iniciar();
    secureStoreFalso.falhas.add(`gravar:${CHAVE_DA_SESSAO}`);

    await sessao.entrar(CREDENCIAIS);

    expect(sessao.obterSituacao()).toEqual({ estado: 'com_sessao', emailVerificado: false });
    expect(cenario.falhas).toEqual([['gravar_sessao']]);
    expect(secureStoreFalso.itens.size).toBe(0);
    await sessao.requisitar({ caminho: '/v1/conta', esquema: z.unknown() });
    expect(cenario.api.pedidos.at(-1)?.cabecalhos.Authorization).toBe(
      `Bearer ${SESSAO_A.tokenAcesso}`,
    );
  });

  it('na renovação: a requisição segue com o token novo e o par antigo não fica guardado', async () => {
    const cenario = criarCenario();
    const sessao = await entrarComA(cenario);
    cenario.api.responder('GET /v1/conta', (pedido) =>
      pedido.cabecalhos.Authorization === `Bearer ${SESSAO_A_RENOVADA.tokenAcesso}`
        ? { status: 200, corpo: { ok: true } }
        : { status: 401 },
    );
    cenario.api.responder('POST /v1/sessoes/renovacao', () => ({
      status: 200,
      corpo: SESSAO_A_RENOVADA,
    }));
    secureStoreFalso.falhas.add(`gravar:${CHAVE_DA_SESSAO}`);

    await expect(
      sessao.requisitar({ caminho: '/v1/conta', esquema: z.object({ ok: z.boolean() }) }),
    ).resolves.toEqual({ ok: true });

    expect(sessao.obterSituacao().estado).toBe('com_sessao');
    // O par antigo, já trocado no servidor, parece reuso na próxima abertura: não pode ficar.
    expect(guardada(CHAVE_DA_SESSAO)).toBeUndefined();
    expect(cenario.falhas).toEqual([['gravar_sessao']]);
  });
});

describe('troca de conta com o SecureStore falhando', () => {
  it('sem conseguir apagar a sessão da conta A, a conta B entra e a falha vira só a origem', async () => {
    const cenario = criarCenario();
    const sessao = await entrarComA(cenario);
    cenario.api.responder('DELETE /v1/sessoes/atual', () => OK_204);
    cenario.api.responder(`POST ${CAMINHO_DE_ENTRAR}`, () => ({ status: 200, corpo: SESSAO_B }));
    secureStoreFalso.falhas.add(`apagar:${CHAVE_DA_SESSAO}`);

    await sessao.entrar(SEGUNDOS_B);

    expect(sessao.obterSituacao()).toEqual({ estado: 'com_sessao', emailVerificado: true });
    expect(guardada(CHAVE_DA_SESSAO)).toEqual(SESSAO_B);
    expect(cenario.falhas.map(([origem]) => origem)).toContain('limpar_sessao');
    expect(JSON.stringify(cenario.falhas)).not.toContain('falha nativa');
  });

  it('sem conseguir ler a sessão da conta A, a conta B entra mesmo assim', async () => {
    const cenario = criarCenario();
    cenario.api.responder(`POST ${CAMINHO_DE_ENTRAR}`, () => ({ status: 200, corpo: SESSAO_B }));
    // Sem `iniciar()`: a sessão ainda não foi lida, então o login é que tenta a leitura que falha.
    const sessao = montarSessao(cenario);
    secureStoreFalso.itens.set(CHAVE_DA_SESSAO, JSON.stringify(SESSAO_A));
    secureStoreFalso.falhas.add(`ler:${CHAVE_DA_SESSAO}`);

    await sessao.entrar(SEGUNDOS_B);

    expect(sessao.obterSituacao()).toEqual({ estado: 'com_sessao', emailVerificado: true });
    expect(guardada(CHAVE_DA_SESSAO)).toEqual(SESSAO_B);
  });
});

describe('troca de conta com fila offline não vazia', () => {
  it('a conta nova só é guardada depois que a fila da anterior foi apagada, e nenhuma operação da A sobra', async () => {
    const fila = criarFilaDaContaA();
    const cenario = criarCenario({ filaOffline: fila });
    const sessao = await entrarComA(cenario);
    fila.operacoes = ['pedido-da-conta-a-1', 'pedido-da-conta-a-2'];
    fila.limpezas = 0;
    const limpeza = adiada<void>();
    fila.segurar = limpeza.promessa;
    cenario.api.responder('DELETE /v1/sessoes/atual', () => OK_204);
    cenario.api.responder(`POST ${CAMINHO_DE_ENTRAR}`, () => ({ status: 200, corpo: SESSAO_B }));

    const troca = sessao.entrar(SEGUNDOS_B);
    await umaVoltaDoRelogio();
    await umaVoltaDoRelogio();

    // Com a fila ainda presa, a conta B não pode estar no aparelho.
    expect(fila.limpezas).toBeGreaterThanOrEqual(1);
    expect(guardada(CHAVE_DA_SESSAO)).toBeUndefined();
    expect(fila.operacoes).toHaveLength(2);

    limpeza.resolver();
    await troca;
    expect(fila.operacoes).toEqual([]);
    expect(guardada(CHAVE_DA_SESSAO)).toEqual(SESSAO_B);
    expect(sessao.obterSituacao()).toEqual({ estado: 'com_sessao', emailVerificado: true });
  });

  // Q36 (= R8, S131): corrigido; a sessão B é revogada e o estado volta ao login.
  it('se a fila da conta A não puder ser apagada, a interface não fica "com sessão" sem sessão guardada', async () => {
    const fila = criarFilaDaContaA();
    const cenario = criarCenario({ filaOffline: fila });
    const sessao = await entrarComA(cenario);
    fila.falhar = true;
    cenario.api.responder('DELETE /v1/sessoes/atual', () => OK_204);
    cenario.api.responder(`POST ${CAMINHO_DE_ENTRAR}`, () => ({ status: 200, corpo: SESSAO_B }));

    await expect(sessao.entrar(SEGUNDOS_B)).rejects.toBeInstanceOf(ErroAoLimparDadosDaConta);

    // A conta B não entrou nunca; a A foi encerrada no aparelho (a revogação foi enviada).
    expect(guardada(CHAVE_DA_SESSAO)).toBeUndefined();
    expect(JSON.stringify([...secureStoreFalso.itens])).not.toContain(SESSAO_B.tokenAcesso);
    // O estado mostrado às telas tem de acompanhar o que está guardado.
    expect(sessao.obterSituacao().estado).toBe('sem_sessao');
  });

  it('login enquanto o logout anterior ainda corre: a sessão nova não é apagada pelo fim do logout', async () => {
    const cenario = criarCenario();
    const sessao = await entrarComA(cenario);
    const revogacao = adiada<RespostaFalsa>();
    cenario.api.responder('DELETE /v1/sessoes/atual', () => revogacao.promessa);
    cenario.api.responder(`POST ${CAMINHO_DE_ENTRAR}`, () => ({ status: 200, corpo: SESSAO_B }));

    const saida = sessao.sair();
    await umaVoltaDoRelogio();
    await sessao.entrar(SEGUNDOS_B);
    revogacao.resolver(OK_204);
    await saida;
    await umaVoltaDoRelogio();

    expect(sessao.obterSituacao()).toEqual({ estado: 'com_sessao', emailVerificado: true });
    expect(guardada(CHAVE_DA_SESSAO)).toEqual(SESSAO_B);
  });
});

// Rodada 2 (R8 e R9): nova tentativa depois da falha da fila e bordas do `substituirSessao`.
describe('depois da falha da fila (R8): nova tentativa', () => {
  const SESSAO_B2 = {
    ...SESSAO_B,
    tokenAcesso: 'eyJhbGciOiJIUzI1NiJ9.acesso-da-conta-b-segundo-login.assinatura-b2',
    tokenRenovacao: 'renovacao-da-conta-b-segundo-login-0123456789',
  };

  it('com a fila de volta, o segundo login entra; o par recusado antes não vira a sessão nem sai da pendência sem rede', async () => {
    const fila = criarFilaDaContaA();
    const cenario = criarCenario({ filaOffline: fila });
    const sessao = await entrarComA(cenario);
    fila.falhar = true;
    cenario.api.responder('DELETE /v1/sessoes/atual', () => SEM_REDE);
    cenario.api.responder(`POST ${CAMINHO_DE_ENTRAR}`, () => ({ status: 200, corpo: SESSAO_B }));
    await expect(sessao.entrar(SEGUNDOS_B)).rejects.toBeInstanceOf(ErroAoLimparDadosDaConta);
    expect(sessao.obterSituacao().estado).toBe('sem_sessao');

    fila.falhar = false;
    cenario.api.responder(`POST ${CAMINHO_DE_ENTRAR}`, () => ({ status: 200, corpo: SESSAO_B2 }));
    await sessao.entrar(SEGUNDOS_B);

    expect(sessao.obterSituacao()).toEqual({ estado: 'com_sessao', emailVerificado: true });
    expect(guardada(CHAVE_DA_SESSAO)).toEqual(SESSAO_B2);
    // A pendência (sem rede) guarda só os pares antigos, nunca o da sessão em uso.
    const pendencia = JSON.stringify(guardada(CHAVE_DA_REVOGACAO_PENDENTE) ?? null);
    expect(pendencia).toContain(SESSAO_B.tokenAcesso);
    expect(pendencia).not.toContain(SESSAO_B2.tokenAcesso);
    expect(fila.operacoes).toEqual([]);
  });

  it('login recusado pela fila numa instalação sem sessão: nada fica guardado e o estado é sem_sessao', async () => {
    const fila = criarFilaDaContaA();
    fila.falhar = true;
    const cenario = criarCenario({ filaOffline: fila });
    cenario.api.responder('DELETE /v1/sessoes/atual', () => OK_204);
    cenario.api.responder(`POST ${CAMINHO_DE_ENTRAR}`, () => ({ status: 200, corpo: SESSAO_B }));
    const sessao = montarSessao(cenario);
    await sessao.iniciar();

    await expect(sessao.entrar(SEGUNDOS_B)).rejects.toBeInstanceOf(ErroAoLimparDadosDaConta);

    expect(secureStoreFalso.itens.size).toBe(0);
    expect(sessao.obterSituacao()).toEqual({ estado: 'sem_sessao', emailVerificado: null });
    const revogacoes = cenario.api.pedidos.filter((p) => p.metodo === 'DELETE');
    expect(revogacoes.map((p) => p.cabecalhos.Authorization)).toEqual([
      `Bearer ${SESSAO_B.tokenAcesso}`,
    ]);
  });
});

describe('segundo login enquanto a revogação da sessão recusada ainda corre (R8)', () => {
  it('o fim do primeiro login recusado não derruba a sessão do segundo', async () => {
    const SESSAO_B2 = {
      ...SESSAO_B,
      tokenAcesso: 'eyJhbGciOiJIUzI1NiJ9.acesso-da-conta-b-segundo-login.assinatura-b2',
      tokenRenovacao: 'renovacao-da-conta-b-segundo-login-0123456789',
    };
    const fila = criarFilaDaContaA();
    const cenario = criarCenario({ filaOffline: fila });
    const sessao = await entrarComA(cenario);
    fila.falhar = true;
    const revogacaoDeB = adiada<RespostaFalsa>();
    let delecoes = 0;
    cenario.api.responder('DELETE /v1/sessoes/atual', () => {
      delecoes += 1;
      // 1ª: a conta A, na troca. 2ª: a sessão B recusada, que fica em voo.
      return delecoes === 2 ? revogacaoDeB.promessa : OK_204;
    });
    cenario.api.responder(`POST ${CAMINHO_DE_ENTRAR}`, () => ({ status: 200, corpo: SESSAO_B }));
    const primeiro = sessao.entrar(SEGUNDOS_B).catch((erro: unknown) => erro);
    await umaVoltaDoRelogio();
    await umaVoltaDoRelogio();
    expect(delecoes).toBe(2);

    fila.falhar = false;
    cenario.api.responder(`POST ${CAMINHO_DE_ENTRAR}`, () => ({ status: 200, corpo: SESSAO_B2 }));
    await sessao.entrar(SEGUNDOS_B);
    expect(sessao.obterSituacao().estado).toBe('com_sessao');
    revogacaoDeB.resolver(OK_204);
    expect(await primeiro).toBeInstanceOf(ErroAoLimparDadosDaConta);
    await umaVoltaDoRelogio();

    expect(sessao.obterSituacao()).toEqual({ estado: 'com_sessao', emailVerificado: true });
    expect(guardada(CHAVE_DA_SESSAO)).toEqual(SESSAO_B2);
  });
});

describe('substituirSessao, bordas (R9)', () => {
  const CAMINHO = '/v1/conta/verificacao-email';
  const PEDIDO = { metodo: 'POST', caminho: CAMINHO, corpo: { codigo: '123456' } } as const;
  const A_VERIFICADA = { ...SESSAO_A_RENOVADA, emailVerificado: true };

  it('resposta que não é uma sessão: rejeita, a sessão guardada fica e nada é revogado', async () => {
    const cenario = criarCenario();
    const sessao = await entrarComA(cenario);
    cenario.api.responder(`POST ${CAMINHO}`, () => ({
      status: 200,
      corpo: { tokenAcesso: 'so-um-token' },
    }));

    await expect(sessao.substituirSessao(PEDIDO)).rejects.toBeDefined();

    expect(guardada(CHAVE_DA_SESSAO)).toEqual(SESSAO_A);
    expect(sessao.obterSituacao()).toEqual({ estado: 'com_sessao', emailVerificado: false });
    expect(cenario.api.pedidos.some((p) => p.metodo === 'DELETE')).toBe(false);
    expect(JSON.stringify([...secureStoreFalso.itens])).not.toContain('so-um-token');
  });

  it('o SecureStore falha ao gravar: a sessão nova vale em memória, avisa só a origem e não rejeita', async () => {
    const cenario = criarCenario();
    const sessao = await entrarComA(cenario);
    cenario.api.responder(`POST ${CAMINHO}`, () => ({ status: 200, corpo: A_VERIFICADA }));
    secureStoreFalso.falhas.add(`gravar:${CHAVE_DA_SESSAO}`);

    await expect(sessao.substituirSessao(PEDIDO)).resolves.toBeUndefined();

    expect(sessao.obterSituacao()).toEqual({ estado: 'com_sessao', emailVerificado: true });
    expect(cenario.falhas).toEqual([['gravar_sessao']]);
    cenario.api.responder('GET /v1/conta', () => ({ status: 200, corpo: {} }));
    await sessao.requisitar({ caminho: '/v1/conta', esquema: z.unknown() });
    expect(cenario.api.pedidos.at(-1)?.cabecalhos.Authorization).toBe(
      `Bearer ${A_VERIFICADA.tokenAcesso}`,
    );
  });

  it('o token de acesso venceu: renova, repete a verificação com o token novo e guarda a sessão da resposta', async () => {
    const cenario = criarCenario();
    const sessao = await entrarComA(cenario);
    const respostas = [{ status: 401 }, { status: 200, corpo: A_VERIFICADA }];
    cenario.api.responder(`POST ${CAMINHO}`, () => respostas.shift() ?? { status: 500 });
    cenario.api.responder('POST /v1/sessoes/renovacao', () => ({
      status: 200,
      corpo: SESSAO_A_RENOVADA,
    }));

    await sessao.substituirSessao(PEDIDO);

    const verificacoes = cenario.api.pedidos.filter((p) => p.caminho === CAMINHO);
    expect(verificacoes.map((p) => p.cabecalhos.Authorization)).toEqual([
      `Bearer ${SESSAO_A.tokenAcesso}`,
      `Bearer ${SESSAO_A_RENOVADA.tokenAcesso}`,
    ]);
    expect(guardada(CHAVE_DA_SESSAO)).toEqual(A_VERIFICADA);
    expect(sessao.obterSituacao()).toEqual({ estado: 'com_sessao', emailVerificado: true });
  });

  it('sem sessão no aparelho, uma sessão devolvida não reabre a conta: é revogada e nada fica guardado', async () => {
    const cenario = criarCenario();
    const sessao = montarSessao(cenario);
    await sessao.iniciar();
    cenario.api.responder(`POST ${CAMINHO}`, () => ({ status: 200, corpo: A_VERIFICADA }));
    cenario.api.responder('DELETE /v1/sessoes/atual', () => OK_204);

    await sessao.substituirSessao(PEDIDO);

    expect(sessao.obterSituacao()).toEqual({ estado: 'sem_sessao', emailVerificado: null });
    expect(secureStoreFalso.itens.size).toBe(0);
    expect(cenario.api.pedidos.at(-1)).toMatchObject({
      metodo: 'DELETE',
      cabecalhos: { Authorization: `Bearer ${A_VERIFICADA.tokenAcesso}` },
    });
  });

  it('a sessão expirou durante a verificação (401 e renovação recusada): rejeita e a tela volta ao login', async () => {
    const cenario = criarCenario();
    const sessao = await entrarComA(cenario);
    cenario.api.responder(`POST ${CAMINHO}`, () => ({ status: 401 }));
    cenario.api.responder('POST /v1/sessoes/renovacao', () => ({ status: 401 }));
    cenario.api.responder('DELETE /v1/sessoes/atual', () => OK_204);

    await expect(sessao.substituirSessao(PEDIDO)).rejects.toBeInstanceOf(ErroDeApi);
    await esperarEstado(sessao, 'sem_sessao');

    expect(guardada(CHAVE_DA_SESSAO)).toBeUndefined();
  });
});
