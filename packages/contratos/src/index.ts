// Contratos HTTP compartilhados por API, apps e painel (ADR-010).
export { objetoEstrito, z } from './zod.ts';
export * from './problema.ts';
export * from './paginacao.ts';
export * from './saude.ts';
// Validadores puros: também em `@bairrin/contratos/validadores`, o subcaminho
// que o domínio da API pode importar.
export * from './validadores/index.ts';
export * from './identidade/contas.ts';
export * from './identidade/sessoes.ts';
export * from './identidade/senha.ts';
export * from './identidade/segundo-fator.ts';
export * from './identidade/privacidade.ts';
export * from './identidade/eventos.ts';
