# ADR-012: Sessão com JWT curto e renovação opaca rotativa

- Situação: aceita (decisão do dono, 2026-10-16). **Ainda não implementada**: o plano 01b (etapa 20) completa este ADR com os detalhes finais.
- Origem: `docs/produto/planos/00-arquitetura.md` (ADR-012) e `docs/produto/planos/01b-identidade.md`.

## Contexto

O brief exige revogar o acesso no servidor (CA-05), a conta de administrador precisa de segundo fator, e o painel guarda a sessão num navegador. Um JWT longo e sem estado não permite revogar. A revisão de segurança (S1, S8 e S16) apontou como pontos de risco o desafio de segundo fator, o acesso depois da revogação e o token recém-trocado em rede instável.

## Decisão

- Token de acesso: JWT HS256 de 15 minutos com `sid` (id da sessão). Nos apps vai em `Authorization: Bearer`; no painel fica só em memória.
- Renovação: token opaco de 30 dias, rotativo, guardado só com hash, com detecção de reuso (reuso revoga a família inteira). No painel vai em cookie `HttpOnly; Secure; SameSite=Strict`, com 30 minutos de inatividade e máximo absoluto de 12 horas, conferidos no servidor.
- Tolerância de 60 segundos ao token de renovação recém-trocado: o par novo fica cifrado (AES-GCM) pelo prazo e só volta ao mesmo cliente (S16).
- Revogação (S8): em `/v1/admin/*` a sessão (`sid`) é conferida a cada requisição; nas demais, `contas.status`. Desativar, bloquear ou excluir revoga as sessões na mesma transação.
- Senha com Argon2id (19 MiB, 2 iterações, paralelismo 1) e lista local de senhas comuns.
- Administrador (S1): TOTP com desafio por etapa (`configurar` ou `verificar`), 5 tentativas por desafio e contador por conta que só zera depois do segundo fator concluído. O perfil `admin` só entra no token de uma sessão criada no painel com senha e segundo fator. Reconfigurar o TOTP é por CLI.
- Chaves (S17): `JWT_SEGREDO`, `CHAVE_CIFRAGEM_DADOS` e `CHAVE_HMAC` com no mínimo 32 bytes, diferentes entre si, validadas na subida (já existe em `apps/api/src/compartilhado/config/ambiente.ts`), com subchaves por finalidade (HKDF) e versão no texto cifrado.

## Consequências

- A revogação passa a existir no servidor; o custo é uma consulta por requisição no prefixo admin.
- Trocar HS256 por ES256 é o caminho para que outro serviço verifique o JWT, se um serviço for extraído (ADR-003).
- O freio de login e o aviso de cadastro repetido têm limites próprios, descritos no plano 01b.
