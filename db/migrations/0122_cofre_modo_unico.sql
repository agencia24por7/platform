BEGIN;

ALTER TABLE integrations.connection_tokens
  ADD COLUMN IF NOT EXISTS renovacao_iniciada_em timestamptz,
  ADD COLUMN IF NOT EXISTS renovacao_dono uuid;

COMMENT ON COLUMN integrations.connection_tokens.renovacao_iniciada_em IS
  'Concessão (lease) de renovação única por conexão (ADR 0032): quem grava now() aqui com a coluna nula ou vencida é o único que chama o provedor; a gravação do resultado exige a versao lida e devolve a coluna a nulo. Nenhuma transação fica aberta durante a chamada de rede.';
COMMENT ON COLUMN integrations.connection_tokens.renovacao_dono IS
  'Identificador aleatório de quem detém a concessão. Liberar exige o mesmo identificador: um processo atrasado nunca solta a concessão de outro.';

ALTER TABLE integrations.connection_tokens DROP CONSTRAINT IF EXISTS connection_tokens_ultima_falha_codigo_check;
ALTER TABLE integrations.connection_tokens
  ADD CONSTRAINT connection_tokens_ultima_falha_codigo_check
  CHECK (ultima_falha_codigo IS NULL OR ultima_falha_codigo ~ '^[a-z0-9_]{1,40}$');

ALTER TABLE integrations.corte_para_cofre_refs ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations.corte_para_cofre_refs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS corte_para_cofre_refs_so_o_dono_do_banco ON integrations.corte_para_cofre_refs;
CREATE POLICY corte_para_cofre_refs_so_o_dono_do_banco ON integrations.corte_para_cofre_refs
  FOR ALL USING (false) WITH CHECK (false);
COMMENT ON POLICY corte_para_cofre_refs_so_o_dono_do_banco ON integrations.corte_para_cofre_refs IS
  'Nenhum papel da aplicação lê ou grava o estado do corte: só o superusuário (scripts/n8n-limpar-legado.mjs por psql), que ignora RLS.';

REVOKE ALL ON FUNCTION integrations.conexao_ativa_exige_token() FROM PUBLIC;

DROP FUNCTION IF EXISTS integrations.resolver_conexao_do_token(uuid, uuid);

CREATE FUNCTION integrations.resolver_conexao_do_token(p_coleta_id uuid, p_tarefa_id uuid)
RETURNS TABLE (
  organization_id     uuid,
  connection_id       uuid,
  platform            text,
  connection_status   text,
  origem_em_execucao  boolean,
  fonte_ativa         boolean,
  tenant_ativo        boolean,
  tem_token           boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT c.organization_id, n.id, n.platform::text, n.status::text,
         c.status::text = 'running' AND c.started_at > now() - interval '6 hours',
         CASE c.fonte_tipo
           WHEN 'ad_account' THEN coalesce(a.status::text = 'linked' AND a.sync_enabled, false)
           ELSE coalesce(ca.state::text = 'linked' AND NOT ca.inactive AND ca.client_id IS NOT NULL, false)
         END,
         cl.id IS NOT NULL AND cl.excluido_em IS NULL AND cl.status::text = 'active' AND o.status::text = 'active',
         EXISTS (SELECT 1 FROM integrations.connection_tokens t WHERE t.connection_id = n.id)
  FROM automation.coletas c
  LEFT JOIN integrations.ad_accounts a ON c.fonte_tipo = 'ad_account' AND a.id = c.ad_account_id
  LEFT JOIN integrations.connection_accounts ca ON c.fonte_tipo = 'connection_account' AND ca.id = c.connection_account_id
  JOIN integrations.connections n ON n.id = coalesce(a.connection_id, ca.connection_id)
  LEFT JOIN core.clients cl ON cl.id = c.client_id
  JOIN core.organizations o ON o.id = c.organization_id
  WHERE p_coleta_id IS NOT NULL AND p_tarefa_id IS NULL AND c.id = p_coleta_id

  UNION ALL

  SELECT t.organization_id, n.id, n.platform::text, n.status::text,
         t.status::text = 'running' AND t.updated_at > now() - interval '6 hours',
         true,
         o.status::text = 'active',
         EXISTS (SELECT 1 FROM integrations.connection_tokens k WHERE k.connection_id = n.id)
  FROM automation.account_tasks t
  JOIN integrations.connections n ON n.id = t.connection_id
  JOIN core.organizations o ON o.id = t.organization_id
  WHERE p_tarefa_id IS NOT NULL AND p_coleta_id IS NULL AND t.id = p_tarefa_id;
$$;

COMMENT ON FUNCTION integrations.resolver_conexao_do_token IS
  'Travessia de tenant do cofre de tokens (ADR 0032): o worker só apresenta um identificador que o próprio servidor emitiu (coletaId de abrir_coleta ou tarefaId de task_queue) e recebe de volta só ponteiros e estados, nunca segredo. Origem em execução = running há menos de 6 horas: um id antigo vazado não vira acesso.';

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
  tem_token            boolean,
  credential_ref       text,
  coletor_ref          text
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
    EXISTS (SELECT 1 FROM integrations.connection_tokens t WHERE t.connection_id = n.id),
    NULL::text, NULL::text
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
    EXISTS (SELECT 1 FROM integrations.connection_tokens t WHERE t.connection_id = n.id),
    NULL::text, NULL::text
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
  'Travessia de tenant do orquestrador de coleta (ad_accounts e connection_accounts vinculadas a cliente). Desde o cofre (ADR 0032) tem_token diz se a conexão tem segredo no cofre e o coletor genérico pede o access token em /api/v0/coleta/token. credential_ref e coletor_ref saem sempre nulos: só existem para a imagem anterior ao corte continuar respondendo durante o deploy (caem em "sem coletor") e somem com db/pendentes/0123. Ordem estável por fonte_id e teto de 2000 (ADR 0025).';

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
  tem_token           boolean,
  credential_ref      text,
  executor_ref        text
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
    SELECT p.id FROM automation.account_tasks p
    JOIN integrations.connections pn ON pn.id = p.connection_id
    WHERE p.status = 'pending' AND p.attempts < 3
      AND (p_kinds IS NULL OR p.kind::text = ANY (p_kinds))
      AND pn.status IN ('active', 'expiring')
      AND EXISTS (SELECT 1 FROM integrations.connection_tokens k WHERE k.connection_id = pn.id)
    ORDER BY p.created_at
    LIMIT greatest(least(p_limit, 50), 1)
    FOR UPDATE OF p SKIP LOCKED
  )
  AND n.id = t.connection_id
  RETURNING t.id, t.organization_id, t.kind::text, t.manager_external_id,
            t.target_external_id, n.platform::text, n.id,
            EXISTS (SELECT 1 FROM integrations.connection_tokens k WHERE k.connection_id = n.id),
            NULL::text, NULL::text;
