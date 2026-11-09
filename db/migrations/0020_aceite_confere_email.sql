BEGIN;

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
  v_email     text;
BEGIN
  SELECT lower(u.email) INTO v_email FROM core.users u WHERE u.id = p_user_id;
  IF v_email IS NULL THEN
    RETURN false;
  END IF;

  SELECT organization_id, role, client_ids INTO v_org, v_role, v_clients
  FROM core.invitations
  WHERE id = p_invitation_id
    AND lower(email) = v_email
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

COMMENT ON FUNCTION core.accept_invitation(uuid, uuid) IS
  'O aceite so vale quando o e-mail do convite e o e-mail verificado de quem entra sao o mesmo. Conhecer o identificador do convite nao basta.';

REVOKE ALL ON FUNCTION core.accept_invitation(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.accept_invitation(uuid, uuid) TO tria_app;

COMMIT;
