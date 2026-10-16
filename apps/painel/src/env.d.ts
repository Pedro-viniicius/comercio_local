/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Endereço da API (ver `.env.example`). Embutido no build: nunca segredo. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
