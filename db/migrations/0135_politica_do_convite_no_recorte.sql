BEGIN;

DO $$
BEGIN
  PERFORM set_config(
    'convite.papel_app',
    (SELECT rolname FROM pg_roles WHERE rolname IN ('orla_app', 'tria_app') ORDER BY rolname = 'orla_app' DESC LIMIT 1),
    true
  );
END $$;

DO $$ BEGIN
  EXECUTE 'DROP POLICY IF EXISTS connection_invites_tenant ON integrations.connection_invites';
  EXECUTE format(
    'CREATE POLICY connection_invites_tenant ON integrations.connection_invites FOR ALL TO %I
       USING (organization_id = core.current_organization()
              AND core.cliente_no_escopo(client_id)
              AND EXISTS (SELECT 1 FROM core.clients c WHERE c.id = connection_invites.client_id))
       WITH CHECK (organization_id = core.current_organization()
              AND core.cliente_no_escopo(client_id)
              AND EXISTS (SELECT 1 FROM core.clients c WHERE c.id = connection_invites.client_id))',
    current_setting('convite.papel_app'));

  EXECUTE 'DROP POLICY IF EXISTS connection_invite_items_tenant ON integrations.connection_invite_items';
  EXECUTE format(
    'CREATE POLICY connection_invite_items_tenant ON integrations.connection_invite_items FOR ALL TO %I
       USING (organization_id = core.current_organization()
              AND EXISTS (SELECT 1 FROM integrations.connection_invites v
                           WHERE v.id = connection_invite_items.invite_id
                             AND v.organization_id = connection_invite_items.organization_id
                             AND core.cliente_no_escopo(v.client_id)))
       WITH CHECK (organization_id = core.current_organization()
              AND EXISTS (SELECT 1 FROM integrations.connection_invites v
                           WHERE v.id = connection_invite_items.invite_id
                             AND v.organization_id = connection_invite_items.organization_id
                             AND core.cliente_no_escopo(v.client_id)))',
    current_setting('convite.papel_app'));
END $$;

COMMIT;
