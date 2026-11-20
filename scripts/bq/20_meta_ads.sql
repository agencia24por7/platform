CREATE TABLE IF NOT EXISTS `{{DATASET}}.fato_meta_entrega_diaria` (
  organization_id      STRING NOT NULL,
  ad_account_id        STRING NOT NULL,
  campaign_id          STRING,
  adset_id             STRING,
  ad_id                STRING NOT NULL,
  data_dia             DATE NOT NULL,
  investimento         NUMERIC,
  impressoes           INT64,
  alcance              INT64,
  frequencia           NUMERIC,
  cliques              INT64,
  cliques_link         INT64,
  cliques_unicos       INT64,
  cliques_link_unicos  INT64,
  cliques_saida        INT64,
  engajamento_post     INT64,
  video_reproducoes    INT64,
  video_30s            INT64,
  video_p25            INT64,
  video_p50            INT64,
  video_p75            INT64,
  video_p95            INT64,
  video_p100           INT64,
  video_thruplay       INT64,
  video_tempo_medio    NUMERIC,
  ranking_qualidade    STRING,
  ranking_engajamento  STRING,
  ranking_conversao    STRING,
  moeda                STRING,
  versao_api           STRING,
  execucao_id          STRING,
  inserido_em          TIMESTAMP NOT NULL
)
PARTITION BY data_dia
CLUSTER BY organization_id, ad_account_id, campaign_id;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_meta_entrega_diaria` (
  organization_id      STRING NOT NULL,
  ad_account_id        STRING NOT NULL,
  campaign_id          STRING,
  adset_id             STRING,
  ad_id                STRING NOT NULL,
  data_dia             DATE NOT NULL,
  investimento         NUMERIC,
  impressoes           INT64,
  alcance              INT64,
  frequencia           NUMERIC,
  cliques              INT64,
  cliques_link         INT64,
  cliques_unicos       INT64,
  cliques_link_unicos  INT64,
  cliques_saida        INT64,
  engajamento_post     INT64,
  video_reproducoes    INT64,
  video_30s            INT64,
  video_p25            INT64,
  video_p50            INT64,
  video_p75            INT64,
  video_p95            INT64,
  video_p100           INT64,
  video_thruplay       INT64,
  video_tempo_medio    NUMERIC,
  ranking_qualidade    STRING,
  ranking_engajamento  STRING,
  ranking_conversao    STRING,
  moeda                STRING,
  versao_api           STRING,
  execucao_id          STRING NOT NULL,
  inserido_em          TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE TABLE IF NOT EXISTS `{{DATASET}}.fato_meta_acoes_diarias` (
  organization_id    STRING NOT NULL,
  ad_account_id      STRING NOT NULL,
  campaign_id        STRING,
  adset_id           STRING,
  ad_id              STRING NOT NULL,
  data_dia           DATE NOT NULL,
  tipo_acao          STRING NOT NULL,
  origem_metrica     STRING NOT NULL,
  quantidade         NUMERIC,
  valor              NUMERIC,
  custo_por_acao     NUMERIC,
  janela_atribuicao  STRING,
  moeda              STRING,
  versao_api         STRING,
  execucao_id        STRING,
  inserido_em        TIMESTAMP NOT NULL
)
PARTITION BY data_dia
CLUSTER BY organization_id, ad_account_id, campaign_id, tipo_acao;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_meta_acoes_diarias` (
  organization_id    STRING NOT NULL,
  ad_account_id      STRING NOT NULL,
  campaign_id        STRING,
  adset_id           STRING,
  ad_id              STRING NOT NULL,
  data_dia           DATE NOT NULL,
  tipo_acao          STRING NOT NULL,
  origem_metrica     STRING NOT NULL,
  quantidade         NUMERIC,
  valor              NUMERIC,
  custo_por_acao     NUMERIC,
  janela_atribuicao  STRING,
  moeda              STRING,
  versao_api         STRING,
  execucao_id        STRING NOT NULL,
  inserido_em        TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE TABLE IF NOT EXISTS `{{DATASET}}.fato_meta_recorte_idade_genero` (
  organization_id       STRING NOT NULL,
  ad_account_id         STRING NOT NULL,
  campaign_id           STRING,
  adset_id              STRING NOT NULL,
  data_dia              DATE NOT NULL,
  idade                 STRING NOT NULL,
  genero                STRING NOT NULL,
  investimento          NUMERIC,
  impressoes            INT64,
  alcance               INT64,
  cliques               INT64,
  cliques_link          INT64,
  leads                 INT64,
  compras               INT64,
  receita_compras       NUMERIC,
  conversas_iniciadas   INT64,
  visualizacoes_pagina  INT64,
  moeda                 STRING,
  versao_api            STRING,
  execucao_id           STRING,
  inserido_em           TIMESTAMP NOT NULL
)
PARTITION BY data_dia
CLUSTER BY organization_id, ad_account_id, campaign_id;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_meta_recorte_idade_genero` (
  organization_id       STRING NOT NULL,
  ad_account_id         STRING NOT NULL,
  campaign_id           STRING,
  adset_id              STRING NOT NULL,
  data_dia              DATE NOT NULL,
  idade                 STRING NOT NULL,
  genero                STRING NOT NULL,
  investimento          NUMERIC,
  impressoes            INT64,
  alcance               INT64,
  cliques               INT64,
  cliques_link          INT64,
  leads                 INT64,
  compras               INT64,
  receita_compras       NUMERIC,
  conversas_iniciadas   INT64,
  visualizacoes_pagina  INT64,
  moeda                 STRING,
  versao_api            STRING,
  execucao_id           STRING NOT NULL,
  inserido_em           TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE TABLE IF NOT EXISTS `{{DATASET}}.fato_meta_recorte_posicionamento` (
  organization_id        STRING NOT NULL,
  ad_account_id          STRING NOT NULL,
  campaign_id            STRING,
  adset_id               STRING NOT NULL,
  data_dia               DATE NOT NULL,
  plataforma_publicacao  STRING NOT NULL,
  posicao_plataforma     STRING NOT NULL,
  investimento           NUMERIC,
  impressoes             INT64,
  alcance                INT64,
  cliques                INT64,
  cliques_link           INT64,
  leads                  INT64,
  compras                INT64,
  receita_compras        NUMERIC,
  conversas_iniciadas    INT64,
  visualizacoes_pagina   INT64,
  moeda                  STRING,
  versao_api             STRING,
  execucao_id            STRING,
  inserido_em            TIMESTAMP NOT NULL
)
PARTITION BY data_dia
CLUSTER BY organization_id, ad_account_id, campaign_id;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_meta_recorte_posicionamento` (
  organization_id        STRING NOT NULL,
  ad_account_id          STRING NOT NULL,
  campaign_id            STRING,
  adset_id               STRING NOT NULL,
  data_dia               DATE NOT NULL,
  plataforma_publicacao  STRING NOT NULL,
  posicao_plataforma     STRING NOT NULL,
  investimento           NUMERIC,
  impressoes             INT64,
  alcance                INT64,
  cliques                INT64,
  cliques_link           INT64,
  leads                  INT64,
  compras                INT64,
  receita_compras        NUMERIC,
  conversas_iniciadas    INT64,
  visualizacoes_pagina   INT64,
  moeda                  STRING,
  versao_api             STRING,
  execucao_id            STRING NOT NULL,
  inserido_em            TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE TABLE IF NOT EXISTS `{{DATASET}}.fato_meta_recorte_regiao` (
  organization_id       STRING NOT NULL,
  ad_account_id         STRING NOT NULL,
  campaign_id           STRING,
  adset_id              STRING NOT NULL,
  data_dia              DATE NOT NULL,
  regiao                STRING NOT NULL,
  investimento          NUMERIC,
  impressoes            INT64,
  alcance               INT64,
  cliques               INT64,
  cliques_link          INT64,
  leads                 INT64,
  compras               INT64,
  receita_compras       NUMERIC,
  conversas_iniciadas   INT64,
  visualizacoes_pagina  INT64,
  moeda                 STRING,
  versao_api            STRING,
  execucao_id           STRING,
  inserido_em           TIMESTAMP NOT NULL
)
PARTITION BY data_dia
CLUSTER BY organization_id, ad_account_id, campaign_id;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_meta_recorte_regiao` (
  organization_id       STRING NOT NULL,
  ad_account_id         STRING NOT NULL,
  campaign_id           STRING,
  adset_id              STRING NOT NULL,
  data_dia              DATE NOT NULL,
  regiao                STRING NOT NULL,
  investimento          NUMERIC,
  impressoes            INT64,
  alcance               INT64,
  cliques               INT64,
  cliques_link          INT64,
  leads                 INT64,
  compras               INT64,
  receita_compras       NUMERIC,
  conversas_iniciadas   INT64,
  visualizacoes_pagina  INT64,
  moeda                 STRING,
  versao_api            STRING,
  execucao_id           STRING NOT NULL,
  inserido_em           TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE TABLE IF NOT EXISTS `{{DATASET}}.dim_meta_campanha_scd2` (
  organization_id       STRING NOT NULL,
  ad_account_id         STRING NOT NULL,
  campaign_id           STRING NOT NULL,
  nome                  STRING,
  objetivo              STRING,
  status                STRING,
  status_efetivo        STRING,
  tipo_compra           STRING,
  estrategia_lance      STRING,
  orcamento_diario      NUMERIC,
  orcamento_vitalicio   NUMERIC,
  limite_gasto          NUMERIC,
  categorias_especiais  STRING,
  inicio                TIMESTAMP,
  fim                   TIMESTAMP,
  criada_em             TIMESTAMP,
  valido_de             TIMESTAMP NOT NULL,
  valido_ate            TIMESTAMP NOT NULL,
  atual                 BOOL NOT NULL,
  hash_versao           STRING NOT NULL,
  execucao_id           STRING,
  carregado_em          TIMESTAMP NOT NULL
)
CLUSTER BY organization_id, ad_account_id, campaign_id;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_meta_dim_campanha` (
  organization_id       STRING NOT NULL,
  ad_account_id         STRING NOT NULL,
  campaign_id           STRING NOT NULL,
  nome                  STRING,
  objetivo              STRING,
  status                STRING,
  status_efetivo        STRING,
  tipo_compra           STRING,
  estrategia_lance      STRING,
  orcamento_diario      NUMERIC,
  orcamento_vitalicio   NUMERIC,
  limite_gasto          NUMERIC,
  categorias_especiais  STRING,
  inicio                TIMESTAMP,
  fim                   TIMESTAMP,
  criada_em             TIMESTAMP,
  execucao_id           STRING NOT NULL,
  inserido_em           TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE TABLE IF NOT EXISTS `{{DATASET}}.dim_meta_conjunto_scd2` (
  organization_id      STRING NOT NULL,
  ad_account_id        STRING NOT NULL,
  adset_id             STRING NOT NULL,
  campaign_id          STRING,
  nome                 STRING,
  status               STRING,
  status_efetivo       STRING,
  objetivo_otimizacao  STRING,
  evento_cobranca      STRING,
  estrategia_lance     STRING,
  valor_lance          NUMERIC,
  orcamento_diario     NUMERIC,
  orcamento_vitalicio  NUMERIC,
  tipo_destino         STRING,
  evento_conversao     STRING,
  janela_atribuicao    STRING,
  inicio               TIMESTAMP,
  fim                  TIMESTAMP,
  criado_em            TIMESTAMP,
  valido_de            TIMESTAMP NOT NULL,
  valido_ate           TIMESTAMP NOT NULL,
  atual                BOOL NOT NULL,
  hash_versao          STRING NOT NULL,
  execucao_id          STRING,
  carregado_em         TIMESTAMP NOT NULL
)
CLUSTER BY organization_id, ad_account_id, adset_id;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_meta_dim_conjunto` (
  organization_id      STRING NOT NULL,
  ad_account_id        STRING NOT NULL,
  adset_id             STRING NOT NULL,
  campaign_id          STRING,
  nome                 STRING,
  status               STRING,
  status_efetivo       STRING,
  objetivo_otimizacao  STRING,
  evento_cobranca      STRING,
  estrategia_lance     STRING,
  valor_lance          NUMERIC,
  orcamento_diario     NUMERIC,
  orcamento_vitalicio  NUMERIC,
  tipo_destino         STRING,
  evento_conversao     STRING,
  janela_atribuicao    STRING,
  inicio               TIMESTAMP,
  fim                  TIMESTAMP,
  criado_em            TIMESTAMP,
  execucao_id          STRING NOT NULL,
  inserido_em          TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE TABLE IF NOT EXISTS `{{DATASET}}.dim_meta_anuncio_scd2` (
  organization_id  STRING NOT NULL,
  ad_account_id    STRING NOT NULL,
  ad_id            STRING NOT NULL,
  campaign_id      STRING,
  adset_id         STRING,
  nome             STRING,
  status           STRING,
  status_efetivo   STRING,
  creative_id      STRING,
  criado_em        TIMESTAMP,
  valido_de        TIMESTAMP NOT NULL,
  valido_ate       TIMESTAMP NOT NULL,
  atual            BOOL NOT NULL,
  hash_versao      STRING NOT NULL,
  execucao_id      STRING,
  carregado_em     TIMESTAMP NOT NULL
)
CLUSTER BY organization_id, ad_account_id, ad_id;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.stg_meta_dim_anuncio` (
  organization_id  STRING NOT NULL,
  ad_account_id    STRING NOT NULL,
  ad_id            STRING NOT NULL,
  campaign_id      STRING,
  adset_id         STRING,
  nome             STRING,
  status           STRING,
  status_efetivo   STRING,
  creative_id      STRING,
  criado_em        TIMESTAMP,
  execucao_id      STRING NOT NULL,
  inserido_em      TIMESTAMP NOT NULL
)
PARTITION BY DATE(inserido_em)
CLUSTER BY execucao_id
OPTIONS (partition_expiration_days = 7);

CREATE OR REPLACE VIEW `{{DATASET}}.vw_meta_entrega_diaria` AS
WITH fatos AS (
  SELECT *
  FROM `{{DATASET}}.fato_meta_entrega_diaria`
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY organization_id, ad_account_id, ad_id, data_dia
    ORDER BY inserido_em DESC
  ) = 1
)
SELECT
  f.*,
  fonte_epoca.client_id AS cliente_na_epoca_id,
  cliente_epoca.nome AS cliente_na_epoca_nome,
  cliente_epoca.status AS cliente_na_epoca_status,
  fonte_atual.client_id AS cliente_atual_id,
  cliente_atual.nome AS cliente_atual_nome,
  cliente_atual.status AS cliente_atual_status,
  fonte_atual.status AS fonte_status_atual,
  fonte_atual.nome AS fonte_nome_atual
FROM fatos f
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` fonte_epoca
  ON fonte_epoca.organization_id = f.organization_id AND fonte_epoca.platform = 'meta' AND fonte_epoca.external_id = f.ad_account_id
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') >= fonte_epoca.valido_de
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') < fonte_epoca.valido_ate
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` fonte_atual
  ON fonte_atual.organization_id = f.organization_id AND fonte_atual.platform = 'meta' AND fonte_atual.external_id = f.ad_account_id
  AND fonte_atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_epoca
  ON cliente_epoca.organization_id = f.organization_id AND cliente_epoca.client_id = fonte_epoca.client_id AND cliente_epoca.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = f.organization_id AND cliente_atual.client_id = fonte_atual.client_id AND cliente_atual.atual
WHERE IFNULL(cliente_epoca.status, '') != 'excluido'
  AND IFNULL(cliente_atual.status, '') != 'excluido';

CREATE OR REPLACE VIEW `{{DATASET}}.vw_meta_acoes_diarias` AS
WITH fatos AS (
  SELECT *
  FROM `{{DATASET}}.fato_meta_acoes_diarias`
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY organization_id, ad_account_id, ad_id, data_dia, tipo_acao, origem_metrica
    ORDER BY inserido_em DESC
  ) = 1
)
SELECT
  f.*,
  fonte_epoca.client_id AS cliente_na_epoca_id,
  cliente_epoca.nome AS cliente_na_epoca_nome,
  cliente_epoca.status AS cliente_na_epoca_status,
  fonte_atual.client_id AS cliente_atual_id,
  cliente_atual.nome AS cliente_atual_nome,
  cliente_atual.status AS cliente_atual_status,
  fonte_atual.status AS fonte_status_atual,
  fonte_atual.nome AS fonte_nome_atual
FROM fatos f
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` fonte_epoca
  ON fonte_epoca.organization_id = f.organization_id AND fonte_epoca.platform = 'meta' AND fonte_epoca.external_id = f.ad_account_id
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') >= fonte_epoca.valido_de
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') < fonte_epoca.valido_ate
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` fonte_atual
  ON fonte_atual.organization_id = f.organization_id AND fonte_atual.platform = 'meta' AND fonte_atual.external_id = f.ad_account_id
  AND fonte_atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_epoca
  ON cliente_epoca.organization_id = f.organization_id AND cliente_epoca.client_id = fonte_epoca.client_id AND cliente_epoca.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = f.organization_id AND cliente_atual.client_id = fonte_atual.client_id AND cliente_atual.atual
WHERE IFNULL(cliente_epoca.status, '') != 'excluido'
  AND IFNULL(cliente_atual.status, '') != 'excluido';

CREATE OR REPLACE VIEW `{{DATASET}}.vw_meta_recorte_idade_genero` AS
WITH fatos AS (
  SELECT *
  FROM `{{DATASET}}.fato_meta_recorte_idade_genero`
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY organization_id, ad_account_id, adset_id, data_dia, idade, genero
    ORDER BY inserido_em DESC
  ) = 1
)
SELECT
  f.*,
  fonte_epoca.client_id AS cliente_na_epoca_id,
  cliente_epoca.nome AS cliente_na_epoca_nome,
  cliente_epoca.status AS cliente_na_epoca_status,
  fonte_atual.client_id AS cliente_atual_id,
  cliente_atual.nome AS cliente_atual_nome,
  cliente_atual.status AS cliente_atual_status,
  fonte_atual.status AS fonte_status_atual,
  fonte_atual.nome AS fonte_nome_atual
