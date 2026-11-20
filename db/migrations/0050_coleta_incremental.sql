BEGIN;

DO $$
BEGIN
  PERFORM set_config(
    'coleta.papel_app',
    (SELECT rolname FROM pg_roles WHERE rolname IN ('orla_app', 'tria_app') ORDER BY rolname = 'orla_app' DESC LIMIT 1),
    true
  );
END $$;

ALTER TYPE automation.collection_mode ADD VALUE IF NOT EXISTS 'incremental';

CREATE FUNCTION automation.historico_de_coleta()
RETURNS TABLE (
  fonte_tipo                      text,
  fonte_id                        uuid,
  ultima_janela_sucesso           date,
  ultima_janela_parcial_repetida  date,
  ultima_incremental_em           timestamptz,
  ultimo_limite_diario_em         timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  WITH base AS (
    SELECT c.fonte_tipo, coalesce(c.ad_account_id, c.connection_account_id) AS fonte_id,
           c.status::text AS status, c.mode::text AS modo, c.window_end, c.started_at, c.finished_at,
           c.error_code, c.error_message
    FROM automation.coletas c
  ),
  parciais_repetidas AS (
    SELECT r.fonte_tipo, r.fonte_id, max(r.window_end) AS janela
    FROM (
      SELECT b.fonte_tipo, b.fonte_id, b.window_end
      FROM base b
      WHERE b.status = 'partial'
      GROUP BY b.fonte_tipo, b.fonte_id, b.window_end
      HAVING count(*) >= 3
    ) r
    GROUP BY r.fonte_tipo, r.fonte_id
  )
  SELECT
    b.fonte_tipo,
    b.fonte_id,
    max(b.window_end) FILTER (WHERE b.status = 'success'),
    max(p.janela),
    max(b.started_at) FILTER (WHERE b.modo = 'incremental' AND b.status IN ('success', 'partial')),
    max(b.finished_at) FILTER (WHERE b.status = 'failed' AND b.error_code = 'limite_de_uso' AND b.error_message LIKE 'cota_diaria%')
  FROM base b
  LEFT JOIN parciais_repetidas p ON p.fonte_tipo = b.fonte_tipo AND p.fonte_id = b.fonte_id
  GROUP BY b.fonte_tipo, b.fonte_id;
$$;

COMMENT ON FUNCTION automation.historico_de_coleta IS
  'Marca d''água da coleta incremental (ADR 0025), derivada só de automation.coletas: fim da última janela com status success, fim da janela parcial repetida 3 vezes (aceita para não travar a fonte), início da última incremental concluída (cadência diária e dimensões) e o último fechamento por cota diária esgotada.';

REVOKE ALL ON FUNCTION automation.historico_de_coleta() FROM PUBLIC;

DO $$ BEGIN
  EXECUTE format('GRANT EXECUTE ON FUNCTION automation.historico_de_coleta() TO %I', current_setting('coleta.papel_app'));
END $$;

CREATE INDEX IF NOT EXISTS coletas_fonte_janela_idx
  ON automation.coletas ((coalesce(ad_account_id, connection_account_id)), status, window_end DESC);

COMMIT;