$$;

COMMENT ON FUNCTION automation.task_queue IS
  'Entrega ao n8n as intenções pendentes, nunca o segredo nem ponteiro de credencial (ADR 0032). Só reivindica tarefa de conexão ativa e com token no cofre: a de conexão a reautorizar fica pendente (sem gastar tentativa) até a reautorização. O executor genérico pede o access token com o task_id. credential_ref e executor_ref saem sempre nulos (compatibilidade da imagem anterior durante o deploy; somem com db/pendentes/0123).';

CREATE OR REPLACE FUNCTION automation.tarefas_esperando_reautorizacao()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT count(*)::integer
  FROM automation.account_tasks t
  JOIN integrations.connections n ON n.id = t.connection_id
  WHERE t.status = 'pending' AND t.attempts < 3
    AND (n.status NOT IN ('active', 'expiring')
         OR NOT EXISTS (SELECT 1 FROM integrations.connection_tokens k WHERE k.connection_id = n.id));
$$;

COMMENT ON FUNCTION automation.tarefas_esperando_reautorizacao IS
  'Quantas tarefas de conta a fila pulou porque a conexão está sem token ou a reautorizar (ADR 0032). Só contagem, sem ponteiro.';

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
  credential_ref    text,
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
    NULL::text,
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
  'Fila legada de sincronização. Devolve apenas metadados, nunca segredo (ADR 0032): tem_token diz se a conexão tem segredo no cofre; credential_ref sai sempre nulo e some com db/pendentes/0123.';

DO $$
DECLARE
  papel_app text := (SELECT rolname FROM pg_roles WHERE rolname IN ('orla_app', 'tria_app') ORDER BY rolname = 'orla_app' DESC LIMIT 1);
  papel_worker text := (SELECT rolname FROM pg_roles WHERE rolname = 'orla_worker');
  funcao text;
BEGIN
  FOREACH funcao IN ARRAY ARRAY[
    'automation.fontes_de_coleta(integer)',
    'automation.task_queue(integer, text[])',
    'automation.sync_queue(integer, integer, interval)',
    'automation.tarefas_esperando_reautorizacao()',
    'integrations.resolver_conexao_do_token(uuid, uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', funcao);
    IF papel_app IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', funcao, papel_app);
    END IF;
    IF papel_worker IS NOT NULL THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I', funcao, papel_worker);
    ELSE
      RAISE WARNING 'papel orla_worker ausente: % fica sem executor até a 0070 rodar', funcao;
    END IF;
  END LOOP;
END $$;

COMMIT;
