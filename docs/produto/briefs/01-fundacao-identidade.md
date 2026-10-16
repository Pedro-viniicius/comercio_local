# Fundação e identidade: contas, perfis e privacidade

- Status: aprovado
- Aprovado pelo dono em 2026-10-16, com as respostas às perguntas em aberto incorporadas
- Prioridade: alta
- Data: 2026-10-16
- Fatia do MVP: 1 de 8 (índice em `docs/produto/visao.md`, seção 12)

## Problema
Tudo no produto depende de saber quem é o usuário e o que ele pode fazer: o consumidor compra, o lojista vende, o admin opera. Sem uma base de identidade segura, com consentimento registrado, nenhuma outra fatia pode ir ao ar.

## Para quem
Consumidor, lojista e administrador (personas em `docs/produto/visao.md`, seção 2).

## Por que agora
É pré-requisito de todas as outras fatias e a área mais sensível em segurança e LGPD. Precisa nascer certa.

## Proposta
Uma conta única por e-mail, que pode ter os perfis consumidor e lojista; o perfil admin é concedido manualmente e exige segundo fator. Login com e-mail e senha; sessão com token de acesso curto e token de renovação guardados no armazenamento seguro do celular. Tela de privacidade com termos, exportação e exclusão de dados.

Termos: token é a credencial temporária que o app envia à API para provar quem é; 2FA é o segundo fator de autenticação; TOTP é o código temporário gerado por um app autenticador (Google Authenticator, Authy e similares).

## Dependências e ordem
- Primeira fatia a implementar; não depende de nenhuma outra.
- O perfil lojista é criado pela fatia 2 (ao criar uma loja). O perfil admin é criado por carga inicial (seed) do ambiente, nunca por cadastro.

## Histórias de usuário
- Como consumidor, quero criar conta em menos de um minuto, para começar a comprar.
- Como lojista, quero usar o mesmo login no app do lojista e no do consumidor, para não decorar duas senhas.
- Como administrador, quero que só eu acesse o painel, com segundo fator, para proteger dinheiro e dados.
- Como usuário, quero ver o que a plataforma guarda sobre mim e poder apagar minha conta, para confiar no serviço.

