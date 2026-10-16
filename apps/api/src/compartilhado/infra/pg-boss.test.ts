// Ambiente do processo filho da CLI do pg-boss (S30). A migração de verdade
// roda no `globalSetup` dos testes de integração (preparar-banco.ts).
import { describe, expect, it } from 'vitest';
import { ambienteDaCliDoPgBoss, SCHEMA_DO_PG_BOSS } from './pg-boss.ts';

const URL_FICTICIA = 'postgresql://migracao:ficticia@127.0.0.1:5433/bairrin_teste';

describe('ambienteDaCliDoPgBoss', () => {
  it('leva só PATH, NODE_ENV e as variáveis do pg-boss, nada dos segredos da aplicação', () => {
    const ambiente = ambienteDaCliDoPgBoss(URL_FICTICIA, {
      PATH: '/usr/bin',
      NODE_ENV: 'production',
      JWT_SEGREDO: 'segredo-que-nao-pode-ir',
      CHAVE_CIFRAGEM_DADOS: 'chave-que-nao-pode-ir',
      DATABASE_URL: 'postgresql://app:senha@db/bairrin',
      PGPASSWORD: 'senha-do-libpq',
      PGBOSS_HOST: 'outro-host',
    });
    expect(ambiente).toEqual({
      PATH: '/usr/bin',
      NODE_ENV: 'production',
      PGBOSS_DATABASE_URL: URL_FICTICIA,
      PGBOSS_SCHEMA: SCHEMA_DO_PG_BOSS,
    });
  });

  it('sem PATH nem NODE_ENV no processo, leva só as do pg-boss', () => {
    expect(ambienteDaCliDoPgBoss(URL_FICTICIA, {})).toEqual({
      PGBOSS_DATABASE_URL: URL_FICTICIA,
      PGBOSS_SCHEMA: SCHEMA_DO_PG_BOSS,
    });
  });
});
