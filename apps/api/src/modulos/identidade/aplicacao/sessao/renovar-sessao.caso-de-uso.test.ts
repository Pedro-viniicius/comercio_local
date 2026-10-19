// Renovação da sessão (CA-03, CA-05; S1, S16, S77, R1, R7; plano 01b, etapa 9):
// rotação silenciosa com `mfa` herdado e login gravado; tolerância de 60 s só
// para o último token trocado e o mesmo `cliente` da requisição; qualquer token
// antigo fora disso revoga a família; `gravarRotacao` que perde a corrida relê
// e cai na tolerância, no reuso ou em inválido, sem gravar o login recusado.
import type { RenovarSessao } from '@bairrin/contratos';
import type { Cliente } from '@bairrin/contratos/validadores';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { RelogioFixo } from '../../../../compartilhado/tempo/relogio.ts';
import {
  criarIdentidadeEmMemoria,
  type IdentidadeEmMemoria,
  SessoesEmMemoria,
} from '../../../../../test/fakes/identidade/repositorios-em-memoria.ts';
import {
  CifradorFalso,
  EmissorDeJwtFalso,
  GeradorDeSegredosFalso,
  HasherFalso,
} from '../../../../../test/fakes/identidade/servicos-falsos.ts';
import { Conta } from '../../dominio/conta.ts';
import { Email } from '../../dominio/email.ts';
import {
  DURACAO_MAXIMA_NO_PAINEL_EM_MS,
  INATIVIDADE_MAXIMA_NO_PAINEL_EM_MS,
  JANELA_DA_SESSAO_NOS_APPS_EM_MS,
  SEGUNDOS_DO_TOKEN_DE_ACESSO,
  Sessao,
} from '../../dominio/sessao.ts';
import { Telefone } from '../../dominio/telefone.ts';
import type { Cifrador, FinalidadeDeCifragem } from '../portas/cifrador.ts';
import { EncerrarSessaoCasoDeUso } from './encerrar-sessao.caso-de-uso.ts';
import {
  type ResultadoDeRenovarSessao,
  RenovarSessaoCasoDeUso,
} from './renovar-sessao.caso-de-uso.ts';

const CRIADA_EM = new Date('2026-10-17T09:00:00.000Z');
const AGORA = new Date('2026-10-18T12:00:00.000Z');
const CONTA = 'bbbbbbbb-0000-4000-8000-000000000001';
const SID = 'eeeeeeee-0000-4000-8000-000000000001';
const TOKEN_INICIAL = 'token-inicial-da-sessao';
const UM_SEGUNDO_EM_MS = 1000;
const UM_DIA_EM_MS = 24 * 60 * 60 * 1000;
const INVALIDA = { tipo: 'invalida' };

const cifrador = new CifradorFalso();
const emissor = new EmissorDeJwtFalso();

/** Devolve, uma vez, a sessão como estava antes de outra transação mudar (leitura velha). */
class SessoesComLeituraVelha extends SessoesEmMemoria {
  velha: Sessao | null = null;

  override buscarPorTokenHash(tokenHash: string): Promise<Sessao | null> {
    const velha = this.velha;
    if (velha === null) return super.buscarPorTokenHash(tokenHash);
    this.velha = null;
    return Promise.resolve(Sessao.reconstituir(velha.dados));
  }
}

/** Cifrador cujo par cifrado não decifra mais (chave trocada no meio dos 60 s). */
class CifradorQueNaoDecifra extends CifradorFalso {
  override decifrar(_finalidade: FinalidadeDeCifragem, _texto: string, _conta: string): null {
    return null;
  }
}

interface Cenario {
  identidade: IdentidadeEmMemoria;
  sessoes: SessoesComLeituraVelha;
  relogio: RelogioFixo;
  caso: RenovarSessaoCasoDeUso;
  encerrar: EncerrarSessaoCasoDeUso;
  renovar(token: string, cliente?: Cliente): Promise<ResultadoDeRenovarSessao>;
}

