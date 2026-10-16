// Passo de migração do pg-boss (ver `compartilhado/infra/pg-boss.ts`), com o
// papel de migração. No deploy roda logo depois do `prisma migrate deploy`, no
// `release_command`, o único lugar onde `DATABASE_URL_MIGRACAO` existe (S3):
//   node dist/cli/migrar-pg-boss.js
// Depois do pg-boss, confere que os papéis do Supabase não enxergam nenhum
// schema do Bairrin (S26) e que o catálogo segue as regras de dono, CREATE,
// RLS, políticas, triggers da auditoria, regras, GRANT OPTION e views (S33),
// ambos em `compartilhado/infra/schemas-fechados.ts`; se algo falhar, sai com
// erro e o release para.
// Não lê `.env`: a URL vem do ambiente do processo.
import { migrarPgBoss } from '../compartilhado/infra/pg-boss.ts';
import {
  exigirCatalogoNasRegras,
  exigirSchemasFechados,
} from '../compartilhado/infra/schemas-fechados.ts';

const url = process.env['DATABASE_URL_MIGRACAO'];
if (url === undefined || url.trim() === '') {
  console.error('DATABASE_URL_MIGRACAO não definida: o pg-boss não foi migrado.');
  process.exitCode = 1;
} else {
  try {
    console.log(await migrarPgBoss(url));
    console.log('Permissões do pg-boss aplicadas.');
    await exigirSchemasFechados(url);
    console.log('Schemas fechados aos papéis do Supabase.');
    await exigirCatalogoNasRegras(url);
    console.log('Catálogo do banco dentro das regras.');
  } catch (erro) {
    // A mensagem cita a saída da CLI do pg-boss, o erro do `pg` (host, banco
    // e papel; nunca a senha), os pares papel/schema abertos ou os objetos do
    // catálogo fora das regras (nomes de schema, tabela, função e política).
    console.error(erro instanceof Error ? erro.message : 'Falha desconhecida.');
    process.exitCode = 1;
  }
}
