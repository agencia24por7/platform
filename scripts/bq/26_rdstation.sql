ALTER TABLE `{{DATASET}}.fato_rd_negociacoes`
  ADD COLUMN IF NOT EXISTS responsavel_id STRING,
  ADD COLUMN IF NOT EXISTS fonte_id STRING,
  ADD COLUMN IF NOT EXISTS campanha_id STRING;

ALTER TABLE `{{DATASET}}.stg_rd_negociacoes`
  ADD COLUMN IF NOT EXISTS responsavel_id STRING,
  ADD COLUMN IF NOT EXISTS fonte_id STRING,
  ADD COLUMN IF NOT EXISTS campanha_id STRING;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.dim_rd_funil_scd2` (
  organization_id               STRING NOT NULL,
  conta_id                      STRING NOT NULL,
  funil_id                      STRING NOT NULL,
  nome                          STRING,
  valido_de                     TIMESTAMP NOT NULL,
  valido_ate                    TIMESTAMP NOT NULL,
  atual                         BOOL NOT NULL,
  hash_versao                   STRING NOT NULL,
  execucao_id                   STRING,
  carregado_em                  TIMESTAMP NOT NULL
)
CLUSTER BY organization_id, conta_id, funil_id;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_dim_rd_funil` (
  organization_id               STRING NOT NULL,
  conta_id                      STRING NOT NULL,
  funil_id                      STRING NOT NULL,
  nome                          STRING,
  execucao_id                   STRING NOT NULL,
  inserido_em                   TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE OR REPLACE VIEW `{{DATASET}}.vw_dim_rd_funil` AS
SELECT
  d.*,
  atual.client_id AS cliente_atual_id,
  cliente_atual.nome AS cliente_atual_nome,
  atual.status AS fonte_status_atual,
  atual.nome AS fonte_nome_atual
FROM `{{DATASET}}.dim_rd_funil_scd2` d
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = d.organization_id AND atual.platform = 'rdstation' AND atual.external_id = d.conta_id
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = d.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.dim_rd_etapa_scd2` (
  organization_id               STRING NOT NULL,
  conta_id                      STRING NOT NULL,
  etapa_id                      STRING NOT NULL,
  funil_id                      STRING,
  nome                          STRING,
  ordem                         INT64,
  valido_de                     TIMESTAMP NOT NULL,
  valido_ate                    TIMESTAMP NOT NULL,
  atual                         BOOL NOT NULL,
  hash_versao                   STRING NOT NULL,
  execucao_id                   STRING,
  carregado_em                  TIMESTAMP NOT NULL
)
CLUSTER BY organization_id, conta_id, etapa_id;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_dim_rd_etapa` (
  organization_id               STRING NOT NULL,
  conta_id                      STRING NOT NULL,
  etapa_id                      STRING NOT NULL,
  funil_id                      STRING,
  nome                          STRING,
  ordem                         INT64,
  execucao_id                   STRING NOT NULL,
  inserido_em                   TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE OR REPLACE VIEW `{{DATASET}}.vw_dim_rd_etapa` AS
SELECT
  d.*,
  atual.client_id AS cliente_atual_id,
  cliente_atual.nome AS cliente_atual_nome,
  atual.status AS fonte_status_atual,
  atual.nome AS fonte_nome_atual
FROM `{{DATASET}}.dim_rd_etapa_scd2` d
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = d.organization_id AND atual.platform = 'rdstation' AND atual.external_id = d.conta_id
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = d.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.dim_rd_fonte_scd2` (
  organization_id               STRING NOT NULL,
  conta_id                      STRING NOT NULL,
  fonte_id                      STRING NOT NULL,
  nome                          STRING,
  valido_de                     TIMESTAMP NOT NULL,
  valido_ate                    TIMESTAMP NOT NULL,
  atual                         BOOL NOT NULL,
  hash_versao                   STRING NOT NULL,
  execucao_id                   STRING,
  carregado_em                  TIMESTAMP NOT NULL
)
CLUSTER BY organization_id, conta_id, fonte_id;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_dim_rd_fonte` (
  organization_id               STRING NOT NULL,
  conta_id                      STRING NOT NULL,
  fonte_id                      STRING NOT NULL,
  nome                          STRING,
  execucao_id                   STRING NOT NULL,
  inserido_em                   TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE OR REPLACE VIEW `{{DATASET}}.vw_dim_rd_fonte` AS
SELECT
  d.*,
  atual.client_id AS cliente_atual_id,
  cliente_atual.nome AS cliente_atual_nome,
  atual.status AS fonte_status_atual,
  atual.nome AS fonte_nome_atual
FROM `{{DATASET}}.dim_rd_fonte_scd2` d
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = d.organization_id AND atual.platform = 'rdstation' AND atual.external_id = d.conta_id
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = d.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.dim_rd_campanha_scd2` (
  organization_id               STRING NOT NULL,
  conta_id                      STRING NOT NULL,
  campanha_id                   STRING NOT NULL,
  nome                          STRING,
  valido_de                     TIMESTAMP NOT NULL,
  valido_ate                    TIMESTAMP NOT NULL,
  atual                         BOOL NOT NULL,
  hash_versao                   STRING NOT NULL,
  execucao_id                   STRING,
  carregado_em                  TIMESTAMP NOT NULL
)
CLUSTER BY organization_id, conta_id, campanha_id;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_dim_rd_campanha` (
  organization_id               STRING NOT NULL,
  conta_id                      STRING NOT NULL,
  campanha_id                   STRING NOT NULL,
  nome                          STRING,
  execucao_id                   STRING NOT NULL,
  inserido_em                   TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE OR REPLACE VIEW `{{DATASET}}.vw_dim_rd_campanha` AS
SELECT
  d.*,
  atual.client_id AS cliente_atual_id,
  cliente_atual.nome AS cliente_atual_nome,
  atual.status AS fonte_status_atual,
  atual.nome AS fonte_nome_atual
FROM `{{DATASET}}.dim_rd_campanha_scd2` d
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = d.organization_id AND atual.platform = 'rdstation' AND atual.external_id = d.conta_id
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = d.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.dim_rd_produto_scd2` (
  organization_id               STRING NOT NULL,
  conta_id                      STRING NOT NULL,
  produto_id                    STRING NOT NULL,
  nome                          STRING,
  preco                         NUMERIC,
  ativo                         BOOL,
  valido_de                     TIMESTAMP NOT NULL,
  valido_ate                    TIMESTAMP NOT NULL,
  atual                         BOOL NOT NULL,
  hash_versao                   STRING NOT NULL,
  execucao_id                   STRING,
  carregado_em                  TIMESTAMP NOT NULL
)
CLUSTER BY organization_id, conta_id, produto_id;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_dim_rd_produto` (
  organization_id               STRING NOT NULL,
  conta_id                      STRING NOT NULL,
  produto_id                    STRING NOT NULL,
  nome                          STRING,
  preco                         NUMERIC,
  ativo                         BOOL,
  execucao_id                   STRING NOT NULL,
  inserido_em                   TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE OR REPLACE VIEW `{{DATASET}}.vw_dim_rd_produto` AS
SELECT
  d.*,
  atual.client_id AS cliente_atual_id,
  cliente_atual.nome AS cliente_atual_nome,
  atual.status AS fonte_status_atual,
  atual.nome AS fonte_nome_atual
FROM `{{DATASET}}.dim_rd_produto_scd2` d
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = d.organization_id AND atual.platform = 'rdstation' AND atual.external_id = d.conta_id
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = d.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.dim_rd_usuario_scd2` (
  organization_id               STRING NOT NULL,
  conta_id                      STRING NOT NULL,
  usuario_id                    STRING NOT NULL,
  ativo                         BOOL,
  valido_de                     TIMESTAMP NOT NULL,
  valido_ate                    TIMESTAMP NOT NULL,
  atual                         BOOL NOT NULL,
  hash_versao                   STRING NOT NULL,
  execucao_id                   STRING,
  carregado_em                  TIMESTAMP NOT NULL
)
CLUSTER BY organization_id, conta_id, usuario_id;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_dim_rd_usuario` (
  organization_id               STRING NOT NULL,
  conta_id                      STRING NOT NULL,
  usuario_id                    STRING NOT NULL,
  ativo                         BOOL,
  execucao_id                   STRING NOT NULL,
  inserido_em                   TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE OR REPLACE VIEW `{{DATASET}}.vw_dim_rd_usuario` AS
SELECT
  d.*,
  atual.client_id AS cliente_atual_id,
  cliente_atual.nome AS cliente_atual_nome,
  atual.status AS fonte_status_atual,
  atual.nome AS fonte_nome_atual
FROM `{{DATASET}}.dim_rd_usuario_scd2` d
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = d.organization_id AND atual.platform = 'rdstation' AND atual.external_id = d.conta_id
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = d.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.fato_rd_negociacao_produtos` (
  organization_id               STRING NOT NULL,
  conta_id                      STRING NOT NULL,
  deal_id                       STRING NOT NULL,
  deal_produto_id               STRING NOT NULL,
  data_snapshot                 DATE NOT NULL,
  produto_id                    STRING,
  quantidade                    NUMERIC,
  preco                         NUMERIC,
  desconto                      NUMERIC,
  total                         NUMERIC,
  execucao_id                   STRING,
  inserido_em                   TIMESTAMP NOT NULL
)
PARTITION BY data_snapshot
CLUSTER BY organization_id, conta_id, deal_id;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_rd_negociacao_produtos` (
  organization_id               STRING NOT NULL,
  conta_id                      STRING NOT NULL,
  deal_id                       STRING NOT NULL,
  deal_produto_id               STRING NOT NULL,
  data_snapshot                 DATE NOT NULL,
  produto_id                    STRING,
  quantidade                    NUMERIC,
  preco                         NUMERIC,
  desconto                      NUMERIC,
  total                         NUMERIC,
  execucao_id                   STRING NOT NULL,
  inserido_em                   TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE OR REPLACE VIEW `{{DATASET}}.vw_rd_negociacao_produtos` AS
WITH fatos AS (
  SELECT *
  FROM `{{DATASET}}.fato_rd_negociacao_produtos`
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY organization_id, conta_id, deal_id, deal_produto_id, data_snapshot
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

CREATE TABLE IF NOT EXISTS `{{DATASET}}.fato_rd_negociacao_etapas` (
  organization_id               STRING NOT NULL,
  conta_id                      STRING NOT NULL,
  deal_id                       STRING NOT NULL,
  etapa_id                      STRING NOT NULL,
  entrou_em                     TIMESTAMP NOT NULL,
  data_dia                      DATE NOT NULL,
  execucao_id                   STRING,
  inserido_em                   TIMESTAMP NOT NULL
)
PARTITION BY data_dia
CLUSTER BY organization_id, conta_id, deal_id;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_rd_negociacao_etapas` (
  organization_id               STRING NOT NULL,
  conta_id                      STRING NOT NULL,
  deal_id                       STRING NOT NULL,
  etapa_id                      STRING NOT NULL,
  entrou_em                     TIMESTAMP NOT NULL,
  data_dia                      DATE NOT NULL,
  execucao_id                   STRING NOT NULL,
  inserido_em                   TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE OR REPLACE VIEW `{{DATASET}}.vw_rd_negociacao_etapas` AS
WITH fatos AS (
  SELECT *
  FROM `{{DATASET}}.fato_rd_negociacao_etapas`
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY organization_id, conta_id, deal_id, etapa_id, entrou_em
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
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') >= epoca.valido_de
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') < epoca.valido_ate
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = f.organization_id AND atual.platform = 'rdstation' AND atual.external_id = f.conta_id
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_epoca
  ON cliente_epoca.organization_id = f.organization_id AND cliente_epoca.client_id = epoca.client_id AND cliente_epoca.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = f.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.fato_rd_tarefas_diarias` (
  organization_id               STRING NOT NULL,
  conta_id                      STRING NOT NULL,
  data_dia                      DATE NOT NULL,
  tipo                          STRING NOT NULL,
  status                        STRING NOT NULL,
  quantidade                    INT64 NOT NULL,
  execucao_id                   STRING,
  inserido_em                   TIMESTAMP NOT NULL
)
PARTITION BY data_dia
CLUSTER BY organization_id, conta_id;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_rd_tarefas_diarias` (
  organization_id               STRING NOT NULL,
  conta_id                      STRING NOT NULL,
  data_dia                      DATE NOT NULL,
  tipo                          STRING NOT NULL,
  status                        STRING NOT NULL,
  quantidade                    INT64 NOT NULL,
  execucao_id                   STRING NOT NULL,
  inserido_em                   TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE OR REPLACE VIEW `{{DATASET}}.vw_rd_tarefas_diarias` AS
WITH fatos AS (
  SELECT *
  FROM `{{DATASET}}.fato_rd_tarefas_diarias`
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY organization_id, conta_id, data_dia, tipo, status
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
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') >= epoca.valido_de
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') < epoca.valido_ate
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = f.organization_id AND atual.platform = 'rdstation' AND atual.external_id = f.conta_id
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_epoca
  ON cliente_epoca.organization_id = f.organization_id AND cliente_epoca.client_id = epoca.client_id AND cliente_epoca.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = f.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual;
