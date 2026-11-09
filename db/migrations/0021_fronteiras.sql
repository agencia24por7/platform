BEGIN;

CREATE OR REPLACE FUNCTION core.current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;

COMMENT ON FUNCTION core.current_user_id() IS
  'Quem esta pedindo, resolvido do cookie assinado antes da transacao abrir. Sem isso a politica so sabe de qual organizacao se trata, nunca de quem.';

CREATE OR REPLACE FUNCTION core.is_member(p_organization_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT p_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM core.members m
    WHERE m.organization_id = p_organization_id
      AND m.user_id = p_user_id
      AND m.revoked_at IS NULL
  )
$$;

COMMENT ON FUNCTION core.is_member(uuid, uuid) IS
  'Pertencer e um fato da organizacao, nao do recorte. Perguntar isso lendo core.members dentro de uma politica faria a resposta depender da propria RLS que esconde a equipe de quem entra recortado.';

CREATE OR REPLACE FUNCTION core.shares_organization(p_user_id uuid, p_other_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT p_user_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM core.members meu
    JOIN core.members dele ON dele.organization_id = meu.organization_id
    WHERE meu.user_id = p_user_id AND meu.revoked_at IS NULL
      AND dele.user_id = p_other_id AND dele.revoked_at IS NULL
  )
$$;

