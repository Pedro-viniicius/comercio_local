# Verificação de disponibilidade dos 25 candidatos a nome

Data: 2026-10-16 (leva 1: nomes 1 a 15; leva 2: nomes 16 a 25, mesmos métodos e critérios). Escopo: domínios, Instagram, lojas de apps e homônimos no Brasil. Nada foi registrado nem reservado.

## Métodos e limites

**Fato verificado por API ou consulta direta**
- `.com.br`: RDAP oficial do Registro.br (404 = livre; 200 = registrado, com status e datas; sem dados de titular).
- `.com`: RDAP da Verisign (mesma leitura). Para "Esquina" e "Balcão" o `.com` testado é o do domínio principal (`esquinaapp.com`, `balcaoapp.com`).
- App Store: API pública iTunes Search (`country=br`, `entity=software`). Google Play: página pública de busca (`hl=pt_BR`, `gl=BR`).
- Uso dos domínios registrados: GET na home (título e texto) e `dig` (NS/A). "Sem site" = sem registro A ou sem resposta HTTP.

**Indício, não prova**
- Instagram: o `curl` devolve 200 para qualquer handle. Perfil existente traz `og:type=profile` e o handle no `og:title`; inexistente traz só o título genérico (conferido com `@instagram` e um handle aleatório). "Livre (provável)" não enxerga perfil privado, suspenso ou reservado.
- WebSearch (índice dos EUA, fraco para marcas brasileiras pequenas): "nada encontrado" não prova ausência. Por isso as lojas de apps vieram das APIs; os `site:` do WebSearch foram usados só em Logali, Pertinho e Bairrin e não acrescentaram nada. Na leva 2, o WebSearch foi uma busca por nome (app, loja, empresa, marca) e a semelhança com nomes vizinhos foi avaliada à mão.

**Não feito**: INPI (sem busca aberta), CNPJ/Receita, lojas de apps de outros países, marcas sem presença na web.

## Critério de risco

- **Baixo**: `.com.br` principal livre e nenhum app nem marca homônima no segmento.
- **Médio**: domínio principal ocupado mas alternativo livre, ou homônimo fora do segmento.
- **Alto**: app, marca ou empresa de comércio/entrega com o mesmo nome, ou domínio ocupado com uso ativo.

## Resultado

