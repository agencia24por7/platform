BEGIN;

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
  convites_aceitos_anonimizados integer;
  usuarios_apagados integer;
  usuarios_anonimizados integer;
  whatsapp_apagados integer;
  alertas_apagados integer;
  v_ex_membros uuid[];
  v_convites_aceitos uuid[];
  v_emails_antigos text[];
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

  WITH alvo AS (
    UPDATE core.invitations SET email = 'removido+' || id || '@invalid'
     WHERE accepted_at IS NOT NULL
       AND email NOT LIKE 'removido+%'
       AND accepted_at < now() - interval '30 days'
    RETURNING id
  )
  SELECT coalesce(array_agg(id), '{}') INTO v_convites_aceitos FROM alvo;
  convites_aceitos_anonimizados := cardinality(v_convites_aceitos);

  IF convites_aceitos_anonimizados > 0 THEN
    UPDATE audit.audit_log SET metadata = metadata - 'email'
     WHERE target_type = 'invitation'
       AND target_id = ANY (SELECT x::text FROM unnest(v_convites_aceitos) x)
       AND metadata ? 'email';
  END IF;

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

  WITH antes AS (
    SELECT u.id, lower(u.email) AS email
      FROM core.users u
     WHERE u.email NOT LIKE 'removido+%'
       AND EXISTS (SELECT 1 FROM core.members m WHERE m.user_id = u.id)
       AND NOT EXISTS (SELECT 1 FROM core.members m WHERE m.user_id = u.id AND m.revoked_at IS NULL)
       AND (SELECT max(m.revoked_at) FROM core.members m WHERE m.user_id = u.id) < now() - interval '90 days'
       FOR UPDATE
  ),
  alvo AS (
    UPDATE core.users u
       SET email = 'removido+' || u.id || '@invalid', name = 'Titular removido', picture_url = NULL
      FROM antes
     WHERE u.id = antes.id
    RETURNING u.id, antes.email AS email_antigo
  )
  SELECT coalesce(array_agg(id), '{}'), coalesce(array_agg(email_antigo), '{}')
    INTO v_ex_membros, v_emails_antigos
    FROM alvo;
  usuarios_anonimizados := cardinality(v_ex_membros);

  IF usuarios_anonimizados > 0 THEN
    UPDATE audit.audit_log SET metadata = metadata - 'email', source_ip = NULL
     WHERE actor_id = ANY (SELECT x::text FROM unnest(v_ex_membros) x)
        OR target_id = ANY (SELECT x::text FROM unnest(v_ex_membros) x)
        OR lower(metadata ->> 'email') = ANY (v_emails_antigos);
  END IF;

  DELETE FROM integrations.whatsapp_inbound_events WHERE received_at < now() - interval '90 days';
  GET DIAGNOSTICS whatsapp_apagados = ROW_COUNT;

  DELETE FROM automation.alertas WHERE ultima_em < now() - interval '90 days';
  GET DIAGNOSTICS alertas_apagados = ROW_COUNT;

  RETURN jsonb_build_object(
    'ipsApagados', ips_apagados,
    'auditoriaApagada', auditoria_apagada,
    'acessosSemOrganizacao', acessos_sem_organizacao,
    'convitesAnonimizados', convites_anonimizados,
    'convitesAceitosAnonimizados', convites_aceitos_anonimizados,
    'usuariosApagados', usuarios_apagados,
    'usuariosAnonimizados', usuarios_anonimizados,
    'whatsappApagados', whatsapp_apagados,
    'alertasApagados', alertas_apagados
  );
END;
$$;

COMMENT ON FUNCTION core.aplicar_retencao IS
  'Aplica os prazos de retenção da política de privacidade (docs/lgpd/retencao.md). Chamada diariamente pelo n8n via /api/v0/manutencao/retencao, só pelo orla_worker.';

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
  eventos_whatsapp integer;
BEGIN
  IF p_email IS NULL OR p_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
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

  UPDATE integrations.whatsapp_inbound_events SET payload = '{"removido": true}'::jsonb
   WHERE EXISTS (
     SELECT 1 FROM jsonb_path_query(payload, '$.**') AS v
      WHERE jsonb_typeof(v) = 'string' AND lower(v #>> '{}') = lower(p_email)
   );
  GET DIAGNOSTICS eventos_whatsapp = ROW_COUNT;

  RETURN jsonb_build_object(
    'usuarioEncontrado', v_usuario IS NOT NULL,
    'vinculosRevogados', vinculos_revogados,
    'eventosDoUsuario', eventos_do_usuario,
    'convites', convites,
    'conexoes', conexoes,
    'eventosComEmail', eventos_com_email,
    'eventosWhatsapp', eventos_whatsapp
  );
END;
$$;

COMMENT ON FUNCTION core.anonimizar_titular IS
  'Atende pedido de exclusão (LGPD, art. 18, VI): revoga os vínculos e anonimiza o titular em users, convites, conexões, eventos do WhatsApp e na trilha de auditoria. Só o dono do banco executa (scripts/titular.mjs).';

COMMIT;
