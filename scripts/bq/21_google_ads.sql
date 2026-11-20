CREATE TABLE IF NOT EXISTS `{{DATASET}}.fato_google_campanha_diario` (
  organization_id             STRING NOT NULL,
  ad_account_id               STRING NOT NULL,
  data_dia                    DATE NOT NULL,
  external_campaign_id        STRING NOT NULL,
  investimento                NUMERIC,
  impressoes                  INT64,
  cliques                     INT64,
  conversoes                  NUMERIC,
  receita                     NUMERIC,
  todas_conversoes            NUMERIC,
  todas_conversoes_receita    NUMERIC,
  interacoes                  INT64,
  visualizacoes_video         INT64,
  parcela_impressoes_pesquisa NUMERIC,
  perdida_orcamento           NUMERIC,
  perdida_ranking             NUMERIC,
  parcela_topo                NUMERIC,
  parcela_topo_absoluto       NUMERIC,
  moeda                       STRING,
  execucao_id                 STRING,
  inserido_em                 TIMESTAMP NOT NULL
)
PARTITION BY data_dia
CLUSTER BY organization_id, ad_account_id, external_campaign_id;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_google_campanha_diario` (
  organization_id             STRING NOT NULL,
  ad_account_id               STRING NOT NULL,
  data_dia                    DATE NOT NULL,
  external_campaign_id        STRING NOT NULL,
  investimento                NUMERIC,
  impressoes                  INT64,
  cliques                     INT64,
  conversoes                  NUMERIC,
  receita                     NUMERIC,
  todas_conversoes            NUMERIC,
  todas_conversoes_receita    NUMERIC,
  interacoes                  INT64,
  visualizacoes_video         INT64,
  parcela_impressoes_pesquisa NUMERIC,
  perdida_orcamento           NUMERIC,
  perdida_ranking             NUMERIC,
  parcela_topo                NUMERIC,
  parcela_topo_absoluto       NUMERIC,
  moeda                       STRING,
  execucao_id                 STRING NOT NULL,
  inserido_em                 TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE OR REPLACE VIEW `{{DATASET}}.vw_google_campanha_diario` AS
WITH fatos AS (
  SELECT *
  FROM `{{DATASET}}.fato_google_campanha_diario`
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY organization_id, ad_account_id, external_campaign_id, data_dia
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
  ON epoca.organization_id = f.organization_id AND epoca.platform = 'google' AND epoca.external_id = f.ad_account_id
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') >= epoca.valido_de
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') < epoca.valido_ate
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = f.organization_id AND atual.platform = 'google' AND atual.external_id = f.ad_account_id
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_epoca
  ON cliente_epoca.organization_id = f.organization_id AND cliente_epoca.client_id = epoca.client_id AND cliente_epoca.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = f.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.fato_google_anuncio_diario` (
  organization_id             STRING NOT NULL,
  ad_account_id               STRING NOT NULL,
  data_dia                    DATE NOT NULL,
  external_campaign_id        STRING NOT NULL,
  ad_group_id                 STRING NOT NULL,
  ad_id                       STRING NOT NULL,
  investimento                NUMERIC,
  impressoes                  INT64,
  cliques                     INT64,
  conversoes                  NUMERIC,
  receita                     NUMERIC,
  todas_conversoes            NUMERIC,
  todas_conversoes_receita    NUMERIC,
  interacoes                  INT64,
  visualizacoes_video         INT64,
  moeda                       STRING,
  execucao_id                 STRING,
  inserido_em                 TIMESTAMP NOT NULL
)
PARTITION BY data_dia
CLUSTER BY organization_id, ad_account_id, external_campaign_id;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_google_anuncio_diario` (
  organization_id             STRING NOT NULL,
  ad_account_id               STRING NOT NULL,
  data_dia                    DATE NOT NULL,
  external_campaign_id        STRING NOT NULL,
  ad_group_id                 STRING NOT NULL,
  ad_id                       STRING NOT NULL,
  investimento                NUMERIC,
  impressoes                  INT64,
  cliques                     INT64,
  conversoes                  NUMERIC,
  receita                     NUMERIC,
  todas_conversoes            NUMERIC,
  todas_conversoes_receita    NUMERIC,
  interacoes                  INT64,
  visualizacoes_video         INT64,
  moeda                       STRING,
  execucao_id                 STRING NOT NULL,
  inserido_em                 TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE OR REPLACE VIEW `{{DATASET}}.vw_google_anuncio_diario` AS
WITH fatos AS (
  SELECT *
  FROM `{{DATASET}}.fato_google_anuncio_diario`
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY organization_id, ad_account_id, external_campaign_id, ad_group_id, ad_id, data_dia
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
  ON epoca.organization_id = f.organization_id AND epoca.platform = 'google' AND epoca.external_id = f.ad_account_id
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') >= epoca.valido_de
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') < epoca.valido_ate
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = f.organization_id AND atual.platform = 'google' AND atual.external_id = f.ad_account_id
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_epoca
  ON cliente_epoca.organization_id = f.organization_id AND cliente_epoca.client_id = epoca.client_id AND cliente_epoca.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = f.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.fato_google_palavra_chave_diario` (
  organization_id             STRING NOT NULL,
  ad_account_id               STRING NOT NULL,
  data_dia                    DATE NOT NULL,
  external_campaign_id        STRING NOT NULL,
  ad_group_id                 STRING NOT NULL,
  criterion_id                STRING NOT NULL,
  investimento                NUMERIC,
  impressoes                  INT64,
  cliques                     INT64,
  conversoes                  NUMERIC,
  receita                     NUMERIC,
  todas_conversoes            NUMERIC,
  todas_conversoes_receita    NUMERIC,
  interacoes                  INT64,
  visualizacoes_video         INT64,
  moeda                       STRING,
  execucao_id                 STRING,
  inserido_em                 TIMESTAMP NOT NULL
)
PARTITION BY data_dia
CLUSTER BY organization_id, ad_account_id, external_campaign_id;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_google_palavra_chave_diario` (
  organization_id             STRING NOT NULL,
  ad_account_id               STRING NOT NULL,
  data_dia                    DATE NOT NULL,
  external_campaign_id        STRING NOT NULL,
  ad_group_id                 STRING NOT NULL,
  criterion_id                STRING NOT NULL,
  investimento                NUMERIC,
  impressoes                  INT64,
  cliques                     INT64,
  conversoes                  NUMERIC,
  receita                     NUMERIC,
  todas_conversoes            NUMERIC,
  todas_conversoes_receita    NUMERIC,
  interacoes                  INT64,
  visualizacoes_video         INT64,
  moeda                       STRING,
  execucao_id                 STRING NOT NULL,
  inserido_em                 TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE OR REPLACE VIEW `{{DATASET}}.vw_google_palavra_chave_diario` AS
WITH fatos AS (
  SELECT *
  FROM `{{DATASET}}.fato_google_palavra_chave_diario`
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY organization_id, ad_account_id, external_campaign_id, ad_group_id, criterion_id, data_dia
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
  ON epoca.organization_id = f.organization_id AND epoca.platform = 'google' AND epoca.external_id = f.ad_account_id
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') >= epoca.valido_de
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') < epoca.valido_ate
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = f.organization_id AND atual.platform = 'google' AND atual.external_id = f.ad_account_id
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_epoca
  ON cliente_epoca.organization_id = f.organization_id AND cliente_epoca.client_id = epoca.client_id AND cliente_epoca.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = f.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.fato_google_termo_pesquisa_diario` (
  organization_id             STRING NOT NULL,
  ad_account_id               STRING NOT NULL,
  data_dia                    DATE NOT NULL,
  external_campaign_id        STRING NOT NULL,
  ad_group_id                 STRING NOT NULL,
  termo                       STRING NOT NULL,
  status_termo                STRING,
  investimento                NUMERIC,
  impressoes                  INT64,
  cliques                     INT64,
  conversoes                  NUMERIC,
  receita                     NUMERIC,
  todas_conversoes            NUMERIC,
  todas_conversoes_receita    NUMERIC,
  interacoes                  INT64,
  visualizacoes_video         INT64,
  moeda                       STRING,
  execucao_id                 STRING,
  inserido_em                 TIMESTAMP NOT NULL
)
PARTITION BY data_dia
CLUSTER BY organization_id, ad_account_id, external_campaign_id;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_google_termo_pesquisa_diario` (
  organization_id             STRING NOT NULL,
  ad_account_id               STRING NOT NULL,
  data_dia                    DATE NOT NULL,
  external_campaign_id        STRING NOT NULL,
  ad_group_id                 STRING NOT NULL,
  termo                       STRING NOT NULL,
  status_termo                STRING,
  investimento                NUMERIC,
  impressoes                  INT64,
  cliques                     INT64,
  conversoes                  NUMERIC,
  receita                     NUMERIC,
  todas_conversoes            NUMERIC,
  todas_conversoes_receita    NUMERIC,
  interacoes                  INT64,
  visualizacoes_video         INT64,
  moeda                       STRING,
  execucao_id                 STRING NOT NULL,
  inserido_em                 TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE OR REPLACE VIEW `{{DATASET}}.vw_google_termo_pesquisa_diario` AS
WITH fatos AS (
  SELECT *
  FROM `{{DATASET}}.fato_google_termo_pesquisa_diario`
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY organization_id, ad_account_id, external_campaign_id, ad_group_id, termo, data_dia
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
  ON epoca.organization_id = f.organization_id AND epoca.platform = 'google' AND epoca.external_id = f.ad_account_id
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') >= epoca.valido_de
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') < epoca.valido_ate
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = f.organization_id AND atual.platform = 'google' AND atual.external_id = f.ad_account_id
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_epoca
  ON cliente_epoca.organization_id = f.organization_id AND cliente_epoca.client_id = epoca.client_id AND cliente_epoca.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = f.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.fato_google_conversao_diario` (
  organization_id             STRING NOT NULL,
  ad_account_id               STRING NOT NULL,
  data_dia                    DATE NOT NULL,
  external_campaign_id        STRING NOT NULL,
  conversion_action_id        STRING NOT NULL,
  acao_nome                   STRING,
  acao_categoria              STRING,
  conversoes                  NUMERIC,
  receita                     NUMERIC,
  todas_conversoes            NUMERIC,
  todas_conversoes_receita    NUMERIC,
  moeda                       STRING,
  execucao_id                 STRING,
  inserido_em                 TIMESTAMP NOT NULL
)
PARTITION BY data_dia
CLUSTER BY organization_id, ad_account_id, external_campaign_id;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_google_conversao_diario` (
  organization_id             STRING NOT NULL,
  ad_account_id               STRING NOT NULL,
  data_dia                    DATE NOT NULL,
  external_campaign_id        STRING NOT NULL,
  conversion_action_id        STRING NOT NULL,
  acao_nome                   STRING,
  acao_categoria              STRING,
  conversoes                  NUMERIC,
  receita                     NUMERIC,
  todas_conversoes            NUMERIC,
  todas_conversoes_receita    NUMERIC,
  moeda                       STRING,
  execucao_id                 STRING NOT NULL,
  inserido_em                 TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE OR REPLACE VIEW `{{DATASET}}.vw_google_conversao_diario` AS
WITH fatos AS (
  SELECT *
  FROM `{{DATASET}}.fato_google_conversao_diario`
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY organization_id, ad_account_id, external_campaign_id, conversion_action_id, data_dia
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
  ON epoca.organization_id = f.organization_id AND epoca.platform = 'google' AND epoca.external_id = f.ad_account_id
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') >= epoca.valido_de
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') < epoca.valido_ate
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = f.organization_id AND atual.platform = 'google' AND atual.external_id = f.ad_account_id
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_epoca
  ON cliente_epoca.organization_id = f.organization_id AND cliente_epoca.client_id = epoca.client_id AND cliente_epoca.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = f.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.fato_google_dispositivo_diario` (
  organization_id             STRING NOT NULL,
  ad_account_id               STRING NOT NULL,
  data_dia                    DATE NOT NULL,
  external_campaign_id        STRING NOT NULL,
  dispositivo                 STRING NOT NULL,
  investimento                NUMERIC,
  impressoes                  INT64,
  cliques                     INT64,
  conversoes                  NUMERIC,
  receita                     NUMERIC,
  todas_conversoes            NUMERIC,
  todas_conversoes_receita    NUMERIC,
  interacoes                  INT64,
  visualizacoes_video         INT64,
  moeda                       STRING,
  execucao_id                 STRING,
  inserido_em                 TIMESTAMP NOT NULL
)
PARTITION BY data_dia
CLUSTER BY organization_id, ad_account_id, external_campaign_id;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_google_dispositivo_diario` (
  organization_id             STRING NOT NULL,
  ad_account_id               STRING NOT NULL,
  data_dia                    DATE NOT NULL,
  external_campaign_id        STRING NOT NULL,
  dispositivo                 STRING NOT NULL,
  investimento                NUMERIC,
  impressoes                  INT64,
  cliques                     INT64,
  conversoes                  NUMERIC,
  receita                     NUMERIC,
  todas_conversoes            NUMERIC,
  todas_conversoes_receita    NUMERIC,
  interacoes                  INT64,
  visualizacoes_video         INT64,
  moeda                       STRING,
  execucao_id                 STRING NOT NULL,
  inserido_em                 TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE OR REPLACE VIEW `{{DATASET}}.vw_google_dispositivo_diario` AS
WITH fatos AS (
  SELECT *
  FROM `{{DATASET}}.fato_google_dispositivo_diario`
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY organization_id, ad_account_id, external_campaign_id, dispositivo, data_dia
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
  ON epoca.organization_id = f.organization_id AND epoca.platform = 'google' AND epoca.external_id = f.ad_account_id
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') >= epoca.valido_de
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') < epoca.valido_ate
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = f.organization_id AND atual.platform = 'google' AND atual.external_id = f.ad_account_id
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_epoca
  ON cliente_epoca.organization_id = f.organization_id AND cliente_epoca.client_id = epoca.client_id AND cliente_epoca.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = f.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.fato_google_rede_diario` (
  organization_id             STRING NOT NULL,
  ad_account_id               STRING NOT NULL,
  data_dia                    DATE NOT NULL,
  external_campaign_id        STRING NOT NULL,
  rede                        STRING NOT NULL,
  investimento                NUMERIC,
  impressoes                  INT64,
  cliques                     INT64,
  conversoes                  NUMERIC,
  receita                     NUMERIC,
  todas_conversoes            NUMERIC,
  todas_conversoes_receita    NUMERIC,
  interacoes                  INT64,
  visualizacoes_video         INT64,
  moeda                       STRING,
  execucao_id                 STRING,
  inserido_em                 TIMESTAMP NOT NULL
)
PARTITION BY data_dia
CLUSTER BY organization_id, ad_account_id, external_campaign_id;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_google_rede_diario` (
  organization_id             STRING NOT NULL,
  ad_account_id               STRING NOT NULL,
  data_dia                    DATE NOT NULL,
  external_campaign_id        STRING NOT NULL,
  rede                        STRING NOT NULL,
  investimento                NUMERIC,
  impressoes                  INT64,
  cliques                     INT64,
  conversoes                  NUMERIC,
  receita                     NUMERIC,
  todas_conversoes            NUMERIC,
  todas_conversoes_receita    NUMERIC,
  interacoes                  INT64,
  visualizacoes_video         INT64,
  moeda                       STRING,
  execucao_id                 STRING NOT NULL,
  inserido_em                 TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE OR REPLACE VIEW `{{DATASET}}.vw_google_rede_diario` AS
WITH fatos AS (
  SELECT *
  FROM `{{DATASET}}.fato_google_rede_diario`
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY organization_id, ad_account_id, external_campaign_id, rede, data_dia
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
  ON epoca.organization_id = f.organization_id AND epoca.platform = 'google' AND epoca.external_id = f.ad_account_id
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') >= epoca.valido_de
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') < epoca.valido_ate
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = f.organization_id AND atual.platform = 'google' AND atual.external_id = f.ad_account_id
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_epoca
  ON cliente_epoca.organization_id = f.organization_id AND cliente_epoca.client_id = epoca.client_id AND cliente_epoca.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = f.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.fato_google_geo_diario` (
  organization_id             STRING NOT NULL,
  ad_account_id               STRING NOT NULL,
  data_dia                    DATE NOT NULL,
  external_campaign_id        STRING NOT NULL,
  pais_criterio_id            STRING NOT NULL,
  tipo_localizacao            STRING NOT NULL,
  investimento                NUMERIC,
  impressoes                  INT64,
  cliques                     INT64,
  conversoes                  NUMERIC,
  receita                     NUMERIC,
  todas_conversoes            NUMERIC,
  todas_conversoes_receita    NUMERIC,
  interacoes                  INT64,
  visualizacoes_video         INT64,
  moeda                       STRING,
  execucao_id                 STRING,
  inserido_em                 TIMESTAMP NOT NULL
)
PARTITION BY data_dia
CLUSTER BY organization_id, ad_account_id, external_campaign_id;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_google_geo_diario` (
  organization_id             STRING NOT NULL,
  ad_account_id               STRING NOT NULL,
  data_dia                    DATE NOT NULL,
  external_campaign_id        STRING NOT NULL,
  pais_criterio_id            STRING NOT NULL,
  tipo_localizacao            STRING NOT NULL,
  investimento                NUMERIC,
  impressoes                  INT64,
  cliques                     INT64,
  conversoes                  NUMERIC,
  receita                     NUMERIC,
  todas_conversoes            NUMERIC,
  todas_conversoes_receita    NUMERIC,
  interacoes                  INT64,
  visualizacoes_video         INT64,
  moeda                       STRING,
  execucao_id                 STRING NOT NULL,
  inserido_em                 TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE OR REPLACE VIEW `{{DATASET}}.vw_google_geo_diario` AS
WITH fatos AS (
  SELECT *
  FROM `{{DATASET}}.fato_google_geo_diario`
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY organization_id, ad_account_id, external_campaign_id, pais_criterio_id, tipo_localizacao, data_dia
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
  ON epoca.organization_id = f.organization_id AND epoca.platform = 'google' AND epoca.external_id = f.ad_account_id
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') >= epoca.valido_de
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') < epoca.valido_ate
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = f.organization_id AND atual.platform = 'google' AND atual.external_id = f.ad_account_id
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_epoca
  ON cliente_epoca.organization_id = f.organization_id AND cliente_epoca.client_id = epoca.client_id AND cliente_epoca.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = f.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.fato_google_idade_diario` (
  organization_id             STRING NOT NULL,
  ad_account_id               STRING NOT NULL,
  data_dia                    DATE NOT NULL,
  external_campaign_id        STRING NOT NULL,
  ad_group_id                 STRING NOT NULL,
  faixa_etaria                STRING NOT NULL,
  investimento                NUMERIC,
  impressoes                  INT64,
  cliques                     INT64,
  conversoes                  NUMERIC,
  receita                     NUMERIC,
  todas_conversoes            NUMERIC,
  todas_conversoes_receita    NUMERIC,
  interacoes                  INT64,
  visualizacoes_video         INT64,
  moeda                       STRING,
  execucao_id                 STRING,
  inserido_em                 TIMESTAMP NOT NULL
)
PARTITION BY data_dia
CLUSTER BY organization_id, ad_account_id, external_campaign_id;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_google_idade_diario` (
  organization_id             STRING NOT NULL,
  ad_account_id               STRING NOT NULL,
  data_dia                    DATE NOT NULL,
  external_campaign_id        STRING NOT NULL,
  ad_group_id                 STRING NOT NULL,
  faixa_etaria                STRING NOT NULL,
  investimento                NUMERIC,
  impressoes                  INT64,
  cliques                     INT64,
  conversoes                  NUMERIC,
  receita                     NUMERIC,
  todas_conversoes            NUMERIC,
  todas_conversoes_receita    NUMERIC,
  interacoes                  INT64,
  visualizacoes_video         INT64,
  moeda                       STRING,
  execucao_id                 STRING NOT NULL,
  inserido_em                 TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE OR REPLACE VIEW `{{DATASET}}.vw_google_idade_diario` AS
WITH fatos AS (
  SELECT *
  FROM `{{DATASET}}.fato_google_idade_diario`
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY organization_id, ad_account_id, external_campaign_id, ad_group_id, faixa_etaria, data_dia
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
  ON epoca.organization_id = f.organization_id AND epoca.platform = 'google' AND epoca.external_id = f.ad_account_id
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') >= epoca.valido_de
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') < epoca.valido_ate
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = f.organization_id AND atual.platform = 'google' AND atual.external_id = f.ad_account_id
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_epoca
  ON cliente_epoca.organization_id = f.organization_id AND cliente_epoca.client_id = epoca.client_id AND cliente_epoca.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = f.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.fato_google_genero_diario` (
  organization_id             STRING NOT NULL,
  ad_account_id               STRING NOT NULL,
  data_dia                    DATE NOT NULL,
  external_campaign_id        STRING NOT NULL,
  ad_group_id                 STRING NOT NULL,
  genero                      STRING NOT NULL,
  investimento                NUMERIC,
  impressoes                  INT64,
  cliques                     INT64,
  conversoes                  NUMERIC,
  receita                     NUMERIC,
  todas_conversoes            NUMERIC,
  todas_conversoes_receita    NUMERIC,
  interacoes                  INT64,
  visualizacoes_video         INT64,
  moeda                       STRING,
  execucao_id                 STRING,
  inserido_em                 TIMESTAMP NOT NULL
)
PARTITION BY data_dia
CLUSTER BY organization_id, ad_account_id, external_campaign_id;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_google_genero_diario` (
  organization_id             STRING NOT NULL,
  ad_account_id               STRING NOT NULL,
  data_dia                    DATE NOT NULL,
  external_campaign_id        STRING NOT NULL,
  ad_group_id                 STRING NOT NULL,
  genero                      STRING NOT NULL,
  investimento                NUMERIC,
  impressoes                  INT64,
  cliques                     INT64,
  conversoes                  NUMERIC,
  receita                     NUMERIC,
  todas_conversoes            NUMERIC,
  todas_conversoes_receita    NUMERIC,
  interacoes                  INT64,
  visualizacoes_video         INT64,
  moeda                       STRING,
  execucao_id                 STRING NOT NULL,
  inserido_em                 TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE OR REPLACE VIEW `{{DATASET}}.vw_google_genero_diario` AS
WITH fatos AS (
  SELECT *
  FROM `{{DATASET}}.fato_google_genero_diario`
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY organization_id, ad_account_id, external_campaign_id, ad_group_id, genero, data_dia
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
  ON epoca.organization_id = f.organization_id AND epoca.platform = 'google' AND epoca.external_id = f.ad_account_id
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') >= epoca.valido_de
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') < epoca.valido_ate
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = f.organization_id AND atual.platform = 'google' AND atual.external_id = f.ad_account_id
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_epoca
  ON cliente_epoca.organization_id = f.organization_id AND cliente_epoca.client_id = epoca.client_id AND cliente_epoca.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = f.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.fato_google_grupo_ativos_diario` (
  organization_id             STRING NOT NULL,
  ad_account_id               STRING NOT NULL,
  data_dia                    DATE NOT NULL,
  external_campaign_id        STRING NOT NULL,
  asset_group_id              STRING NOT NULL,
  investimento                NUMERIC,
  impressoes                  INT64,
  cliques                     INT64,
  conversoes                  NUMERIC,
  receita                     NUMERIC,
  todas_conversoes            NUMERIC,
  todas_conversoes_receita    NUMERIC,
  interacoes                  INT64,
  moeda                       STRING,
  execucao_id                 STRING,
  inserido_em                 TIMESTAMP NOT NULL
)
PARTITION BY data_dia
CLUSTER BY organization_id, ad_account_id, external_campaign_id;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_google_grupo_ativos_diario` (
  organization_id             STRING NOT NULL,
  ad_account_id               STRING NOT NULL,
  data_dia                    DATE NOT NULL,
  external_campaign_id        STRING NOT NULL,
  asset_group_id              STRING NOT NULL,
  investimento                NUMERIC,
  impressoes                  INT64,
  cliques                     INT64,
  conversoes                  NUMERIC,
  receita                     NUMERIC,
  todas_conversoes            NUMERIC,
  todas_conversoes_receita    NUMERIC,
  interacoes                  INT64,
  moeda                       STRING,
  execucao_id                 STRING NOT NULL,
  inserido_em                 TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE OR REPLACE VIEW `{{DATASET}}.vw_google_grupo_ativos_diario` AS
WITH fatos AS (
  SELECT *
  FROM `{{DATASET}}.fato_google_grupo_ativos_diario`
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY organization_id, ad_account_id, external_campaign_id, asset_group_id, data_dia
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
  ON epoca.organization_id = f.organization_id AND epoca.platform = 'google' AND epoca.external_id = f.ad_account_id
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') >= epoca.valido_de
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') < epoca.valido_ate
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = f.organization_id AND atual.platform = 'google' AND atual.external_id = f.ad_account_id
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_epoca
  ON cliente_epoca.organization_id = f.organization_id AND cliente_epoca.client_id = epoca.client_id AND cliente_epoca.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = f.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.dim_google_campanha_scd2` (
  organization_id             STRING NOT NULL,
  ad_account_id               STRING NOT NULL,
  external_campaign_id        STRING NOT NULL,
  nome                        STRING,
  status                      STRING,
  canal                       STRING,
  subcanal                    STRING,
  estrategia_lance            STRING,
  orcamento                   NUMERIC,
  orcamento_compartilhado     BOOL,
  valido_de                   TIMESTAMP NOT NULL,
  valido_ate                  TIMESTAMP NOT NULL,
  atual                       BOOL NOT NULL,
  hash_versao                 STRING NOT NULL,
  execucao_id                 STRING,
  carregado_em                TIMESTAMP NOT NULL
)
CLUSTER BY organization_id, ad_account_id, external_campaign_id;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_google_campanha` (
  organization_id             STRING NOT NULL,
  ad_account_id               STRING NOT NULL,
  external_campaign_id        STRING NOT NULL,
  nome                        STRING,
  status                      STRING,
  canal                       STRING,
  subcanal                    STRING,
  estrategia_lance            STRING,
  orcamento                   NUMERIC,
  orcamento_compartilhado     BOOL,
  execucao_id                 STRING NOT NULL,
  inserido_em                 TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE OR REPLACE VIEW `{{DATASET}}.vw_dim_google_campanha` AS
SELECT
  f.*,
  atual.client_id AS cliente_atual_id,
  cliente_atual.nome AS cliente_atual_nome,
  atual.status AS fonte_status_atual,
  atual.nome AS fonte_nome_atual
FROM `{{DATASET}}.dim_google_campanha_scd2` f
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = f.organization_id AND atual.platform = 'google' AND atual.external_id = f.ad_account_id
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = f.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.dim_google_grupo_anuncios_scd2` (
  organization_id             STRING NOT NULL,
  ad_account_id               STRING NOT NULL,
  ad_group_id                 STRING NOT NULL,
  external_campaign_id        STRING,
  nome                        STRING,
  status                      STRING,
  tipo                        STRING,
  valido_de                   TIMESTAMP NOT NULL,
  valido_ate                  TIMESTAMP NOT NULL,
  atual                       BOOL NOT NULL,
  hash_versao                 STRING NOT NULL,
  execucao_id                 STRING,
  carregado_em                TIMESTAMP NOT NULL
)
CLUSTER BY organization_id, ad_account_id, ad_group_id;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_google_grupo_anuncios` (
  organization_id             STRING NOT NULL,
  ad_account_id               STRING NOT NULL,
  ad_group_id                 STRING NOT NULL,
  external_campaign_id        STRING,
  nome                        STRING,
  status                      STRING,
  tipo                        STRING,
  execucao_id                 STRING NOT NULL,
  inserido_em                 TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE OR REPLACE VIEW `{{DATASET}}.vw_dim_google_grupo_anuncios` AS
SELECT
  f.*,
  atual.client_id AS cliente_atual_id,
  cliente_atual.nome AS cliente_atual_nome,
  atual.status AS fonte_status_atual,
  atual.nome AS fonte_nome_atual
FROM `{{DATASET}}.dim_google_grupo_anuncios_scd2` f
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = f.organization_id AND atual.platform = 'google' AND atual.external_id = f.ad_account_id
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = f.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.dim_google_anuncio_scd2` (
  organization_id             STRING NOT NULL,
  ad_account_id               STRING NOT NULL,
  ad_id                       STRING NOT NULL,
  ad_group_id                 STRING,
  external_campaign_id        STRING,
  nome                        STRING,
  tipo                        STRING,
  status                      STRING,
  aprovacao                   STRING,
  valido_de                   TIMESTAMP NOT NULL,
  valido_ate                  TIMESTAMP NOT NULL,
  atual                       BOOL NOT NULL,
  hash_versao                 STRING NOT NULL,
  execucao_id                 STRING,
  carregado_em                TIMESTAMP NOT NULL
)
CLUSTER BY organization_id, ad_account_id, ad_id;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_google_anuncio` (
  organization_id             STRING NOT NULL,
  ad_account_id               STRING NOT NULL,
  ad_id                       STRING NOT NULL,
  ad_group_id                 STRING,
  external_campaign_id        STRING,
  nome                        STRING,
  tipo                        STRING,
  status                      STRING,
  aprovacao                   STRING,
  execucao_id                 STRING NOT NULL,
  inserido_em                 TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE OR REPLACE VIEW `{{DATASET}}.vw_dim_google_anuncio` AS
SELECT
  f.*,
  atual.client_id AS cliente_atual_id,
  cliente_atual.nome AS cliente_atual_nome,
  atual.status AS fonte_status_atual,
  atual.nome AS fonte_nome_atual
FROM `{{DATASET}}.dim_google_anuncio_scd2` f
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = f.organization_id AND atual.platform = 'google' AND atual.external_id = f.ad_account_id
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = f.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.dim_google_palavra_chave_scd2` (
  organization_id             STRING NOT NULL,
  ad_account_id               STRING NOT NULL,
  ad_group_id                 STRING NOT NULL,
  criterion_id                STRING NOT NULL,
  external_campaign_id        STRING,
  texto                       STRING,
  correspondencia             STRING,
  status                      STRING,
  negativa                    BOOL,
  nota_qualidade              INT64,
  valido_de                   TIMESTAMP NOT NULL,
  valido_ate                  TIMESTAMP NOT NULL,
  atual                       BOOL NOT NULL,
  hash_versao                 STRING NOT NULL,
  execucao_id                 STRING,
  carregado_em                TIMESTAMP NOT NULL
)
CLUSTER BY organization_id, ad_account_id, ad_group_id, criterion_id;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_google_palavra_chave` (
  organization_id             STRING NOT NULL,
  ad_account_id               STRING NOT NULL,
  ad_group_id                 STRING NOT NULL,
  criterion_id                STRING NOT NULL,
  external_campaign_id        STRING,
  texto                       STRING,
  correspondencia             STRING,
  status                      STRING,
  negativa                    BOOL,
  nota_qualidade              INT64,
  execucao_id                 STRING NOT NULL,
  inserido_em                 TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE OR REPLACE VIEW `{{DATASET}}.vw_dim_google_palavra_chave` AS
SELECT
  f.*,
  atual.client_id AS cliente_atual_id,
  cliente_atual.nome AS cliente_atual_nome,
  atual.status AS fonte_status_atual,
  atual.nome AS fonte_nome_atual
FROM `{{DATASET}}.dim_google_palavra_chave_scd2` f
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = f.organization_id AND atual.platform = 'google' AND atual.external_id = f.ad_account_id
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = f.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.dim_google_grupo_ativos_scd2` (
  organization_id             STRING NOT NULL,
  ad_account_id               STRING NOT NULL,
  asset_group_id              STRING NOT NULL,
  external_campaign_id        STRING,
  nome                        STRING,
  status                      STRING,
  valido_de                   TIMESTAMP NOT NULL,
  valido_ate                  TIMESTAMP NOT NULL,
  atual                       BOOL NOT NULL,
  hash_versao                 STRING NOT NULL,
  execucao_id                 STRING,
  carregado_em                TIMESTAMP NOT NULL
)
CLUSTER BY organization_id, ad_account_id, asset_group_id;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_google_grupo_ativos` (
  organization_id             STRING NOT NULL,
  ad_account_id               STRING NOT NULL,
  asset_group_id              STRING NOT NULL,
  external_campaign_id        STRING,
  nome                        STRING,
  status                      STRING,
  execucao_id                 STRING NOT NULL,
  inserido_em                 TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE OR REPLACE VIEW `{{DATASET}}.vw_dim_google_grupo_ativos` AS
SELECT
  f.*,
  atual.client_id AS cliente_atual_id,
  cliente_atual.nome AS cliente_atual_nome,
  atual.status AS fonte_status_atual,
  atual.nome AS fonte_nome_atual
FROM `{{DATASET}}.dim_google_grupo_ativos_scd2` f
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = f.organization_id AND atual.platform = 'google' AND atual.external_id = f.ad_account_id
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = f.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual;