| # | Nome | .com.br principal | .com.br alternativo | .com | Instagram | Google Play | App Store | Homônimos encontrados | Risco | Observações |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Logali | ocupado (reg. 2018-07-04; sem site) | livre | ocupado (reg. 1997; sem site) | livre (provável) | "Logali Workflow Manager" (dev. Logali, SAP) | nenhum | Logali Group (consultoria e treinamento SAP; ES, MX, CO, EUA, RO) | médio | Colisão provável em software (classe 42). Soa como Loggi, líder em entrega. |
| 2 | Pertinho | ocupado (reg. 2003; "Index of /") | livre | ocupado (reg. 2003) | ocupado (@pertinho.app, 76 seg.) | "Pertinho" (GGD Performance, caderneta de vacinas) | "Pertinho" (mesma empresa, Medical, lançado 2026-08-30) | "Pertinho de Casa" (Faesp/Senar-SP e Sebrae-SP, plataforma de comércio local, 2020) | alto | Mesmo nome nas duas lojas, handle exato ocupado e nome muito próximo no segmento. |
| 3 | Bairrin | livre | livre | ocupado (reg. 2026-07-27; página "Bairrin: Conecte-se com quem está perto de você") | livre (provável) | nenhum | nenhum | só bairrin.com (projeto mínimo, segmento incerto); "Bairro.App" tem outro nome | médio | Limite com baixo. Única ressalva: o `.com` com marca igual e tema de proximidade. |
| 4 | Comprali | ocupado (reg. 2026-05-18; Cloudflare 403, sem site) | livre | ocupado (reg. 2013) | livre (provável) | nenhum | nenhum | Blog pplware (PT) cita app Android "Comprali" (lista de compras por mercado, ~2013, sem listagem atual) | médio | Domínio registrado há 5 meses: terceiro pode estar montando algo. |
| 5 | Vizin | ocupado (reg. 2015; Azure Web App) | ocupado (reg. 2021; sem site) | ocupado (reg. 2022) | ocupado (@vizin.app, 34 seg.; site vizin.app: "Negócios entre vizinhos") | "Vizin" (market.vizin.app) | "Vizin Marketplace" (VIZIN APP LTDA, Shopping, 2026-06-28), Vizin 24hs, Vizin Passageiro | Vizin App Ltda: "marketplace do comércio local de Cascavel" | alto | Concorrente direto, no ar e com empresa própria. |
| 6 | Esquina | livre (esquinaapp.com.br) | ocupado (lojadaesquina; reg. 2020; sem site) | livre (esquinaapp.com) | livre (provável) | Mercado da Esquina, Esquina do Futuro, Esquinão Supermercado | Mercado da Esquina (Sysmo), Esquina Automóveis, Esquina da Pizza TP, Esquinão Supermercado | "Lá na Esquina" (marketplace de lojas físicas de BH, 2015) | médio | Nenhum app se chama só "Esquina", mas há muitos derivados no comércio. Palavra comum: fraca no INPI. |
| 7 | Darua | ocupado (reg. 2022; site ativo "Da Rua Mídia Exterior") | livre | ocupado (reg. 2008; sem site) | livre (provável) | nenhum | nenhum | Da Rua Mídia Exterior (publicidade) | alto | Alto pelo critério (domínio em uso ativo). Atenuante: outro ramo e alternativo livre; mas a classe 35 inclui publicidade. |
| 8 | Chegaí | ocupado (reg. 2019; WordPress com erro 500) | livre | ocupado (reg. 2003; sem site) | ocupado (@chegai.app, 5 seg., "isso não é um app de relacionamento") | nenhum | nenhum | App "Chegaí" (ingressos e bebidas em eventos; artigo acadêmico) e perfil homônimo | alto | Domínios testados sem acento (`chegai`). Projeto homônimo com perfil ativo. |
| 9 | Aquiperto | indisponível (RDAP "pending create", 2 tickets abertos) | livre | ocupado (reg. 2025-06-06; aponta para corretora DomainDC) | livre (provável) | nenhum igual; "Tem Aqui Perto" | "Tem Aqui Perto (BR)" (Shopping), "Aquii Tem Intermediações" | "Tem Aqui Perto" (app de comércio local, dev. individual) | médio | Parecido e no mesmo segmento, mas não igual. Principal em disputa de registro. |
| 10 | Vitrinha | ocupado (reg. 2026-10-11; site ativo de vitrine + pedidos no WhatsApp) | livre | ocupado (reg. 2026-10-13; "loja de afiliados Vitrinha") | livre (provável) | nenhum | nenhum | Dois serviços ativos chamados Vitrinha, um deles para pequenos negócios | alto | Lançado há 5 dias, no mesmo segmento. |
| 11 | Pracinha | ocupado (reg. 2023; sem site) | livre | ocupado (reg. 2011; vence 2026-12-30; redireciona a outro site) | livre (provável) | "Posto Pracinha" | "Posto Pracinha" (MAV X, Utilities) | Posto Pracinha; empresas locais "... Pracinha Ltda" (CNPJ de Pracinha-SP) | médio | Nome de município paulista e termo comum (também usado para ex-combatentes da FEB). |
| 12 | Balcão | ocupado (balcaoapp.com.br; reg. 2026-07-27; página só "BalcãoApp") | livre (balcaolocal) | livre (balcaoapp.com) | ocupado (@balcao.app, 12 seg., 6 posts) | Balcão Ligado, LC Balcão, Balcão de Milhas, Balcão Pub | Meu Balcão (2 apps), Balcão Ligado, LC Balcão, Balcão de Empregos, Balcão de Milhas | Projeto "BalcãoApp" já com domínio e handle; vários "Balcão X" | alto | Limite com médio: o conteúdo do projeto ainda é um placeholder. Nome comum e saturado. |
| 13 | Tô Perto | inativo (reg. 2021; expirou 2026-09-19; sem DNS) | livre | ocupado (reg. 2026-05-04; "TôPerto.com", marketplace local em piloto) | livre (provável) | "ToPerto Entregador" (app de entregadores) | nenhum igual (busca "Tô Perto" só trouxe apps sem relação) | TôPerto.com: restaurantes, mercados, farmácias, lojas e entregas | alto | Concorrente direto. O `.com.br` pode ser liberado nas próximas semanas, mas não vale a pena esperar. |
| 14 | Uailoja | indisponível (RDAP 200 sem status, datas nem NS; repetido na leva 2 com o mesmo resultado, `dig NS` e `dig A` vazios) | livre | livre | livre (provável) | nenhum | nenhum | nada encontrado | médio | Continua ambíguo: parece reserva ou domínio em liberação, sem titular visível. Só o registro.br esclarece. "Uai" é regionalismo mineiro. |
| 15 | Paraíso Já | livre | livre | livre | livre (provável) | nenhum | nenhum | nada encontrado (só "Paraíso" genérico, "Paraíba Já" e "Já Delivery", sem relação) | baixo | Único com `.com.br` e `.com` livres. Handle sem ".app": conferir. Conferir colisões com "PARAÍSO" no INPI. |
| 16 | Centrin | ocupado (reg. 2016-04-25; DNS Locaweb, sem site) | livre | ocupado (reg. 1997; DNS de provedor da Indonésia, sem site) | livre (provável) | nenhum (só "centrinsicnpt" e "Centrinho ATL", sem relação) | "慈云医生" (Centrin Ciyun Health, China, Medical) | Centrin Ciyun Health (saúde, China); nenhum no comércio brasileiro | médio | Principal ocupado, alternativo livre. Semelhança com "Centrinho" e "Centro" é só de som. |
| 17 | Ruali | ocupado (reg. 2025-01-06; sem site) | livre | ocupado (reg. 2013; à venda via Afternic) | livre (provável) | nenhum | nenhum | nada encontrado | médio | Domínio registrado há 9 meses por terceiro sem uso visível. |
| 18 | Pertali | livre | livre | livre | livre (provável) | nenhum | nenhum | nada encontrado; semelhante a Pertinho (app de vacinas e "Pertinho de Casa") | baixo | Tudo livre. Ressalva: parece derivado de "perto", como Pertinho; conferir semelhança no INPI. |
| 19 | Lojin | ocupado (reg. 2026-04-27; site ativo "Lojin — Ingressos", ingressos de festas de atléticas) | livre | ocupado (reg. 2000; à venda na NameSilo por US$ 850) | livre (provável) | nenhum | nenhum | Lojin Ingressos (venda online de ingressos) | alto | Alto pelo critério (domínio principal em uso ativo, comércio eletrônico). Nome curto e exposto a colisão. |
| 20 | Cidadin | livre | livre | ocupado (reg. 2024; site de produtos farmacêuticos "Cidadin", Wings Pharma, Índia) | livre (provável) | nenhum | nenhum | Cidadin (marca de remédios, Índia); "Cidadera", "Cidadania4u" são outros nomes | médio | Limite com baixo: só o `.com` tem homônimo, em outro ramo e país. Checar classe 5 e 35 no INPI. |
| 21 | Temali | ocupado (reg. 2024-06-03; sem site) | livre | ocupado (reg. 2002; sem site) | livre (provável) | "TemAli" (com.temali.app, Alex A. C. Nascimento: "produtos, serviços e ofertas perto de você") | "TemAli" (mesmo dev., Shopping, lançado 2026-10-09) | TemAli: app de anúncios e ofertas locais, mesmo segmento; "Tem Aqui Perto" (leva 1) | alto | Homônimo exato no segmento, lançado há uma semana. Foneticamente igual a "Tem Ali". |
| 22 | Achali | ocupado (reg. 2026-08-02; site ativo, diretório de negócios locais de Cuiabá-MT, com planos) | livre | livre | livre (provável) | nenhum | nenhum | Achali: "Negócios verificados perto de você" | alto | Concorrente direto, no ar. |
| 23 | Comprin | livre | livre | livre | livre (provável) | nenhum | nenhum | nada encontrado; semelhante a Comprali (app antigo) e "Compre Bem" | baixo | Tudo livre. Ressalva: radical "compr-" saturado no comércio; checar INPI classe 35. |
| 24 | Ruazin | livre | livre | livre | livre (provável) | nenhum | nenhum | nada encontrado; remete a "Da Rua" (mídia exterior, ver Darua) só pelo radical | baixo | Tudo livre, sem semelhantes próximos. |
| 25 | Pegali | livre | livre | ocupado (reg. 2014; redireciona a um blog pessoal sem relação) | livre (provável) | nenhum | nenhum | nada encontrado | baixo | `.com` sem marca ou uso homônimo. Ressalva: pode soar como "pega ali". |

