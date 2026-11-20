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

<!-- Meta Ads: novas tabelas acima desta linha -->

## Google Ads

Configuração: `tabelas/google.ts`. Manifesto: `manifesto/google.json`. DDL: `21_google*.sql`.

### `fato_ads_diario` (compartilhada com Meta Ads)

Mesma tabela da seção Meta Ads, com `platform = 'google'`.

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

<!-- Search Console: novas tabelas acima desta linha -->

## YouTube

Configuração: `tabelas/youtube.ts`. Manifesto: `manifesto/youtube.json`. DDL: `24_youtube*.sql`.

### `fato_youtube_diario`

- Granularidade: uma linha por `organization_id`, `channel_id`, `data_dia`.
- Colunas: `views`, `minutos_assistidos`, `inscritos_ganhos`,
  `inscritos_perdidos`, `receita_estimada`, `execucao_id`, `inserido_em`.
- Partição `data_dia`; cluster `organization_id, channel_id`.
- Staging `stg_youtube_diario`; view `vw_youtube_diario`.

<!-- YouTube: novas tabelas acima desta linha -->

## Google Business Profile

Configuração: `tabelas/gbp.ts`. Manifesto: `manifesto/gbp.json`. DDL: `25_gbp*.sql`.

### `fato_gbp_diario`

- Granularidade: uma linha por `organization_id`, `location_id`, `data_dia`,
  `metrica` (formato longo: uma métrica por linha).
- Colunas: `valor`, `execucao_id`, `inserido_em`.
- Partição `data_dia`; cluster `organization_id, location_id`.
- Staging `stg_gbp_diario`; view `vw_gbp_diario`.

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
