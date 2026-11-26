BEGIN;

SET LOCAL lock_timeout = '5s';
DO $$
BEGIN
  PERFORM set_config(
    'contexto.papel_app',
    (SELECT rolname FROM pg_roles WHERE rolname IN ('orla_app', 'tria_app') ORDER BY rolname = 'orla_app' DESC LIMIT 1),
    true
  );
  PERFORM set_config(
    'contexto.papel_worker',
    (SELECT rolname FROM pg_roles WHERE rolname IN ('orla_worker', 'tria_worker') ORDER BY rolname = 'orla_worker' DESC LIMIT 1),
    true
  );
  IF current_setting('contexto.papel_app') = '' OR current_setting('contexto.papel_worker') = '' THEN
    RAISE EXCEPTION 'papeis do app e do worker ausentes; as migracoes 0070 e anteriores precisam ter rodado';
  END IF;
  IF to_regprocedure('core.decisao_chamador_e_worker()') IS NULL THEN
    RAISE EXCEPTION 'core.decisao_chamador_e_worker ausente; a migracao 0141 precisa ter rodado';
  END IF;
  IF to_regprocedure('core.decisao_chamador_e_app()') IS NULL THEN
    RAISE EXCEPTION 'core.decisao_chamador_e_app ausente; a migracao 0141 precisa ter rodado';
  END IF;
END $$;

DROP TRIGGER IF EXISTS strategy_plan_versions_depois ON core.strategy_plan_versions;
DROP FUNCTION IF EXISTS core.strategy_plan_versao_depois();

ALTER TABLE core.strategy_plan_versions DROP CONSTRAINT IF EXISTS strategy_plan_versions_status_check;
ALTER TABLE core.strategy_plan_versions ADD CONSTRAINT strategy_plan_versions_status_check
  CHECK (status IN ('rascunho', 'proposto', 'vigente', 'superado', 'revogado', 'rejeitado', 'cancelado'));

ALTER TABLE core.strategy_plan_events DROP CONSTRAINT IF EXISTS strategy_plan_events_kind_check;
ALTER TABLE core.strategy_plan_events ADD CONSTRAINT strategy_plan_events_kind_check
  CHECK (kind IN
    ('proposta', 'parecer', 'ajuste', 'gate', 'cancelada', 'efetivada', 'rejeitada', 'revogada', 'revisao_aberta', 'impacto_anotado', 'redigida'));
CREATE UNIQUE INDEX IF NOT EXISTS strategy_plan_versions_uma_aberta
  ON core.strategy_plan_versions (plan_id) WHERE status IN ('rascunho', 'proposto');
CREATE UNIQUE INDEX IF NOT EXISTS strategy_plan_events_parecer_persona
  ON core.strategy_plan_events (version_id, (payload->>'persona')) WHERE kind = 'parecer';
CREATE UNIQUE INDEX IF NOT EXISTS strategy_plan_events_um_ajuste
  ON core.strategy_plan_events (version_id) WHERE kind = 'ajuste';
CREATE INDEX IF NOT EXISTS strategy_plan_events_gate_recente
  ON core.strategy_plan_events (version_id, created_at DESC, id DESC) WHERE kind = 'gate';

COMMENT ON TABLE core.strategy_plan_versions IS
  'Versões imutáveis do plano (ADR 0056 §2). O app só tem SELECT e INSERT e a versão nasce sempre rascunho; gatilhos negam UPDATE e DELETE. status muda só pelo gatilho de core.strategy_plan_events (ADR 0065 §4). Uma versão vigente e no máximo uma aberta (rascunho ou proposto) por plano (índices únicos parciais): versão nova cancela a aberta anterior na mesma transação. Some com o cliente no expurgo.';

COMMENT ON TABLE core.strategy_plan_refs IS
  'Ponteiros do plano para o Brain (ADR 0056 §3): URN e contentHash visto, nunca o texto. Imutável. A URN tem de ser do mesmo cliente e da mesma organização da linha. Só entra na transação que criou a versão e enquanto ela é rascunho.';

COMMENT ON TABLE core.strategy_plan_events IS
  'Histórico só de acréscimo do ciclo de vida das versões (ADR 0056 §2, ADR 0065 §4 a §7). INSERT aqui dispara core.strategy_plan_apos_evento, que aplica a transição de status da versão (supera a anterior ou cancela a aberta na mesma transação) ou recusa a inválida. parecer, ajuste e gate só nascem pela credencial do worker (actor_kind agente) e só em versão rascunho; proposta (aplicar) é ato de pessoa e exige parecer e gate aprovado da própria versão; efetivada, rejeitada e revogada por agente são negadas (ADR 0065 §5); por usuario exigem membro vivo. payload sem dado pessoal.';

