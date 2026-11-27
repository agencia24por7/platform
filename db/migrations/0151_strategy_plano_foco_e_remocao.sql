BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  PERFORM set_config(
    'contexto.papel_app',
    (SELECT rolname FROM pg_roles WHERE rolname IN ('orla_app', 'tria_app') ORDER BY rolname = 'orla_app' DESC LIMIT 1),
    true
  );
  IF current_setting('contexto.papel_app') = '' THEN
    RAISE EXCEPTION 'papel do app ausente; as migracoes 0070 e anteriores precisam ter rodado';
  END IF;
  IF to_regprocedure('core.strategy_plan_plano_imutavel()') IS NULL
     OR to_regprocedure('core.strategy_runs_pendentes(integer)') IS NULL
     OR to_regprocedure('core.memberships_of(uuid)') IS NULL THEN
    RAISE EXCEPTION 'funcoes do Strategy Plan ausentes; as migracoes 0143 a 0150 precisam ter rodado';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION core.strategy_plan_foco_valido(p_foco jsonb, p_organizacao uuid, p_cliente uuid)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce(CASE
    WHEN p_foco IS NULL THEN true
    WHEN jsonb_typeof(p_foco) <> 'object' OR pg_column_size(p_foco) > 12288 THEN false
    WHEN p_foco->>'tipo' = 'marca' THEN p_foco = '{"tipo": "marca"}'::jsonb
    WHEN p_foco->>'tipo' = 'produtos' THEN
      (p_foco - 'tipo' - 'produtos') = '{}'::jsonb
      AND jsonb_typeof(p_foco->'produtos') = 'array'
      AND jsonb_array_length(p_foco->'produtos') BETWEEN 1 AND 20
      AND (SELECT count(DISTINCT p->>'urn') = jsonb_array_length(p_foco->'produtos')
             AND bool_and(coalesce(
               jsonb_typeof(p) = 'object'
               AND (p - 'urn' - 'rotulo' - 'hash') = '{}'::jsonb
               AND jsonb_typeof(p->'urn') = 'string'
               AND (p->>'urn') LIKE 'orla:' || p_organizacao::text || ':' || p_cliente::text || ':contexto\_produto:%'
               AND length(p->>'urn') <= 320
               AND jsonb_typeof(p->'rotulo') = 'string'
               AND length(btrim(p->>'rotulo')) BETWEEN 1 AND 120
               AND jsonb_typeof(p->'hash') = 'string'
               AND (p->>'hash') ~ '^[0-9a-f]{64}$', false))
            FROM jsonb_array_elements(p_foco->'produtos') AS p)
    ELSE false
  END, false)
$$;

COMMENT ON FUNCTION core.strategy_plan_foco_valido IS
  'Formato de core.strategy_plans.foco (ADR 0070): NULL, {"tipo":"marca"} ou {"tipo":"produtos","produtos":[{urn,rotulo,hash}]} com 1 a 20 produtos distintos, cada urn do tipo contexto_produto da mesma organizacao e cliente do plano, rotulo de 1 a 120 caracteres e hash sha-256 em hex. Total de ate 12 KB. Usada no CHECK strategy_plans_foco_formato.';

ALTER TABLE core.strategy_plans ADD COLUMN IF NOT EXISTS foco jsonb;
ALTER TABLE core.strategy_plans ADD COLUMN IF NOT EXISTS removido_em timestamptz;
ALTER TABLE core.strategy_plans ADD COLUMN IF NOT EXISTS removido_por uuid REFERENCES core.users(id) ON DELETE SET NULL;

ALTER TABLE core.strategy_plans DROP CONSTRAINT IF EXISTS strategy_plans_foco_formato;
ALTER TABLE core.strategy_plans ADD CONSTRAINT strategy_plans_foco_formato
  CHECK (core.strategy_plan_foco_valido(foco, organization_id, client_id));
ALTER TABLE core.strategy_plans DROP CONSTRAINT IF EXISTS strategy_plans_removido_coerente;
ALTER TABLE core.strategy_plans ADD CONSTRAINT strategy_plans_removido_coerente
  CHECK (removido_por IS NULL OR removido_em IS NOT NULL);

