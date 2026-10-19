# Especificação de UI/UX: fundação e identidade (contas, sessão, privacidade e 2FA do painel)

- Fatia 1. Rodada 1. Data: 2026-10-16. Marca: Bairrin.
- Brief: `docs/produto/briefs/01-fundacao-identidade.md` (CA-01 a CA-13). Plano: `docs/produto/planos/01b-identidade.md`, etapas 14, 15, 17 e 18 e a seção "Esquema e contratos".
- Base visual: `00-design-system.md` (componentes citados pelo nome), `00-nome-e-identidade.md` (marca, seção 2.7; tom, seção 2.6), wireframes C9 (`00-wireframes-apps.md`) e P1 (`00-wireframes-painel.md`). Esta spec descreve só o que muda ou se detalha em relação a eles.
- Regra desta spec: a tela nunca decide segurança. Onde o comportamento depende de regra, aponto o CA ou o endpoint do plano 01b.

## Objetivo e usuário

Ana cria conta em menos de um minuto, no meio de uma compra, com uma mão e conexão ruim. Seu Carlos usa a mesma conta no app do lojista. O dono entra no painel com senha e código do app autenticador. As telas precisam ser rápidas, sem jargão, e nunca revelar se um e-mail tem conta (CA-02, CA-04, CA-06).

## Fluxo

Apps (telas em `packages/mobile-base`, usadas pelos dois apps):
```
Navegar sem conta ──(ação que exige conta: "Fechar pedido", aba Conta)──► A1 Entrar
A1 Entrar ──► sucesso ──► volta à tela de origem
A1 ──"Criar conta"──► A2 Cadastro ──202──► A3 Verificar e-mail ──código ok (sessão)──► volta à origem
A1 ──"Esqueci minha senha"──► A4 Recuperar senha (e-mail → código + nova senha) ──► A1
A1 ──"Não confirmou seu e-mail?"──► informa e-mail ──► A3
Aba Conta (logado) ──► A5 Minha conta ──► A6 Privacidade ──► A6b Excluir conta
App do lojista: login sem perfil lojista ──► A7 Criar minha loja (entrada da fatia 2)
```
Painel: P1 Entrar → P1a Segundo fator (ou P1b Configurar 2FA, obrigatório se ainda não houver) → Início. "Esqueci minha senha" → P1c Recuperar senha → P1. 401 ou 403 em qualquer tela → P1 com aviso.

## Layout (mobile e desktop)

- **Apps:** tela única rolável, margem `space.4`, logo horizontal (60% da largura até 160 px) no topo só em A1 e A2, com o slogan "lojas do seu bairro" abaixo. Ação principal no fim do formulário (não fixa no rodapé: o teclado cobriria). Com o teclado aberto, a tela rola até o campo focado e até o botão principal. Formulário em uma coluna; campos com `size.control.height` 48.
- **Painel:** cartão de autenticação de 400 px centralizado na vertical e na horizontal sobre `bg.canvas`, `radius.xl`, `elevation.1`, logo horizontal acima do cartão. Em 1024 igual. Em 375: cartão ocupa a largura menos `space.4` de cada lado, sem sombra.

## Componentes

| Componente | Existente ou novo | Onde fica |
|---|---|---|
| Botão (primário, secundário, terciário, destrutivo), Campo (texto, senha, telefone), Banner, Toast, Modal de confirmação, Barra superior, Item de lista, Faixa offline, Estado vazio | Existente (design system) | `packages/mobile-base/src/componentes/` e `apps/painel/src/componentes/` (ver Pendências) |
| Caixa de seleção (checkbox) com texto e links | Novo: 24 px visual, alvo 44, borda `border.control`, marcado com fundo `blue.600` e check branco, erro com borda `red.600` + mensagem | mesmo local dos base |
| Campo de código (6 dígitos) | Novo: **um único campo** numérico exibido como 6 casas (`font.title`, algarismos tabulares), aceita colar, preenchimento automático de código de uso único do sistema; rótulo "Código de 6 dígitos" | mesmo local dos base |
| Cabeçalho de marca (logo + slogan) | Novo, usa `bairrin-logo-horizontal.svg` | `packages/mobile-base/src/componentes/` |
| Leitor de texto legal | Novo: título (`font.title`), linha "Versão X · vigente desde dd/mm/aaaa" (`text.secondary`), conteúdo com títulos h2 e parágrafos de até ~70 caracteres por linha, rolagem com "Voltar ao topo" | `packages/mobile-base/src/telas/` |
| Cartão de autenticação (painel) | Novo: contêiner da seção Layout | `apps/painel/src/componentes/` (como manda o plano 01b) |
| Indicador de passos (painel) | Novo: texto "Passo 1 de 3" + título do passo; sem barra só visual | `apps/painel/src/componentes/` (como manda o plano 01b) |
| QR code (painel) | Novo, com a dependência `qrcode` já prevista no plano 01b, etapa 1 | `apps/painel/src/autenticacao/` |
| Lista de códigos de recuperação (painel) | Novo: grade de 2 colunas × 5, fonte monoespaçada do sistema, `bg.subtle`, ações "Copiar todos" e "Baixar (.txt)" | `apps/painel/src/autenticacao/` |

