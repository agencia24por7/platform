BEGIN;

CREATE OR REPLACE FUNCTION automation.resolve_account_organization(p_ad_account_id uuid)
RETURNS TABLE (organization_id uuid, sync_enabled boolean, account_status text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT a.organization_id, a.sync_enabled, a.status::text
  FROM integrations.ad_accounts a
  WHERE a.id = p_ad_account_id
$$;

COMMENT ON FUNCTION automation.resolve_account_organization IS
  'Resolve o tenant de uma conta para o worker, que não tem contexto de organização. Devolve apenas identificadores.';

REVOKE ALL ON FUNCTION automation.resolve_account_organization(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION automation.resolve_account_organization(uuid) TO tria_app;

COMMIT;
