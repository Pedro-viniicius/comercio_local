// Início da configuração do 2FA (01b, etapa 10; S1, CA-09): só com desafio
// `configurar` válido e conta sem segundo fator confirmado; devolve só a URI e
// o segredo, com rótulo sem o e-mail inteiro; guarda o segredo cifrado.
import { describe, expect, it, vi } from 'vitest';
import { RelogioFixo } from '../../../../compartilhado/tempo/relogio.ts';
import {
  CifradorFalso,
  GeradorDeSegredosFalso,
  VerificadorTotpFalso,
} from '../../../../../test/fakes/identidade/servicos-falsos.ts';
import { criarIdentidadeEmMemoria } from '../../../../../test/fakes/identidade/repositorios-em-memoria.ts';
import { BloqueioDeLogin } from '../../dominio/bloqueio-de-login.ts';
import { Conta } from '../../dominio/conta.ts';
import {
  TENTATIVAS_POR_DESAFIO,
  VALIDADE_DO_DESAFIO_EM_MS,
} from '../../dominio/desafio-de-segundo-fator.ts';
import { Email } from '../../dominio/email.ts';
import { Telefone } from '../../dominio/telefone.ts';
import { chaveDoFreioDeSegundoFator, emitirDesafioDeSegundoFator } from './comum.ts';
import { IniciarConfiguracaoDoSegundoFatorCasoDeUso } from './iniciar-configuracao.caso-de-uso.ts';

const AGORA = new Date('2026-10-18T12:00:00.000Z');
const CONTA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EMAIL = 'ana.admin@exemplo.com';

async function cenario(opcoes: { admin?: boolean } = {}) {
  const identidade = criarIdentidadeEmMemoria();
  const relogio = new RelogioFixo(AGORA);
  const cifrador = new CifradorFalso();
  const gerador = new GeradorDeSegredosFalso();
  const totp = new VerificadorTotpFalso();
  const conta = Conta.criar({
    id: CONTA,
    nome: 'Ana Admin',
    email: Email.criar(EMAIL),
    telefone: Telefone.criar('35999991234'),
    senhaHash: 'hash-falso:senha',
    agora: AGORA,
  });
  if (opcoes.admin ?? true) conta.concederAdmin(AGORA);
  await identidade.contas.inserir(conta);

  const casoDeUso = new IniciarConfiguracaoDoSegundoFatorCasoDeUso(
    identidade.unidade,
    relogio,
    identidade.contas,
    identidade.desafios,
    identidade.bloqueios,
    identidade.segundoFator,
    cifrador,
    totp,
  );
  const emitir = async () =>
    (
      await identidade.unidade.executar(() =>
        emitirDesafioDeSegundoFator(
          {
            desafios: identidade.desafios,
            segundoFator: identidade.segundoFator,
            cifrador,
            gerador,
          },
          CONTA,
          relogio.agora(),
        ),
      )
    ).desafio;
  return { identidade, relogio, cifrador, totp, casoDeUso, emitir };
}