## Telas dos apps

### A1. Entrar (CA-03, CA-04, CA-05)
```
┌──────────────────────────────┐
│ ✕                            │
│        [logo bairrin]        │
│      lojas do seu bairro     │
│ Entre para continuar ①       │
│ E-mail [                   ] │
│ Senha  [            ] Mostrar│
│ Esqueci minha senha ②        │
│ [ Entrar                   ] │
│ Não tem conta? Criar conta ③ │
│ Não confirmou seu e-mail?    │
│ Receber novo código ④        │
└──────────────────────────────┘
```
① Título contextual quando vem de uma ação ("Entre para fechar seu pedido"); sem origem, "Entrar". ✕ fecha e volta à navegação livre (consumidor). ② Terciário, leva a A4 com o e-mail já digitado. ③ Secundário. ④ Terciário: pede o e-mail (mesmo campo) e chama o reenvio, que sempre responde igual (plano 01b, `POST /v1/contas/verificacao/reenvio`), depois abre A3. Fica sempre visível, porque o login de conta não verificada não pode ser diferenciado na resposta.
Estados:
- Carregando: botão em carregando, campos somente leitura.
- **Erro de credencial, conta inexistente, conta não verificada ou bloqueio progressivo (401 ou 429): sempre a mesma mensagem**, num Banner de erro acima do botão: "Não foi possível entrar. Confira o e-mail e a senha ou tente de novo em alguns minutos." O botão **não** é desabilitado nem ganha contagem, e o `Retry-After` não aparece na tela (CA-04). A senha é apagada; o e-mail fica.
- Campo vazio ou e-mail mal formado (validação local): erro no campo ("Informe seu e-mail", "Confira o e-mail: falta o @ ou o domínio", "Informe sua senha").
- Offline: Faixa offline; botão desabilitado com "Sem conexão: tente quando voltar"; o que foi digitado fica.
- Erro inesperado (5xx ou tempo esgotado): Banner "Não conseguimos falar com o Bairrin agora. Tente de novo em instantes."
- Sucesso: volta à origem sem toast (a própria tela mostra o resultado).
- Sessão encerrada por renovação falha (CA-05): ao voltar para A1 por isso, Banner informativo "Sua sessão terminou. Entre de novo para continuar."

### A2. Cadastro (CA-01, CA-02, CA-13)
Layout, campos e textos do wireframe C9. Ajustes desta spec:
- Ordem: Nome, E-mail, Celular com DDD, Senha, aceite. Teclados e preenchimento automático: nome (`name`), e-mail (`email`), telefone (`tel`), senha (`new-password`, para o gerenciador sugerir senha forte).
- Senha: regra única visível desde o início, "Use 8 caracteres ou mais" (máximo 128 só aparece se ultrapassado: "Use até 128 caracteres"). Ícone de check ao cumprir, com texto (não só cor).
- Aceite: uma Caixa de seleção "Li e aceito os Termos de Uso e a Política de Privacidade", com os dois nomes como links que abrem o Leitor de texto legal por cima, preservando o formulário. As versões aceitas vão no envio (contrato `POST /v1/contas`); a tela mostra a versão no leitor.
- Envio: valida localmente com os mesmos validadores de `packages/contratos` (etapa 2); erros por campo, foco no primeiro erro, anúncio "2 campos precisam de atenção".
- **Resposta 202: sempre vai para A3**, com o mesmo texto, exista ou não conta com o e-mail (CA-02). Nunca mostrar "Este e-mail já tem conta" (o C9 citava isso; esta spec corrige).
- 400 da API (CA-13): cada `{campo, motivo}` vira erro no campo correspondente; motivo sem campo conhecido vira Banner "Confira os dados e tente de novo."
- Limite de cadastros por origem (429): Banner "Muitas tentativas por aqui. Tente de novo em alguns minutos."
- Offline: igual a A1; nada digitado se perde ao trocar de app.