FROM fatos f
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` fonte_epoca
  ON fonte_epoca.organization_id = f.organization_id AND fonte_epoca.platform = 'meta' AND fonte_epoca.external_id = f.ad_account_id
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') >= fonte_epoca.valido_de
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') < fonte_epoca.valido_ate
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` fonte_atual
  ON fonte_atual.organization_id = f.organization_id AND fonte_atual.platform = 'meta' AND fonte_atual.external_id = f.ad_account_id
  AND fonte_atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_epoca
  ON cliente_epoca.organization_id = f.organization_id AND cliente_epoca.client_id = fonte_epoca.client_id AND cliente_epoca.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = f.organization_id AND cliente_atual.client_id = fonte_atual.client_id AND cliente_atual.atual
WHERE IFNULL(cliente_epoca.status, '') != 'excluido'
  AND IFNULL(cliente_atual.status, '') != 'excluido';

CREATE OR REPLACE VIEW `{{DATASET}}.vw_meta_recorte_posicionamento` AS
WITH fatos AS (
  SELECT *
  FROM `{{DATASET}}.fato_meta_recorte_posicionamento`
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY organization_id, ad_account_id, adset_id, data_dia, plataforma_publicacao, posicao_plataforma
    ORDER BY inserido_em DESC
  ) = 1
)
SELECT
  f.*,
  fonte_epoca.client_id AS cliente_na_epoca_id,
  cliente_epoca.nome AS cliente_na_epoca_nome,
  cliente_epoca.status AS cliente_na_epoca_status,
  fonte_atual.client_id AS cliente_atual_id,
  cliente_atual.nome AS cliente_atual_nome,
  cliente_atual.status AS cliente_atual_status,
  fonte_atual.status AS fonte_status_atual,
  fonte_atual.nome AS fonte_nome_atual
