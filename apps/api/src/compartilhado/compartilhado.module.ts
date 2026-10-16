// Núcleo compartilhado por todos os módulos (API e worker): banco, unidade de
// trabalho, relógio, publicação de eventos, auditoria, e-mail e os registros
// de assinantes e de anonimizadores. Global: os módulos de contexto injetam
// as portas sem importar este módulo.
//
// Depende do `AMBIENTE` e do logger, que vêm do `AppModule` (também global).
import { Global, Module } from '@nestjs/common';
import { RepositorioDeAuditoria } from './auditoria/repositorio-de-auditoria.ts';
import { EnviadorDeEmail } from './email/enviador-de-email.ts';
import { EntregadorDeEventos, RegistroDeAssinantes } from './eventos/assinantes.ts';
import { PublicadorDeEventos } from './eventos/publicador.ts';
import { PrismaService } from './infra/prisma.service.ts';
import { PublicadorDeEventosNaOutbox } from './infra/publicador-na-outbox.ts';
import { RepositorioDeAuditoriaPrisma } from './infra/repositorio-de-auditoria-prisma.ts';
import { EnviadorDeEmailSmtp } from './infra/smtp.adaptador.ts';
import { UnidadeDeTrabalhoPrisma } from './infra/unidade-de-trabalho-prisma.ts';
import { Relogio, RelogioDoSistema } from './tempo/relogio.ts';
import { UnidadeDeTrabalho } from './transacao/unidade-de-trabalho.ts';
import { RegistroDeAnonimizadores } from './titular/anonimizador-de-titular.ts';

@Global()
@Module({
  providers: [
    PrismaService,
    { provide: Relogio, useClass: RelogioDoSistema },
    UnidadeDeTrabalhoPrisma,
    { provide: UnidadeDeTrabalho, useExisting: UnidadeDeTrabalhoPrisma },
    { provide: PublicadorDeEventos, useClass: PublicadorDeEventosNaOutbox },
    { provide: RepositorioDeAuditoria, useClass: RepositorioDeAuditoriaPrisma },
    { provide: EnviadorDeEmail, useClass: EnviadorDeEmailSmtp },
    RegistroDeAssinantes,
    EntregadorDeEventos,
    RegistroDeAnonimizadores,
  ],
  exports: [
    PrismaService,
    Relogio,
    UnidadeDeTrabalhoPrisma,
    UnidadeDeTrabalho,
    PublicadorDeEventos,
    RepositorioDeAuditoria,
    EnviadorDeEmail,
    RegistroDeAssinantes,
    EntregadorDeEventos,
    RegistroDeAnonimizadores,
  ],
})
export class CompartilhadoModule {}
