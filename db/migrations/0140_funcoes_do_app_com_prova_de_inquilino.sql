BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  PERFORM set_config(
    'prova.papel_app',
    (SELECT rolname FROM pg_roles WHERE rolname IN ('orla_app', 'tria_app') ORDER BY rolname = 'orla_app' DESC LIMIT 1),
    true
  );
  PERFORM set_config(
    'prova.papel_worker',
    (SELECT rolname FROM pg_roles WHERE rolname IN ('orla_worker', 'tria_worker') ORDER BY rolname = 'orla_worker' DESC LIMIT 1),
    true
  );
  IF current_setting('prova.papel_app') = '' OR current_setting('prova.papel_worker') = '' THEN
    RAISE EXCEPTION 'papeis do app e do worker ausentes; as migracoes 0070 e anteriores precisam ter rodado';
  END IF;
END $$;

DO $$
DECLARE
  alvo record;
  cruzadas bigint;
BEGIN
  FOR alvo IN
    SELECT * FROM (VALUES
      ('integrations', 'ad_accounts'),
      ('integrations', 'connection_accounts'),
      ('automation', 'account_tasks'),
      ('integrations', 'connection_invite_items'),
      ('privacidade', 'pedidos_de_exclusao_conexoes')
    ) AS t(esquema, tabela)
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %I.%I x JOIN integrations.connections c ON c.id = x.connection_id WHERE x.organization_id IS DISTINCT FROM c.organization_id',
      alvo.esquema, alvo.tabela)
      INTO cruzadas;
    IF cruzadas > 0 THEN
      RAISE EXCEPTION 'FK composta de conexao abortada: % linha(s) de %.% apontam para conexao de outra organizacao. Corrija o dado antes de aplicar a 0140.',
        cruzadas, alvo.esquema, alvo.tabela;
    END IF;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS connections_id_organizacao ON integrations.connections (id, organization_id);

ALTER TABLE integrations.ad_accounts DROP CONSTRAINT ad_accounts_connection_id_fkey;
ALTER TABLE integrations.ad_accounts
  ADD CONSTRAINT ad_accounts_conexao_organizacao_fkey
  FOREIGN KEY (connection_id, organization_id) REFERENCES integrations.connections (id, organization_id) ON DELETE RESTRICT;

ALTER TABLE integrations.connection_accounts DROP CONSTRAINT connection_accounts_connection_id_fkey;
ALTER TABLE integrations.connection_accounts
  ADD CONSTRAINT connection_accounts_conexao_organizacao_fkey
  FOREIGN KEY (connection_id, organization_id) REFERENCES integrations.connections (id, organization_id) ON DELETE CASCADE;

ALTER TABLE automation.account_tasks DROP CONSTRAINT account_tasks_connection_id_fkey;
ALTER TABLE automation.account_tasks
  ADD CONSTRAINT account_tasks_conexao_organizacao_fkey
  FOREIGN KEY (connection_id, organization_id) REFERENCES integrations.connections (id, organization_id) ON DELETE RESTRICT;

ALTER TABLE integrations.connection_invite_items DROP CONSTRAINT connection_invite_items_connection_id_fkey;
ALTER TABLE integrations.connection_invite_items
  ADD CONSTRAINT connection_invite_items_conexao_organizacao_fkey
  FOREIGN KEY (connection_id, organization_id) REFERENCES integrations.connections (id, organization_id) ON DELETE SET NULL (connection_id);

ALTER TABLE privacidade.pedidos_de_exclusao_conexoes DROP CONSTRAINT pedidos_de_exclusao_conexoes_connection_id_fkey;
ALTER TABLE privacidade.pedidos_de_exclusao_conexoes
  ADD CONSTRAINT pedidos_de_exclusao_conexoes_conexao_organizacao_fkey
  FOREIGN KEY (connection_id, organization_id) REFERENCES integrations.connections (id, organization_id) ON DELETE CASCADE;

DO $$
DECLARE
  cruzadas bigint;
