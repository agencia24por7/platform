CREATE TABLE IF NOT EXISTS `{{DATASET}}.dim_fonte_scd2` (
  sk               STRING NOT NULL,
  organization_id  STRING NOT NULL,
  platform         STRING NOT NULL,
  external_id      STRING NOT NULL,
  origem           STRING NOT NULL,
  client_id        STRING,
  status           STRING NOT NULL,
  nome             STRING,
  valido_de        TIMESTAMP NOT NULL,
  valido_ate       TIMESTAMP NOT NULL,
  atual            BOOL NOT NULL,
  hash_versao      STRING NOT NULL,
  carregado_em     TIMESTAMP NOT NULL
)
CLUSTER BY organization_id, platform, external_id;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.dim_cliente_scd2` (
  sk                STRING NOT NULL,
  organization_id   STRING NOT NULL,
  client_id         STRING NOT NULL,
  nome              STRING,
  status            STRING NOT NULL,
  parent_client_id  STRING,
  business_model    STRING,
  valido_de         TIMESTAMP NOT NULL,
  valido_ate        TIMESTAMP NOT NULL,
  atual             BOOL NOT NULL,
  hash_versao       STRING NOT NULL,
  carregado_em      TIMESTAMP NOT NULL
)
CLUSTER BY organization_id, client_id;

CREATE OR REPLACE VIEW `{{DATASET}}.vw_ads_diario` AS
WITH fatos AS (
  SELECT *
  FROM `{{DATASET}}.fato_ads_diario`
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY organization_id, platform, ad_account_id, external_campaign_id, data_dia
    ORDER BY inserido_em DESC
  ) = 1
)
SELECT
  f.*,
  epoca.client_id AS cliente_na_epoca_id,
  cliente_epoca.nome AS cliente_na_epoca_nome,
  atual.client_id AS cliente_atual_id,
  cliente_atual.nome AS cliente_atual_nome,
  atual.status AS fonte_status_atual,
  atual.nome AS fonte_nome_atual
FROM fatos f
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` epoca
  ON epoca.organization_id = f.organization_id AND epoca.platform = f.platform AND epoca.external_id = f.ad_account_id
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') >= epoca.valido_de
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') < epoca.valido_ate
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = f.organization_id AND atual.platform = f.platform AND atual.external_id = f.ad_account_id
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_epoca
  ON cliente_epoca.organization_id = f.organization_id AND cliente_epoca.client_id = epoca.client_id AND cliente_epoca.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = f.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual;

CREATE OR REPLACE VIEW `{{DATASET}}.vw_ga4_diario` AS
WITH fatos AS (
  SELECT *
  FROM `{{DATASET}}.fato_ga4_diario`
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY organization_id, property_id, canal, data_dia
    ORDER BY inserido_em DESC
  ) = 1
)
SELECT
  f.*,
  epoca.client_id AS cliente_na_epoca_id,
  cliente_epoca.nome AS cliente_na_epoca_nome,
  atual.client_id AS cliente_atual_id,
  cliente_atual.nome AS cliente_atual_nome,
  atual.status AS fonte_status_atual,
  atual.nome AS fonte_nome_atual
FROM fatos f
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` epoca
  ON epoca.organization_id = f.organization_id AND epoca.platform = 'ga4' AND epoca.external_id = f.property_id
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') >= epoca.valido_de
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') < epoca.valido_ate
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = f.organization_id AND atual.platform = 'ga4' AND atual.external_id = f.property_id
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_epoca
  ON cliente_epoca.organization_id = f.organization_id AND cliente_epoca.client_id = epoca.client_id AND cliente_epoca.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = f.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual;

CREATE OR REPLACE VIEW `{{DATASET}}.vw_search_console_diario` AS
WITH fatos AS (
  SELECT *
  FROM `{{DATASET}}.fato_search_console_diario`
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY organization_id, site, device, data_dia
    ORDER BY inserido_em DESC
  ) = 1
)
SELECT
  f.*,
  epoca.client_id AS cliente_na_epoca_id,
  cliente_epoca.nome AS cliente_na_epoca_nome,
  atual.client_id AS cliente_atual_id,
  cliente_atual.nome AS cliente_atual_nome,
  atual.status AS fonte_status_atual,
  atual.nome AS fonte_nome_atual
FROM fatos f
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` epoca
  ON epoca.organization_id = f.organization_id AND epoca.platform = 'searchconsole' AND epoca.external_id = f.site
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') >= epoca.valido_de
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') < epoca.valido_ate
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = f.organization_id AND atual.platform = 'searchconsole' AND atual.external_id = f.site
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_epoca
  ON cliente_epoca.organization_id = f.organization_id AND cliente_epoca.client_id = epoca.client_id AND cliente_epoca.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = f.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual;

