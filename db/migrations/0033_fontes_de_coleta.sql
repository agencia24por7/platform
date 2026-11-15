BEGIN;

ALTER TABLE integrations.connections
  ADD COLUMN coletor_ref text CHECK (coletor_ref IS NULL OR length(coletor_ref) <= 64);

COMMENT ON COLUMN integrations.connections.coletor_ref IS
  'Id do sub-workflow coletor no n8n, gerado com a credencial desta conexão vinculada no JSON do nó. NULL até o provisionamento rodar.';

CREATE TYPE automation.collection_mode AS ENUM ('amostra', 'completa');

CREATE TABLE automation.coletas (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES core.organizations(id) ON DELETE RESTRICT,
  client_id             uuid NOT NULL REFERENCES core.clients(id) ON DELETE RESTRICT,
  platform              integrations.platform NOT NULL,
  fonte_tipo            text NOT NULL CHECK (fonte_tipo IN ('ad_account', 'connection_account')),
  ad_account_id         uuid REFERENCES integrations.ad_accounts(id) ON DELETE RESTRICT,
  connection_account_id uuid REFERENCES integrations.connection_accounts(id) ON DELETE RESTRICT,
  mode                  automation.collection_mode NOT NULL,
  idempotency_key       text NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 8 AND 160),
  status                automation.run_status NOT NULL DEFAULT 'running',
  window_start          date NOT NULL,
  window_end            date NOT NULL,
  request_count         integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  rows_received         integer NOT NULL DEFAULT 0 CHECK (rows_received >= 0),
  rows_written          integer NOT NULL DEFAULT 0 CHECK (rows_written >= 0),
  qualidade_resumo      jsonb,
  started_at            timestamptz NOT NULL DEFAULT now(),
  finished_at           timestamptz,
  duration_ms           integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
  n8n_execution_id      text CHECK (n8n_execution_id IS NULL OR length(n8n_execution_id) <= 64),
  error_code            text CHECK (error_code IS NULL OR length(error_code) <= 80),
  error_message         text CHECK (error_message IS NULL OR length(error_message) <= 1000),
  CONSTRAINT coletas_window_order CHECK (window_end >= window_start),
  CONSTRAINT coletas_fonte_polimorfica CHECK (
    (fonte_tipo = 'ad_account' AND ad_account_id IS NOT NULL AND connection_account_id IS NULL)
    OR (fonte_tipo = 'connection_account' AND connection_account_id IS NOT NULL AND ad_account_id IS NULL)
  )
);

CREATE INDEX coletas_client_idx ON automation.coletas (client_id, started_at DESC);
CREATE INDEX coletas_status_idx ON automation.coletas (status, started_at DESC);

COMMENT ON TABLE automation.coletas IS
  'Plano de controle da camada de coleta. Os DADOS trazidos vão para o BigQuery; aqui fica só execução, qualidade e volumetria, no mesmo espírito de automation.sync_runs.';

GRANT SELECT, INSERT, UPDATE ON automation.coletas TO tria_app;

ALTER TABLE automation.coletas ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation.coletas FORCE ROW LEVEL SECURITY;

CREATE POLICY coletas_tenant ON automation.coletas FOR ALL TO tria_app
  USING (organization_id = core.current_organization() AND core.cliente_no_escopo(client_id))
  WITH CHECK (organization_id = core.current_organization() AND core.cliente_no_escopo(client_id));

CREATE FUNCTION automation.fontes_de_coleta(p_limit integer DEFAULT 50)
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

  LIMIT greatest(least(p_limit, 200), 1);
$$;

COMMENT ON FUNCTION automation.fontes_de_coleta IS
  'Travessia de tenant do orquestrador de coleta, no molde de automation.sync_queue — mas unindo duas origens polimórficas: ad_accounts (google/meta) e connection_accounts vinculadas a cliente (ga4/gtm/searchconsole/youtube/gbp). Pausar ou arquivar organização/cliente tira a fonte da lista.';

