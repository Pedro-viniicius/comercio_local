// Login (CA-03, CA-04, CA-07, CA-12; P1-dono, S1, S14, S23; plano 01b, etapa 9):
// conta não verificada entra e a sessão leva `emailVerificado`; e-mail sem
// conta gasta o hash fictício; o freio por e-mail e por origem segura a senha
// (1, 5 e 15 min, mesma mensagem); no painel, sem admin → `sem_acesso_painel`
// e com admin → desafio do segundo fator, sem sessão.
import type { Entrar } from '@bairrin/contratos';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { RelogioFixo } from '../../../../compartilhado/tempo/relogio.ts';
import {
  ContasEmMemoria,
  criarIdentidadeEmMemoria,
  type IdentidadeEmMemoria,
} from '../../../../../test/fakes/identidade/repositorios-em-memoria.ts';
import {
  CifradorFalso,
  EmissorDeJwtFalso,
  GeradorDeSegredosFalso,
  HasherFalso,
} from '../../../../../test/fakes/identidade/servicos-falsos.ts';
import { ESPERAS_EM_MS } from '../../dominio/bloqueio-de-login.ts';
import { Conta } from '../../dominio/conta.ts';
import { Email } from '../../dominio/email.ts';
import type { RepositorioDeContas } from '../../dominio/repositorios.ts';
import {
  JANELA_DA_SESSAO_NOS_APPS_EM_MS,
  SEGUNDOS_DO_TOKEN_DE_ACESSO,
} from '../../dominio/sessao.ts';
import { Telefone } from '../../dominio/telefone.ts';
import { chaveDoFreioPorEmail } from '../comum/chaves.ts';
import { chaveDoFreioPorOrigem } from './comum.ts';
import {
  EntrarCasoDeUso,
  type EntradaDeEntrar,
  type ResultadoDeEntrar,
} from './entrar.caso-de-uso.ts';

const CRIADA_EM = new Date('2026-10-17T09:00:00.000Z');
const AGORA = new Date('2026-10-18T12:00:00.000Z');
const CONTA = 'aaaaaaaa-0000-4000-8000-000000000001';
const EMAIL = 'ana@exemplo.com';
const SENHA = 'senha-certa-da-ana';
const NOME = 'Ana Souza';
const IP = '203.0.113.5';
const UM_MINUTO_EM_MS = 60 * 1000;
const CREDENCIAIS_INVALIDAS = { tipo: 'credenciais_invalidas' };

const cifrador = new CifradorFalso();
const emissor = new EmissorDeJwtFalso();

interface Cenario {
  identidade: IdentidadeEmMemoria;
  relogio: RelogioFixo;
  hasher: HasherFalso;
  caso: EntrarCasoDeUso;
}

function montar(
  contasDoCenario?: (identidade: IdentidadeEmMemoria) => RepositorioDeContas,
): Cenario {
  const identidade = criarIdentidadeEmMemoria();
  const relogio = new RelogioFixo(AGORA);
  // O hasher rejeita chamada com a transação aberta (S91).
  const hasher = new HasherFalso(identidade.unidade);
  const caso = new EntrarCasoDeUso(
    identidade.unidade,
    relogio,
    contasDoCenario?.(identidade) ?? identidade.contas,
    identidade.sessoes,
    identidade.bloqueios,
    identidade.desafios,
    identidade.segundoFator,
    hasher,
    cifrador,
    new GeradorDeSegredosFalso(),
    emissor,
  );
  return { identidade, relogio, hasher, caso };
}

interface OpcoesDaConta {
  id?: string;
  email?: string;
  admin?: boolean;
  verificada?: boolean;
  desativada?: boolean;
  semSenha?: boolean;
}

function novaConta(opcoes: OpcoesDaConta = {}): Conta {
  const conta = Conta.criar({
    id: opcoes.id ?? CONTA,
    nome: NOME,
    email: Email.criar(opcoes.email ?? EMAIL),
    telefone: Telefone.criar('35999991234'),
    senhaHash: HasherFalso.hashDe(SENHA),
    agora: CRIADA_EM,
  });
  if (opcoes.admin === true) conta.concederAdmin(CRIADA_EM);
  if (opcoes.verificada === true) conta.verificarEmail(CRIADA_EM);
  if (opcoes.desativada === true) conta.desativar(CRIADA_EM);
  if (opcoes.semSenha === true) return Conta.reconstituir({ ...conta.dados, senhaHash: null });
  return conta;
}

