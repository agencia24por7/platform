BEGIN;

CREATE TYPE integrations.invite_kind AS ENUM ('oauth_self_service');

COMMENT ON TYPE integrations.invite_kind IS
  'oauth_self_service é o cliente autorizando com a própria conta, por link. Chave de API por convite é extensão natural futura, quando essas plataformas deixarem de ser conexão única por organização.';

CREATE TYPE integrations.invite_status AS ENUM ('pending', 'completed', 'expired', 'revoked');

CREATE TABLE integrations.connection_invites (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES core.organizations(id) ON DELETE RESTRICT,
  client_id        uuid NOT NULL REFERENCES core.clients(id) ON DELETE RESTRICT,
  kind             integrations.invite_kind NOT NULL,
  token            text NOT NULL UNIQUE CHECK (length(token) BETWEEN 16 AND 64),
  status           integrations.invite_status NOT NULL DEFAULT 'pending',
  created_by       uuid REFERENCES core.users(id) ON DELETE RESTRICT,
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  revoked_at       timestamptz
);

COMMENT ON TABLE integrations.connection_invites IS
  'Convite para o próprio cliente autorizar plataformas sem precisar de conta na Orla. O segredo é o token, nunca o id — mesmo princípio do webhook_token.';
COMMENT ON COLUMN integrations.connection_invites.token IS
  'Alta entropia (base64url de 24 bytes aleatórios). Só quem possui a URL completa consegue avançar o convite.';

CREATE INDEX connection_invites_org_idx ON integrations.connection_invites (organization_id);
CREATE INDEX connection_invites_client_idx ON integrations.connection_invites (client_id);

ALTER TABLE integrations.connection_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations.connection_invites FORCE ROW LEVEL SECURITY;

CREATE POLICY connection_invites_tenant ON integrations.connection_invites FOR ALL TO tria_app
  USING (organization_id = core.current_organization())
  WITH CHECK (organization_id = core.current_organization());

GRANT SELECT, INSERT, UPDATE ON integrations.connection_invites TO tria_app;

CREATE TABLE integrations.connection_invite_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_id        uuid NOT NULL REFERENCES integrations.connection_invites(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL REFERENCES core.organizations(id) ON DELETE RESTRICT,
  platform         integrations.platform NOT NULL,
  status           integrations.invite_status NOT NULL DEFAULT 'pending',
  connection_id    uuid REFERENCES integrations.connections(id) ON DELETE SET NULL,
  completed_at     timestamptz,
  CONSTRAINT connection_invite_items_unique UNIQUE (invite_id, platform)
);

COMMENT ON TABLE integrations.connection_invite_items IS
  'Uma plataforma escolhida dentro de um convite. organization_id vem repetido aqui (como em automation.account_tasks) para a política de RLS não depender de join.';

CREATE INDEX connection_invite_items_invite_idx ON integrations.connection_invite_items (invite_id);

ALTER TABLE integrations.connection_invite_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations.connection_invite_items FORCE ROW LEVEL SECURITY;

CREATE POLICY connection_invite_items_tenant ON integrations.connection_invite_items FOR ALL TO tria_app
  USING (organization_id = core.current_organization())
  WITH CHECK (organization_id = core.current_organization());

GRANT SELECT, INSERT, UPDATE ON integrations.connection_invite_items TO tria_app;

CREATE FUNCTION integrations.resolve_invite_item(p_token text, p_platform integrations.platform)
RETURNS TABLE (
  invite_id        uuid,
  item_id          uuid,
  organization_id  uuid,
  client_id        uuid,
  status           integrations.invite_status
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT i.id, it.id, i.organization_id, i.client_id, it.status
  FROM integrations.connection_invites i
  JOIN integrations.connection_invite_items it ON it.invite_id = i.id
  WHERE i.token = p_token
    AND it.platform = p_platform
    AND i.status = 'pending'
    AND it.status = 'pending'
    AND i.expires_at > now();
$$;

COMMENT ON FUNCTION integrations.resolve_invite_item IS
  'Única travessia de tenant do sistema para o convite. Resolve pelo segredo do token, nunca por id de convite — e já recusa convite expirado ou revogado antes de devolver qualquer coisa.';

REVOKE ALL ON FUNCTION integrations.resolve_invite_item(text, integrations.platform) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION integrations.resolve_invite_item(text, integrations.platform) TO tria_app;

CREATE FUNCTION integrations.resolve_invite_for_display(p_token text)
RETURNS TABLE (
  invite_id    uuid,
  status       integrations.invite_status,
  expires_at   timestamptz,
  organization_name text,
  items        jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT i.id, i.status, i.expires_at, o.name,
         coalesce(
           jsonb_agg(jsonb_build_object('platform', it.platform, 'status', it.status) ORDER BY it.platform),
           '[]'::jsonb
         )
  FROM integrations.connection_invites i
  JOIN core.organizations o ON o.id = i.organization_id
  LEFT JOIN integrations.connection_invite_items it ON it.invite_id = i.id
  WHERE i.token = p_token
  GROUP BY i.id, i.status, i.expires_at, o.name;
$$;

COMMENT ON FUNCTION integrations.resolve_invite_for_display IS
  'Única travessia de tenant do sistema para exibir o convite na página pública. Só mostra o nome da organização e o estado de cada item — nunca o token de outro convite nem dado de outro cliente.';

REVOKE ALL ON FUNCTION integrations.resolve_invite_for_display(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION integrations.resolve_invite_for_display(text) TO tria_app;

CREATE FUNCTION integrations.invite_item_still_pending(p_item_id uuid)
RETURNS TABLE (
  organization_id  uuid,
  client_id        uuid
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT i.organization_id, i.client_id
  FROM integrations.connection_invite_items it
  JOIN integrations.connection_invites i ON i.id = it.invite_id
  WHERE it.id = p_item_id
    AND it.status = 'pending'
    AND i.status = 'pending'
    AND i.expires_at > now();
$$;

COMMENT ON FUNCTION integrations.invite_item_still_pending IS
  'Segunda checagem, feita no callback do OAuth — não no início. Reconfirma no banco que o item ainda vale, para o caso de duas abas completarem o mesmo convite entre o start e o callback.';

REVOKE ALL ON FUNCTION integrations.invite_item_still_pending(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION integrations.invite_item_still_pending(uuid) TO tria_app;

CREATE FUNCTION integrations.complete_invite_item(p_item_id uuid, p_connection_id uuid)
RETURNS TABLE (
  client_id        uuid,
  organization_id  uuid
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
VOLATILE
AS $$
  UPDATE integrations.connection_invite_items it
  SET status = 'completed', connection_id = p_connection_id, completed_at = now()
  FROM integrations.connection_invites i
  WHERE it.id = p_item_id
    AND i.id = it.invite_id
    AND it.status = 'pending'
    AND i.status = 'pending'
  RETURNING i.client_id, i.organization_id;
$$;

COMMENT ON FUNCTION integrations.complete_invite_item IS
  'Única travessia de tenant do sistema para concluir o item. Só grava se ainda estava pending (fail-closed) — não há caminho para reaproveitar um item já concluído.';

REVOKE ALL ON FUNCTION integrations.complete_invite_item(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION integrations.complete_invite_item(uuid, uuid) TO tria_app;

COMMIT;
