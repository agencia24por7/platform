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
  JOIN core.organizations o ON o.id = a.organization_id
  JOIN integrations.connections n ON n.id = a.connection_id
  LEFT JOIN integrations.connection_accounts d
    ON d.connection_id = a.connection_id
   AND d.external_id = a.external_id
  WHERE a.sync_enabled
    AND a.status = 'linked'
    AND c.status = 'active'
    AND o.status = 'active'
    AND n.status IN ('active', 'expiring')
    AND (a.last_sync_at IS NULL OR a.last_sync_at < now() - p_min_interval)
  ORDER BY a.last_sync_at NULLS FIRST, a.created_at
  LIMIT greatest(least(p_limit, 200), 1);
$$;

COMMENT ON FUNCTION automation.sync_queue IS
  'Unica travessia de tenant do sistema. Devolve apenas metadados de sincronizacao, nunca segredo. Pausar ou arquivar um cliente tira as contas dele da fila: a decisao de negocio vale onde o trabalho e escolhido, nao so na tela.';

REVOKE ALL ON FUNCTION automation.sync_queue(integer, integer, interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION automation.sync_queue(integer, integer, interval) TO tria_app;

DROP FUNCTION IF EXISTS automation.resolve_account_organization(uuid);

CREATE FUNCTION automation.resolve_account_organization(p_ad_account_id uuid)
RETURNS TABLE (organization_id uuid, sync_enabled boolean, account_status text, client_status text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT a.organization_id, a.sync_enabled, a.status::text, c.status::text
  FROM integrations.ad_accounts a
  JOIN core.clients c ON c.id = a.client_id
  WHERE a.id = p_ad_account_id
$$;

COMMENT ON FUNCTION automation.resolve_account_organization IS
  'Resolve o tenant de uma conta para o worker, que nao tem contexto de organizacao. Devolve apenas identificadores e a situacao que decide se o trabalho ainda e aceito.';

REVOKE ALL ON FUNCTION automation.resolve_account_organization(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION automation.resolve_account_organization(uuid) TO tria_app;

COMMIT;