CREATE OR REPLACE VIEW `{{DATASET}}.vw_youtube_diario` AS
WITH fatos AS (
  SELECT *
  FROM `{{DATASET}}.fato_youtube_diario`
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY organization_id, channel_id, data_dia
    ORDER BY inserido_em DESC
  ) = 1
)
SELECT
  f.*,
  epoca.client_id AS cliente_na_epoca_id,
  cliente_epoca.nome AS cliente_na_epoca_nome,
  atual.client_id AS cliente_atual_id,
  cliente_atual.nome AS cliente_atual_nome,
  atual.status AS fonte_status_atual,
  atual.nome AS fonte_nome_atual
FROM fatos f
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` epoca
  ON epoca.organization_id = f.organization_id AND epoca.platform = 'youtube' AND epoca.external_id = f.channel_id
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') >= epoca.valido_de
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') < epoca.valido_ate
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = f.organization_id AND atual.platform = 'youtube' AND atual.external_id = f.channel_id
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_epoca
  ON cliente_epoca.organization_id = f.organization_id AND cliente_epoca.client_id = epoca.client_id AND cliente_epoca.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = f.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual;

CREATE OR REPLACE VIEW `{{DATASET}}.vw_gbp_diario` AS
WITH fatos AS (
  SELECT *
  FROM `{{DATASET}}.fato_gbp_diario`
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY organization_id, location_id, data_dia, metrica
    ORDER BY inserido_em DESC
  ) = 1
)
SELECT
  f.*,
  epoca.client_id AS cliente_na_epoca_id,
  cliente_epoca.nome AS cliente_na_epoca_nome,
  atual.client_id AS cliente_atual_id,
  cliente_atual.nome AS cliente_atual_nome,
  atual.status AS fonte_status_atual,
  atual.nome AS fonte_nome_atual
FROM fatos f
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` epoca
  ON epoca.organization_id = f.organization_id AND epoca.platform = 'gbp' AND epoca.external_id = f.location_id
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') >= epoca.valido_de
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') < epoca.valido_ate
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = f.organization_id AND atual.platform = 'gbp' AND atual.external_id = f.location_id
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_epoca
  ON cliente_epoca.organization_id = f.organization_id AND cliente_epoca.client_id = epoca.client_id AND cliente_epoca.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = f.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual;

CREATE OR REPLACE VIEW `{{DATASET}}.vw_rd_negociacoes` AS
WITH fatos AS (
  SELECT *
  FROM `{{DATASET}}.fato_rd_negociacoes`
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY organization_id, conta_id, deal_id, data_snapshot
    ORDER BY inserido_em DESC
  ) = 1
)
SELECT
  f.*,
  epoca.client_id AS cliente_na_epoca_id,
  cliente_epoca.nome AS cliente_na_epoca_nome,
  atual.client_id AS cliente_atual_id,
  cliente_atual.nome AS cliente_atual_nome,
  atual.status AS fonte_status_atual,
  atual.nome AS fonte_nome_atual
FROM fatos f
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` epoca
  ON epoca.organization_id = f.organization_id AND epoca.platform = 'rdstation' AND epoca.external_id = f.conta_id
  AND TIMESTAMP(f.data_snapshot, 'America/Sao_Paulo') >= epoca.valido_de
  AND TIMESTAMP(f.data_snapshot, 'America/Sao_Paulo') < epoca.valido_ate
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = f.organization_id AND atual.platform = 'rdstation' AND atual.external_id = f.conta_id
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_epoca
  ON cliente_epoca.organization_id = f.organization_id AND cliente_epoca.client_id = epoca.client_id AND cliente_epoca.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = f.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual;
