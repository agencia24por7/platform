BEGIN;

CREATE TABLE core.member_clients (
  member_id  uuid NOT NULL REFERENCES core.members(id) ON DELETE RESTRICT,
  client_id  uuid NOT NULL REFERENCES core.clients(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  PRIMARY KEY (member_id, client_id)
);

COMMENT ON TABLE core.member_clients IS
  'Recorte de acesso. Sem nenhuma linha, a pessoa enxerga a organização inteira; com linhas, enxerga apenas esses clientes. É assim que um cliente final entra para ver só o que é dele.';

CREATE INDEX member_clients_por_cliente ON core.member_clients (client_id);

GRANT SELECT, INSERT, UPDATE ON core.member_clients TO tria_app;

COMMENT ON COLUMN core.member_clients.revoked_at IS
  'O recorte tambem nao se apaga: tirar um cliente de alguem fica escrito.';

ALTER TABLE core.member_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.member_clients FORCE ROW LEVEL SECURITY;

CREATE POLICY member_clients_tenant ON core.member_clients FOR ALL TO tria_app
  USING (EXISTS (
    SELECT 1 FROM core.members m
    WHERE m.id = member_id AND m.organization_id = core.current_organization()))
  WITH CHECK (EXISTS (
    SELECT 1 FROM core.members m
    WHERE m.id = member_id AND m.organization_id = core.current_organization()));

CREATE OR REPLACE FUNCTION core.current_clients() RETURNS uuid[]
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN coalesce(current_setting('app.client_ids', true), '*') IN ('', '*') THEN NULL
    WHEN current_setting('app.client_ids', true) = 'nenhum' THEN ARRAY[]::uuid[]
    ELSE string_to_array(current_setting('app.client_ids', true), ',')::uuid[]
  END
$$;

COMMENT ON FUNCTION core.current_clients() IS
  'Lista de clientes visíveis na sessão. NULL significa organização inteira; a ausência do recorte é o caso comum, não uma falha.';

CREATE OR REPLACE FUNCTION core.cliente_no_escopo(p_client_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT core.current_clients() IS NULL OR p_client_id = ANY (core.current_clients())
$$;

CREATE OR REPLACE FUNCTION core.client_scope_of(p_user_id uuid, p_organization_id uuid)
RETURNS uuid[]
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT CASE WHEN count(mc.client_id) = 0 THEN NULL
              ELSE array_agg(mc.client_id ORDER BY mc.client_id) END
  FROM core.members m
  LEFT JOIN core.member_clients mc ON mc.member_id = m.id AND mc.revoked_at IS NULL
  WHERE m.user_id = p_user_id
    AND m.organization_id = p_organization_id
    AND m.revoked_at IS NULL
$$;

COMMENT ON FUNCTION core.client_scope_of(uuid, uuid) IS
  'Resolve o recorte antes de abrir a transação do inquilino. Devolve identificadores, nunca segredo.';

REVOKE ALL ON FUNCTION core.client_scope_of(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.client_scope_of(uuid, uuid) TO tria_app;

DROP POLICY clients_tenant ON core.clients;
CREATE POLICY clients_tenant ON core.clients FOR ALL TO tria_app
  USING (organization_id = core.current_organization() AND core.cliente_no_escopo(id))
  WITH CHECK (organization_id = core.current_organization() AND core.cliente_no_escopo(id));

DROP POLICY ad_accounts_tenant ON integrations.ad_accounts;
CREATE POLICY ad_accounts_tenant ON integrations.ad_accounts FOR ALL TO tria_app
  USING (organization_id = core.current_organization() AND core.cliente_no_escopo(client_id))
  WITH CHECK (organization_id = core.current_organization() AND core.cliente_no_escopo(client_id));

DROP POLICY metrics_daily_tenant ON metrics.metrics_daily;
CREATE POLICY metrics_daily_tenant ON metrics.metrics_daily FOR ALL TO tria_app
  USING (EXISTS (
    SELECT 1 FROM integrations.ad_accounts a
    WHERE a.id = ad_account_id
      AND a.organization_id = core.current_organization()
      AND core.cliente_no_escopo(a.client_id)))
  WITH CHECK (EXISTS (
    SELECT 1 FROM integrations.ad_accounts a
    WHERE a.id = ad_account_id
      AND a.organization_id = core.current_organization()
      AND core.cliente_no_escopo(a.client_id)));

DROP POLICY metrics_restatements_tenant ON metrics.metrics_restatements;
CREATE POLICY metrics_restatements_tenant ON metrics.metrics_restatements FOR ALL TO tria_app
  USING (EXISTS (
    SELECT 1 FROM integrations.ad_accounts a
    WHERE a.id = ad_account_id
      AND a.organization_id = core.current_organization()
      AND core.cliente_no_escopo(a.client_id)))
  WITH CHECK (EXISTS (
    SELECT 1 FROM integrations.ad_accounts a
    WHERE a.id = ad_account_id
      AND a.organization_id = core.current_organization()
      AND core.cliente_no_escopo(a.client_id)));

DROP POLICY sync_runs_tenant ON automation.sync_runs;
CREATE POLICY sync_runs_tenant ON automation.sync_runs FOR ALL TO tria_app
  USING (organization_id = core.current_organization() AND EXISTS (
    SELECT 1 FROM integrations.ad_accounts a
    WHERE a.id = ad_account_id AND core.cliente_no_escopo(a.client_id)))
  WITH CHECK (organization_id = core.current_organization() AND EXISTS (
    SELECT 1 FROM integrations.ad_accounts a
    WHERE a.id = ad_account_id AND core.cliente_no_escopo(a.client_id)));

DROP POLICY audit_read_tenant ON audit.audit_log;
CREATE POLICY audit_read_tenant ON audit.audit_log FOR SELECT TO tria_app
  USING (organization_id = core.current_organization() AND core.current_clients() IS NULL);

COMMENT ON POLICY audit_read_tenant ON audit.audit_log IS
  'A trilha é da organização inteira e não sabe recortar por cliente. Quem entra com recorte não a lê.';

DROP POLICY members_tenant ON core.members;
CREATE POLICY members_tenant ON core.members FOR ALL TO tria_app
  USING ((core.current_organization() IS NULL OR organization_id = core.current_organization())
         AND core.current_clients() IS NULL)
  WITH CHECK (organization_id = core.current_organization() AND core.current_clients() IS NULL);

COMMENT ON POLICY members_tenant ON core.members IS
  'Quem entra com recorte de cliente nao ve a equipe: a lista de quem trabalha na agencia nao e dado do cliente.';

DROP POLICY connections_tenant ON integrations.connections;
CREATE POLICY connections_tenant ON integrations.connections FOR ALL TO tria_app
  USING (organization_id = core.current_organization() AND core.current_clients() IS NULL)
  WITH CHECK (organization_id = core.current_organization() AND core.current_clients() IS NULL);

DROP POLICY connection_accounts_tenant ON integrations.connection_accounts;
CREATE POLICY connection_accounts_tenant ON integrations.connection_accounts FOR ALL TO tria_app
  USING (organization_id = core.current_organization() AND core.current_clients() IS NULL)
  WITH CHECK (organization_id = core.current_organization() AND core.current_clients() IS NULL);

DROP POLICY account_tasks_tenant ON automation.account_tasks;
CREATE POLICY account_tasks_tenant ON automation.account_tasks FOR ALL TO tria_app
  USING (organization_id = core.current_organization() AND core.current_clients() IS NULL)
  WITH CHECK (organization_id = core.current_organization() AND core.current_clients() IS NULL);

DROP POLICY invitations_tenant ON core.invitations;
CREATE POLICY invitations_tenant ON core.invitations FOR ALL TO tria_app
  USING ((core.current_organization() IS NULL OR organization_id = core.current_organization())
         AND core.current_clients() IS NULL)
  WITH CHECK (organization_id = core.current_organization() AND core.current_clients() IS NULL);

COMMIT;
