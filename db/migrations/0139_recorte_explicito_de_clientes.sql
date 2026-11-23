BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE core.members
  ADD COLUMN escopo text NOT NULL DEFAULT 'organizacao'
  CONSTRAINT members_escopo_valido CHECK (escopo IN ('organizacao', 'clientes'));

UPDATE core.members m
   SET escopo = 'clientes'
 WHERE EXISTS (SELECT 1 FROM core.member_clients mc WHERE mc.member_id = m.id AND mc.revoked_at IS NULL)
    OR coalesce((
      SELECT e.restrito
        FROM (
          SELECT i.accepted_at AS quando,
                 cardinality(coalesce(i.client_ids, ARRAY[]::uuid[])) > 0 AS restrito
            FROM core.invitations i
           WHERE i.accepted_by = m.user_id
             AND i.organization_id = m.organization_id
             AND i.accepted_at IS NOT NULL
          UNION ALL
          SELECT l.occurred_at AS quando,
                 (l.metadata->>'organizacaoInteira') = 'false' AS restrito
            FROM audit.audit_log l
           WHERE l.action = 'team.scope_changed'
             AND l.organization_id = m.organization_id
             AND l.target_id = m.user_id::text
             AND (l.metadata->>'organizacaoInteira') IN ('true', 'false')
        ) e
       ORDER BY e.quando DESC, e.restrito DESC
       LIMIT 1
    ), false);

ALTER TABLE core.invitations
  ADD COLUMN escopo text NOT NULL DEFAULT 'organizacao'
  CONSTRAINT invitations_escopo_valido CHECK (escopo IN ('organizacao', 'clientes'));

UPDATE core.invitations
   SET escopo = 'clientes'
 WHERE cardinality(coalesce(client_ids, ARRAY[]::uuid[])) > 0;

