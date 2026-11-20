CREATE TABLE IF NOT EXISTS `{{DATASET}}.dim_youtube_video_scd2` (
  organization_id               STRING NOT NULL,
  channel_id                    STRING NOT NULL,
  video_id                      STRING NOT NULL,
  titulo                        STRING,
  duracao_segundos              INT64,
  publicado_em                  TIMESTAMP,
  privacidade                   STRING,
  categoria_id                  STRING,
  valido_de                     TIMESTAMP NOT NULL,
  valido_ate                    TIMESTAMP NOT NULL,
  atual                         BOOL NOT NULL,
  hash_versao                   STRING NOT NULL,
  execucao_id                   STRING,
  carregado_em                  TIMESTAMP NOT NULL
)
CLUSTER BY organization_id, channel_id, video_id;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_youtube_video` (
  organization_id               STRING NOT NULL,
  channel_id                    STRING NOT NULL,
  video_id                      STRING NOT NULL,
  titulo                        STRING,
  duracao_segundos              INT64,
  publicado_em                  TIMESTAMP,
  privacidade                   STRING,
  categoria_id                  STRING,
  execucao_id                   STRING NOT NULL,
  inserido_em                   TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE OR REPLACE VIEW `{{DATASET}}.vw_dim_youtube_video_scd2` AS
SELECT
  d.*,
  atual.client_id AS cliente_atual_id,
  cliente_atual.nome AS cliente_atual_nome,
  atual.status AS fonte_status_atual,
  atual.nome AS fonte_nome_atual
FROM `{{DATASET}}.dim_youtube_video_scd2` d
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = d.organization_id AND atual.platform = 'youtube' AND atual.external_id = d.channel_id
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = d.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.dim_youtube_playlist_scd2` (
  organization_id               STRING NOT NULL,
  channel_id                    STRING NOT NULL,
  playlist_id                   STRING NOT NULL,
  titulo                        STRING,
  privacidade                   STRING,
  qtd_videos                    INT64,
  valido_de                     TIMESTAMP NOT NULL,
  valido_ate                    TIMESTAMP NOT NULL,
  atual                         BOOL NOT NULL,
  hash_versao                   STRING NOT NULL,
  execucao_id                   STRING,
  carregado_em                  TIMESTAMP NOT NULL
)
CLUSTER BY organization_id, channel_id, playlist_id;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_youtube_playlist` (
  organization_id               STRING NOT NULL,
  channel_id                    STRING NOT NULL,
  playlist_id                   STRING NOT NULL,
  titulo                        STRING,
  privacidade                   STRING,
  qtd_videos                    INT64,
  execucao_id                   STRING NOT NULL,
  inserido_em                   TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE OR REPLACE VIEW `{{DATASET}}.vw_dim_youtube_playlist_scd2` AS
SELECT
  d.*,
  atual.client_id AS cliente_atual_id,
  cliente_atual.nome AS cliente_atual_nome,
  atual.status AS fonte_status_atual,
  atual.nome AS fonte_nome_atual
FROM `{{DATASET}}.dim_youtube_playlist_scd2` d
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = d.organization_id AND atual.platform = 'youtube' AND atual.external_id = d.channel_id
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = d.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.fato_youtube_video_diario` (
  organization_id               STRING NOT NULL,
  channel_id                    STRING NOT NULL,
  video_id                      STRING NOT NULL,
  data_dia                      DATE NOT NULL,
  views                         INT64,
  minutos_assistidos            NUMERIC,
  duracao_media_visualizacao_s  NUMERIC,
  curtidas                      INT64,
  comentarios                   INT64,
  compartilhamentos             INT64,
  inscritos_ganhos              INT64,
  inscritos_perdidos            INT64,
  execucao_id                   STRING,
  inserido_em                   TIMESTAMP NOT NULL
)
PARTITION BY data_dia
CLUSTER BY organization_id, channel_id, video_id;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_youtube_video_diario` (
  organization_id               STRING NOT NULL,
  channel_id                    STRING NOT NULL,
  video_id                      STRING NOT NULL,
  data_dia                      DATE NOT NULL,
  views                         INT64,
  minutos_assistidos            NUMERIC,
  duracao_media_visualizacao_s  NUMERIC,
  curtidas                      INT64,
  comentarios                   INT64,
  compartilhamentos             INT64,
  inscritos_ganhos              INT64,
  inscritos_perdidos            INT64,
  execucao_id                   STRING NOT NULL,
  inserido_em                   TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE OR REPLACE VIEW `{{DATASET}}.vw_youtube_video_diario` AS
WITH fatos AS (
  SELECT *
  FROM `{{DATASET}}.fato_youtube_video_diario`
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY organization_id, channel_id, video_id, data_dia
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
  ON epoca.organization_id = f.organization_id AND epoca.platform = 'youtube' AND epoca.external_id = f.channel_id
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') >= epoca.valido_de
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') < epoca.valido_ate
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = f.organization_id AND atual.platform = 'youtube' AND atual.external_id = f.channel_id
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_epoca
  ON cliente_epoca.organization_id = f.organization_id AND cliente_epoca.client_id = epoca.client_id AND cliente_epoca.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = f.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.fato_youtube_origem_trafego_diario` (
  organization_id               STRING NOT NULL,
  channel_id                    STRING NOT NULL,
  data_dia                      DATE NOT NULL,
  origem_trafego                STRING NOT NULL,
  views                         INT64,
  minutos_assistidos            NUMERIC,
  execucao_id                   STRING,
  inserido_em                   TIMESTAMP NOT NULL
)
PARTITION BY data_dia
CLUSTER BY organization_id, channel_id, origem_trafego;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_youtube_origem_trafego_diario` (
  organization_id               STRING NOT NULL,
  channel_id                    STRING NOT NULL,
  data_dia                      DATE NOT NULL,
  origem_trafego                STRING NOT NULL,
  views                         INT64,
  minutos_assistidos            NUMERIC,
  execucao_id                   STRING NOT NULL,
  inserido_em                   TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE OR REPLACE VIEW `{{DATASET}}.vw_youtube_origem_trafego_diario` AS
WITH fatos AS (
  SELECT *
  FROM `{{DATASET}}.fato_youtube_origem_trafego_diario`
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY organization_id, channel_id, data_dia, origem_trafego
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
  ON epoca.organization_id = f.organization_id AND epoca.platform = 'youtube' AND epoca.external_id = f.channel_id
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') >= epoca.valido_de
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') < epoca.valido_ate
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = f.organization_id AND atual.platform = 'youtube' AND atual.external_id = f.channel_id
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_epoca
  ON cliente_epoca.organization_id = f.organization_id AND cliente_epoca.client_id = epoca.client_id AND cliente_epoca.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = f.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.fato_youtube_dispositivo_diario` (
  organization_id               STRING NOT NULL,
  channel_id                    STRING NOT NULL,
  data_dia                      DATE NOT NULL,
  dispositivo                   STRING NOT NULL,
  views                         INT64,
  minutos_assistidos            NUMERIC,
  execucao_id                   STRING,
  inserido_em                   TIMESTAMP NOT NULL
)
PARTITION BY data_dia
CLUSTER BY organization_id, channel_id, dispositivo;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_youtube_dispositivo_diario` (
  organization_id               STRING NOT NULL,
  channel_id                    STRING NOT NULL,
  data_dia                      DATE NOT NULL,
  dispositivo                   STRING NOT NULL,
  views                         INT64,
  minutos_assistidos            NUMERIC,
  execucao_id                   STRING NOT NULL,
  inserido_em                   TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE OR REPLACE VIEW `{{DATASET}}.vw_youtube_dispositivo_diario` AS
WITH fatos AS (
  SELECT *
  FROM `{{DATASET}}.fato_youtube_dispositivo_diario`
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY organization_id, channel_id, data_dia, dispositivo
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
  ON epoca.organization_id = f.organization_id AND epoca.platform = 'youtube' AND epoca.external_id = f.channel_id
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') >= epoca.valido_de
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') < epoca.valido_ate
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = f.organization_id AND atual.platform = 'youtube' AND atual.external_id = f.channel_id
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_epoca
  ON cliente_epoca.organization_id = f.organization_id AND cliente_epoca.client_id = epoca.client_id AND cliente_epoca.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = f.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.fato_youtube_local_reproducao_diario` (
  organization_id               STRING NOT NULL,
  channel_id                    STRING NOT NULL,
  data_dia                      DATE NOT NULL,
  local_reproducao              STRING NOT NULL,
  views                         INT64,
  minutos_assistidos            NUMERIC,
  execucao_id                   STRING,
  inserido_em                   TIMESTAMP NOT NULL
)
PARTITION BY data_dia
CLUSTER BY organization_id, channel_id, local_reproducao;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_youtube_local_reproducao_diario` (
  organization_id               STRING NOT NULL,
  channel_id                    STRING NOT NULL,
  data_dia                      DATE NOT NULL,
  local_reproducao              STRING NOT NULL,
  views                         INT64,
  minutos_assistidos            NUMERIC,
  execucao_id                   STRING NOT NULL,
  inserido_em                   TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE OR REPLACE VIEW `{{DATASET}}.vw_youtube_local_reproducao_diario` AS
WITH fatos AS (
  SELECT *
  FROM `{{DATASET}}.fato_youtube_local_reproducao_diario`
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY organization_id, channel_id, data_dia, local_reproducao
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
  ON epoca.organization_id = f.organization_id AND epoca.platform = 'youtube' AND epoca.external_id = f.channel_id
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') >= epoca.valido_de
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') < epoca.valido_ate
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = f.organization_id AND atual.platform = 'youtube' AND atual.external_id = f.channel_id
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_epoca
  ON cliente_epoca.organization_id = f.organization_id AND cliente_epoca.client_id = epoca.client_id AND cliente_epoca.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = f.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.fato_youtube_pais_diario` (
  organization_id               STRING NOT NULL,
  channel_id                    STRING NOT NULL,
  data_dia                      DATE NOT NULL,
  pais                          STRING NOT NULL,
  views                         INT64,
  minutos_assistidos            NUMERIC,
  execucao_id                   STRING,
  inserido_em                   TIMESTAMP NOT NULL
)
PARTITION BY data_dia
CLUSTER BY organization_id, channel_id, pais;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_youtube_pais_diario` (
  organization_id               STRING NOT NULL,
  channel_id                    STRING NOT NULL,
  data_dia                      DATE NOT NULL,
  pais                          STRING NOT NULL,
  views                         INT64,
  minutos_assistidos            NUMERIC,
  execucao_id                   STRING NOT NULL,
  inserido_em                   TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE OR REPLACE VIEW `{{DATASET}}.vw_youtube_pais_diario` AS
WITH fatos AS (
  SELECT *
  FROM `{{DATASET}}.fato_youtube_pais_diario`
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY organization_id, channel_id, data_dia, pais
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
  ON epoca.organization_id = f.organization_id AND epoca.platform = 'youtube' AND epoca.external_id = f.channel_id
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') >= epoca.valido_de
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') < epoca.valido_ate
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = f.organization_id AND atual.platform = 'youtube' AND atual.external_id = f.channel_id
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_epoca
  ON cliente_epoca.organization_id = f.organization_id AND cliente_epoca.client_id = epoca.client_id AND cliente_epoca.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = f.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.fato_youtube_audiencia_diario` (
  organization_id               STRING NOT NULL,
  channel_id                    STRING NOT NULL,
  data_dia                      DATE NOT NULL,
  faixa_etaria                  STRING NOT NULL,
  genero                        STRING NOT NULL,
  percentual_espectadores       NUMERIC,
  execucao_id                   STRING,
  inserido_em                   TIMESTAMP NOT NULL
)
PARTITION BY data_dia
CLUSTER BY organization_id, channel_id;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_youtube_audiencia_diario` (
  organization_id               STRING NOT NULL,
  channel_id                    STRING NOT NULL,
  data_dia                      DATE NOT NULL,
  faixa_etaria                  STRING NOT NULL,
  genero                        STRING NOT NULL,
  percentual_espectadores       NUMERIC,
  execucao_id                   STRING NOT NULL,
  inserido_em                   TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE OR REPLACE VIEW `{{DATASET}}.vw_youtube_audiencia_diario` AS
WITH fatos AS (
  SELECT *
  FROM `{{DATASET}}.fato_youtube_audiencia_diario`
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY organization_id, channel_id, data_dia, faixa_etaria, genero
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
  ON epoca.organization_id = f.organization_id AND epoca.platform = 'youtube' AND epoca.external_id = f.channel_id
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') >= epoca.valido_de
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') < epoca.valido_ate
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` atual
  ON atual.organization_id = f.organization_id AND atual.platform = 'youtube' AND atual.external_id = f.channel_id
  AND atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_epoca
  ON cliente_epoca.organization_id = f.organization_id AND cliente_epoca.client_id = epoca.client_id AND cliente_epoca.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = f.organization_id AND cliente_atual.client_id = atual.client_id AND cliente_atual.atual;