Textos dos erros por campo:
| Campo | Vazio | Inválido |
|---|---|---|
| Nome | "Informe seu nome" | "Use até 80 caracteres" (limite a confirmar no contrato) |
| E-mail | "Informe seu e-mail" | "Confira o e-mail: falta o @ ou o domínio" |
| Celular | "Informe o celular com DDD" | "Confira o número: use DDD + 9 dígitos, como (35) 99999-1234" |
| Senha | "Crie uma senha" | "Use 8 caracteres ou mais" |
| Aceite | "Para criar a conta, aceite os Termos e a Política" | — |

### A3. Verificar e-mail (CA-01, CA-02; plano 01b, decisão P1)
```
┌──────────────────────────────┐
│ ‹ Confirme seu e-mail        │
│ Enviamos um código de 6      │
│ dígitos para                 │
│ ana.souza@gmail.com ①        │
│ Corrigir e-mail              │
│ Código de 6 dígitos          │
│ [ _  _  _  _  _  _ ] ②       │
│ [ Confirmar               ]  │
│ Não chegou? Veja o spam ou   │
│ Reenviar código (0:45) ③     │
└──────────────────────────────┘
```
① O e-mail que a própria pessoa digitou (vem da tela anterior, não da API). "Corrigir e-mail" volta a A2 com tudo preenchido. ② Campo de código; envia sozinho ao completar 6 dígitos (o botão continua disponível). ③ Reenvio liberado após 60 s, com contagem em texto e anúncio só quando liberar; resposta sempre "Se houver uma conta para este e-mail, enviamos um novo código." (Toast).
Estados: código errado, expirado ou já usado: erro no campo "Código inválido ou expirado. Confira ou peça um novo." (mensagem única, plano 01b); limite de tentativas: mesma mensagem. Sucesso: a API devolve sessão; a tela volta à origem com Toast "Conta confirmada. Boas-vindas ao Bairrin!". Offline: igual a A1; o código digitado fica.
Saída sem confirmar: a pessoa pode fechar; ao tentar entrar depois, usa "Receber novo código" em A1.

### A4. Recuperar senha (CA-06, CA-05)
Passo 1: título "Recuperar senha", texto "Informe o e-mail da sua conta. Enviaremos um código para criar uma nova senha.", campo E-mail, [Enviar código]. Resposta sempre igual (202): avança para o passo 2 com o texto "Se houver uma conta para ana.souza@gmail.com, você vai receber um código em instantes. Ele vale por 30 minutos."
Passo 2: Campo de código, campo "Nova senha" (`new-password`, regra de 8 caracteres), [Salvar nova senha], "Reenviar código" (60 s, mesmo comportamento de A3).
Sucesso (204): volta a A1 com Banner de sucesso "Senha alterada. Por segurança, saímos da sua conta em todos os aparelhos. Entre com a nova senha." e o e-mail preenchido.
Erros: código inválido, expirado ou usado: "Código inválido ou expirado. Peça um novo." (mesma mensagem para todos os casos). Offline e 5xx: como A1.

### A5. Minha conta (entrada; plano 01b, `GET /v1/conta`)
Aba Conta do consumidor e aba Loja → "Minha conta" do lojista. Cabeçalho com nome e e-mail mascarado como vem da API. Itens de lista: "Privacidade e dados" (A6), "Termos de Uso" (Leitor), "Sair". "Sair" encerra a sessão (CA-05) sem modal e volta à navegação livre com Toast "Você saiu da sua conta". Sem login: Estado vazio "Entre para ver seus pedidos e dados" + [Entrar] + "Criar conta".

