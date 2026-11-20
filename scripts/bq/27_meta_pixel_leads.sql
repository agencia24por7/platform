CREATE TABLE IF NOT EXISTS `{{DATASET}}.dim_meta_dataset_scd2` (
  organization_id               STRING NOT NULL,
  dataset_id                    STRING NOT NULL,
  nome                          STRING,
  indisponivel                  BOOL,
  correspondencia_automatica    BOOL,
  cookie_primeira_parte         STRING,
  uso_de_dados                  STRING,
  valido_de                     TIMESTAMP NOT NULL,
  valido_ate                    TIMESTAMP NOT NULL,
  atual                         BOOL NOT NULL,
  hash_versao                   STRING NOT NULL,
  execucao_id                   STRING,
  carregado_em                  TIMESTAMP NOT NULL
)
CLUSTER BY organization_id, dataset_id;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_dim_meta_dataset` (
  organization_id               STRING NOT NULL,
  dataset_id                    STRING NOT NULL,
  nome                          STRING,
  indisponivel                  BOOL,
  correspondencia_automatica    BOOL,
  cookie_primeira_parte         STRING,
  uso_de_dados                  STRING,
  execucao_id                   STRING NOT NULL,
  inserido_em                   TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE OR REPLACE VIEW `{{DATASET}}.vw_dim_meta_dataset` AS
SELECT
  d.*,
  atual.client_id AS cliente_atual_id,
  cliente_atual.nome AS cliente_atual_nome,
  cliente_atual.status AS cliente_atual_status,
  atual.status AS fonte_status_atual,
  atual.nome AS fonte_nome_atual
FROM `{{DATASET}}.dim_meta_dataset_scd2` d
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = d.organization_id AND atual.platform = 'pixel' AND atual.external_id = d.dataset_id
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = d.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual
WHERE IFNULL(cliente_atual.status, '') != 'excluido';

CREATE TABLE IF NOT EXISTS `{{DATASET}}.fato_meta_eventos_dataset_recortes` (
  organization_id               STRING NOT NULL,
  dataset_id                    STRING NOT NULL,
  data_dia                      DATE NOT NULL,
  recorte                       STRING NOT NULL,
  valor                         STRING NOT NULL,
  quantidade                    INT64 NOT NULL,
  execucao_id                   STRING,
  inserido_em                   TIMESTAMP NOT NULL
)
PARTITION BY data_dia
CLUSTER BY organization_id, dataset_id, recorte;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_meta_eventos_dataset_recortes` (
  organization_id               STRING NOT NULL,
  dataset_id                    STRING NOT NULL,
  data_dia                      DATE NOT NULL,
  recorte                       STRING NOT NULL,
  valor                         STRING NOT NULL,
  quantidade                    INT64 NOT NULL,
  execucao_id                   STRING NOT NULL,
  inserido_em                   TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE OR REPLACE VIEW `{{DATASET}}.vw_meta_eventos_dataset_recortes` AS
WITH fatos AS (
  SELECT *
  FROM `{{DATASET}}.fato_meta_eventos_dataset_recortes`
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY organization_id, dataset_id, data_dia, recorte, valor
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
