// Módulo Nest da Identidade (plano 01b, etapa 16): liga as portas da aplicação
// e do domínio aos adaptadores (repositórios Prisma, cripto, modelos de
// e-mail), registra os casos de uso, os controllers, os assinantes de eventos,
// o anonimizador e as tarefas diárias, e fornece ao núcleo o
// `VerificadorDeAcesso` usado pela guarda global `Autenticado`.
//
// O mesmo módulo sobe na API, no worker e nas CLIs (`seed:admin`,
// `reconfigurar-segundo-fator`), sempre pelo `AppModule`. Os assinantes e o
// anonimizador entram nos registros do núcleo no `onModuleInit`; quem consome
// as filas e agenda as tarefas é só o worker (`worker.module.ts`).
import { Module, type OnModuleInit } from '@nestjs/common';
import { VerificadorDeAcesso } from '../../compartilhado/autenticacao/verificador-de-acesso.ts';
import { RegistroDeAssinantes } from '../../compartilhado/eventos/assinantes.ts';
import type { TarefaAgendada } from '../../compartilhado/eventos/tarefa-agendada.ts';
import { RegistroDeAnonimizadores } from '../../compartilhado/titular/anonimizador-de-titular.ts';
import { AvisarCadastroRepetidoAssinante } from './aplicacao/assinantes/avisar-cadastro-repetido.assinante.ts';
import { AvisarSegundoFatorFreadoAssinante } from './aplicacao/assinantes/avisar-segundo-fator-freado.assinante.ts';
import { EnviarCodigoDeRecuperacaoAssinante } from './aplicacao/assinantes/enviar-codigo-de-recuperacao.assinante.ts';
import { EnviarCodigoDeVerificacaoAssinante } from './aplicacao/assinantes/enviar-codigo-de-verificacao.assinante.ts';
import { GerarExportacaoAssinante } from './aplicacao/assinantes/gerar-exportacao.assinante.ts';
import { ModelosDeEmailDaIdentidade } from './aplicacao/assinantes/modelos-de-email.ts';
import { CriarAdminCasoDeUso } from './aplicacao/cadastro/criar-admin.caso-de-uso.ts';
import { CriarContaCasoDeUso } from './aplicacao/cadastro/criar-conta.caso-de-uso.ts';
import { ReenviarVerificacaoCasoDeUso } from './aplicacao/cadastro/reenviar-verificacao.caso-de-uso.ts';
import { VerificarEmailCasoDeUso } from './aplicacao/cadastro/verificar-email.caso-de-uso.ts';
import { Cifrador } from './aplicacao/portas/cifrador.ts';
import { EmissorDeJwt } from './aplicacao/portas/emissor-de-jwt.ts';
import { GeradorDeSegredos } from './aplicacao/portas/gerador-de-segredos.ts';
import { Hasher } from './aplicacao/portas/hasher.ts';
import {
  RegistroDePendencias,
  VerificadorDePendencias,
} from './aplicacao/portas/verificador-de-pendencias.ts';
import { VerificadorTotp } from './aplicacao/portas/verificador-totp.ts';
import { AnonimizadorDeIdentidade } from './aplicacao/privacidade/anonimizador-identidade.ts';
import { AnonimizarContaCasoDeUso } from './aplicacao/privacidade/anonimizar-conta.ts';
import { BaixarExportacaoCasoDeUso } from './aplicacao/privacidade/baixar-exportacao.ts';
import { ConsultarPrivacidadeCasoDeUso } from './aplicacao/privacidade/consultar-privacidade.ts';
import { GerarExportacaoCasoDeUso } from './aplicacao/privacidade/gerar-exportacao.ts';
import { SolicitarExclusaoCasoDeUso } from './aplicacao/privacidade/solicitar-exclusao.ts';
import { SolicitarExportacaoCasoDeUso } from './aplicacao/privacidade/solicitar-exportacao.ts';
import { ConfirmarConfiguracaoDoSegundoFatorCasoDeUso } from './aplicacao/segundo-fator/confirmar-configuracao.caso-de-uso.ts';
import { IniciarConfiguracaoDoSegundoFatorCasoDeUso } from './aplicacao/segundo-fator/iniciar-configuracao.caso-de-uso.ts';
import { ReconfigurarSegundoFatorCasoDeUso } from './aplicacao/segundo-fator/reconfigurar-segundo-fator.caso-de-uso.ts';
import { VerificarSegundoFatorCasoDeUso } from './aplicacao/segundo-fator/verificar-segundo-fator.caso-de-uso.ts';
import { EncerrarSessaoCasoDeUso } from './aplicacao/sessao/encerrar-sessao.caso-de-uso.ts';
import { EntrarCasoDeUso } from './aplicacao/sessao/entrar.caso-de-uso.ts';
import { RedefinirSenhaCasoDeUso } from './aplicacao/sessao/redefinir-senha.caso-de-uso.ts';
import { RenovarSessaoCasoDeUso } from './aplicacao/sessao/renovar-sessao.caso-de-uso.ts';
import { SolicitarRecuperacaoCasoDeUso } from './aplicacao/sessao/solicitar-recuperacao.caso-de-uso.ts';
import { AnonimizarContasTarefa } from './aplicacao/tarefas/anonimizar-contas.tarefa.ts';
import { ApagarContasNaoVerificadasTarefa } from './aplicacao/tarefas/apagar-nao-verificadas.tarefa.ts';
import { ReterDadosDaIdentidadeTarefa } from './aplicacao/tarefas/reter-dados.tarefa.ts';
import {
  RepositorioDeBloqueios,
  RepositorioDeCodigosDeVerificacao,
  RepositorioDeContas,
  RepositorioDeDesafios,
  RepositorioDeDocumentosLegais,
  RepositorioDeExportacoes,
  RepositorioDeSegundoFator,
  RepositorioDeSessoes,
  RepositorioDeSolicitacoes,
} from './dominio/repositorios.ts';
import { ContasController } from './http/contas.controller.ts';
import { SegundoFatorController } from './http/segundo-fator.controller.ts';
import { SenhaController } from './http/senha.controller.ts';
import { SessoesController } from './http/sessoes.controller.ts';
import { Argon2Hasher } from './infra/cripto/argon2.hasher.ts';
import { CifradorAesGcm } from './infra/cripto/cifrador-aes-gcm.ts';
import { EmissorJwt } from './infra/cripto/emissor-jwt.ts';
import { GeradorDeSegredosCripto } from './infra/cripto/gerador-de-segredos.ts';
import { VerificadorTotpOtpauth } from './infra/cripto/verificador-totp.ts';
import { ModelosDeEmailDaIdentidadeEmHtml } from './infra/email/modelos/modelos-de-email-da-identidade.ts';
import { RepositorioDeBloqueiosPrisma } from './infra/prisma/bloqueios.repositorio.ts';
import {
  RepositorioDeCodigosDeVerificacaoPrisma,
  RepositorioDeDesafiosPrisma,
} from './infra/prisma/codigos.repositorio.ts';
import { RepositorioDeContasPrisma } from './infra/prisma/contas.repositorio.ts';
import { RepositorioDeDocumentosLegaisPrisma } from './infra/prisma/documentos-legais.repositorio.ts';
import { RepositorioDeExportacoesPrisma } from './infra/prisma/exportacoes.repositorio.ts';
import { RepositorioDeSegundoFatorPrisma } from './infra/prisma/segundo-fator.repositorio.ts';
import { RepositorioDeSessoesPrisma } from './infra/prisma/sessoes.repositorio.ts';
import { RepositorioDeSolicitacoesPrisma } from './infra/prisma/solicitacoes.repositorio.ts';
import { VerificadorDeAcessoDaIdentidade } from './infra/verificador-de-acesso.ts';

