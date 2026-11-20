BEGIN;

DO $$
BEGIN
  PERFORM set_config(
    'lgpd.papel_app',
    (SELECT rolname FROM pg_roles WHERE rolname IN ('orla_app', 'tria_app') ORDER BY rolname = 'orla_app' DESC LIMIT 1),
    true
  );
END $$;

CREATE OR REPLACE FUNCTION core.aplicar_retencao()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
VOLATILE
AS $$
DECLARE
  ips_apagados integer;
  auditoria_apagada integer;
  acessos_sem_organizacao integer;
  convites_anonimizados integer;
  usuarios_apagados integer;
  whatsapp_apagados integer;
BEGIN
  UPDATE audit.audit_log SET source_ip = NULL
   WHERE source_ip IS NOT NULL AND occurred_at < now() - interval '6 months';
  GET DIAGNOSTICS ips_apagados = ROW_COUNT;

  DELETE FROM audit.audit_log WHERE occurred_at < now() - interval '2 years';
  GET DIAGNOSTICS auditoria_apagada = ROW_COUNT;

  DELETE FROM audit.audit_log
   WHERE organization_id IS NULL AND actor_type = 'user' AND occurred_at < now() - interval '30 days';
  GET DIAGNOSTICS acessos_sem_organizacao = ROW_COUNT;

  UPDATE core.invitations SET email = 'removido+' || id || '@invalid'
   WHERE accepted_at IS NULL
     AND email NOT LIKE 'removido+%'
     AND coalesce(revoked_at, expires_at) < now() - interval '90 days';
  GET DIAGNOSTICS convites_anonimizados = ROW_COUNT;

  DELETE FROM core.users u
   WHERE coalesce(u.last_login_at, u.created_at) < now() - interval '30 days'
     AND NOT EXISTS (SELECT 1 FROM core.members m WHERE m.user_id = u.id OR m.revoked_by = u.id)
     AND NOT EXISTS (SELECT 1 FROM core.member_clients mc WHERE mc.revoked_by = u.id)
     AND NOT EXISTS (SELECT 1 FROM automation.account_tasks t WHERE t.requested_by = u.id)
     AND NOT EXISTS (SELECT 1 FROM integrations.connection_invites ci WHERE ci.created_by = u.id)
     AND NOT EXISTS (
       SELECT 1 FROM core.invitations i
        WHERE i.invited_by = u.id OR i.accepted_by = u.id OR i.revoked_by = u.id
           OR (lower(i.email) = lower(u.email) AND i.accepted_at IS NULL AND i.revoked_at IS NULL
               AND i.expires_at > now())
     );
  GET DIAGNOSTICS usuarios_apagados = ROW_COUNT;

  DELETE FROM integrations.whatsapp_inbound_events WHERE received_at < now() - interval '90 days';
  GET DIAGNOSTICS whatsapp_apagados = ROW_COUNT;

  RETURN jsonb_build_object(
    'ipsApagados', ips_apagados,
    'auditoriaApagada', auditoria_apagada,
    'acessosSemOrganizacao', acessos_sem_organizacao,
    'convitesAnonimizados', convites_anonimizados,
    'usuariosApagados', usuarios_apagados,
    'whatsappApagados', whatsapp_apagados
  );
END;
$$;

COMMENT ON FUNCTION core.aplicar_retencao IS
  'Aplica os prazos de retenção da política de privacidade (docs/lgpd/retencao.md). Chamada diariamente pelo n8n via /api/v0/manutencao/retencao.';

REVOKE ALL ON FUNCTION core.aplicar_retencao() FROM PUBLIC;
DO $$ BEGIN
  EXECUTE format('GRANT EXECUTE ON FUNCTION core.aplicar_retencao() TO %I', current_setting('lgpd.papel_app'));
END $$;

