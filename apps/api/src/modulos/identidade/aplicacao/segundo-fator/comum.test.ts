// Peças comuns do 2FA do admin (01b, etapa 10; S1): emissão do desafio com a
// etapa certa e token `<id>.<segredo>`, leitura do token (sem `.`, id
// inexistente e HMAC que não confere dão o mesmo `null`) e a sessão do painel
// com `mfa`.
import { describe, expect, it, vi } from 'vitest';
import {
  CifradorFalso,
  EmissorDeJwtFalso,
  GeradorDeSegredosFalso,
} from '../../../../../test/fakes/identidade/servicos-falsos.ts';
import { criarIdentidadeEmMemoria } from '../../../../../test/fakes/identidade/repositorios-em-memoria.ts';
import { Conta } from '../../dominio/conta.ts';
import {
  DesafioDeSegundoFator,
  VALIDADE_DO_DESAFIO_EM_MS,
} from '../../dominio/desafio-de-segundo-fator.ts';
import { Email } from '../../dominio/email.ts';
import { Telefone } from '../../dominio/telefone.ts';
import {
  abrirSessaoComSegundoFator,
  emitirDesafioDeSegundoFator,
  lerDesafio,
  lerTokenDoDesafio,
  podeConcluirSegundoFator,
  travarFreioPorEmailDoDesafio,
} from './comum.ts';

const AGORA = new Date('2026-10-18T12:00:00.000Z');
const CONTA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OUTRA_CONTA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function cenario() {
  const identidade = criarIdentidadeEmMemoria();
  const cifrador = new CifradorFalso();
  const gerador = new GeradorDeSegredosFalso();
  const emissor = new EmissorDeJwtFalso();
  const emitir = (contaId = CONTA, agora = AGORA) =>
    identidade.unidade.executar(() =>
      emitirDesafioDeSegundoFator(
        { desafios: identidade.desafios, segundoFator: identidade.segundoFator, cifrador, gerador },
        contaId,
        agora,
      ),
    );
  const ler = (token: string) =>
    identidade.unidade.executar(() =>
      lerDesafio({ desafios: identidade.desafios, cifrador }, token),
    );
  return { identidade, cifrador, gerador, emissor, emitir, ler };
}

function admin(): Conta {
  const conta = Conta.criar({
    id: CONTA,
    nome: 'Ana Admin',
    email: Email.criar('ana.admin@exemplo.com'),
    telefone: Telefone.criar('35999991234'),
    senhaHash: 'hash-falso:senha',
    agora: AGORA,
  });
  conta.concederAdmin(AGORA);
  return conta;
}

describe('emitirDesafioDeSegundoFator (S1)', () => {
  it('sem segundo fator: etapa configurar, token <id>.<segredo>, 5 min e só o HMAC guardado', async () => {
    const { identidade, cifrador, emitir } = cenario();
    const emitido = await emitir();

    expect(emitido.etapa).toBe('configurar');
    const lido = lerTokenDoDesafio(emitido.desafio);
    expect(lido).not.toBeNull();
    const [guardado] = identidade.desafios.todos();
    expect(guardado).toMatchObject({
      id: lido?.id,
      contaId: CONTA,
      etapa: 'configurar',
      tentativas: 0,
      usadoEm: null,
      expiraEm: new Date(AGORA.getTime() + VALIDADE_DO_DESAFIO_EM_MS),
    });
    expect(guardado?.tokenHmac).toBe(
      cifrador.hmac('desafio_configurar', [CONTA, lido?.segredo ?? '']),
    );
    expect(JSON.stringify(identidade.desafios.todos())).not.toContain(lido?.segredo);
  });

  it('segundo fator guardado mas não confirmado: ainda configurar', async () => {
    const { identidade, emitir } = cenario();
    await identidade.segundoFator.salvar({
      contaId: CONTA,
      segredoCifrado: 'cifrado',
      confirmadoEm: null,
      ultimoPassoUsado: null,
    });
    expect((await emitir()).etapa).toBe('configurar');
  });

  it('segundo fator confirmado: etapa verificar', async () => {
    const { identidade, emitir } = cenario();
    await identidade.segundoFator.salvar({
      contaId: CONTA,
      segredoCifrado: 'cifrado',
      confirmadoEm: AGORA,
      ultimoPassoUsado: null,
    });
    expect((await emitir()).etapa).toBe('verificar');
  });

  it('o desafio novo invalida os anteriores da conta, das duas etapas; os de outra conta ficam', async () => {
    const { identidade, emitir, ler } = cenario();
    const primeiro = await emitir();
    const daOutra = await emitir(OUTRA_CONTA);
    await identidade.segundoFator.salvar({
      contaId: CONTA,
      segredoCifrado: 'cifrado',
      confirmadoEm: AGORA,
      ultimoPassoUsado: null,
    });
    const segundo = await emitir();

    const desafioDoPrimeiro = await ler(primeiro.desafio);
    expect(desafioDoPrimeiro?.estaValidoPara('configurar', AGORA)).toBe(false);
    expect((await ler(segundo.desafio))?.estaValidoPara('verificar', AGORA)).toBe(true);
    expect((await ler(daOutra.desafio))?.estaValidoPara('configurar', AGORA)).toBe(true);
  });
});

