BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS integrations;
CREATE SCHEMA IF NOT EXISTS metrics;
CREATE SCHEMA IF NOT EXISTS automation;
CREATE SCHEMA IF NOT EXISTS audit;

CREATE TYPE core.organization_type AS ENUM ('agency', 'advertiser');
CREATE TYPE core.business_model AS ENUM ('leads', 'ecommerce');
CREATE TYPE core.lifecycle_status AS ENUM ('active', 'paused', 'archived');
CREATE TYPE integrations.platform AS ENUM ('meta', 'google');
CREATE TYPE integrations.grant_type AS ENUM ('mcc', 'bm_partner', 'system_user', 'oauth_user');
CREATE TYPE integrations.connection_status AS ENUM ('active', 'expiring', 'degraded', 'revoked', 'reauth_pending');
CREATE TYPE integrations.account_status AS ENUM ('linked', 'pending', 'error', 'unlinked');
CREATE TYPE automation.run_status AS ENUM ('running', 'success', 'partial', 'failed');
CREATE TYPE audit.actor_type AS ENUM ('user', 'agent', 'worker', 'system');

CREATE TABLE core.organizations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  slug                 text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'),
  type                 core.organization_type NOT NULL,
  manager_account_id   text CHECK (manager_account_id IS NULL OR length(manager_account_id) <= 64),
  business_manager_id  text CHECK (business_manager_id IS NULL OR length(business_manager_id) <= 64),
  developer_token_ref  text CHECK (developer_token_ref IS NULL OR length(developer_token_ref) <= 256),
  status               core.lifecycle_status NOT NULL DEFAULT 'active',
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE core.clients (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES core.organizations(id) ON DELETE RESTRICT,
  parent_client_id  uuid REFERENCES core.clients(id) ON DELETE RESTRICT,
  name              text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  segment           text CHECK (segment IS NULL OR length(segment) <= 120),
  business_model    core.business_model NOT NULL,
  status            core.lifecycle_status NOT NULL DEFAULT 'active',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clients_name_unique_per_org UNIQUE (organization_id, name),
  CONSTRAINT clients_parent_not_self CHECK (parent_client_id IS NULL OR parent_client_id <> id)
);

CREATE INDEX clients_organization_idx ON core.clients (organization_id);
CREATE INDEX clients_parent_idx ON core.clients (parent_client_id) WHERE parent_client_id IS NOT NULL;

CREATE TABLE integrations.connections (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES core.organizations(id) ON DELETE RESTRICT,
  platform         integrations.platform NOT NULL,
  grant_type       integrations.grant_type NOT NULL,
  label            text NOT NULL CHECK (length(btrim(label)) BETWEEN 2 AND 120),
  external_id      text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 64),
  scopes           text[] NOT NULL DEFAULT '{}',
  credential_ref   text NOT NULL CHECK (length(credential_ref) BETWEEN 1 AND 128),
  status           integrations.connection_status NOT NULL DEFAULT 'active',
  expires_at       timestamptz,
  authorized_at    timestamptz NOT NULL DEFAULT now(),
  last_checked_at  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT connections_unique_per_org UNIQUE (organization_id, platform, external_id)
);

COMMENT ON COLUMN integrations.connections.credential_ref IS
  'Identificador da credencial no n8n. O segredo nunca trafega nem é armazenado aqui.';

CREATE TABLE integrations.ad_accounts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES core.organizations(id) ON DELETE RESTRICT,
  client_id        uuid NOT NULL REFERENCES core.clients(id) ON DELETE RESTRICT,
  connection_id    uuid NOT NULL REFERENCES integrations.connections(id) ON DELETE RESTRICT,
  platform         integrations.platform NOT NULL,
  external_id      text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 64),
  name             text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 160),
  account_group    text NOT NULL DEFAULT 'Principal' CHECK (length(account_group) <= 60),
  currency         char(3) NOT NULL DEFAULT 'BRL',
  timezone         text NOT NULL DEFAULT 'America/Sao_Paulo' CHECK (length(timezone) <= 64),
  status           integrations.account_status NOT NULL DEFAULT 'linked',
  sync_enabled     boolean NOT NULL DEFAULT true,
  last_sync_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ad_accounts_unique_external UNIQUE (organization_id, platform, external_id)
);

CREATE INDEX ad_accounts_client_idx ON integrations.ad_accounts (client_id);
CREATE INDEX ad_accounts_sync_idx ON integrations.ad_accounts (sync_enabled, last_sync_at);

