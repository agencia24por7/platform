BEGIN;

CREATE TYPE automation.task_kind AS ENUM ('mcc_invite');
CREATE TYPE automation.task_status AS ENUM ('pending', 'running', 'done', 'failed');

CREATE TABLE automation.account_tasks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES core.organizations(id) ON DELETE RESTRICT,
  connection_id    uuid NOT NULL REFERENCES integrations.connections(id) ON DELETE RESTRICT,
  kind             automation.task_kind NOT NULL,
  manager_external_id text NOT NULL CHECK (length(manager_external_id) BETWEEN 1 AND 64),
  target_external_id  text NOT NULL CHECK (length(target_external_id) BETWEEN 1 AND 64),
  status           automation.task_status NOT NULL DEFAULT 'pending',
  requested_by     uuid REFERENCES core.users(id) ON DELETE RESTRICT,
  outcome          text CHECK (outcome IS NULL OR length(outcome) <= 500),
  attempts         integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tasks_unique_pending UNIQUE (connection_id, kind, target_external_id)
);

COMMENT ON TABLE automation.account_tasks IS
  'Intenções que o app registra e o n8n executa. O app não tem credencial de plataforma: ele pede, o plano de execução faz.';

CREATE INDEX account_tasks_pendentes ON automation.account_tasks (status, created_at)
  WHERE status = 'pending';

CREATE TRIGGER account_tasks_touch BEFORE UPDATE ON automation.account_tasks
  FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();

GRANT SELECT, INSERT, UPDATE ON automation.account_tasks TO tria_app;

ALTER TABLE automation.account_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation.account_tasks FORCE ROW LEVEL SECURITY;

CREATE POLICY account_tasks_tenant ON automation.account_tasks FOR ALL TO tria_app
  USING (organization_id = core.current_organization())
  WITH CHECK (organization_id = core.current_organization());

CREATE OR REPLACE FUNCTION automation.task_queue(p_limit integer DEFAULT 10)
RETURNS TABLE (
  task_id           uuid,
  organization_id   uuid,
  kind              text,
  manager_external_id text,
  target_external_id  text,
  credential_ref    text,
  platform          text
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
    ORDER BY created_at
    LIMIT greatest(least(p_limit, 50), 1)
    FOR UPDATE SKIP LOCKED
  )
  AND n.id = t.connection_id
  RETURNING t.id, t.organization_id, t.kind::text, t.manager_external_id,
            t.target_external_id, n.credential_ref, n.platform::text;
$$;

COMMENT ON FUNCTION automation.task_queue IS
  'Entrega ao n8n as intenções pendentes com o ponteiro da credencial, nunca o segredo.';

CREATE OR REPLACE FUNCTION automation.task_result(
  p_task_id uuid,
  p_sucesso boolean,
  p_outcome text
)
RETURNS automation.task_status
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
VOLATILE
AS $$
  UPDATE automation.account_tasks
  SET status = CASE WHEN p_sucesso THEN 'done'::automation.task_status
                    ELSE 'failed'::automation.task_status END,
      outcome = left(p_outcome, 500)
  WHERE id = p_task_id
  RETURNING status;
$$;

REVOKE ALL ON FUNCTION automation.task_queue(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION automation.task_result(uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION automation.task_queue(integer) TO tria_app;
GRANT EXECUTE ON FUNCTION automation.task_result(uuid, boolean, text) TO tria_app;

COMMIT;