## Critérios de aceite
- CA-01 — Dado um visitante no app do consumidor, quando informa nome, e-mail válido, telefone celular (DDD e número, formato validado, sem verificação por SMS no MVP) e senha com ao menos 8 caracteres e aceita os termos e a política de privacidade, então a conta é criada com o perfil consumidor, o aceite é registrado com versão do texto e data e hora, e um e-mail de verificação é enviado.
- CA-02 — Dado um e-mail já cadastrado, quando alguém tenta cadastrar com ele, então o app mostra a mesma mensagem de "verifique seu e-mail para continuar" do cadastro normal (sem revelar que a conta existe) e o dono do e-mail recebe um aviso com a opção de entrar ou recuperar a senha.
- CA-03 — Dado um usuário com e-mail verificado, quando entra com e-mail e senha corretos, então recebe um token de acesso de curta duração (até 15 min) e um token de renovação (até 30 dias), guardados no armazenamento seguro do dispositivo (Keychain no iOS, Keystore no Android) e nunca em armazenamento simples; teste automatizado confirma que o token não aparece em preferências nem em arquivos comuns.
- CA-04 — Dado 5 tentativas de login erradas para o mesmo e-mail ou origem em 15 min, quando há nova tentativa, então ela é recusada por um tempo crescente (1, 5, 15 min) com a mesma mensagem usada para senha errada, sem revelar se a conta existe; o limite por origem (IP) é maior que o por e-mail, 50 em 15 min, para não bloquear usuários atrás da mesma operadora.
- CA-05 — Dado um token de acesso expirado e um token de renovação válido, quando o app chama a API, então a sessão é renovada sem pedir senha; dado que o usuário saiu (logout) ou trocou a senha, então os tokens de renovação daquela conta são invalidados no servidor e a próxima renovação falha.
- CA-06 — Dado um usuário que esqueceu a senha, quando pede recuperação, então recebe um link ou código com validade de 30 min e uso único; a resposta na tela é a mesma exista ou não o e-mail.
- CA-07 — Dado um usuário com perfil consumidor, quando cria uma loja no app do lojista (fatia 2), então a mesma conta recebe o perfil lojista sem novo cadastro e o login funciona nos dois apps; não existe endpoint público que conceda o perfil admin.
- CA-08 — Dado um usuário autenticado sem perfil admin, quando chama qualquer endpoint do painel, então recebe 403 e a tentativa é registrada no log apenas com o identificador interno da conta, sem e-mail ou nome; o mesmo vale entre lojistas: um lojista nunca lê ou altera dados de outra loja (teste automatizado por recurso).
- CA-09 — Dado o admin, quando entra no painel, então precisa de senha e código TOTP; dado um admin ainda sem 2FA configurado, então o painel exige configurar (QR code e códigos de recuperação) antes de mostrar qualquer outra tela.
- CA-10 — Dado qualquer usuário, quando acessa "Privacidade" no app, então vê a política vigente com sua versão, a data em que aceitou, um botão para pedir cópia dos seus dados (arquivo baixado no próprio app, por link autenticado com validade de 7 dias e uso único, pronto em até 48 h; o e-mail só avisa que está pronto) e um botão para excluir a conta.
- CA-11 — Dado um pedido de exclusão confirmado com a senha, então a conta é desativada na hora, os dados pessoais são anonimizados em até 30 dias, e os registros de pedidos e financeiros permanecem com identificador anonimizado pelo prazo legal; conta com pedido em andamento ou saldo a repassar recebe aviso e a exclusão aguarda a conclusão.
- CA-12 — Dado qualquer erro na API de identidade, quando ele é registrado em log ou devolvido ao cliente, então não contém e-mail, telefone, nome, senha nem token; um teste automatizado provoca erros e inspeciona logs e respostas.
- CA-13 — Dado um payload inválido ou com campos desconhecidos em qualquer endpoint desta fatia, quando enviado, então a API responde 400 com a lista de campos e motivos, em português, nunca com rastro de pilha ou detalhe interno.

## Fora do escopo
Login com Google e Apple; telefone com código SMS como login; verificação do telefone por SMS; vários admins com papéis; biometria (o sistema do celular pode proteger o app, mas não é requisito).

## Como vamos medir o sucesso
Taxa de cadastros concluídos (iniciou → e-mail verificado); tempo mediano de cadastro; zero ocorrências de dado pessoal em logs (teste automatizado); tentativas de acesso não autorizado ao painel registradas e revisadas.

## Riscos e premissas
- Premissa: e-mail e senha bastam no MVP. Risco: parte do público prefere telefone; medir abandono no cadastro.
- Premissa: telefone sem verificação por SMS (custo por mensagem). Risco: telefone errado atrapalha entrega e retirada; o checkout mostra o telefone para confirmar (CA-45) e a verificação fica no backlog (item 28).
- Premissa: a Apple exige "Entrar com a Apple" apenas quando o app oferece outro login social de terceiros; sem login social não há exigência. Confirmar nas diretrizes da App Store antes de publicar.
- Risco: e-mail de verificação cair em spam. Mitigação: provedor de e-mail transacional com boa reputação (decisão do arquiteto).

## Pendências para entrar no ar (não bloqueiam o desenvolvimento)
- Termos de uso e política de privacidade escritos e revisados por advogado (LGPD).
- Prazo de retenção de dados após exclusão confirmado com advogado e contador.
- Encarregado de dados (DPO) nomeado, conforme a LGPD.

## Perguntas em aberto
- Respondida em 2026-10-16: navegar e entrar não exigem verificação de e-mail; pagar exige (CA-45).
- Respondida em 2026-10-16: telefone é obrigatório já no cadastro (decisão do dono).

## Interface
Telas: cadastro, login, recuperar senha, verificação de e-mail, privacidade (termos, exportar, excluir), configurar 2FA no painel. Precisa de spec do designer: sim, para os dois apps e para o painel.
