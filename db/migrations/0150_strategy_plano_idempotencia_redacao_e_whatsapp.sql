BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF to_regprocedure('core.redigir_plano(uuid,text)') IS NULL OR to_regprocedure('core.client_landing_page_escrita()') IS NULL THEN
    RAISE EXCEPTION 'core.redigir_plano ou core.client_landing_page_escrita ausente; as migracoes 0145 e 0148 precisam ter rodado';
  END IF;
END $$;

ALTER TABLE core.strategy_plans ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE core.strategy_plans DROP CONSTRAINT IF EXISTS strategy_plans_idempotency_key_formato;
ALTER TABLE core.strategy_plans ADD CONSTRAINT strategy_plans_idempotency_key_formato
  CHECK (idempotency_key IS NULL OR idempotency_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
CREATE UNIQUE INDEX IF NOT EXISTS strategy_plans_idempotencia
  ON core.strategy_plans (organization_id, client_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN core.strategy_plans.idempotency_key IS
  'Nonce do formulario de novo plano (uuid), unico por organizacao e cliente quando preenchido: o reenvio do mesmo formulario (duplo clique) devolve o plano ja criado em vez de criar outro. NULL em planos sem formulario.';

CREATE OR REPLACE FUNCTION core.strategy_plan_plano_imutavel()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT core.decisao_chamador_e_app()
     AND current_setting('orla.redigindo_plano', true) = OLD.id::text
     AND NEW.whatsapp IS NULL
     AND (NEW.id, NEW.organization_id, NEW.client_id, NEW.plan_type_key, NEW.created_at, NEW.plataformas, NEW.landing_page_id, NEW.idempotency_key)
         IS NOT DISTINCT FROM
         (OLD.id, OLD.organization_id, OLD.client_id, OLD.plan_type_key, OLD.created_at, OLD.plataformas, OLD.landing_page_id, OLD.idempotency_key) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'registro do Strategy Plan é imutável' USING ERRCODE = 'restrict_violation';
END;
$$;

COMMENT ON FUNCTION core.strategy_plan_plano_imutavel IS
  'BEFORE UPDATE de core.strategy_plans: nega sempre, exceto anular whatsapp (dado de contato) dentro de core.redigir_plano, que marca orla.redigindo_plano com o id do plano, local à transação; qualquer outra coluna diferente, ou o app, é negado.';

DROP TRIGGER IF EXISTS strategy_plans_imutavel ON core.strategy_plans;
CREATE TRIGGER strategy_plans_imutavel BEFORE UPDATE ON core.strategy_plans
  FOR EACH ROW EXECUTE FUNCTION core.strategy_plan_plano_imutavel();

CREATE OR REPLACE FUNCTION core.redigir_plano(p_versao uuid, p_motivo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_ver   core.strategy_plan_versions;
  v_atual core.strategy_plan_versions;
  v_id    uuid;
BEGIN
  IF p_motivo IS NULL OR length(btrim(p_motivo)) < 3 OR length(p_motivo) > 500 THEN
    RAISE EXCEPTION 'motivo da redação obrigatório (3 a 500 caracteres)' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_ver FROM core.strategy_plan_versions WHERE id = p_versao;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'versão inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('orla:strategy_plan'), hashtext(v_ver.client_id::text));

  FOR v_id IN
    SELECT d.id FROM core.strategy_plan_versions d
     WHERE d.plan_id = v_ver.plan_id AND d.organization_id = v_ver.organization_id AND d.client_id = v_ver.client_id
     ORDER BY d.created_at, d.id
  LOOP
    SELECT * INTO v_atual FROM core.strategy_plan_versions WHERE id = v_id FOR UPDATE;

    IF v_atual.redacted_at IS NULL THEN
      INSERT INTO core.strategy_plan_events
        (organization_id, client_id, version_id, kind, actor_kind, payload, request_id)
      VALUES (v_ver.organization_id, v_ver.client_id, v_id, 'redigida', 'sistema', jsonb_build_object('motivo', p_motivo),
              left(nullif(current_setting('app.request_id', true), ''), 120));
      PERFORM set_config('orla.redigindo_plano', v_id::text, true);
      UPDATE core.strategy_plan_versions
         SET content = '{"redigido": true}'::jsonb, redacted_at = now()
       WHERE id = v_id;
    END IF;

    PERFORM set_config('orla.redigindo_plano', v_id::text, true);
    UPDATE core.strategy_plan_events
       SET payload = '{"redigido": true}'::jsonb
     WHERE version_id = v_id AND kind <> 'redigida' AND payload <> '{"redigido": true}'::jsonb;
    PERFORM set_config('orla.redigindo_plano', '', true);
  END LOOP;

  PERFORM set_config('orla.redigindo_plano', v_ver.plan_id::text, true);
  UPDATE core.strategy_plans SET whatsapp = NULL
   WHERE id = v_ver.plan_id AND organization_id = v_ver.organization_id AND client_id = v_ver.client_id AND whatsapp IS NOT NULL;
  PERFORM set_config('orla.redigindo_plano', '', true);
END;
$$;

COMMENT ON FUNCTION core.redigir_plano IS
  'Redação LGPD do Strategy Plan (ADR 0056 §10, molde de core.redigir_decisao): redige a versão e todas as versões do mesmo plano (plan_id), com ou sem supersedes_id. Em cada versão ainda não redigida troca content por {"redigido": true}, marca redacted_at e grava um evento redigida (com o motivo) como auditoria; em TODAS as versões do plano, inclusive as já redigidas, troca por {"redigido": true} o payload de qualquer evento ainda não redigido (evento gravado depois da redação); anula core.strategy_plans.whatsapp do plano (única coluna do plano que a redação toca, via orla.redigindo_plano com o id do plano). Idempotente: sem versão nova a redigir, não grava evento redigida. Só o worker executa; o app não tem EXECUTE.';

CREATE OR REPLACE FUNCTION core.client_whatsapp_escrita()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_usuario uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.whatsapp IS NOT DISTINCT FROM OLD.whatsapp THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.whatsapp IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT core.decisao_chamador_e_app() THEN
    RETURN NEW;
  END IF;
  v_usuario := nullif(current_setting('app.user_id', true), '')::uuid;
  IF v_usuario IS NULL THEN
    RAISE EXCEPTION 'gravar o WhatsApp do cliente exige usuário na sessão' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.organization_id IS DISTINCT FROM core.current_organization() OR NOT EXISTS (
       SELECT 1 FROM core.memberships_of(v_usuario) m
        WHERE m.organization_id = NEW.organization_id AND m.role IN ('owner', 'admin', 'operator')) THEN
    RAISE EXCEPTION 'gravar o WhatsApp do cliente exige papel owner, admin ou operator' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION core.client_whatsapp_escrita IS
  'BEFORE INSERT OR UPDATE OF whatsapp de core.clients, sem SECURITY DEFINER, no molde de core.client_landing_page_escrita. Só age quando o valor muda (ou nasce preenchido) e só para o app: exige app.user_id com papel owner, admin ou operator na organização da sessão (core.memberships_of); viewer é negado. Worker e superusuário não são afetados.';

DROP TRIGGER IF EXISTS clients_whatsapp_escrita ON core.clients;
CREATE TRIGGER clients_whatsapp_escrita BEFORE INSERT OR UPDATE OF whatsapp ON core.clients
  FOR EACH ROW EXECUTE FUNCTION core.client_whatsapp_escrita();

COMMIT;
