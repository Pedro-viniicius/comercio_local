// Sessão do app sem React (plano 01b, etapa 12; CA-03, CA-05, S11, S80, Q18): limpeza no logout,
// na expiração e na troca de conta, ordem da tela de login, `clienteDoApp` e falhas só com a origem.
import { ErroDeApi } from '@bairrin/cliente-api';
import { z } from '@bairrin/contratos';
import {
  CHAVE_DA_REVOGACAO_PENDENTE,
  CHAVE_DA_SESSAO,
  criarCofreDaSessao,
} from './armazenamento-seguro.ts';
import { CAMINHO_DE_ENTRAR, ErroAoLimparDadosDaConta } from './sessao-do-app.ts';
import { adiada, SEM_REDE, type RespostaFalsa } from './teste/api-falsa.ts';
import {
  AGORA,
  CREDENCIAIS,
  criarCenario,
  esperarEstado,
  HA_UMA_HORA,
  montarSessao,
  SEGREDOS,
  SESSAO_A,
  SESSAO_A_RENOVADA,
  SESSAO_B,
  umaVoltaDoRelogio,
  type Cenario,
} from './teste/cenario.ts';
import { chamadasEspionadas, reiniciarEspioes } from './teste/espiao.ts';
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

function guardada(chave: string): unknown {
  const valor = secureStoreFalso.itens.get(chave);
  return valor === undefined ? undefined : (JSON.parse(valor) as unknown);
}

function chamadasDaFila(): number {
  return chamadasEspionadas().filter((c) => c.caminho === 'fila-offline.limpar').length;
}

/** Monta, abre o app sem sessão e entra com a conta A. */
async function entrarComA(cenario: Cenario = criarCenario()) {
  cenario.api.responder(`POST ${CAMINHO_DE_ENTRAR}`, () => ({ status: 200, corpo: SESSAO_A }));
  const sessao = montarSessao(cenario);
  await sessao.iniciar();
  await sessao.entrar(CREDENCIAIS);
  // O login também limpa (troca de conta): os testes contam só o que vem depois.
  cenario.persister.remocoes = 0;
  reiniciarEspioes();
  return { cenario, sessao };
}

beforeEach(() => {
  secureStoreFalso.reiniciar();
  reiniciarEspioes();
});

