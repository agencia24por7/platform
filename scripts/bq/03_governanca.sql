CREATE TABLE IF NOT EXISTS `{{DATASET}}.gov_snapshot_fontes` (
  organization_id   STRING NOT NULL,
  client_id         STRING NOT NULL,
  platform          STRING NOT NULL,
  fonte_tipo        STRING NOT NULL,
  fonte_id          STRING NOT NULL,
  nome              STRING,
  estado            STRING,
  inactive          BOOL,
  rotulo_esperado   STRING,
  rotulo_observado  STRING,
  visto_em          TIMESTAMP NOT NULL
)
PARTITION BY DATE(visto_em)
CLUSTER BY organization_id, client_id;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.gov_paridade` (
  organization_id  STRING NOT NULL,
  client_id        STRING NOT NULL,
  platform         STRING NOT NULL,
  fonte_id         STRING NOT NULL,
  tipo             STRING NOT NULL,
  esperado         STRING,
  observado        STRING,
  execucao_id      STRING,
  detectado_em     TIMESTAMP NOT NULL
)
PARTITION BY DATE(detectado_em)
CLUSTER BY organization_id, client_id;

CREATE TABLE IF NOT EXISTS `{{DATASET}}.qc_execucoes` (
  organization_id    STRING NOT NULL,
  client_id          STRING NOT NULL,
  execucao_id        STRING NOT NULL,
  platform           STRING NOT NULL,
  fonte_id           STRING NOT NULL,
  modo               STRING NOT NULL,
  window_start       DATE,
  window_end         DATE,
  fontes_esperadas   INT64,
  fontes_coletadas   INT64,
  linhas             INT64,
  bytes              INT64,
  requests           INT64,
  duracao_ms         INT64,
  status             STRING,
  qualidade_resumo   JSON,
  criado_em          TIMESTAMP NOT NULL
)
PARTITION BY DATE(criado_em)
CLUSTER BY organization_id, client_id;