CREATE OR REPLACE FUNCTION core.strategy_plan_versao_antes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_prev      core.strategy_plan_versions;
  v_aberta    core.strategy_plan_versions;
  v_vigente   uuid;
  v_teto_exec integer;
  v_teto_dia  integer;
  v_na_exec   bigint;
  v_no_dia    bigint;
BEGIN
  IF NEW.status <> 'rascunho' THEN
    RAISE EXCEPTION 'versão nasce rascunho; proposto, vigente, rejeitado, revogado, superado e cancelado só por evento (nasce %)', NEW.status
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.author_kind = 'usuario' AND NEW.author_user_id IS NULL THEN
    RAISE EXCEPTION 'autor usuario exige author_user_id' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.redacted_at IS NOT NULL THEN
    RAISE EXCEPTION 'versão não nasce redigida' USING ERRCODE = 'check_violation';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('orla:strategy_plan'), hashtext(NEW.client_id::text));

  IF NOT EXISTS (
       SELECT 1 FROM core.strategy_plans pl
        WHERE pl.id = NEW.plan_id AND pl.organization_id = NEW.organization_id AND pl.client_id = NEW.client_id) THEN
    RAISE EXCEPTION 'plano inexistente neste cliente' USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF EXISTS (SELECT 1 FROM core.strategy_plan_versions WHERE id = NEW.id) THEN
    RAISE EXCEPTION 'versão com este id já existe (strategy_plan_versions_pkey)' USING ERRCODE = 'unique_violation';
  END IF;
  IF NEW.agent_id IS NOT NULL AND NEW.idempotency_key IS NOT NULL AND EXISTS (
       SELECT 1 FROM core.strategy_plan_versions
        WHERE plan_id = NEW.plan_id AND agent_id = NEW.agent_id AND idempotency_key = NEW.idempotency_key) THEN
    RAISE EXCEPTION 'chave de idempotência já usada neste plano (strategy_plan_versions_idempotencia)' USING ERRCODE = 'unique_violation';
  END IF;

  IF NEW.author_kind = 'agente' THEN
    v_teto_exec := least(coalesce(nullif(current_setting('orla.teto_agente_por_execucao', true), '')::integer, 100), 100);
    v_teto_dia := least(coalesce(nullif(current_setting('orla.teto_agente_por_dia', true), '')::integer, 1000), 1000);
    SELECT count(*) FILTER (WHERE agent_run_id IS NOT DISTINCT FROM NEW.agent_run_id),
           count(*)
      INTO v_na_exec, v_no_dia
      FROM core.strategy_plan_versions
     WHERE client_id = NEW.client_id AND author_kind = 'agente' AND created_at >= now() - interval '1 day';
    IF v_na_exec >= v_teto_exec THEN
      RAISE EXCEPTION 'teto de versões do agente por execução atingido (%)', v_teto_exec USING ERRCODE = 'ORT01';
    END IF;
    IF v_no_dia >= v_teto_dia THEN
      RAISE EXCEPTION 'teto diário de versões de agentes para este cliente atingido (%)', v_teto_dia USING ERRCODE = 'ORT02';
    END IF;
  END IF;

  SELECT id INTO v_vigente FROM core.strategy_plan_versions WHERE plan_id = NEW.plan_id AND status = 'vigente';
  IF v_vigente IS NOT NULL AND NEW.supersedes_id IS DISTINCT FROM v_vigente THEN
    RAISE EXCEPTION 'o plano já tem versão vigente: a nova versão precisa superá-la (supersedes_id)'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.supersedes_id IS NOT NULL THEN
    SELECT * INTO v_prev FROM core.strategy_plan_versions WHERE id = NEW.supersedes_id;
    IF NOT FOUND OR v_prev.plan_id <> NEW.plan_id OR v_prev.client_id <> NEW.client_id OR v_prev.organization_id <> NEW.organization_id THEN
      RAISE EXCEPTION 'versão a superar não existe neste plano' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF v_prev.status <> 'vigente' THEN
      RAISE EXCEPTION 'só versão vigente pode ser superada (está %)', v_prev.status USING ERRCODE = 'check_violation';
    END IF;
  END IF;


  SELECT * INTO v_aberta FROM core.strategy_plan_versions
   WHERE plan_id = NEW.plan_id AND organization_id = NEW.organization_id AND client_id = NEW.client_id
     AND status IN ('rascunho', 'proposto')
   FOR UPDATE;
  IF FOUND THEN
    INSERT INTO core.strategy_plan_events
      (organization_id, client_id, version_id, kind, actor_kind, payload, request_id)
    VALUES (v_aberta.organization_id, v_aberta.client_id, v_aberta.id, 'cancelada', 'sistema',
            CASE WHEN v_aberta.redacted_at IS NULL
                 THEN jsonb_build_object('motivo', 'substituida_por_edicao', 'por', NEW.id)
                 ELSE '{}'::jsonb END,
            left(nullif(current_setting('app.request_id', true), ''), 120));
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION core.strategy_plan_versao_antes IS
  'BEFORE INSERT de core.strategy_plan_versions (ADR 0065 §4): a versão só nasce rascunho, autor usuario exige author_user_id, trava por cliente, teto de versões do agente sob a mesma trava (por execução e por cliente em 24 h; padrão 100 e 1000, os GUCs orla.teto_agente_por_execucao e orla.teto_agente_por_dia só reduzem; SQLSTATE ORT01 e ORT02), plano com versão vigente exige supersedes_id igual a ela e a versão que supera é a vigente do mesmo plano. Por último cancela a versão aberta anterior do mesmo plano (rascunho ou proposto) gravando o evento cancelada de actor_kind sistema, com payload motivo substituida_por_edicao e por (id da nova), que o gatilho de eventos aplica antes de a linha nova entrar no índice de uma aberta; versão aberta redigida recebe o evento com payload vazio. Logo depois da trava e da checagem do plano, e antes do teto do agente e da regra da vigente, recusa com 23505 id já existente ou chave de idempotência (plano, agente, chave) já usada: o reenvio de um worker retomável recebe sempre 23505 (já feito), nunca ORT01, ORT02 nem 23514, e INSERT ... ON CONFLICT DO NOTHING nunca cancela a aberta e depois descarta a linha nova. SECURITY DEFINER para ler a anterior sem depender da RLS do chamador; compara organização, cliente e plano explicitamente.';

