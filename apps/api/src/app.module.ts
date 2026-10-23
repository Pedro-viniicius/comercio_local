// Módulo raiz da API. Dinâmico para receber o ambiente já validado (e, nos
// testes, o destino do log e o limite de requisições).
//
// Guardas globais, nesta ordem (todas antes do pipe de validação, S82):
// 1. `ThrottlerGuard`: teto folgado por IP em toda rota;
// 2. `Autenticado`: token de acesso em toda rota sem `@Publico()`, e admin com
//    segundo fator em `/v1/admin` (S7, S8);
// 3. `LimitePorRotaGuard`: os limites próprios das rotas sensíveis (por IP,
//    por conta ou por e-mail), depois da autenticação porque o limite por
//    conta usa a conta autenticada.
import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import type { DestinationStream } from 'pino';
import { CompartilhadoModule } from './compartilhado/compartilhado.module.ts';
import { AMBIENTE, type Ambiente } from './compartilhado/config/ambiente.ts';
import { Autenticado } from './compartilhado/http/autenticacao/autenticado.guard.ts';
import { FiltroDeErros } from './compartilhado/http/filtro-de-erros.ts';
import { LimitePorRotaGuard } from './compartilhado/http/limite-por-rota.guard.ts';
import { parametrosDoLogger } from './compartilhado/log/logger.ts';
import { SaudeController } from './compartilhado/saude/saude.controller.ts';
import { IdentidadeModule } from './modulos/identidade/index.ts';

export interface LimiteDeRequisicoes {
  /** Requisições aceitas por IP (IPv6 agrupado por /64) dentro da janela. */
  limite: number;
  janelaEmMs: number;
}

/**
 * Limite global por IP. Folgado de propósito: muitos clientes de operadora
 * móvel saem pelo mesmo IP (CGNAT, S14). Rotas sensíveis do 01b têm limites
 * próprios, mais baixos. Armazenamento em memória aceito no MVP (S24).
 */
export const LIMITE_PADRAO: LimiteDeRequisicoes = { limite: 300, janelaEmMs: 60_000 };

export interface OpcoesDoAppModule {
  ambiente: Ambiente;
  /** Só nos testes: captura as linhas do log. */
  destinoDoLog?: DestinationStream;
  limiteDeRequisicoes?: LimiteDeRequisicoes;
}

@Module({})
export class AppModule {
  static registrar(opcoes: OpcoesDoAppModule): DynamicModule {
    const { limite, janelaEmMs } = opcoes.limiteDeRequisicoes ?? LIMITE_PADRAO;
    return {
      module: AppModule,
      global: true,
      imports: [
        LoggerModule.forRoot(parametrosDoLogger(opcoes.ambiente, opcoes.destinoDoLog)),
        ThrottlerModule.forRoot({ throttlers: [{ limit: limite, ttl: janelaEmMs }] }),
        CompartilhadoModule,
        IdentidadeModule,
      ],
      controllers: [SaudeController],
      providers: [
        { provide: AMBIENTE, useValue: opcoes.ambiente },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: Autenticado },
        { provide: APP_GUARD, useClass: LimitePorRotaGuard },
        { provide: APP_FILTER, useClass: FiltroDeErros },
      ],
      exports: [AMBIENTE],
    };
  }
}
