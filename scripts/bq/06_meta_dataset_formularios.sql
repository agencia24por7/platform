CREATE TABLE IF NOT EXISTS `{{DATASET}}.fato_meta_eventos_dataset` (
  organization_id  STRING NOT NULL,
  dataset_id       STRING NOT NULL,
  data_dia         DATE NOT NULL,
  evento           STRING NOT NULL,
  origem           STRING NOT NULL,
  quantidade       INT64 NOT NULL,
  execucao_id      STRING,
  inserido_em      TIMESTAMP NOT NULL
)
PARTITION BY data_dia
CLUSTER BY organization_id, dataset_id, evento;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_meta_eventos_dataset` (
  organization_id  STRING NOT NULL,
  dataset_id       STRING NOT NULL,
  data_dia         DATE NOT NULL,
  evento           STRING NOT NULL,
  origem           STRING NOT NULL,
  quantidade       INT64 NOT NULL,
  execucao_id      STRING NOT NULL,
  inserido_em      TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE TABLE IF NOT EXISTS `{{DATASET}}.fato_meta_formularios` (
  organization_id  STRING NOT NULL,
  page_id          STRING NOT NULL,
  form_id          STRING NOT NULL,
  data_snapshot    DATE NOT NULL,
  nome             STRING,
  status           STRING,
  leads_total      INT64,
  leads_expirados  INT64,
  criado_em        TIMESTAMP,
  execucao_id      STRING,
  inserido_em      TIMESTAMP NOT NULL
)
PARTITION BY data_snapshot
CLUSTER BY organization_id, page_id, form_id;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_meta_formularios` (
  organization_id  STRING NOT NULL,
  page_id          STRING NOT NULL,
  form_id          STRING NOT NULL,
  data_snapshot    DATE NOT NULL,
  nome             STRING,
  status           STRING,
  leads_total      INT64,
  leads_expirados  INT64,
  criado_em        TIMESTAMP,
  execucao_id      STRING NOT NULL,
  inserido_em      TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE OR REPLACE VIEW `{{DATASET}}.vw_meta_eventos_dataset` AS
WITH fatos AS (
  SELECT *
  FROM `{{DATASET}}.fato_meta_eventos_dataset`
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY organization_id, dataset_id, data_dia, evento, origem
    ORDER BY inserido_em DESC
  ) = 1
)
SELECT
  f.*,
  epoca.client_id AS cliente_na_epoca_id,
  cliente_epoca.nome AS cliente_na_epoca_nome,
  cliente_epoca.status AS cliente_na_epoca_status,
  atual.client_id AS cliente_atual_id,
  cliente_atual.nome AS cliente_atual_nome,
  cliente_atual.status AS cliente_atual_status,
  atual.status AS fonte_status_atual,
  atual.nome AS fonte_nome_atual
FROM fatos f
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` epoca
  ON epoca.organization_id = f.organization_id AND epoca.platform = 'pixel' AND epoca.external_id = f.dataset_id
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') >= epoca.valido_de
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') < epoca.valido_ate
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = f.organization_id AND atual.platform = 'pixel' AND atual.external_id = f.dataset_id
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_epoca
  ON cliente_epoca.organization_id = f.organization_id AND cliente_epoca.client_id = epoca.client_id AND cliente_epoca.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = f.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual
WHERE IFNULL(cliente_epoca.status, '') != 'excluido'
  AND IFNULL(cliente_atual.status, '') != 'excluido';

CREATE OR REPLACE VIEW `{{DATASET}}.vw_meta_formularios` AS
WITH fatos AS (
  SELECT *
  FROM `{{DATASET}}.fato_meta_formularios`
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY organization_id, page_id, form_id, data_snapshot
    ORDER BY inserido_em DESC
  ) = 1
)
SELECT
  f.*,
  epoca.client_id AS cliente_na_epoca_id,
  cliente_epoca.nome AS cliente_na_epoca_nome,
  cliente_epoca.status AS cliente_na_epoca_status,
  atual.client_id AS cliente_atual_id,
  cliente_atual.nome AS cliente_atual_nome,
  cliente_atual.status AS cliente_atual_status,
  atual.status AS fonte_status_atual,
  atual.nome AS fonte_nome_atual
FROM fatos f
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` epoca
  ON epoca.organization_id = f.organization_id AND epoca.platform = 'leadads' AND epoca.external_id = f.page_id
  AND TIMESTAMP(f.data_snapshot, 'America/Sao_Paulo') >= epoca.valido_de
  AND TIMESTAMP(f.data_snapshot, 'America/Sao_Paulo') < epoca.valido_ate
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = f.organization_id AND atual.platform = 'leadads' AND atual.external_id = f.page_id
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_epoca
  ON cliente_epoca.organization_id = f.organization_id AND cliente_epoca.client_id = epoca.client_id AND cliente_epoca.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = f.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual
WHERE IFNULL(cliente_epoca.status, '') != 'excluido'
  AND IFNULL(cliente_atual.status, '') != 'excluido';
