CREATE TABLE IF NOT EXISTS `{{DATASET}}.dim_gtm_conteiner_scd2` (
  organization_id               STRING NOT NULL,
  conteiner_id                  STRING NOT NULL,
  nome                          STRING,
  conta_gtm_id                  STRING,
  conteiner_gtm_id              STRING,
  contexto_de_uso               STRING,
  dominios                      STRING,
  valido_de                     TIMESTAMP NOT NULL,
  valido_ate                    TIMESTAMP NOT NULL,
  atual                         BOOL NOT NULL,
  hash_versao                   STRING NOT NULL,
  execucao_id                   STRING,
  carregado_em                  TIMESTAMP NOT NULL
)
CLUSTER BY organization_id, conteiner_id;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_dim_gtm_conteiner` (
  organization_id               STRING NOT NULL,
  conteiner_id                  STRING NOT NULL,
  nome                          STRING,
  conta_gtm_id                  STRING,
  conteiner_gtm_id              STRING,
  contexto_de_uso               STRING,
  dominios                      STRING,
  execucao_id                   STRING NOT NULL,
  inserido_em                   TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE OR REPLACE VIEW `{{DATASET}}.vw_dim_gtm_conteiner` AS
SELECT
  d.*,
  atual.client_id AS cliente_atual_id,
  cliente_atual.nome AS cliente_atual_nome,
  atual.status AS fonte_status_atual,
  atual.nome AS fonte_nome_atual
FROM `{{DATASET}}.dim_gtm_conteiner_scd2` d
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = d.organization_id AND atual.platform = 'gtm' AND atual.external_id = d.conteiner_id
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = d.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.dim_gtm_workspace_scd2` (
  organization_id               STRING NOT NULL,
  conteiner_id                  STRING NOT NULL,
  workspace_id                  STRING NOT NULL,
  nome                          STRING,
  valido_de                     TIMESTAMP NOT NULL,
  valido_ate                    TIMESTAMP NOT NULL,
  atual                         BOOL NOT NULL,
  hash_versao                   STRING NOT NULL,
  execucao_id                   STRING,
  carregado_em                  TIMESTAMP NOT NULL
)
CLUSTER BY organization_id, conteiner_id, workspace_id;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_dim_gtm_workspace` (
  organization_id               STRING NOT NULL,
  conteiner_id                  STRING NOT NULL,
  workspace_id                  STRING NOT NULL,
  nome                          STRING,
  execucao_id                   STRING NOT NULL,
  inserido_em                   TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE OR REPLACE VIEW `{{DATASET}}.vw_dim_gtm_workspace` AS
SELECT
  d.*,
  atual.client_id AS cliente_atual_id,
  cliente_atual.nome AS cliente_atual_nome,
  atual.status AS fonte_status_atual,
  atual.nome AS fonte_nome_atual
FROM `{{DATASET}}.dim_gtm_workspace_scd2` d
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = d.organization_id AND atual.platform = 'gtm' AND atual.external_id = d.conteiner_id
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = d.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.dim_gtm_versao_scd2` (
  organization_id               STRING NOT NULL,
  conteiner_id                  STRING NOT NULL,
  versao_id                     STRING,
  nome                          STRING,
  total_tags                    INT64,
  total_acionadores             INT64,
  total_variaveis               INT64,
  valido_de                     TIMESTAMP NOT NULL,
  valido_ate                    TIMESTAMP NOT NULL,
  atual                         BOOL NOT NULL,
  hash_versao                   STRING NOT NULL,
  execucao_id                   STRING,
  carregado_em                  TIMESTAMP NOT NULL
)
CLUSTER BY organization_id, conteiner_id;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_dim_gtm_versao` (
  organization_id               STRING NOT NULL,
  conteiner_id                  STRING NOT NULL,
  versao_id                     STRING,
  nome                          STRING,
  total_tags                    INT64,
  total_acionadores             INT64,
  total_variaveis               INT64,
  execucao_id                   STRING NOT NULL,
  inserido_em                   TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE OR REPLACE VIEW `{{DATASET}}.vw_dim_gtm_versao` AS
SELECT
  d.*,
  atual.client_id AS cliente_atual_id,
  cliente_atual.nome AS cliente_atual_nome,
  atual.status AS fonte_status_atual,
  atual.nome AS fonte_nome_atual
FROM `{{DATASET}}.dim_gtm_versao_scd2` d
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = d.organization_id AND atual.platform = 'gtm' AND atual.external_id = d.conteiner_id
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = d.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.dim_gtm_tag_scd2` (
  organization_id               STRING NOT NULL,
  conteiner_id                  STRING NOT NULL,
  tag_id                        STRING NOT NULL,
  nome                          STRING,
  tipo                          STRING,
  acionadores_disparo           STRING,
  acionadores_bloqueio          STRING,
  pausada                       BOOL,
  valido_de                     TIMESTAMP NOT NULL,
  valido_ate                    TIMESTAMP NOT NULL,
  atual                         BOOL NOT NULL,
  hash_versao                   STRING NOT NULL,
  execucao_id                   STRING,
  carregado_em                  TIMESTAMP NOT NULL
)
CLUSTER BY organization_id, conteiner_id, tag_id;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_dim_gtm_tag` (
  organization_id               STRING NOT NULL,
  conteiner_id                  STRING NOT NULL,
  tag_id                        STRING NOT NULL,
  nome                          STRING,
  tipo                          STRING,
  acionadores_disparo           STRING,
  acionadores_bloqueio          STRING,
  pausada                       BOOL,
  execucao_id                   STRING NOT NULL,
  inserido_em                   TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE OR REPLACE VIEW `{{DATASET}}.vw_dim_gtm_tag` AS
SELECT
  d.*,
  atual.client_id AS cliente_atual_id,
  cliente_atual.nome AS cliente_atual_nome,
  atual.status AS fonte_status_atual,
  atual.nome AS fonte_nome_atual
FROM `{{DATASET}}.dim_gtm_tag_scd2` d
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = d.organization_id AND atual.platform = 'gtm' AND atual.external_id = d.conteiner_id
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = d.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.dim_gtm_acionador_scd2` (
  organization_id               STRING NOT NULL,
  conteiner_id                  STRING NOT NULL,
  acionador_id                  STRING NOT NULL,
  nome                          STRING,
  tipo                          STRING,
  valido_de                     TIMESTAMP NOT NULL,
  valido_ate                    TIMESTAMP NOT NULL,
  atual                         BOOL NOT NULL,
  hash_versao                   STRING NOT NULL,
  execucao_id                   STRING,
  carregado_em                  TIMESTAMP NOT NULL
)
CLUSTER BY organization_id, conteiner_id, acionador_id;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_dim_gtm_acionador` (
  organization_id               STRING NOT NULL,
  conteiner_id                  STRING NOT NULL,
  acionador_id                  STRING NOT NULL,
  nome                          STRING,
  tipo                          STRING,
  execucao_id                   STRING NOT NULL,
  inserido_em                   TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE OR REPLACE VIEW `{{DATASET}}.vw_dim_gtm_acionador` AS
SELECT
  d.*,
  atual.client_id AS cliente_atual_id,
  cliente_atual.nome AS cliente_atual_nome,
  atual.status AS fonte_status_atual,
  atual.nome AS fonte_nome_atual
FROM `{{DATASET}}.dim_gtm_acionador_scd2` d
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = d.organization_id AND atual.platform = 'gtm' AND atual.external_id = d.conteiner_id
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = d.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.dim_gtm_variavel_scd2` (
  organization_id               STRING NOT NULL,
  conteiner_id                  STRING NOT NULL,
  variavel_id                   STRING NOT NULL,
  nome                          STRING,
  tipo                          STRING,
  valido_de                     TIMESTAMP NOT NULL,
  valido_ate                    TIMESTAMP NOT NULL,
  atual                         BOOL NOT NULL,
  hash_versao                   STRING NOT NULL,
  execucao_id                   STRING,
  carregado_em                  TIMESTAMP NOT NULL
)
CLUSTER BY organization_id, conteiner_id, variavel_id;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_dim_gtm_variavel` (
  organization_id               STRING NOT NULL,
  conteiner_id                  STRING NOT NULL,
  variavel_id                   STRING NOT NULL,
  nome                          STRING,
  tipo                          STRING,
  execucao_id                   STRING NOT NULL,
  inserido_em                   TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE OR REPLACE VIEW `{{DATASET}}.vw_dim_gtm_variavel` AS
SELECT
  d.*,
  atual.client_id AS cliente_atual_id,
  cliente_atual.nome AS cliente_atual_nome,
  atual.status AS fonte_status_atual,
  atual.nome AS fonte_nome_atual
FROM `{{DATASET}}.dim_gtm_variavel_scd2` d
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = d.organization_id AND atual.platform = 'gtm' AND atual.external_id = d.conteiner_id
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = d.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual;