FROM fatos f
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` fonte_epoca
  ON fonte_epoca.organization_id = f.organization_id AND fonte_epoca.platform = 'meta' AND fonte_epoca.external_id = f.ad_account_id
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') >= fonte_epoca.valido_de
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') < fonte_epoca.valido_ate
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` fonte_atual
  ON fonte_atual.organization_id = f.organization_id AND fonte_atual.platform = 'meta' AND fonte_atual.external_id = f.ad_account_id
  AND fonte_atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_epoca
  ON cliente_epoca.organization_id = f.organization_id AND cliente_epoca.client_id = fonte_epoca.client_id AND cliente_epoca.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = f.organization_id AND cliente_atual.client_id = fonte_atual.client_id AND cliente_atual.atual
WHERE IFNULL(cliente_epoca.status, '') != 'excluido'
  AND IFNULL(cliente_atual.status, '') != 'excluido';

CREATE OR REPLACE VIEW `{{DATASET}}.vw_meta_recorte_regiao` AS
WITH fatos AS (
  SELECT *
  FROM `{{DATASET}}.fato_meta_recorte_regiao`
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY organization_id, ad_account_id, adset_id, data_dia, regiao
    ORDER BY inserido_em DESC
  ) = 1
)
SELECT
  f.*,
  fonte_epoca.client_id AS cliente_na_epoca_id,
  cliente_epoca.nome AS cliente_na_epoca_nome,
  cliente_epoca.status AS cliente_na_epoca_status,
  fonte_atual.client_id AS cliente_atual_id,
  cliente_atual.nome AS cliente_atual_nome,
  cliente_atual.status AS cliente_atual_status,
  fonte_atual.status AS fonte_status_atual,
  fonte_atual.nome AS fonte_nome_atual