CREATE INDEX IF NOT EXISTS strategy_plans_ativos ON core.strategy_plans (client_id, created_at DESC) WHERE removido_em IS NULL;

COMMENT ON COLUMN core.strategy_plans.foco IS
  'Foco do plano (ADR 0070): {"tipo":"marca"} ou {"tipo":"produtos","produtos":[{urn,rotulo,hash}]}, de 1 a 20 produtos do Contexto do cliente (secao Produtos e servicos). Imutavel. NULL so em planos anteriores a 0151; plano novo sempre preenche, imposto no servico.';
COMMENT ON COLUMN core.strategy_plans.removido_em IS
  'Remocao logica do plano (ADR 0070): NULL = ativo. A unica mudanca que o app faz numa linha de core.strategy_plans, uma vez, de NULL para um valor fixado em now() pelo gatilho, so por owner ou admin. Nunca volta a NULL. Versoes, eventos, execucoes e auditoria ficam intactos.';
COMMENT ON COLUMN core.strategy_plans.removido_por IS
  'Usuario que removeu (app.user_id da sessao, fixado pelo gatilho). Vira NULL se o usuario for apagado.';

DO $$
DECLARE
  papel text := current_setting('contexto.papel_app');
  condicao text := 'organization_id = core.current_organization() AND core.cliente_no_escopo(client_id)
                AND EXISTS (SELECT 1 FROM core.clients c WHERE c.id = strategy_plans.client_id)';
BEGIN
  DROP POLICY IF EXISTS strategy_plans_remocao ON core.strategy_plans;
  EXECUTE format('CREATE POLICY strategy_plans_remocao ON core.strategy_plans FOR UPDATE TO %I USING (%s) WITH CHECK (%s)', papel, condicao, condicao);
  EXECUTE format('GRANT UPDATE (removido_em, removido_por) ON core.strategy_plans TO %I', papel);
END $$;

CREATE OR REPLACE FUNCTION core.strategy_plan_plano_imutavel()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_usuario uuid;
BEGIN
  IF NOT core.decisao_chamador_e_app()
     AND current_setting('orla.redigindo_plano', true) = OLD.id::text
     AND NEW.whatsapp IS NULL
     AND (NEW.id, NEW.organization_id, NEW.client_id, NEW.plan_type_key, NEW.created_at, NEW.plataformas, NEW.landing_page_id, NEW.idempotency_key, NEW.foco, NEW.removido_em, NEW.removido_por)
         IS NOT DISTINCT FROM
         (OLD.id, OLD.organization_id, OLD.client_id, OLD.plan_type_key, OLD.created_at, OLD.plataformas, OLD.landing_page_id, OLD.idempotency_key, OLD.foco, OLD.removido_em, OLD.removido_por) THEN
    RETURN NEW;
  END IF;

  IF core.decisao_chamador_e_app() AND OLD.removido_em IS NULL AND NEW.removido_em IS NOT NULL THEN
    v_usuario := nullif(current_setting('app.user_id', true), '')::uuid;
    IF v_usuario IS NULL
       OR OLD.organization_id IS DISTINCT FROM core.current_organization()
       OR NOT EXISTS (
         SELECT 1 FROM core.memberships_of(v_usuario) m
          WHERE m.organization_id = OLD.organization_id AND m.role IN ('owner', 'admin')) THEN
      RAISE EXCEPTION 'apagar plano exige papel owner ou admin' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF (NEW.id, NEW.organization_id, NEW.client_id, NEW.plan_type_key, NEW.created_at, NEW.plataformas, NEW.whatsapp, NEW.landing_page_id, NEW.idempotency_key, NEW.foco)
       IS DISTINCT FROM
       (OLD.id, OLD.organization_id, OLD.client_id, OLD.plan_type_key, OLD.created_at, OLD.plataformas, OLD.whatsapp, OLD.landing_page_id, OLD.idempotency_key, OLD.foco) THEN
      RAISE EXCEPTION 'apagar plano não altera outras colunas' USING ERRCODE = 'restrict_violation';
    END IF;
    NEW.removido_em := now();
    NEW.removido_por := v_usuario;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'registro do Strategy Plan é imutável' USING ERRCODE = 'restrict_violation';
