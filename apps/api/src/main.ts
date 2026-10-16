// Ponto de entrada HTTP da API. Valida o ambiente antes de qualquer coisa: se
// faltar variável, a API não sobe (a mensagem cita só nomes, nunca valores).
// Em produção, também não sobe sem TLS verificado com o banco nem com o papel
// de migração no ambiente. O Sentry liga só com `SENTRY_DSN`.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.ts';
import { carregarAmbiente, verificarAmbienteDeProducao } from './compartilhado/config/ambiente.ts';
import {
  configurarAplicacao,
  OPCOES_DA_APLICACAO,
} from './compartilhado/http/configurar-aplicacao.ts';
import { iniciarSentry, InterceptadorDoSentry } from './compartilhado/observabilidade/sentry.ts';

async function iniciar(): Promise<void> {
  const ambiente = carregarAmbiente(process.env);
  verificarAmbienteDeProducao(ambiente, process.env);
  const sentryLigado = iniciarSentry(ambiente);
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.registrar({ ambiente }),
    OPCOES_DA_APLICACAO,
  );
  configurarAplicacao(app, ambiente);
  if (sentryLigado) app.useGlobalInterceptors(new InterceptadorDoSentry());
  await app.listen(ambiente.PORTA);
}

await iniciar();
