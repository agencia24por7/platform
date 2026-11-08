BEGIN;

DROP POLICY IF EXISTS audit_read_tenant ON audit.audit_log;

CREATE POLICY audit_read_tenant ON audit.audit_log FOR SELECT TO tria_app
  USING (organization_id = core.current_organization());

DROP POLICY IF EXISTS organizations_tenant ON core.organizations;

CREATE POLICY organizations_read ON core.organizations FOR SELECT TO tria_app
  USING (core.current_organization() IS NULL OR id = core.current_organization());

CREATE POLICY organizations_write ON core.organizations FOR INSERT TO tria_app
  WITH CHECK (true);

CREATE POLICY organizations_update ON core.organizations FOR UPDATE TO tria_app
  USING (id = core.current_organization())
  WITH CHECK (id = core.current_organization());

COMMENT ON POLICY organizations_read ON core.organizations IS
  'Leitura sem contexto é deliberada e restrita ao primeiro acesso, quando ainda não existe organização para fixar o contexto. Toda outra tabela exige contexto.';

COMMIT;
