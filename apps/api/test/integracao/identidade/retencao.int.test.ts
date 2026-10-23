// Tarefas diárias da Identidade contra o Postgres de teste (01b, etapa 13; P1-dono, S6, S8,
// S78, S81, P12): o expurgo de contas não verificadas com a trigger `contas_so_expurgo`
// contando o tempo pelo `now()` do banco, e a retenção com o SQL de verdade.
//
// Expurgo (S78): as contas são gravadas com `criada_em` e `ultimo_login_em` relativos ao
// relógio do banco (`now()`), não ao `RelogioFixo`; o relógio da pilha é posto no `now()` do
// banco (ou um pouco depois, para criar a fronteira em que o domínio apagaria e a trigger
// recusa).
//
// Retenção: o "agora" da tarefa fica em 2001, e as linhas do teste em volta dos limites.
// O DELETE da tarefa vale para a tabela inteira; com o agora no passado, ele só alcança as
// linhas deste arquivo, nunca as que outros arquivos de integração gravaram.
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PinoLogger } from 'nestjs-pino';
import { ApagarContasNaoVerificadasTarefa } from '../../../src/modulos/identidade/aplicacao/tarefas/apagar-nao-verificadas.tarefa.ts';
import {
  RETENCAO_DAS_SESSOES_EM_MS,
  RETENCAO_DOS_CODIGOS_EM_MS,
  RETENCAO_DOS_FREIOS_EM_MS,
  ReterDadosDaIdentidadeTarefa,
} from '../../../src/modulos/identidade/aplicacao/tarefas/reter-dados.tarefa.ts';
import { BloqueioDeLogin } from '../../../src/modulos/identidade/dominio/bloqueio-de-login.ts';
import {
  CodigoDeVerificacao,
  VALIDADE_DO_CODIGO_EM_MS,
} from '../../../src/modulos/identidade/dominio/codigo-de-verificacao.ts';
import {
  DesafioDeSegundoFator,
  VALIDADE_DO_DESAFIO_EM_MS,
} from '../../../src/modulos/identidade/dominio/desafio-de-segundo-fator.ts';
import { Sessao } from '../../../src/modulos/identidade/dominio/sessao.ts';
import {
  apagarContasDoTeste,
  cadastrar,
  conectarDono,
  type DocumentosDeTeste,
  montarPilha,
  semearDocumentos,
  UM_DIA,
  UM_MINUTO,
} from './pilha-de-casos-de-uso.ts';

const p = montarPilha();
let dono: pg.Client;
let docs: DocumentosDeTeste;
const contasDoTeste: string[] = [];
const freiosDoTeste: string[] = [];

function loggerSilencioso(): PinoLogger {
  const nada = () => undefined;
  return { setContext: nada, info: nada, warn: nada, error: nada } as unknown as PinoLogger;
}

const expurgo = new ApagarContasNaoVerificadasTarefa(
  p.unidade,
  p.relogio,
  p.repos.contas,
  loggerSilencioso(),
);
const retencao = new ReterDadosDaIdentidadeTarefa(
  p.unidade,
  p.relogio,
  p.repos.bloqueios,
  p.repos.sessoes,
  p.repos.codigos,
  p.repos.exportacoes,
  loggerSilencioso(),
);

beforeAll(async () => {
  dono = await conectarDono();
  docs = await semearDocumentos(dono);
});

afterAll(async () => {
  await apagarContasDoTeste(dono, contasDoTeste, freiosDoTeste);
  await docs.remover();
  await dono.end();
  await p.prisma.$disconnect();
});

/** O `now()` do banco, que a trigger usa. */
async function agoraDoBanco(): Promise<Date> {
  const { rows } = await dono.query<{ agora: Date }>('SELECT now() AS agora');
  const agora = rows[0]?.agora;
  if (agora === undefined) throw new Error('sem now()');
  return agora;
}

/**
 * Conta não verificada gravada como dono, com `criada_em` = `now() - <intervalo>` (SQL do
 * banco, nunca o relógio da aplicação) e, se pedido, uma sessão dos apps.
 */
async function contaNaoVerificada(intervalo: string, comSessao = false): Promise<string> {
  const id = randomUUID();
  await dono.query(
    `INSERT INTO identidade.contas (id, nome, email_normalizado, telefone_e164, senha_hash, criada_em)
     VALUES ($1, 'Pessoa de Teste', $2, '+5535999991234', 'hash', now() - $3::interval)`,
    [id, `expurgo.${id.slice(0, 12)}@exemplo.com.br`, intervalo],
  );
  await dono.query(
    `INSERT INTO identidade.perfis_conta (conta_id, perfil, concedido_em) VALUES ($1, 'consumidor', now())`,
    [id],
  );
  contasDoTeste.push(id);
  if (comSessao) {
    await p.repos.sessoes.inserir(
      Sessao.criar({
        id: randomUUID(),
        contaId: id,
        cliente: 'app_consumidor',
        tokenHash: `hash-${id}`,
        mfa: false,
        agora: await agoraDoBanco(),
      }),
    );
  }
  return id;
}