Totais (25 nomes): **baixo 5**, **médio 10**, **alto 10**.
- Baixo: Paraíso Já, Pertali, Comprin, Ruazin, Pegali.
- Médio: Logali, Bairrin, Comprali, Esquina, Aquiperto, Pracinha, Uailoja, Centrin, Ruali, Cidadin.
- Alto: Pertinho, Vizin, Darua, Chegaí, Vitrinha, Balcão, Tô Perto, Lojin, Temali, Achali.

## Lista final (25 nomes)

**Risco baixo (5), do mais limpo para o menos**
1. Ruazin: os três domínios, o handle e as lojas livres; nada parecido encontrado.
2. Paraíso Já: três domínios livres e nada encontrado; o handle testado foi `@paraisoja` (sem ".app").
3. Pegali: `.com.br` livres; o `.com` só redireciona a um blog pessoal.
4. Pertali: tudo livre, mas é primo de Pertinho (conflito grave, descartado); atenção à semelhança no INPI.
5. Comprin: tudo livre, mas é primo de Comprali e o radical "compr-" é saturado.

**Médios, do menos para o mais arriscado** (usar só se o dono aceitar o ponto citado)
1. Bairrin: dois `.com.br` livres; só o `.com` tem projeto de mesmo nome (tema de proximidade).
2. Cidadin: dois `.com.br` livres; o `.com` é marca de remédios na Índia.
3. Esquina: principal livre, mas nome genérico e cercado de derivados no comércio.
4. Uailoja: sem homônimos; o `.com.br` principal segue indefinido (resposta ambígua do RDAP duas vezes).
5. Centrin, 6. Ruali (principais ocupados sem uso visível), 7. Pracinha, 8. Comprali, 9. Logali (SAP, classe 42), 10. Aquiperto (principal em disputa).

