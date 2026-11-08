BEGIN;

GRANT USAGE ON SCHEMA core, integrations, metrics, automation, audit TO tria_app;

GRANT SELECT, INSERT, UPDATE ON
  core.organizations, core.clients,
  integrations.connections, integrations.ad_accounts,
  automation.sync_runs, metrics.metrics_daily
TO tria_app;

GRANT SELECT, INSERT ON metrics.metrics_restatements TO tria_app;
GRANT INSERT, SELECT ON audit.audit_log TO tria_app;

GRANT USAGE, SELECT ON SEQUENCE
  metrics.metrics_restatements_id_seq, audit.audit_log_id_seq TO tria_app;

REVOKE DELETE, TRUNCATE ON ALL TABLES IN SCHEMA core, integrations, metrics, automation, audit FROM tria_app;
REVOKE UPDATE ON audit.audit_log FROM tria_app;

ALTER TABLE core.organizations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.clients                ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations.connections    ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations.ad_accounts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation.sync_runs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.audit_log             ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION core.current_organization() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.organization_id', true), '')::uuid
$$;

CREATE POLICY organizations_tenant ON core.organizations FOR ALL TO tria_app
  USING (core.current_organization() IS NULL OR id = core.current_organization())
  WITH CHECK (true);

CREATE POLICY clients_tenant ON core.clients FOR ALL TO tria_app
  USING (organization_id = core.current_organization())
  WITH CHECK (organization_id = core.current_organization());

CREATE POLICY connections_tenant ON integrations.connections FOR ALL TO tria_app
  USING (organization_id = core.current_organization())
  WITH CHECK (organization_id = core.current_organization());

CREATE POLICY ad_accounts_tenant ON integrations.ad_accounts FOR ALL TO tria_app
  USING (organization_id = core.current_organization())
  WITH CHECK (organization_id = core.current_organization());

CREATE POLICY sync_runs_tenant ON automation.sync_runs FOR ALL TO tria_app
  USING (organization_id = core.current_organization())
  WITH CHECK (organization_id = core.current_organization());

CREATE POLICY audit_insert ON audit.audit_log FOR INSERT TO tria_app WITH CHECK (true);
CREATE POLICY audit_read_tenant ON audit.audit_log FOR SELECT TO tria_app
  USING (core.current_organization() IS NULL OR organization_id = core.current_organization());

COMMENT ON ROLE tria_worker IS
  'Reservado. Na v0 o n8n fala apenas com a API do app; nenhum privilégio de objeto é concedido.';

COMMIT;
