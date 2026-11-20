# 0025 — Coleta incremental por marca d'água e limites de uso das APIs

- Status: aceito
- Data: 2026-11-20
- Relacionados: 0003 (backfill), 0016-0021 (modelagem e gravação), 0011 (descarte de credencial), 0014 (Lead Ads)

## Contexto

A rotina de 6 em 6 horas coletava uma **amostra**: 7 dias para trás, com
`LIMIT 500` no Google Ads e `limit`/`rowLimit` 500 no GA4 e no Search Console.
Recortes de volume alto (termos de pesquisa, páginas, consultas) ficavam
truncados todo dia, e o histórico só chegava pelo backfill manual. As quatro
rodadas do dia repetiam a mesma janela e as mesmas consultas de entidades.

A auditoria da documentação oficial (20/11/2026) achou também:

- A Graph/Marketing API serve `v26.0` para quem pede `v23.0`, `v24.0` ou
  `v25.0` (conferido com chamada real); `v27.0` já existe.
- Nenhum coletor lia os cabeçalhos de uso nem tratava 429 como "tente mais
  tarde": todo limite virava falha fatal `api_recusou`.
- GTM tem limite de 0,25 QPS por projeto (25 por 100 s, 10 mil por dia).
- A Meta omite `reach` em recortes (breakdowns) com início há mais de 13 meses, e
  o coletor gravava 0.
- No Google Ads, uma GAQL não essencial recusada zerava as outras 10.
- No YouTube, `estimatedRevenue` na consulta essencial fazia um canal sem
  monetização (403) cair em `reauth_pending` e perder tudo.

## Decisão

### Modo `incremental` e marca d'água

- Novo modo `incremental` (contrato `fontes`/`abrir` e enum
  `automation.collection_mode`, migração 0050). O orquestrador usa só ele.
  `completa` continua sendo o modo do backfill. `amostra` fica no enum e no
  contrato apenas por compatibilidade com o orquestrador antigo durante o
  rollout e com as linhas históricas; nenhum fluxo novo usa.
- **Marca d'água por fonte**, derivada só de `automation.coletas` pela função
  `automation.historico_de_coleta()` (sem tabela nova): `max(window_end)` das
  coletas `success` de qualquer modo. `last_sync_at` não entra: ele marca
  quando rodou, não até onde os dados estão completos.
- **Parcial não avança.** Uma coleta `partial` não sabe dizer qual dia ficou
  incompleto, então não move a marca. Para uma falha permanente de recorte
  opcional não travar a fonte para sempre, a janela parcial repetida **3 vezes**
  (mesmo `window_end`) passa a valer como marca. O detalhe da incompletude
  segue em `qc_execucoes`.
- **Janela** (`planejarColetaIncremental`, `janelaIncremental.ts`, função pura e
  testada), no dia de `America/Sao_Paulo`:
  - alvo = hoje − `atrasoDias` (1 = ontem; Search Console e GBP = 3);
  - sem marca: os últimos `janelaInicialDias` (7; Lead Ads 28) até o alvo. O
    histórico fica para o backfill;
  - com marca: de `min(marca, alvo) − lookbackDias + 1` até o alvo, com teto de
    **28 dias**. Se a lacuna for maior, cada rodada preenche uma janela, a mais
    antiga primeiro, e a seguinte começa onde a anterior terminou menos o
    lookback. Retoma sozinha depois de falha;
  - nunca antes de `historicoMaximoDias` (pixel 28, Search Console 480, GBP 540,
    demais 1095).
- **Lookback** (dias relidos para pegar reprocessamento), como dado no mapa:
  Meta 7 (atribuição), Google Ads 7 (conversões tardias), GA4, Search Console,
  YouTube, GBP, pixel e Lead Ads 3.