REVOKE ALL ON FUNCTION core.strategy_plan_versao_antes() FROM PUBLIC;

CREATE OR REPLACE FUNCTION core.strategy_plan_evento_autoridade()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.actor_kind = 'agente' AND NEW.kind IN ('efetivada', 'rejeitada', 'revogada') THEN
    RAISE EXCEPTION 'agente não efetiva, rejeita nem revoga versão de plano: falta política de autonomia (ADR 0065 §5)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.actor_kind = 'agente' AND NEW.kind = 'proposta' THEN
    RAISE EXCEPTION 'aplicar o plano (proposta) é ato de pessoa: agente não propõe' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.kind IN ('parecer', 'ajuste', 'gate') AND NEW.actor_kind <> 'agente' THEN
    RAISE EXCEPTION 'parecer, ajuste e gate só pela credencial do worker (ator agente)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.actor_kind = 'usuario' AND NEW.actor_user_id IS NULL THEN
    RAISE EXCEPTION 'ator usuario exige actor_user_id' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF core.decisao_chamador_e_app() THEN
    NEW.created_at := now();
    IF NEW.kind = 'redigida' THEN
      RAISE EXCEPTION 'evento redigida só nasce de core.redigir_plano' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.actor_kind = 'sistema' THEN
      RAISE EXCEPTION 'ator sistema só nasce dos gatilhos' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.actor_kind = 'usuario' THEN
      IF NEW.actor_user_id IS DISTINCT FROM nullif(current_setting('app.user_id', true), '')::uuid THEN
        RAISE EXCEPTION 'actor_user_id tem de ser o usuário da sessão' USING ERRCODE = 'insufficient_privilege';
      END IF;
      IF NOT core.is_member(NEW.organization_id, NEW.actor_user_id) THEN
        RAISE EXCEPTION 'actor_user_id não é membro vivo da organização' USING ERRCODE = 'insufficient_privilege';
      END IF;
      IF NOT EXISTS (
           SELECT 1 FROM core.memberships_of(NEW.actor_user_id) m
            WHERE m.organization_id = NEW.organization_id AND m.role IN ('owner', 'admin', 'operator')) THEN
        RAISE EXCEPTION 'registrar evento exige papel owner, admin ou operator' USING ERRCODE = 'insufficient_privilege';
      END IF;
      IF NEW.kind IN ('efetivada', 'rejeitada', 'revogada') AND NOT EXISTS (
           SELECT 1 FROM core.memberships_of(NEW.actor_user_id) m
            WHERE m.organization_id = NEW.organization_id AND m.role IN ('owner', 'admin')) THEN
        RAISE EXCEPTION 'efetivar, rejeitar e revogar exige papel owner ou admin' USING ERRCODE = 'insufficient_privilege';
      END IF;
    ELSIF nullif(current_setting('app.user_id', true), '') IS NOT NULL THEN
      RAISE EXCEPTION 'sessão de agente não carrega usuário (app.user_id)' USING ERRCODE = 'insufficient_privilege';
    ELSIF NOT core.decisao_chamador_e_worker() THEN
      RAISE EXCEPTION 'ator agente só pelo worker' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.kind <> 'redigida' AND NEW.payload <> '{}'::jsonb AND NEW.payload <> '{"redigido": true}'::jsonb AND EXISTS (
         SELECT 1 FROM core.strategy_plan_versions v WHERE v.id = NEW.version_id AND v.redacted_at IS NOT NULL) THEN
      RAISE EXCEPTION 'versão redigida só aceita evento com payload vazio' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.kind = 'parecer' THEN
    IF jsonb_typeof(NEW.payload->'persona') IS DISTINCT FROM 'string' OR NEW.payload->>'persona' !~ '^[a-z][a-z0-9_]{1,47}$' THEN
      RAISE EXCEPTION 'parecer exige payload.persona (texto, ^[a-z][a-z0-9_]{1,47}$)' USING ERRCODE = 'check_violation';
    END IF;
    IF jsonb_typeof(NEW.payload->'veredito') IS DISTINCT FROM 'string'
       OR NEW.payload->>'veredito' NOT IN ('aprova', 'aprova_com_ajuste', 'reprova') THEN
      RAISE EXCEPTION 'parecer exige payload.veredito em (aprova, aprova_com_ajuste, reprova)' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.kind = 'ajuste' THEN
    IF jsonb_typeof(NEW.payload->'responde_a') IS DISTINCT FROM 'string'
       OR NEW.payload->>'responde_a' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'ajuste exige payload.responde_a (uuid da versão que o ajuste responde)' USING ERRCODE = 'check_violation';
    END IF;
    IF (NEW.payload->>'responde_a')::uuid = NEW.version_id THEN
      RAISE EXCEPTION 'ajuste não pode responder à própria versão' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.kind = 'gate' THEN
    IF jsonb_typeof(NEW.payload->'resultado') IS DISTINCT FROM 'string' OR NEW.payload->>'resultado' NOT IN ('aprovado', 'reprovado') THEN
      RAISE EXCEPTION 'gate exige payload.resultado em (aprovado, reprovado)' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION core.strategy_plan_evento_autoridade IS
  'BEFORE INSERT de core.strategy_plan_events (sem DEFINER, enxerga o papel real). Para qualquer chamador: agente nunca efetiva, rejeita, revoga nem propõe (aplicar é ato de pessoa; autonomia vem em outro ADR), parecer, ajuste e gate só com ator agente, ator usuario exige actor_user_id, e o payload de parecer (persona e veredito), de ajuste (responde_a, uuid diferente da própria versão) e de gate (resultado) é validado com SQLSTATE 23514 (que responde_a seja a versão substituída e que ela tenha passado pelo Comitê é conferido em core.strategy_plan_apos_evento). Para o app e o worker: created_at é now() aqui e vira clock_timestamp em core.strategy_plan_evento_teto, sob a trava do cliente; sistema é negado, usuario é o app.user_id da transação e membro vivo com papel owner, admin ou operator (efetivada, rejeitada e revogada exigem owner ou admin; cancelada e proposta, owner, admin ou operator; conferido por core.memberships_of, que traz a prova de inquilino e ignora membro revogado), agente não carrega app.user_id e só vale para o worker, versão redigida só aceita evento com payload vazio, e redigida só nasce de core.redigir_plano.';