const FUSO_HORARIO = 'America/Sao_Paulo';

/**
 * As três tarefas diárias da Identidade (etapa 13), de madrugada, depois da
 * limpeza do núcleo (3h15) e uma de cada vez: anonimização das exclusões
 * pendentes (CA-11), expurgo das contas não verificadas há 7 dias (P1-dono) e
 * retenção de freios, sessões, códigos e exportações (S81).
 */
export const TAREFAS_DIARIAS_DA_IDENTIDADE: readonly TarefaAgendada[] = [
  {
    fila: 'identidade.anonimizar-contas',
    agenda: { cron: '30 3 * * *', fusoHorario: FUSO_HORARIO },
    tarefa: AnonimizarContasTarefa,
  },
  {
    fila: 'identidade.apagar-nao-verificadas',
    agenda: { cron: '45 3 * * *', fusoHorario: FUSO_HORARIO },
    tarefa: ApagarContasNaoVerificadasTarefa,
  },
  {
    fila: 'identidade.reter-dados',
    agenda: { cron: '0 4 * * *', fusoHorario: FUSO_HORARIO },
    tarefa: ReterDadosDaIdentidadeTarefa,
  },
];

const ASSINANTES = [
  EnviarCodigoDeVerificacaoAssinante,
  AvisarCadastroRepetidoAssinante,
  EnviarCodigoDeRecuperacaoAssinante,
  GerarExportacaoAssinante,
  AvisarSegundoFatorFreadoAssinante,
] as const;

