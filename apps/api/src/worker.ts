// Ponto de entrada do worker (processo `worker` no Fly): relay da outbox,
// assinantes de eventos e tarefas agendadas, sem HTTP. Valida o ambiente como
// a API: se faltar variável, não sobe (a mensagem cita só nomes, nunca valores);
// em produção, também exige TLS verificado com o banco e nenhum papel de
// migração no ambiente. Com `SENTRY_DSN`, o Sentry recebe as falhas que
// derrubam o processo (exceção não tratada, promessa rejeitada).
// Pressupõe o pg-boss já migrado pelo papel de migração
// (`dist/cli/migrar-pg-boss.js`, depois do `prisma migrate deploy`).
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { carregarAmbiente, verificarAmbienteDeProducao } from './compartilhado/config/ambiente.ts';
import { iniciarSentry } from './compartilhado/observabilidade/sentry.ts';
import { WorkerModule } from './worker.module.ts';

async function iniciar(): Promise<void> {
  const ambiente = carregarAmbiente(process.env);
  verificarAmbienteDeProducao(ambiente, process.env);
  iniciarSentry(ambiente);
  const app = await NestFactory.createApplicationContext(WorkerModule.registrar({ ambiente }), {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  // SIGTERM do Fly: para o relay e espera os jobs em andamento.
  app.enableShutdownHooks();
}

await iniciar();
