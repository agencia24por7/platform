CREATE TABLE IF NOT EXISTS `{{DATASET}}.fato_search_console_consulta_pagina_diario` (
  organization_id         STRING NOT NULL,
  site                    STRING NOT NULL,
  data_dia                DATE NOT NULL,
  consulta                STRING NOT NULL,
  pagina                  STRING NOT NULL,
  cliques                 INT64,
  impressoes              INT64,
  ctr                     NUMERIC,
  posicao_media           NUMERIC,
  execucao_id             STRING,
  inserido_em             TIMESTAMP NOT NULL
)
PARTITION BY data_dia
CLUSTER BY organization_id, site, consulta;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_search_console_consulta_pagina_diario` (
  organization_id         STRING NOT NULL,
  site                    STRING NOT NULL,
  data_dia                DATE NOT NULL,
  consulta                STRING NOT NULL,
  pagina                  STRING NOT NULL,
  cliques                 INT64,
  impressoes              INT64,
  ctr                     NUMERIC,
  posicao_media           NUMERIC,
  execucao_id             STRING NOT NULL,
  inserido_em             TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE TABLE IF NOT EXISTS `{{DATASET}}.fato_search_console_pagina_diario` (
  organization_id         STRING NOT NULL,
  site                    STRING NOT NULL,
  data_dia                DATE NOT NULL,
  pagina                  STRING NOT NULL,
  cliques                 INT64,
  impressoes              INT64,
  ctr                     NUMERIC,
  posicao_media           NUMERIC,
  execucao_id             STRING,
  inserido_em             TIMESTAMP NOT NULL
)
PARTITION BY data_dia
CLUSTER BY organization_id, site, pagina;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_search_console_pagina_diario` (
  organization_id         STRING NOT NULL,
  site                    STRING NOT NULL,
  data_dia                DATE NOT NULL,
  pagina                  STRING NOT NULL,
  cliques                 INT64,
  impressoes              INT64,
  ctr                     NUMERIC,
  posicao_media           NUMERIC,
  execucao_id             STRING NOT NULL,
  inserido_em             TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE TABLE IF NOT EXISTS `{{DATASET}}.fato_search_console_pais_dispositivo_diario` (
  organization_id         STRING NOT NULL,
  site                    STRING NOT NULL,
  data_dia                DATE NOT NULL,
  pais                    STRING NOT NULL,
  dispositivo             STRING NOT NULL,
  cliques                 INT64,
  impressoes              INT64,
  ctr                     NUMERIC,
  posicao_media           NUMERIC,
  execucao_id             STRING,
  inserido_em             TIMESTAMP NOT NULL
)
PARTITION BY data_dia
CLUSTER BY organization_id, site, pais;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_search_console_pais_dispositivo_diario` (
  organization_id         STRING NOT NULL,
  site                    STRING NOT NULL,
  data_dia                DATE NOT NULL,
  pais                    STRING NOT NULL,
  dispositivo             STRING NOT NULL,
  cliques                 INT64,
  impressoes              INT64,
  ctr                     NUMERIC,
  posicao_media           NUMERIC,
  execucao_id             STRING NOT NULL,
  inserido_em             TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE TABLE IF NOT EXISTS `{{DATASET}}.fato_search_console_aparencia_diario` (
  organization_id         STRING NOT NULL,
  site                    STRING NOT NULL,
  data_dia                DATE NOT NULL,
  aparencia               STRING NOT NULL,
  cliques                 INT64,
  impressoes              INT64,
  ctr                     NUMERIC,
  posicao_media           NUMERIC,
  execucao_id             STRING,
  inserido_em             TIMESTAMP NOT NULL
)
PARTITION BY data_dia
CLUSTER BY organization_id, site, aparencia;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_search_console_aparencia_diario` (
  organization_id         STRING NOT NULL,
  site                    STRING NOT NULL,
  data_dia                DATE NOT NULL,
  aparencia               STRING NOT NULL,
  cliques                 INT64,
  impressoes              INT64,
  ctr                     NUMERIC,
  posicao_media           NUMERIC,
  execucao_id             STRING NOT NULL,
  inserido_em             TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE OR REPLACE VIEW `{{DATASET}}.vw_search_console_consulta_pagina_diario` AS
WITH fatos AS (
  SELECT *
  FROM `{{DATASET}}.fato_search_console_consulta_pagina_diario`
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY organization_id, site, data_dia, consulta, pagina
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
  ON epoca.organization_id = f.organization_id AND epoca.platform = 'searchconsole' AND epoca.external_id = f.site
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') >= epoca.valido_de
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') < epoca.valido_ate
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = f.organization_id AND atual.platform = 'searchconsole' AND atual.external_id = f.site
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_epoca
  ON cliente_epoca.organization_id = f.organization_id AND cliente_epoca.client_id = epoca.client_id AND cliente_epoca.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = f.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual
WHERE IFNULL(cliente_epoca.status, '') != 'excluido'
  AND IFNULL(cliente_atual.status, '') != 'excluido';

CREATE OR REPLACE VIEW `{{DATASET}}.vw_search_console_pagina_diario` AS
WITH fatos AS (
  SELECT *
  FROM `{{DATASET}}.fato_search_console_pagina_diario`
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY organization_id, site, data_dia, pagina
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
  ON epoca.organization_id = f.organization_id AND epoca.platform = 'searchconsole' AND epoca.external_id = f.site
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') >= epoca.valido_de
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') < epoca.valido_ate
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = f.organization_id AND atual.platform = 'searchconsole' AND atual.external_id = f.site
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_epoca
  ON cliente_epoca.organization_id = f.organization_id AND cliente_epoca.client_id = epoca.client_id AND cliente_epoca.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = f.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual
WHERE IFNULL(cliente_epoca.status, '') != 'excluido'
  AND IFNULL(cliente_atual.status, '') != 'excluido';

CREATE OR REPLACE VIEW `{{DATASET}}.vw_search_console_pais_dispositivo_diario` AS
WITH fatos AS (
  SELECT *
  FROM `{{DATASET}}.fato_search_console_pais_dispositivo_diario`
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY organization_id, site, data_dia, pais, dispositivo
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
  ON epoca.organization_id = f.organization_id AND epoca.platform = 'searchconsole' AND epoca.external_id = f.site
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') >= epoca.valido_de
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') < epoca.valido_ate
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = f.organization_id AND atual.platform = 'searchconsole' AND atual.external_id = f.site
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_epoca
  ON cliente_epoca.organization_id = f.organization_id AND cliente_epoca.client_id = epoca.client_id AND cliente_epoca.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = f.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual
WHERE IFNULL(cliente_epoca.status, '') != 'excluido'
  AND IFNULL(cliente_atual.status, '') != 'excluido';

CREATE OR REPLACE VIEW `{{DATASET}}.vw_search_console_aparencia_diario` AS
WITH fatos AS (
  SELECT *
  FROM `{{DATASET}}.fato_search_console_aparencia_diario`
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY organization_id, site, data_dia, aparencia
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
  ON epoca.organization_id = f.organization_id AND epoca.platform = 'searchconsole' AND epoca.external_id = f.site
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') >= epoca.valido_de
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') < epoca.valido_ate
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = f.organization_id AND atual.platform = 'searchconsole' AND atual.external_id = f.site
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_epoca
  ON cliente_epoca.organization_id = f.organization_id AND cliente_epoca.client_id = epoca.client_id AND cliente_epoca.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = f.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual
WHERE IFNULL(cliente_epoca.status, '') != 'excluido'
  AND IFNULL(cliente_atual.status, '') != 'excluido';