BEGIN
  SELECT count(*) INTO cruzadas FROM automation.coletas c
    JOIN integrations.ad_accounts a ON a.id = c.ad_account_id
   WHERE a.organization_id IS DISTINCT FROM c.organization_id;
  IF cruzadas > 0 THEN
    RAISE EXCEPTION 'FK composta de coletas abortada: % coleta(s) apontam para conta de anuncios de outra organizacao.', cruzadas;
  END IF;
  SELECT count(*) INTO cruzadas FROM automation.coletas c
    JOIN integrations.connection_accounts a ON a.id = c.connection_account_id
   WHERE a.organization_id IS DISTINCT FROM c.organization_id;
  IF cruzadas > 0 THEN
    RAISE EXCEPTION 'FK composta de coletas abortada: % coleta(s) apontam para recurso de conexao de outra organizacao.', cruzadas;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ad_accounts_id_organizacao ON integrations.ad_accounts (id, organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS connection_accounts_id_organizacao ON integrations.connection_accounts (id, organization_id);

ALTER TABLE automation.coletas DROP CONSTRAINT coletas_ad_account_id_fkey;
ALTER TABLE automation.coletas
  ADD CONSTRAINT coletas_conta_organizacao_fkey
  FOREIGN KEY (ad_account_id, organization_id) REFERENCES integrations.ad_accounts (id, organization_id) ON DELETE RESTRICT;

ALTER TABLE automation.coletas DROP CONSTRAINT coletas_connection_account_id_fkey;
ALTER TABLE automation.coletas
  ADD CONSTRAINT coletas_recurso_organizacao_fkey
  FOREIGN KEY (connection_account_id, organization_id) REFERENCES integrations.connection_accounts (id, organization_id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION integrations.resolver_conexao_do_token(p_coleta_id uuid, p_tarefa_id uuid)
RETURNS TABLE (
  organization_id     uuid,
  connection_id       uuid,
  platform            text,
  connection_status   text,
  origem_em_execucao  boolean,
  fonte_ativa         boolean,
  tenant_ativo        boolean,
  tem_token           boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT c.organization_id, n.id, n.platform::text, n.status::text,
         c.status::text = 'running' AND c.started_at > now() - interval '6 hours',
         CASE c.fonte_tipo
           WHEN 'ad_account' THEN coalesce(a.status::text = 'linked' AND a.sync_enabled, false)
           ELSE coalesce(ca.state::text = 'linked' AND NOT ca.inactive AND ca.client_id IS NOT NULL, false)
         END,
         cl.id IS NOT NULL AND cl.excluido_em IS NULL AND cl.status::text = 'active' AND o.status::text = 'active',
         EXISTS (SELECT 1 FROM integrations.connection_tokens t WHERE t.connection_id = n.id)
  FROM automation.coletas c
  LEFT JOIN integrations.ad_accounts a ON c.fonte_tipo = 'ad_account' AND a.id = c.ad_account_id
  LEFT JOIN integrations.connection_accounts ca ON c.fonte_tipo = 'connection_account' AND ca.id = c.connection_account_id
  JOIN integrations.connections n ON n.id = coalesce(a.connection_id, ca.connection_id) AND n.organization_id = c.organization_id
  LEFT JOIN core.clients cl ON cl.id = c.client_id
  JOIN core.organizations o ON o.id = c.organization_id
  WHERE p_coleta_id IS NOT NULL AND p_tarefa_id IS NULL AND c.id = p_coleta_id

  UNION ALL

  SELECT t.organization_id, n.id, n.platform::text, n.status::text,
         t.status::text = 'running' AND t.updated_at > now() - interval '6 hours',
         true,
         o.status::text = 'active',
         EXISTS (SELECT 1 FROM integrations.connection_tokens k WHERE k.connection_id = n.id)
  FROM automation.account_tasks t
  JOIN integrations.connections n ON n.id = t.connection_id AND n.organization_id = t.organization_id
  JOIN core.organizations o ON o.id = t.organization_id
  WHERE p_tarefa_id IS NOT NULL AND p_coleta_id IS NULL AND t.id = p_tarefa_id;
$$;

ALTER TABLE core.organizations ADD COLUMN created_by uuid REFERENCES core.users (id) ON DELETE SET NULL;

UPDATE core.organizations o
   SET created_by = (
     SELECT m.user_id FROM core.members m
      WHERE m.organization_id = o.id
      ORDER BY (m.role = 'owner') DESC, m.created_at
      LIMIT 1)
 WHERE o.created_by IS NULL;

CREATE FUNCTION core.sessao_de_superusuario()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT coalesce((SELECT r.rolsuper FROM pg_catalog.pg_roles r WHERE r.rolname = session_user), false)
$$;

CREATE FUNCTION core.prova_do_usuario(p_usuario uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce(p_usuario IS NOT NULL AND p_usuario = core.current_user_id(), false)
$$;

CREATE FUNCTION core.sessao_do_worker()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles r
     WHERE r.rolname IN ('orla_worker', 'tria_worker')
       AND pg_has_role(session_user, r.oid, 'USAGE'))
$$;

REVOKE ALL ON FUNCTION core.sessao_de_superusuario() FROM PUBLIC;
REVOKE ALL ON FUNCTION core.prova_do_usuario(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION core.sessao_do_worker() FROM PUBLIC;
DO $$ BEGIN
  EXECUTE format('GRANT EXECUTE ON FUNCTION core.sessao_de_superusuario(), core.prova_do_usuario(uuid), core.sessao_do_worker() TO %I, %I',
    current_setting('prova.papel_app'), current_setting('prova.papel_worker'));
END $$;

CREATE FUNCTION core.organizations_created_by_imutavel()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.created_by IS NOT NULL
     AND NEW.created_by IS DISTINCT FROM OLD.created_by
     AND NOT core.sessao_de_superusuario() THEN
    RAISE EXCEPTION 'created_by da organizacao nao muda';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER organizations_created_by_imutavel
  BEFORE UPDATE ON core.organizations
  FOR EACH ROW EXECUTE FUNCTION core.organizations_created_by_imutavel();

CREATE OR REPLACE FUNCTION core.create_organization(
  p_name text, p_slug text, p_type core.organization_type,
  p_manager_account_id text, p_business_manager_id text, p_developer_token_ref text)
RETURNS TABLE (id uuid, name text, slug text, type core.organization_type, manager_account_id text,
               business_manager_id text, developer_token_ref text, created_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  INSERT INTO core.organizations (name, slug, type, manager_account_id, business_manager_id, developer_token_ref, created_by)
  VALUES (p_name, p_slug, p_type, p_manager_account_id, p_business_manager_id, p_developer_token_ref, core.current_user_id())
  RETURNING core.organizations.id, core.organizations.name, core.organizations.slug,
            core.organizations.type, core.organizations.manager_account_id,
            core.organizations.business_manager_id, core.organizations.developer_token_ref,
            core.organizations.created_at
$$;

CREATE OR REPLACE FUNCTION core.is_member(p_organization_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT core.prova_do_usuario(p_user_id) AND EXISTS (
    SELECT 1 FROM core.members m
    WHERE m.organization_id = p_organization_id
      AND m.user_id = p_user_id
      AND m.revoked_at IS NULL
  )
$$;

CREATE OR REPLACE FUNCTION core.client_scope_of(p_user_id uuid, p_organization_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    WHEN NOT core.prova_do_usuario(p_user_id) THEN ARRAY[]::uuid[]
    WHEN EXISTS (
      SELECT 1 FROM core.members m
       WHERE m.user_id = p_user_id
         AND m.organization_id = p_organization_id
         AND m.revoked_at IS NULL) THEN (
      SELECT CASE WHEN x.escopo = 'organizacao' AND x.vinculos = 0 THEN NULL ELSE x.lista END
      FROM (
        SELECT m.escopo,
               count(mc.client_id) AS vinculos,
               coalesce(array_agg(mc.client_id ORDER BY mc.client_id) FILTER (WHERE mc.client_id IS NOT NULL), ARRAY[]::uuid[]) AS lista
        FROM core.members m
        LEFT JOIN core.member_clients mc ON mc.member_id = m.id AND mc.revoked_at IS NULL
        WHERE m.user_id = p_user_id
          AND m.organization_id = p_organization_id
          AND m.revoked_at IS NULL
        GROUP BY m.id, m.escopo
      ) x
    )
    WHEN NOT EXISTS (SELECT 1 FROM core.members m WHERE m.organization_id = p_organization_id)
     AND EXISTS (
       SELECT 1 FROM core.organizations o
        WHERE o.id = p_organization_id
          AND o.created_by = p_user_id
          AND o.created_at > now() - interval '15 minutes') THEN NULL::uuid[]
    ELSE ARRAY[]::uuid[]
  END
$$;

CREATE OR REPLACE FUNCTION core.sessao_alcanca_organizacao(p_organization_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT core.is_member(p_organization_id, p_user_id)
      OR (
        core.prova_do_usuario(p_user_id)
        AND NOT EXISTS (SELECT 1 FROM core.members m WHERE m.organization_id = p_organization_id)
        AND EXISTS (
          SELECT 1 FROM core.organizations o
           WHERE o.id = p_organization_id
             AND o.created_by = p_user_id
             AND o.created_at > now() - interval '15 minutes')
      );
$$;

CREATE OR REPLACE FUNCTION core.memberships_of(p_user_id uuid)
RETURNS TABLE (organization_id uuid, role core.member_role)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT m.organization_id, m.role
  FROM core.members m
  WHERE m.user_id = p_user_id
    AND core.prova_do_usuario(p_user_id)
    AND m.revoked_at IS NULL
  ORDER BY m.created_at
$$;

CREATE OR REPLACE FUNCTION core.organizations_of(p_user_id uuid)
RETURNS TABLE (id uuid, name text, slug text, type core.organization_type, manager_account_id text,
               business_manager_id text, developer_token_ref text, created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT o.id, o.name, o.slug, o.type, o.manager_account_id, o.business_manager_id,
         o.developer_token_ref, o.created_at
  FROM core.organizations o
  JOIN core.members m ON m.organization_id = o.id
  WHERE m.user_id = p_user_id
    AND core.prova_do_usuario(p_user_id)
    AND m.revoked_at IS NULL
  ORDER BY o.name
$$;

CREATE OR REPLACE FUNCTION core.shares_organization(p_user_id uuid, p_other_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT p_user_id IS NOT NULL AND core.prova_do_usuario(p_user_id) AND EXISTS (
    SELECT 1
    FROM core.members meu
    JOIN core.members dele ON dele.organization_id = meu.organization_id
    WHERE meu.user_id = p_user_id AND meu.revoked_at IS NULL
      AND dele.user_id = p_other_id AND dele.revoked_at IS NULL
  )
$$;

CREATE OR REPLACE FUNCTION core.pending_invitations_for(p_email text)
RETURNS TABLE (invitation_id uuid, organization_id uuid, role core.member_role)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT i.id, i.organization_id, i.role
  FROM core.invitations i
  WHERE lower(i.email) = lower(p_email)
    AND lower(p_email) = (SELECT lower(u.email) FROM core.users u WHERE u.id = core.current_user_id())
    AND i.accepted_at IS NULL
    AND i.revoked_at IS NULL
    AND i.expires_at > now()
  ORDER BY i.created_at
$$;

CREATE OR REPLACE FUNCTION core.encerrar_sessoes(p_usuario uuid, p_em timestamptz)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  UPDATE core.users
     SET sessoes_validas_desde = greatest(coalesce(sessoes_validas_desde, least(coalesce(p_em, now()), now())), least(coalesce(p_em, now()), now()))
   WHERE id = p_usuario
     AND core.prova_do_usuario(p_usuario);
$$;

DROP FUNCTION integrations.resolve_webhook_connection(text, integrations.platform);
CREATE FUNCTION integrations.resolve_webhook_connection(p_token text, p_platform integrations.platform)
RETURNS TABLE (connection_id uuid, status integrations.connection_status, organization_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT id, status, organization_id
  FROM integrations.connections
  WHERE webhook_token = p_token AND platform = p_platform;
$$;
REVOKE ALL ON FUNCTION integrations.resolve_webhook_connection(text, integrations.platform) FROM PUBLIC;
DO $$ BEGIN
  EXECUTE format('GRANT EXECUTE ON FUNCTION integrations.resolve_webhook_connection(text, integrations.platform) TO %I',
    current_setting('prova.papel_app'));
END $$;

CREATE OR REPLACE FUNCTION integrations.record_whatsapp_inbound(
  p_connection_id uuid, p_source text, p_external_ref text, p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_connection_id IS NULL THEN
    IF core.current_organization() IS NOT NULL OR core.current_user_id() IS NOT NULL THEN
      RAISE EXCEPTION 'evento do WhatsApp sem conexao so vale sem organizacao e sem usuario no contexto';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1 FROM integrations.connections c
     WHERE c.id = p_connection_id AND c.organization_id = core.current_organization()) THEN
    RAISE EXCEPTION 'conexao % nao pertence a organizacao do contexto', p_connection_id;
  END IF;

  INSERT INTO integrations.whatsapp_inbound_events (connection_id, source, external_ref, payload)
  VALUES (p_connection_id, p_source, p_external_ref, p_payload)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION integrations.invite_item_still_pending(p_item_id uuid)
RETURNS TABLE (organization_id uuid, client_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT i.organization_id, i.client_id
  FROM integrations.connection_invite_items it
  JOIN integrations.connection_invites i ON i.id = it.invite_id
  WHERE it.id = p_item_id
    AND i.organization_id = core.current_organization()
    AND it.status = 'pending'
    AND i.status = 'pending'
    AND i.expires_at > now();
$$;

CREATE OR REPLACE FUNCTION integrations.complete_invite_item(p_item_id uuid, p_connection_id uuid)
RETURNS TABLE (client_id uuid, organization_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  UPDATE integrations.connection_invite_items it
  SET status = 'completed', connection_id = p_connection_id, completed_at = now()
  FROM integrations.connection_invites i
  WHERE it.id = p_item_id
    AND i.id = it.invite_id
    AND i.organization_id = core.current_organization()
    AND EXISTS (
      SELECT 1 FROM integrations.connections c
       WHERE c.id = p_connection_id AND c.organization_id = i.organization_id)
    AND it.status = 'pending'
    AND i.status = 'pending'
  RETURNING i.client_id, i.organization_id;
$$;

CREATE OR REPLACE FUNCTION integrations.resolve_invite_for_display(p_token text)
RETURNS TABLE (invite_id uuid, status integrations.invite_status, expires_at timestamptz, organization_name text, items jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
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
    AND i.status = 'pending'
    AND i.expires_at > now()
  GROUP BY i.id, i.status, i.expires_at, o.name;
$$;

CREATE OR REPLACE FUNCTION privacidade.registrar_resultado_do_expurgo(p_id uuid, p_erro text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  UPDATE privacidade.expurgos_de_fonte
     SET concluido_em = CASE WHEN p_erro IS NULL THEN now() END,
         tentativas = tentativas + 1,
         ultimo_erro = left(p_erro, 500)
   WHERE id = p_id AND concluido_em IS NULL AND cancelado_em IS NULL
     AND (organization_id = core.current_organization() OR core.sessao_do_worker());
$$;

CREATE OR REPLACE FUNCTION privacidade.registrar_pedido_de_exclusao_meta(
  p_usuario_hash text, p_hashes_anteriores text[], p_usuario_externo text, p_codigo text)
RETURNS TABLE (codigo text, situacao text, novo boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_anteriores text[] := coalesce(p_hashes_anteriores, '{}');
BEGIN
  IF core.current_organization() IS NOT NULL OR core.current_user_id() IS NOT NULL THEN
    RAISE EXCEPTION 'pedido de exclusao da Meta so vale em entrada publica, sem organizacao nem usuario no contexto';
  END IF;
  IF p_usuario_hash IS NULL OR p_usuario_hash !~ '^[0-9a-f]{64}$'
     OR EXISTS (SELECT 1 FROM unnest(v_anteriores) h WHERE h IS NULL OR h !~ '^[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'pseudônimo inválido';
  END IF;

  UPDATE privacidade.pedidos_de_exclusao p
     SET usuario_externo_hash = p_usuario_hash, atualizado_em = now()
   WHERE p.origem = 'meta' AND p.usuario_externo_hash = ANY (v_anteriores)
     AND p.usuario_externo_hash <> p_usuario_hash
     AND NOT EXISTS (
       SELECT 1 FROM privacidade.pedidos_de_exclusao q
        WHERE q.origem = 'meta' AND q.usuario_externo_hash = p_usuario_hash AND q.status <> 'concluido'
          AND p.status <> 'concluido');

  RETURN QUERY SELECT * FROM privacidade.registrar_pedido_de_exclusao_meta(p_usuario_hash, p_usuario_externo, p_codigo);
END;
$$;

CREATE OR REPLACE FUNCTION privacidade.registrar_pedido_de_exclusao_meta(p_usuario_hash text, p_usuario_externo text, p_codigo text)
RETURNS TABLE (codigo text, situacao text, novo boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id uuid;
  v_codigo text;
  v_situacao text;
  v_novo boolean := false;
BEGIN
  IF core.current_organization() IS NOT NULL OR core.current_user_id() IS NOT NULL THEN
    RAISE EXCEPTION 'pedido de exclusao da Meta so vale em entrada publica, sem organizacao nem usuario no contexto';
  END IF;
  IF p_usuario_externo IS NULL OR p_usuario_externo !~ '^[0-9]{1,32}$' THEN
    RAISE EXCEPTION 'usuário da Meta inválido';
  END IF;

  SELECT p.id, p.codigo_de_confirmacao, p.status INTO v_id, v_codigo, v_situacao
    FROM privacidade.pedidos_de_exclusao p
   WHERE p.origem = 'meta' AND p.usuario_externo_hash = p_usuario_hash AND p.status <> 'concluido'
   FOR UPDATE;

  IF v_id IS NULL THEN
    INSERT INTO privacidade.pedidos_de_exclusao AS p (origem, codigo_de_confirmacao, usuario_externo_hash)
    VALUES ('meta', p_codigo, p_usuario_hash)
    ON CONFLICT (origem, usuario_externo_hash) WHERE status <> 'concluido' DO NOTHING
    RETURNING p.id, p.codigo_de_confirmacao, p.status INTO v_id, v_codigo, v_situacao;

    IF v_id IS NULL THEN
      SELECT p.id, p.codigo_de_confirmacao, p.status INTO v_id, v_codigo, v_situacao
        FROM privacidade.pedidos_de_exclusao p
       WHERE p.origem = 'meta' AND p.usuario_externo_hash = p_usuario_hash AND p.status <> 'concluido';
    ELSE
      v_novo := true;
    END IF;
  END IF;

  INSERT INTO privacidade.pedidos_de_exclusao_conexoes (pedido_id, organization_id, connection_id)
  SELECT v_id, c.organization_id, c.id
    FROM integrations.connections c
   WHERE c.external_id = p_usuario_externo
     AND integrations.familia_do_provedor(c.platform::text) = 'meta'
     AND c.status <> 'revoked'
  ON CONFLICT DO NOTHING;

  IF v_novo THEN
    INSERT INTO audit.audit_log (organization_id, actor_type, action, target_type, target_id, metadata)
    SELECT l.organization_id, 'system', 'privacidade.pedido_de_exclusao_recebido', 'connection', l.connection_id::text,
           jsonb_build_object('origem', 'meta', 'codigo', v_codigo)
      FROM privacidade.pedidos_de_exclusao_conexoes l
     WHERE l.pedido_id = v_id;
  END IF;

  RETURN QUERY SELECT v_codigo, v_situacao, v_novo;
END;
$$;

DO $$ BEGIN
  EXECUTE format('REVOKE UPDATE ON core.organizations FROM %I', current_setting('prova.papel_app'));
  EXECUTE format('GRANT UPDATE (type, manager_account_id, business_manager_id, updated_at) ON core.organizations TO %I', current_setting('prova.papel_app'));
END $$;

DO $$ BEGIN
  EXECUTE format('REVOKE UPDATE ON core.users FROM %I', current_setting('prova.papel_app'));
  EXECUTE format('GRANT UPDATE (name, picture_url, last_login_at, updated_at) ON core.users TO %I', current_setting('prova.papel_app'));
END $$;

DO $$ BEGIN
  EXECUTE format('REVOKE SELECT ON SEQUENCE audit.audit_log_id_seq FROM %I', current_setting('prova.papel_app'));
  EXECUTE format('REVOKE SELECT ON SEQUENCE metrics.metrics_restatements_id_seq FROM %I', current_setting('prova.papel_app'));
END $$;

DROP POLICY audit_insert ON audit.audit_log;
DO $$ BEGIN
  EXECUTE format(
    'CREATE POLICY audit_insert ON audit.audit_log FOR INSERT TO %I
       WITH CHECK (
         (organization_id IS NOT NULL AND organization_id = core.current_organization())
         OR (organization_id IS NULL AND actor_type = ''user'' AND actor_id IS NOT NULL
             AND actor_id = core.current_user_id()::text))',
    current_setting('prova.papel_app'));
  EXECUTE format(
    'CREATE POLICY audit_insert_worker ON audit.audit_log FOR INSERT TO %I
       WITH CHECK (organization_id IS NULL OR organization_id = core.current_organization())',
    current_setting('prova.papel_worker'));
END $$;

DROP POLICY alertas_app ON automation.alertas;
DO $$ BEGIN
  EXECUTE format('REVOKE SELECT ON automation.alertas FROM %I', current_setting('prova.papel_app'));
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON automation.alertas TO %I', current_setting('prova.papel_worker'));
  EXECUTE format('CREATE POLICY alertas_worker ON automation.alertas FOR ALL TO %I USING (true) WITH CHECK (true)',
    current_setting('prova.papel_worker'));
END $$;

COMMENT ON FUNCTION integrations.record_whatsapp_inbound(uuid, text, text, jsonb) IS
  'Prova de inquilino: com conexao, exige que ela seja da organizacao do contexto (current_organization); sem conexao (Cloud API, ja validada por assinatura no app) so vale sem organizacao e sem usuario no contexto.';
COMMENT ON FUNCTION integrations.complete_invite_item(uuid, uuid) IS
  'Prova de inquilino: o convite do item e a conexao precisam ser da organizacao do contexto (ADR 0045).';
COMMENT ON FUNCTION integrations.invite_item_still_pending(uuid) IS
  'Prova de inquilino: o convite do item precisa ser da organizacao do contexto (ADR 0045).';
COMMENT ON FUNCTION privacidade.registrar_resultado_do_expurgo(uuid, text) IS
  'Prova de inquilino: o expurgo precisa ser da organizacao do contexto, ou a sessao ser do worker (ADR 0045).';
COMMENT ON FUNCTION core.encerrar_sessoes(uuid, timestamptz) IS
  'Prova de usuario: so encerra as sessoes do usuario do contexto (current_user_id); o instante nunca passa de agora (ADR 0045).';

COMMIT;
