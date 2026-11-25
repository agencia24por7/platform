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

CREATE TABLE IF NOT EXISTS core.strategy_plans (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES core.organizations(id) ON DELETE RESTRICT,
  client_id        uuid NOT NULL REFERENCES core.clients(id) ON DELETE CASCADE,
  plan_type_key    text NOT NULL CHECK (plan_type_key ~ '^[a-z][a-z0-9_]{0,39}$'),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT strategy_plans_tipo_unico UNIQUE (client_id, plan_type_key),
  CONSTRAINT strategy_plans_id_inquilino UNIQUE (id, organization_id, client_id)
);

COMMENT ON TABLE core.strategy_plans IS
  'Identidade estável do plano por cliente e tipo (ADR 0056 §2 e §9). Imutável: o app só tem SELECT e INSERT; gatilho nega UPDATE e DELETE. O conteúdo vive em core.strategy_plan_versions. Some com o cliente no expurgo (ON DELETE CASCADE).';

CREATE TABLE IF NOT EXISTS core.strategy_plan_versions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES core.organizations(id) ON DELETE RESTRICT,
  client_id        uuid NOT NULL REFERENCES core.clients(id) ON DELETE CASCADE,
  plan_id          uuid NOT NULL,
  content          jsonb NOT NULL CHECK (jsonb_typeof(content) = 'object' AND pg_column_size(content) <= 262144),
  schema_version   integer NOT NULL CHECK (schema_version >= 1),
  status           text NOT NULL DEFAULT 'rascunho'
                     CHECK (status IN ('rascunho', 'proposto', 'vigente', 'superado', 'revogado', 'rejeitado')),
  supersedes_id    uuid REFERENCES core.strategy_plan_versions(id) ON DELETE NO ACTION,
  author_kind      text NOT NULL CHECK (author_kind IN ('usuario', 'agente')),
  author_user_id   uuid REFERENCES core.users(id) ON DELETE SET NULL,
  agent_id         text CHECK (agent_id IS NULL OR agent_id ~ '^[A-Za-z0-9._:-]{1,80}$'),
  agent_run_id     text CHECK (agent_run_id IS NULL OR agent_run_id ~ '^[A-Za-z0-9._:-]{1,120}$'),
  idempotency_key  text CHECK (idempotency_key IS NULL OR idempotency_key ~ '^[A-Za-z0-9._:-]{1,120}$'),
  redacted_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT strategy_plan_versions_plano_fk FOREIGN KEY (plan_id, organization_id, client_id)
    REFERENCES core.strategy_plans (id, organization_id, client_id) ON DELETE CASCADE,
  CONSTRAINT strategy_plan_versions_id_inquilino UNIQUE (id, organization_id, client_id),
  CONSTRAINT strategy_plan_versions_autor CHECK (
    (author_kind = 'agente' AND agent_id IS NOT NULL AND agent_run_id IS NOT NULL AND idempotency_key IS NOT NULL AND author_user_id IS NULL)
    OR (author_kind = 'usuario' AND agent_id IS NULL AND agent_run_id IS NULL AND idempotency_key IS NULL)),
  CONSTRAINT strategy_plan_versions_nao_se_supera CHECK (supersedes_id IS NULL OR supersedes_id <> id),
  CONSTRAINT strategy_plan_versions_redigida CHECK (redacted_at IS NULL OR content = '{"redigido": true}'::jsonb)
);

COMMENT ON TABLE core.strategy_plan_versions IS
  'Versões imutáveis do plano (ADR 0056 §2). O app só tem SELECT e INSERT e só insere rascunho ou proposto; gatilhos negam UPDATE e DELETE. status muda só pelo gatilho de core.strategy_plan_events. Uma versão vigente por plano (índice único parcial). Some com o cliente no expurgo.';
COMMENT ON COLUMN core.strategy_plan_versions.author_user_id IS
  'Pessoa autora quando author_kind é usuario: obrigatória no INSERT (gatilho) e, para o app e o worker, igual ao app.user_id da transação e membro vivo. Vira NULL se o usuário for apagado, por isso a obrigatoriedade não é CHECK.';
COMMENT ON COLUMN core.strategy_plan_versions.author_kind IS
  'agente exige agent_id e nenhum usuário; para o app e o worker a sessão de agente não pode carregar app.user_id. A origem vem da rota do servidor, nunca do corpo; o banco só defende contra bug de código (app.user_id é autodeclarado).';