async function existe(contaId: string): Promise<boolean> {
  const { rows } = await dono.query('SELECT 1 FROM identidade.contas WHERE id = $1', [contaId]);
  return rows.length > 0;
}

async function sessoesDe(contaId: string): Promise<number> {
  const { rows } = await dono.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM identidade.sessoes WHERE conta_id = $1',
    [contaId],
  );
  return rows[0]?.n ?? 0;
}

describe('expurgo de contas não verificadas (P1-dono, S8, S78)', () => {
  it('apaga com as sessões; a conta na fronteira, no meio do lote, é recusada pela trigger sem derrubar o lote', async () => {
    const antiga = await contaNaoVerificada('10 days', true);
    const fronteira = await contaNaoVerificada('7 days - 30 minutes', true);
    const outra = await contaNaoVerificada('9 days', true);
    // O relógio da aplicação 1 h à frente do banco: para o domínio, a fronteira já passou dos
    // 7 dias; para a trigger (`now()`), ainda não.
    const banco = await agoraDoBanco();
    p.relogio.definir(new Date(banco.getTime() + 60 * UM_MINUTO));
    const listar = p.repos.contas.listarParaExpurgo.bind(p.repos.contas);
    const lista = vi
      .spyOn(p.repos.contas, 'listarParaExpurgo')
      .mockImplementation(async (limite, quantidade) => {
        const ids = (await listar(limite, quantidade)).filter((id) =>
          [antiga, fronteira, outra].includes(id),
        );
        // A fronteira no meio do lote (a ordem da consulta a deixaria por último).
        return ids.length === 3 ? [antiga, fronteira, outra] : ids;
      });

    try {
      await expect(expurgo.executar()).resolves.toEqual({
        apagadas: 2,
        mantidas: 0,
        recusadas: 1,
      });
    } finally {
      lista.mockRestore();
    }

    expect(await existe(antiga)).toBe(false);
    expect(await existe(outra)).toBe(false);
    expect(await sessoesDe(antiga)).toBe(0);
    expect(await sessoesDe(outra)).toBe(0);
    // A recusada ficou inteira, com a sessão: o 23514 desfez só a transação dela.
    expect(await existe(fronteira)).toBe(true);
    expect(await sessoesDe(fronteira)).toBe(1);
  });

  it('quem renovou entre a listagem e a exclusão (ultimo_login_em gravado) fica', async () => {
    const renovou = await contaNaoVerificada('8 days');
    const banco = await agoraDoBanco();
    p.relogio.definir(banco);
    const outraPilha = montarPilha();
    const listar = p.repos.contas.listarParaExpurgo.bind(p.repos.contas);
    const lista = vi
      .spyOn(p.repos.contas, 'listarParaExpurgo')
      .mockImplementation(async (limite, quantidade) => {
        const ids = (await listar(limite, quantidade)).filter((id) => id === renovou);
        // A renovação, noutra conexão, grava o último login depois da listagem (etapa 9).
        await outraPilha.repos.contas.gravarUltimoLogin(renovou, banco);
        return ids;
      });

    try {
      await expect(expurgo.executar()).resolves.toEqual({
        apagadas: 0,
        mantidas: 1,
        recusadas: 0,
      });
    } finally {
      lista.mockRestore();
      await outraPilha.prisma.$disconnect();
    }
    expect(await existe(renovou)).toBe(true);
  });

  it('o token de renovação e a sessão da conta apagada dão invalida e sessao_invalida (401), não erro interno', async () => {
    const banco = await agoraDoBanco();
    p.relogio.definir(banco);
    const conta = await cadastrar(p, docs);
    contasDoTeste.push(conta.id);
    freiosDoTeste.push(p.servicos.cifrador.hmac('bloqueio_email', [conta.email]));
    const login = await p.casos.entrar.executar({
      email: conta.email,
      senha: conta.senha,
      cliente: 'app_consumidor',
      ip: '198.51.100.31',
    });
    if (login.tipo !== 'sessao') throw new Error(`login devolveu ${login.tipo}`);
    const claims = await p.servicos.emissor.verificar(login.sessao.tokenAcesso, banco);
    if (claims === null) throw new Error('token recusado');
    // O tempo passa no banco: sem login há 8 dias.
    await dono.query(
      `UPDATE identidade.contas SET criada_em = now() - interval '9 days',
              ultimo_login_em = now() - interval '8 days' WHERE id = $1`,
      [conta.id],
    );
    const listar = p.repos.contas.listarParaExpurgo.bind(p.repos.contas);
    const lista = vi
      .spyOn(p.repos.contas, 'listarParaExpurgo')
      .mockImplementation(async (limite, quantidade) =>
        (await listar(limite, quantidade)).filter((id) => id === conta.id),
      );
    try {
      await expect(expurgo.executar()).resolves.toMatchObject({ apagadas: 1 });
    } finally {
      lista.mockRestore();
    }

    expect(await existe(conta.id)).toBe(false);
    expect(await sessoesDe(conta.id)).toBe(0);
    await expect(
      p.casos.renovar.executar({
        tokenRenovacao: login.sessao.tokenRenovacao,
        cliente: 'app_consumidor',
      }),
    ).resolves.toEqual({ tipo: 'invalida' });
    await expect(
      p.casos.verificarEmail.executar({ contaId: conta.id, sid: claims.sid, codigo: '123456' }),
    ).resolves.toEqual({ tipo: 'sessao_invalida' });
    await expect(p.repos.contas.buscarPorId(conta.id)).resolves.toBeNull();
  });
});

