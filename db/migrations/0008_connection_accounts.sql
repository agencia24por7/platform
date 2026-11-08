BEGIN;

CREATE TYPE integrations.discovered_state AS ENUM ('discovered', 'linked', 'ignored', 'lost');

CREATE TABLE integrations.connection_accounts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES core.organizations(id) ON DELETE RESTRICT,
  connection_id         uuid NOT NULL REFERENCES integrations.connections(id) ON DELETE CASCADE,
  platform              integrations.platform NOT NULL,
  external_id           text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 64),
  name                  text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  currency              char(3) NOT NULL DEFAULT 'BRL',
  timezone              text NOT NULL DEFAULT 'America/Sao_Paulo',
  manager_external_id   text CHECK (manager_external_id IS NULL OR length(manager_external_id) <= 64),
  inactive              boolean NOT NULL DEFAULT false,
  state                 integrations.discovered_state NOT NULL DEFAULT 'discovered',
  ad_account_id         uuid REFERENCES integrations.ad_accounts(id) ON DELETE SET NULL,
  discovered_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT connection_accounts_unique UNIQUE (connection_id, external_id)
);

CREATE INDEX connection_accounts_org_idx ON integrations.connection_accounts (organization_id, state);

COMMENT ON TABLE integrations.connection_accounts IS
  'O que uma autorização descobriu. Um grant rende N contas; só as escolhidas viram ad_accounts.';

ALTER TABLE integrations.connection_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY connection_accounts_tenant ON integrations.connection_accounts FOR ALL TO tria_app
  USING (organization_id = core.current_organization())
  WITH CHECK (organization_id = core.current_organization());

GRANT SELECT, INSERT, UPDATE ON integrations.connection_accounts TO tria_app;

COMMIT;