COMMENT ON COLUMN core.strategy_plan_versions.redacted_at IS
  'Instante da redação LGPD (core.redigir_plano): content vira {"redigido": true}; linha, status e histórico permanecem.';
COMMENT ON COLUMN core.strategy_plan_versions.created_at IS
  'Para o app e o worker é sempre now(); as referências (core.strategy_plan_refs) só entram na transação que criou a versão.';

CREATE UNIQUE INDEX IF NOT EXISTS strategy_plan_versions_uma_vigente
  ON core.strategy_plan_versions (plan_id) WHERE status = 'vigente';
CREATE UNIQUE INDEX IF NOT EXISTS strategy_plan_versions_idempotencia
  ON core.strategy_plan_versions (plan_id, agent_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS strategy_plan_versions_plano_status
  ON core.strategy_plan_versions (plan_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS strategy_plan_versions_teto
  ON core.strategy_plan_versions (client_id, author_kind, created_at);
CREATE INDEX IF NOT EXISTS strategy_plan_versions_antecessora
  ON core.strategy_plan_versions (supersedes_id) WHERE supersedes_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS core.strategy_plan_refs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES core.organizations(id) ON DELETE RESTRICT,
  client_id        uuid NOT NULL REFERENCES core.clients(id) ON DELETE CASCADE,
  version_id       uuid NOT NULL,
  urn              text NOT NULL CHECK (urn ~ '^orla:[0-9a-f-]{36}:[0-9a-f-]{36}:[a-z][a-z0-9_]{1,47}:[A-Za-z0-9][A-Za-z0-9._-]{0,159}$'),
  content_hash     text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  role             text NOT NULL CHECK (role IN ('evidencia_favor', 'evidencia_contra', 'premissa')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT strategy_plan_refs_versao_fk FOREIGN KEY (version_id, organization_id, client_id)
    REFERENCES core.strategy_plan_versions (id, organization_id, client_id) ON DELETE CASCADE,
  CONSTRAINT strategy_plan_refs_urn_do_inquilino CHECK (
    split_part(urn, ':', 2) = organization_id::text AND split_part(urn, ':', 3) = client_id::text),
  CONSTRAINT strategy_plan_refs_unica UNIQUE (version_id, urn, role)
);

COMMENT ON TABLE core.strategy_plan_refs IS
  'Ponteiros do plano para o Brain (ADR 0056 §3): URN e contentHash visto, nunca o texto. Imutável. A URN tem de ser do mesmo cliente e da mesma organização da linha. Só entra na transação que criou a versão e enquanto ela é rascunho ou proposto.';

CREATE INDEX IF NOT EXISTS strategy_plan_refs_urn ON core.strategy_plan_refs (client_id, urn);
CREATE INDEX IF NOT EXISTS strategy_plan_refs_versao ON core.strategy_plan_refs (version_id);

CREATE TABLE IF NOT EXISTS core.strategy_plan_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES core.organizations(id) ON DELETE RESTRICT,
  client_id        uuid NOT NULL REFERENCES core.clients(id) ON DELETE CASCADE,
  version_id       uuid NOT NULL,
  kind             text NOT NULL CHECK (kind IN
                     ('proposta', 'parecer', 'efetivada', 'rejeitada', 'revogada', 'revisao_aberta', 'impacto_anotado', 'redigida')),
  actor_kind       text NOT NULL CHECK (actor_kind IN ('usuario', 'agente', 'sistema')),
  actor_user_id    uuid REFERENCES core.users(id) ON DELETE SET NULL,
  payload          jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object' AND pg_column_size(payload) <= 16384),
  agent_id         text CHECK (agent_id IS NULL OR agent_id ~ '^[A-Za-z0-9._:-]{1,80}$'),
  agent_run_id     text CHECK (agent_run_id IS NULL OR agent_run_id ~ '^[A-Za-z0-9._:-]{1,120}$'),
  idempotency_key  text CHECK (idempotency_key IS NULL OR idempotency_key ~ '^[A-Za-z0-9._:-]{1,120}$'),
  request_id       text CHECK (request_id IS NULL OR length(request_id) <= 120),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT strategy_plan_events_versao_fk FOREIGN KEY (version_id, organization_id, client_id)
    REFERENCES core.strategy_plan_versions (id, organization_id, client_id) ON DELETE CASCADE,
  CONSTRAINT strategy_plan_events_agente_sem_usuario CHECK (actor_kind <> 'agente' OR actor_user_id IS NULL),
  CONSTRAINT strategy_plan_events_agente CHECK (
    (actor_kind = 'agente') = (agent_id IS NOT NULL)
    AND (actor_kind = 'agente' OR (agent_run_id IS NULL AND idempotency_key IS NULL))
    AND (actor_kind <> 'agente' OR agent_run_id IS NOT NULL))
);

COMMENT ON TABLE core.strategy_plan_events IS
  'Histórico só de acréscimo do ciclo de vida das versões (ADR 0056 §2). INSERT aqui dispara core.strategy_plan_apos_evento, que aplica a transição de status da versão (e supera a anterior na mesma transação) ou recusa a inválida. efetivada, rejeitada e revogada por actor_kind agente são negadas até existir política de autonomia (ADR 0056 §5); por usuario exigem membro vivo. payload sem dado pessoal.';
COMMENT ON COLUMN core.strategy_plan_events.agent_id IS
  'Autodeclaração de chamador já autenticado pelo segredo do worker: rastreio, teto e idempotência, não prova de identidade.';
COMMENT ON COLUMN core.strategy_plan_events.payload IS
  'Objeto jsonb pequeno, sem dado pessoal (ADR 0056 §10). Entra no roteiro de redação do ADR 0051 §7 quando existir texto livre.';

CREATE UNIQUE INDEX IF NOT EXISTS strategy_plan_events_idempotencia
  ON core.strategy_plan_events (version_id, agent_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS strategy_plan_events_teto
  ON core.strategy_plan_events (client_id, actor_kind, created_at) INCLUDE (agent_run_id);
CREATE INDEX IF NOT EXISTS strategy_plan_events_versao ON core.strategy_plan_events (version_id, created_at);
CREATE INDEX IF NOT EXISTS strategy_plan_events_cliente ON core.strategy_plan_events (client_id, created_at DESC);

DO $$
DECLARE
  papel text := current_setting('contexto.papel_app');
  tabela text;
BEGIN
  FOREACH tabela IN ARRAY ARRAY['strategy_plans', 'strategy_plan_versions', 'strategy_plan_refs', 'strategy_plan_events']
  LOOP
    EXECUTE format('ALTER TABLE core.%I ENABLE ROW LEVEL SECURITY', tabela);
    EXECUTE format('ALTER TABLE core.%I FORCE ROW LEVEL SECURITY', tabela);
    EXECUTE format('DROP POLICY IF EXISTS %I ON core.%I', tabela || '_leitura', tabela);
    EXECUTE format('DROP POLICY IF EXISTS %I ON core.%I', tabela || '_insercao', tabela);
    EXECUTE format(
      'CREATE POLICY %I ON core.%I FOR SELECT TO %I
         USING (organization_id = core.current_organization() AND core.cliente_no_escopo(client_id)
                AND EXISTS (SELECT 1 FROM core.clients c WHERE c.id = %I.client_id))',
      tabela || '_leitura', tabela, papel, tabela);
    EXECUTE format(
      'CREATE POLICY %I ON core.%I FOR INSERT TO %I
         WITH CHECK (organization_id = core.current_organization() AND core.cliente_no_escopo(client_id)
                AND EXISTS (SELECT 1 FROM core.clients c WHERE c.id = %I.client_id))',
      tabela || '_insercao', tabela, papel, tabela);
    EXECUTE format('REVOKE ALL ON core.%I FROM PUBLIC', tabela);
    EXECUTE format('REVOKE ALL ON core.%I FROM %I', tabela, papel);
    EXECUTE format('GRANT SELECT, INSERT ON core.%I TO %I', tabela, papel);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION core.strategy_plan_inquilino()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT core.decisao_chamador_e_app() THEN
    RETURN NEW;
  END IF;
  IF NEW.organization_id IS DISTINCT FROM core.current_organization() OR NOT core.cliente_no_escopo(NEW.client_id)
     OR NOT EXISTS (SELECT 1 FROM core.clients c WHERE c.id = NEW.client_id) THEN
    RAISE EXCEPTION 'organização ou cliente fora do contexto da sessão' USING ERRCODE = 'insufficient_privilege';
  END IF;
  NEW.created_at := now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION core.strategy_plan_inquilino IS
  'BEFORE INSERT das quatro tabelas do Strategy Plan (primeiro gatilho, nome a0_inquilino), sem SECURITY DEFINER para enxergar o papel real. Para o app e o worker: recusa organização diferente de core.current_organization(), cliente fora do escopo e cliente que a RLS de core.clients não mostra (o recorte curinga deixa passar qualquer UUID) antes de qualquer gatilho DEFINER (nada de status vazado nem trava de outro inquilino) e fixa created_at em now(). Superusuário não é checado.';

CREATE OR REPLACE FUNCTION core.strategy_plan_plano_autoridade()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_usuario uuid;
BEGIN
  IF NOT core.decisao_chamador_e_app() THEN
    RETURN NEW;
  END IF;
  v_usuario := nullif(current_setting('app.user_id', true), '')::uuid;
  IF v_usuario IS NULL THEN
    IF NOT core.decisao_chamador_e_worker() THEN
      RAISE EXCEPTION 'sessão sem usuário só vale para o worker' USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF NOT EXISTS (
       SELECT 1 FROM core.memberships_of(v_usuario) m
        WHERE m.organization_id = NEW.organization_id AND m.role IN ('owner', 'admin', 'operator')) THEN
    RAISE EXCEPTION 'criar plano exige papel owner, admin ou operator' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION core.strategy_plan_plano_autoridade IS
  'BEFORE INSERT de core.strategy_plans (sem DEFINER, depois de a0_inquilino): sessão com usuário (app.user_id) exige membro vivo com papel owner, admin ou operator (core.memberships_of, que traz a prova de inquilino e ignora revogado); viewer é negado. Sessão sem usuário só passa para o papel do worker (core.decisao_chamador_e_worker): o pool da web, sem app.user_id, não escreve.';

CREATE OR REPLACE FUNCTION core.strategy_plan_versao_autoridade()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_usuario uuid;
BEGIN
  IF NOT core.decisao_chamador_e_app() THEN
    RETURN NEW;
  END IF;
  v_usuario := nullif(current_setting('app.user_id', true), '')::uuid;
  NEW.created_at := now();

  IF NEW.author_kind = 'usuario' THEN
    IF NEW.author_user_id IS DISTINCT FROM v_usuario THEN
      RAISE EXCEPTION 'author_user_id tem de ser o usuário da sessão' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT core.is_member(NEW.organization_id, NEW.author_user_id) THEN
      RAISE EXCEPTION 'author_user_id não é membro vivo da organização' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT EXISTS (
         SELECT 1 FROM core.memberships_of(NEW.author_user_id) m
          WHERE m.organization_id = NEW.organization_id AND m.role IN ('owner', 'admin', 'operator')) THEN
      RAISE EXCEPTION 'criar versão exige papel owner, admin ou operator' USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF v_usuario IS NOT NULL THEN
    RAISE EXCEPTION 'sessão de agente não carrega usuário (app.user_id)' USING ERRCODE = 'insufficient_privilege';
  ELSIF NOT core.decisao_chamador_e_worker() THEN
    RAISE EXCEPTION 'autor agente só pelo worker' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION core.strategy_plan_versao_autoridade IS
  'BEFORE INSERT de core.strategy_plan_versions (antes de strategy_plan_versao_antes, por ordem alfabética), sem SECURITY DEFINER para enxergar o papel real. Para o app e o worker: created_at é now(); autor usuario é o app.user_id da transação e membro vivo com papel owner, admin ou operator; autor agente não pode ter app.user_id e só vale para o papel do worker (core.decisao_chamador_e_worker). app.user_id é autodeclarado: defende contra bug de código, não contra quem tem a credencial do worker. Superusuário não é checado.';

CREATE OR REPLACE FUNCTION core.strategy_plan_versao_antes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_prev      core.strategy_plan_versions;
  v_vigente   uuid;
  v_teto_exec integer;
  v_teto_dia  integer;
  v_na_exec   bigint;
  v_no_dia    bigint;
BEGIN
  IF NEW.status NOT IN ('rascunho', 'proposto') THEN
    RAISE EXCEPTION 'versão nasce rascunho ou proposto; vigente, rejeitado, revogado e superado só por evento (nasce %)', NEW.status
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

  IF NEW.author_kind = 'agente' THEN
    v_teto_exec := least(coalesce(nullif(current_setting('orla.teto_agente_por_execucao', true), '')::integer, 50), 50);
    v_teto_dia := least(coalesce(nullif(current_setting('orla.teto_agente_por_dia', true), '')::integer, 200), 200);
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
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION core.strategy_plan_versao_antes IS
  'BEFORE INSERT de core.strategy_plan_versions: só nasce rascunho ou proposto, autor usuario exige author_user_id, trava por cliente, teto de versões do agente sob a mesma trava (por execução e por cliente em 24 h; padrão 50 e 200, os GUCs orla.teto_agente_por_execucao e orla.teto_agente_por_dia só reduzem; SQLSTATE ORT01 e ORT02), plano com versão vigente exige supersedes_id igual a ela e a versão que supera é a vigente do mesmo plano. SECURITY DEFINER para ler a anterior sem depender da RLS do chamador; compara organização, cliente e plano explicitamente.';

REVOKE ALL ON FUNCTION core.strategy_plan_versao_antes() FROM PUBLIC;

CREATE OR REPLACE FUNCTION core.strategy_plan_versao_depois()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.status = 'proposto' THEN
    INSERT INTO core.strategy_plan_events
      (organization_id, client_id, version_id, kind, actor_kind, actor_user_id, agent_id, agent_run_id, idempotency_key, request_id)
    VALUES (NEW.organization_id, NEW.client_id, NEW.id, 'proposta', NEW.author_kind, NEW.author_user_id,
            NEW.agent_id, NEW.agent_run_id, NEW.idempotency_key,
            left(nullif(current_setting('app.request_id', true), ''), 120));
  END IF;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION core.strategy_plan_versao_depois IS
  'AFTER INSERT de core.strategy_plan_versions: versão que nasce proposto grava o evento proposta (a que nasce rascunho ganha o evento quando alguém a propõe).';

REVOKE ALL ON FUNCTION core.strategy_plan_versao_depois() FROM PUBLIC;

CREATE OR REPLACE FUNCTION core.strategy_plan_evento_autoridade()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.actor_kind = 'agente' AND NEW.kind IN ('efetivada', 'rejeitada', 'revogada') THEN
    RAISE EXCEPTION 'agente não efetiva, rejeita nem revoga versão de plano: falta política de autonomia (ADR 0056 §5)'
      USING ERRCODE = 'insufficient_privilege';
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
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION core.strategy_plan_evento_autoridade IS
  'BEFORE INSERT de core.strategy_plan_events (sem DEFINER, enxerga o papel real). Para qualquer chamador: agente nunca efetiva, rejeita nem revoga (a política de autonomia vem em outro ADR e migração) e ator usuario exige actor_user_id. Para o app e o worker: created_at é now(), sistema é negado, usuario é o app.user_id da transação e membro vivo com papel owner, admin ou operator (efetivada, rejeitada e revogada exigem papel owner ou admin, conferido por core.memberships_of, que traz a prova de inquilino e ignora membro revogado), agente não carrega app.user_id e só vale para o worker, versão redigida só aceita evento com payload vazio, e redigida só nasce de core.redigir_plano.';

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
  IF NEW.actor_kind <> 'agente' THEN
    RETURN NEW;
  END IF;
  v_teto_exec := least(coalesce(nullif(current_setting('orla.teto_agente_por_execucao', true), '')::integer, 50), 50);
  v_teto_dia := least(coalesce(nullif(current_setting('orla.teto_agente_por_dia', true), '')::integer, 200), 200);
  SELECT count(*) FILTER (WHERE agent_run_id IS NOT DISTINCT FROM NEW.agent_run_id),
         count(*)
    INTO v_na_exec, v_no_dia
    FROM core.strategy_plan_events
   WHERE client_id = NEW.client_id AND actor_kind = 'agente' AND created_at >= now() - interval '1 day';
  IF v_na_exec >= v_teto_exec THEN
    RAISE EXCEPTION 'teto de eventos do agente por execução atingido (%; o evento proposta de versão proposta também conta)', v_teto_exec USING ERRCODE = 'ORT01';
  END IF;
  IF v_no_dia >= v_teto_dia THEN
    RAISE EXCEPTION 'teto diário de eventos de agentes para este cliente atingido (%)', v_teto_dia USING ERRCODE = 'ORT02';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION core.strategy_plan_evento_teto IS
  'BEFORE INSERT de core.strategy_plan_events (depois da autoridade): pega a trava consultiva do cliente para todo ator, antes de qualquer FOR UPDATE e do FK (ordem única de travas: cliente, depois linhas); teto de eventos do agente por execução (agent_run_id) e por cliente em 24 h, sob trava por cliente; mesmos GUCs, padrões e SQLSTATE (ORT01, ORT02) de core.strategy_plan_versao_antes. O evento proposta que o gatilho grava para versão de agente também conta.';

REVOKE ALL ON FUNCTION core.strategy_plan_evento_teto() FROM PUBLIC;

CREATE OR REPLACE FUNCTION core.strategy_plan_apos_evento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_ver     core.strategy_plan_versions;
  v_prev    core.strategy_plan_versions;
  v_outras  bigint;
  v_novo    text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('orla:strategy_plan'), hashtext(NEW.client_id::text));

  IF NEW.kind IN ('proposta', 'efetivada', 'rejeitada', 'revogada') THEN
    SELECT * INTO v_ver FROM core.strategy_plan_versions
     WHERE id = NEW.version_id AND organization_id = NEW.organization_id AND client_id = NEW.client_id FOR UPDATE;
  ELSE
    SELECT * INTO v_ver FROM core.strategy_plan_versions
     WHERE id = NEW.version_id AND organization_id = NEW.organization_id AND client_id = NEW.client_id;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'versão do evento não existe neste cliente' USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF NEW.kind = 'proposta' THEN
    IF v_ver.status = 'rascunho' THEN
      v_novo := 'proposto';
    ELSIF v_ver.status = 'proposto' THEN
      SELECT count(*) INTO v_outras FROM core.strategy_plan_events
       WHERE version_id = NEW.version_id AND kind = 'proposta' AND id <> NEW.id;
      IF v_outras > 0 THEN
        RAISE EXCEPTION 'versão já foi proposta' USING ERRCODE = 'check_violation';
      END IF;
    ELSE
      RAISE EXCEPTION 'transição inválida: % não pode ser proposta', v_ver.status USING ERRCODE = 'check_violation';
    END IF;
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
  'AFTER INSERT de core.strategy_plan_events: único caminho que muda status de versão. Pega a trava consultiva do cliente antes de qualquer linha e só trava a linha (FOR UPDATE) nos tipos que mudam status; recusa evento cuja versão não é do mesmo cliente e organização. proposta: rascunho para proposto; efetivada: proposto para vigente, superando a anterior (vigente para superado) na mesma transação e antes do índice único; rejeitada: proposto para rejeitado; revogada: vigente para revogado. parecer, revisao_aberta e impacto_anotado não mudam status. Recusa as transições inválidas.';

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
  IF v_ver.status NOT IN ('rascunho', 'proposto') OR v_ver.created_at <> now() THEN
    RAISE EXCEPTION 'referência só entra na transação que criou a versão, enquanto é rascunho ou proposto'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION core.strategy_plan_ref_antes IS
  'BEFORE INSERT de core.strategy_plan_refs: a versão é do mesmo cliente, ainda rascunho ou proposto, e foi criada nesta transação (created_at = now()); depois disso a evidência não muda.';

REVOKE ALL ON FUNCTION core.strategy_plan_ref_antes() FROM PUBLIC;

CREATE OR REPLACE FUNCTION core.strategy_plan_imutavel()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'registro do Strategy Plan é imutável' USING ERRCODE = 'restrict_violation';
END;
$$;

COMMENT ON FUNCTION core.strategy_plan_imutavel IS
  'BEFORE UPDATE de core.strategy_plans e core.strategy_plan_refs: nega sempre.';

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
       ('rascunho', 'proposto'), ('proposto', 'vigente'), ('proposto', 'rejeitado'),
       ('vigente', 'superado'), ('vigente', 'revogado')) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'versão do plano é imutável: o status muda só por evento' USING ERRCODE = 'restrict_violation';