describe('IniciarConfiguracaoDoSegundoFatorCasoDeUso', () => {
  it('devolve só a URI e o segredo, com rótulo Bairrin:<emailMascarado> e sem o e-mail inteiro', async () => {
    const { casoDeUso, emitir, totp } = await cenario();
    const resultado = await casoDeUso.executar({ desafio: await emitir() });

    expect(resultado).toEqual({
      tipo: 'configuracao',
      otpauthUri: expect.stringContaining('otpauth://totp/') as unknown,
      segredoBase32: totp.segredoBase32,
    });
    expect(Object.keys(resultado).sort()).toEqual(['otpauthUri', 'segredoBase32', 'tipo']);
    expect(totp.rotulos).toEqual(['an***@exemplo.com']);
    const uri = resultado.tipo === 'configuracao' ? decodeURIComponent(resultado.otpauthUri) : '';
    expect(uri).toContain('Bairrin:an***@exemplo.com');
    expect(uri).not.toContain(EMAIL);
  });

  it('guarda o segredo cifrado com a conta, ainda não confirmado', async () => {
    const { identidade, casoDeUso, emitir, cifrador, totp } = await cenario();
    await casoDeUso.executar({ desafio: await emitir() });

    const guardado = await identidade.segundoFator.buscar(CONTA);
    expect(guardado).toMatchObject({ contaId: CONTA, confirmadoEm: null, ultimoPassoUsado: null });
    expect(guardado?.segredoCifrado).not.toContain(totp.segredoBase32);
    expect(cifrador.decifrar('segredo_totp', guardado?.segredoCifrado ?? '', CONTA)).toBe(
      totp.segredoBase32,
    );
  });

  it('não gasta o desafio nem tentativa: a confirmação usa o mesmo, e chamar de novo troca o segredo', async () => {
    const { identidade, casoDeUso, emitir, totp } = await cenario();
    const desafio = await emitir();
    await casoDeUso.executar({ desafio });
    const antes = await identidade.segundoFator.buscar(CONTA);
    totp.segredoBase32 = 'KRSXG5CTMVRXEZLU';

    const resultado = await casoDeUso.executar({ desafio });

    expect(resultado).toMatchObject({ tipo: 'configuracao', segredoBase32: 'KRSXG5CTMVRXEZLU' });
    expect((await identidade.segundoFator.buscar(CONTA))?.segredoCifrado).not.toBe(
      antes?.segredoCifrado,
    );
    expect(identidade.desafios.todos()[0]).toMatchObject({ tentativas: 0, usadoEm: null });
  });

  describe('passo (1) de "Respostas do 2FA": sempre o mesmo desafio_invalido', () => {
    it('token mal formado, id inexistente ou segredo errado', async () => {
      const { casoDeUso, emitir } = await cenario();
      const desafio = await emitir();
      const [id] = desafio.split('.');
      for (const token of [
        'sem-ponto',
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc.segredo',
        `${id ?? ''}.segredo-errado`,
      ]) {
        await expect(casoDeUso.executar({ desafio: token })).resolves.toEqual({
          tipo: 'desafio_invalido',
        });
      }
    });

    it('desafio da etapa verificar (S1: configuracao só aceita configurar)', async () => {
      const { identidade, casoDeUso, emitir } = await cenario();
      await identidade.segundoFator.salvar({
        contaId: CONTA,
        segredoCifrado: 'cifrado-antigo',
        confirmadoEm: AGORA,
        ultimoPassoUsado: null,
      });
      const desafio = await emitir();
      await expect(casoDeUso.executar({ desafio })).resolves.toEqual({ tipo: 'desafio_invalido' });
    });

    it('vencido (5 min), usado ou esgotado', async () => {
      const vencido = await cenario();
      const desafioVencido = await vencido.emitir();
      vencido.relogio.avancar(VALIDADE_DO_DESAFIO_EM_MS);
      await expect(vencido.casoDeUso.executar({ desafio: desafioVencido })).resolves.toEqual({
        tipo: 'desafio_invalido',
      });

      const usado = await cenario();
      const desafioUsado = await usado.emitir();
      await usado.emitir(); // o login seguinte invalida o anterior
      await expect(usado.casoDeUso.executar({ desafio: desafioUsado })).resolves.toEqual({
        tipo: 'desafio_invalido',
      });

      const esgotado = await cenario();
      const desafioEsgotado = await esgotado.emitir();
      const [linha] = esgotado.identidade.desafios.todos();
      await esgotado.identidade.unidade.executar(async () => {
        const desafio = await esgotado.identidade.desafios.buscarPorIdParaAtualizar(
          linha?.id ?? '',
        );
        const freio = BloqueioDeLogin.novo('chave', 'segundo_fator', AGORA);
        for (let i = 0; i < TENTATIVAS_POR_DESAFIO; i += 1) {
          desafio?.avaliarCodigo({
            etapa: 'configurar',
            freio,
            codigoConfere: false,
            agora: AGORA,
          });
        }
        if (desafio) await esgotado.identidade.desafios.atualizar(desafio);
      });
      await expect(esgotado.casoDeUso.executar({ desafio: desafioEsgotado })).resolves.toEqual({
        tipo: 'desafio_invalido',
      });
    });

    it('segundo fator já confirmado depois da emissão (S1): recusa e não troca o segredo', async () => {
      const { identidade, casoDeUso, emitir } = await cenario();
      const desafio = await emitir();
      const confirmado = {
        contaId: CONTA,
        segredoCifrado: 'cifrado-confirmado',
        confirmadoEm: AGORA,
        ultimoPassoUsado: 7,
      };
      await identidade.segundoFator.salvar(confirmado);

      await expect(casoDeUso.executar({ desafio })).resolves.toEqual({ tipo: 'desafio_invalido' });
      expect(await identidade.segundoFator.buscar(CONTA)).toEqual(confirmado);
      expect(identidade.bloqueios.todos()).toEqual([]);
    });

    it('conta que perdeu o admin ou foi desativada entre a senha e a configuração', async () => {
      const semAdmin = await cenario({ admin: false });
      await expect(
        semAdmin.casoDeUso.executar({ desafio: await semAdmin.emitir() }),
      ).resolves.toEqual({ tipo: 'desafio_invalido' });

      const desativada = await cenario();
      const desafio = await desativada.emitir();
      const conta = await desativada.identidade.contas.buscarPorId(CONTA);
      conta?.desativar(AGORA);
      if (conta) await desativada.identidade.contas.atualizar(conta);
      await expect(desativada.casoDeUso.executar({ desafio })).resolves.toEqual({
        tipo: 'desafio_invalido',
      });
      expect(await desativada.identidade.segundoFator.buscar(CONTA)).toBeNull();
    });
  });

  it('o freio ativo não impede a configuração (ela só tem o passo 1) e não muda', async () => {
    const { identidade, casoDeUso, emitir, cifrador } = await cenario();
    const freio = BloqueioDeLogin.reconstituir({
      chaveHmac: chaveDoFreioDeSegundoFator(cifrador, CONTA),
      tipo: 'segundo_fator',
      falhas: 0,
      nivel: 1,
      janelaInicio: AGORA,
      bloqueadoAte: new Date(AGORA.getTime() + 60_000),
    });
    await identidade.bloqueios.salvar(freio);

    await expect(casoDeUso.executar({ desafio: await emitir() })).resolves.toMatchObject({
      tipo: 'configuracao',
    });
    expect(identidade.bloqueios.todos()).toEqual([freio.dados]);
  });

  it('R8: lê o segundo fator só depois de travar o desafio e o freio da conta', async () => {
    const { identidade, casoDeUso, emitir } = await cenario();
    const desafio = await emitir();
    const travaDesafio = vi.spyOn(identidade.desafios, 'buscarPorIdParaAtualizar');
    const travaFreio = vi.spyOn(identidade.bloqueios, 'buscarParaAtualizar');
    const leSegundoFator = vi.spyOn(identidade.segundoFator, 'buscar');

    await casoDeUso.executar({ desafio });

    const [desafioPrimeiro] = travaDesafio.mock.invocationCallOrder;
    const [freioDepois] = travaFreio.mock.invocationCallOrder;
    const [segundoFatorPorUltimo] = leSegundoFator.mock.invocationCallOrder;
    expect(desafioPrimeiro).toBeLessThan(freioDepois ?? 0);
    expect(freioDepois).toBeLessThan(segundoFatorPorUltimo ?? 0);
    expect(travaFreio).toHaveBeenCalledWith(expect.any(String), 'segundo_fator', AGORA);
  });

  it('a trava do freio não deixa linha zerada para trás', async () => {
    const { identidade, casoDeUso, emitir } = await cenario();
    await casoDeUso.executar({ desafio: await emitir() });
    expect(identidade.bloqueios.todos()).toEqual([]);
  });
});