REVOKE ALL ON FUNCTION automation.fontes_de_coleta(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION automation.fontes_de_coleta(integer) TO tria_app;

CREATE FUNCTION automation.resolve_coleta_fonte(p_fonte_tipo text, p_fonte_id uuid)
RETURNS TABLE (organization_id uuid, client_id uuid, platform text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT a.organization_id, a.client_id, a.platform::text
  FROM integrations.ad_accounts a
  JOIN core.clients c ON c.id = a.client_id
  JOIN core.organizations o ON o.id = a.organization_id
  JOIN integrations.connections n ON n.id = a.connection_id
  WHERE p_fonte_tipo = 'ad_account' AND a.id = p_fonte_id
    AND a.sync_enabled AND a.status = 'linked' AND c.status = 'active' AND o.status = 'active'
    AND n.status IN ('active', 'expiring')

  UNION ALL

  SELECT ca.organization_id, ca.client_id, ca.platform::text
  FROM integrations.connection_accounts ca
  JOIN core.clients c ON c.id = ca.client_id
  JOIN core.organizations o ON o.id = ca.organization_id
  JOIN integrations.connections n ON n.id = ca.connection_id
  WHERE p_fonte_tipo = 'connection_account' AND ca.id = p_fonte_id AND ca.client_id IS NOT NULL
    AND ca.state = 'linked' AND NOT ca.inactive AND c.status = 'active' AND o.status = 'active'
    AND n.status IN ('active', 'expiring');
$$;

COMMENT ON FUNCTION automation.resolve_coleta_fonte IS
  'Resolve o tenant de uma fonte para o worker, que não tem contexto de organização — no molde de automation.resolve_account_organization. Reconfirma os mesmos filtros de ciclo de vida de fontes_de_coleta, porque algum tempo passa entre listar e abrir.';

REVOKE ALL ON FUNCTION automation.resolve_coleta_fonte(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION automation.resolve_coleta_fonte(text, uuid) TO tria_app;

CREATE FUNCTION automation.resolve_coleta_by_key(p_idempotency_key text)
RETURNS TABLE (organization_id uuid, coleta_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT organization_id, id FROM automation.coletas WHERE idempotency_key = p_idempotency_key;
$$;

COMMENT ON FUNCTION automation.resolve_coleta_by_key IS
  'Resolve o tenant de uma execução já aberta pela chave de idempotência — no molde de automation.resolve_run_by_key.';

REVOKE ALL ON FUNCTION automation.resolve_coleta_by_key(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION automation.resolve_coleta_by_key(text) TO tria_app;

CREATE FUNCTION automation.fechar_coleta(
  p_coleta_id uuid,
  p_status automation.run_status,
  p_request_count integer,
  p_rows_received integer,
  p_rows_written integer,
  p_qualidade_resumo jsonb,
  p_error_code text,
  p_error_message text
)
RETURNS automation.coletas
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
VOLATILE
AS $$
  UPDATE automation.coletas
  SET status = p_status,
      request_count = p_request_count,
      rows_received = p_rows_received,
      rows_written = p_rows_written,
      qualidade_resumo = p_qualidade_resumo,
      error_code = p_error_code,
      error_message = left(p_error_message, 1000),
      finished_at = now(),
      duration_ms = extract(epoch FROM (now() - started_at)) * 1000
  WHERE id = p_coleta_id AND status = 'running'
  RETURNING *;
$$;

COMMENT ON FUNCTION automation.fechar_coleta IS
  'Fail-closed como automation.task_result: só fecha uma coleta que ainda está running. Um fechamento duplicado ou atrasado do n8n devolve NULL em vez de sobrescrever um resultado já gravado.';

REVOKE ALL ON FUNCTION automation.fechar_coleta(uuid, automation.run_status, integer, integer, integer, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION automation.fechar_coleta(uuid, automation.run_status, integer, integer, integer, jsonb, text, text) TO tria_app;

CREATE FUNCTION automation.coleta_falhou_por_auth(p_fonte_tipo text, p_fonte_id uuid)
RETURNS integrations.connection_status
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
VOLATILE
AS $$
  UPDATE integrations.connections
  SET status = 'reauth_pending'
  WHERE status IN ('active', 'expiring', 'degraded')
    AND id = (
      SELECT a.connection_id FROM integrations.ad_accounts a
      WHERE p_fonte_tipo = 'ad_account' AND a.id = p_fonte_id
      UNION ALL
      SELECT ca.connection_id FROM integrations.connection_accounts ca
      WHERE p_fonte_tipo = 'connection_account' AND ca.id = p_fonte_id
    )
  RETURNING status;
$$;

COMMENT ON FUNCTION automation.coleta_falhou_por_auth IS
  'Loop de reautorização que a coleta fecha: 401/403 de token marca a conexão reauth_pending (a tela de conexões já exibe esse status), sem rebaixar quem já estava revoked. Recebe a fonte (não o connection_id direto) porque é isso que o worker tem em mãos ao fechar a execução.';

REVOKE ALL ON FUNCTION automation.coleta_falhou_por_auth(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION automation.coleta_falhou_por_auth(text, uuid) TO tria_app;

COMMIT;