END;
$$;

COMMENT ON FUNCTION core.strategy_plan_versao_imutavel IS
  'BEFORE UPDATE de core.strategy_plan_versions: nega tudo, exceto status vindo do gatilho de evento (profundidade maior que 1, em transição válida) o SET NULL de author_user_id quando o usuário é apagado e a redação LGPD de content (só dentro de core.redigir_plano, marca orla.redigindo_plano local à transação).';

CREATE OR REPLACE FUNCTION core.strategy_plan_evento_imutavel()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT core.decisao_chamador_e_app()
     AND NEW.actor_user_id IS NULL AND OLD.actor_user_id IS NOT NULL
     AND (to_jsonb(NEW) - 'actor_user_id') = (to_jsonb(OLD) - 'actor_user_id') THEN
    RETURN NEW;
  END IF;
  IF NOT core.decisao_chamador_e_app()
     AND current_setting('orla.redigindo_plano', true) = OLD.version_id::text
     AND OLD.kind <> 'redigida' AND NEW.payload = '{"redigido": true}'::jsonb
     AND (to_jsonb(NEW) - 'payload') = (to_jsonb(OLD) - 'payload') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'evento do plano é só de acréscimo' USING ERRCODE = 'restrict_violation';
END;
$$;

COMMENT ON FUNCTION core.strategy_plan_evento_imutavel IS
  'BEFORE UPDATE de core.strategy_plan_events: só acréscimo; exceções: SET NULL de actor_user_id (usuário apagado) e, só dentro de core.redigir_plano, payload vira {"redigido": true} nos eventos da versão redigida (menos o próprio evento redigida).';

