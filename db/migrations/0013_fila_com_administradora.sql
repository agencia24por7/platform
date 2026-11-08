BEGIN;

DROP FUNCTION IF EXISTS automation.sync_queue(integer, integer, interval);

CREATE FUNCTION automation.sync_queue(
  p_limit integer DEFAULT 50,
  p_rewindow_days integer DEFAULT 28,
  p_min_interval interval DEFAULT interval '6 hours'
)
RETURNS TABLE (
  ad_account_id     uuid,
  organization_id   uuid,
  client_id         uuid,
  client_name       text,
  platform          text,
  external_id       text,
  login_customer_id text,
  account_name      text,
  currency          char(3),
  timezone          text,
  credential_ref    text,
  connection_id     uuid,
  window_start      date,
  window_end        date,
  last_sync_at      timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT
    a.id,
    a.organization_id,
    a.client_id,
    c.name,
    a.platform::text,
    a.external_id,
    CASE
      WHEN d.manager_external_id IS NULL THEN NULL
      WHEN d.manager_external_id = a.external_id THEN NULL
      ELSE d.manager_external_id
    END,
    a.name,
    a.currency,
    a.timezone,
    n.credential_ref,
    n.id,
    (current_date - make_interval(days => greatest(p_rewindow_days, 1)))::date,
    current_date,
    a.last_sync_at
  FROM integrations.ad_accounts a
  JOIN core.clients c ON c.id = a.client_id
  JOIN integrations.connections n ON n.id = a.connection_id
  LEFT JOIN integrations.connection_accounts d
    ON d.connection_id = a.connection_id
   AND d.external_id = a.external_id
  WHERE a.sync_enabled
    AND a.status = 'linked'
    AND n.status IN ('active', 'expiring')
    AND (a.last_sync_at IS NULL OR a.last_sync_at < now() - p_min_interval)
  ORDER BY a.last_sync_at NULLS FIRST, a.created_at
  LIMIT greatest(least(p_limit, 200), 1);
$$;

COMMENT ON FUNCTION automation.sync_queue IS
  'Única travessia de tenant do sistema. Devolve apenas metadados de sincronização — nunca segredo. O credential_ref é um ponteiro para a credencial no n8n. O login_customer_id é a administradora exigida pela API do Google quando a conta é acessada através de uma MCC; vem nulo quando a conta é acessada diretamente.';

REVOKE ALL ON FUNCTION automation.sync_queue(integer, integer, interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION automation.sync_queue(integer, integer, interval) TO tria_app;

COMMIT;