- **Cadência**: o agendamento continua de 6 em 6 horas, em série. O `fontes`
  só devolve a fonte que não está em dia. Em dia quer dizer: a marca chegou ao
  alvo **e** já houve uma incremental concluída hoje. Com isso, numa fonte
  saudável a primeira rodada do dia faz a coleta e as outras três viram
  retentativa de falha e preenchimento de lacuna. A ordem é a fonte mais
  atrasada primeiro, até `limit`.
- **Dimensões no máximo uma vez por dia**: o `fontes` devolve `comDimensoes`
  = não houve incremental concluída hoje. Os coletores que buscam entidades
  pulam essas consultas quando `comDimensoes === false`: Meta Insights
  (campanhas, conjuntos e anúncios), Google Ads (5 GAQL `dim_*`), YouTube
  (`videos`, `playlists`) e GBP (`local` e palavras-chave mensais). GTM, RD e
  formulários são snapshots e já rodam uma vez por dia pela regra de "em dia".
  Backfill e chamadas sem o campo continuam com dimensões.
- **Chave de idempotência** da rotina:
  `fonteId:start:end:incremental:<execution id>`. Cada rodada abre a sua
  coleta, o que bate com o PR #109: coleta fechada não é reaproveitada.
- **Snapshots**: RD e GTM continuam com um snapshot por dia, janela
  `[ontem, ontem]`. A API CRM v1 de negociações (`GET /deals`) **não filtra por
  `updated_at`**: só `created_at_period`, `closed_at_period` e
  `prediction_date_period` (docs `crm-v1-list-deals`, conferido em 20/11). Além
  disso, `fato_rd_negociacoes` é o estado diário de todas as negociações. Por
  isso o RD fica em snapshot diário. Lead Ads passa a ler os leads a partir do
  início da janela incremental, com a regra de meia-noite de
  `America/Sao_Paulo`. O snapshot dos formulários continua diário.

### Sem teto de linhas na rotina

`LIMIT 500` (Google Ads) e `limit`/`rowLimit` 500 (GA4, Search Console) saem,
junto com os ramos `modo === 'amostra'`. O Google Ads usa `searchStream`, que
devolve tudo numa operação. GA4 (100 mil por página) e Search Console (25 mil
por página) paginam até o teto de requisições e declaram `coleta_incompleta`
quando param antes do total.

### Limites de uso (`limite_de_uso`)

Nova causa `limite_de_uso` (`CausaFaltante` e enum do contrato). Uma coleta que
bate no limite fecha como `failed` com essa causa e **não avança a marca
d'água**. A rodada continua para as outras fontes, e a próxima rodada de 6h
tenta de novo. As linhas já lidas são gravadas, e o `MERGE` torna isso
idempotente.

- **Google** (Ads, GA4, Search Console, YouTube, GBP, GTM): 429,
  `RESOURCE_EXHAUSTED`, `rateLimitExceeded`, `quotaExceeded` e similares. API
  desligada no projeto (`SERVICE_DISABLED`, `accessNotConfigured`) continua
  `api_recusou`. Quando o sinal é de **cota diária** (`dailyLimitExceeded`,
  `quotaExceeded`, "per day", "Number of operations" do Ads Basic), o detalhe
  começa com `cota_diaria:`, e o `fontes` pausa a fonte até virar o dia em
  `America/Los_Angeles`, quando as cotas do Google renovam. Assim nada é
  retentado no mesmo dia: chamadas recusadas também consomem operações.
- **GA4**: `returnPropertyQuota: true`. A paginação para quando
  `tokensPerProjectPerHour` passa de 80%, e o recorte fica `coleta_incompleta`
  (não avança). O uso vai como aviso.
- **Meta**: 429 e códigos 4, 17, 32, 341, 613 e 80000-80014. O coletor lê
  `X-Business-Use-Case-Usage`, `X-FB-Ads-Insights-Throttle` e `X-App-Usage`.
  Com uso acima de 75%, o `Esperar` do laço de relatórios assíncronos espera
  `estimated_time_to_regain_access` (de 60 a 300 s) em vez de 20 s, e o uso vai
  como aviso.