CREATE OR REPLACE FUNCTION core.strategy_plan_nao_apaga()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM core.clients WHERE id = OLD.client_id) THEN
    RAISE EXCEPTION 'registro do Strategy Plan não se apaga; só o expurgo do cliente o leva' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION core.strategy_plan_nao_apaga IS
  'BEFORE DELETE das quatro tabelas do Strategy Plan: nega DELETE enquanto o cliente existe; a cascata do expurgo passa porque o cliente já foi apagado.';

REVOKE ALL ON FUNCTION core.strategy_plan_nao_apaga() FROM PUBLIC;

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
    WITH RECURSIVE cadeia(id) AS (
      SELECT p_versao
      UNION
      SELECT d.id
        FROM cadeia c
        JOIN core.strategy_plan_versions atual ON atual.id = c.id
        JOIN core.strategy_plan_versions d
          ON d.plan_id = v_ver.plan_id
         AND (d.supersedes_id = atual.id OR d.id = atual.supersedes_id)
    )
    SELECT d.id FROM core.strategy_plan_versions d JOIN cadeia USING (id)
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
  'Redação LGPD do Strategy Plan (ADR 0056 §10, molde de core.redigir_decisao): redige a versão e toda a sua cadeia de supersedes_id nos dois sentidos (mesmo plano). Em cada versão ainda não redigida troca content por {"redigido": true}, marca redacted_at e grava um evento redigida (com o motivo) como auditoria; em TODAS as versões da cadeia, inclusive as já redigidas, troca por {"redigido": true} o payload de qualquer evento ainda não redigido (evento gravado depois da redação). Idempotente: sem versão nova a redigir, não grava evento redigida. Só o worker executa; o app não tem EXECUTE.';