CREATE OR REPLACE FUNCTION core.anonimizar_titular(p_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
VOLATILE
AS $$
DECLARE
  v_usuario uuid;
  vinculos_revogados integer := 0;
  eventos_do_usuario integer := 0;
  convites integer;
  conexoes integer;
  eventos_com_email integer;
BEGIN
  IF p_email IS NULL OR position('@' IN p_email) < 2 THEN
    RAISE EXCEPTION 'e-mail inválido';
  END IF;

  SELECT id INTO v_usuario FROM core.users WHERE lower(email) = lower(p_email);

  IF v_usuario IS NOT NULL THEN
    UPDATE core.members SET revoked_at = now()
     WHERE user_id = v_usuario AND revoked_at IS NULL;
    GET DIAGNOSTICS vinculos_revogados = ROW_COUNT;

    UPDATE core.users
       SET email = 'removido+' || id || '@invalid', name = 'Titular removido', picture_url = NULL
     WHERE id = v_usuario;

    UPDATE audit.audit_log SET metadata = metadata - 'email', source_ip = NULL
     WHERE actor_id = v_usuario::text OR target_id = v_usuario::text;
    GET DIAGNOSTICS eventos_do_usuario = ROW_COUNT;
  END IF;

  UPDATE core.invitations SET email = 'removido+' || id || '@invalid' WHERE lower(email) = lower(p_email);
  GET DIAGNOSTICS convites = ROW_COUNT;

  UPDATE integrations.connections SET account_email = NULL WHERE lower(account_email) = lower(p_email);
  GET DIAGNOSTICS conexoes = ROW_COUNT;

  UPDATE audit.audit_log SET metadata = metadata - 'email' WHERE lower(metadata ->> 'email') = lower(p_email);
  GET DIAGNOSTICS eventos_com_email = ROW_COUNT;

  RETURN jsonb_build_object(
    'usuarioEncontrado', v_usuario IS NOT NULL,
    'vinculosRevogados', vinculos_revogados,
    'eventosDoUsuario', eventos_do_usuario,
    'convites', convites,
    'conexoes', conexoes,
    'eventosComEmail', eventos_com_email
  );
END;
$$;

COMMENT ON FUNCTION core.anonimizar_titular IS
  'Atende pedido de exclusão (LGPD, art. 18, VI): revoga os vínculos e anonimiza o titular em users, convites, conexões e na trilha de auditoria. Só o dono do banco executa (scripts/titular.mjs).';

REVOKE ALL ON FUNCTION core.anonimizar_titular(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION core.excluir_cliente(p_cliente uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
VOLATILE
AS $$
DECLARE
  v_organizacao uuid;
  v_contas uuid[];
  revisoes integer;
  metricas integer;
  execucoes integer;
  coletas integer;
  convites integer;
  acessos integer;
  contas integer;
BEGIN
  SELECT organization_id INTO v_organizacao FROM core.clients WHERE id = p_cliente;
  IF v_organizacao IS NULL THEN
    RAISE EXCEPTION 'cliente % não existe', p_cliente;
  END IF;
  IF EXISTS (SELECT 1 FROM core.clients WHERE parent_client_id = p_cliente) THEN
    RAISE EXCEPTION 'cliente % tem clientes vinculados; exclua-os antes', p_cliente;
  END IF;

  SELECT coalesce(array_agg(id), '{}') INTO v_contas FROM integrations.ad_accounts WHERE client_id = p_cliente;

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
  DELETE FROM core.member_clients WHERE client_id = p_cliente;
  GET DIAGNOSTICS acessos = ROW_COUNT;
  DELETE FROM integrations.ad_accounts WHERE client_id = p_cliente;
  GET DIAGNOSTICS contas = ROW_COUNT;
  DELETE FROM core.clients WHERE id = p_cliente;

  INSERT INTO audit.audit_log (organization_id, actor_type, action, target_type, target_id, metadata)
  VALUES (v_organizacao, 'system', 'client.purged', 'client', p_cliente::text,
          jsonb_build_object('contas', contas, 'metricas', metricas));

  RETURN jsonb_build_object(
    'organizacao', v_organizacao,
    'revisoes', revisoes,
    'metricas', metricas,
    'execucoes', execucoes,
    'coletas', coletas,
    'convites', convites,
    'acessos', acessos,
    'contas', contas
  );
END;
$$;

COMMENT ON FUNCTION core.excluir_cliente IS
  'Exclui um cliente e todo o seu histórico no Postgres (pedido de exclusão ou fim de contrato). O BigQuery é limpo pelo scripts/titular.mjs. Só o dono do banco executa.';

REVOKE ALL ON FUNCTION core.excluir_cliente(uuid) FROM PUBLIC;

COMMIT;
