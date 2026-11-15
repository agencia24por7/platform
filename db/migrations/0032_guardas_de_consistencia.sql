BEGIN;

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
  WHERE id = p_task_id AND status = 'running'
  RETURNING status;
$$;

COMMENT ON FUNCTION automation.task_result IS
  'Só aceita resultado de tarefa que ainda está rodando — mesmo padrão fail-closed de complete_invite_item. Um resultado duplicado ou atrasado do n8n devolve NULL em vez de flipar uma tarefa já concluída.';

CREATE FUNCTION core.sessao_alcanca_organizacao(p_organization_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT core.is_member(p_organization_id, p_user_id)
      OR NOT EXISTS (SELECT 1 FROM core.members m WHERE m.organization_id = p_organization_id);
$$;

COMMENT ON FUNCTION core.sessao_alcanca_organizacao IS
  'Cinto de segurança do withTenant: uma sessão só abre contexto de organização onde tem vínculo vivo — ou que ainda não foi reivindicada por ninguém (o primeiro acesso cria a organização no meio do OAuth e só vira membro no fim). Antes disso, a fronteira de tenant dependia de nenhum caller jamais passar um organizationId vindo do usuário; agora um caller errado quebra alto em vez de ler outro inquilino.';

REVOKE ALL ON FUNCTION core.sessao_alcanca_organizacao(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.sessao_alcanca_organizacao(uuid, uuid) TO tria_app;

COMMIT;