DO $$
BEGIN
  REVOKE ALL ON FUNCTION core.redigir_plano(uuid, text) FROM PUBLIC;
  EXECUTE format('REVOKE ALL ON FUNCTION core.redigir_plano(uuid, text) FROM %I', current_setting('contexto.papel_app'));
  EXECUTE format('GRANT EXECUTE ON FUNCTION core.redigir_plano(uuid, text) TO %I', current_setting('contexto.papel_worker'));
END $$;

DROP TRIGGER IF EXISTS strategy_plans_a0_inquilino ON core.strategy_plans;
CREATE TRIGGER strategy_plans_a0_inquilino BEFORE INSERT ON core.strategy_plans
  FOR EACH ROW EXECUTE FUNCTION core.strategy_plan_inquilino();
DROP TRIGGER IF EXISTS strategy_plans_a_autoridade ON core.strategy_plans;
CREATE TRIGGER strategy_plans_a_autoridade BEFORE INSERT ON core.strategy_plans
  FOR EACH ROW EXECUTE FUNCTION core.strategy_plan_plano_autoridade();
DROP TRIGGER IF EXISTS strategy_plan_versions_a0_inquilino ON core.strategy_plan_versions;
CREATE TRIGGER strategy_plan_versions_a0_inquilino BEFORE INSERT ON core.strategy_plan_versions
  FOR EACH ROW EXECUTE FUNCTION core.strategy_plan_inquilino();
