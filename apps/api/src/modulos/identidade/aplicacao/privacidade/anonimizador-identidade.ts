// O `AnonimizadorDeTitular` da Identidade (S5; CA-11), chamado por
// `AnonimizarContaCasoDeUso` pelo `RegistroDeAnonimizadores` (o registro fica no
// `IdentidadeModule`, etapa 16).
//
// Somem nome, e-mail, telefone, hash da senha, segundo fator e códigos de
// recuperação, sessões (com o histórico de tokens), códigos por e-mail e
// desafios, e exportações. Ficam, ligados só ao id: a conta (com o e-mail
// substituto não reversível, as datas e os perfis), os consentimentos e as
// solicitações do titular, que são o registro do pedido. Os CHECKs de
// `identidade.contas` exigem na conta anonimizada `senha_hash` e
// `telefone_e164` nulos, `desativada_em` e `anonimizada_em` preenchidos; quem
// garante é `Conta.anonimizar`.
//
// Idempotente (o contrato do núcleo pede): conta já anonimizada passa de novo
// pela limpeza sem erro, e conta que não existe não tem o que apagar. Conta
// ativa é recusada: só a exclusão confirmada (`desativar`) leva à
// anonimização.
//
// Não abre transação: `AnonimizarContaCasoDeUso` envolve todos os anonimizadores numa
// `UnidadeDeTrabalho`.
import { Injectable } from '@nestjs/common';
import { Relogio } from '../../../../compartilhado/tempo/relogio.ts';
import type { AnonimizadorDeTitular } from '../../../../compartilhado/titular/anonimizador-de-titular.ts';
import {
  RepositorioDeCodigosDeVerificacao,
  RepositorioDeContas,
  RepositorioDeExportacoes,
  RepositorioDeSegundoFator,
  RepositorioDeSessoes,
} from '../../dominio/repositorios.ts';

@Injectable()
export class AnonimizadorDeIdentidade implements AnonimizadorDeTitular {
  readonly modulo = 'identidade';

  constructor(
    private readonly contas: RepositorioDeContas,
    private readonly sessoes: RepositorioDeSessoes,
    private readonly codigos: RepositorioDeCodigosDeVerificacao,
    private readonly segundoFator: RepositorioDeSegundoFator,
    private readonly exportacoes: RepositorioDeExportacoes,
    private readonly relogio: Relogio,
  ) {}

  async anonimizar(contaId: string): Promise<void> {
    const conta = await this.contas.buscarPorId(contaId);
    if (conta === null) return;
    // Lança `OperacaoInvalidaNaConta` para conta ativa, antes de apagar qualquer coisa.
    conta.anonimizar(this.relogio.agora());
    await this.contas.atualizar(conta);
    await this.sessoes.apagarDaConta(contaId);
    await this.codigos.apagarDaConta(contaId);
    await this.segundoFator.apagar(contaId);
    await this.exportacoes.apagarDaConta(contaId);
  }
}
