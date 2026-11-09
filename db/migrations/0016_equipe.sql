BEGIN;

ALTER TABLE core.members ADD COLUMN revoked_at timestamptz;
ALTER TABLE core.members ADD COLUMN revoked_by uuid REFERENCES core.users(id) ON DELETE RESTRICT;

CREATE INDEX members_vivos ON core.members (organization_id) WHERE revoked_at IS NULL;

COMMENT ON COLUMN core.members.revoked_at IS
  'Um vínculo nunca é apagado: ele é revogado. Quem sai perde o acesso sem sumir da auditoria.';

CREATE OR REPLACE FUNCTION core.memberships_of(p_user_id uuid)
RETURNS TABLE (organization_id uuid, role core.member_role)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT m.organization_id, m.role
  FROM core.members m
  WHERE m.user_id = p_user_id
    AND m.revoked_at IS NULL
  ORDER BY m.created_at
$$;

CREATE TABLE core.invitations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES core.organizations(id) ON DELETE RESTRICT,
  email           text NOT NULL CHECK (position('@' in email) > 1 AND length(email) <= 320),
  role            core.member_role NOT NULL DEFAULT 'operator',
  invited_by      uuid REFERENCES core.users(id) ON DELETE RESTRICT,
  expires_at      timestamptz NOT NULL,
  accepted_at     timestamptz,
  accepted_by     uuid REFERENCES core.users(id) ON DELETE RESTRICT,
  revoked_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invitations_role_nao_dono CHECK (role <> 'owner')
);

COMMENT ON TABLE core.invitations IS
  'Convite por e-mail, sem segredo trafegando: quem entra com aquele e-mail no Google recebe o vínculo. Ninguém vira dono por convite.';

CREATE UNIQUE INDEX invitations_um_aberto_por_email
  ON core.invitations (organization_id, lower(email))
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE INDEX invitations_por_email ON core.invitations (lower(email))
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE TRIGGER invitations_touch BEFORE UPDATE ON core.invitations
  FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();

GRANT SELECT, INSERT, UPDATE ON core.invitations TO tria_app;

ALTER TABLE core.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.invitations FORCE ROW LEVEL SECURITY;

CREATE POLICY invitations_tenant ON core.invitations FOR ALL TO tria_app
  USING (core.current_organization() IS NULL OR organization_id = core.current_organization())
  WITH CHECK (organization_id = core.current_organization());

CREATE OR REPLACE FUNCTION core.pending_invitations_for(p_email text)
RETURNS TABLE (invitation_id uuid, organization_id uuid, role core.member_role)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT i.id, i.organization_id, i.role
  FROM core.invitations i
  WHERE lower(i.email) = lower(p_email)
    AND i.accepted_at IS NULL
    AND i.revoked_at IS NULL
    AND i.expires_at > now()
  ORDER BY i.created_at
$$;

COMMENT ON FUNCTION core.pending_invitations_for(text) IS
  'Resolve convites antes de existir contexto de tenant, porque quem chega ainda não pertence a nenhuma organização. Devolve identificadores, nunca segredo.';

CREATE OR REPLACE FUNCTION core.accept_invitation(p_invitation_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
VOLATILE
AS $$
DECLARE
  v_org  uuid;
  v_role core.member_role;
BEGIN
  SELECT organization_id, role INTO v_org, v_role
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
  DO UPDATE SET role = EXCLUDED.role, revoked_at = NULL, revoked_by = NULL;

  UPDATE core.invitations
  SET accepted_at = now(), accepted_by = p_user_id
  WHERE id = p_invitation_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION core.pending_invitations_for(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION core.accept_invitation(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.pending_invitations_for(text) TO tria_app;
GRANT EXECUTE ON FUNCTION core.accept_invitation(uuid, uuid) TO tria_app;

COMMIT;
