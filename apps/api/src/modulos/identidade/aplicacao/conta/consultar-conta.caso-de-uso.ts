// Dados da conta da sessão (`GET /v1/conta` e `GET /v1/admin/conta`; plano
// 01b, etapa 19; spec A5): o nome, o e-mail mascarado e os perfis, na forma do
// contrato `contaSchema`. Nunca o e-mail inteiro nem o telefone.
//
// Os perfis são os que a conta tem agora (um perfil concedido depois do login,
// como `lojista` ao criar a loja, já aparece), menos `admin` quando a sessão não
// o traz: `admin` só existe em sessão do painel com segundo fator (S1), e a
// conta admin que entra por um app não aparece como admin nele (CA-07).
//
// Só leitura. A guarda já conferiu que a conta está ativa; se ela deixou de
// estar no meio (exclusão concorrente), o resultado é `conta_indisponivel`, a
// mesma exceção ao "401 só da guarda" registrada na etapa 16.
import type { Conta as ContaDoContrato } from '@bairrin/contratos';
import { Injectable } from '@nestjs/common';
import { RepositorioDeContas } from '../../dominio/repositorios.ts';

export interface EntradaDaConsultaDeConta {
  /** Conta da sessão. */
  contaId: string;
  /** A sessão traz `admin` (painel com segundo fator). */
  sessaoComAdmin: boolean;
}

export type ResultadoDaConsultaDeConta =
  { tipo: 'conta'; conta: ContaDoContrato } | { tipo: 'conta_indisponivel' };

@Injectable()
export class ConsultarContaCasoDeUso {
  constructor(private readonly contas: RepositorioDeContas) {}

  async executar({
    contaId,
    sessaoComAdmin,
  }: EntradaDaConsultaDeConta): Promise<ResultadoDaConsultaDeConta> {
    const conta = await this.contas.buscarPorId(contaId);
    if (conta === null || conta.status !== 'ativa') return { tipo: 'conta_indisponivel' };
    return {
      tipo: 'conta',
      conta: {
        nome: conta.nome,
        emailMascarado: conta.email.mascarado,
        perfis: conta.perfis.filter((perfil) => perfil !== 'admin' || sessaoComAdmin),
      },
    };
  }
}