function entrada(parcial: Partial<EntradaDeEntrar> = {}): EntradaDeEntrar {
  return { email: EMAIL, senha: SENHA, cliente: 'app_consumidor', ip: IP, ...parcial };
}

function freio({ identidade }: Cenario, tipo: 'email' | 'ip', chave: string) {
  return identidade.bloqueios.todos().find((b) => b.tipo === tipo && b.chaveHmac === chave);
}

async function sessaoDe(resultado: ResultadoDeEntrar) {
  if (resultado.tipo !== 'sessao') throw new Error(`esperava sessão, veio ${resultado.tipo}`);
  const reivindicacoes = await emissor.verificar(resultado.sessao.tokenAcesso, AGORA);
  return { sessao: resultado.sessao, reivindicacoes };
}

describe('EntrarCasoDeUso', () => {
  it('o corpo do contrato entra no caso de uso (o IP vem da rota)', () => {
    expectTypeOf<Entrar>().toExtend<Omit<EntradaDeEntrar, 'ip'>>();
  });

  describe('apps', () => {
    it('senha certa: sessão de 15 min com renovação de 30 dias, família nova e login gravado (CA-03, P1-dono)', async () => {
      const cenario = montar();
      const { identidade, caso, hasher } = cenario;
      await identidade.contas.inserir(novaConta());

      const { sessao, reivindicacoes } = await sessaoDe(await caso.executar(entrada()));

      // Conta não verificada entra; a sessão diz que o e-mail não foi verificado.
      expect(sessao.emailVerificado).toBe(false);
      expect(sessao.expiraEm).toEqual(
        new Date(AGORA.getTime() + SEGUNDOS_DO_TOKEN_DE_ACESSO * 1000),
      );
      expect(reivindicacoes).toEqual({
        contaId: CONTA,
        sid: expect.any(String) as string,
        perfis: ['consumidor'],
        mfa: false,
        emailVerificado: false,
      });
      const [gravada, ...outras] = identidade.sessoes.todas();
      expect(outras).toEqual([]);
      expect(gravada).toMatchObject({
        id: reivindicacoes?.sid,
        contaId: CONTA,
        familiaId: reivindicacoes?.sid,
        cliente: 'app_consumidor',
        tokenHash: cifrador.hmac('token_renovacao', [sessao.tokenRenovacao]),
        expiraEm: new Date(AGORA.getTime() + JANELA_DA_SESSAO_NOS_APPS_EM_MS),
        expiraAbsolutoEm: null,
        mfa: false,
        revogadaEm: null,
      });
      expect(identidade.contas.dadosDe(CONTA)?.ultimoLoginEm).toEqual(AGORA);
      expect(hasher.chamadas).toEqual({ gerarHash: 0, verificar: 1, simularVerificacao: 0 });
    });

    it('conta verificada: a sessão leva `emailVerificado: true` (P1-dono)', async () => {
      const cenario = montar();
      await cenario.identidade.contas.inserir(novaConta({ verificada: true }));

      const { sessao, reivindicacoes } = await sessaoDe(await cenario.caso.executar(entrada()));

      expect(sessao.emailVerificado).toBe(true);
      expect(reivindicacoes?.emailVerificado).toBe(true);
    });

    it('a mesma conta entra nos dois apps, cada um com a sua sessão (CA-07)', async () => {
      const cenario = montar();
      await cenario.identidade.contas.inserir(novaConta());

      await sessaoDe(await cenario.caso.executar(entrada({ cliente: 'app_consumidor' })));
      await sessaoDe(await cenario.caso.executar(entrada({ cliente: 'app_lojista' })));

      const sessoes = cenario.identidade.sessoes.todas();
      expect(sessoes.map((s) => s.cliente).sort()).toEqual(['app_consumidor', 'app_lojista']);
      expect(new Set(sessoes.map((s) => s.familiaId)).size).toBe(2);
    });

    it('conta admin nos apps entra sem poderes de admin e sem `mfa` (S1)', async () => {
      const cenario = montar();
      await cenario.identidade.contas.inserir(novaConta({ admin: true }));

      const { reivindicacoes } = await sessaoDe(await cenario.caso.executar(entrada()));

      expect(reivindicacoes?.perfis).toEqual(['consumidor']);
      expect(reivindicacoes?.mfa).toBe(false);
      expect(cenario.identidade.desafios.todos()).toEqual([]);
    });

    it('conta desativada entre a leitura e a gravação do login: 401, sem sessão', async () => {
      // Lê a conta como estava antes da exclusão confirmada no meio.
      const ativa = novaConta();
      class ContasComLeituraVelha extends ContasEmMemoria {
        override buscarPorEmail(): Promise<Conta | null> {
          return Promise.resolve(Conta.reconstituir(ativa.dados));
        }
      }
      let contas: ContasComLeituraVelha | undefined;
      const cenario = montar((identidade) => {
        contas = new ContasComLeituraVelha(identidade.unidade);
        return contas;
      });
      if (contas === undefined) throw new Error('repositório de contas não montado');
      await contas.inserir(novaConta({ desativada: true }));

      await expect(cenario.caso.executar(entrada())).resolves.toEqual(CREDENCIAIS_INVALIDAS);

      expect(cenario.identidade.sessoes.todas()).toEqual([]);
      expect(contas.dadosDe(CONTA)?.status).toBe('desativada');
      expect(contas.dadosDe(CONTA)?.ultimoLoginEm).toBeNull();
    });
  });

  describe('mesma resposta para todo motivo de recusa (CA-04, CA-12)', () => {
    it.each<[string, OpcoesDaConta | null, string]>([
      ['senha errada', {}, 'senha-errada-qualquer'],
      ['e-mail sem conta', null, SENHA],
      ['conta desativada', { desativada: true }, SENHA],
      ['conta sem senha (admin antes da redefinição)', { semSenha: true, admin: true }, SENHA],
    ])('%s: `credenciais_invalidas`, uma falha em cada freio', async (_motivo, conta, senha) => {
      const cenario = montar();
      if (conta !== null) await cenario.identidade.contas.inserir(novaConta(conta));

      const resultado = await cenario.caso.executar(entrada({ senha }));

      expect(resultado).toEqual(CREDENCIAIS_INVALIDAS);
      const textoDoResultado = JSON.stringify(resultado);
      for (const proibido of [EMAIL, senha, NOME]) expect(textoDoResultado).not.toContain(proibido);
      const chaveDoEmail = chaveDoFreioPorEmail(cifrador, Email.criar(EMAIL));
      expect(freio(cenario, 'email', chaveDoEmail)?.falhas).toBe(1);
      expect(freio(cenario, 'ip', chaveDoFreioPorOrigem(cifrador, IP))?.falhas).toBe(1);
      expect(cenario.identidade.sessoes.todas()).toEqual([]);
    });

    it('e-mail sem conta, conta desativada e conta sem senha gastam o hash fictício; a senha errada, o real', async () => {
      const casos: [OpcoesDaConta | null, string, 'verificar' | 'simularVerificacao'][] = [
        [{}, 'senha-errada-qualquer', 'verificar'],
        [null, SENHA, 'simularVerificacao'],
        [{ desativada: true }, SENHA, 'simularVerificacao'],
        [{ semSenha: true, admin: true }, SENHA, 'simularVerificacao'],
      ];
      for (const [conta, senha, chamada] of casos) {
        const cenario = montar();
        if (conta !== null) await cenario.identidade.contas.inserir(novaConta(conta));
        await cenario.caso.executar(entrada({ senha }));
        expect(cenario.hasher.chamadas[chamada]).toBe(1);
        expect(cenario.hasher.chamadas.verificar + cenario.hasher.chamadas.simularVerificacao).toBe(
          1,
        );
      }
    });
  });

  describe('freio (CA-04, S14)', () => {
    it('5 falhas pelo e-mail em 15 min: espera de 1, 5 e 15 min, e a senha certa não é conferida durante a espera', async () => {
      const cenario = montar();
      const { identidade, caso, relogio, hasher } = cenario;
      await identidade.contas.inserir(novaConta());

      for (const espera of ESPERAS_EM_MS) {
        for (let falha = 0; falha < 5; falha += 1) {
          // Cada tentativa de uma origem diferente: só o freio por e-mail soma 5.
          const ip = `198.51.100.${falha + 1}`;
          await expect(
            caso.executar(entrada({ senha: 'senha-errada-qualquer', ip })),
          ).resolves.toEqual(CREDENCIAIS_INVALIDAS);
        }
        const verificacoes = hasher.chamadas.verificar;
        await expect(caso.executar(entrada())).resolves.toEqual({
          tipo: 'freado',
          segundosDeEspera: espera / 1000,
        });
        expect(hasher.chamadas.verificar).toBe(verificacoes);
        relogio.avancar(espera);
      }
      // Depois da terceira espera (15 min), a senha certa entra.
      await sessaoDe(await caso.executar(entrada()));
    });

    it('e-mail sem conta também é freado depois de 5 falhas (S14)', async () => {
      const { caso } = montar();
      for (let falha = 0; falha < 5; falha += 1) {
        await caso.executar(entrada({ ip: `198.51.100.${falha + 1}` }));
      }
      await expect(caso.executar(entrada())).resolves.toEqual({
        tipo: 'freado',
        segundosDeEspera: 60,
      });
    });

    it('50 falhas da mesma origem, com e-mails diferentes, freiam a origem para qualquer e-mail', async () => {
      const cenario = montar();
      await cenario.identidade.contas.inserir(novaConta());
      for (let falha = 0; falha < 50; falha += 1) {
        await cenario.caso.executar(entrada({ email: `pessoa${falha}@exemplo.com` }));
      }

      await expect(cenario.caso.executar(entrada())).resolves.toEqual({
        tipo: 'freado',
        segundosDeEspera: 60,
      });
      // Outra origem segue entrando.
      await sessaoDe(await cenario.caso.executar(entrada({ ip: '203.0.113.99' })));
    });

    it('IPv6 do mesmo /64 conta como uma origem só', async () => {
      const { caso } = montar();
      for (let falha = 0; falha < 50; falha += 1) {
        await caso.executar(
          entrada({ email: `pessoa${falha}@exemplo.com`, ip: `2001:db8:0:1::${falha + 1}` }),
        );
      }
      await expect(caso.executar(entrada({ ip: '2001:db8:0:1:abcd::1' }))).resolves.toEqual({
        tipo: 'freado',
        segundosDeEspera: 60,
      });
    });

    it('IP vazio e IP inválido dividem o freio da origem desconhecida (falha fechada)', async () => {
      const cenario = montar();
      await cenario.identidade.contas.inserir(novaConta());
      for (let falha = 0; falha < 50; falha += 1) {
        const ip = falha % 2 === 0 ? '' : 'x';
        await cenario.caso.executar(entrada({ email: `pessoa${falha}@exemplo.com`, ip }));
      }

      for (const ip of ['', 'x', null, undefined]) {
        await expect(cenario.caso.executar(entrada({ ip }))).resolves.toEqual({
          tipo: 'freado',
          segundosDeEspera: 60,
        });
      }
      await sessaoDe(await cenario.caso.executar(entrada({ ip: IP })));
    });

    it('a senha certa zera o freio por e-mail, mas não o da origem', async () => {
      const cenario = montar();
      await cenario.identidade.contas.inserir(novaConta());
      for (let falha = 0; falha < 4; falha += 1) {
        await cenario.caso.executar(entrada({ senha: 'senha-errada-qualquer' }));
      }

      await sessaoDe(await cenario.caso.executar(entrada()));

      const chaveDoEmail = chaveDoFreioPorEmail(cifrador, Email.criar(EMAIL));
      expect(freio(cenario, 'email', chaveDoEmail)).toBeUndefined();
      expect(freio(cenario, 'ip', chaveDoFreioPorOrigem(cifrador, IP))?.falhas).toBe(4);
      // Quatro falhas novas não freiam: a contagem do e-mail recomeçou.
      for (let falha = 0; falha < 4; falha += 1) {
        await cenario.caso.executar(entrada({ senha: 'senha-errada-qualquer' }));
      }
      await sessaoDe(await cenario.caso.executar(entrada()));
    });

    it('a senha é conferida fora da transação, entre a reserva e a conclusão (S91)', async () => {
      const cenario = montar();
      await cenario.identidade.contas.inserir(novaConta());
      const execucoes = cenario.identidade.unidade.execucoes;

      await sessaoDe(await cenario.caso.executar(entrada()));
      await expect(
        cenario.caso.executar(entrada({ senha: 'senha-errada-qualquer' })),
      ).resolves.toEqual(CREDENCIAIS_INVALIDAS);

      // Senha certa: reserva e conclusão; senha errada: só a reserva.
      expect(cenario.identidade.unidade.execucoes - execucoes).toBe(3);
      expect(cenario.hasher.chamadas.verificar).toBe(2);
    });

    it('a falha reservada fica na origem só quando a senha está errada; o sucesso a estorna', async () => {
      const cenario = montar();
      await cenario.identidade.contas.inserir(novaConta());
      const origem = () => freio(cenario, 'ip', chaveDoFreioPorOrigem(cifrador, IP));

      await sessaoDe(await cenario.caso.executar(entrada()));
      expect(origem()).toBeUndefined();
      await cenario.caso.executar(entrada({ senha: 'senha-errada-qualquer' }));
      await sessaoDe(await cenario.caso.executar(entrada()));
      expect(origem()?.falhas).toBe(1);
    });

    it('senha trocada entre a conferência e a conclusão (redefinição no meio): 401, sem sessão, e a falha reservada fica', async () => {
      const cenario = montar();
      const { identidade, caso, hasher } = cenario;
      await identidade.contas.inserir(novaConta());
      const verificar = hasher.verificar.bind(hasher);
      hasher.verificar = async (senha, hash) => {
        const confere = await verificar(senha, hash);
        // Outra requisição redefine a senha enquanto esta conferia a antiga.
        await identidade.contas.gravarSenhaRedefinida(CONTA, HasherFalso.hashDe('nova'), AGORA);
        return confere;
      };

      await expect(caso.executar(entrada())).resolves.toEqual(CREDENCIAIS_INVALIDAS);

      expect(identidade.sessoes.todas()).toEqual([]);
      expect(identidade.contas.dadosDe(CONTA)?.ultimoLoginEm).toBeNull();
      const chaveDoEmail = chaveDoFreioPorEmail(cifrador, Email.criar(EMAIL));
      expect(freio(cenario, 'email', chaveDoEmail)?.falhas).toBe(1);
      expect(freio(cenario, 'ip', chaveDoFreioPorOrigem(cifrador, IP))?.falhas).toBe(1);
    });

    it('conta desativada entre a conferência e a conclusão: 401, sem sessão', async () => {
      const cenario = montar();
      const { identidade, caso, hasher } = cenario;
      await identidade.contas.inserir(novaConta());
      const verificar = hasher.verificar.bind(hasher);
      hasher.verificar = async (senha, hash) => {
        const confere = await verificar(senha, hash);
        await identidade.contas.gravarDesativacao(CONTA, AGORA);
        return confere;
      };

      await expect(caso.executar(entrada())).resolves.toEqual(CREDENCIAIS_INVALIDAS);
      expect(identidade.sessoes.todas()).toEqual([]);
      expect(identidade.contas.dadosDe(CONTA)?.ultimoLoginEm).toBeNull();
    });

    it('logins simultâneos do mesmo e-mail: a senha é conferida só 5 vezes, o resto é freado', async () => {
      const cenario = montar();
      await cenario.identidade.contas.inserir(novaConta());

      const resultados = await Promise.all(
        Array.from({ length: 8 }, () =>
          cenario.caso.executar(entrada({ senha: 'senha-errada-qualquer' })),
        ),
      );

      expect(resultados.filter((r) => r.tipo === 'credenciais_invalidas')).toHaveLength(5);
      expect(resultados.filter((r) => r.tipo === 'freado')).toHaveLength(3);
      expect(cenario.hasher.chamadas.verificar).toBe(5);
    });
  });

  describe('painel', () => {
    it('senha certa sem perfil admin: `sem_acesso_painel` só com o id, sem sessão nem login gravado (S23)', async () => {
      const cenario = montar();
      await cenario.identidade.contas.inserir(novaConta());

      const resultado = await cenario.caso.executar(entrada({ cliente: 'painel' }));

      expect(resultado).toEqual({ tipo: 'sem_acesso_painel', contaId: CONTA });
      expect(cenario.identidade.sessoes.todas()).toEqual([]);
      expect(cenario.identidade.desafios.todos()).toEqual([]);
      expect(cenario.identidade.contas.dadosDe(CONTA)?.ultimoLoginEm).toBeNull();
      // A senha estava certa: o freio por e-mail zera.
      const chaveDoEmail = chaveDoFreioPorEmail(cifrador, Email.criar(EMAIL));
      expect(freio(cenario, 'email', chaveDoEmail)).toBeUndefined();
    });

    it('sem perfil admin e senha errada: a mensagem genérica, não `sem_acesso_painel`', async () => {
      const cenario = montar();
      await cenario.identidade.contas.inserir(novaConta());

      await expect(
        cenario.caso.executar(entrada({ cliente: 'painel', senha: 'senha-errada-qualquer' })),
      ).resolves.toEqual(CREDENCIAIS_INVALIDAS);
    });

    it('conta no freio recebe o freio, mesmo com a senha certa e sem admin (S23)', async () => {
      const cenario = montar();
      await cenario.identidade.contas.inserir(novaConta());
      for (let falha = 0; falha < 5; falha += 1) {
        await cenario.caso.executar(entrada({ cliente: 'painel', senha: 'senha-errada-qualquer' }));
      }

      await expect(cenario.caso.executar(entrada({ cliente: 'painel' }))).resolves.toEqual({
        tipo: 'freado',
        segundosDeEspera: 60,
      });
    });

    it('admin sem segundo fator: desafio `configurar`, sem sessão nem login gravado (S1, CA-09)', async () => {
      const cenario = montar();
      const { identidade, caso } = cenario;
      await identidade.contas.inserir(novaConta({ admin: true }));

      const resultado = await caso.executar(entrada({ cliente: 'painel' }));

      if (resultado.tipo !== 'desafio') throw new Error(`esperava desafio, veio ${resultado.tipo}`);
      expect(resultado.desafio.etapa).toBe('configurar');
      const [id] = resultado.desafio.desafio.split('.');
      expect(identidade.desafios.todos()).toEqual([
        expect.objectContaining({ id, contaId: CONTA, etapa: 'configurar' }),
      ]);
      expect(identidade.sessoes.todas()).toEqual([]);
      expect(identidade.contas.dadosDe(CONTA)?.ultimoLoginEm).toBeNull();
    });

    it('admin com segundo fator confirmado: desafio `verificar`', async () => {
      const cenario = montar();
      await cenario.identidade.contas.inserir(novaConta({ admin: true }));
      await cenario.identidade.segundoFator.salvar({
        contaId: CONTA,
        segredoCifrado: cifrador.cifrar('segredo_totp', 'JBSWY3DPEHPK3PXP', CONTA),
        confirmadoEm: CRIADA_EM,
        ultimoPassoUsado: null,
      });

      const resultado = await cenario.caso.executar(entrada({ cliente: 'painel' }));

      expect(resultado).toMatchObject({ tipo: 'desafio', desafio: { etapa: 'verificar' } });
      expect(cenario.identidade.sessoes.todas()).toEqual([]);
    });

    it('admin com a senha errada: a mensagem genérica, sem desafio', async () => {
      const cenario = montar();
      await cenario.identidade.contas.inserir(novaConta({ admin: true }));

      await expect(
        cenario.caso.executar(entrada({ cliente: 'painel', senha: 'senha-errada-qualquer' })),
      ).resolves.toEqual(CREDENCIAIS_INVALIDAS);
      expect(cenario.identidade.desafios.todos()).toEqual([]);
    });
  });

  it('nenhum resultado leva e-mail, senha ou nome (CA-12)', async () => {
    const cenario = montar();
    await cenario.identidade.contas.inserir(novaConta());
    await cenario.identidade.contas.inserir(
      novaConta({
        id: 'aaaaaaaa-0000-4000-8000-000000000002',
        email: 'adm@exemplo.com',
        admin: true,
      }),
    );
    const resultados = [
      await cenario.caso.executar(entrada()),
      await cenario.caso.executar(entrada({ cliente: 'painel' })),
      await cenario.caso.executar(entrada({ email: 'adm@exemplo.com', cliente: 'painel' })),
      await cenario.caso.executar(entrada({ senha: 'senha-errada-qualquer' })),
    ];
    const texto = JSON.stringify(resultados);
    for (const proibido of [EMAIL, 'adm@exemplo.com', SENHA, 'senha-errada-qualquer', NOME]) {
      expect(texto).not.toContain(proibido);
    }
  });

  it('dentro de 15 min a janela do freio por e-mail continua aberta; depois dela, recomeça', async () => {
    const cenario = montar();
    await cenario.identidade.contas.inserir(novaConta());
    for (let falha = 0; falha < 4; falha += 1) {
      await cenario.caso.executar(entrada({ senha: 'senha-errada-qualquer' }));
    }
    cenario.relogio.avancar(15 * UM_MINUTO_EM_MS);

    // A quinta falha caiu numa janela nova: ainda não freia.
    await cenario.caso.executar(entrada({ senha: 'senha-errada-qualquer' }));
    await sessaoDe(await cenario.caso.executar(entrada()));
  });
});