function montar(cifradorDoCaso: Cifrador = cifrador): Cenario {
  const identidade = criarIdentidadeEmMemoria();
  const sessoes = new SessoesComLeituraVelha(identidade.unidade);
  const relogio = new RelogioFixo(AGORA);
  const caso = new RenovarSessaoCasoDeUso(
    identidade.unidade,
    relogio,
    identidade.contas,
    sessoes,
    cifradorDoCaso,
    new GeradorDeSegredosFalso(),
    emissor,
  );
  const encerrar = new EncerrarSessaoCasoDeUso(identidade.unidade, relogio, sessoes, cifrador);
  return {
    identidade,
    sessoes,
    relogio,
    caso,
    encerrar,
    renovar: (tokenRenovacao, cliente = 'app_consumidor') =>
      caso.executar({ tokenRenovacao, cliente }),
  };
}

interface OpcoesDaConta {
  admin?: boolean;
  cliente?: Cliente;
  mfa?: boolean;
}

async function prepararConta(
  cenario: Cenario,
  { admin = false, cliente = 'app_consumidor', mfa = false }: OpcoesDaConta = {},
): Promise<void> {
  const conta = Conta.criar({
    id: CONTA,
    nome: 'Bia Lima',
    email: Email.criar('bia@exemplo.com'),
    telefone: Telefone.criar('35999991234'),
    senhaHash: HasherFalso.hashDe('senha-da-bia'),
    agora: CRIADA_EM,
  });
  if (admin) conta.concederAdmin(CRIADA_EM);
  await cenario.identidade.contas.inserir(conta);
  await cenario.sessoes.inserir(
    Sessao.criar({
      id: SID,
      contaId: CONTA,
      cliente,
      tokenHash: cifrador.hmac('token_renovacao', [TOKEN_INICIAL]),
      mfa,
      agora: AGORA,
    }),
  );
}

function renovada(resultado: ResultadoDeRenovarSessao) {
  if (resultado.tipo !== 'renovada') throw new Error(`esperava renovada, veio ${resultado.tipo}`);
  return resultado.sessao;
}

function sessaoGravada(cenario: Cenario) {
  const dados = cenario.sessoes.dadosDe(SID);
  if (dados === undefined) throw new Error('sessão sumiu');
  return dados;
}