CREATE OR REPLACE FUNCTION core.client_scope_of(p_user_id uuid, p_organization_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
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
$$;

CREATE OR REPLACE FUNCTION core.current_clients()
RETURNS uuid[]
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN current_setting('app.client_ids', true) = '*' THEN NULL
    WHEN coalesce(current_setting('app.client_ids', true), '') IN ('', 'nenhum') THEN ARRAY[]::uuid[]
    ELSE string_to_array(current_setting('app.client_ids', true), ',')::uuid[]
  END
$$;

CREATE OR REPLACE FUNCTION core.accept_invitation(p_invitation_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_org       uuid;
  v_role      core.member_role;
  v_clients   uuid[];
  v_escopo    text;
  v_modo      text;
  v_validos   uuid[];
  v_member_id uuid;
  v_email     text;
BEGIN
  IF NOT core.prova_do_usuario(p_user_id) THEN
    RETURN false;
  END IF;

  SELECT lower(u.email) INTO v_email FROM core.users u WHERE u.id = p_user_id;
  IF v_email IS NULL THEN
    RETURN false;
  END IF;

  SELECT organization_id, role, client_ids, escopo INTO v_org, v_role, v_clients, v_escopo
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

  v_modo := CASE
    WHEN v_escopo = 'clientes' OR cardinality(coalesce(v_clients, ARRAY[]::uuid[])) > 0 THEN 'clientes'
    ELSE 'organizacao'
  END;

  SELECT coalesce(array_agg(c.id), ARRAY[]::uuid[]) INTO v_validos
  FROM core.clients c
  WHERE c.id = ANY (coalesce(v_clients, ARRAY[]::uuid[]))
    AND c.organization_id = v_org
    AND c.excluido_em IS NULL;

  INSERT INTO core.members (organization_id, user_id, role, escopo)
  VALUES (v_org, p_user_id, v_role, v_modo)
  ON CONFLICT (organization_id, user_id)
  DO UPDATE SET role = EXCLUDED.role, escopo = EXCLUDED.escopo, revoked_at = NULL, revoked_by = NULL
  RETURNING id INTO v_member_id;

  UPDATE core.member_clients SET revoked_at = now()
  WHERE member_id = v_member_id
    AND revoked_at IS NULL
    AND NOT (client_id = ANY (v_validos));

  INSERT INTO core.member_clients (member_id, client_id)
  SELECT v_member_id, v_cliente FROM unnest(v_validos) AS v_cliente
  ON CONFLICT (member_id, client_id) DO UPDATE SET revoked_at = NULL;

  UPDATE core.invitations
  SET accepted_at = now(), accepted_by = p_user_id
  WHERE id = p_invitation_id;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION core.expurgar_cliente(p_cliente uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_organizacao uuid;
  v_nome text;
  v_nome_exclusivo boolean;
  v_contas uuid[];
  revisoes integer;
  metricas integer;
  execucoes integer;
  coletas integer;
  convites integer;
  acessos integer;
  contas integer;
  recursos integer;
  auditoria integer;
BEGIN
  SELECT organization_id, name INTO v_organizacao, v_nome FROM core.clients WHERE id = p_cliente;
  IF v_organizacao IS NULL THEN
    RAISE EXCEPTION 'cliente % não existe', p_cliente;
  END IF;
  IF EXISTS (SELECT 1 FROM core.clients WHERE parent_client_id = p_cliente) THEN
    RAISE EXCEPTION 'cliente % tem clientes vinculados; expurgue-os antes', p_cliente;
  END IF;

  v_nome_exclusivo := NOT EXISTS (
    SELECT 1 FROM core.clients WHERE organization_id = v_organizacao AND name = v_nome AND id != p_cliente
  );

  SELECT coalesce(array_agg(id), '{}') INTO v_contas FROM integrations.ad_accounts WHERE client_id = p_cliente;

  UPDATE audit.audit_log l
     SET metadata = (
       SELECT jsonb_object_agg(
                e.key,
                CASE WHEN e.key IN ('de', 'para', 'cliente', 'name') AND (
                       (e.value #>> '{}') = v_nome AND v_nome_exclusivo
                       OR l.metadata ->> (CASE e.key WHEN 'de' THEN 'deId' WHEN 'para' THEN 'paraId' ELSE 'clientId' END) = p_cliente::text
                       OR (e.key = 'name' AND l.target_type = 'client' AND l.target_id = p_cliente::text))
                     THEN to_jsonb('[cliente expurgado]'::text)
                     ELSE e.value END)
       FROM jsonb_each(l.metadata) e)
   WHERE l.organization_id = v_organizacao
     AND jsonb_typeof(l.metadata) = 'object'
     AND EXISTS (
       SELECT 1 FROM jsonb_each(l.metadata) e
       WHERE e.key IN ('de', 'para', 'cliente', 'name')
         AND (e.value #>> '{}') IS DISTINCT FROM '[cliente expurgado]'
         AND ((e.value #>> '{}') = v_nome AND v_nome_exclusivo
              OR l.metadata ->> (CASE e.key WHEN 'de' THEN 'deId' WHEN 'para' THEN 'paraId' ELSE 'clientId' END) = p_cliente::text
              OR (e.key = 'name' AND l.target_type = 'client' AND l.target_id = p_cliente::text)));
  GET DIAGNOSTICS auditoria = ROW_COUNT;

  UPDATE integrations.connection_accounts
     SET state = CASE WHEN state = 'linked' THEN 'discovered' ELSE state END,
         client_id = NULL,
         ad_account_id = NULL
   WHERE client_id = p_cliente OR ad_account_id = ANY (v_contas);
  GET DIAGNOSTICS recursos = ROW_COUNT;

  DELETE FROM metrics.metrics_restatements WHERE ad_account_id = ANY (v_contas);
  GET DIAGNOSTICS revisoes = ROW_COUNT;
  DELETE FROM metrics.metrics_daily WHERE ad_account_id = ANY (v_contas);
  GET DIAGNOSTICS metricas = ROW_COUNT;
  DELETE FROM automation.sync_runs WHERE ad_account_id = ANY (v_contas);
  GET DIAGNOSTICS execucoes = ROW_COUNT;
  DELETE FROM automation.coletas WHERE client_id = p_cliente OR ad_account_id = ANY (v_contas);
  GET DIAGNOSTICS coletas = ROW_COUNT;
  DELETE FROM integrations.connection_invites WHERE client_id = p_cliente;
  GET DIAGNOSTICS convites = ROW_COUNT;
  UPDATE core.members SET escopo = 'clientes'
   WHERE id IN (SELECT member_id FROM core.member_clients WHERE client_id = p_cliente AND revoked_at IS NULL);
  DELETE FROM core.member_clients WHERE client_id = p_cliente;
  GET DIAGNOSTICS acessos = ROW_COUNT;
  DELETE FROM integrations.ad_accounts WHERE client_id = p_cliente;
  GET DIAGNOSTICS contas = ROW_COUNT;
  DELETE FROM core.clients WHERE id = p_cliente;

  INSERT INTO audit.audit_log (organization_id, actor_type, action, target_type, target_id, metadata)
  VALUES (v_organizacao, 'system', 'client.purged', 'client', p_cliente::text,
          jsonb_build_object('contas', contas, 'metricas', metricas, 'recursosLiberados', recursos,
                             'auditoriaAnonimizada', auditoria));

  RETURN jsonb_build_object(
    'organizacao', v_organizacao,
    'revisoes', revisoes,
    'metricas', metricas,
    'execucoes', execucoes,
    'coletas', coletas,
    'convites', convites,
    'acessos', acessos,
    'contas', contas,
    'recursosLiberados', recursos,
    'auditoriaAnonimizada', auditoria
  );
END;
$$;

COMMENT ON COLUMN core.members.escopo IS
  'Modo do recorte de clientes (ADR 0044). organizacao: acesso a todos os clientes, valido so sem linha viva em member_clients. clientes: acesso so aos clientes vinculados; sem vinculo = acesso nenhum.';
COMMENT ON FUNCTION core.current_clients() IS
  'NULL (organizacao inteira) somente para app.client_ids = ''*''. Ausente, vazio ou ''nenhum'' = nenhum cliente (ADR 0044).';

CREATE FUNCTION core.vinculo_de_cliente_implica_recorte()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE core.members SET escopo = 'clientes' WHERE id = NEW.member_id AND escopo <> 'clientes';
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION core.vinculo_de_cliente_implica_recorte() FROM PUBLIC;

CREATE TRIGGER member_clients_implica_recorte_ins
  AFTER INSERT ON core.member_clients
  FOR EACH ROW EXECUTE FUNCTION core.vinculo_de_cliente_implica_recorte();

CREATE TRIGGER member_clients_implica_recorte_upd
  AFTER UPDATE OF revoked_at ON core.member_clients
  FOR EACH ROW WHEN (NEW.revoked_at IS NULL)
  EXECUTE FUNCTION core.vinculo_de_cliente_implica_recorte();

COMMENT ON FUNCTION core.vinculo_de_cliente_implica_recorte() IS
  'Inserir ou reativar vinculo em member_clients grava members.escopo = clientes (ADR 0044): esvaziar o recorte depois nunca devolve a organizacao inteira, nem por app antigo que nao grava o modo. O modo organizacao so entra por UPDATE explicito depois de revogar os vinculos.';

COMMIT;