DROP TRIGGER IF EXISTS strategy_plan_refs_a0_inquilino ON core.strategy_plan_refs;
CREATE TRIGGER strategy_plan_refs_a0_inquilino BEFORE INSERT ON core.strategy_plan_refs
  FOR EACH ROW EXECUTE FUNCTION core.strategy_plan_inquilino();
DROP TRIGGER IF EXISTS strategy_plan_events_a0_inquilino ON core.strategy_plan_events;
CREATE TRIGGER strategy_plan_events_a0_inquilino BEFORE INSERT ON core.strategy_plan_events
  FOR EACH ROW EXECUTE FUNCTION core.strategy_plan_inquilino();
DROP TRIGGER IF EXISTS strategy_plan_events_b_teto ON core.strategy_plan_events;
CREATE TRIGGER strategy_plan_events_b_teto BEFORE INSERT ON core.strategy_plan_events
  FOR EACH ROW EXECUTE FUNCTION core.strategy_plan_evento_teto();
DROP TRIGGER IF EXISTS strategy_plan_versions_a_autoridade ON core.strategy_plan_versions;
CREATE TRIGGER strategy_plan_versions_a_autoridade BEFORE INSERT ON core.strategy_plan_versions
  FOR EACH ROW EXECUTE FUNCTION core.strategy_plan_versao_autoridade();
