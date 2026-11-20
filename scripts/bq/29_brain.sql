CREATE TABLE IF NOT EXISTS `{{DATASET}}.gov_cobertura_cliente` (
  organization_id  STRING NOT NULL,
  client_id        STRING NOT NULL,
  tabela           STRING NOT NULL,
  desde            DATE,
  ate              DATE,
  linhas           INT64 NOT NULL,
  dias_com_dado    INT64,
  medido_em        TIMESTAMP NOT NULL
)
CLUSTER BY organization_id, client_id, tabela;
