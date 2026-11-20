CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_ads_diario` (
  organization_id       STRING NOT NULL,
  platform              STRING NOT NULL,
  ad_account_id         STRING NOT NULL,
  external_campaign_id  STRING NOT NULL,
  campaign_name         STRING,
  data_dia              DATE NOT NULL,
  investimento          NUMERIC,
  impressoes            INT64,
  cliques               INT64,
  conversoes            NUMERIC,
  receita               NUMERIC,
  moeda                 STRING,
  versao_api            STRING,
  execucao_id           STRING NOT NULL,
  inserido_em           TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_ga4_diario` (
  organization_id   STRING NOT NULL,
  property_id       STRING NOT NULL,
  canal             STRING,
  data_dia          DATE NOT NULL,
  sessoes           INT64,
  usuarios          INT64,
  novos_usuarios    INT64,
  conversoes        NUMERIC,
  receita           NUMERIC,
  execucao_id       STRING NOT NULL,
  inserido_em       TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_search_console_diario` (
  organization_id  STRING NOT NULL,
  site             STRING NOT NULL,
  device           STRING,
  data_dia         DATE NOT NULL,
  cliques          INT64,
  impressoes       INT64,
  ctr              NUMERIC,
  posicao_media    NUMERIC,
  execucao_id      STRING NOT NULL,
  inserido_em      TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_youtube_diario` (
  organization_id     STRING NOT NULL,
  channel_id          STRING NOT NULL,
  data_dia            DATE NOT NULL,
  views               INT64,
  minutos_assistidos  NUMERIC,
  inscritos_ganhos    INT64,
  inscritos_perdidos  INT64,
  receita_estimada    NUMERIC,
  execucao_id         STRING NOT NULL,
  inserido_em         TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_gbp_diario` (
  organization_id  STRING NOT NULL,
  location_id      STRING NOT NULL,
  data_dia         DATE NOT NULL,
  metrica          STRING NOT NULL,
  valor            NUMERIC,
  execucao_id      STRING NOT NULL,
  inserido_em      TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_rd_negociacoes` (
  organization_id  STRING NOT NULL,
  conta_id         STRING NOT NULL,
  deal_id          STRING NOT NULL,
  data_snapshot    DATE NOT NULL,
  pipeline_id      STRING,
  pipeline_nome    STRING,
  etapa_id         STRING,
  etapa_nome       STRING,
  etapa_ordem      INT64,
  situacao         STRING NOT NULL,
  valor_total      NUMERIC,
  valor_mensal     NUMERIC,
  valor_unico      NUMERIC,
  moeda            STRING,
  criada_em        TIMESTAMP,
  atualizada_em    TIMESTAMP,
  fechada_em       TIMESTAMP,
  fonte_nome       STRING,
  campanha_nome    STRING,
  execucao_id      STRING NOT NULL,
  inserido_em      TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);