DROP TRIGGER IF EXISTS strategy_plan_versions_antes ON core.strategy_plan_versions;
CREATE TRIGGER strategy_plan_versions_antes BEFORE INSERT ON core.strategy_plan_versions
  FOR EACH ROW EXECUTE FUNCTION core.strategy_plan_versao_antes();
DROP TRIGGER IF EXISTS strategy_plan_versions_depois ON core.strategy_plan_versions;
CREATE TRIGGER strategy_plan_versions_depois AFTER INSERT ON core.strategy_plan_versions
  FOR EACH ROW EXECUTE FUNCTION core.strategy_plan_versao_depois();
DROP TRIGGER IF EXISTS strategy_plan_events_antes ON core.strategy_plan_events;
CREATE TRIGGER strategy_plan_events_antes BEFORE INSERT ON core.strategy_plan_events
  FOR EACH ROW EXECUTE FUNCTION core.strategy_plan_evento_autoridade();
DROP TRIGGER IF EXISTS strategy_plan_events_depois ON core.strategy_plan_events;
CREATE TRIGGER strategy_plan_events_depois AFTER INSERT ON core.strategy_plan_events
  FOR EACH ROW EXECUTE FUNCTION core.strategy_plan_apos_evento();
DROP TRIGGER IF EXISTS strategy_plan_refs_antes ON core.strategy_plan_refs;
CREATE TRIGGER strategy_plan_refs_antes BEFORE INSERT ON core.strategy_plan_refs
  FOR EACH ROW EXECUTE FUNCTION core.strategy_plan_ref_antes();

