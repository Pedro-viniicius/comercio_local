// Valores fixos da Identidade (01b) que o domínio da API e os esquemas zod
// compartilham. Sem zod nem dependência alguma (ADR-003).

/** Perfis de uma conta. `admin` nunca é concedido por rota pública (CA-07). */
export const PERFIS = ['consumidor', 'lojista', 'admin'] as const;
export type Perfil = (typeof PERFIS)[number];

/** Onde a sessão foi criada (`sessoes.cliente`). Só `painel` pode receber `admin` (S1). */
export const CLIENTES = ['app_consumidor', 'app_lojista', 'painel'] as const;
export type Cliente = (typeof CLIENTES)[number];

/** Etapas do desafio pós-senha do admin (S1). */
export const ETAPAS_DO_DESAFIO = ['verificar', 'configurar'] as const;
export type EtapaDoDesafio = (typeof ETAPAS_DO_DESAFIO)[number];