**Descartáveis (10)**
- Vizin: marketplace de comércio local no ar (app, empresa e Instagram).
- Tô Perto: TôPerto.com, marketplace local em piloto, mais app "ToPerto Entregador".
- Vitrinha: serviço de vitrine para pequenos negócios lançado em 2026-10-11, `.com.br` e `.com` tomados.
- Pertinho: app homônimo nas duas lojas, handle ocupado e "Pertinho de Casa" no mesmo segmento.
- Chegaí: projeto homônimo com perfil e app.
- Balcão: domínio e handle já tomados por "BalcãoApp"; nome saturado.
- Darua: `.com.br` em uso por empresa de mídia exterior.
- Temali: app "TemAli" (ofertas locais) nas duas lojas, lançado em 2026-10-09.
- Achali: diretório de negócios locais no ar em `achali.com.br`.
- Lojin: `lojin.com.br` em uso por venda de ingressos.

## Pendências manuais para o dono

1. **INPI** (https://busca.inpi.gov.br/pePI/): pesquisar o nome finalista nas classes 35 (comércio, intermediação) e 42 (software), incluindo variações fonéticas e de grafia. Nada disso foi feito aqui.
2. **Handles**: confirmar no próprio Instagram (logado) se o handle está de fato livre e reservá-lo logo; o resultado desta verificação é só indício.
3. **Domínio**: registrar o `.com.br` do nome escolhido (e o alternativo, se o principal falhar) no Registro.br assim que decidir. Vários nomes foram registrados por terceiros em 2026 (bairrin.com e balcaoapp.com.br em 2026-07-27, vitrinha em 2026-10-11 e 13, achali em 2026-08-02, lojin em 2026-04-27), então vale não demorar.
4. Se o finalista for Uailoja, conferir o estado de `uailoja.com.br` em registro.br; se for Tô Perto, o `.com.br` vencido pode voltar a ficar livre, mas o conflito de marca continua.
5. Busca manual rápida nas lojas (Play e App Store) e no Google pelo nome escolhido antes de decidir, porque o WebSearch usado aqui tem índice dos EUA.