CREATE OR REPLACE FUNCTION core.strategy_plan_evento_teto()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_teto_exec integer;
  v_teto_dia  integer;
  v_na_exec   bigint;
  v_no_dia    bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('orla:strategy_plan'), hashtext(NEW.client_id::text));
  NEW.created_at := clock_timestamp();
  IF NEW.kind <> 'redigida' AND NEW.payload <> '{}'::jsonb AND NEW.payload <> '{"redigido": true}'::jsonb AND EXISTS (
       SELECT 1 FROM core.strategy_plan_versions v WHERE v.id = NEW.version_id AND v.redacted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'versão redigida só aceita evento com payload vazio' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.actor_kind <> 'agente' THEN
    RETURN NEW;
  END IF;
  IF NEW.agent_id IS NOT NULL AND NEW.idempotency_key IS NOT NULL AND EXISTS (
       SELECT 1 FROM core.strategy_plan_events
        WHERE version_id = NEW.version_id AND agent_id = NEW.agent_id AND idempotency_key = NEW.idempotency_key) THEN
    RAISE EXCEPTION 'chave de idempotência já usada nesta versão (strategy_plan_events_idempotencia)' USING ERRCODE = 'unique_violation';
  END IF;
  IF NEW.kind = 'parecer' AND EXISTS (
       SELECT 1 FROM core.strategy_plan_events
        WHERE version_id = NEW.version_id AND kind = 'parecer' AND payload->>'persona' = NEW.payload->>'persona') THEN
    RAISE EXCEPTION 'esta persona já opinou nesta versão (strategy_plan_events_parecer_persona)' USING ERRCODE = 'unique_violation';
  END IF;
  IF NEW.kind = 'ajuste' AND EXISTS (
       SELECT 1 FROM core.strategy_plan_events WHERE version_id = NEW.version_id AND kind = 'ajuste') THEN
    RAISE EXCEPTION 'a versão já tem ajuste (strategy_plan_events_um_ajuste)' USING ERRCODE = 'unique_violation';
  END IF;
  v_teto_exec := least(coalesce(nullif(current_setting('orla.teto_agente_por_execucao', true), '')::integer, 100), 100);
  v_teto_dia := least(coalesce(nullif(current_setting('orla.teto_agente_por_dia', true), '')::integer, 1000), 1000);
  SELECT count(*) FILTER (WHERE agent_run_id IS NOT DISTINCT FROM NEW.agent_run_id),
         count(*)
    INTO v_na_exec, v_no_dia
    FROM core.strategy_plan_events
   WHERE client_id = NEW.client_id AND actor_kind = 'agente' AND created_at >= now() - interval '1 day';
  IF v_na_exec >= v_teto_exec THEN
    RAISE EXCEPTION 'teto de eventos do agente por execução atingido (%)', v_teto_exec USING ERRCODE = 'ORT01';
  END IF;
  IF v_no_dia >= v_teto_dia THEN
    RAISE EXCEPTION 'teto diário de eventos de agentes para este cliente atingido (%)', v_teto_dia USING ERRCODE = 'ORT02';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION core.strategy_plan_evento_teto IS
  'BEFORE INSERT de core.strategy_plan_events (depois da autoridade e de strategy_plan_events_antes_execucao, nome b_teto): pega a trava consultiva do cliente para todo ator, antes de qualquer FOR UPDATE e do FK (ordem única de travas: cliente, depois linhas); depois da trava fixa created_at := clock_timestamp() para qualquer ator (inclusive sistema e redigida gravados por funções DEFINER), de modo que a ordem de created_at siga a ordem da trava e o desempate por id nunca decida a ordem real; repete, já sob a trava, a recusa de payload não vazio em versão redigida (a checagem de strategy_plan_evento_autoridade corre antes da trava e uma redação concorrente a invalida), para qualquer ator; antes de contar o teto, recusa com 23505 a chave de idempotência (versão, agente, chave) já usada, o segundo parecer da mesma persona e o segundo ajuste da versão, de modo que o reenvio de um evento já gravado é sempre "já feito" e nunca ORT01 nem ORT02; teto de eventos do agente por execução (agent_run_id) e por cliente em 24 h, sob trava por cliente; mesmos GUCs, padrões (100 e 1000) e SQLSTATE (ORT01, ORT02) de core.strategy_plan_versao_antes.';

REVOKE ALL ON FUNCTION core.strategy_plan_evento_teto() FROM PUBLIC;

CREATE OR REPLACE FUNCTION core.strategy_plan_substituida_por(p_substituida uuid, p_nova uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM core.strategy_plan_events c
      JOIN core.strategy_plan_versions r ON r.id = c.version_id
      JOIN core.strategy_plan_versions n ON n.id = p_nova
     WHERE c.version_id = p_substituida AND c.kind = 'cancelada' AND c.actor_kind = 'sistema'
       AND c.payload->>'por' = p_nova::text
       AND r.id <> n.id AND r.plan_id = n.plan_id AND r.organization_id = n.organization_id AND r.client_id = n.client_id)
$$;

COMMENT ON FUNCTION core.strategy_plan_substituida_por IS
  'p_substituida é exatamente a versão que p_nova substituiu: existe evento cancelada de ator sistema em p_substituida com payload por igual a p_nova (gravado por core.strategy_plan_versao_antes) e as duas são do mesmo plano, organização e cliente. Redação zera o payload e a função falha fechada.';

CREATE OR REPLACE FUNCTION core.strategy_plan_passou_comite(p_versao uuid, p_execucao text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_atual  uuid := p_versao;
  v_texto  text;
  v_resp   uuid;
  v_run    text := p_execucao;
  v_runs   text[];
  v_run_aj text;
  v_saltos integer := 0;
BEGIN
  LOOP
    SELECT array_agg(DISTINCT agent_run_id) INTO v_runs
      FROM core.strategy_plan_events WHERE version_id = v_atual AND kind = 'parecer';
    IF v_runs IS NOT NULL THEN
      IF cardinality(v_runs) <> 1 OR v_runs[1] IS NULL OR (v_run IS NOT NULL AND v_runs[1] <> v_run) THEN
        RETURN false;
      END IF;
      RETURN true;
    END IF;
    IF v_saltos >= 10 THEN
      RETURN false;
    END IF;
    SELECT payload->>'responde_a', agent_run_id INTO v_texto, v_run_aj
      FROM core.strategy_plan_events WHERE version_id = v_atual AND kind = 'ajuste' LIMIT 1;
    IF v_texto IS NULL OR v_texto !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RETURN false;
    END IF;
    IF v_run_aj IS NULL OR (v_run IS NOT NULL AND v_run_aj <> v_run) THEN
      RETURN false;
    END IF;
    v_run := v_run_aj;
    v_resp := v_texto::uuid;
    IF NOT core.strategy_plan_substituida_por(v_resp, v_atual) THEN
      RETURN false;
    END IF;
    v_atual := v_resp;
    v_saltos := v_saltos + 1;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION core.strategy_plan_passou_comite IS
  'A versão passou pelo Comitê (ADR 0065 §4): tem parecer próprio, ou tem ajuste cujo responde_a é exatamente a versão que ela substituiu (strategy_plan_substituida_por) e essa versão passou pelo Comitê pela mesma regra, em cadeia de no máximo 10 saltos (falha fechada ao estourar, quando o ajuste ou a substituição não existem ou foram redigidos). Uma versão antiga do plano não empresta parecer a uma revisão nova. Toda a cadeia é de UMA execução: todos os eventos ajuste da cadeia e todos os pareceres da raiz têm o mesmo agent_run_id (o do evento, não o autor da versão: a raiz pode ser versão editada por pessoa, com pareceres da execução corrente); p_execucao, quando informado, é o agent_run_id exigido (o do ajuste que está sendo gravado), senão vale o do primeiro evento encontrado.';

REVOKE ALL ON FUNCTION core.strategy_plan_substituida_por(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION core.strategy_plan_passou_comite(uuid, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION core.strategy_plan_apos_evento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_ver      core.strategy_plan_versions;
  v_prev     core.strategy_plan_versions;
  v_gate     text;
  v_gate_em  timestamptz;
  v_gate_run text;
  v_ultimo_pa timestamptz;
  v_falta    text[] := ARRAY[]::text[];
  v_novo     text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('orla:strategy_plan'), hashtext(NEW.client_id::text));

  IF NEW.kind IN ('proposta', 'cancelada', 'efetivada', 'rejeitada', 'revogada') THEN
    SELECT * INTO v_ver FROM core.strategy_plan_versions
     WHERE id = NEW.version_id AND organization_id = NEW.organization_id AND client_id = NEW.client_id FOR UPDATE;
  ELSE
    SELECT * INTO v_ver FROM core.strategy_plan_versions
     WHERE id = NEW.version_id AND organization_id = NEW.organization_id AND client_id = NEW.client_id;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'versão do evento não existe neste cliente' USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF NEW.kind IN ('parecer', 'ajuste', 'gate') THEN
    IF v_ver.status <> 'rascunho' THEN
      RAISE EXCEPTION 'parecer, ajuste e gate só valem em versão rascunho (está %)', v_ver.status USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.kind = 'ajuste' AND NOT (
         core.strategy_plan_substituida_por((NEW.payload->>'responde_a')::uuid, v_ver.id)
         AND core.strategy_plan_passou_comite((NEW.payload->>'responde_a')::uuid, NEW.agent_run_id)) THEN
      RAISE EXCEPTION 'ajuste.responde_a precisa ser a versão que esta substituiu, do mesmo plano, e ter passado pelo Comitê na mesma execução (agent_run_id)' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.kind = 'proposta' THEN
    IF v_ver.status <> 'rascunho' THEN
      RAISE EXCEPTION 'transição inválida: % não pode ser proposta', v_ver.status USING ERRCODE = 'check_violation';
    END IF;
    SELECT payload->>'resultado', created_at, agent_run_id INTO v_gate, v_gate_em, v_gate_run FROM core.strategy_plan_events
     WHERE version_id = NEW.version_id AND kind = 'gate'
     ORDER BY created_at DESC, id DESC LIMIT 1;
    SELECT max(created_at) INTO v_ultimo_pa FROM core.strategy_plan_events
     WHERE version_id = NEW.version_id AND kind IN ('parecer', 'ajuste');
    IF NOT core.strategy_plan_passou_comite(NEW.version_id) THEN
      v_falta := array_append(v_falta, 'parecer do Comitê (próprio ou ajuste em cadeia que responda a versão que esta substituiu)');
    END IF;
    IF v_gate IS NULL THEN
      v_falta := array_append(v_falta, 'gate');
    ELSIF v_gate <> 'aprovado' THEN
      v_falta := array_append(v_falta, 'gate aprovado (o mais recente não aprovou)');
    ELSIF v_ultimo_pa IS NOT NULL AND v_gate_em <= v_ultimo_pa THEN
      v_falta := array_append(v_falta, 'novo gate aprovado depois do último parecer ou ajuste');
    ELSIF v_gate_run IS NULL OR EXISTS (
         SELECT 1 FROM core.strategy_plan_events
          WHERE version_id = NEW.version_id AND kind IN ('parecer', 'ajuste') AND agent_run_id IS DISTINCT FROM v_gate_run) THEN
      v_falta := array_append(v_falta, 'gate da mesma execução do Comitê (agent_run_id dos pareceres e do ajuste)');
    END IF;
    IF cardinality(v_falta) > 0 THEN
      RAISE EXCEPTION 'versão não pode ser proposta: falta %', array_to_string(v_falta, ' e ') USING ERRCODE = 'check_violation';
    END IF;
    v_novo := 'proposto';
  ELSIF NEW.kind = 'cancelada' THEN
    IF NEW.actor_kind = 'agente' AND v_ver.status = 'proposto' THEN
      RAISE EXCEPTION 'agente só cancela rascunho; proposto só por pessoa ou por versão nova' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_ver.status NOT IN ('rascunho', 'proposto') THEN
      RAISE EXCEPTION 'transição inválida: só rascunho ou proposto pode ser cancelado (está %)', v_ver.status USING ERRCODE = 'check_violation';
    END IF;
    v_novo := 'cancelado';
  ELSIF NEW.kind = 'efetivada' THEN
    IF v_ver.status <> 'proposto' THEN
      RAISE EXCEPTION 'transição inválida: só proposto pode ser efetivado (está %)', v_ver.status USING ERRCODE = 'check_violation';
    END IF;
    IF v_ver.supersedes_id IS NOT NULL THEN
      SELECT * INTO v_prev FROM core.strategy_plan_versions WHERE id = v_ver.supersedes_id FOR UPDATE;
      IF v_prev.status <> 'vigente' THEN
        RAISE EXCEPTION 'a versão que esta supera não está mais vigente (está %)', v_prev.status USING ERRCODE = 'check_violation';
      END IF;
      UPDATE core.strategy_plan_versions SET status = 'superado' WHERE id = v_prev.id;
    END IF;
    v_novo := 'vigente';
  ELSIF NEW.kind = 'rejeitada' THEN
    IF v_ver.status <> 'proposto' THEN
      RAISE EXCEPTION 'transição inválida: só proposto pode ser rejeitado (está %)', v_ver.status USING ERRCODE = 'check_violation';
    END IF;
    v_novo := 'rejeitado';
  ELSIF NEW.kind = 'revogada' THEN
    IF v_ver.status <> 'vigente' THEN
      RAISE EXCEPTION 'transição inválida: só vigente pode ser revogado (está %)', v_ver.status USING ERRCODE = 'check_violation';
    END IF;
    v_novo := 'revogado';
  END IF;

  IF v_novo IS NOT NULL THEN
    UPDATE core.strategy_plan_versions SET status = v_novo WHERE id = v_ver.id;
  END IF;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION core.strategy_plan_apos_evento IS
  'AFTER INSERT de core.strategy_plan_events: único caminho que muda status de versão. Pega a trava consultiva do cliente antes de qualquer linha e só trava a linha (FOR UPDATE) nos tipos que mudam status; recusa evento cuja versão não é do mesmo cliente e organização. proposta: rascunho para proposto, só se o gate mais recente (created_at, desempate por id) é aprovado e posterior a todo parecer e ajuste da versão, o gate é da mesma execução (agent_run_id) de todos os pareceres e ajustes da versão, e a versão passou pelo Comitê (core.strategy_plan_passou_comite: parecer próprio, ou ajuste cujo responde_a é exatamente a versão que ela substituiu e que passou pelo Comitê pela mesma regra, em cadeia de até 10 saltos), senão 23514 dizendo o que falta; ajuste exige responde_a que seja a versão substituída e tenha passado pelo Comitê, e é único por versão (índice); cancelada: rascunho ou proposto para cancelado (agente só cancela rascunho, 42501); efetivada: proposto para vigente, superando a anterior (vigente para superado) na mesma transação e antes do índice único; rejeitada: proposto para rejeitado; revogada: vigente para revogado. parecer, ajuste e gate só valem em versão rascunho e não mudam status; revisao_aberta e impacto_anotado não mudam status. Recusa as transições inválidas.';

REVOKE ALL ON FUNCTION core.strategy_plan_apos_evento() FROM PUBLIC;

CREATE OR REPLACE FUNCTION core.strategy_plan_ref_antes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_ver core.strategy_plan_versions;
BEGIN
  SELECT * INTO v_ver FROM core.strategy_plan_versions WHERE id = NEW.version_id;
  IF NOT FOUND OR v_ver.organization_id <> NEW.organization_id OR v_ver.client_id <> NEW.client_id THEN
    RAISE EXCEPTION 'versão da referência não existe neste cliente' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF v_ver.status <> 'rascunho' OR v_ver.created_at <> now() THEN
    RAISE EXCEPTION 'referência só entra na transação que criou a versão, enquanto é rascunho'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION core.strategy_plan_ref_antes IS
  'BEFORE INSERT de core.strategy_plan_refs: a versão é do mesmo cliente, ainda rascunho, e foi criada nesta transação (created_at = now()); depois disso a evidência não muda.';

REVOKE ALL ON FUNCTION core.strategy_plan_ref_antes() FROM PUBLIC;

CREATE OR REPLACE FUNCTION core.strategy_plan_versao_imutavel()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_novo  jsonb := to_jsonb(NEW);
  v_velho jsonb := to_jsonb(OLD);
BEGIN
  IF core.decisao_chamador_e_app() THEN
    RAISE EXCEPTION 'versão do plano é imutável para o app' USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.author_user_id IS NULL AND OLD.author_user_id IS NOT NULL AND (v_novo - 'author_user_id') = (v_velho - 'author_user_id') THEN
    RETURN NEW;
  END IF;

  IF current_setting('orla.redigindo_plano', true) = OLD.id::text
     AND OLD.redacted_at IS NULL AND NEW.redacted_at IS NOT NULL
     AND NEW.content = '{"redigido": true}'::jsonb
     AND (v_novo - 'content' - 'redacted_at') = (v_velho - 'content' - 'redacted_at') THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND (v_novo - 'status') = (v_velho - 'status') AND pg_trigger_depth() > 1
     AND (OLD.status, NEW.status) IN (
       ('rascunho', 'proposto'), ('rascunho', 'cancelado'), ('proposto', 'cancelado'), ('proposto', 'vigente'), ('proposto', 'rejeitado'),
       ('vigente', 'superado'), ('vigente', 'revogado')) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'versão do plano é imutável: o status muda só por evento' USING ERRCODE = 'restrict_violation';
END;
$$;

COMMENT ON FUNCTION core.strategy_plan_versao_imutavel IS
  'BEFORE UPDATE de core.strategy_plan_versions: nega tudo, exceto status vindo do gatilho de evento (profundidade maior que 1, em transição válida) o SET NULL de author_user_id quando o usuário é apagado e a redação LGPD de content (só dentro de core.redigir_plano, marca orla.redigindo_plano local à transação).';

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
END;
$$;

COMMENT ON FUNCTION core.redigir_plano IS
  'Redação LGPD do Strategy Plan (ADR 0056 §10, molde de core.redigir_decisao): redige a versão e todas as versões do mesmo plano (plan_id), com ou sem supersedes_id. Em cada versão ainda não redigida troca content por {"redigido": true}, marca redacted_at e grava um evento redigida (com o motivo) como auditoria; em TODAS as versões do plano, inclusive as já redigidas, troca por {"redigido": true} o payload de qualquer evento ainda não redigido (evento gravado depois da redação). Idempotente: sem versão nova a redigir, não grava evento redigida. Só o worker executa; o app não tem EXECUTE.';

COMMIT;
