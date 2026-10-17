// `@bairrin/contratos/validadores`: regras de entrada em TypeScript puro, sem
// zod nem dependência alguma. É o único caminho de pacote que o domínio da API
// pode importar (ADR-003, `.dependency-cruiser.cjs`). Os esquemas zod de
// `src/identidade` usam estas mesmas funções, então app, painel e API validam
// igual.
export * from './codigo.ts';
export * from './email.ts';
export * from './identidade.ts';
export * from './nome.ts';
export * from './senha.ts';
export { ehSenhaComum, formaComparavelDaSenha } from './senhas-comuns.ts';
export * from './telefone.ts';