describe('lerDesafio: o mesmo null para qualquer token que não vale', () => {
  it('token certo devolve o desafio, travado na unidade', async () => {
    const { emitir, ler } = cenario();
    const emitido = await emitir();
    expect((await ler(emitido.desafio))?.contaId).toBe(CONTA);
  });

  it('token sem ".", id inexistente e HMAC que não confere dão null', async () => {
    const { emitir, ler } = cenario();
    const emitido = await emitir();
    const lido = lerTokenDoDesafio(emitido.desafio);
    const idInexistente = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

    await expect(ler(emitido.desafio.replace('.', ''))).resolves.toBeNull();
    await expect(ler(`${idInexistente}.${lido?.segredo ?? ''}`)).resolves.toBeNull();
    await expect(ler(`${lido?.id ?? ''}.outro-segredo`)).resolves.toBeNull();
  });

  it('o HMAC liga o segredo à conta e à etapa da linha', async () => {
    const { identidade, cifrador, ler } = cenario();
    const id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    // Linha com o HMAC calculado para outra conta e para a outra etapa.
    await identidade.desafios.inserir(
      DesafioDeSegundoFator.emitir({
        id,
        contaId: CONTA,
        etapa: 'verificar',
        tokenHmac: cifrador.hmac('desafio_verificar', [OUTRA_CONTA, 'segredo']),
        agora: AGORA,
      }),
    );
    const id2 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    await identidade.desafios.inserir(
      DesafioDeSegundoFator.emitir({
        id: id2,
        contaId: CONTA,
        etapa: 'verificar',
        tokenHmac: cifrador.hmac('desafio_configurar', [CONTA, 'segredo']),
        agora: AGORA,
      }),
    );
    await expect(ler(`${id}.segredo`)).resolves.toBeNull();
    await expect(ler(`${id2}.segredo`)).resolves.toBeNull();
  });

  it.each([
    ['vazio', ''],
    ['só o ponto', '.'],
    ['sem segredo', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.'],
    ['dois pontos', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.a.b'],
    ['id que não é UUID (o banco recusaria a consulta)', 'abc.segredo'],
  ])('formato inválido (%s) nem chega ao repositório', (_caso, token) => {
    expect(lerTokenDoDesafio(token)).toBeNull();
  });
});

describe('travarFreioPorEmailDoDesafio (S104)', () => {
  function travar(c: ReturnType<typeof cenario>, token: string) {
    const { identidade, cifrador } = c;
    return identidade.unidade.executar(() =>
      travarFreioPorEmailDoDesafio(
        {
          desafios: identidade.desafios,
          contas: identidade.contas,
          bloqueios: identidade.bloqueios,
          cifrador,
        },
        token,
        AGORA,
      ),
    );
  }

  it('token certo: trava o freio por e-mail da conta, sem travar o desafio, e devolve a conta', async () => {
    const c = cenario();
    await c.identidade.contas.inserir(admin());
    const emitido = await c.emitir();
    const travaDoFreio = vi.spyOn(c.identidade.bloqueios, 'buscarParaAtualizar');
    const travaDoDesafio = vi.spyOn(c.identidade.desafios, 'buscarPorIdParaAtualizar');

    await expect(travar(c, emitido.desafio)).resolves.toBe(CONTA);

    expect(travaDoFreio.mock.calls.map(([, tipo]) => tipo)).toEqual(['email']);
    expect(travaDoDesafio).not.toHaveBeenCalled();
    // O freio não muda: a linha zerada que a trava criou é apagada.
    expect(c.identidade.bloqueios.todos()).toEqual([]);
  });

  it('token mal formado, id inexistente ou HMAC que não confere: null, sem travar nada', async () => {
    const c = cenario();
    await c.identidade.contas.inserir(admin());
    const emitido = await c.emitir();
    const lido = lerTokenDoDesafio(emitido.desafio);
    const travaDoFreio = vi.spyOn(c.identidade.bloqueios, 'buscarParaAtualizar');

    await expect(travar(c, emitido.desafio.replace('.', ''))).resolves.toBeNull();
    await expect(
      travar(c, `cccccccc-cccc-4ccc-8ccc-cccccccccccc.${lido?.segredo ?? ''}`),
    ).resolves.toBeNull();
    await expect(travar(c, `${lido?.id ?? ''}.outro-segredo`)).resolves.toBeNull();
    expect(travaDoFreio).not.toHaveBeenCalled();
  });
});

describe('podeConcluirSegundoFator', () => {
  it('só conta ativa, com senha e com admin', () => {
    const conta = admin();
    expect(podeConcluirSegundoFator(conta)).toBe(true);
    expect(podeConcluirSegundoFator(null)).toBe(false);

    const semAdmin = Conta.reconstituir({
      ...conta.dados,
      perfis: conta.dados.perfis.filter((p) => p.perfil !== 'admin'),
    });
    expect(podeConcluirSegundoFator(semAdmin)).toBe(false);

    const desativada = admin();
    desativada.desativar(AGORA);
    expect(podeConcluirSegundoFator(desativada)).toBe(false);

    const semSenha = Conta.reconstituir({ ...conta.dados, senhaHash: null });
    expect(podeConcluirSegundoFator(semSenha)).toBe(false);
  });
});

describe('abrirSessaoComSegundoFator (S1)', () => {
  const abrir = (cena: ReturnType<typeof cenario>, conta: Conta) =>
    cena.identidade.unidade.executar(() =>
      abrirSessaoComSegundoFator(
        {
          contas: cena.identidade.contas,
          sessoes: cena.identidade.sessoes,
          cifrador: cena.cifrador,
          gerador: cena.gerador,
          emissor: cena.emissor,
        },
        conta,
        AGORA,
      ),
    );

  it('sessão do painel com mfa, admin no token e só o HMAC do token de renovação guardado', async () => {
    const cena = cenario();
    const { identidade, cifrador, emissor } = cena;
    const conta = admin();
    await identidade.contas.inserir(conta);
    const sessao = await abrir(cena, conta);
    if (sessao === null) throw new Error('deveria abrir a sessão');

    const [guardada] = identidade.sessoes.todas();
    expect(guardada).toMatchObject({
      contaId: CONTA,
      cliente: 'painel',
      mfa: true,
      revogadaEm: null,
      tokenHash: cifrador.hmac('token_renovacao', [sessao.tokenRenovacao]),
    });
    expect(guardada?.familiaId).toBe(guardada?.id);
    expect(JSON.stringify(identidade.sessoes.todas())).not.toContain(sessao.tokenRenovacao);
    expect(identidade.contas.dadosDe(CONTA)?.ultimoLoginEm).toEqual(AGORA);

    const reivindicacoes = await emissor.verificar(sessao.tokenAcesso, AGORA);
    expect(reivindicacoes).toMatchObject({ contaId: CONTA, sid: guardada?.id, mfa: true });
    expect(reivindicacoes?.perfis).toContain('admin');
    expect(sessao.emailVerificado).toBe(false);
    expect(sessao.expiraEm).toEqual(new Date(AGORA.getTime() + 15 * 60 * 1000));
  });

  it('conta desativada (gravada) depois da leitura: null, sem sessão nem login gravado', async () => {
    const cena = cenario();
    const conta = admin();
    await cena.identidade.contas.inserir(conta);
    const desativada = admin();
    desativada.desativar(AGORA);
    await cena.identidade.contas.atualizar(desativada);

    // `conta` é a leitura de antes da exclusão: ainda ativa em memória.
    await expect(abrir(cena, conta)).resolves.toBeNull();
    expect(cena.identidade.sessoes.todas()).toEqual([]);
    expect(cena.identidade.contas.dadosDe(CONTA)?.ultimoLoginEm).toBeNull();
  });
});
