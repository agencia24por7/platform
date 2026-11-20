BEGIN;

DO $$
BEGIN
  PERFORM set_config(
    'coleta.papel_app',
    (SELECT rolname FROM pg_roles WHERE rolname IN ('orla_app', 'tria_app') ORDER BY rolname = 'orla_app' DESC LIMIT 1),
    true
  );
END $$;

CREATE OR REPLACE FUNCTION automation.fontes_de_coleta(p_limit integer DEFAULT 50)
RETURNS TABLE (
  fonte_tipo           text,
  fonte_id             uuid,
  organization_id      uuid,
  client_id            uuid,
  client_name          text,
  platform             text,
  external_id          text,
  manager_external_id  text,
  nome                 text,
  currency             char(3),
  timezone             text,
  credential_ref       text,
  coletor_ref          text,
  connection_id        uuid
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT
    'ad_account', a.id, a.organization_id, a.client_id, c.name, a.platform::text, a.external_id,
    CASE WHEN d.manager_external_id = a.external_id THEN NULL ELSE d.manager_external_id END,
    a.name, a.currency, a.timezone, n.credential_ref, n.coletor_ref, n.id
  FROM integrations.ad_accounts a
  JOIN core.clients c ON c.id = a.client_id
  JOIN core.organizations o ON o.id = a.organization_id
  JOIN integrations.connections n ON n.id = a.connection_id
  LEFT JOIN integrations.connection_accounts d
    ON d.connection_id = a.connection_id AND d.external_id = a.external_id
  WHERE a.sync_enabled
    AND a.status = 'linked'
    AND c.status = 'active'
    AND o.status = 'active'
    AND n.status IN ('active', 'expiring')

  UNION ALL

  SELECT
    'connection_account', ca.id, ca.organization_id, ca.client_id, c.name, ca.platform::text, ca.external_id,
    ca.manager_external_id, ca.name, ca.currency, ca.timezone, n.credential_ref, n.coletor_ref, n.id
  FROM integrations.connection_accounts ca
  JOIN core.clients c ON c.id = ca.client_id
  JOIN core.organizations o ON o.id = ca.organization_id
  JOIN integrations.connections n ON n.id = ca.connection_id
  WHERE ca.client_id IS NOT NULL
    AND ca.state = 'linked'
    AND NOT ca.inactive
    AND c.status = 'active'
    AND o.status = 'active'
    AND n.status IN ('active', 'expiring')

  ORDER BY 2
  LIMIT greatest(least(p_limit, 2000), 1);
$$;

COMMENT ON FUNCTION automation.fontes_de_coleta IS
  'Travessia de tenant do orquestrador de coleta (ad_accounts e connection_accounts vinculadas a cliente). Ordem estável por fonte_id e teto de 2000: o serviço filtra plataforma e ordena por atraso depois (ADR 0025).';

ALTER TABLE automation.coletas
  ADD COLUMN pausa_ate timestamptz,
  ADD COLUMN pausa_motivo text CHECK (pausa_motivo IS NULL OR pausa_motivo IN ('cota_diaria', 'limite_temporario')),
  ADD COLUMN pausa_escopo text CHECK (pausa_escopo IS NULL OR pausa_escopo IN ('fonte', 'plataforma'));

COMMENT ON COLUMN automation.coletas.pausa_ate IS
  'Até quando a fonte (ou a plataforma inteira, conforme pausa_escopo) não deve ser coletada de novo, gravado no fechamento por limite_de_uso. Substitui o casamento com o texto de error_message (ADR 0025).';

CREATE FUNCTION automation.registrar_pausa_da_coleta(p_coleta_id uuid, p_ate timestamptz, p_motivo text, p_escopo text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
VOLATILE
AS $$
  UPDATE automation.coletas
  SET pausa_ate = p_ate, pausa_motivo = p_motivo, pausa_escopo = p_escopo
  WHERE id = p_coleta_id AND status = 'failed' AND error_code = 'limite_de_uso';
$$;

COMMENT ON FUNCTION automation.registrar_pausa_da_coleta IS
  'Grava a pausa estruturada de uma coleta fechada por limite_de_uso. O worker não tem contexto de tenant, por isso a escrita passa por aqui, restrita a coleta failed com error_code limite_de_uso.';

REVOKE ALL ON FUNCTION automation.registrar_pausa_da_coleta(uuid, timestamptz, text, text) FROM PUBLIC;

DO $$ BEGIN
  EXECUTE format('GRANT EXECUTE ON FUNCTION automation.registrar_pausa_da_coleta(uuid, timestamptz, text, text) TO %I', current_setting('coleta.papel_app'));
END $$;

DROP FUNCTION IF EXISTS automation.historico_de_coleta();

CREATE FUNCTION automation.historico_de_coleta()
RETURNS TABLE (
  fonte_tipo                      text,
  fonte_id                        uuid,
  ultima_janela_sucesso           date,
  ultima_janela_parcial_repetida  date,
  ultima_incremental_em           timestamptz,
  pausa_ate                       timestamptz,
  pausa_da_plataforma_ate         timestamptz,
  em_execucao_desde               timestamptz,
  ultima_tentativa_em             timestamptz,
  falhas_consecutivas             integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  WITH base AS (
    SELECT c.fonte_tipo, coalesce(c.ad_account_id, c.connection_account_id) AS fonte_id, c.platform::text AS platform,
           c.status::text AS status, c.mode::text AS modo, c.window_end, c.started_at, c.finished_at,
           c.pausa_ate, c.pausa_escopo
    FROM automation.coletas c
    WHERE c.started_at >= now() - interval '400 days'
  ),
  pausas_da_plataforma AS (
    SELECT b.platform, max(b.pausa_ate) AS ate
    FROM base b
    WHERE b.pausa_escopo = 'plataforma' AND b.pausa_ate > now()
    GROUP BY b.platform
  ),
  validas AS (
    SELECT * FROM base WHERE modo IN ('incremental', 'completa')
  ),
  parciais_repetidas AS (
    SELECT r.fonte_tipo, r.fonte_id, max(r.window_end) AS janela
    FROM (
      SELECT v.fonte_tipo, v.fonte_id, v.window_end
      FROM validas v
      WHERE v.status = 'partial'
      GROUP BY v.fonte_tipo, v.fonte_id, v.window_end
      HAVING count(*) >= 3
    ) r
    GROUP BY r.fonte_tipo, r.fonte_id
  ),
  ultimo_ok AS (
    SELECT b.fonte_tipo, b.fonte_id, max(b.started_at) AS em
    FROM base b
    WHERE b.modo = 'incremental' AND b.status IN ('success', 'partial')
    GROUP BY b.fonte_tipo, b.fonte_id
  )
  SELECT
    b.fonte_tipo,
    b.fonte_id,
    max(b.window_end) FILTER (WHERE b.status = 'success' AND b.modo IN ('incremental', 'completa')),
    max(p.janela),
    max(o.em),
    max(b.pausa_ate),
    max(pp.ate),
    max(b.started_at) FILTER (WHERE b.status = 'running'),
    max(b.started_at) FILTER (WHERE b.modo = 'incremental'),
    (count(*) FILTER (WHERE b.modo = 'incremental' AND b.status = 'failed' AND b.started_at > coalesce(o.em, '-infinity'::timestamptz)))::integer
  FROM base b
  LEFT JOIN parciais_repetidas p ON p.fonte_tipo = b.fonte_tipo AND p.fonte_id = b.fonte_id
  LEFT JOIN ultimo_ok o ON o.fonte_tipo = b.fonte_tipo AND o.fonte_id = b.fonte_id
  LEFT JOIN pausas_da_plataforma pp ON pp.platform = b.platform
  GROUP BY b.fonte_tipo, b.fonte_id;
$$;

COMMENT ON FUNCTION automation.historico_de_coleta IS
  'Marca d''água da coleta incremental (ADR 0025): só coletas incremental/completa dos últimos 400 dias contam (amostra, com teto de 500 linhas, nunca), parcial só conta repetida 3 vezes na mesma janela. Pausa vem de pausa_ate (por fonte) e, com escopo plataforma, vale para toda fonte da mesma plataforma (cota do developer token do Google Ads). Devolve também coleta em execução, última tentativa e falhas incrementais seguidas, para o serviço pular fonte ocupada e espaçar fonte que só falha.';

REVOKE ALL ON FUNCTION automation.historico_de_coleta() FROM PUBLIC;

DO $$ BEGIN
  EXECUTE format('GRANT EXECUTE ON FUNCTION automation.historico_de_coleta() TO %I', current_setting('coleta.papel_app'));
END $$;

CREATE FUNCTION automation.expirar_coletas_running(p_idade interval)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
VOLATILE
AS $$
  WITH expiradas AS (
    UPDATE automation.coletas
    SET status = 'failed',
        finished_at = now(),
        duration_ms = least(greatest((extract(epoch FROM now() - started_at) * 1000)::bigint, 0), 2147483647)::integer,
        error_code = 'abandonada',
        error_message = 'Coleta ficou em running além do limite e foi encerrada pela rotina.'
    WHERE status = 'running' AND started_at < now() - p_idade
    RETURNING 1
  )
  SELECT count(*)::integer FROM expiradas;
$$;

COMMENT ON FUNCTION automation.expirar_coletas_running IS
  'Fecha como failed (error_code abandonada) toda coleta running mais velha que p_idade. Chamada no início de /coleta/fontes: uma execução do n8n que morreu no meio não prende a fonte nem deixa running para sempre.';

REVOKE ALL ON FUNCTION automation.expirar_coletas_running(interval) FROM PUBLIC;

DO $$ BEGIN
  EXECUTE format('GRANT EXECUTE ON FUNCTION automation.expirar_coletas_running(interval) TO %I', current_setting('coleta.papel_app'));
END $$;

SELECT automation.expirar_coletas_running(interval '8 hours');

UPDATE automation.coletas c
SET status = 'failed', finished_at = now(), error_code = 'abandonada',
    error_message = 'Coleta running duplicada da mesma fonte, encerrada ao criar o índice de uma running por fonte.'
WHERE c.status = 'running'
  AND EXISTS (
    SELECT 1 FROM automation.coletas outra
    WHERE outra.status = 'running'
      AND coalesce(outra.ad_account_id, outra.connection_account_id) = coalesce(c.ad_account_id, c.connection_account_id)
      AND (outra.started_at, outra.id) > (c.started_at, c.id)
  );

CREATE UNIQUE INDEX coletas_uma_running_por_fonte
  ON automation.coletas ((coalesce(ad_account_id, connection_account_id)))
  WHERE status = 'running';

COMMIT;
