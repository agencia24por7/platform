BEGIN;

DO $$
BEGIN
  PERFORM set_config(
    'coleta.papel_app',
    (SELECT rolname FROM pg_roles WHERE rolname IN ('orla_app', 'tria_app') ORDER BY rolname = 'orla_app' DESC LIMIT 1),
    true
  );
END $$;

ALTER TABLE integrations.connections ADD COLUMN IF NOT EXISTS executor_ref text;

COMMENT ON COLUMN integrations.connections.executor_ref IS
  'Workflow do n8n que executa tarefas de conta (convite e aceite na MCC) com a credencial desta conexão. O nó HTTP do n8n não escolhe credencial por item, então cada conexão tem o seu executor, no mesmo molde de coletor_ref.';

DROP FUNCTION IF EXISTS automation.task_queue(integer);

CREATE FUNCTION automation.task_queue(p_limit integer DEFAULT 10, p_kinds text[] DEFAULT NULL)
RETURNS TABLE (
  task_id             uuid,
  organization_id     uuid,
  kind                text,
  manager_external_id text,
  target_external_id  text,
  credential_ref      text,
  platform            text,
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
    SELECT id FROM automation.account_tasks
    WHERE status = 'pending' AND attempts < 3
      AND (p_kinds IS NULL OR kind::text = ANY (p_kinds))
    ORDER BY created_at
    LIMIT greatest(least(p_limit, 50), 1)
    FOR UPDATE SKIP LOCKED
  )
  AND n.id = t.connection_id
  RETURNING t.id, t.organization_id, t.kind::text, t.manager_external_id,
            t.target_external_id, n.credential_ref, n.platform::text, n.executor_ref;
$$;

COMMENT ON FUNCTION automation.task_queue IS
  'Entrega ao n8n as intenções pendentes com o ponteiro da credencial e do executor, nunca o segredo. p_kinds restringe os tipos: cada executor só reivindica o que sabe fazer, para não consumir (e falhar) tarefas de outra plataforma.';

REVOKE ALL ON FUNCTION automation.task_queue(integer, text[]) FROM PUBLIC;
DO $$ BEGIN
  EXECUTE format('GRANT EXECUTE ON FUNCTION automation.task_queue(integer, text[]) TO %I', current_setting('coleta.papel_app'));
END $$;

COMMIT;
