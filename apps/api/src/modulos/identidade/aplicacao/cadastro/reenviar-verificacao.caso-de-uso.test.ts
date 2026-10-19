// Reenvio do código de verificação para a conta da sessão (CA-01; P1-dono; plano 01b,
// etapa 8): só conta ativa e não verificada gera `VerificacaoReenviada`; o resto
// resolve igual, sem evento. O código nasce no assinante, não aqui.
import { describe, expect, it } from 'vitest';
import {
  criarIdentidadeEmMemoria,
  type IdentidadeEmMemoria,
} from '../../../../../test/fakes/identidade/repositorios-em-memoria.ts';
import { Conta } from '../../dominio/conta.ts';
import { Email } from '../../dominio/email.ts';
import { Telefone } from '../../dominio/telefone.ts';
import { ReenviarVerificacaoCasoDeUso } from './reenviar-verificacao.caso-de-uso.ts';

const AGORA = new Date('2026-10-18T12:00:00.000Z');
const CONTA = 'cccccccc-0000-4000-8000-000000000001';

async function cenario(
  preparar: (conta: Conta) => void = () => undefined,
): Promise<{ identidade: IdentidadeEmMemoria; casoDeUso: ReenviarVerificacaoCasoDeUso }> {
  const identidade = criarIdentidadeEmMemoria();
  const conta = Conta.criar({
    id: CONTA,
    nome: 'Ana Souza',
    email: Email.criar('ana@exemplo.com'),
    telefone: Telefone.criar('+5535999991234'),
    senhaHash: 'hash-da-senha',
    agora: AGORA,
  });
  preparar(conta);
  await identidade.contas.inserir(conta);
  const casoDeUso = new ReenviarVerificacaoCasoDeUso(
    identidade.unidade,
    identidade.publicador,
    identidade.contas,
  );
  return { identidade, casoDeUso };
}

describe('ReenviarVerificacaoCasoDeUso', () => {
  it('conta ativa e não verificada: publica VerificacaoReenviada só com o id', async () => {
    const { identidade, casoDeUso } = await cenario();
    const antes = identidade.contas.dadosDe(CONTA);

    await expect(casoDeUso.executar({ contaId: CONTA })).resolves.toBeUndefined();

    expect(identidade.publicador.publicados).toEqual([
      {
        tipo: 'identidade.VerificacaoReenviada',
        versao: 1,
        agregadoId: CONTA,
        payload: { contaId: CONTA },
      },
    ]);
    expect(identidade.contas.dadosDe(CONTA)).toEqual(antes);
    expect(identidade.codigos.todos()).toEqual([]);
  });

  it('cada pedido gera um evento (o limite por hora é da rota, etapa 16)', async () => {
    const { identidade, casoDeUso } = await cenario();

    await casoDeUso.executar({ contaId: CONTA });
    await casoDeUso.executar({ contaId: CONTA });

    expect(identidade.publicador.tipos).toEqual([
      'identidade.VerificacaoReenviada',
      'identidade.VerificacaoReenviada',
    ]);
  });

  it.each<[string, (conta: Conta) => void]>([
    ['já verificada', (conta) => conta.verificarEmail(AGORA)],
    ['desativada', (conta) => conta.desativar(AGORA)],
  ])('conta %s: resolve igual, sem evento', async (_caso, preparar) => {
    const { identidade, casoDeUso } = await cenario(preparar);

    await expect(casoDeUso.executar({ contaId: CONTA })).resolves.toBeUndefined();

    expect(identidade.publicador.publicados).toEqual([]);
  });

  it('conta que não existe mais (expurgo com o token ainda válido): resolve igual, sem evento', async () => {
    const { identidade, casoDeUso } = await cenario();

    await expect(
      casoDeUso.executar({ contaId: 'cccccccc-0000-4000-8000-0000000000ff' }),
    ).resolves.toBeUndefined();

    expect(identidade.publicador.publicados).toEqual([]);
  });

  it('o evento não leva nome, e-mail nem telefone (CA-12)', async () => {
    const { identidade, casoDeUso } = await cenario();

    await casoDeUso.executar({ contaId: CONTA });

    const texto = JSON.stringify(identidade.publicador.publicados);
    for (const valor of ['Ana', 'ana@exemplo.com', '99999']) expect(texto).not.toContain(valor);
  });
});