DROP TRIGGER IF EXISTS strategy_plans_imutavel ON core.strategy_plans;
CREATE TRIGGER strategy_plans_imutavel BEFORE UPDATE ON core.strategy_plans
  FOR EACH ROW EXECUTE FUNCTION core.strategy_plan_imutavel();
DROP TRIGGER IF EXISTS strategy_plan_refs_imutavel ON core.strategy_plan_refs;
CREATE TRIGGER strategy_plan_refs_imutavel BEFORE UPDATE ON core.strategy_plan_refs
  FOR EACH ROW EXECUTE FUNCTION core.strategy_plan_imutavel();
DROP TRIGGER IF EXISTS strategy_plan_versions_imutavel ON core.strategy_plan_versions;
CREATE TRIGGER strategy_plan_versions_imutavel BEFORE UPDATE ON core.strategy_plan_versions
  FOR EACH ROW EXECUTE FUNCTION core.strategy_plan_versao_imutavel();
DROP TRIGGER IF EXISTS strategy_plan_events_imutavel ON core.strategy_plan_events;
CREATE TRIGGER strategy_plan_events_imutavel BEFORE UPDATE ON core.strategy_plan_events
  FOR EACH ROW EXECUTE FUNCTION core.strategy_plan_evento_imutavel();

DROP TRIGGER IF EXISTS strategy_plans_nao_apaga ON core.strategy_plans;
CREATE TRIGGER strategy_plans_nao_apaga BEFORE DELETE ON core.strategy_plans
  FOR EACH ROW EXECUTE FUNCTION core.strategy_plan_nao_apaga();
DROP TRIGGER IF EXISTS strategy_plan_versions_nao_apaga ON core.strategy_plan_versions;
CREATE TRIGGER strategy_plan_versions_nao_apaga BEFORE DELETE ON core.strategy_plan_versions
  FOR EACH ROW EXECUTE FUNCTION core.strategy_plan_nao_apaga();
DROP TRIGGER IF EXISTS strategy_plan_refs_nao_apaga ON core.strategy_plan_refs;
CREATE TRIGGER strategy_plan_refs_nao_apaga BEFORE DELETE ON core.strategy_plan_refs
  FOR EACH ROW EXECUTE FUNCTION core.strategy_plan_nao_apaga();
DROP TRIGGER IF EXISTS strategy_plan_events_nao_apaga ON core.strategy_plan_events;
CREATE TRIGGER strategy_plan_events_nao_apaga BEFORE DELETE ON core.strategy_plan_events
  FOR EACH ROW EXECUTE FUNCTION core.strategy_plan_nao_apaga();

COMMIT;
