BEGIN;

DO $$
BEGIN
  PERFORM set_config(
    'coleta.papel_app',
    (SELECT rolname FROM pg_roles WHERE rolname IN ('orla_app', 'tria_app') ORDER BY rolname = 'orla_app' DESC LIMIT 1),
    true
  );
END $$;

CREATE OR REPLACE FUNCTION automation.coleta_concluida(p_fonte_tipo text, p_fonte_id uuid, p_em timestamptz)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
VOLATILE
AS $$
  UPDATE integrations.ad_accounts
  SET last_sync_at = greatest(coalesce(last_sync_at, p_em), p_em)
  WHERE p_fonte_tipo = 'ad_account' AND id = p_fonte_id;
$$;

COMMENT ON FUNCTION automation.coleta_concluida IS
  'Marca a última coleta bem-sucedida da conta de anúncio. A camada de coleta (0033) não atualizava last_sync_at, que só o caminho antigo de ingestão gravava, e as telas mostravam "nunca" para contas coletadas.';

REVOKE ALL ON FUNCTION automation.coleta_concluida(text, uuid, timestamptz) FROM PUBLIC;
DO $$ BEGIN
  EXECUTE format('GRANT EXECUTE ON FUNCTION automation.coleta_concluida(text, uuid, timestamptz) TO %I', current_setting('coleta.papel_app'));
END $$;

UPDATE integrations.ad_accounts a
SET last_sync_at = ultima.em
FROM (
  SELECT ad_account_id, max(finished_at) AS em
  FROM automation.coletas
  WHERE status = 'success' AND ad_account_id IS NOT NULL AND finished_at IS NOT NULL
  GROUP BY ad_account_id
) ultima
WHERE a.id = ultima.ad_account_id
  AND (a.last_sync_at IS NULL OR a.last_sync_at < ultima.em);

COMMIT;
