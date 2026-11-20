CREATE TABLE IF NOT EXISTS `{{DATASET}}.dim_gbp_local_scd2` (
  organization_id               STRING NOT NULL,
  location_id                   STRING NOT NULL,
  nome                          STRING,
  categoria_primaria            STRING,
  endereco                      STRING,
  cidade                        STRING,
  estado                        STRING,
  cep                           STRING,
  pais                          STRING,
  status                        STRING,
  site                          STRING,
  valido_de                     TIMESTAMP NOT NULL,
  valido_ate                    TIMESTAMP NOT NULL,
  atual                         BOOL NOT NULL,
  hash_versao                   STRING NOT NULL,
  execucao_id                   STRING,
  carregado_em                  TIMESTAMP NOT NULL
)
CLUSTER BY organization_id, location_id;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_gbp_local` (
  organization_id               STRING NOT NULL,
  location_id                   STRING NOT NULL,
  nome                          STRING,
  categoria_primaria            STRING,
  endereco                      STRING,
  cidade                        STRING,
  estado                        STRING,
  cep                           STRING,
  pais                          STRING,
  status                        STRING,
  site                          STRING,
  execucao_id                   STRING NOT NULL,
  inserido_em                   TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE OR REPLACE VIEW `{{DATASET}}.vw_dim_gbp_local_scd2` AS
SELECT
  d.*,
  atual.client_id AS cliente_atual_id,
  cliente_atual.nome AS cliente_atual_nome,
  atual.status AS fonte_status_atual,
  atual.nome AS fonte_nome_atual
FROM `{{DATASET}}.dim_gbp_local_scd2` d
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = d.organization_id AND atual.platform = 'gbp' AND atual.external_id = d.location_id
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = d.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.fato_gbp_palavras_chave_mensal` (
  organization_id               STRING NOT NULL,
  location_id                   STRING NOT NULL,
  mes                           DATE NOT NULL,
  termo                         STRING NOT NULL,
  valor                         INT64,
  limiar                        INT64,
  execucao_id                   STRING,
  inserido_em                   TIMESTAMP NOT NULL
)
PARTITION BY mes
CLUSTER BY organization_id, location_id;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_gbp_palavras_chave_mensal` (
  organization_id               STRING NOT NULL,
  location_id                   STRING NOT NULL,
  mes                           DATE NOT NULL,
  termo                         STRING NOT NULL,
  valor                         INT64,
  limiar                        INT64,
  execucao_id                   STRING NOT NULL,
  inserido_em                   TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE OR REPLACE VIEW `{{DATASET}}.vw_gbp_palavras_chave_mensal` AS
WITH fatos AS (
  SELECT *
  FROM `{{DATASET}}.fato_gbp_palavras_chave_mensal`
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY organization_id, location_id, mes, termo
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
  AND TIMESTAMP(f.mes, 'America/Sao_Paulo') >= epoca.valido_de
  AND TIMESTAMP(f.mes, 'America/Sao_Paulo') < epoca.valido_ate
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = f.organization_id AND atual.platform = 'gbp' AND atual.external_id = f.location_id
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_epoca
  ON cliente_epoca.organization_id = f.organization_id AND cliente_epoca.client_id = epoca.client_id AND cliente_epoca.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = f.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual;