CREATE OR REPLACE FUNCTION core.upsert_identity(p_email text, p_name text, p_picture_url text)
RETURNS TABLE (
  id uuid, email text, name text, picture_url text,
  created_at timestamptz, last_login_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
VOLATILE
AS $$
  INSERT INTO core.users (email, name, picture_url, last_login_at)
  VALUES (lower(btrim(p_email)), p_name, p_picture_url, now())
  ON CONFLICT (email) DO UPDATE
    SET name = EXCLUDED.name,
        picture_url = EXCLUDED.picture_url,
        last_login_at = now()
  RETURNING core.users.id, core.users.email, core.users.name, core.users.picture_url,
            core.users.created_at, core.users.last_login_at
$$;

COMMENT ON FUNCTION core.upsert_identity(text, text, text) IS
  'A identidade e gravada antes de existir sessao: quem esta entrando ainda nao e ninguem para a politica. Por isso o login escreve por aqui, e a tabela deixa de aceitar escrita direta do app.';

DROP POLICY IF EXISTS users_self ON core.users;

DROP POLICY IF EXISTS users_visiveis ON core.users;
DROP POLICY IF EXISTS users_proprio ON core.users;

CREATE POLICY users_visiveis ON core.users FOR SELECT TO tria_app
  USING (
    id = core.current_user_id()
    OR (
      core.current_clients() IS NULL
      AND core.shares_organization(core.current_user_id(), id)
    )
  );

CREATE POLICY users_proprio ON core.users FOR UPDATE TO tria_app
  USING (id = core.current_user_id())
  WITH CHECK (id = core.current_user_id());

COMMENT ON POLICY users_visiveis ON core.users IS
  'A tabela de identidade e da plataforma inteira. Cada sessao enxerga a si mesma e quem divide a organizacao com ela, nunca o cadastro de outro inquilino.';

REVOKE INSERT ON core.users FROM tria_app;

CREATE OR REPLACE FUNCTION core.organizations_of(p_user_id uuid)
RETURNS TABLE (
  id uuid, name text, slug text, type core.organization_type,
  manager_account_id text, business_manager_id text, developer_token_ref text,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT o.id, o.name, o.slug, o.type, o.manager_account_id, o.business_manager_id,
         o.developer_token_ref, o.created_at
  FROM core.organizations o
  JOIN core.members m ON m.organization_id = o.id
  WHERE m.user_id = p_user_id AND m.revoked_at IS NULL
  ORDER BY o.name
$$;

COMMENT ON FUNCTION core.organizations_of(uuid) IS
  'As organizacoes de uma pessoa, resolvidas antes de existir contexto de inquilino. E o que alimenta a troca de organizacao, sem que o app precise saber pedir por identificador.';

CREATE OR REPLACE FUNCTION core.slug_taken(p_slug text) RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT EXISTS (SELECT 1 FROM core.organizations WHERE slug = p_slug)
$$;

CREATE OR REPLACE FUNCTION core.any_organization_exists() RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT EXISTS (SELECT 1 FROM core.organizations)
$$;

COMMENT ON FUNCTION core.any_organization_exists() IS
  'Responde um bit para a tela de primeiro acesso. Antes a pergunta era respondida listando todas as organizacoes para qualquer visitante.';

CREATE OR REPLACE FUNCTION core.create_organization(
  p_name text, p_slug text, p_type core.organization_type,
  p_manager_account_id text, p_business_manager_id text, p_developer_token_ref text
)
RETURNS TABLE (
  id uuid, name text, slug text, type core.organization_type,
  manager_account_id text, business_manager_id text, developer_token_ref text,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
VOLATILE
AS $$
  INSERT INTO core.organizations (name, slug, type, manager_account_id, business_manager_id, developer_token_ref)
  VALUES (p_name, p_slug, p_type, p_manager_account_id, p_business_manager_id, p_developer_token_ref)
  RETURNING core.organizations.id, core.organizations.name, core.organizations.slug,
            core.organizations.type, core.organizations.manager_account_id,
            core.organizations.business_manager_id, core.organizations.developer_token_ref,
            core.organizations.created_at
$$;

REVOKE INSERT ON core.organizations FROM tria_app;
DROP POLICY IF EXISTS organizations_write ON core.organizations;
DROP POLICY IF EXISTS organizations_read ON core.organizations;

CREATE POLICY organizations_read ON core.organizations FOR SELECT TO tria_app
  USING (
    id = core.current_organization()
    AND (core.current_user_id() IS NULL OR core.is_member(id, core.current_user_id()))
  );

COMMENT ON POLICY organizations_read ON core.organizations IS
  'A organizacao do contexto, e so para quem tem vinculo vivo nela. Antes bastava nomear o identificador; e o worker, que nao tem sessao, segue lendo pelo contexto.';

DROP POLICY IF EXISTS members_tenant ON core.members;
CREATE POLICY members_tenant ON core.members FOR ALL TO tria_app
  USING (organization_id = core.current_organization() AND core.current_clients() IS NULL)
  WITH CHECK (organization_id = core.current_organization() AND core.current_clients() IS NULL);

DROP POLICY IF EXISTS invitations_tenant ON core.invitations;
CREATE POLICY invitations_tenant ON core.invitations FOR ALL TO tria_app
  USING (organization_id = core.current_organization() AND core.current_clients() IS NULL)
  WITH CHECK (organization_id = core.current_organization() AND core.current_clients() IS NULL);

DROP POLICY IF EXISTS audit_insert ON audit.audit_log;
CREATE POLICY audit_insert ON audit.audit_log FOR INSERT TO tria_app
  WITH CHECK (organization_id IS NULL OR organization_id = core.current_organization());

COMMENT ON POLICY audit_insert ON audit.audit_log IS
  'A trilha so aceita evento da organizacao do contexto. Antes qualquer sessao podia escrever no passado de outro inquilino.';

DROP POLICY IF EXISTS handoff_consumed_app ON core.handoff_consumed;

DROP POLICY IF EXISTS handoff_consumed_registra ON core.handoff_consumed;
DROP POLICY IF EXISTS handoff_consumed_le ON core.handoff_consumed;
DROP POLICY IF EXISTS handoff_consumed_limpa ON core.handoff_consumed;

CREATE POLICY handoff_consumed_registra ON core.handoff_consumed FOR INSERT TO tria_app
  WITH CHECK (true);

CREATE POLICY handoff_consumed_le ON core.handoff_consumed FOR SELECT TO tria_app
  USING (true);

CREATE POLICY handoff_consumed_limpa ON core.handoff_consumed FOR DELETE TO tria_app
  USING (expires_at < now());

COMMENT ON POLICY handoff_consumed_limpa ON core.handoff_consumed IS
  'So a faxina de passagens vencidas. Apagar uma passagem ainda viva devolveria a ela o direito de ser usada de novo.';

ALTER TABLE core.member_clients ADD COLUMN IF NOT EXISTS revoked_by uuid REFERENCES core.users(id) ON DELETE RESTRICT;
ALTER TABLE core.invitations ADD COLUMN IF NOT EXISTS revoked_by uuid REFERENCES core.users(id) ON DELETE RESTRICT;

COMMENT ON COLUMN core.member_clients.revoked_by IS
  'Quem tirou o cliente do recorte, pela mesma razao que core.members guarda revoked_by.';
COMMENT ON COLUMN core.invitations.revoked_by IS
  'Quem cancelou o convite.';

REVOKE ALL ON FUNCTION core.is_member(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION core.shares_organization(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION core.upsert_identity(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION core.organizations_of(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION core.slug_taken(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION core.any_organization_exists() FROM PUBLIC;
REVOKE ALL ON FUNCTION core.create_organization(text, text, core.organization_type, text, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION core.is_member(uuid, uuid) TO tria_app;
GRANT EXECUTE ON FUNCTION core.shares_organization(uuid, uuid) TO tria_app;
GRANT EXECUTE ON FUNCTION core.upsert_identity(text, text, text) TO tria_app;
GRANT EXECUTE ON FUNCTION core.organizations_of(uuid) TO tria_app;
GRANT EXECUTE ON FUNCTION core.slug_taken(text) TO tria_app;
GRANT EXECUTE ON FUNCTION core.any_organization_exists() TO tria_app;
GRANT EXECUTE ON FUNCTION core.create_organization(text, text, core.organization_type, text, text, text) TO tria_app;

COMMIT;
