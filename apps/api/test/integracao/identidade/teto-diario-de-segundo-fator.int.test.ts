// Teto diário de erros de segundo fator contra o Postgres de verdade (plano 01b, etapa 13; S103,
// decisão do dono de 2026-10-21): 20 códigos errados em 24 h não mexem na conta, o 21º apaga a
// senha, revoga as sessões (inclusive a do app aberta antes) e audita. A soma vem do SQL real
// de `somarTentativasDesde`, que os testes de unidade só veem pelo fake. Os erros vêm em
// rodadas de 4 a cada 15 min, para o freio nunca entrar em espera (o caminho que o teto fecha).
// A redefinição da senha apaga os desafios da conta e recomeça a soma (Q29).
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chaveDoFreioPorOrigem } from '../../../src/modulos/identidade/aplicacao/sessao/comum.ts';
import { chaveDoFreioDeSegundoFator } from '../../../src/modulos/identidade/aplicacao/segundo-fator/comum.ts';
import { LIMITE_DE_ERROS_DE_SEGUNDO_FATOR_POR_DIA } from '../../../src/modulos/identidade/dominio/desafio-de-segundo-fator.ts';
import {
  apagarContasDoTeste,
  conectarDono,
  type DocumentosDeTeste,
  inserirCodigo,
  montarPilha,
  OUTRA_SENHA,
  prepararAdmin,
  semearDocumentos,
  T0,
  totpDe,
  UM_DIA,
  UM_MINUTO,
} from './pilha-de-casos-de-uso.ts';

const p = montarPilha();
const { cifrador } = p.servicos;
const ERRADO = '000000';
const RODADAS_ATE_O_TETO = LIMITE_DE_ERROS_DE_SEGUNDO_FATOR_POR_DIA / 4;

let dono: pg.Client;
let docs: DocumentosDeTeste;
const contasDoTeste: string[] = [];
const freiosDoTeste: string[] = [];
let proximoIp = 100;

function ipNovo(): string {
  proximoIp += 1;
  const ip = `203.0.113.${proximoIp % 250}`;
  freiosDoTeste.push(chaveDoFreioPorOrigem(cifrador, ip));
  return ip;
}

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
  // A auditoria é somente acréscimo: as linhas do teste ficam até o globalSetup recriar o banco.
  await apagarContasDoTeste(dono, contasDoTeste, freiosDoTeste);
  await docs.remover();
  await dono.end();
  await p.prisma.$disconnect();
});

beforeEach(() => {
  p.relogio.definir(T0);
});

async function novoAdmin() {
  const admin = await prepararAdmin(p, docs, ipNovo());
  contasDoTeste.push(admin.conta.id);
  freiosDoTeste.push(
    cifrador.hmac('bloqueio_email', [admin.conta.email]),
    chaveDoFreioDeSegundoFator(cifrador, admin.conta.id),
  );
  return admin;
}

type Admin = Awaited<ReturnType<typeof novoAdmin>>;

async function desafioDoPainel(admin: Admin): Promise<string> {
  const login = await p.casos.entrar.executar({
    email: admin.conta.email,
    senha: admin.conta.senha,
    cliente: 'painel',
    ip: ipNovo(),
  });
  if (login.tipo !== 'desafio') throw new Error(`login do painel devolveu ${login.tipo}`);
  return login.desafio.desafio;
}

/** `erros` códigos errados num desafio novo emitido em `quando`. */
async function errar(admin: Admin, quando: Date, erros: number): Promise<void> {
  p.relogio.definir(quando);
  const desafio = await desafioDoPainel(admin);
  for (let i = 0; i < erros; i += 1) {
    await expect(
      p.casos.verificarSegundoFator.executar({ desafio, codigo: ERRADO }),
    ).resolves.toEqual({ tipo: 'codigo_errado', campo: 'codigo' });
  }
}

async function errosAteOTeto(admin: Admin): Promise<void> {
  for (let rodada = 0; rodada < RODADAS_ATE_O_TETO; rodada += 1) {
    await errar(admin, new Date(T0.getTime() + rodada * 15 * UM_MINUTO), 4);
  }
}

async function estadoDaConta(contaId: string) {
  const conta = await dono.query<{ tem_senha: boolean }>(
    'SELECT senha_hash IS NOT NULL AS tem_senha FROM identidade.contas WHERE id = $1::uuid',
    [contaId],
  );
  const freio = await dono.query<{ nivel: number; bloqueado_ate: Date | null }>(
    'SELECT nivel, bloqueado_ate FROM identidade.bloqueios_login WHERE chave_hmac = $1 AND tipo = $2',
    [chaveDoFreioDeSegundoFator(cifrador, contaId), 'segundo_fator'],
  );
  const auditoria = await dono.query<{ depois: { causa: string } }>(
    "SELECT depois FROM compartilhado.auditoria WHERE acao = 'senha_removida_pelo_freio' AND recurso_id = $1",
    [contaId],
  );
  const eventos = await dono.query<{ tipo: string }>(
    "SELECT tipo FROM compartilhado.outbox WHERE agregado_id = $1::uuid AND tipo = 'identidade.SegundoFatorFreado'",
    [contaId],
  );
  return {
    temSenha: conta.rows[0]?.tem_senha,
    emEspera: freio.rows[0]?.bloqueado_ate != null,
    auditorias: auditoria.rows.map((l) => l.depois.causa),
    avisos: eventos.rowCount,
  };
}

