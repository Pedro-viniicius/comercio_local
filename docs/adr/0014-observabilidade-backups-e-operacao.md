# ADR-014: Observabilidade, backups e operação

- Situação: aceita (decisão do dono, 2026-10-16). Logs e rotas de saúde existem; Sentry, uptime e backups dependem do deploy.
- Origem: `docs/produto/planos/00-arquitetura.md`, seção "Observabilidade, backups e operação (ADR-014)", S10 e S21.

## Contexto

Com uma equipe pequena, é preciso achar um erro a partir do que o usuário viu, sem registrar dado pessoal, e conseguir restaurar o banco. O dono respondeu (P2) que não há PITR por enquanto e que a decisão volta antes do primeiro pagamento real.

## Decisão

- Saúde: `GET /v1/saude` (vivo, sem consultar o banco) e `GET /v1/saude/pronto` (consulta o banco; 503 em Problem Details se falhar). `versao` só aparece fora de produção.
- Logs em JSON (pino) com `idRequisicao`, redator de chaves sensíveis, **sem corpo de requisição** e com a URL sem query string. A mensagem de erro de biblioteca de banco não vai para o log: só tipo, código e pilha.
- Sentry na API, nos apps e no painel, só quando `SENTRY_DSN` existe, com `beforeSend` e `beforeBreadcrumb` usando o mesmo redator, sem Replay e sem coleta de dado pessoal pelo SDK. O plano previa `sendDefaultPii: false`; o SDK 11 (`@sentry/nestjs`) trocou essa opção por `dataCollection`, que sem configuração coleta tudo, então a API desliga cada categoria (usuário e IP, cookies, cabeçalhos, corpos, query, dados de banco, variáveis locais). No projeto do Sentry, o descarte de IP e a limpeza de dados do lado do servidor ficam ligados (`docs/operacao/checklist-deploy.md`). Monitor de uptime externo grátis.
- Backups: o plano Pro do Supabase faz backup diário com 7 dias de retenção. Além disso, uma cópia lógica cifrada semanal fora do Supabase. O PITR (cerca de US$ 100 por mês) fica adiado; a recomendação é ligar antes do primeiro pagamento real.
- A restauração é testada em homologação antes do piloto e a cada trimestre. Os backups de 7 dias constam da política de privacidade.

## Consequências

- Um suporte consegue achar o log pelo `idRequisicao` que o usuário viu no erro.
- Sem PITR, a perda de dados pode chegar a cerca de 24 horas (intervalo do backup diário). Risco aceito até o primeiro pagamento real.
- Todos os itens operacionais estão em `docs/operacao/checklist-deploy.md`.
- Nada disso foi contratado ainda (decisão do dono: nenhum serviço pago antes do app pronto).