@Module({
  controllers: [ContasController, SessoesController, SenhaController, SegundoFatorController],
  providers: [
    // Repositórios (etapa 7)
    { provide: RepositorioDeContas, useClass: RepositorioDeContasPrisma },
    { provide: RepositorioDeSessoes, useClass: RepositorioDeSessoesPrisma },
    {
      provide: RepositorioDeCodigosDeVerificacao,
      useClass: RepositorioDeCodigosDeVerificacaoPrisma,
    },
    { provide: RepositorioDeDesafios, useClass: RepositorioDeDesafiosPrisma },
    { provide: RepositorioDeBloqueios, useClass: RepositorioDeBloqueiosPrisma },
    { provide: RepositorioDeDocumentosLegais, useClass: RepositorioDeDocumentosLegaisPrisma },
    { provide: RepositorioDeSegundoFator, useClass: RepositorioDeSegundoFatorPrisma },
    { provide: RepositorioDeSolicitacoes, useClass: RepositorioDeSolicitacoesPrisma },
    { provide: RepositorioDeExportacoes, useClass: RepositorioDeExportacoesPrisma },
    // Cripto (etapa 6)
    { provide: Hasher, useClass: Argon2Hasher },
    { provide: Cifrador, useClass: CifradorAesGcm },
    { provide: EmissorDeJwt, useClass: EmissorJwt },
    { provide: GeradorDeSegredos, useClass: GeradorDeSegredosCripto },
    { provide: VerificadorTotp, useClass: VerificadorTotpOtpauth },
    // Pendências da exclusão: registro vazio até outro módulo registrar uma fonte.
    { provide: RegistroDePendencias, useFactory: () => new RegistroDePendencias() },
    { provide: VerificadorDePendencias, useExisting: RegistroDePendencias },
    // E-mails (etapa 13)
    { provide: ModelosDeEmailDaIdentidade, useClass: ModelosDeEmailDaIdentidadeEmHtml },
    // Casos de uso (etapas 8 a 11 e 13)
    CriarContaCasoDeUso,
    VerificarEmailCasoDeUso,
    ReenviarVerificacaoCasoDeUso,
    EntrarCasoDeUso,
    RenovarSessaoCasoDeUso,
    EncerrarSessaoCasoDeUso,
    SolicitarRecuperacaoCasoDeUso,
    RedefinirSenhaCasoDeUso,
    IniciarConfiguracaoDoSegundoFatorCasoDeUso,
    ConfirmarConfiguracaoDoSegundoFatorCasoDeUso,
    VerificarSegundoFatorCasoDeUso,
    ReconfigurarSegundoFatorCasoDeUso,
    CriarAdminCasoDeUso,
    SolicitarExclusaoCasoDeUso,
    AnonimizarContaCasoDeUso,
    ConsultarPrivacidadeCasoDeUso,
    SolicitarExportacaoCasoDeUso,
    GerarExportacaoCasoDeUso,
    BaixarExportacaoCasoDeUso,
    // Anonimizador, assinantes e tarefas (etapas 11 e 13)
    AnonimizadorDeIdentidade,
    ...ASSINANTES,
    ...TAREFAS_DIARIAS_DA_IDENTIDADE.map(({ tarefa }) => tarefa),
    // Porta do núcleo para a guarda global (S7, S8)
    { provide: VerificadorDeAcesso, useClass: VerificadorDeAcessoDaIdentidade },
  ],
  exports: [
    VerificadorDeAcesso,
    RegistroDePendencias,
    ...TAREFAS_DIARIAS_DA_IDENTIDADE.map(({ tarefa }) => tarefa),
  ],
})
export class IdentidadeModule implements OnModuleInit {
  constructor(
    private readonly registroDeAssinantes: RegistroDeAssinantes,
    private readonly registroDeAnonimizadores: RegistroDeAnonimizadores,
    private readonly anonimizador: AnonimizadorDeIdentidade,
    private readonly enviarCodigoDeVerificacao: EnviarCodigoDeVerificacaoAssinante,
    private readonly avisarCadastroRepetido: AvisarCadastroRepetidoAssinante,
    private readonly enviarCodigoDeRecuperacao: EnviarCodigoDeRecuperacaoAssinante,
    private readonly gerarExportacao: GerarExportacaoAssinante,
    private readonly avisarSegundoFatorFreado: AvisarSegundoFatorFreadoAssinante,
  ) {}

  onModuleInit(): void {
    for (const assinante of [
      this.enviarCodigoDeVerificacao,
      this.avisarCadastroRepetido,
      this.enviarCodigoDeRecuperacao,
      this.gerarExportacao,
      this.avisarSegundoFatorFreado,
    ]) {
      this.registroDeAssinantes.registrar(assinante);
    }
    this.registroDeAnonimizadores.registrar(this.anonimizador);
  }
}
