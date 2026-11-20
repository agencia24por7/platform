CREATE TABLE IF NOT EXISTS `{{DATASET}}.fato_ga4_aquisicao_diario` (
  organization_id         STRING NOT NULL,
  property_id             STRING NOT NULL,
  data_dia                DATE NOT NULL,
  fonte                   STRING NOT NULL,
  midia                   STRING NOT NULL,
  campanha                STRING NOT NULL,
  canal_padrao            STRING NOT NULL,
  sessoes                 INT64,
  sessoes_engajadas       INT64,
  usuarios                INT64,
  novos_usuarios          INT64,
  eventos_chave           NUMERIC,
  receita                 NUMERIC,
  duracao_engajamento_seg NUMERIC,
  execucao_id             STRING,
  inserido_em             TIMESTAMP NOT NULL
)
PARTITION BY data_dia
CLUSTER BY organization_id, property_id, fonte;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_ga4_aquisicao_diario` (
  organization_id         STRING NOT NULL,
  property_id             STRING NOT NULL,
  data_dia                DATE NOT NULL,
  fonte                   STRING NOT NULL,
  midia                   STRING NOT NULL,
  campanha                STRING NOT NULL,
  canal_padrao            STRING NOT NULL,
  sessoes                 INT64,
  sessoes_engajadas       INT64,
  usuarios                INT64,
  novos_usuarios          INT64,
  eventos_chave           NUMERIC,
  receita                 NUMERIC,
  duracao_engajamento_seg NUMERIC,
  execucao_id             STRING NOT NULL,
  inserido_em             TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE TABLE IF NOT EXISTS `{{DATASET}}.fato_ga4_pagina_diario` (
  organization_id         STRING NOT NULL,
  property_id             STRING NOT NULL,
  data_dia                DATE NOT NULL,
  pagina                  STRING NOT NULL,
  visualizacoes           INT64,
  usuarios_ativos         INT64,
  sessoes                 INT64,
  eventos                 INT64,
  eventos_chave           NUMERIC,
  duracao_engajamento_seg NUMERIC,
  execucao_id             STRING,
  inserido_em             TIMESTAMP NOT NULL
)
PARTITION BY data_dia
CLUSTER BY organization_id, property_id, pagina;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_ga4_pagina_diario` (
  organization_id         STRING NOT NULL,
  property_id             STRING NOT NULL,
  data_dia                DATE NOT NULL,
  pagina                  STRING NOT NULL,
  visualizacoes           INT64,
  usuarios_ativos         INT64,
  sessoes                 INT64,
  eventos                 INT64,
  eventos_chave           NUMERIC,
  duracao_engajamento_seg NUMERIC,
  execucao_id             STRING NOT NULL,
  inserido_em             TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE TABLE IF NOT EXISTS `{{DATASET}}.fato_ga4_pagina_entrada_diario` (
  organization_id         STRING NOT NULL,
  property_id             STRING NOT NULL,
  data_dia                DATE NOT NULL,
  pagina_entrada          STRING NOT NULL,
  sessoes                 INT64,
  sessoes_engajadas       INT64,
  usuarios                INT64,
  novos_usuarios          INT64,
  eventos_chave           NUMERIC,
  receita                 NUMERIC,
  execucao_id             STRING,
  inserido_em             TIMESTAMP NOT NULL
)
PARTITION BY data_dia
CLUSTER BY organization_id, property_id, pagina_entrada;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_ga4_pagina_entrada_diario` (
  organization_id         STRING NOT NULL,
  property_id             STRING NOT NULL,
  data_dia                DATE NOT NULL,
  pagina_entrada          STRING NOT NULL,
  sessoes                 INT64,
  sessoes_engajadas       INT64,
  usuarios                INT64,
  novos_usuarios          INT64,
  eventos_chave           NUMERIC,
  receita                 NUMERIC,
  execucao_id             STRING NOT NULL,
  inserido_em             TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE TABLE IF NOT EXISTS `{{DATASET}}.fato_ga4_evento_diario` (
  organization_id         STRING NOT NULL,
  property_id             STRING NOT NULL,
  data_dia                DATE NOT NULL,
  evento                  STRING NOT NULL,
  contagem                INT64,
  usuarios                INT64,
  valor                   NUMERIC,
  eventos_chave           NUMERIC,
  execucao_id             STRING,
  inserido_em             TIMESTAMP NOT NULL
)
PARTITION BY data_dia
CLUSTER BY organization_id, property_id, evento;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_ga4_evento_diario` (
  organization_id         STRING NOT NULL,
  property_id             STRING NOT NULL,
  data_dia                DATE NOT NULL,
  evento                  STRING NOT NULL,
  contagem                INT64,
  usuarios                INT64,
  valor                   NUMERIC,
  eventos_chave           NUMERIC,
  execucao_id             STRING NOT NULL,
  inserido_em             TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE TABLE IF NOT EXISTS `{{DATASET}}.fato_ga4_dispositivo_diario` (
  organization_id         STRING NOT NULL,
  property_id             STRING NOT NULL,
  data_dia                DATE NOT NULL,
  categoria_dispositivo   STRING NOT NULL,
  sistema_operacional     STRING NOT NULL,
  navegador               STRING NOT NULL,
  plataforma              STRING NOT NULL,
  sessoes                 INT64,
  sessoes_engajadas       INT64,
  usuarios                INT64,
  novos_usuarios          INT64,
  eventos_chave           NUMERIC,
  receita                 NUMERIC,
  execucao_id             STRING,
  inserido_em             TIMESTAMP NOT NULL
)
PARTITION BY data_dia
CLUSTER BY organization_id, property_id, categoria_dispositivo;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_ga4_dispositivo_diario` (
  organization_id         STRING NOT NULL,
  property_id             STRING NOT NULL,
  data_dia                DATE NOT NULL,
  categoria_dispositivo   STRING NOT NULL,
  sistema_operacional     STRING NOT NULL,
  navegador               STRING NOT NULL,
  plataforma              STRING NOT NULL,
  sessoes                 INT64,
  sessoes_engajadas       INT64,
  usuarios                INT64,
  novos_usuarios          INT64,
  eventos_chave           NUMERIC,
  receita                 NUMERIC,
  execucao_id             STRING NOT NULL,
  inserido_em             TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE TABLE IF NOT EXISTS `{{DATASET}}.fato_ga4_geo_diario` (
  organization_id         STRING NOT NULL,
  property_id             STRING NOT NULL,
  data_dia                DATE NOT NULL,
  pais                    STRING NOT NULL,
  regiao                  STRING NOT NULL,
  cidade                  STRING NOT NULL,
  sessoes                 INT64,
  sessoes_engajadas       INT64,
  usuarios                INT64,
  novos_usuarios          INT64,
  eventos_chave           NUMERIC,
  receita                 NUMERIC,
  execucao_id             STRING,
  inserido_em             TIMESTAMP NOT NULL
)
PARTITION BY data_dia
CLUSTER BY organization_id, property_id, pais;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_ga4_geo_diario` (
  organization_id         STRING NOT NULL,
  property_id             STRING NOT NULL,
  data_dia                DATE NOT NULL,
  pais                    STRING NOT NULL,
  regiao                  STRING NOT NULL,
  cidade                  STRING NOT NULL,
  sessoes                 INT64,
  sessoes_engajadas       INT64,
  usuarios                INT64,
  novos_usuarios          INT64,
  eventos_chave           NUMERIC,
  receita                 NUMERIC,
  execucao_id             STRING NOT NULL,
  inserido_em             TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE TABLE IF NOT EXISTS `{{DATASET}}.fato_ga4_item_diario` (
  organization_id         STRING NOT NULL,
  property_id             STRING NOT NULL,
  data_dia                DATE NOT NULL,
  item                    STRING NOT NULL,
  itens_visualizados      INT64,
  itens_no_carrinho       INT64,
  itens_comprados         INT64,
  receita_item            NUMERIC,
  execucao_id             STRING,
  inserido_em             TIMESTAMP NOT NULL
)
PARTITION BY data_dia
CLUSTER BY organization_id, property_id, item;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_ga4_item_diario` (
  organization_id         STRING NOT NULL,
  property_id             STRING NOT NULL,
  data_dia                DATE NOT NULL,
  item                    STRING NOT NULL,
  itens_visualizados      INT64,
  itens_no_carrinho       INT64,
  itens_comprados         INT64,
  receita_item            NUMERIC,
  execucao_id             STRING NOT NULL,
  inserido_em             TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE OR REPLACE VIEW `{{DATASET}}.vw_ga4_aquisicao_diario` AS
WITH fatos AS (
  SELECT *
  FROM `{{DATASET}}.fato_ga4_aquisicao_diario`
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY organization_id, property_id, data_dia, fonte, midia, campanha, canal_padrao
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
  ON epoca.organization_id = f.organization_id AND epoca.platform = 'ga4' AND epoca.external_id = f.property_id
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') >= epoca.valido_de
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') < epoca.valido_ate
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = f.organization_id AND atual.platform = 'ga4' AND atual.external_id = f.property_id
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_epoca
  ON cliente_epoca.organization_id = f.organization_id AND cliente_epoca.client_id = epoca.client_id AND cliente_epoca.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = f.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual
WHERE IFNULL(cliente_epoca.status, '') != 'excluido'
  AND IFNULL(cliente_atual.status, '') != 'excluido';

CREATE OR REPLACE VIEW `{{DATASET}}.vw_ga4_pagina_diario` AS
WITH fatos AS (
  SELECT *
  FROM `{{DATASET}}.fato_ga4_pagina_diario`
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY organization_id, property_id, data_dia, pagina
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
  ON epoca.organization_id = f.organization_id AND epoca.platform = 'ga4' AND epoca.external_id = f.property_id
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') >= epoca.valido_de
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') < epoca.valido_ate
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = f.organization_id AND atual.platform = 'ga4' AND atual.external_id = f.property_id
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_epoca
  ON cliente_epoca.organization_id = f.organization_id AND cliente_epoca.client_id = epoca.client_id AND cliente_epoca.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = f.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual
WHERE IFNULL(cliente_epoca.status, '') != 'excluido'
  AND IFNULL(cliente_atual.status, '') != 'excluido';

CREATE OR REPLACE VIEW `{{DATASET}}.vw_ga4_pagina_entrada_diario` AS
WITH fatos AS (
  SELECT *
  FROM `{{DATASET}}.fato_ga4_pagina_entrada_diario`
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY organization_id, property_id, data_dia, pagina_entrada
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
  ON epoca.organization_id = f.organization_id AND epoca.platform = 'ga4' AND epoca.external_id = f.property_id
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') >= epoca.valido_de
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') < epoca.valido_ate
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = f.organization_id AND atual.platform = 'ga4' AND atual.external_id = f.property_id
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_epoca
  ON cliente_epoca.organization_id = f.organization_id AND cliente_epoca.client_id = epoca.client_id AND cliente_epoca.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = f.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual
WHERE IFNULL(cliente_epoca.status, '') != 'excluido'
  AND IFNULL(cliente_atual.status, '') != 'excluido';

CREATE OR REPLACE VIEW `{{DATASET}}.vw_ga4_evento_diario` AS
WITH fatos AS (
  SELECT *
  FROM `{{DATASET}}.fato_ga4_evento_diario`
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY organization_id, property_id, data_dia, evento
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
  ON epoca.organization_id = f.organization_id AND epoca.platform = 'ga4' AND epoca.external_id = f.property_id
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') >= epoca.valido_de
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') < epoca.valido_ate
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = f.organization_id AND atual.platform = 'ga4' AND atual.external_id = f.property_id
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_epoca
  ON cliente_epoca.organization_id = f.organization_id AND cliente_epoca.client_id = epoca.client_id AND cliente_epoca.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = f.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual
WHERE IFNULL(cliente_epoca.status, '') != 'excluido'
  AND IFNULL(cliente_atual.status, '') != 'excluido';

CREATE OR REPLACE VIEW `{{DATASET}}.vw_ga4_dispositivo_diario` AS
WITH fatos AS (
  SELECT *
  FROM `{{DATASET}}.fato_ga4_dispositivo_diario`
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY organization_id, property_id, data_dia, categoria_dispositivo, sistema_operacional, navegador, plataforma
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
  ON epoca.organization_id = f.organization_id AND epoca.platform = 'ga4' AND epoca.external_id = f.property_id
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') >= epoca.valido_de
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') < epoca.valido_ate
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = f.organization_id AND atual.platform = 'ga4' AND atual.external_id = f.property_id
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_epoca
  ON cliente_epoca.organization_id = f.organization_id AND cliente_epoca.client_id = epoca.client_id AND cliente_epoca.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = f.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual
WHERE IFNULL(cliente_epoca.status, '') != 'excluido'
  AND IFNULL(cliente_atual.status, '') != 'excluido';

CREATE OR REPLACE VIEW `{{DATASET}}.vw_ga4_geo_diario` AS
WITH fatos AS (
  SELECT *
  FROM `{{DATASET}}.fato_ga4_geo_diario`
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY organization_id, property_id, data_dia, pais, regiao, cidade
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
  ON epoca.organization_id = f.organization_id AND epoca.platform = 'ga4' AND epoca.external_id = f.property_id
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') >= epoca.valido_de
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') < epoca.valido_ate
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = f.organization_id AND atual.platform = 'ga4' AND atual.external_id = f.property_id
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_epoca
  ON cliente_epoca.organization_id = f.organization_id AND cliente_epoca.client_id = epoca.client_id AND cliente_epoca.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = f.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual
WHERE IFNULL(cliente_epoca.status, '') != 'excluido'
  AND IFNULL(cliente_atual.status, '') != 'excluido';

CREATE OR REPLACE VIEW `{{DATASET}}.vw_ga4_item_diario` AS
WITH fatos AS (
  SELECT *
  FROM `{{DATASET}}.fato_ga4_item_diario`
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY organization_id, property_id, data_dia, item
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
  ON epoca.organization_id = f.organization_id AND epoca.platform = 'ga4' AND epoca.external_id = f.property_id
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') >= epoca.valido_de
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') < epoca.valido_ate
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = f.organization_id AND atual.platform = 'ga4' AND atual.external_id = f.property_id
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_epoca
  ON cliente_epoca.organization_id = f.organization_id AND cliente_epoca.client_id = epoca.client_id AND cliente_epoca.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = f.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual
WHERE IFNULL(cliente_epoca.status, '') != 'excluido'
  AND IFNULL(cliente_atual.status, '') != 'excluido';