### A6. Privacidade e dados (CA-10)
```
┌──────────────────────────────┐
│ ‹ Privacidade e dados        │
│ Política de Privacidade      │
│ Versão 1.0 · aceita em       │
│ 16/10/2026 às 14:32 ①        │
│ Ler a política          ›    │
│ Termos de Uso · versão 1.0 › │
│ ──────────────────────────── │
│ Seus dados ②                 │
│ Receba uma cópia de tudo que │
│ o Bairrin guarda sobre você. │
│ [ Pedir cópia dos meus dados]│
│ ──────────────────────────── │
│ Excluir conta ③              │
│ Apaga seus dados pessoais.   │
│ Excluir minha conta     ›    │
└──────────────────────────────┘
```
① Dados de `GET /v1/privacidade`. ② Botão secundário (a tela não tem ação primária: é de consulta). Ao tocar: Modal de confirmação "Pedir cópia dos seus dados?" / "Enviaremos um arquivo para o e-mail da sua conta em até 48 horas." / [Pedir cópia] [Cancelar]. Sucesso (202): Banner de sucesso fixo na tela "Pedido recebido. O arquivo chega no e-mail da conta em até 48 horas." Pedido repetido em 24 h (limite do plano 01b): Banner informativo "Você já pediu uma cópia nas últimas 24 horas. Confira seu e-mail." ③ Item de lista com texto `red.700` e ícone, abre A6b (nunca exclui direto).
Estados: carregando (Skeleton das linhas); erro de carga (Estado vazio com "Tentar de novo"); offline (Faixa offline, última versão vista se houver cache; botões desabilitados com a razão).

### A6b. Excluir conta (CA-11)
```
┌──────────────────────────────┐
│ ‹ Excluir conta              │
│ O que acontece:              │
│ • Você sai do Bairrin agora  │
│   em todos os aparelhos.     │
│ • Seus dados pessoais são    │
│   apagados em até 30 dias.   │
│ • Pedidos e pagamentos ficam │
│   guardados sem seu nome,    │
│   pelo prazo que a lei exige.│
│ • Não dá para desfazer.      │
│ Confirme com sua senha       │
│ [                  ] Mostrar │
│ [ Excluir minha conta      ] │
└──────────────────────────────┘
```
Botão destrutivo (única ação; "Voltar" pela barra superior). Senha com `current-password`.
- Sucesso (202): sessão encerrada; tela final "Sua conta foi excluída" / "Sentiremos sua falta. Se mudar de ideia, é só criar uma conta nova." + [Voltar ao início].
- Pendências (409, CA-11): Banner de aviso com o texto que a API devolver, com o padrão "Você tem pedido em andamento ou valor a receber. A exclusão será feita assim que tudo for concluído." O comportamento exato (pedido registrado e aguardando, ou recusado) segue o CA-11 e o plano; ver pergunta 2.
- Senha errada: erro no campo "Senha incorreta". Limite de tentativas, se houver, segue o plano.
- Offline: botão desabilitado com a razão.
- Lojista: o texto de pendências também cita "saldo a repassar".

### A7. Criar minha loja (só app do lojista; CA-07, plano 01b etapa 18)
Depois de entrar ou confirmar o e-mail sem perfil lojista: Estado vazio com ícone de loja, título "Sua conta está pronta", texto "Agora cadastre sua loja para começar a vender para o seu bairro." e [Criar minha loja] (primário, abre o fluxo da fatia 2). Enquanto a fatia 2 não existir, o botão leva a "Em breve você poderá criar sua loja por aqui." Link "Sair" no rodapé. No app do lojista, A1 troca o slogan por "venda para o seu bairro".

## Telas do painel

### P1. Entrar (CA-09, CA-04, CA-101)
Layout do wireframe P1 dentro do Cartão de autenticação. **Correção do P1:** a mensagem de erro é a mesma para senha errada, conta inexistente e bloqueio progressivo: "Não foi possível entrar. Confira o e-mail e a senha ou tente de novo em alguns minutos." Nada de "Muitas tentativas" nem contagem (CA-04). Campos com `autocomplete` `email` e `current-password`. "Esqueci minha senha" leva a P1c. Chegada por 401/403 ou por sessão expirada após 30 min sem uso (CA-101): Banner informativo "Sua sessão terminou. Entre de novo para continuar." e, depois de entrar, volta à URL de origem. Conta sem perfil admin (403 após o login): mesma tela, Banner "Esta conta não tem acesso ao painel." (a conta já se autenticou; a mensagem não revela nada novo; confirmar com o `seguranca`, pergunta 4).

