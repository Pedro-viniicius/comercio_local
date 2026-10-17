// Eventos de domínio da Identidade, versão 1 (01b, ADR-011). O `tipo` segue
// `<contexto>.<FatoNoPassado>` e o `agregadoId` do evento é o id da conta.
//
// Payload só com ids (ADR-015): nunca e-mail, telefone, nome, senha, token ou
// código. Quem precisa do e-mail o lê pelo id no assinante, e o código de uso
// único é gerado pelo assinante no envio. Os esquemas são estritos: um campo a
// mais no payload é recusado, e não carregado para a outbox. Mudança
// incompatível no payload vira uma versão nova, sem alterar a 1.
import { objetoEstrito, z } from '../zod.ts';

const contaId = z.uuid();

function definirEvento<Nome extends string, Forma extends z.core.$ZodShape>(
  nome: Nome,
  forma: Forma,
) {
  return {
    tipo: `identidade.${nome}` as const,
    versao: 1,
    payload: objetoEstrito(forma),
  } as const;
}

export const EVENTOS_DE_IDENTIDADE = {
  /** Conta nova: o assinante envia o código de verificação (CA-01). */
  ContaCriada: definirEvento('ContaCriada', { contaId }),
  /** Cadastro com e-mail de conta existente: aviso ao dono, 1/h por e-mail (CA-02, S15). */
  CadastroRepetidoTentado: definirEvento('CadastroRepetidoTentado', { contaId }),
  /** Reenvio do código de verificação, pedido pela conta da sessão (P1-dono). */
  VerificacaoReenviada: definirEvento('VerificacaoReenviada', { contaId }),
  /** Recuperação de senha de uma conta existente (CA-06); e-mail sem conta não gera evento. */
  RecuperacaoSolicitada: definirEvento('RecuperacaoSolicitada', { contaId }),
  /** Senha redefinida: sessões já revogadas na mesma transação (CA-05). */
  SenhaRedefinida: definirEvento('SenhaRedefinida', { contaId }),
  /** Pedido de cópia dos dados (CA-10, S10). */
  ExportacaoSolicitada: definirEvento('ExportacaoSolicitada', {
    contaId,
    solicitacaoId: z.uuid(),
  }),
  /** Exclusão confirmada: conta desativada, anonimização em até 30 dias (CA-11). */
  ContaDesativada: definirEvento('ContaDesativada', { contaId }),
  /** Dados pessoais da conta anonimizados (CA-11). */
  ContaAnonimizada: definirEvento('ContaAnonimizada', { contaId }),
};

export type NomeDoEventoDeIdentidade = keyof typeof EVENTOS_DE_IDENTIDADE;

/** Payload de um evento de Identidade, como o publicador grava e o assinante lê. */
export type PayloadDoEventoDeIdentidade<Nome extends NomeDoEventoDeIdentidade> = z.infer<
  (typeof EVENTOS_DE_IDENTIDADE)[Nome]['payload']
>;
