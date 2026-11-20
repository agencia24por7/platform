# BigQuery — catálogo das tabelas (`tria_dw`)

Documento canônico de **todas** as tabelas, views e convenções do BigQuery.
Toda mudança no BigQuery (tabela, coluna, view, partição, chave, manifesto)
atualiza este arquivo no mesmo PR. Decisões de fundo: ADR
[0003](../../docs/adr/0003-backfill-e-gravacao-no-bigquery.md),
[0013](../../docs/adr/0013-dimensoes-scd2.md) e
[0015](../../docs/adr/0015-modelagem-escalavel-do-bq.md).

## Sumário

- [Convenções](#convenções)
- [Como adicionar uma tabela](#como-adicionar-uma-tabela)
- [Numeração dos arquivos de DDL](#numeração-dos-arquivos-de-ddl)
- [Meta Ads](#meta-ads)
- [Google Ads](#google-ads)
- [GA4](#ga4)
- [Search Console](#search-console)
- [YouTube](#youtube)
- [Google Business Profile](#google-business-profile)
- [RD Station](#rd-station)
- [Meta Pixel e Lead Ads](#meta-pixel-e-lead-ads)
- [Google Tag Manager](#google-tag-manager)
- [Transversais](#transversais)

## Convenções

### Nomes

| Prefixo | O que é | Escrita |
|---|---|---|
| `fato_` | Fato: métrica ou snapshot numa granularidade declarada | MERGE a partir da staging (`tipo: 'fato'`) |
| `dim_` | Dimensão. Entidade versionada leva sufixo `_scd2` | `tipo: 'scd2'` ou carga própria (`dim_fonte_scd2`, `dim_cliente_scd2`) |
| `stg_` | Staging de uma execução, efêmera | INSERT do gravador, uma por tabela de destino |
| `vw_` | View de consumo: dedupe + dono via `dim_fonte_scd2` | `CREATE OR REPLACE VIEW` no DDL |
| `gov_` | Governança (inventário, paridade) | `tipo: 'snapshot'` (append) ou carga própria |
| `qc_` | Qualidade das execuções | `registrarQc` do gravador |

Identificadores em português no padrão do código ao redor (`data_dia`,
`inserido_em`); ids da plataforma podem manter o nome original
(`ad_account_id`, `property_id`). `HASH` é palavra reservada: a coluna de hash
de versão é sempre `hash_versao`.

### Granularidade

Toda tabela declara a granularidade nesta página ("uma linha por ..."), e ela
é exatamente a `chave` do MERGE em `tabelas/<plataforma>.ts` e o `PARTITION
BY` do `QUALIFY` da view. Sem granularidade declarada a tabela não entra.

### Dono (cliente)

- Fato **não tem `client_id`**. Tem `organization_id` + a chave da fonte
  (`ad_account_id`, `property_id`, `site`, ...), que é o `externalId` do
  `ContextoGravacao`.
- O dono vem de `dim_fonte_scd2` (`organization_id`, `platform`,
  `external_id`) na view `vw_*`: `cliente_na_epoca_*` (versão válida às 00:00
  America/Sao_Paulo do dia do fato) e `cliente_atual_*` (versão aberta). Molde:
  `05_dimensoes_scd2.sql` e `06_meta_dataset_formularios.sql`.
- Toda tabela com chave de fonte entra no manifesto de exclusão
  (`manifesto/<plataforma>.json`).

### Partição e cluster

- Fato diário: `PARTITION BY data_dia` (ou `data_snapshot`), `CLUSTER BY
  organization_id, <chave da fonte>[, <dimensão mais filtrada>]`.
- Staging: `PARTITION BY DATE(inserido_em)`, `CLUSTER BY execucao_id`,
  `OPTIONS (partition_expiration_days = 7)`; colunas iguais às do destino,
  com `execucao_id` e `inserido_em` `NOT NULL`.
- Dimensão SCD2: sem partição; `CLUSTER BY organization_id, <chave>`.
- `gov_`/`qc_`: `PARTITION BY DATE(<momento>)`.

### Colunas de controle

- Fato: `execucao_id STRING`, `inserido_em TIMESTAMP NOT NULL` (dedupe pega o
  `inserido_em` mais recente).
- Dimensão SCD2 genérica (`tipo: 'scd2'`): colunas da chave e dos atributos,
  mais `valido_de TIMESTAMP NOT NULL`, `valido_ate TIMESTAMP NOT NULL`
  (`9999-12-31` na versão aberta), `atual BOOL NOT NULL`, `hash_versao STRING
  NOT NULL` (`TO_HEX(SHA256(TO_JSON_STRING(STRUCT(<atributos>))))`),
  `execucao_id STRING`, `carregado_em TIMESTAMP NOT NULL`. Intervalo
  semiaberto `[valido_de, valido_ate)`; a primeira versão de cada chave vale
  desde `1970-01-01`. A staging dela tem chave + atributos + `execucao_id` +
  `inserido_em`.

### Saída do coletor

Cada linha de `linhas` pode trazer `_tabela: '<nome lógico>'`; sem ela, vai
para `padrao`. O gravador agrupa por `_tabela`, remove o campo, aplica a
configuração daquela tabela e devolve a soma das linhas gravadas (o
orquestrador compara com o total enviado). `_tabela` sem configuração falha a
gravação inteira (`tabela_desconhecida:<nome>`).

## Como adicionar uma tabela

1. **DDL** em `scripts/bq/2X_<plataforma>.sql` (ver numeração): tabela de
   destino, staging e, se tiver chave de fonte, a view `vw_*` no molde de
   `06_meta_dataset_formularios.sql`. Sempre `CREATE TABLE IF NOT EXISTS` /
   `CREATE OR REPLACE VIEW` com `{{DATASET}}`. `node scripts/bq-ddl.mjs`
   aplica todos os `*.sql` desta pasta em ordem de nome.
2. **Configuração** em `src/modules/coleta/infrastructure/tabelas/<plataforma>.ts`:
   uma entrada nova no `Record<string, ConfiguracaoTabela>` da plataforma (o
   nome da chave é o valor de `_tabela`). Não mexa no gravador nem em
   `tabelas/index.ts`.
3. **Coletor** (`n8n/workflows/coletores/<plataforma>.json`): marque as linhas
   com `_tabela`.
4. **Manifesto** em `scripts/bq/manifesto/<plataforma>.json` (exclusão de
   cliente, `scripts/titular.mjs`).
5. **Esta página**: seção da plataforma, com granularidade.
6. **ADR** quando houver decisão de modelagem (granularidade, semântica).

### Manifesto de exclusão

Cada entrada: `{ "tabela", "chave", "plataforma", "colunaPlataforma"?, e
exatamente um de "data" | "momento" | "todoPeriodo": true }`.

- `chave`: coluna do fato com o `external_id` da fonte.
- `plataforma`: valor de `dim_fonte_scd2.platform`.
- `colunaPlataforma`: em tabela compartilhada por plataformas
  (`fato_ads_diario`, `gov_snapshot_fontes`), restringe também
  `f.<coluna> = plataforma`.
- `data` (coluna `DATE`, vira 00:00 America/Sao_Paulo) ou `momento` (coluna
  `TIMESTAMP`): apaga só as linhas do período em que a fonte foi do cliente.
- `todoPeriodo: true`: para dimensões de entidade sem data de fato. Apaga
  todas as linhas da fonte se ela foi do cliente e **nunca** de outro cliente;
  fonte que mudou de dono fica (ver ADR 0015).

## Numeração dos arquivos de DDL

| Faixa | Dono |
|---|---|
| `01`–`06` | Base existente (fatos, staging, governança, dimensões, Meta dataset/formulários) |
| `20` | Meta Ads |
| `21` | Google Ads |
| `22` | GA4 |
| `23` | Search Console |
| `24` | YouTube |
| `25` | Google Business Profile |
| `26` | RD Station |
| `27` | Meta Pixel e Lead Ads |
| `28` | Google Tag Manager |

Precisa de mais de um arquivo? Use sufixo (`20_meta.sql`, `20b_meta_criativos.sql`).

## Meta Ads

Configuração: `tabelas/meta.ts`. Manifesto: `manifesto/meta.json`. DDL: `20_meta*.sql`.

### `fato_ads_diario` (compartilhada com Google Ads)

- Granularidade: uma linha por `organization_id`, `ad_account_id`,
  `external_campaign_id`, `data_dia` (`platform = 'meta'`).
- Colunas: `platform`, `campaign_name`, `investimento`, `impressoes`,
  `cliques`, `conversoes`, `receita`, `moeda`, `versao_api`, `execucao_id`,
  `inserido_em`.
- Partição `data_dia`; cluster `organization_id, ad_account_id`.
- Staging `stg_ads_diario`; view `vw_ads_diario` (dono por `f.platform`).
- DDL: `01_fatos.sql`, `02_staging.sql`, `05_dimensoes_scd2.sql`.
- Origem (Meta): agregada na coleta a partir dos anúncios (soma de gasto,
  impressões, cliques e compras por campanha e dia), sem chamada própria à API.

Configuração das novas tabelas: `tabelas/meta.ts` (uma entrada por `_tabela`;
esquema em `domain/esquemasMeta.ts`). DDL: `20_meta_ads.sql`. ADR
[0016](../../docs/adr/0016-meta-ads-modelagem.md). Todas as tabelas abaixo são
do `ad_account_id` (o `externalId`), com dono pela `dim_fonte_scd2`
(`platform = 'meta'`) nas views `vw_*`: `cliente_na_epoca_*` e
`cliente_atual_*`. Nas dimensões a "época" é o início da versão (`valido_de`).

Origem na API (Marketing API v23.0): relatórios assíncronos
`POST /{act}/insights` + `GET /{report_run_id}/insights` (insights) e `GET
/{act}/campaigns|adsets|ads` (dimensões), paginados. Janelas de 28 dias do
backfill. Valores monetários com a moeda da conta em `moeda`.

### `fato_meta_entrega_diaria`

- Granularidade: uma linha por `organization_id`, `ad_account_id`, `ad_id`,
  `data_dia`.
- Colunas: `campaign_id`, `adset_id`, `investimento`, `impressoes`, `alcance`,
  `frequencia`, `cliques`, `cliques_link`, `cliques_unicos`,
  `cliques_link_unicos`, `cliques_saida`, `engajamento_post`,
  `video_reproducoes`, `video_30s`, `video_p25`, `video_p50`, `video_p75`,
  `video_p95`, `video_p100`, `video_thruplay`, `video_tempo_medio` (segundos),
  `ranking_qualidade`, `ranking_engajamento`, `ranking_conversao`, `moeda`,
  `versao_api`, `execucao_id`, `inserido_em`.
- Partição `data_dia`; cluster `organization_id, ad_account_id, campaign_id`.
- Origem: insights `level=ad`, `time_increment=1`. `alcance` e `frequencia` não
  são aditivos entre dias nem entre anúncios.
- Staging `stg_meta_entrega_diaria`; view `vw_meta_entrega_diaria`.

### `fato_meta_acoes_diarias`

- Granularidade: uma linha por `organization_id`, `ad_account_id`, `ad_id`,
  `data_dia`, `tipo_acao`, `origem_metrica` (formato longo).
- Colunas: `campaign_id`, `adset_id`, `quantidade`, `valor`, `custo_por_acao`,
  `janela_atribuicao` (`unificada`: a janela de cada conjunto, ver
  `dim_meta_conjunto_scd2`), `moeda`, `versao_api`, `execucao_id`,
  `inserido_em`.
- `tipo_acao`: `lead`, `purchase`, `landing_page_view`,
  `onsite_conversion.*`, `offsite_conversion.fb_pixel_*`, conversões
  personalizadas etc. `origem_metrica`: `acoes` (`actions`, `action_values`,
  `cost_per_action_type`) ou `conversoes` (`conversions`, `conversion_values`,
  `cost_per_conversion`). Uma ação conta nas duas origens: não somar origens.
- Partição `data_dia`; cluster `organization_id, ad_account_id, campaign_id,
  tipo_acao`.
- Staging `stg_meta_acoes_diarias`; view `vw_meta_acoes_diarias`.

### `fato_meta_recorte_idade_genero`

- Granularidade: uma linha por `organization_id`, `ad_account_id`, `adset_id`,
  `data_dia`, `idade`, `genero` (breakdown `age,gender`, nível conjunto).
- Colunas: `campaign_id`, `investimento`, `impressoes`, `alcance`, `cliques`,
  `cliques_link`, `leads`, `compras`, `receita_compras`, `conversas_iniciadas`,
  `visualizacoes_pagina`, `moeda`, `versao_api`, `execucao_id`, `inserido_em`.
  Mesmas métricas dos três recortes; `leads` = ação `lead`, `compras` =
  `purchase` (ou `offsite_conversion.fb_pixel_purchase`), `conversas_iniciadas`
  = `onsite_conversion.messaging_conversation_started_7d`.
- Partição `data_dia`; cluster `organization_id, ad_account_id, campaign_id`.
- Staging `stg_meta_recorte_idade_genero`; view `vw_meta_recorte_idade_genero`.

### `fato_meta_recorte_posicionamento`

- Granularidade: uma linha por `organization_id`, `ad_account_id`, `adset_id`,
  `data_dia`, `plataforma_publicacao`, `posicao_plataforma` (breakdown
  `publisher_platform,platform_position`, nível conjunto).
- Colunas: as do recorte de idade e gênero, com os dois campos de recorte.
- Partição `data_dia`; cluster `organization_id, ad_account_id, campaign_id`.
- Staging `stg_meta_recorte_posicionamento`; view
  `vw_meta_recorte_posicionamento`.

### `fato_meta_recorte_regiao`

- Granularidade: uma linha por `organization_id`, `ad_account_id`, `adset_id`,
  `data_dia`, `regiao` (breakdown `region`, nível conjunto).
- Colunas: as do recorte de idade e gênero, com `regiao`.
- Partição `data_dia`; cluster `organization_id, ad_account_id, campaign_id`.
- Staging `stg_meta_recorte_regiao`; view `vw_meta_recorte_regiao`.

### `dim_meta_campanha_scd2`

- Granularidade: uma versão por `organization_id`, `ad_account_id`,
  `campaign_id` e intervalo `[valido_de, valido_ate)`.
- Atributos: `nome`, `objetivo`, `status`, `status_efetivo`, `tipo_compra`,
  `estrategia_lance`, `orcamento_diario`, `orcamento_vitalicio`,
  `limite_gasto`, `categorias_especiais`, `inicio`, `fim`, `criada_em`.
  Mais as colunas SCD2 de controle (ADR 0013).
- Origem: `GET /{act}/campaigns` (`objective`, `effective_status`,
  `buying_type`, `bid_strategy`, `daily_budget`, `lifetime_budget`,
  `spend_cap`, `special_ad_categories`, `start_time`, `stop_time`,
  `created_time`). Orçamentos divididos por 100; zero vira nulo.
- Cluster `organization_id, ad_account_id, campaign_id`. Staging
  `stg_meta_dim_campanha`; view `vw_meta_campanha`.

### `dim_meta_conjunto_scd2`

- Granularidade: uma versão por `organization_id`, `ad_account_id`, `adset_id`
  e intervalo.
- Atributos: `campaign_id`, `nome`, `status`, `status_efetivo`,
  `objetivo_otimizacao`, `evento_cobranca`, `estrategia_lance`, `valor_lance`,
  `orcamento_diario`, `orcamento_vitalicio`, `tipo_destino`,
  `evento_conversao`, `janela_atribuicao` (`CLICK_THROUGH:7,VIEW_THROUGH:1`),
  `inicio`, `fim`, `criado_em`.
- Origem: `GET /{act}/adsets` (`optimization_goal`, `billing_event`,
  `bid_amount`, `destination_type`, `attribution_spec`,
  `promoted_object.custom_event_type`, ...).
- Cluster `organization_id, ad_account_id, adset_id`. Staging
  `stg_meta_dim_conjunto`; view `vw_meta_conjunto`.

### `dim_meta_anuncio_scd2`

- Granularidade: uma versão por `organization_id`, `ad_account_id`, `ad_id` e
  intervalo.
- Atributos: `campaign_id`, `adset_id`, `nome`, `status`, `status_efetivo`,
  `creative_id`, `criado_em`.
- Origem: `GET /{act}/ads` (`creative{id}`, `effective_status`, ...).
- Cluster `organization_id, ad_account_id, ad_id`. Staging
  `stg_meta_dim_anuncio`; view `vw_meta_anuncio`.

### Coleta e cotas

O coletor cria quatro relatórios assíncronos (anúncio, idade × gênero,
posicionamento, região), consulta a cada 20 s (até 30 vezes) e baixa páginas de
500 linhas. Chamadas por fonte e janela: 4 criações, até 120 consultas, 3 listas
paginadas (200 por página) e os downloads. Limite de uso da Meta
(códigos 4, 17, 32, 613, 80000-80014) vira `api_recusou`; autorização
(401/403/190) vira `reauth_pending`.

<!-- Meta Ads: novas tabelas acima desta linha -->

## Google Ads

Configuração: `tabelas/google.ts`. Manifesto: `manifesto/google.json`. DDL: `21_google*.sql`.

### `fato_ads_diario` (compartilhada com Meta Ads)

Mesma tabela da seção Meta Ads, com `platform = 'google'`.

Modelagem e cota: ADR [0016](../../docs/adr/0016-google-ads-modelagem.md). Origem: Google Ads API
`v26`, GAQL `googleAds:searchStream`, uma consulta por tabela. Todas as colunas
de DDL são geradas da especificação em `tabelas/googleEspecificacao.ts` e
conferidas por `googleEspecificacao.test.ts`. Valor monetário = `cost_micros` ÷
1.000.000, na `moeda` da linha. Toda tabela tem `organization_id` e
`ad_account_id` (`externalId`), `execucao_id`, `inserido_em`; fatos têm
`PARTITION BY data_dia` e `CLUSTER BY organization_id, ad_account_id,
external_campaign_id`; staging `stg_google_*` (7 dias) com as mesmas colunas.
Cada fato tem a view `vw_google_*_diario` (nome do fato com `vw_` no lugar de
`fato_`), com dedupe pela chave e `cliente_na_epoca_*`/`cliente_atual_*` via
`dim_fonte_scd2` (`platform = 'google'`). Dimensões têm a view
`vw_dim_google_*` (todas as versões + `cliente_atual_*`).

Colunas de métrica (fatos, exceto onde dito): `investimento`
(`metrics.cost_micros`), `impressoes`, `cliques`, `conversoes`, `receita`
(`conversions_value`), `todas_conversoes` (`all_conversions`),
`todas_conversoes_receita` (`all_conversions_value`), `interacoes`,
`visualizacoes_video` (`video_views`).

### Fatos (DDL: `21_google_ads.sql`)

| Tabela | Grão (= chave do MERGE) | Origem (`FROM`) e colunas próprias |
|---|---|---|
| `fato_google_campanha_diario` | `organization_id, ad_account_id, external_campaign_id, data_dia` | `campaign`; mais `parcela_impressoes_pesquisa`, `perdida_orcamento`, `perdida_ranking`, `parcela_topo`, `parcela_topo_absoluto` (`search_*_impression_share`; nulas fora de Pesquisa) |
| `fato_google_anuncio_diario` | `..., external_campaign_id, ad_group_id, ad_id, data_dia` | `ad_group_ad` |
| `fato_google_palavra_chave_diario` | `..., external_campaign_id, ad_group_id, criterion_id, data_dia` | `keyword_view` |
| `fato_google_termo_pesquisa_diario` | `..., external_campaign_id, ad_group_id, termo, data_dia` | `search_term_view`; `status_termo`; termo truncado em 500 |
| `fato_google_conversao_diario` | `..., external_campaign_id, conversion_action_id, data_dia` | `campaign` + `segments.conversion_action`; só as 4 métricas de conversão; `acao_nome`, `acao_categoria` |
| `fato_google_dispositivo_diario` | `..., external_campaign_id, dispositivo, data_dia` | `campaign` + `segments.device` |
| `fato_google_rede_diario` | `..., external_campaign_id, rede, data_dia` | `campaign` + `segments.ad_network_type` |
| `fato_google_geo_diario` | `..., external_campaign_id, pais_criterio_id, tipo_localizacao, data_dia` | `geographic_view` (país; `location_type`) |
| `fato_google_idade_diario` | `..., external_campaign_id, ad_group_id, faixa_etaria, data_dia` | `age_range_view` |
| `fato_google_genero_diario` | `..., external_campaign_id, ad_group_id, genero, data_dia` | `gender_view` |
| `fato_google_grupo_ativos_diario` | `..., external_campaign_id, asset_group_id, data_dia` | `asset_group` (Performance Max); sem `visualizacoes_video` |

Fatos de entidade (anúncio, palavra-chave, termo, recortes, grupo de ativos)
só trazem linhas com `metrics.impressions > 0`; campanha traz todas.

### Dimensões SCD2

Chave = `organization_id, ad_account_id` + id da entidade; manifesto
`todoPeriodo`. Buscadas só na janela mais recente (ADR 0016). Cluster pela
chave; sem partição.

| Tabela | Chave da entidade | Atributos (hash da versão) |
|---|---|---|
| `dim_google_campanha_scd2` | `external_campaign_id` | `nome`, `status`, `canal` (`advertising_channel_type`), `subcanal`, `estrategia_lance` (`bidding_strategy_type`), `orcamento` (`campaign_budget.amount_micros`), `orcamento_compartilhado` |
| `dim_google_grupo_anuncios_scd2` | `ad_group_id` | `external_campaign_id`, `nome`, `status`, `tipo` |
| `dim_google_anuncio_scd2` | `ad_id` | `ad_group_id`, `external_campaign_id`, `nome`, `tipo`, `status`, `aprovacao` (`policy_summary.approval_status`) |
| `dim_google_palavra_chave_scd2` | `ad_group_id, criterion_id` | `external_campaign_id`, `texto`, `correspondencia`, `status`, `negativa`, `nota_qualidade` |
| `dim_google_grupo_ativos_scd2` | `asset_group_id` | `external_campaign_id`, `nome`, `status` |

Staging das dimensões: `stg_google_campanha`, `stg_google_grupo_anuncios`,
`stg_google_anuncio`, `stg_google_palavra_chave`, `stg_google_grupo_ativos`.

### Cota e volume (nível Básico, 15.000 operações/dia)

Por conta: 11 consultas por janela de 28 dias (+5 de entidade na janela mais
recente). Backfill de 37 meses ≈ 456 operações por conta; incremental ≈ 16.
Teto recomendado: 20 contas/dia de backfill. Detalhe na ADR 0016.

<!-- Google Ads: novas tabelas acima desta linha -->

## GA4

Configuração: `tabelas/ga4.ts`. Manifesto: `manifesto/ga4.json`. DDL: `22_ga4*.sql`.

### `fato_ga4_diario`

- Granularidade: uma linha por `organization_id`, `property_id`, `canal`,
  `data_dia`.
- Colunas: `sessoes`, `usuarios`, `novos_usuarios`, `conversoes`, `receita`,
  `execucao_id`, `inserido_em`.
- Partição `data_dia`; cluster `organization_id, property_id`.
- Staging `stg_ga4_diario`; view `vw_ga4_diario`.

Decisões: ADR [0016](../../docs/adr/0016-ga4-searchconsole-modelagem.md). DDL:
`22_ga4.sql`. Todas as tabelas abaixo seguem o mesmo molde: fato diário
`PARTITION BY data_dia`, `CLUSTER BY organization_id, property_id, <1ª
dimensão>`; staging `stg_<mesmo sufixo>`; view `vw_<mesmo sufixo>` (dedupe +
`cliente_na_epoca_*`/`cliente_atual_*` via `dim_fonte_scd2`, `platform =
'ga4'`). Dimensão sem valor grava `(not set)`; `(other)` é a cauda que o GA4
agrupa quando a cardinalidade estoura. Origem: `POST
analyticsdata.googleapis.com/v1beta/properties/{id}:runReport`, um pedido por
recorte (`date` + dimensões), `limit` 100000 paginado por `offset`. Valor em
parênteses é o campo da API; `_tabela` entre crases.

| `_tabela` | Tabela | Grão (além de `organization_id`, `property_id`, `data_dia`) | Dimensões da API | Métricas (API → coluna) |
|---|---|---|---|---|
| `aquisicao` | `fato_ga4_aquisicao_diario` | `fonte`, `midia`, `campanha`, `canal_padrao` | sessionSource, sessionMedium, sessionCampaignName, sessionDefaultChannelGroup | sessions → `sessoes`, engagedSessions → `sessoes_engajadas`, totalUsers → `usuarios`, newUsers → `novos_usuarios`, keyEvents → `eventos_chave`, totalRevenue → `receita`, userEngagementDuration → `duracao_engajamento_seg` |
| `pagina` | `fato_ga4_pagina_diario` | `pagina` | pagePath (sem query string) | screenPageViews → `visualizacoes`, activeUsers → `usuarios_ativos`, sessions → `sessoes`, eventCount → `eventos`, keyEvents → `eventos_chave`, userEngagementDuration → `duracao_engajamento_seg` |
| `pagina_entrada` | `fato_ga4_pagina_entrada_diario` | `pagina_entrada` | landingPage | sessões, sessões engajadas, usuários, novos usuários, `eventos_chave`, `receita` (como em `aquisicao`) |
| `evento` | `fato_ga4_evento_diario` | `evento` | eventName | eventCount → `contagem`, totalUsers → `usuarios`, eventValue → `valor`, keyEvents → `eventos_chave` (evento marcado como principal) |
| `dispositivo` | `fato_ga4_dispositivo_diario` | `categoria_dispositivo`, `sistema_operacional`, `navegador`, `plataforma` | deviceCategory, operatingSystem, browser, platform | mesmas de `pagina_entrada` |
| `geo` | `fato_ga4_geo_diario` | `pais`, `regiao`, `cidade` | country, region, city | mesmas de `pagina_entrada` |
| `item` | `fato_ga4_item_diario` | `item` | itemName (só agregado; vazio sem e-commerce) | itemsViewed → `itens_visualizados`, itemsAddedToCart → `itens_no_carrinho`, itemsPurchased → `itens_comprados`, itemRevenue → `receita_item` |

Cada tabela de recorte tem também `execucao_id` e `inserido_em`. Os recortes
não somam entre si (escopos de sessão, evento e item diferem); compare totais
só dentro do recorte. `fato_ga4_diario` (acima) continua como total por canal.

<!-- GA4: novas tabelas acima desta linha -->

## Search Console

Configuração: `tabelas/searchconsole.ts`. Manifesto: `manifesto/searchconsole.json`. DDL: `23_searchconsole*.sql`.

### `fato_search_console_diario`

- Granularidade: uma linha por `organization_id`, `site`, `device`,
  `data_dia`.
- Colunas: `cliques`, `impressoes`, `ctr`, `posicao_media`, `execucao_id`,
  `inserido_em`.
- Partição `data_dia`; cluster `organization_id, site`.
- Staging `stg_search_console_diario`; view `vw_search_console_diario`.

Decisões: ADR [0016](../../docs/adr/0016-ga4-searchconsole-modelagem.md). DDL:
`23_searchconsole.sql`. Mesmo molde das tabelas de recorte do GA4: partição
`data_dia`, `CLUSTER BY organization_id, site, <1ª dimensão>`, staging
`stg_<sufixo>`, view `vw_<sufixo>` com `platform = 'searchconsole'`. Origem:
`POST webmasters/v3/sites/{site}/searchAnalytics/query` (`date` + dimensões),
`rowLimit` 25000 paginado por `startRow`, `dataState: final`, tipo de busca
`web`. Colunas de métrica em todas: `cliques`, `impressoes`, `ctr` (fração),
`posicao_media` (média da API, 1 = topo; para reagregar, pondere por
`impressoes`).

| `_tabela` | Tabela | Grão (além de `organization_id`, `site`, `data_dia`) | Dimensões da API |
|---|---|---|---|
| `consulta_pagina` | `fato_search_console_consulta_pagina_diario` | `consulta`, `pagina` | query, page |
| `pagina` | `fato_search_console_pagina_diario` | `pagina` | page |
| `pais_dispositivo` | `fato_search_console_pais_dispositivo_diario` | `pais` (ISO 3166-1 alfa-3, minúsculo), `dispositivo` | country, device |
| `aparencia` | `fato_search_console_aparencia_diario` | `aparencia` | searchAppearance (ex.: AMP, rich results; recorte opcional: 400 não falha a coleta) |

Consultas são termos agregados; a API omite as anonimizadas (raras), então
`consulta_pagina` soma menos que `pagina`, e `pagina` (agregação por página)
não bate exatamente com `fato_search_console_diario` (por propriedade). A
API devolve só as linhas de maior tráfego por dia; não há garantia de
completude da cauda. `fato_search_console_diario` (acima) continua como
total por dispositivo.

<!-- Search Console: novas tabelas acima desta linha -->

## YouTube

Configuração: `tabelas/youtube.ts`. Manifesto: `manifesto/youtube.json`. DDL: `24_youtube*.sql`.

### `fato_youtube_diario`

- Granularidade: uma linha por `organization_id`, `channel_id`, `data_dia`.
- Colunas: `views`, `minutos_assistidos`, `inscritos_ganhos`,
  `inscritos_perdidos`, `receita_estimada`, `execucao_id`, `inserido_em`.
- Partição `data_dia`; cluster `organization_id, channel_id`.
- Staging `stg_youtube_diario`; view `vw_youtube_diario`.

Origem: YouTube Analytics API v2 (`reports.query`, escopo `yt-analytics.readonly`)
e YouTube Data API v3 (`videos.list`, `playlists.list`, escopo `youtube.readonly`,
1 unidade de cota por chamada; nunca `search.list`, que custa 100). Decisões: ADR
[0016](../../docs/adr/0016-youtube-gbp-modelagem.md). Cada tabela abaixo tem
`_tabela` própria no coletor (entre parênteses). Todas as `vw_*` de fato dão o
dono `cliente_na_epoca_*` e `cliente_atual_*`; as `vw_dim_*` dão só
`cliente_atual_*`.

### `dim_youtube_video_scd2` (`dim_video`)

- Granularidade: uma versão por `organization_id`, `channel_id`, `video_id` e
  intervalo `[valido_de, valido_ate)`.
- Atributos (hash da versão): `titulo`, `duracao_segundos`, `publicado_em`,
  `privacidade`, `categoria_id`.
- Cluster `organization_id, channel_id, video_id`.
- Origem: `videos.list` (`snippet.title`, `snippet.publishedAt`,
  `snippet.categoryId`, `contentDetails.duration` ISO 8601 convertida em
  segundos, `status.privacyStatus`), só dos vídeos mais vistos da janela (até 25).
- Staging `stg_youtube_video`; view `vw_dim_youtube_video_scd2`.

### `dim_youtube_playlist_scd2` (`dim_playlist`)

- Granularidade: uma versão por `organization_id`, `channel_id`, `playlist_id`
  e intervalo.
- Atributos: `titulo`, `privacidade`, `qtd_videos`.
- Cluster `organization_id, channel_id, playlist_id`.
- Origem: `playlists.list` (primeira página, 50 playlists).
- Staging `stg_youtube_playlist`; view `vw_dim_youtube_playlist_scd2`.

### `fato_youtube_video_diario` (`video_diario`)

- Granularidade: uma linha por `organization_id`, `channel_id`, `video_id`,
  `data_dia`.
- Colunas: `views`, `minutos_assistidos`, `duracao_media_visualizacao_s`,
  `curtidas`, `comentarios`, `compartilhamentos`, `inscritos_ganhos`,
  `inscritos_perdidos`, `execucao_id`, `inserido_em`.
- Partição `data_dia`; cluster `organization_id, channel_id, video_id`.
- Origem: `reports.query` com `filters=video==<id>`, `dimensions=day`, um
  pedido por vídeo (os 25 mais vistos da janela, descobertos por
  `dimensions=video&sort=-views&maxResults=25`).
- Staging `stg_youtube_video_diario`; view `vw_youtube_video_diario`.

### Recortes do canal por dia

Mesmas colunas de dado: `views`, `minutos_assistidos`; mesmo particionamento
(`data_dia`), cluster `organization_id, channel_id, <recorte>`.

| Tabela (`_tabela`) | Granularidade (além de `organization_id`, `channel_id`, `data_dia`) | Origem (`dimensions`) |
|---|---|---|
| `fato_youtube_origem_trafego_diario` (`origem_trafego`) | `origem_trafego` | `day,insightTrafficSourceType` |
| `fato_youtube_dispositivo_diario` (`dispositivo`) | `dispositivo` | `day,deviceType` |
| `fato_youtube_local_reproducao_diario` (`local_reproducao`) | `local_reproducao` | `day,insightPlaybackLocationType` |
| `fato_youtube_pais_diario` (`pais`) | `pais` (ISO 3166-1 alfa-2) | `country`, um pedido por dia |

Staging `stg_youtube_<recorte>_diario`; view `vw_youtube_<recorte>_diario`.

### `fato_youtube_audiencia_diario` (`audiencia`)

- Granularidade: uma linha por `organization_id`, `channel_id`, `data_dia`,
  `faixa_etaria`, `genero`.
- Colunas: `percentual_espectadores` (`viewerPercentage`, soma 100 no dia),
  `execucao_id`, `inserido_em`.
- Partição `data_dia`; cluster `organization_id, channel_id`.
- Origem: `ageGroup,gender` com `viewerPercentage`, um pedido por dia. Dia
  com poucos espectadores volta sem linhas (limiar de privacidade da API).
- Staging `stg_youtube_audiencia_diario`; view `vw_youtube_audiencia_diario`.

Limites do coletor: país e audiência só são consultáveis sem `day` na API, por
isso um pedido por dia, no máximo os 31 dias mais recentes da janela. Falha
nos recortes e nos metadados é ignorada (só `fato_youtube_diario` derruba a
execução).

<!-- YouTube: novas tabelas acima desta linha -->

## Google Business Profile

Configuração: `tabelas/gbp.ts`. Manifesto: `manifesto/gbp.json`. DDL: `25_gbp*.sql`.

### `fato_gbp_diario`

- Granularidade: uma linha por `organization_id`, `location_id`, `data_dia`,
  `metrica` (formato longo: uma métrica por linha).
- Colunas: `valor`, `execucao_id`, `inserido_em`.
- Partição `data_dia`; cluster `organization_id, location_id`.
- Staging `stg_gbp_diario`; view `vw_gbp_diario`.

`fato_gbp_diario` agora pede 10 métricas diárias da Business Profile
Performance API (`fetchMultiDailyMetricsTimeSeries`): as quatro
`BUSINESS_IMPRESSIONS_*`, `BUSINESS_DIRECTION_REQUESTS`, `CALL_CLICKS`,
`WEBSITE_CLICKS`, `MESSAGING_CLICKS`, `BUSINESS_BOOKINGS` e
`BUSINESS_FOOD_MENU_CLICKS` (as duas métricas depreciadas ficam de fora).
Decisões: ADR [0016](../../docs/adr/0016-youtube-gbp-modelagem.md).

### `dim_gbp_local_scd2` (`dim_local`)

- Granularidade: uma versão por `organization_id`, `location_id` e intervalo
  `[valido_de, valido_ate)`.
- Atributos (hash da versão): `nome`, `categoria_primaria`, `endereco`,
  `cidade`, `estado`, `cep`, `pais`, `status`, `site`. São dados do
  estabelecimento, não de pessoas.
- Cluster `organization_id, location_id`.
- Origem: Business Information API v1, `locations.get` com `readMask`
  `name,title,categories,storefrontAddress,openInfo,websiteUri`
  (`title`, `categories.primaryCategory.displayName`,
  `storefrontAddress.*`, `openInfo.status`, `websiteUri`).
- Staging `stg_gbp_local`; view `vw_dim_gbp_local_scd2`.

### `fato_gbp_palavras_chave_mensal` (`palavras_chave`)

- Granularidade: uma linha por `organization_id`, `location_id`, `mes` (dia 1
  do mês), `termo`.
- Colunas: `valor` (usuários únicos que buscaram o termo; nulo quando a API só
  informa o limiar), `limiar` (a API informa "abaixo de N"), `execucao_id`,
  `inserido_em`. Exatamente um dos dois vem preenchido.
- Partição `mes`; cluster `organization_id, location_id`.
- Origem: `searchkeywords/impressions/monthly`, um pedido por mês da janela
  (até 3), `pageSize=100`, só a primeira página.
- Staging `stg_gbp_palavras_chave_mensal`; view `vw_gbp_palavras_chave_mensal`
  (dono pelo mês: `cliente_na_epoca_*` usa o dia 1 do mês).

Avaliações (contagem e nota média): ficaram de fora, ver ADR 0016.

<!-- Google Business Profile: novas tabelas acima desta linha -->

## RD Station

Configuração: `tabelas/rdstation.ts`. Manifesto: `manifesto/rdstation.json`. DDL: `26_rdstation*.sql`.

### `fato_rd_negociacoes`

- Granularidade: uma linha por `organization_id`, `conta_id`, `deal_id`,
  `data_snapshot` (foto diária do funil; ADR 0012).
- Colunas: `pipeline_id`, `pipeline_nome`, `etapa_id`, `etapa_nome`,
  `etapa_ordem`, `situacao`, `valor_total`, `valor_mensal`, `valor_unico`,
  `moeda`, `criada_em`, `atualizada_em`, `fechada_em`, `fonte_nome`,
  `campanha_nome`, `execucao_id`, `inserido_em`.
- Partição `data_snapshot`; cluster `organization_id, conta_id`.
- Staging `stg_rd_negociacoes`; view `vw_rd_negociacoes`.

<!-- RD Station: novas tabelas acima desta linha -->

## Meta Pixel e Lead Ads

Configuração: `tabelas/pixel.ts` e `tabelas/leadads.ts`. Manifesto:
`manifesto/pixel.json` e `manifesto/leadads.json`. DDL: `27_*.sql`. ADR 0014.

### `fato_meta_eventos_dataset` (pixel)

- Granularidade: uma linha por `organization_id`, `dataset_id`, `data_dia`,
  `evento`, `origem`.
- Colunas: `quantidade`, `execucao_id`, `inserido_em`.
- Partição `data_dia`; cluster `organization_id, dataset_id, evento`.
- Staging `stg_meta_eventos_dataset`; view `vw_meta_eventos_dataset`.
- DDL: `06_meta_dataset_formularios.sql`.

### `fato_meta_formularios` (leadads)

- Granularidade: uma linha por `organization_id`, `page_id`, `form_id`,
  `data_snapshot` (foto diária do formulário).
- Colunas: `nome`, `status`, `leads_total`, `leads_expirados`, `criado_em`,
  `execucao_id`, `inserido_em`.
- Partição `data_snapshot`; cluster `organization_id, page_id, form_id`.
- Staging `stg_meta_formularios`; view `vw_meta_formularios`.
- DDL: `06_meta_dataset_formularios.sql`.

<!-- Meta Pixel e Lead Ads: novas tabelas acima desta linha -->

## Google Tag Manager

Configuração: `tabelas/gtm.ts`. Manifesto: `manifesto/gtm.json`. DDL: `28_gtm*.sql`.

GTM não é série temporal: hoje só alimenta `gov_snapshot_fontes` (seção
Transversais) com `platform = 'gtm'`, via `tipo: 'snapshot'` (append, sem
staging).

<!-- Google Tag Manager: novas tabelas acima desta linha -->

## Transversais

### `dim_fonte_scd2`

- Granularidade: uma versão por `organization_id`, `platform`,
  `external_id` e intervalo `[valido_de, valido_ate)`.
- Colunas: `sk`, `origem`, `client_id`, `status`, `nome`, `valido_de`,
  `valido_ate`, `atual`, `hash_versao`, `carregado_em`.
- Cluster `organization_id, platform, external_id`. Carga:
  `dimensoesBigQuery.ts` (ADR 0013), não pelo gravador da coleta.
- Única fonte de verdade do dono de um fato.

### `dim_cliente_scd2`

- Granularidade: uma versão por `organization_id`, `client_id` e intervalo.
- Colunas: `sk`, `nome`, `status`, `parent_client_id`, `business_model`,
  colunas de validade.
- Cluster `organization_id, client_id`. Carga: `dimensoesBigQuery.ts`.

### `gov_snapshot_fontes`

- Granularidade: uma linha por observação (`organization_id`, `platform`,
  `fonte_id`, `visto_em`); append.
- Colunas: `fonte_tipo`, `nome`, `estado`, `inactive`, `rotulo_esperado`,
  `rotulo_observado`.
- Partição `DATE(visto_em)`; cluster `organization_id, platform, fonte_id`.
- DDL: `03_governanca.sql`.

### `gov_paridade`

- Granularidade: uma linha por divergência detectada (`organization_id`,
  `client_id`, `platform`, `fonte_id`, `tipo`, `detectado_em`).
- Colunas: `esperado`, `observado`, `execucao_id`. Tem `client_id` (registro
  operacional, ADR 0013); apagada por `client_id` na exclusão.
- Partição `DATE(detectado_em)`; cluster `organization_id, client_id`.

### `qc_execucoes`

- Granularidade: uma linha por execução de coleta (`execucao_id`).
- Colunas: `client_id`, `platform`, `fonte_id`, `modo`, `window_start`,
  `window_end`, `fontes_esperadas`, `fontes_coletadas`, `linhas`, `bytes`,
  `requests`, `duracao_ms`, `status`, `qualidade_resumo` (JSON), `criado_em`.
- Partição `DATE(criado_em)`; cluster `organization_id, client_id`.
  Escrita: `registrarQc` em `bigQueryGravador.ts`.

<!-- Transversais: novas tabelas acima desta linha -->