describe('retenção (S81, P12): uma linha logo antes e outra logo depois de cada prazo', () => {
  const AGORA = new Date('2001-03-01T12:00:00.000Z');
  const T = AGORA.getTime();
  let contaId: string;

  beforeAll(async () => {
    contaId = randomUUID();
    await dono.query(
      `INSERT INTO identidade.contas (id, nome, email_normalizado, telefone_e164, senha_hash, criada_em)
       VALUES ($1, 'Pessoa de Teste', $2, '+5535999991234', 'hash', '2000-12-01T00:00:00Z')`,
      [contaId, `retencao.${contaId.slice(0, 12)}@exemplo.com.br`],
    );
    contasDoTeste.push(contaId);
  });

  it('freios: greatest(bloqueado_ate, janela_inicio) < agora - 30 min', async () => {
    const limite = T - RETENCAO_DOS_FREIOS_EM_MS;
    const prefixo = `retencao-${randomUUID().slice(0, 8)}`;
    const linhas: [string, number, number | null][] = [
      ['janela-antes', limite - 1, null],
      ['janela-no-limite', limite, null],
      ['espera-antes', limite - 60_000, limite - 1],
      ['espera-depois', limite - 60_000, limite + 1],
      ['janela-nova-com-espera-antiga', limite + 1, limite - 10 * UM_MINUTO],
    ];
    for (const [nome, janela, espera] of linhas) {
      const chave = `${prefixo}-${nome}`;
      freiosDoTeste.push(chave);
      await p.repos.bloqueios.salvar(
        BloqueioDeLogin.reconstituir({
          chaveHmac: chave,
          tipo: 'ip',
          falhas: 1,
          nivel: espera === null ? 0 : 1,
          janelaInicio: new Date(janela),
          bloqueadoAte: espera === null ? null : new Date(espera),
        }),
      );
    }
    p.relogio.definir(AGORA);

    const resultado = await retencao.executar();

    expect(resultado.freios).toBe(2);
    const { rows } = await dono.query<{ chave_hmac: string }>(
      'SELECT chave_hmac FROM identidade.bloqueios_login WHERE chave_hmac LIKE $1 ORDER BY 1',
      [`${prefixo}-%`],
    );
    expect(rows.map((r) => r.chave_hmac.slice(prefixo.length + 1))).toEqual([
      'espera-depois',
      'janela-no-limite',
      'janela-nova-com-espera-antiga',
    ]);
  });

  it('sessões: coalesce(revogada_em, expira_em) < agora - 30 dias, com o histórico de tokens em cascata', async () => {
    const limite = T - RETENCAO_DAS_SESSOES_EM_MS;
    const duracao = 30 * UM_DIA;
    const criar = (criadaEm: number) =>
      Sessao.criar({
        id: randomUUID(),
        contaId,
        cliente: 'app_consumidor',
        tokenHash: `hash-${randomUUID()}`,
        mfa: false,
        agora: new Date(criadaEm),
      });
    const vencidaAntes = criar(limite - duracao - 1);
    const vencidaNoLimite = criar(limite - duracao);
    const revogadaAntes = criar(limite - UM_DIA);
    revogadaAntes.revogar('logout', new Date(limite - 1));
    const revogadaDepois = criar(limite - UM_DIA);
    revogadaDepois.revogar('logout', new Date(limite + 1));
    for (const sessao of [vencidaAntes, vencidaNoLimite, revogadaAntes, revogadaDepois]) {
      await p.repos.sessoes.inserir(sessao);
    }
    // Um token já trocado da sessão que vai sair: o histórico vai junto (FK em cascata).
    await p.unidade.executar(async () => {
      const lida = await p.repos.sessoes.buscarPorId(vencidaAntes.id);
      if (lida === null) throw new Error('sessão sumiu');
      // Renovada logo ao nascer: o prazo deslizante vence 1 ms antes do limite.
      lida.rotacionar(`hash-${randomUUID()}`, 'par-cifrado', new Date(limite - duracao - 1));
      expect(await p.repos.sessoes.gravarRotacao(lida)).toBe(true);
    });
    p.relogio.definir(AGORA);

    const resultado = await retencao.executar();

    expect(resultado.sessoes).toBe(2);
    const { rows } = await dono.query<{ id: string }>(
      'SELECT id::text FROM identidade.sessoes WHERE conta_id = $1 ORDER BY id',
      [contaId],
    );
    expect(rows.map((r) => r.id).sort()).toEqual([vencidaNoLimite.id, revogadaDepois.id].sort());
    const historico = await dono.query(
      'SELECT 1 FROM identidade.tokens_de_renovacao_usados WHERE sessao_id = $1',
      [vencidaAntes.id],
    );
    expect(historico.rows).toEqual([]);
  });

  it('códigos e desafios: coalesce(usado_em, expira_em) < agora - 1 dia', async () => {
    const limite = T - RETENCAO_DOS_CODIGOS_EM_MS;
    const codigo = (emitidoEm: number) =>
      CodigoDeVerificacao.emitir({
        id: randomUUID(),
        contaId,
        finalidade: 'verificacao_email',
        codigoHmac: `hmac-${randomUUID()}`,
        agora: new Date(emitidoEm),
      });
    const vencidoAntes = codigo(limite - VALIDADE_DO_CODIGO_EM_MS - 1);
    const vencidoNoLimite = codigo(limite - VALIDADE_DO_CODIGO_EM_MS);
    const usadoAntes = codigo(limite - UM_MINUTO);
    usadoAntes.invalidar(new Date(limite - 1));
    const usadoDepois = codigo(limite - UM_MINUTO);
    usadoDepois.invalidar(new Date(limite + 1));
    for (const c of [vencidoAntes, vencidoNoLimite, usadoAntes, usadoDepois]) {
      await p.repos.codigos.inserir(c);
      await p.repos.codigos.atualizar(c);
    }
    const desafio = (emitidoEm: number) =>
      DesafioDeSegundoFator.emitir({
        id: randomUUID(),
        contaId,
        etapa: 'configurar',
        tokenHmac: `hmac-${randomUUID()}`,
        agora: new Date(emitidoEm),
      });
    const desafioAntes = desafio(limite - VALIDADE_DO_DESAFIO_EM_MS - 1);
    const desafioNoLimite = desafio(limite - VALIDADE_DO_DESAFIO_EM_MS);
    await p.repos.desafios.inserir(desafioAntes);
    await p.repos.desafios.inserir(desafioNoLimite);
    p.relogio.definir(AGORA);

    const resultado = await retencao.executar();

    expect(resultado.codigos).toBe(3);
    const { rows } = await dono.query<{ id: string }>(
      'SELECT id::text FROM identidade.codigos_verificacao WHERE conta_id = $1',
      [contaId],
    );
    expect(rows.map((r) => r.id).sort()).toEqual(
      [vencidoNoLimite.id, usadoDepois.id, desafioNoLimite.id].sort(),
    );
  });

  it('o teto de 10 códigos por dia (S93) conta pelo criado_em, e a retenção não apaga os das últimas 24 h', async () => {
    const desde = new Date(T - UM_DIA);
    const novo = (emitidoEm: number) =>
      CodigoDeVerificacao.emitir({
        id: randomUUID(),
        contaId,
        finalidade: 'recuperacao_senha',
        codigoHmac: `hmac-${randomUUID()}`,
        agora: new Date(emitidoEm),
      });
    const noLimite = novo(desde.getTime());
    const logoDepois = novo(desde.getTime() + 1);
    logoDepois.invalidar(new Date(desde.getTime() + 2));
    for (const c of [noLimite, logoDepois]) {
      await p.repos.codigos.inserir(c);
      await p.repos.codigos.atualizar(c);
    }

    await expect(
      p.repos.codigos.contarEmitidosDesde(contaId, 'recuperacao_senha', desde),
    ).resolves.toBe(1);
    p.relogio.definir(AGORA);
    await retencao.executar();
    // O emitido 1 ms depois de `agora - 24 h` e usado logo em seguida fica.
    const { rows } = await dono.query(
      'SELECT 1 FROM identidade.codigos_verificacao WHERE id = $1',
      [logoDepois.id],
    );
    expect(rows).toHaveLength(1);
  });
});
