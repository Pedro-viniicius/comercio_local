// Tarefa diária de retenção da Identidade (S81, P12, S10; plano 01b, etapa
// 13). Apaga o que já não serve, cada item num comando só:
// - freios de login parados há mais de 30 min
//   (`greatest(bloqueado_ate, janela_inicio) < agora - 30 min`): a janela de 15
//   min e a calma de 15 min já passaram, então apagar equivale a zerar;
// - sessões revogadas ou vencidas há mais de 30 dias
//   (`coalesce(revogada_em, expira_em) < agora - 30 dias`), com o histórico de
//   tokens usados delas pela FK em cascata (um mês para investigar um reuso);
// - códigos por e-mail e desafios do 2FA usados ou vencidos há mais de 1 dia
//   (`coalesce(usado_em, expira_em) < agora - 1 dia`); o teto de 10 códigos em
//   24 h (S93) nunca perde um código por isso;
// - cópias dos dados vencidas ou já baixadas (S10).
// Os prazos vão para o README do módulo (20a) e para a política de privacidade
// (P4 do plano das lojas); o dono pode encurtá-los sem mudar o desenho.
import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { Relogio } from '../../../../compartilhado/tempo/relogio.ts';
import { UnidadeDeTrabalho } from '../../../../compartilhado/transacao/unidade-de-trabalho.ts';
import {
  RepositorioDeBloqueios,
  RepositorioDeCodigosDeVerificacao,
  RepositorioDeExportacoes,
  RepositorioDeSessoes,
} from '../../dominio/repositorios.ts';

const UM_MINUTO_EM_MS = 60 * 1000;
const UM_DIA_EM_MS = 24 * 60 * UM_MINUTO_EM_MS;

/** Freio parado há mais disto sai (P12). */
export const RETENCAO_DOS_FREIOS_EM_MS = 30 * UM_MINUTO_EM_MS;
/** Sessão revogada ou vencida há mais disto sai, com o histórico de tokens (P12). */
export const RETENCAO_DAS_SESSOES_EM_MS = 30 * UM_DIA_EM_MS;
/** Código ou desafio usado ou vencido há mais disto sai (P12). */
export const RETENCAO_DOS_CODIGOS_EM_MS = UM_DIA_EM_MS;

export interface ResultadoDaRetencao {
  freios: number;
  sessoes: number;
  codigos: number;
  exportacoes: number;
}

@Injectable()
export class ReterDadosDaIdentidadeTarefa {
  constructor(
    private readonly unidade: UnidadeDeTrabalho,
    private readonly relogio: Relogio,
    private readonly bloqueios: RepositorioDeBloqueios,
    private readonly sessoes: RepositorioDeSessoes,
    private readonly codigos: RepositorioDeCodigosDeVerificacao,
    private readonly exportacoes: RepositorioDeExportacoes,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext(ReterDadosDaIdentidadeTarefa.name);
  }

  async executar(): Promise<ResultadoDaRetencao> {
    const agora = this.relogio.agora().getTime();
    // Uma transação curta por item: nenhuma segura as travas de outra tabela.
    const freios = await this.unidade.executar(() =>
      this.bloqueios.apagarParadosAntes(new Date(agora - RETENCAO_DOS_FREIOS_EM_MS)),
    );
    const sessoes = await this.unidade.executar(() =>
      this.sessoes.apagarEncerradasAntes(new Date(agora - RETENCAO_DAS_SESSOES_EM_MS)),
    );
    const codigos = await this.unidade.executar(() =>
      this.codigos.apagarEncerradosAntes(new Date(agora - RETENCAO_DOS_CODIGOS_EM_MS)),
    );
    const exportacoes = await this.unidade.executar(() =>
      this.exportacoes.apagarVencidas(new Date(agora)),
    );
    const resultado = { freios, sessoes, codigos, exportacoes };
    this.logger.info(resultado, 'retenção da identidade concluída');
    return resultado;
  }
}