describe('teto diário de erros de segundo fator (S103)', () => {
  it('20 erros em 24 h sem nunca pôr o freio em espera não apagam nada; o 21º apaga e revoga a sessão do app', async () => {
    const admin = await novoAdmin();
    const noApp = await p.casos.entrar.executar({
      email: admin.conta.email,
      senha: admin.conta.senha,
      cliente: 'app_consumidor',
      ip: ipNovo(),
    });
    if (noApp.tipo !== 'sessao') throw new Error(`login no app devolveu ${noApp.tipo}`);

    await errosAteOTeto(admin);

    // 20 exatos: a senha fica, nenhum aviso, nenhuma auditoria, a sessão do app segue.
    expect(await estadoDaConta(admin.conta.id)).toEqual({
      temSenha: true,
      emEspera: false,
      auditorias: [],
      avisos: 0,
    });
    const vivasCom20 = await dono.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM identidade.sessoes WHERE conta_id = $1::uuid AND revogada_em IS NULL',
      [admin.conta.id],
    );
    expect(vivasCom20.rows[0]?.n).toBeGreaterThanOrEqual(1);

    await errar(admin, new Date(T0.getTime() + RODADAS_ATE_O_TETO * 15 * UM_MINUTO), 1);

    expect(await estadoDaConta(admin.conta.id)).toEqual({
      temSenha: false,
      emEspera: false,
      auditorias: ['limite_diario'],
      avisos: 1,
    });
    const vivas = await dono.query<{ n: number; revogadas: number }>(
      `SELECT count(*) FILTER (WHERE revogada_em IS NULL)::int AS n,
              count(*) FILTER (WHERE motivo_revogacao = 'segundo_fator_freado')::int AS revogadas
         FROM identidade.sessoes WHERE conta_id = $1::uuid`,
      [admin.conta.id],
    );
    expect(vivas.rows[0]?.n).toBe(0);
    expect(vivas.rows[0]?.revogadas).toBeGreaterThanOrEqual(1);
    await expect(
      p.casos.renovar.executar({
        tokenRenovacao: noApp.sessao.tokenRenovacao,
        cliente: 'app_consumidor',
      }),
    ).resolves.toEqual({ tipo: 'invalida' });
    // Sem senha, nem a senha certa entra mais (a recuperação por e-mail é o caminho).
    const login = await p.casos.entrar.executar({
      email: admin.conta.email,
      senha: admin.conta.senha,
      cliente: 'painel',
      ip: ipNovo(),
    });
    expect(login.tipo).not.toBe('desafio');
    expect(login.tipo).not.toBe('sessao');
  });

  it('o erro de mais de 24 h atrás sai da soma: 16 recentes + 4 de agora são 20 e não apagam', async () => {
    const admin = await novoAdmin();
    await errosAteOTeto(admin);

    // O primeiro desafio (4 erros) foi emitido em T0, exatamente 24 h antes: já não conta.
    await errar(admin, new Date(T0.getTime() + UM_DIA), 4);

    expect(await estadoDaConta(admin.conta.id)).toMatchObject({ temSenha: true, auditorias: [] });
    // Mais um erro: 16 + 4 + 1 = 21 nas últimas 24 h, e a senha sai.
    await errar(admin, new Date(T0.getTime() + UM_DIA + UM_MINUTO), 1);
    expect(await estadoDaConta(admin.conta.id)).toMatchObject({
      temSenha: false,
      auditorias: ['limite_diario'],
    });
  });

  it('a redefinição da senha recomeça a contagem (Q29): 21 erros, redefinição, 1 erro, e a senha nova fica', async () => {
    const admin = await novoAdmin();
    await errosAteOTeto(admin);
    await errar(admin, new Date(T0.getTime() + RODADAS_ATE_O_TETO * 15 * UM_MINUTO), 1);
    expect((await estadoDaConta(admin.conta.id)).temSenha).toBe(false);

    p.relogio.definir(new Date(T0.getTime() + 6 * 60 * UM_MINUTO));
    await inserirCodigo(p, admin.conta.id, 'recuperacao_senha', '135790');
    await expect(
      p.casos.redefinirSenha.executar({
        ip: ipNovo(),
        email: admin.conta.email,
        codigo: '135790',
        novaSenha: OUTRA_SENHA,
      }),
    ).resolves.toEqual({ tipo: 'redefinida' });
    const desafiosDaConta = await dono.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM identidade.codigos_verificacao
        WHERE conta_id = $1::uuid AND finalidade IN ('desafio_configurar', 'desafio_verificar')`,
      [admin.conta.id],
    );
    expect(desafiosDaConta.rows[0]?.n).toBe(0);

    const login = await p.casos.entrar.executar({
      email: admin.conta.email,
      senha: OUTRA_SENHA,
      cliente: 'painel',
      ip: ipNovo(),
    });
    if (login.tipo !== 'desafio') throw new Error(`login do painel devolveu ${login.tipo}`);
    await expect(
      p.casos.verificarSegundoFator.executar({ desafio: login.desafio.desafio, codigo: ERRADO }),
    ).resolves.toEqual({ tipo: 'codigo_errado', campo: 'codigo' });
    expect(await estadoDaConta(admin.conta.id)).toEqual({
      temSenha: true,
      emEspera: false,
      auditorias: ['limite_diario'],
      avisos: 1,
    });
  });

  it('o código certo depois de 20 erros no dia conclui e não apaga a senha', async () => {
    const admin = await novoAdmin();
    await errosAteOTeto(admin);

    p.relogio.definir(new Date(T0.getTime() + RODADAS_ATE_O_TETO * 15 * UM_MINUTO));
    const desafio = await desafioDoPainel(admin);
    const resultado = await p.casos.verificarSegundoFator.executar({
      desafio,
      codigo: totpDe(admin.segredo, p.relogio.agora()),
    });

    expect(resultado.tipo).toBe('concluido');
    expect(await estadoDaConta(admin.conta.id)).toMatchObject({ temSenha: true, auditorias: [] });
  });
});