FROM fatos f
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` fonte_epoca
  ON fonte_epoca.organization_id = f.organization_id AND fonte_epoca.platform = 'meta' AND fonte_epoca.external_id = f.ad_account_id
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') >= fonte_epoca.valido_de
  AND TIMESTAMP(f.data_dia, 'America/Sao_Paulo') < fonte_epoca.valido_ate
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` fonte_atual
  ON fonte_atual.organization_id = f.organization_id AND fonte_atual.platform = 'meta' AND fonte_atual.external_id = f.ad_account_id
  AND fonte_atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_epoca
  ON cliente_epoca.organization_id = f.organization_id AND cliente_epoca.client_id = fonte_epoca.client_id AND cliente_epoca.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = f.organization_id AND cliente_atual.client_id = fonte_atual.client_id AND cliente_atual.atual
WHERE IFNULL(cliente_epoca.status, '') != 'excluido'
  AND IFNULL(cliente_atual.status, '') != 'excluido';

CREATE OR REPLACE VIEW `{{DATASET}}.vw_meta_campanha` AS
SELECT
  f.*,
  fonte_epoca.client_id AS cliente_na_epoca_id,
  cliente_epoca.nome AS cliente_na_epoca_nome,
  cliente_epoca.status AS cliente_na_epoca_status,
  fonte_atual.client_id AS cliente_atual_id,
  cliente_atual.nome AS cliente_atual_nome,
  cliente_atual.status AS cliente_atual_status,
  fonte_atual.status AS fonte_status_atual,
  fonte_atual.nome AS fonte_nome_atual