describe('RenovarSessaoCasoDeUso', () => {
  it('o corpo do contrato dos apps entra no caso de uso', () => {
    expectTypeOf<RenovarSessao>().toExtend<{ tokenRenovacao: string; cliente: Cliente }>();
  });

  describe('rotação (CA-03, CA-05)', () => {
    it('troca o token na mesma sessão, desliza 30 dias, grava o login e guarda o token trocado no histórico', async () => {
      const cenario = montar();
      await prepararConta(cenario);
      cenario.relogio.avancar(10 * UM_DIA_EM_MS);
      const agora = cenario.relogio.agora();

      const sessao = renovada(await cenario.renovar(TOKEN_INICIAL));

      expect(sessao.tokenRenovacao).not.toBe(TOKEN_INICIAL);
      expect(sessao.expiraEm).toEqual(
        new Date(agora.getTime() + SEGUNDOS_DO_TOKEN_DE_ACESSO * 1000),
      );
      expect(sessao.emailVerificado).toBe(false);
      await expect(emissor.verificar(sessao.tokenAcesso, agora)).resolves.toEqual({
        contaId: CONTA,
        sid: SID,
        perfis: ['consumidor'],
        mfa: false,
        emailVerificado: false,
      });
      expect(sessaoGravada(cenario)).toMatchObject({
        tokenHash: cifrador.hmac('token_renovacao', [sessao.tokenRenovacao]),
        tokenAnteriorHash: cifrador.hmac('token_renovacao', [TOKEN_INICIAL]),
        trocadoEm: agora,
        ultimoUsoEm: agora,
        expiraEm: new Date(agora.getTime() + JANELA_DA_SESSAO_NOS_APPS_EM_MS),
        revogadaEm: null,
      });
      expect(cenario.sessoes.tokensUsados()).toEqual([
        {
          tokenHash: cifrador.hmac('token_renovacao', [TOKEN_INICIAL]),
          familiaId: SID,
          sessaoId: SID,
          usadoEm: agora,
        },
      ]);
      // A renovação conta como login para o expurgo de 7 dias (P1-dono).
      expect(cenario.identidade.contas.dadosDe(CONTA)?.ultimoLoginEm).toEqual(agora);
    });

    it('renovações seguidas: cada token novo renova uma vez (silenciosa, CA-05)', async () => {
      const cenario = montar();
      await prepararConta(cenario);
      let token = TOKEN_INICIAL;
      for (let vez = 0; vez < 3; vez += 1) {
        cenario.relogio.avancar(15 * 60 * UM_SEGUNDO_EM_MS);
        token = renovada(await cenario.renovar(token)).tokenRenovacao;
      }
      expect(cenario.sessoes.tokensUsados()).toHaveLength(3);
      expect(sessaoGravada(cenario).revogadaEm).toBeNull();
    });

    it('painel com `mfa`: a renovação herda o `mfa` e o admin, desliza 30 min e respeita o teto de 12 h (S1, S9)', async () => {
      const cenario = montar();
      await prepararConta(cenario, { admin: true, cliente: 'painel', mfa: true });
      cenario.relogio.avancar(20 * 60 * UM_SEGUNDO_EM_MS);
      const agora = cenario.relogio.agora();

      const sessao = renovada(await cenario.renovar(TOKEN_INICIAL, 'painel'));

      const reivindicacoes = await emissor.verificar(sessao.tokenAcesso, agora);
      expect(reivindicacoes?.mfa).toBe(true);
      expect(reivindicacoes?.perfis).toEqual(['consumidor', 'admin']);
      expect(sessaoGravada(cenario).expiraEm).toEqual(
        new Date(agora.getTime() + INATIVIDADE_MAXIMA_NO_PAINEL_EM_MS),
      );

      // Renovando a cada 29 min, a sessão morre no teto de 12 h.
      let token = sessao.tokenRenovacao;
      let ultimo: ResultadoDeRenovarSessao = { tipo: 'renovada', sessao };
      while (ultimo.tipo === 'renovada') {
        cenario.relogio.avancar(29 * 60 * UM_SEGUNDO_EM_MS);
        ultimo = await cenario.renovar(token, 'painel');
        if (ultimo.tipo === 'renovada') token = ultimo.sessao.tokenRenovacao;
      }
      expect(ultimo).toEqual(INVALIDA);
      expect(cenario.relogio.agora().getTime()).toBeGreaterThanOrEqual(
        AGORA.getTime() + DURACAO_MAXIMA_NO_PAINEL_EM_MS,
      );
      expect(cenario.relogio.agora().getTime()).toBeLessThan(
        AGORA.getTime() + DURACAO_MAXIMA_NO_PAINEL_EM_MS + 29 * 60 * UM_SEGUNDO_EM_MS,
      );
    });

    it('conta admin num app: a renovação continua sem admin (S1)', async () => {
      const cenario = montar();
      await prepararConta(cenario, { admin: true });

      const sessao = renovada(await cenario.renovar(TOKEN_INICIAL));

      const reivindicacoes = await emissor.verificar(sessao.tokenAcesso, AGORA);
      expect(reivindicacoes?.perfis).toEqual(['consumidor']);
      expect(reivindicacoes?.mfa).toBe(false);
    });
  });

  describe('recusas sem revogar', () => {
    it('token desconhecido: inválido, nada muda', async () => {
      const cenario = montar();
      await prepararConta(cenario);

      await expect(cenario.renovar('token-que-nunca-existiu')).resolves.toEqual(INVALIDA);

      expect(sessaoGravada(cenario).revogadaEm).toBeNull();
      expect(cenario.identidade.contas.dadosDe(CONTA)?.ultimoLoginEm).toBeNull();
    });

    it('token de app apresentado como painel e token do painel apresentado como app: os dois inválidos (S16)', async () => {
      const app = montar();
      await prepararConta(app);
      await expect(app.renovar(TOKEN_INICIAL, 'painel')).resolves.toEqual(INVALIDA);
      await expect(app.renovar(TOKEN_INICIAL, 'app_lojista')).resolves.toEqual(INVALIDA);
      // O dono, com o cliente certo, segue renovando.
      renovada(await app.renovar(TOKEN_INICIAL, 'app_consumidor'));

      const painel = montar();
      await prepararConta(painel, { admin: true, cliente: 'painel', mfa: true });
      await expect(painel.renovar(TOKEN_INICIAL, 'app_consumidor')).resolves.toEqual(INVALIDA);
      expect(sessaoGravada(painel).revogadaEm).toBeNull();
    });

    it('sessão encerrada (logout): inválido (CA-05)', async () => {
      const cenario = montar();
      await prepararConta(cenario);
      await cenario.encerrar.executar({ contaId: CONTA, sid: SID });

      await expect(cenario.renovar(TOKEN_INICIAL)).resolves.toEqual(INVALIDA);
      expect(sessaoGravada(cenario).motivoRevogacao).toBe('logout');
    });

    it('sessão de app vencida (30 dias sem renovar): inválido', async () => {
      const cenario = montar();
      await prepararConta(cenario);
      cenario.relogio.avancar(JANELA_DA_SESSAO_NOS_APPS_EM_MS);

      await expect(cenario.renovar(TOKEN_INICIAL)).resolves.toEqual(INVALIDA);
    });

    it('painel parado por 30 min: inválido (S9)', async () => {
      const cenario = montar();
      await prepararConta(cenario, { admin: true, cliente: 'painel', mfa: true });
      cenario.relogio.avancar(INATIVIDADE_MAXIMA_NO_PAINEL_EM_MS);

      await expect(cenario.renovar(TOKEN_INICIAL, 'painel')).resolves.toEqual(INVALIDA);
    });

    it('conta fora de `ativa` com a sessão ainda viva: inválido, sem gravar login nem rotacionar', async () => {
      const cenario = montar();
      await prepararConta(cenario);
      const conta = await cenario.identidade.contas.buscarPorId(CONTA);
      conta?.desativar(AGORA);
      if (conta) await cenario.identidade.contas.atualizar(conta);

      await expect(cenario.renovar(TOKEN_INICIAL)).resolves.toEqual(INVALIDA);

      expect(cenario.sessoes.tokensUsados()).toEqual([]);
      expect(cenario.identidade.contas.dadosDe(CONTA)?.ultimoLoginEm).toBeNull();
    });
  });

  describe('tolerância de 60 s (S16)', () => {
    it('o token recém-trocado, dentro de 60 s e do mesmo cliente, devolve o mesmo par', async () => {
      const cenario = montar();
      await prepararConta(cenario);
      const primeira = renovada(await cenario.renovar(TOKEN_INICIAL));
      cenario.relogio.avancar(59 * UM_SEGUNDO_EM_MS);

      await expect(cenario.renovar(TOKEN_INICIAL)).resolves.toEqual({
        tipo: 'renovada',
        sessao: primeira,
      });
      expect(cenario.sessoes.tokensUsados()).toHaveLength(1);
      expect(sessaoGravada(cenario).revogadaEm).toBeNull();
    });

    it('o token recém-trocado apresentado por outro cliente é reuso: revoga a família', async () => {
      const cenario = montar();
      await prepararConta(cenario);
      const primeira = renovada(await cenario.renovar(TOKEN_INICIAL));

      await expect(cenario.renovar(TOKEN_INICIAL, 'app_lojista')).resolves.toEqual(INVALIDA);

      expect(sessaoGravada(cenario).motivoRevogacao).toBe('reuso_detectado');
      await expect(cenario.renovar(primeira.tokenRenovacao)).resolves.toEqual(INVALIDA);
    });

    it('o token recém-trocado depois de 60 s é reuso: revoga a família, e o token atual deixa de valer', async () => {
      const cenario = montar();
      await prepararConta(cenario);
      const primeira = renovada(await cenario.renovar(TOKEN_INICIAL));
      cenario.relogio.avancar(60 * UM_SEGUNDO_EM_MS);

      await expect(cenario.renovar(TOKEN_INICIAL)).resolves.toEqual(INVALIDA);

      expect(sessaoGravada(cenario)).toMatchObject({
        revogadaEm: cenario.relogio.agora(),
        motivoRevogacao: 'reuso_detectado',
        parNovoCifrado: null,
      });
      await expect(cenario.renovar(primeira.tokenRenovacao)).resolves.toEqual(INVALIDA);
    });

    it('par da tolerância que não decifra: inválido, sem revogar', async () => {
      const cenario = montar();
      await prepararConta(cenario);
      renovada(await cenario.renovar(TOKEN_INICIAL));
      const semChave = new RenovarSessaoCasoDeUso(
        cenario.identidade.unidade,
        cenario.relogio,
        cenario.identidade.contas,
        cenario.sessoes,
        new CifradorQueNaoDecifra(),
        new GeradorDeSegredosFalso(),
        emissor,
      );

      await expect(
        semChave.executar({ tokenRenovacao: TOKEN_INICIAL, cliente: 'app_consumidor' }),
      ).resolves.toEqual(INVALIDA);
      expect(sessaoGravada(cenario).revogadaEm).toBeNull();
    });
  });

  describe('histórico de tokens usados (S77)', () => {
    async function tresRotacoes(cenario: Cenario): Promise<string> {
      let token = TOKEN_INICIAL;
      for (let vez = 0; vez < 3; vez += 1) {
        token = renovada(await cenario.renovar(token)).tokenRenovacao;
      }
      return token;
    }

    it('o primeiro token reapresentado depois de 61 s revoga a família', async () => {
      const cenario = montar();
      await prepararConta(cenario);
      const atual = await tresRotacoes(cenario);
      cenario.relogio.avancar(61 * UM_SEGUNDO_EM_MS);

      await expect(cenario.renovar(TOKEN_INICIAL)).resolves.toEqual(INVALIDA);

      expect(sessaoGravada(cenario).motivoRevogacao).toBe('reuso_detectado');
      await expect(cenario.renovar(atual)).resolves.toEqual(INVALIDA);
    });

    it('o primeiro token reapresentado dentro dos 60 s também revoga: só o último trocado tem tolerância', async () => {
      const cenario = montar();
      await prepararConta(cenario);
      const atual = await tresRotacoes(cenario);
      cenario.relogio.avancar(10 * UM_SEGUNDO_EM_MS);

      await expect(cenario.renovar(TOKEN_INICIAL)).resolves.toEqual(INVALIDA);

      expect(sessaoGravada(cenario).motivoRevogacao).toBe('reuso_detectado');
      await expect(cenario.renovar(atual)).resolves.toEqual(INVALIDA);
    });

    it('o reuso revoga as outras sessões da mesma família, e não as de outra família', async () => {
      const cenario = montar();
      await prepararConta(cenario);
      const outraFamilia = 'eeeeeeee-0000-4000-8000-000000000002';
      await cenario.sessoes.inserir(
        Sessao.criar({
          id: outraFamilia,
          contaId: CONTA,
          cliente: 'app_lojista',
          tokenHash: cifrador.hmac('token_renovacao', ['token-do-lojista']),
          mfa: false,
          agora: AGORA,
        }),
      );
      await tresRotacoes(cenario);

      await cenario.renovar(TOKEN_INICIAL);

      expect(cenario.sessoes.dadosDe(outraFamilia)?.revogadaEm).toBeNull();
      renovada(await cenario.renovar('token-do-lojista', 'app_lojista'));
    });
  });

  describe('`gravarRotacao` perdeu a corrida: relê e avalia de novo (R1, R7)', () => {
    it('duas renovações simultâneas com o mesmo token: as duas recebem o mesmo par, e o histórico tem uma linha', async () => {
      const cenario = montar();
      await prepararConta(cenario);

      const [a, b] = await Promise.all([
        cenario.renovar(TOKEN_INICIAL),
        cenario.renovar(TOKEN_INICIAL),
      ]);

      expect(renovada(a)).toEqual(renovada(b));
      expect(cenario.sessoes.tokensUsados()).toHaveLength(1);
      expect(sessaoGravada(cenario).revogadaEm).toBeNull();
    });

    it('tolerância: a outra renovação do mesmo cliente rotacionou no meio; devolve o par dela', async () => {
      const cenario = montar();
      await prepararConta(cenario);
      const velha = await cenario.sessoes.buscarPorTokenHash(
        cifrador.hmac('token_renovacao', [TOKEN_INICIAL]),
      );
      const daOutra = renovada(await cenario.renovar(TOKEN_INICIAL));
      cenario.sessoes.velha = velha;
      cenario.relogio.avancar(5 * UM_SEGUNDO_EM_MS);

      await expect(cenario.renovar(TOKEN_INICIAL)).resolves.toEqual({
        tipo: 'renovada',
        sessao: daOutra,
      });
      expect(cenario.sessoes.velha).toBeNull();
      expect(cenario.sessoes.tokensUsados()).toHaveLength(1);
      // A renovação aceita pela tolerância mantém o login gravado.
      expect(cenario.identidade.contas.dadosDe(CONTA)?.ultimoLoginEm).toEqual(
        cenario.relogio.agora(),
      );
    });

    it('reuso: a outra renovação rotacionou há mais de 60 s; revoga a família e não grava o login', async () => {
      const cenario = montar();
      await prepararConta(cenario);
      const velha = await cenario.sessoes.buscarPorTokenHash(
        cifrador.hmac('token_renovacao', [TOKEN_INICIAL]),
      );
      const daOutra = renovada(await cenario.renovar(TOKEN_INICIAL));
      cenario.sessoes.velha = velha;
      cenario.relogio.avancar(61 * UM_SEGUNDO_EM_MS);

      await expect(cenario.renovar(TOKEN_INICIAL)).resolves.toEqual(INVALIDA);

      expect(cenario.sessoes.velha).toBeNull();
      expect(sessaoGravada(cenario)).toMatchObject({
        revogadaEm: cenario.relogio.agora(),
        motivoRevogacao: 'reuso_detectado',
      });
      expect(cenario.identidade.contas.dadosDe(CONTA)?.ultimoLoginEm).toEqual(AGORA);
      await expect(cenario.renovar(daOutra.tokenRenovacao)).resolves.toEqual(INVALIDA);
    });

    it('inválida: um logout revogou a sessão no meio; continua revogada e o login não é gravado', async () => {
      const cenario = montar();
      await prepararConta(cenario);
      const velha = await cenario.sessoes.buscarPorTokenHash(
        cifrador.hmac('token_renovacao', [TOKEN_INICIAL]),
      );
      await cenario.encerrar.executar({ contaId: CONTA, sid: SID });
      cenario.sessoes.velha = velha;
      cenario.relogio.avancar(5 * UM_SEGUNDO_EM_MS);

      await expect(cenario.renovar(TOKEN_INICIAL)).resolves.toEqual(INVALIDA);

      expect(cenario.sessoes.velha).toBeNull();
      expect(sessaoGravada(cenario)).toMatchObject({
        revogadaEm: AGORA,
        motivoRevogacao: 'logout',
        tokenHash: cifrador.hmac('token_renovacao', [TOKEN_INICIAL]),
      });
      expect(cenario.sessoes.tokensUsados()).toEqual([]);
      expect(cenario.identidade.contas.dadosDe(CONTA)?.ultimoLoginEm).toBeNull();
    });
  });
});