- **RD**: 429 ou `RATE_LIMIT_EXCEDDED` (grafia da documentação), com limite de
  120 requisições por minuto. Os nós já espaçam 600 ms.
- **GTM**: todo nó HTTP tem `batching` com 1 item a cada 4,5 s.
- **Retentativa nativa do n8n** (`retryOnFail`, 2 tentativas, 5 s) só nos nós
  de requisição única (contas do GTM, token da Página, funis do RD; a consulta
  de relatório da Meta já tinha). Com `neverError` ela só dispara em falha de
  rede. Em nós de vários itens ela repetiria todos os itens e gastaria cota em
  dobro, então lá a falha de rede fecha a coleta e a rodada seguinte retenta.

### Avisos de qualidade

`qualidadeResumo.avisos` (até 50, opcional) guarda informação que não muda o
status da coleta: `versao_da_api` (`facebook-api-version` diferente da pedida,
`X-Ad-Api-Version-Warning`), `uso_de_cota`, `limiar_de_privacidade` (GA4
`subjectToThresholding`), `linhas_agrupadas` (GA4 `dataLossFromOtherRow`),
`alcance_omitido` e `receita_indisponivel`. Os avisos vão para `qc_execucoes`
no JSON do resumo, sem coluna nova.

### Correções da auditoria

- **Versão da Meta fixada em `v26.0`**: `metaGraphVersion.ts` no TypeScript
  (OAuth, descoberta) e uma constante `VERSAO_DA_API_META` no primeiro nó Code
  de cada coletor e do executor do parceiro. As URLs dos nós HTTP dos
  formulários leem `versaoApi` desse nó. **Plano para `v27.0`**: trocar as duas
  constantes, rodar uma coleta manual de cada coletor Meta, conferir que o
  aviso `versao_da_api` some e que `qc_execucoes` não mostra campo removido.
  Fazer isso antes de a Meta descontinuar a `v26.0`. Os fluxos de cliente
  `clientes/credaz/*` ainda pedem `v23.0` (servida como `v26.0`) e ficam para o
  dono desses fluxos.
- **Alcance**: nos recortes com início há mais de 13 meses o coletor não pede
  `reach`. `alcance` sai nulo quando a API não devolve o campo, inclusive no
  nível de anúncio. As colunas `alcance` de `20_meta_ads.sql` já aceitam NULL, e
  `converterColuna` preserva o nulo.
- **Google Ads**: só `fato_google_campanha_diario` é obrigatória. As outras,
  quando recusadas, viram `coleta_incompleta` com `<tabela>: <motivo>`, e o
  resto é gravado. Limite de uso em qualquer consulta é fatal: não adianta
  seguir. **Backfill**: Google, Meta, GA4 e YouTube com 36 meses mais 7 dias de
  margem, para a janela mais antiga não bater no limite de 37 meses e falhar
  inteira. GBP passa a ter atraso de 3 dias, como na rotina.
- **YouTube**: `estimatedRevenue` sai da consulta essencial `canal_dia` e vai
  para a consulta opcional `receita`. Com 401/403 nela (canal sem monetização),
  a receita fica nula e o coletor emite o aviso `receita_indisponivel`, sem
  marcar incompleto. Atenção: `tabelas/youtube.ts` converte nulo em 0. Gravar
  nulo pede mudança no dono do BQ.
- **Search Console**: o mapa dizia `dataState=all`, mas o coletor usa
  `final`. O mapa foi corrigido.
- **OAuth com o mínimo de permissão**: `meta` deixa de pedir `ads_management`
  (o pedido de parceiro `POST /{bm}/client_ad_accounts` usa
  `business_management`, que continua). Em `leadads`, `ads_management` vira
  `ads_read`, e `pages_*` e `leads_retrieval` continuam. Na Meta, com
  `config_id`, o conjunto real vem da **configuração do Login for Business no
  painel do app** ("Orla - Conexoes" e "Orla - Lead Ads"). Ela precisa ser
  atualizada no painel, o código não muda isso. A documentação de Lead Ads
  ainda lista `ads_management` para ler leads (ADR 0014). Antes de tirá-lo da
  configuração "Orla - Lead Ads", conecte uma Página de teste e confira
  `Token da Página` e `/leads`.

