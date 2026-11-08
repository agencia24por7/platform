BEGIN;

CREATE OR REPLACE FUNCTION automation.resolve_run_organization(p_run_id uuid)
RETURNS TABLE (organization_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public STABLE
AS $$ SELECT r.organization_id FROM automation.sync_runs r WHERE r.id = p_run_id $$;

CREATE OR REPLACE FUNCTION automation.resolve_run_by_key(p_key text)
RETURNS TABLE (organization_id uuid, run_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public STABLE
AS $$ SELECT r.organization_id, r.id FROM automation.sync_runs r WHERE r.idempotency_key = p_key $$;

COMMENT ON FUNCTION automation.resolve_run_organization IS
  'Resolve o tenant de uma execução para o worker. Devolve apenas o identificador.';
COMMENT ON FUNCTION automation.resolve_run_by_key IS
  'Resolve execução por chave de idempotência, para o worker reaproveitar em vez de duplicar.';

REVOKE ALL ON FUNCTION automation.resolve_run_organization(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION automation.resolve_run_by_key(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION automation.resolve_run_organization(uuid) TO tria_app;
GRANT EXECUTE ON FUNCTION automation.resolve_run_by_key(text) TO tria_app;

COMMIT;
