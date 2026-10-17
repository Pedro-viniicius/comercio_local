# Fixtures das fronteiras

Árvore mínima que repete o desenho do repositório (`apps/api/src/modulos/<m>/{dominio,aplicacao,infra,http}`, o núcleo `apps/api/src/compartilhado` com portas, adaptadores e um client gerado de mentira, um fake em `apps/api/test/fakes`, `apps/consumidor`, `packages/*`). O teste `../fronteiras.test.ts` roda o `depcruise` com esta pasta como raiz e confere, arquivo por arquivo, qual regra de `.dependency-cruiser.cjs` reprova.

- Arquivos `viola-*.ts` violam exatamente uma regra.
- Os demais são controles: dependências permitidas que não podem ser reprovadas.
- Tudo compila (typecheck e lint cobrem a pasta). A única exceção declarada é `viola-contratos-outro-subcaminho.ts`, que importa de propósito um subcaminho inexistente de `@bairrin/contratos` e leva `@ts-expect-error`.
- `usa-validadores-nao-resolvido.ts` importa `@bairrin/contratos/validadores` pelo nome do pacote, que resolve para o fonte real do pacote (fora desta pasta); `usa-pacote-permitido.ts` importa a cópia mínima em `packages/contratos/src/validadores/` desta pasta pelo caminho relativo.
- O `pnpm deps:verificar` ignora esta pasta (`exclude` do `.dependency-cruiser.cjs`).