FROM `{{DATASET}}.dim_meta_campanha_scd2` f
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` fonte_epoca
  ON fonte_epoca.organization_id = f.organization_id AND fonte_epoca.platform = 'meta' AND fonte_epoca.external_id = f.ad_account_id
  AND f.valido_de >= fonte_epoca.valido_de
  AND f.valido_de < fonte_epoca.valido_ate
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` fonte_atual
  ON fonte_atual.organization_id = f.organization_id AND fonte_atual.platform = 'meta' AND fonte_atual.external_id = f.ad_account_id
  AND fonte_atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_epoca
  ON cliente_epoca.organization_id = f.organization_id AND cliente_epoca.client_id = fonte_epoca.client_id AND cliente_epoca.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = f.organization_id AND cliente_atual.client_id = fonte_atual.client_id AND cliente_atual.atual
WHERE IFNULL(cliente_epoca.status, '') != 'excluido'
  AND IFNULL(cliente_atual.status, '') != 'excluido';

CREATE OR REPLACE VIEW `{{DATASET}}.vw_meta_conjunto` AS
SELECT
  f.*,
  fonte_epoca.client_id AS cliente_na_epoca_id,
  cliente_epoca.nome AS cliente_na_epoca_nome,
  cliente_epoca.status AS cliente_na_epoca_status,
  fonte_atual.client_id AS cliente_atual_id,
  cliente_atual.nome AS cliente_atual_nome,
  cliente_atual.status AS cliente_atual_status,
  fonte_atual.status AS fonte_status_atual,
  fonte_atual.nome AS fonte_nome_atual
