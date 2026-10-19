// Rotação da sessão contra revogação concorrente (R1, S8, S77): uma renovação que leu a
// sessão antes de a revogação confirmar não pode desfazer a revogação ao gravar a rotação.
// O banco roda em READ COMMITTED: o `UPDATE ... WHERE token_hash = <trocado>` ainda acha a
// linha revogada (a revogação não mexe no token) e, se gravasse a entidade lida antes,
// apagaria `revogada_em`.
import { describe, expect, it } from 'vitest';
import { Conta } from '../../../src/modulos/identidade/dominio/conta.ts';
import { Email } from '../../../src/modulos/identidade/dominio/email.ts';
import { Sessao } from '../../../src/modulos/identidade/dominio/sessao.ts';
import { Telefone } from '../../../src/modulos/identidade/dominio/telefone.ts';
import { criarIdentidadeEmMemoria, type IdentidadeEmMemoria } from './repositorios-em-memoria.ts';

const AGORA = new Date('2026-10-17T12:00:00.000Z');
const depois = (ms: number) => new Date(AGORA.getTime() + ms);
const CONTA = '00000000-0000-4000-8000-000000000001';
const SID = '00000000-0000-4000-8000-000000000002';

async function comSessao(): Promise<IdentidadeEmMemoria> {
  const identidade = criarIdentidadeEmMemoria();
  await identidade.contas.inserir(
    Conta.criar({
      id: CONTA,
      nome: 'Ana',
      email: Email.criar('ana@exemplo.com'),
      telefone: Telefone.criar('35999991234'),
      senhaHash: 'hash',
      agora: AGORA,
    }),
  );
  await identidade.sessoes.inserir(
    Sessao.criar({
      id: SID,
      contaId: CONTA,
      cliente: 'app_consumidor',
      tokenHash: 't1',
      mfa: false,
      agora: AGORA,
    }),
  );
  return identidade;
}

describe('gravarRotacao não desfaz uma revogação confirmada no meio (S8, S77)', () => {
  it.each([
    ['revogarDaFamilia', 'reuso_detectado'],
    ['revogarDaConta', 'senha_redefinida'],
  ] as const)(
    'renovação que leu antes de %s (%s) confirmar não ressuscita a sessão',
    async (operacao, motivo) => {
      const identidade = await comSessao();

      // A renovação lê a sessão (sem trava) e só depois tenta gravar a rotação.
      const lida = await identidade.sessoes.buscarPorTokenHash('t1');
      if (lida === null) throw new Error('sessão não encontrada');
      lida.rotacionar('t2', 'par-t2', depois(1_000));

      // Enquanto isso, a revogação confirma em outra unidade de trabalho.
      await identidade.unidade.executar(async () => {
        if (operacao === 'revogarDaFamilia') {
          await identidade.sessoes.revogarDaFamilia(SID, motivo, depois(500));
        } else {
          await identidade.sessoes.revogarDaConta(CONTA, motivo, depois(500));
        }
      });

      const gravou = await identidade.unidade.executar(() =>
        identidade.sessoes.gravarRotacao(lida),
      );

      // A rotação é recusada (false) ou, no mínimo, a revogação continua de pé.
      const guardada = identidade.sessoes.dadosDe(SID);
      expect(guardada).toMatchObject({ revogadaEm: depois(500), motivoRevogacao: motivo });
      expect(gravou).toBe(false);
      expect(guardada?.tokenHash).toBe('t1');
      expect(identidade.sessoes.tokensUsados()).toEqual([]);
    },
  );
});