describe('sessão do app', () => {
  it('entra pelo cliente base com o clienteDoApp e guarda o par no SecureStore (CA-03)', async () => {
    const { cenario, sessao } = await entrarComA();

    expect(sessao.obterSituacao()).toEqual({ estado: 'com_sessao', emailVerificado: false });
    const login = cenario.api.pedidos.at(-1);
    expect(login).toMatchObject({
      metodo: 'POST',
      caminho: CAMINHO_DE_ENTRAR,
      corpo: { ...CREDENCIAIS, cliente: 'app_consumidor' },
    });
    expect(Object.keys(login?.cabecalhos ?? {}).map((nome) => nome.toLowerCase())).not.toContain(
      'authorization',
    );
    expect(guardada(CHAVE_DA_SESSAO)).toEqual(SESSAO_A);
  });

  it('a situação entregue às telas não traz token', async () => {
    const { sessao } = await entrarComA();
    const situacao = JSON.stringify(sessao.obterSituacao());

    for (const segredo of SEGREDOS) expect(situacao).not.toContain(segredo);
  });

  describe('logout (CA-05)', () => {
    it('revoga no servidor e limpa SecureStore, queryClient, cache persistido e fila; a tela de login só depois', async () => {
      const { cenario, sessao } = await entrarComA();
      cenario.queryClient.setQueryData(['conta'], { nome: 'Maria' });
      const resposta = adiada<RespostaFalsa>();
      cenario.api.responder('DELETE /v1/sessoes/atual', () => resposta.promessa);

      const saida = sessao.sair();
      await umaVoltaDoRelogio();

      // Enquanto o logout corre: nada da conta no aparelho, e ainda sem a tela de login.
      expect(sessao.obterSituacao().estado).toBe('carregando');
      expect(guardada(CHAVE_DA_SESSAO)).toBeUndefined();
      expect(cenario.queryClient.getQueryCache().getAll()).toEqual([]);
      expect(cenario.persister.remocoes).toBe(1);
      expect(chamadasDaFila()).toBe(1);
      // A pendência foi gravada antes do DELETE, na chave própria (S80).
      expect(guardada(CHAVE_DA_REVOGACAO_PENDENTE)).toEqual({
        tokenAcesso: SESSAO_A.tokenAcesso,
        tokenRenovacao: SESSAO_A.tokenRenovacao,
      });

      resposta.resolver(OK_204);
      await expect(saida).resolves.toEqual({ revogadaNoServidor: true });
      expect(sessao.obterSituacao()).toEqual({ estado: 'sem_sessao', emailVerificado: null });
      expect(cenario.api.pedidos.at(-1)).toMatchObject({
        metodo: 'DELETE',
        caminho: '/v1/sessoes/atual',
        cabecalhos: { Authorization: `Bearer ${SESSAO_A.tokenAcesso}` },
      });
      expect(guardada(CHAVE_DA_REVOGACAO_PENDENTE)).toBeUndefined();
    });

    it('sem rede, mantém a revogação pendente na chave própria e devolve revogadaNoServidor false', async () => {
      const { cenario, sessao } = await entrarComA();
      cenario.api.responder('DELETE /v1/sessoes/atual', () => SEM_REDE);

      await expect(sessao.sair()).resolves.toEqual({ revogadaNoServidor: false });

      expect(sessao.obterSituacao().estado).toBe('sem_sessao');
      expect(guardada(CHAVE_DA_SESSAO)).toBeUndefined();
      expect(guardada(CHAVE_DA_REVOGACAO_PENDENTE)).toEqual({
        tokenAcesso: SESSAO_A.tokenAcesso,
        tokenRenovacao: SESSAO_A.tokenRenovacao,
      });
    });

    it('na próxima abertura, retoma a revogação pendente com o clienteDoApp na renovação', async () => {
      const { cenario, sessao } = await entrarComA();
      cenario.api.responder('DELETE /v1/sessoes/atual', () => SEM_REDE);
      await sessao.sair();

      // Nova abertura: o token de acesso guardado foi recusado, então renova e repete.
      const reaberta = criarCenario();
      reaberta.api.responder('DELETE /v1/sessoes/atual', (pedido) =>
        pedido.cabecalhos.Authorization === `Bearer ${SESSAO_A_RENOVADA.tokenAcesso}`
          ? OK_204
          : { status: 401 },
      );
      reaberta.api.responder('POST /v1/sessoes/renovacao', () => ({
        status: 200,
        corpo: SESSAO_A_RENOVADA,
      }));
      const nova = montarSessao(reaberta);
      await nova.iniciar();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(nova.obterSituacao().estado).toBe('sem_sessao');
      expect(
        reaberta.api.pedidos.find((p) => p.caminho === '/v1/sessoes/renovacao')?.corpo,
      ).toEqual({
        tokenRenovacao: SESSAO_A.tokenRenovacao,
        cliente: 'app_consumidor',
      });
      expect(guardada(CHAVE_DA_REVOGACAO_PENDENTE)).toBeUndefined();
    });

    it('se o SecureStore não apagar a sessão, rejeita, avisa só a origem e ainda mostra a tela de login', async () => {
      const { cenario, sessao } = await entrarComA();
      cenario.api.responder('DELETE /v1/sessoes/atual', () => OK_204);
      secureStoreFalso.falhas.add(`apagar:${CHAVE_DA_SESSAO}`);

      await expect(sessao.sair()).rejects.toThrow(
        'Não foi possível apagar no armazenamento seguro.',
      );

      expect(sessao.obterSituacao().estado).toBe('sem_sessao');
      expect(cenario.falhas).toEqual([['limpar_sessao']]);
    });
  });

  describe('expiração', () => {
    it('renovação recusada limpa tudo, e a tela de login só aparece depois que a renovação terminou (Q18)', async () => {
      const { cenario, sessao } = await entrarComA();
      cenario.queryClient.setQueryData(['conta'], { nome: 'Maria' });
      cenario.api.responder('GET /v1/conta', () => ({ status: 401 }));
      cenario.api.responder('POST /v1/sessoes/renovacao', () => ({ status: 401 }));
      const ordem: string[] = [];
      sessao.assinar(() => ordem.push(`estado:${sessao.obterSituacao().estado}`));

      const requisicao = sessao
        .requisitar({ caminho: '/v1/conta', esquema: z.unknown() })
        .catch((erro: unknown) => {
          ordem.push('requisicao terminou');
          return erro;
        });

      expect(await requisicao).toBeInstanceOf(ErroDeApi);
      await esperarEstado(sessao, 'sem_sessao');
      expect(ordem).toEqual(['requisicao terminou', 'estado:sem_sessao']);
      expect(guardada(CHAVE_DA_SESSAO)).toBeUndefined();
      expect(cenario.queryClient.getQueryCache().getAll()).toEqual([]);
      expect(cenario.persister.remocoes).toBe(1);
      expect(chamadasDaFila()).toBe(1);
    });

    it('renova sem senha quando o token de acesso venceu, com o clienteDoApp, e segue na sessão (CA-05)', async () => {
      const { cenario, sessao } = await entrarComA();
      cenario.api.responder('GET /v1/conta', (pedido) =>
        pedido.cabecalhos.Authorization === `Bearer ${SESSAO_A_RENOVADA.tokenAcesso}`
          ? { status: 200, corpo: { ok: true } }
          : { status: 401 },
      );
      cenario.api.responder('POST /v1/sessoes/renovacao', () => ({
        status: 200,
        corpo: SESSAO_A_RENOVADA,
      }));

      await expect(
        sessao.requisitar({ caminho: '/v1/conta', esquema: z.object({ ok: z.boolean() }) }),
      ).resolves.toEqual({ ok: true });

      expect(cenario.api.pedidos.find((p) => p.caminho === '/v1/sessoes/renovacao')?.corpo).toEqual(
        {
          tokenRenovacao: SESSAO_A.tokenRenovacao,
          cliente: 'app_consumidor',
        },
      );
      expect(sessao.obterSituacao().estado).toBe('com_sessao');
      expect(guardada(CHAVE_DA_SESSAO)).toEqual(SESSAO_A_RENOVADA);
      expect(cenario.persister.remocoes).toBe(0);
    });
  });

  describe('abertura do app', () => {
    it('com sessão guardada e token válido, fica com a sessão sem chamar a API', async () => {
      secureStoreFalso.itens.set(CHAVE_DA_SESSAO, JSON.stringify(SESSAO_B));
      const cenario = criarCenario();
      const sessao = montarSessao(cenario);

      expect(sessao.obterSituacao().estado).toBe('carregando');
      await sessao.iniciar();

      expect(sessao.obterSituacao()).toEqual({ estado: 'com_sessao', emailVerificado: true });
      expect(cenario.api.pedidos).toEqual([]);
    });

    it('sem sessão guardada, mostra a tela de login sem chamar a API', async () => {
      const cenario = criarCenario();
      const sessao = montarSessao(cenario);

      await sessao.iniciar();

      expect(sessao.obterSituacao().estado).toBe('sem_sessao');
      expect(cenario.api.pedidos).toEqual([]);
    });

    it('com o token de acesso vencido, fica carregando até a renovação terminar', async () => {
      secureStoreFalso.itens.set(
        CHAVE_DA_SESSAO,
        JSON.stringify({ ...SESSAO_A, expiraEm: HA_UMA_HORA }),
      );
      const cenario = criarCenario();
      const resposta = adiada<RespostaFalsa>();
      cenario.api.responder('POST /v1/sessoes/renovacao', () => resposta.promessa);
      const sessao = montarSessao(cenario);

      const inicio = sessao.iniciar();
      await umaVoltaDoRelogio();
      expect(sessao.obterSituacao().estado).toBe('carregando');

      resposta.resolver({ status: 200, corpo: SESSAO_A_RENOVADA });
      await inicio;
      expect(sessao.obterSituacao().estado).toBe('com_sessao');
      expect(guardada(CHAVE_DA_SESSAO)).toEqual(SESSAO_A_RENOVADA);
      expect(cenario.api.pedidos[0]?.corpo).toEqual({
        tokenRenovacao: SESSAO_A.tokenRenovacao,
        cliente: 'app_consumidor',
      });
    });

    it('com a renovação recusada ao abrir, limpa tudo e mostra a tela de login', async () => {
      secureStoreFalso.itens.set(
        CHAVE_DA_SESSAO,
        JSON.stringify({ ...SESSAO_A, expiraEm: HA_UMA_HORA }),
      );
      const cenario = criarCenario();
      cenario.api.responder('POST /v1/sessoes/renovacao', () => ({ status: 401 }));
      const sessao = montarSessao(cenario);

      await sessao.iniciar();

      expect(sessao.obterSituacao().estado).toBe('sem_sessao');
      expect(guardada(CHAVE_DA_SESSAO)).toBeUndefined();
      expect(cenario.persister.remocoes).toBe(1);
      expect(chamadasDaFila()).toBe(1);
    });

    it('sem rede ao abrir, fica com a sessão guardada', async () => {
      secureStoreFalso.itens.set(
        CHAVE_DA_SESSAO,
        JSON.stringify({ ...SESSAO_A, expiraEm: HA_UMA_HORA }),
      );
      const cenario = criarCenario();
      cenario.api.responder('POST /v1/sessoes/renovacao', () => SEM_REDE);
      const sessao = montarSessao(cenario);

      await sessao.iniciar();

      expect(sessao.obterSituacao().estado).toBe('com_sessao');
      expect(guardada(CHAVE_DA_SESSAO)).toEqual({ ...SESSAO_A, expiraEm: HA_UMA_HORA });
    });

    it('se a leitura falhar, avisa só a origem e mostra a tela de login', async () => {
      secureStoreFalso.falhas.add(`ler:${CHAVE_DA_SESSAO}`);
      const cenario = criarCenario();
      const sessao = montarSessao(cenario);

      await sessao.iniciar();

      expect(sessao.obterSituacao().estado).toBe('sem_sessao');
      expect(cenario.falhas).toEqual([['ler_sessao']]);
    });

    it('roda uma vez só, mesmo chamada de novo', async () => {
      secureStoreFalso.itens.set(
        CHAVE_DA_SESSAO,
        JSON.stringify({ ...SESSAO_A, expiraEm: HA_UMA_HORA }),
      );
      const cenario = criarCenario();
      cenario.api.responder('POST /v1/sessoes/renovacao', () => ({
        status: 200,
        corpo: SESSAO_A_RENOVADA,
      }));
      const sessao = montarSessao(cenario);

      await Promise.all([sessao.iniciar(), sessao.iniciar()]);
      await sessao.iniciar();

      expect(cenario.api.pedidos).toHaveLength(1);
    });
  });

  describe('troca de conta', () => {
    it('encerra e revoga a conta anterior e limpa os dados dela antes de guardar a nova', async () => {
      const { cenario, sessao } = await entrarComA();
      cenario.queryClient.setQueryData(['conta'], { nome: 'Maria' });
      cenario.api.responder('DELETE /v1/sessoes/atual', () => OK_204);
      cenario.api.responder(`POST ${CAMINHO_DE_ENTRAR}`, () => ({ status: 200, corpo: SESSAO_B }));

      await sessao.entrar({ email: 'joao@exemplo.com', senha: 'outra senha qualquer' });

      const caminhos = cenario.api.pedidos.map((p) => `${p.metodo} ${p.caminho}`);
      expect(caminhos.slice(-2)).toEqual([`POST ${CAMINHO_DE_ENTRAR}`, 'DELETE /v1/sessoes/atual']);
      expect(cenario.api.pedidos.at(-1)?.cabecalhos.Authorization).toBe(
        `Bearer ${SESSAO_A.tokenAcesso}`,
      );
      expect(cenario.queryClient.getQueryCache().getAll()).toEqual([]);
      expect(cenario.persister.remocoes).toBeGreaterThanOrEqual(1);
      expect(chamadasDaFila()).toBeGreaterThanOrEqual(1);
      expect(guardada(CHAVE_DA_SESSAO)).toEqual(SESSAO_B);
      expect(sessao.obterSituacao()).toEqual({ estado: 'com_sessao', emailVerificado: true });
    });

    it('com a senha errada, a conta anterior continua', async () => {
      const { cenario, sessao } = await entrarComA();
      cenario.api.responder(`POST ${CAMINHO_DE_ENTRAR}`, () => ({ status: 401 }));

      await expect(sessao.entrar(CREDENCIAIS)).rejects.toBeInstanceOf(ErroDeApi);

      expect(sessao.obterSituacao().estado).toBe('com_sessao');
      expect(guardada(CHAVE_DA_SESSAO)).toEqual(SESSAO_A);
    });

    it('se a fila da conta anterior não for apagada, não entra (não envia operação de outra conta)', async () => {
      const cenario = criarCenario({
        filaOffline: { limpar: () => Promise.reject(new Error('sem acesso')) },
      });
      cenario.api.responder(`POST ${CAMINHO_DE_ENTRAR}`, () => ({ status: 200, corpo: SESSAO_A }));
      const sessao = montarSessao(cenario);
      await sessao.iniciar();

      await expect(sessao.entrar(CREDENCIAIS)).rejects.toBeInstanceOf(ErroAoLimparDadosDaConta);

      expect(sessao.obterSituacao().estado).toBe('sem_sessao');
      expect(guardada(CHAVE_DA_SESSAO)).toBeUndefined();
      // A limpeza da fila foi tentada de novo no encerramento da sessão recebida (R8).
      expect(cenario.falhas).toEqual([['limpar_fila'], ['limpar_fila']]);
      // A sessão recebida não fica viva sem ninguém com o token: o DELETE saiu com ela e, sem
      // resposta boa (404 aqui), ela fica como revogação pendente (S80).
      expect(cenario.api.pedidos.at(-1)).toMatchObject({
        metodo: 'DELETE',
        caminho: '/v1/sessoes/atual',
        cabecalhos: { Authorization: `Bearer ${SESSAO_A.tokenAcesso}` },
      });
      expect(guardada(CHAVE_DA_REVOGACAO_PENDENTE)).toEqual({
        tokenAcesso: SESSAO_A.tokenAcesso,
        tokenRenovacao: SESSAO_A.tokenRenovacao,
      });
    });

    describe('com a fila da conta anterior sem apagar (R8)', () => {
      function filaQueFalha() {
        const fila = { falhar: false, limpar: () => Promise.resolve() };
        fila.limpar = () =>
          fila.falhar ? Promise.reject(new Error('sem acesso')) : Promise.resolve();
        return fila;
      }

      it('A e B são revogadas no servidor, nenhum token fica no aparelho e a tela volta ao login', async () => {
        const fila = filaQueFalha();
        const { cenario, sessao } = await entrarComA(criarCenario({ filaOffline: fila }));
        fila.falhar = true;
        cenario.api.responder('DELETE /v1/sessoes/atual', () => OK_204);
        cenario.api.responder(`POST ${CAMINHO_DE_ENTRAR}`, () => ({
          status: 200,
          corpo: SESSAO_B,
        }));
        const estados: string[] = [];
        sessao.assinar(() => estados.push(sessao.obterSituacao().estado));

        await expect(
          sessao.entrar({ email: 'joao@exemplo.com', senha: 'outra senha qualquer' }),
        ).rejects.toBeInstanceOf(ErroAoLimparDadosDaConta);

        const revogacoes = cenario.api.pedidos
          .filter((p) => p.metodo === 'DELETE')
          .map((p) => p.cabecalhos.Authorization);
        expect(revogacoes).toEqual([
          `Bearer ${SESSAO_A.tokenAcesso}`,
          `Bearer ${SESSAO_B.tokenAcesso}`,
        ]);
        expect(sessao.obterSituacao()).toEqual({ estado: 'sem_sessao', emailVerificado: null });
        // Nunca passou por "com sessão" da conta B.
        expect(estados).not.toContain('com_sessao');
        expect(secureStoreFalso.itens.size).toBe(0);
        // Sem sessão, a requisição seguinte sai sem Bearer.
        cenario.api.responder('GET /v1/conta', () => ({ status: 401 }));
        await expect(
          sessao.requisitar({ caminho: '/v1/conta', esquema: z.unknown() }),
        ).rejects.toBeInstanceOf(ErroDeApi);
        expect(cenario.api.pedidos.at(-1)?.cabecalhos.Authorization).toBeUndefined();
      });

      it('sem rede, a sessão B fica como revogação pendente e sai na próxima chance', async () => {
        const fila = filaQueFalha();
        const { cenario, sessao } = await entrarComA(criarCenario({ filaOffline: fila }));
        fila.falhar = true;
        cenario.api.responder('DELETE /v1/sessoes/atual', () => SEM_REDE);
        cenario.api.responder(`POST ${CAMINHO_DE_ENTRAR}`, () => ({
          status: 200,
          corpo: SESSAO_B,
        }));

        await expect(
          sessao.entrar({ email: 'joao@exemplo.com', senha: 'outra senha qualquer' }),
        ).rejects.toBeInstanceOf(ErroAoLimparDadosDaConta);

        expect(guardada(CHAVE_DA_SESSAO)).toBeUndefined();
        const pendente = guardada(CHAVE_DA_REVOGACAO_PENDENTE);
        expect(pendente).toMatchObject({
          tokenAcesso: SESSAO_B.tokenAcesso,
          tokenRenovacao: SESSAO_B.tokenRenovacao,
          anteriores: [
            { tokenAcesso: SESSAO_A.tokenAcesso, tokenRenovacao: SESSAO_A.tokenRenovacao },
          ],
        });
        expect(sessao.obterSituacao().estado).toBe('sem_sessao');
      });
    });

    it('a falha do cache persistido (só dados públicos) não impede o login, mas é avisada', async () => {
      const cenario = criarCenario();
      cenario.persister.falharRemocao = true;
      await entrarComA(cenario);

      expect(guardada(CHAVE_DA_SESSAO)).toEqual(SESSAO_A);
      expect(cenario.falhas).toEqual([['limpar_cache']]);
    });
  });

  describe('substituirSessao: verificação do e-mail (R9)', () => {
    const CAMINHO_DA_VERIFICACAO = '/v1/conta/verificacao-email';
    const PEDIDO = {
      metodo: 'POST',
      caminho: CAMINHO_DA_VERIFICACAO,
      corpo: { codigo: '123456' },
    } as const;
    const SESSAO_A_VERIFICADA = {
      tokenAcesso: 'eyJhbGciOiJIUzI1NiJ9.acesso-verificado-a.assinatura-a3',
      tokenRenovacao: 'renovacao-verificada-a-abcdef0123456789',
      expiraEm: SESSAO_A.expiraEm,
      emailVerificado: true,
    };

    it('troca o par pelo da resposta sem limpar os dados da conta, e as requisições seguintes usam o novo', async () => {
      const { cenario, sessao } = await entrarComA();
      cenario.queryClient.setQueryData(['conta'], { nome: 'Maria' });
      cenario.api.responder(`POST ${CAMINHO_DA_VERIFICACAO}`, () => ({
        status: 200,
        corpo: SESSAO_A_VERIFICADA,
      }));
      cenario.api.responder('GET /v1/conta', () => ({ status: 200, corpo: { ok: true } }));

      await sessao.substituirSessao(PEDIDO);

      const verificacao = cenario.api.pedidos.at(-1);
      expect(verificacao).toMatchObject({
        metodo: 'POST',
        caminho: CAMINHO_DA_VERIFICACAO,
        corpo: { codigo: '123456' },
        cabecalhos: { Authorization: `Bearer ${SESSAO_A.tokenAcesso}` },
      });
      expect(guardada(CHAVE_DA_SESSAO)).toEqual(SESSAO_A_VERIFICADA);
      expect(sessao.obterSituacao()).toEqual({ estado: 'com_sessao', emailVerificado: true });
      // Mesma conta: nada é limpo nem revogado.
      expect(cenario.queryClient.getQueryData(['conta'])).toEqual({ nome: 'Maria' });
      expect(cenario.persister.remocoes).toBe(0);
      expect(chamadasDaFila()).toBe(0);
      expect(cenario.api.pedidos.some((p) => p.metodo === 'DELETE')).toBe(false);
      expect(guardada(CHAVE_DA_REVOGACAO_PENDENTE)).toBeUndefined();

      await sessao.requisitar({ caminho: '/v1/conta', esquema: z.unknown() });
      expect(cenario.api.pedidos.at(-1)?.cabecalhos.Authorization).toBe(
        `Bearer ${SESSAO_A_VERIFICADA.tokenAcesso}`,
      );
    });

    it('código errado: rejeita com o ErroDeApi e a sessão continua a mesma', async () => {
      const { cenario, sessao } = await entrarComA();
      cenario.api.responder(`POST ${CAMINHO_DA_VERIFICACAO}`, () => ({
        status: 400,
        corpo: {
          erro: 'validacao',
          campos: [{ campo: 'codigo', codigo: 'invalido', motivo: 'x' }],
        },
      }));

      await expect(sessao.substituirSessao(PEDIDO)).rejects.toBeInstanceOf(ErroDeApi);

      expect(guardada(CHAVE_DA_SESSAO)).toEqual(SESSAO_A);
      expect(sessao.obterSituacao()).toEqual({ estado: 'com_sessao', emailVerificado: false });
    });

    it('logout enquanto a verificação corria: a sessão recebida não reabre a conta e é revogada', async () => {
      const { cenario, sessao } = await entrarComA();
      const resposta = adiada<RespostaFalsa>();
      cenario.api.responder(`POST ${CAMINHO_DA_VERIFICACAO}`, () => resposta.promessa);
      cenario.api.responder('DELETE /v1/sessoes/atual', () => OK_204);

      const troca = sessao.substituirSessao(PEDIDO);
      await umaVoltaDoRelogio();
      await sessao.sair();
      resposta.resolver({ status: 200, corpo: SESSAO_A_VERIFICADA });
      await troca;

      expect(sessao.obterSituacao().estado).toBe('sem_sessao');
      expect(guardada(CHAVE_DA_SESSAO)).toBeUndefined();
      expect(cenario.api.pedidos.at(-1)).toMatchObject({
        metodo: 'DELETE',
        cabecalhos: { Authorization: `Bearer ${SESSAO_A_VERIFICADA.tokenAcesso}` },
      });
      expect(guardada(CHAVE_DA_REVOGACAO_PENDENTE)).toBeUndefined();
    });

    it('outra conta entrou enquanto a verificação corria: a sessão dela fica', async () => {
      const { cenario, sessao } = await entrarComA();
      const resposta = adiada<RespostaFalsa>();
      cenario.api.responder(`POST ${CAMINHO_DA_VERIFICACAO}`, () => resposta.promessa);
      cenario.api.responder('DELETE /v1/sessoes/atual', () => OK_204);
      cenario.api.responder(`POST ${CAMINHO_DE_ENTRAR}`, () => ({ status: 200, corpo: SESSAO_B }));

      const troca = sessao.substituirSessao(PEDIDO);
      await umaVoltaDoRelogio();
      await sessao.entrar({ email: 'joao@exemplo.com', senha: 'outra senha qualquer' });
      resposta.resolver({ status: 200, corpo: SESSAO_A_VERIFICADA });
      await troca;

      expect(guardada(CHAVE_DA_SESSAO)).toEqual(SESSAO_B);
      expect(sessao.obterSituacao()).toEqual({ estado: 'com_sessao', emailVerificado: true });
      expect(
        JSON.stringify([...secureStoreFalso.itens]).includes(SESSAO_A_VERIFICADA.tokenAcesso),
      ).toBe(false);
    });
  });

  describe('reinstalação (S127)', () => {
    it('o par e a pendência da instalação anterior são revogados no servidor na 1ª abertura, e a tela fica no login', async () => {
      const PENDENTE_ANTIGA = {
        tokenAcesso: 'eyJhbGciOiJIUzI1NiJ9.acesso-de-logout-sem-rede.assinatura',
        tokenRenovacao: 'renovacao-de-logout-sem-rede-0123456789ab',
      };
      secureStoreFalso.itens.set(CHAVE_DA_SESSAO, JSON.stringify(SESSAO_A));
      secureStoreFalso.itens.set(CHAVE_DA_REVOGACAO_PENDENTE, JSON.stringify(PENDENTE_ANTIGA));
      const cenario = criarCenario({
        cofre: criarCofreDaSessao({
          marca: { existe: () => Promise.resolve(false), marcar: () => Promise.resolve() },
        }),
      });
      cenario.api.responder('DELETE /v1/sessoes/atual', () => OK_204);
      const sessao = montarSessao(cenario);

      await sessao.iniciar();
      expect(sessao.obterSituacao()).toEqual({ estado: 'sem_sessao', emailVerificado: null });
      // A revogação retomada não é esperada pela abertura: corre em segundo plano.
      for (let volta = 0; volta < 10 && secureStoreFalso.itens.size > 0; volta += 1) {
        await umaVoltaDoRelogio();
      }

      expect(
        cenario.api.pedidos
          .filter((p) => p.metodo === 'DELETE')
          .map((p) => p.cabecalhos.Authorization)
          .sort(),
      ).toEqual([`Bearer ${SESSAO_A.tokenAcesso}`, `Bearer ${PENDENTE_ANTIGA.tokenAcesso}`].sort());
      // Nenhuma renovação com o par antigo: ele nunca voltou como sessão.
      expect(cenario.api.pedidos.some((p) => p.caminho === '/v1/sessoes/renovacao')).toBe(false);
      expect(secureStoreFalso.itens.size).toBe(0);
    });
  });

  describe('falhas em segundo plano (Q18, ADR-014)', () => {
    it('registrarFalha recebe só a origem: nunca o erro, a mensagem nativa ou o token', async () => {
      const { cenario, sessao } = await entrarComA();
      cenario.api.responder('DELETE /v1/sessoes/atual', () => SEM_REDE);
      secureStoreFalso.falhas.add(`gravar:${CHAVE_DA_REVOGACAO_PENDENTE}`);

      await sessao.sair();

      expect(cenario.falhas).toEqual([['revogacao_pendente']]);
      const registrado = JSON.stringify(cenario.falhas);
      for (const segredo of [...SEGREDOS, 'falha nativa', 'bairrin.']) {
        expect(registrado).not.toContain(segredo);
      }
    });

    it('um registrarFalha que lança não muda o resultado', async () => {
      secureStoreFalso.falhas.add(`ler:${CHAVE_DA_SESSAO}`);
      const sessao = montarSessao(
        criarCenario({
          registrarFalha: () => {
            throw new Error('Sentry fora do ar');
          },
        }),
      );

      await sessao.iniciar();

      expect(sessao.obterSituacao().estado).toBe('sem_sessao');
    });
  });

  it('o relógio injetado decide se o token venceu', async () => {
    secureStoreFalso.itens.set(CHAVE_DA_SESSAO, JSON.stringify(SESSAO_A));
    const cenario = criarCenario({ agora: () => AGORA + 60 * 60_000 });
    cenario.api.responder('POST /v1/sessoes/renovacao', () => ({ status: 401 }));
    const sessao = montarSessao(cenario);

    await sessao.iniciar();

    expect(sessao.obterSituacao().estado).toBe('sem_sessao');
  });
});