FROM `{{DATASET}}.dim_meta_conjunto_scd2` f
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` fonte_epoca
  ON fonte_epoca.organization_id = f.organization_id AND fonte_epoca.platform = 'meta' AND fonte_epoca.external_id = f.ad_account_id
  AND f.valido_de >= fonte_epoca.valido_de
  AND f.valido_de < fonte_epoca.valido_ate
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` fonte_atual
  ON fonte_atual.organization_id = f.organization_id AND fonte_atual.platform = 'meta' AND fonte_atual.external_id = f.ad_account_id
  AND fonte_atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_epoca
  ON cliente_epoca.organization_id = f.organization_id AND cliente_epoca.client_id = fonte_epoca.client_id AND cliente_epoca.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = f.organization_id AND cliente_atual.client_id = fonte_atual.client_id AND cliente_atual.atual
WHERE IFNULL(cliente_epoca.status, '') != 'excluido'
  AND IFNULL(cliente_atual.status, '') != 'excluido';

CREATE OR REPLACE VIEW `{{DATASET}}.vw_meta_anuncio` AS
SELECT
  f.*,
  fonte_epoca.client_id AS cliente_na_epoca_id,
  cliente_epoca.nome AS cliente_na_epoca_nome,
  cliente_epoca.status AS cliente_na_epoca_status,
  fonte_atual.client_id AS cliente_atual_id,
  cliente_atual.nome AS cliente_atual_nome,
  cliente_atual.status AS cliente_atual_status,
  fonte_atual.status AS fonte_status_atual,
  fonte_atual.nome AS fonte_nome_atual
FROM `{{DATASET}}.dim_meta_anuncio_scd2` f
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` fonte_epoca
  ON fonte_epoca.organization_id = f.organization_id AND fonte_epoca.platform = 'meta' AND fonte_epoca.external_id = f.ad_account_id
  AND f.valido_de >= fonte_epoca.valido_de
  AND f.valido_de < fonte_epoca.valido_ate
LEFT JOIN `{{DATASET}}.dim_fonte_scd2` fonte_atual
  ON fonte_atual.organization_id = f.organization_id AND fonte_atual.platform = 'meta' AND fonte_atual.external_id = f.ad_account_id
  AND fonte_atual.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_epoca
  ON cliente_epoca.organization_id = f.organization_id AND cliente_epoca.client_id = fonte_epoca.client_id AND cliente_epoca.atual
LEFT JOIN `{{DATASET}}.dim_cliente_scd2` cliente_atual
  ON cliente_atual.organization_id = f.organization_id AND cliente_atual.client_id = fonte_atual.client_id AND cliente_atual.atual
WHERE IFNULL(cliente_epoca.status, '') != 'excluido'
  AND IFNULL(cliente_atual.status, '') != 'excluido';