### P1a. Segundo fator
Como o passo 2 do wireframe P1, com o Campo de código (6 dígitos). "Usar um código de recuperação" troca para um campo de texto "Código de recuperação" (formato do plano: 10 códigos de uso único). Erro único: "Código inválido ou expirado. Confira o horário do celular e tente de novo." Desafio vencido (5 min, plano 01b): "O tempo para digitar o código acabou. Entre de novo." e volta a P1 com o e-mail preenchido.

### P1b. Configurar 2FA (obrigatório; CA-09)
Indicador de passos; nenhuma outra tela do painel acessível até concluir; "Sair" no canto do cartão.
- Passo 1 de 3, "Instale um app autenticador": texto "Use Google Authenticator, Microsoft Authenticator, Authy ou outro de sua preferência." [Já tenho, continuar].
- Passo 2 de 3, "Escaneie o QR code": QR code 200 px (texto alternativo "QR code para configurar o app autenticador"), abaixo "Não consegue escanear? Digite esta chave:" com a chave em grupos de 4 caracteres, fonte monoespaçada, e [Copiar chave]. Campo de código "Digite o código de 6 dígitos que aparece no app" + [Confirmar]. Erro: "Código não confere. Confira o horário do celular e digite o código atual."
- Passo 3 de 3, "Guarde seus códigos de recuperação": Banner de aviso "Estes códigos aparecem só agora. Cada um funciona uma vez, se você perder o celular." Lista de códigos de recuperação com [Copiar todos] e [Baixar (.txt)] (arquivo `bairrin-codigos-recuperacao.txt`). Caixa de seleção "Guardei os códigos em local seguro" habilita [Concluir e entrar].
- Sair da página no passo 3 sem concluir: aviso do navegador ("alterações não salvas"); os códigos não serão mostrados de novo.
- Leitor de tela: a chave e os códigos são lidos caractere a caractere (agrupados), nunca como palavra.

### P1c. Recuperar senha (painel)
Mesmo fluxo e textos de A4, no Cartão de autenticação. Depois de redefinir, P1 com o Banner de sucesso; o 2FA continua exigido.

## Estados (resumo transversal)

| Situação | Comportamento | Origem |
|---|---|---|
| Conta existe ou não | Mesmo texto em cadastro, reenvio, recuperação e login | CA-02, CA-04, CA-06 |
| Bloqueio progressivo | Mesma mensagem do login errado; sem contagem, sem desabilitar | CA-04 |
| Payload inválido | Erro por campo a partir de `campos[]`; nunca texto técnico | CA-13 |
| Erro inesperado | Banner genérico com "Tentar de novo"; `idRequisicao` não aparece para o usuário (fica nos logs) | plano 00, Contratos |
| Offline | Faixa offline; ações desabilitadas com a razão; nada digitado se perde | CA-38 (padrão) |
| Conteúdo longo | Nome de até 80 caracteres e e-mail longo quebram linha; texto legal rola | — |
| Texto em 200% | Campos e botões crescem na altura; nada corta | design system |

## Textos da interface

Além dos já citados nas telas:
| Chave sugerida | Texto |
|---|---|
| conta.entrar.titulo | "Entrar" / "Entre para continuar" / "Entre para fechar seu pedido" |
| conta.erro.credenciais | "Não foi possível entrar. Confira o e-mail e a senha ou tente de novo em alguns minutos." |
| conta.erro.servidor | "Não conseguimos falar com o Bairrin agora. Tente de novo em instantes." |
| conta.erro.offline | "Sem conexão: tente quando voltar" |
| conta.cadastro.titulo | "Criar conta" |
| conta.cadastro.telefoneAjuda | "Usamos para a loja falar com você sobre o pedido." |
| conta.cadastro.botao | "Criar conta" |
| conta.verificacao.reenviado | "Se houver uma conta para este e-mail, enviamos um novo código." |
| conta.verificacao.sucesso | "Conta confirmada. Boas-vindas ao Bairrin!" |
| conta.codigo.invalido | "Código inválido ou expirado. Confira ou peça um novo." |
| conta.sessao.terminou | "Sua sessão terminou. Entre de novo para continuar." |
| conta.sair.toast | "Você saiu da sua conta" |
| privacidade.copia.recebida | "Pedido recebido. O arquivo chega no e-mail da conta em até 48 horas." |
| privacidade.exclusao.botao | "Excluir minha conta" |
| painel.2fa.passo3.aviso | "Estes códigos aparecem só agora. Cada um funciona uma vez, se você perder o celular." |

