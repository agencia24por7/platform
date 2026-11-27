BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF to_regclass('core.strategy_plan_runs') IS NULL OR to_regclass('core.strategy_plan_events') IS NULL THEN
    RAISE EXCEPTION 'tabelas do Strategy Plan ausentes; as migracoes 0143 a 0148 precisam ter rodado';
  END IF;
END $$;

ALTER TABLE core.strategy_plan_events DROP CONSTRAINT IF EXISTS strategy_plan_events_kind_check;
ALTER TABLE core.strategy_plan_events ADD CONSTRAINT strategy_plan_events_kind_check
  CHECK (kind IN
    ('proposta', 'parecer', 'ajuste', 'gate', 'veredito_juiz', 'cancelada', 'efetivada', 'rejeitada', 'revogada', 'revisao_aberta', 'impacto_anotado', 'redigida'));

CREATE UNIQUE INDEX IF NOT EXISTS strategy_plan_events_um_veredito
  ON core.strategy_plan_events (version_id) WHERE kind = 'veredito_juiz';

CREATE OR REPLACE FUNCTION core.strategy_plan_evento_juiz()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_status text;
  v_ruim   integer;
BEGIN
  IF NEW.kind <> 'veredito_juiz' THEN
    RETURN NEW;
  END IF;
  IF NEW.actor_kind <> 'agente' THEN
    RAISE EXCEPTION 'veredito do juiz só pela credencial do worker (ator agente)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF jsonb_typeof(NEW.payload->'vereditos') IS DISTINCT FROM 'array'
     OR jsonb_array_length(NEW.payload->'vereditos') NOT BETWEEN 1 AND 45 THEN
    RAISE EXCEPTION 'veredito do juiz exige payload.vereditos (lista de 1 a 45 itens)' USING ERRCODE = 'check_violation';
  END IF;
  SELECT count(*) INTO v_ruim
    FROM jsonb_array_elements(NEW.payload->'vereditos') AS item
   WHERE jsonb_typeof(item) IS DISTINCT FROM 'object'
      OR jsonb_typeof(item->'persona') IS DISTINCT FROM 'string'
      OR item->>'persona' !~ '^[a-z][a-z0-9_]{1,47}$'
      OR jsonb_typeof(item->'pontoId') IS DISTINCT FROM 'string'
      OR item->>'veredito' NOT IN ('aceito', 'rejeitado')
      OR jsonb_typeof(item->'motivo') IS DISTINCT FROM 'string'
      OR length(item->>'motivo') NOT BETWEEN 1 AND 160
      OR jsonb_typeof(item->'prova') IS DISTINCT FROM 'array';
  IF v_ruim > 0 THEN
    RAISE EXCEPTION 'veredito do juiz com item fora do formato (persona, pontoId, veredito, motivo, prova)' USING ERRCODE = 'check_violation';
  END IF;
  SELECT status INTO v_status FROM core.strategy_plan_versions
   WHERE id = NEW.version_id AND organization_id = NEW.organization_id AND client_id = NEW.client_id;
  IF v_status IS DISTINCT FROM 'rascunho' THEN
    RAISE EXCEPTION 'parecer, ajuste, gate e veredito do juiz só valem em versão rascunho (está %)', coalesce(v_status, 'inexistente') USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION core.strategy_plan_evento_juiz IS
  'BEFORE INSERT de core.strategy_plan_events (ADR 0065 §6, juiz do Comitê): o veredito do juiz é evento imutável, só com ator agente (credencial do worker; a escrita de agente já exige execução ativa e ficha em strategy_plan_agente_com_execucao), só em versão rascunho, um por versão (índice strategy_plan_events_um_veredito) e com payload.vereditos de 1 a 45 itens { persona, pontoId, veredito aceito|rejeitado, motivo de 1 a 160 caracteres, prova (lista) }. Não muda status da versão.';

DROP TRIGGER IF EXISTS strategy_plan_events_juiz ON core.strategy_plan_events;
CREATE TRIGGER strategy_plan_events_juiz BEFORE INSERT ON core.strategy_plan_events
  FOR EACH ROW EXECUTE FUNCTION core.strategy_plan_evento_juiz();

ALTER TABLE core.strategy_plan_runs DROP CONSTRAINT IF EXISTS strategy_plan_runs_kind_check;
ALTER TABLE core.strategy_plan_runs ADD CONSTRAINT strategy_plan_runs_kind_check
  CHECK (kind IN ('criar', 'ajustar', 'revisar', 'corrigir_gate'));

