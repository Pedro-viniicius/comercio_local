---
name: riscos-aceitos
description: Riscos que o dono do Bairrin aceitou explicitamente; não voltam como achado salvo se a mitigação deixar de valer
metadata:
  type: project
---

**Aceitos:**
- 2026-10-16, premissa P5 do plano 01b (registro em `docs/produto/decisoes.md`): `CREATE POLICY ... TO bairrin_app USING (true)` é aceito; o RLS só restringe o papel e a proteção de linha vem dos GRANTs e das triggers. Mitigação declarada: o verificador reprova `CREATE`/`ALTER POLICY` sem `TO` ou para PUBLIC, papéis do Supabase e administrativos (S34, corrigido em 2026-10-16), e o catálogo do release reprova política para PUBLIC/anon/authenticated/service_role mesmo vinda de SQL dinâmico (S33). **Reabre se:** a checagem de catálogo sair do `release_command` ou do teste de integração, se `bairrin_app` ganhar GRANT de UPDATE/DELETE em tabela só de acréscimo (hoje só o teste de integração confere; o catálogo não), ou se a Data API for ligada.

Não confundir com riscos já decididos no produto que não são aceite de achado: telefone sem verificação por SMS (decisão do dono em `docs/produto/decisoes.md`); bloqueio direcionado de conta por até 15 min aceito como efeito do CA-04 pelo próprio brief (o plano 01b diz "nunca bloqueio definitivo").

Limitação declarada pelo dev/lead, não aceite do dono (rodada 2 do grupo A do 01b, 2026-10-16): `GRANT USAGE ON SCHEMA public TO PUBLIC` não é apontado pelo catálogo no Postgres local; no Supabase o `acessosIndevidos` pega (PUBLIC dá USAGE ao `anon`). Não é achado enquanto o `acessosIndevidos` rodar no release do Supabase; se sair, vira achado.

Pendente de registro pelo dono (2026-10-16): conta criada com e-mail alheio pode ser usada sem pagar até o titular recuperar a senha (consequência do login sem verificação). Reabre se alguma ação além de navegar/carrinho dispensar verificação (ex.: criar loja).

Pendente de decisão do dono (levantado em 2026-10-16, revisão do 01a): EAS Update sem assinatura de código (exige plano pago do Expo). Antes das etapas 8/9 ligarem updates: desligar `expo-updates` ou registrar aceite com MFA na conta Expo e poucas pessoas com permissão de publicar. O plano `publicacao-nas-lojas.md` (P2) propõe tirar o EAS Update. Se o dono aprovar, isso elimina o risco e não exige aceite.

Pendente de decisão do dono (2026-10-16, plano `publicacao-nas-lojas.md`, P3; achado S37, rodada 2 do plano): `EXPO_TOKEN` como secret do repositório. O plano já traz no CA-116 a frase "quem tem escrita pode publicar nas trilhas de teste". O aceite só vale com: token de robô ou conta Expo só do CI com MFA (papel Developer), nunca pessoal; escrita só para quem já poderia publicar; 2FA e Settings → Actions (fork sem execução e sem secrets, token só leitura, Actions sem criar/aprovar PR); menor privilégio nas lojas (CA-114); detecção com e-mail de build processado ao dono e cada build casado 1:1 com o id do build no log de uma execução do `lojas.yml` em tag da `main` (build sem execução ou execução com dois builds = incidente); rotação a cada 6 meses, na saída de alguém e sob suspeita. Na rodada 2 pedi que a P3 incluísse a detecção 1:1, o CA-114 e os gatilhos de reabertura (a P3 só tinha robô, escrita, 2FA, conferência do commit e rotação). **Reabre se:** entrar colaborador, o token passar a ser pessoal ou o robô ganhar papel acima de Developer, a conta de serviço da Play ganhar produção ou gestão de trilhas ou papel IAM, a chave ASC virar App Manager ou Admin (aí alcança a produção da Apple), surgir outro secret no repositório, ou o repositório ficar público.

Ao registrar um aceite: data, ID do achado, mitigação declarada e o fato que reabriria.

Relacionado: [[areas-sensiveis]]