## Acessibilidade

- Rótulo visível em todo campo; erro ligado ao campo e anunciado; ao enviar com erros, foco no primeiro e anúncio do total.
- Banners de erro de envio anunciados de forma assertiva; toasts de forma educada.
- Campo de código: um campo só (não 6), para leitor de tela e colagem; preenchimento automático de código de uso único habilitado.
- Senha: "Mostrar senha" com estado anunciado ("Senha visível"); gerenciadores de senha funcionam (tipos de preenchimento corretos).
- Nenhum limite de tempo escondido: validade do código (30 min) e do desafio (5 min) aparecem em texto quando relevantes.
- Painel: ordem de foco logo → título → campos → ação → links; Enter envia; QR code sempre com a chave em texto como alternativa.
- Alvos de 44 px nos apps (links terciários inclusive); 32 px no painel.

## O que o dev precisa implementar

1. Etapa 14 (`packages/mobile-base/src/telas/`): A1 a A6b, com o mapeamento de respostas da tabela de estados; envio automático do código; contagem de reenvio local; retorno à tela de origem.
2. Etapa 15 (`apps/painel/src/autenticacao/`): P1, P1a, P1b, P1c; QR a partir de `otpauthUri`; download dos códigos em .txt; redirecionamento com retorno à URL; aviso de expiração do layout comum.
3. Etapas 17 e 18: montar as telas nas rotas `(conta)` dos dois apps; A7 no lojista; título contextual de A1 conforme a origem.
4. Componentes novos da tabela (Caixa de seleção, Campo de código, Cabeçalho de marca, Leitor de texto legal; no painel, Cartão, Indicador de passos, QR, Lista de códigos).
5. Fora da apresentação, já no plano: validadores, contratos, sessão, limites. A tela só exibe; não implementa lógica de bloqueio.

## Arquivos de apresentação afetados

- `packages/mobile-base/src/telas/{cadastro,verificar-email,entrar,recuperar-senha,privacidade}.tsx` (etapa 14; "Minha conta", "Excluir conta" e o Leitor de texto legal cabem em `privacidade.tsx` ou em arquivos novos, a critério do plano).
- `packages/mobile-base/src/componentes/*` (novo; ver pendência 1).
- `apps/painel/src/autenticacao/*.tsx` (etapa 15).
- `apps/consumidor/src/app/(conta)/*.tsx`, `apps/lojista/src/app/(conta)/*.tsx` (etapas 17 e 18).
- Assets de marca: `assets/brand/bairrin-logo-horizontal.svg` (seção 2.7 da identidade).
- Não tocar: `packages/mobile-base/src/sessao/**`, `packages/contratos/**`, `packages/cliente-api/**`, `apps/api/**`.

## Perguntas em aberto

1. Para o arquiteto: onde ficam os componentes base compartilhados pelos dois apps (`packages/mobile-base/src/componentes/`?) e os textos de interface (sugestão: `packages/mobile-base/src/textos/pt-BR.ts` e `apps/painel/src/textos/pt-BR.ts`, com as chaves acima)? A etapa 14 não lista esses arquivos.
2. CA-11 com pendências: a exclusão fica registrada e é feita sozinha depois (status `aguardando_pendencias`) ou a pessoa precisa pedir de novo? Muda o texto de A6b.
3. As mensagens de `campos[].motivo` vindas de `packages/contratos` são as finais para o usuário, ou o app troca por estes textos pelo código do campo?
4. Para o `seguranca`: no painel, "Esta conta não tem acesso ao painel" depois de senha correta é aceitável, ou deve ser a mesma mensagem genérica?
5. Premissa P1 do plano (login só com e-mail verificado) ainda precisa de confirmação do dono; se mudar, A1 deixa de precisar do link "Receber novo código".
