CREATE TABLE IF NOT EXISTS `{{DATASET}}.fato_ads_diario` (
  organization_id       STRING NOT NULL,
  client_id             STRING NOT NULL,
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
  execucao_id           STRING,
  inserido_em           TIMESTAMP NOT NULL
)
PARTITION BY data_dia
CLUSTER BY organization_id, client_id;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.fato_ga4_diario` (
  organization_id   STRING NOT NULL,
  client_id         STRING NOT NULL,
  property_id       STRING NOT NULL,
  canal             STRING,
  data_dia          DATE NOT NULL,
  sessoes           INT64,
  usuarios          INT64,
  novos_usuarios    INT64,
  conversoes        NUMERIC,
  receita           NUMERIC,
  execucao_id       STRING,
  inserido_em       TIMESTAMP NOT NULL
)
PARTITION BY data_dia
CLUSTER BY organization_id, client_id;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.fato_search_console_diario` (
  organization_id  STRING NOT NULL,
  client_id        STRING NOT NULL,
  site             STRING NOT NULL,
  device           STRING,
  data_dia         DATE NOT NULL,
  cliques          INT64,
  impressoes       INT64,
  ctr              NUMERIC,
  posicao_media    NUMERIC,
  execucao_id      STRING,
  inserido_em      TIMESTAMP NOT NULL
)
PARTITION BY data_dia
CLUSTER BY organization_id, client_id;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.fato_youtube_diario` (
  organization_id     STRING NOT NULL,
  client_id           STRING NOT NULL,
  channel_id          STRING NOT NULL,
  data_dia            DATE NOT NULL,
  views               INT64,
  minutos_assistidos  NUMERIC,
  inscritos_ganhos    INT64,
  inscritos_perdidos  INT64,
  receita_estimada    NUMERIC,
  execucao_id         STRING,
  inserido_em         TIMESTAMP NOT NULL
)
PARTITION BY data_dia
CLUSTER BY organization_id, client_id;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.fato_gbp_diario` (
  organization_id  STRING NOT NULL,
  client_id        STRING NOT NULL,
  location_id      STRING NOT NULL,
  data_dia         DATE NOT NULL,
  metrica          STRING NOT NULL,
  valor            NUMERIC,
  execucao_id      STRING,
  inserido_em      TIMESTAMP NOT NULL
)
PARTITION BY data_dia
CLUSTER BY organization_id, client_id;