END;
$$;

COMMENT ON FUNCTION core.strategy_plan_plano_imutavel IS
  'BEFORE UPDATE de core.strategy_plans: nega sempre, com duas excecoes. (1) Anular whatsapp dentro de core.redigir_plano (marca orla.redigindo_plano com o id do plano, local a transacao; qualquer outra coluna diferente e negada). (2) Remocao logica pelo app: removido_em de NULL para um valor, uma vez, nunca o inverso, so com app.user_id de owner ou admin da organizacao da sessao (core.memberships_of) e sem mudar nenhuma outra coluna; o gatilho fixa removido_em em now() e removido_por no usuario da sessao.';

ALTER TABLE core.strategy_plan_runs DROP CONSTRAINT IF EXISTS strategy_plan_runs_pedido_check;
ALTER TABLE core.strategy_plan_runs ADD CONSTRAINT strategy_plan_runs_pedido_check
  CHECK (
    jsonb_typeof(pedido) = 'object' AND pg_column_size(pedido) <= 16384
    AND (
      pedido = '{"redigido": true}'::jsonb
      OR kind = 'criar'
      OR (kind = 'ajustar'
          AND jsonb_typeof(pedido->'instrucao') = 'string'
          AND length(pedido->>'instrucao') BETWEEN 1 AND 2000
          AND (pedido - 'instrucao') = '{}'::jsonb)
      OR (kind = 'revisar'
          AND jsonb_typeof(pedido->'motivo') = 'string'
          AND pedido->>'motivo' IN ('edicao_manual', 'brain_mudou')
          AND (pedido - 'motivo') = '{}'::jsonb)
      OR (kind = 'corrigir_gate' AND pedido = '{}'::jsonb)));

COMMENT ON COLUMN core.strategy_plan_runs.pedido IS
  'Ate 16 KB (o foco do plano com ate 20 produtos entra na intencao de criar; era 8 KB ate a 0151). Contem texto livre da pessoa (objetivo da intencao ou instrucao de ajuste), por isso a redacao de qualquer versao do plano o troca por {"redigido": true}. Nunca vai para auditoria nem para log.';

CREATE OR REPLACE FUNCTION core.strategy_runs_pendentes(p_limite integer)
RETURNS TABLE (organization_id uuid, client_id uuid, id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT r.organization_id, r.client_id, r.id
    FROM core.strategy_plan_runs r
   WHERE (r.status = 'pendente' OR (r.status = 'rodando' AND r.lease_until IS NOT NULL AND r.lease_until < now()))
     AND r.tentativas <= 20
     AND EXISTS (SELECT 1 FROM core.clients c WHERE c.id = r.client_id AND c.excluido_em IS NULL)
     AND EXISTS (SELECT 1 FROM core.strategy_plans p WHERE p.id = r.plan_id AND p.removido_em IS NULL)
   ORDER BY r.created_at, r.id
   LIMIT greatest(least(coalesce(p_limite, 0), 50), 0)
$$;

COMMENT ON FUNCTION core.strategy_runs_pendentes IS
  'Descoberta de trabalho do worker entre inquilinos (molde de core.brain_resolver_cliente): devolve so (organization_id, client_id, id) das execucoes pendentes, ou rodando com lease vencido, de clientes nao excluidos e de planos nao removidos (0151, ADR 0070), mais antigas primeiro, no maximo least(p_limite, 50), e so as que ainda nao passaram do teto de reservas (tentativas ate 20). Nenhum conteudo. SECURITY DEFINER para atravessar a RLS; EXECUTE so do papel do worker, nunca do app.';

COMMENT ON TABLE core.strategy_plans IS
  'Identidade estavel do plano por cliente (ADR 0056 §2 e §9). Planos do mesmo tipo sao independentes: o mesmo cliente pode ter varios (24K-132). Imutavel, com uma unica excecao do app: a remocao logica (removido_em, 0151). O app tem SELECT, INSERT e UPDATE de removido_em e removido_por; o gatilho nega DELETE e qualquer outro UPDATE. O conteudo vive em core.strategy_plan_versions. Some com o cliente no expurgo (ON DELETE CASCADE).';

COMMIT;