### Política do YouTube (dados de API)

- Títulos de vídeos e playlists (`dim_video`, `dim_playlist`) são relidos na
  primeira incremental de cada dia (`comDimensoes`), o que atende à exigência
  de atualizar ou apagar em até 30 dias. Um canal desconectado para de ser
  coletado, então o seu dado fica velho.
- **Pendente**: um expurgo que apague `dim_video`/`dim_playlist` do canal sem
  coleta há mais de 30 dias e, na revogação, os dados derivados da API em até
  7 dias. Ele entra no expurgo do BQ (`titular.mjs`/retenção, dono do PR #109),
  disparado por `removerConexao` de `youtube`.

### Revogação ao remover conexão (pendente)

O cofre é o n8n, e a API pública dele não devolve o segredo de uma credencial:
o servidor guarda só a referência. Hoje não há como obter o refresh token no
caminho de descarte sem um novo fluxo no n8n. O desenho fica assim: um workflow
"revogar credencial", chamado por `removerConexao` antes do `DELETE`, usa a
própria credencial. Para o Google é `POST https://oauth2.googleapis.com/revoke`
com o token. Para a Meta é `DELETE /me/permissions`. Ele devolve só o status,
sem logar o token. A semântica de falha do ADR 0011 continua: falha na
revogação não impede o descarte e vira aviso de auditoria.

## Custo diário por plataforma (rotina)

Conta por fonte em dia (uma incremental por dia mais as retentativas). Para uma
fonte com lacuna, multiplique as consultas de fato por até 4 (uma janela por
rodada).

| Plataforma | Chamadas por dia por fonte | Cota de referência |
|---|---|---|
| Google Ads | 11 GAQL de fato + 5 de entidade = **16 operações** (antes 4 × 16 = 64). Pior caso sem estar em dia: 16 + 3 × 11 = 49 | 15.000 operações/dia (Basic) por developer token: cerca de 930 contas em dia, ou 300 no pior caso |
| Meta Insights | 4 criações + 4 por consulta (3-10 consultas) + downloads + 3 listas = ~25-60 | pontuação de BUC por conta, sem cota diária fixa; pausa acima de 75% |
| Meta pixel | 10 | idem |
| Lead Ads | 2 + formulários × páginas | idem |
| GA4 | 8 `runReport` (mais páginas): ~80-200 tokens | 200.000 tokens/dia e 40.000/h por propriedade; 14.000/h por projeto e propriedade |
| Search Console | 4 consultas + 1 por dia do lookback (3) = ~7 | 1.200 QPM por site, 30 M/dia por projeto |
| YouTube | 6 + 2 × 3 dias + até 25 `video_dia` + 2 da Data API = ~39; 2 unidades da Data API | Data API 10.000 unidades/dia |
| GBP | 1 diária + 3 palavras-chave + 1 local = 5 | 300 QPM |
| GTM | 3 + número de contas | 10.000/dia e 0,25 QPS por projeto |
| RD | ~10-70 (funis × páginas + 5 catálogos) | 120/min |

## Consequências

- Histórico novo deixa de depender do backfill manual a partir do primeiro
  sucesso. Uma fonte nova recebe 7 dias, e o backfill cobre o resto.
- O custo do Google Ads cai cerca de 4 vezes. Truncamento silencioso deixa de
  existir: ou a coleta é completa, ou fica marcada.
- Três parciais seguidas na mesma janela avançam a marca. O dia faltante fica
  em `qc_execucoes` e se recupera com backfill pontual (`janelas` explícitas).
- Rollout: migração 0050, deploy do app, depois sincronizar no n8n o
  orquestrador, o backfill e os coletores. O app aceita `amostra` e
  `incremental` durante a troca.
