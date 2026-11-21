BEGIN;

ALTER TABLE integrations.connection_tokens
  ADD COLUMN IF NOT EXISTS renovacao_iniciada_em timestamptz;

COMMENT ON COLUMN integrations.connection_tokens.renovacao_iniciada_em IS
  'Concessão (lease) de renovação única por conexão (ADR 0032): quem grava now() aqui com a coluna nula ou vencida é o único que chama o provedor; a gravação do resultado exige a versao lida e devolve a coluna a nulo. Nenhuma transação fica aberta durante a chamada de rede.';

ALTER TABLE integrations.connection_tokens DROP CONSTRAINT IF EXISTS connection_tokens_ultima_falha_codigo_check;
ALTER TABLE integrations.connection_tokens
  ADD CONSTRAINT connection_tokens_ultima_falha_codigo_check
  CHECK (ultima_falha_codigo IS NULL OR ultima_falha_codigo ~ '^[a-z0-9_]{1,40}$');

DROP FUNCTION IF EXISTS automation.fontes_de_coleta(integer);

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
  connection_id        uuid,
  tem_token            boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT
    'ad_account', a.id, a.organization_id, a.client_id, c.name, a.platform::text, a.external_id,
    CASE WHEN d.manager_external_id = a.external_id THEN NULL ELSE d.manager_external_id END,
    a.name, a.currency, a.timezone, n.id,
    EXISTS (SELECT 1 FROM integrations.connection_tokens t WHERE t.connection_id = n.id)
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
    ca.manager_external_id, ca.name, ca.currency, ca.timezone, n.id,
    EXISTS (SELECT 1 FROM integrations.connection_tokens t WHERE t.connection_id = n.id)
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
  'Travessia de tenant do orquestrador de coleta (ad_accounts e connection_accounts vinculadas a cliente). Desde o cofre (ADR 0032) não devolve ponteiro do n8n: tem_token diz se a conexão tem segredo no cofre; o coletor genérico da plataforma pede o access token em /api/v0/coleta/token. Ordem estável por fonte_id e teto de 2000 (ADR 0025).';

DROP FUNCTION IF EXISTS automation.task_queue(integer, text[]);

CREATE FUNCTION automation.task_queue(p_limit integer DEFAULT 10, p_kinds text[] DEFAULT NULL)
RETURNS TABLE (
  task_id             uuid,
  organization_id     uuid,
  kind                text,
  manager_external_id text,
  target_external_id  text,
  platform            text,
  connection_id       uuid,
  tem_token           boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
VOLATILE
AS $$
  UPDATE automation.account_tasks t
  SET status = 'running', attempts = t.attempts + 1
  FROM integrations.connections n
  WHERE t.id IN (
    SELECT id FROM automation.account_tasks
    WHERE status = 'pending' AND attempts < 3
      AND (p_kinds IS NULL OR kind::text = ANY (p_kinds))
    ORDER BY created_at
    LIMIT greatest(least(p_limit, 50), 1)
    FOR UPDATE SKIP LOCKED
  )
  AND n.id = t.connection_id
  RETURNING t.id, t.organization_id, t.kind::text, t.manager_external_id,
            t.target_external_id, n.platform::text, n.id,
            EXISTS (SELECT 1 FROM integrations.connection_tokens k WHERE k.connection_id = n.id);
$$;

COMMENT ON FUNCTION automation.task_queue IS
  'Entrega ao n8n as intenções pendentes, nunca o segredo nem ponteiro de credencial (ADR 0032). O executor genérico da plataforma pede o access token em /api/v0/coleta/token com o task_id. p_kinds restringe os tipos: cada executor só reivindica o que sabe fazer.';

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
  connection_id     uuid,
  tem_token         boolean,
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
    n.id,
    EXISTS (SELECT 1 FROM integrations.connection_tokens t WHERE t.connection_id = n.id),
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
  'Fila legada de sincronização. Devolve apenas metadados, nunca segredo nem ponteiro de credencial (ADR 0032): tem_token diz se a conexão tem segredo no cofre.';

ALTER TABLE integrations.connections DROP COLUMN IF EXISTS credential_ref;
ALTER TABLE integrations.connections DROP COLUMN IF EXISTS coletor_ref;
ALTER TABLE integrations.connections DROP COLUMN IF EXISTS executor_ref;

ALTER TABLE integrations.corte_para_cofre_refs ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations.corte_para_cofre_refs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS corte_para_cofre_refs_so_o_dono_do_banco ON integrations.corte_para_cofre_refs;
CREATE POLICY corte_para_cofre_refs_so_o_dono_do_banco ON integrations.corte_para_cofre_refs
  FOR ALL USING (false) WITH CHECK (false);
COMMENT ON POLICY corte_para_cofre_refs_so_o_dono_do_banco ON integrations.corte_para_cofre_refs IS
  'Nenhum papel da aplicação lê ou grava o estado do corte: só o superusuário (scripts/n8n-limpar-legado.mjs por psql), que ignora RLS.';

REVOKE ALL ON FUNCTION integrations.conexao_ativa_exige_token() FROM PUBLIC;

DO $$
DECLARE
  papel_app text := (SELECT rolname FROM pg_roles WHERE rolname IN ('orla_app', 'tria_app') ORDER BY rolname = 'orla_app' DESC LIMIT 1);
  funcao text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orla_worker') THEN
    RAISE EXCEPTION 'papel orla_worker ausente; a 0070 precisa ter rodado antes';
  END IF;
  FOREACH funcao IN ARRAY ARRAY[
    'automation.fontes_de_coleta(integer)',
    'automation.task_queue(integer, text[])',
    'automation.sync_queue(integer, integer, interval)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', funcao);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', funcao, papel_app);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO orla_worker', funcao);
  END LOOP;
END $$;

COMMIT;
