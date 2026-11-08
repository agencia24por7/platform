BEGIN;

CREATE TYPE core.member_role AS ENUM ('owner', 'admin', 'operator', 'viewer');

CREATE TABLE core.users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE CHECK (position('@' in email) > 1 AND length(email) <= 320),
  name          text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  picture_url   text CHECK (picture_url IS NULL OR picture_url ~ '^https://'),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

COMMENT ON TABLE core.users IS
  'Identidade mínima vinda do provedor. Nenhuma senha é armazenada: a autenticação é delegada.';

CREATE TABLE core.members (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES core.organizations(id) ON DELETE RESTRICT,
  user_id         uuid NOT NULL REFERENCES core.users(id) ON DELETE RESTRICT,
  role            core.member_role NOT NULL DEFAULT 'operator',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT members_unique_per_organization UNIQUE (organization_id, user_id)
);

CREATE INDEX members_by_user ON core.members (user_id);

CREATE TRIGGER users_touch BEFORE UPDATE ON core.users
  FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();

CREATE TRIGGER members_touch BEFORE UPDATE ON core.members
  FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();

GRANT SELECT, INSERT, UPDATE ON core.users, core.members TO tria_app;

ALTER TABLE core.users   ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.members ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.users   FORCE ROW LEVEL SECURITY;
ALTER TABLE core.members FORCE ROW LEVEL SECURITY;

CREATE POLICY users_self ON core.users FOR ALL TO tria_app
  USING (true)
  WITH CHECK (true);

CREATE POLICY members_tenant ON core.members FOR ALL TO tria_app
  USING (core.current_organization() IS NULL OR organization_id = core.current_organization())
  WITH CHECK (organization_id = core.current_organization());

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
  ORDER BY m.created_at
$$;

COMMENT ON FUNCTION core.memberships_of(uuid) IS
  'Resolve a quais organizações um usuário pertence antes de existir contexto de tenant. Devolve identificadores e papel, nunca segredo.';

REVOKE ALL ON FUNCTION core.memberships_of(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.memberships_of(uuid) TO tria_app;

COMMIT;