ALTER TABLE core.strategy_plan_runs DROP CONSTRAINT IF EXISTS strategy_plan_runs_check;
ALTER TABLE core.strategy_plan_runs DROP CONSTRAINT IF EXISTS strategy_plan_runs_pedido_check;
ALTER TABLE core.strategy_plan_runs ADD CONSTRAINT strategy_plan_runs_pedido_check
  CHECK (
    jsonb_typeof(pedido) = 'object' AND pg_column_size(pedido) <= 8192
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

ALTER TABLE core.strategy_plan_runs DROP CONSTRAINT IF EXISTS strategy_plan_runs_erro_codigo_check;
ALTER TABLE core.strategy_plan_runs ADD CONSTRAINT strategy_plan_runs_erro_codigo_check
  CHECK (erro_codigo IS NULL OR erro_codigo IN
    ('ia_nao_configurada', 'ia_limite', 'ia_saida_invalida', 'ia_falha', 'ia_tempo', 'brain_indisponivel', 'gate_reprovado', 'correcao_nao_convergiu', 'interno'));

COMMENT ON COLUMN core.strategy_plan_runs.kind IS
  'criar: pedido é a intenção validada pelo esquema do domínio; ajustar: pedido é {instrucao}; revisar: pedido é {motivo}; corrigir_gate: pedido é {} e a versão base é o rascunho cujo Gate mais recente reprovou.';

CREATE OR REPLACE FUNCTION core.strategy_plan_run_corrigir_gate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_status    text;
  v_gate      text;
  v_atual     uuid;
  v_prox      uuid;
  v_run       text;
  v_total     integer := 0;
  v_saltos    integer := 0;
  v_visitadas uuid[] := ARRAY[]::uuid[];
BEGIN
  IF NEW.kind <> 'corrigir_gate' THEN
    RETURN NEW;
  END IF;
  IF NEW.base_version_id IS NULL THEN
    RAISE EXCEPTION 'corrigir_gate exige a versão base' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('orla:strategy_plan'), hashtext(NEW.client_id::text));

  SELECT status INTO v_status FROM core.strategy_plan_versions
   WHERE id = NEW.base_version_id AND plan_id = NEW.plan_id AND organization_id = NEW.organization_id AND client_id = NEW.client_id;
  IF v_status IS DISTINCT FROM 'rascunho' THEN
    RAISE EXCEPTION 'corrigir_gate só vale sobre versão rascunho (está %)', coalesce(v_status, 'inexistente') USING ERRCODE = 'check_violation';
  END IF;
  SELECT payload->>'resultado' INTO v_gate FROM core.strategy_plan_events
   WHERE version_id = NEW.base_version_id AND kind = 'gate'
   ORDER BY created_at DESC, id DESC LIMIT 1;
  IF v_gate IS DISTINCT FROM 'reprovado' THEN
    RAISE EXCEPTION 'corrigir_gate exige que o Gate mais recente da versão base tenha reprovado' USING ERRCODE = 'check_violation';
  END IF;

  v_atual := NEW.base_version_id;
  LOOP
    v_visitadas := array_append(v_visitadas, v_atual);
    SELECT v_total + count(*) INTO v_total FROM core.strategy_plan_runs r
     WHERE r.plan_id = NEW.plan_id AND r.organization_id = NEW.organization_id AND r.kind = 'corrigir_gate'
       AND r.base_version_id = v_atual AND (r.status <> 'cancelada' OR r.tentativas > 0);
    SELECT agent_run_id INTO v_run FROM core.strategy_plan_versions WHERE id = v_atual AND plan_id = NEW.plan_id;
    v_prox := NULL;
    IF v_run IS NOT NULL THEN
      SELECT r.base_version_id INTO v_prox FROM core.strategy_plan_runs r
       WHERE r.agent_run_id = v_run AND r.plan_id = NEW.plan_id AND r.kind = 'corrigir_gate';
    END IF;
    v_saltos := v_saltos + 1;
    EXIT WHEN v_prox IS NULL OR v_prox = ANY(v_visitadas) OR v_saltos >= 10;
    v_atual := v_prox;
  END LOOP;

  IF v_total >= 2 THEN
    RAISE EXCEPTION 'limite de 2 correções do Gate por versão-raiz atingido' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION core.strategy_plan_run_corrigir_gate IS
  'BEFORE INSERT de core.strategy_plan_runs (depois de strategy_plan_runs_b_insercao, sem DEFINER): execução corrigir_gate exige base rascunho do mesmo plano cujo Gate mais recente reprovou, e no máximo 2 correções por versão-raiz: conta as execuções corrigir_gate (menos as canceladas antes de começar) com a versão base na linhagem, subindo pela execução que criou cada base (agent_run_id), em até 10 saltos. Sob a trava consultiva do cliente. Espelha correcoesNaLinhagem do domínio.';

DROP TRIGGER IF EXISTS strategy_plan_runs_c_corrigir_gate ON core.strategy_plan_runs;
CREATE TRIGGER strategy_plan_runs_c_corrigir_gate BEFORE INSERT ON core.strategy_plan_runs
  FOR EACH ROW EXECUTE FUNCTION core.strategy_plan_run_corrigir_gate();

COMMIT;
