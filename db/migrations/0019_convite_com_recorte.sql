BEGIN;

ALTER TABLE core.invitations ADD COLUMN client_ids uuid[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN core.invitations.client_ids IS
  'Recorte ja decidido no convite. Sem isso existiria uma janela entre aceitar e restringir em que a pessoa enxergaria a organizacao inteira.';

CREATE OR REPLACE FUNCTION core.accept_invitation(p_invitation_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
VOLATILE
AS $$
DECLARE
  v_org       uuid;
  v_role      core.member_role;
  v_clients   uuid[];
  v_member_id uuid;
BEGIN
  SELECT organization_id, role, client_ids INTO v_org, v_role, v_clients
  FROM core.invitations
  WHERE id = p_invitation_id
    AND accepted_at IS NULL
    AND revoked_at IS NULL
    AND expires_at > now()
  FOR UPDATE;

  IF v_org IS NULL THEN
    RETURN false;
  END IF;

  INSERT INTO core.members (organization_id, user_id, role)
  VALUES (v_org, p_user_id, v_role)
  ON CONFLICT (organization_id, user_id)
  DO UPDATE SET role = EXCLUDED.role, revoked_at = NULL, revoked_by = NULL
  RETURNING id INTO v_member_id;

  UPDATE core.member_clients SET revoked_at = now()
  WHERE member_id = v_member_id
    AND revoked_at IS NULL
    AND NOT (client_id = ANY (coalesce(v_clients, ARRAY[]::uuid[])));

  INSERT INTO core.member_clients (member_id, client_id)
  SELECT v_member_id, c.id
  FROM core.clients c
  WHERE c.id = ANY (coalesce(v_clients, ARRAY[]::uuid[]))
    AND c.organization_id = v_org
  ON CONFLICT (member_id, client_id) DO UPDATE SET revoked_at = NULL;

  UPDATE core.invitations
  SET accepted_at = now(), accepted_by = p_user_id
  WHERE id = p_invitation_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION core.accept_invitation(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.accept_invitation(uuid, uuid) TO tria_app;

COMMIT;