CREATE TABLE automation.sync_runs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES core.organizations(id) ON DELETE RESTRICT,
  ad_account_id     uuid NOT NULL REFERENCES integrations.ad_accounts(id) ON DELETE RESTRICT,
  workflow          text NOT NULL CHECK (length(workflow) BETWEEN 2 AND 120),
  trigger_source    text NOT NULL CHECK (length(trigger_source) BETWEEN 2 AND 40),
  idempotency_key   text NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 8 AND 160),
  status            automation.run_status NOT NULL DEFAULT 'running',
  window_start      date NOT NULL,
  window_end        date NOT NULL,
  api_version       text CHECK (api_version IS NULL OR length(api_version) <= 24),
  request_count     integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  rows_received     integer NOT NULL DEFAULT 0 CHECK (rows_received >= 0),
  rows_written      integer NOT NULL DEFAULT 0 CHECK (rows_written >= 0),
  rows_restated     integer NOT NULL DEFAULT 0 CHECK (rows_restated >= 0),
  started_at        timestamptz NOT NULL DEFAULT now(),
  finished_at       timestamptz,
  duration_ms       integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
  n8n_execution_id  text CHECK (n8n_execution_id IS NULL OR length(n8n_execution_id) <= 64),
  error_code        text CHECK (error_code IS NULL OR length(error_code) <= 80),
  error_message     text CHECK (error_message IS NULL OR length(error_message) <= 1000),
  CONSTRAINT sync_runs_window_order CHECK (window_end >= window_start)
);

CREATE INDEX sync_runs_account_idx ON automation.sync_runs (ad_account_id, started_at DESC);
CREATE INDEX sync_runs_status_idx ON automation.sync_runs (status, started_at DESC);

CREATE TABLE metrics.metrics_daily (
  ad_account_id        uuid NOT NULL REFERENCES integrations.ad_accounts(id) ON DELETE RESTRICT,
  external_campaign_id text NOT NULL CHECK (length(external_campaign_id) BETWEEN 1 AND 64),
  metric_date          date NOT NULL,
  campaign_name        text CHECK (campaign_name IS NULL OR length(campaign_name) <= 200),
  spend                numeric(14,2) NOT NULL DEFAULT 0 CHECK (spend >= 0),
  impressions          bigint NOT NULL DEFAULT 0 CHECK (impressions >= 0),
  clicks               bigint NOT NULL DEFAULT 0 CHECK (clicks >= 0),
  conversions          numeric(14,2) NOT NULL DEFAULT 0 CHECK (conversions >= 0),
  revenue              numeric(14,2) NOT NULL DEFAULT 0 CHECK (revenue >= 0),
  currency             char(3) NOT NULL DEFAULT 'BRL',
  source_api_version   text CHECK (source_api_version IS NULL OR length(source_api_version) <= 24),
  first_ingested_at    timestamptz NOT NULL DEFAULT now(),
  last_ingested_at     timestamptz NOT NULL DEFAULT now(),
  last_sync_run_id     uuid REFERENCES automation.sync_runs(id) ON DELETE SET NULL,
  PRIMARY KEY (ad_account_id, external_campaign_id, metric_date)
);

CREATE INDEX metrics_daily_date_idx ON metrics.metrics_daily (metric_date DESC);

CREATE TABLE metrics.metrics_restatements (
  id                   bigserial PRIMARY KEY,
  ad_account_id        uuid NOT NULL REFERENCES integrations.ad_accounts(id) ON DELETE RESTRICT,
  external_campaign_id text NOT NULL,
  metric_date          date NOT NULL,
  field                text NOT NULL CHECK (length(field) <= 40),
  previous_value       numeric(14,2) NOT NULL,
  new_value            numeric(14,2) NOT NULL,
  sync_run_id          uuid REFERENCES automation.sync_runs(id) ON DELETE SET NULL,
  restated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX metrics_restatements_lookup_idx
  ON metrics.metrics_restatements (ad_account_id, metric_date DESC);

CREATE TABLE audit.audit_log (
  id               bigserial PRIMARY KEY,
  organization_id  uuid REFERENCES core.organizations(id) ON DELETE RESTRICT,
  occurred_at      timestamptz NOT NULL DEFAULT now(),
  actor_type       audit.actor_type NOT NULL,
  actor_id         text CHECK (actor_id IS NULL OR length(actor_id) <= 120),
  action           text NOT NULL CHECK (length(action) BETWEEN 3 AND 80),
  target_type      text CHECK (target_type IS NULL OR length(target_type) <= 60),
  target_id        text CHECK (target_id IS NULL OR length(target_id) <= 120),
  request_id       text CHECK (request_id IS NULL OR length(request_id) <= 64),
  source_ip        inet,
  metadata         jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX audit_log_org_idx ON audit.audit_log (organization_id, occurred_at DESC);
CREATE INDEX audit_log_action_idx ON audit.audit_log (action, occurred_at DESC);

CREATE OR REPLACE FUNCTION core.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER organizations_touch BEFORE UPDATE ON core.organizations
  FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();
CREATE TRIGGER clients_touch BEFORE UPDATE ON core.clients
  FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();
CREATE TRIGGER connections_touch BEFORE UPDATE ON integrations.connections
  FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();
CREATE TRIGGER ad_accounts_touch BEFORE UPDATE ON integrations.ad_accounts
  FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();

COMMIT;
