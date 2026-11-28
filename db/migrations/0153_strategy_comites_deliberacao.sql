BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  PERFORM set_config(
    'comites.papel_app',
    (SELECT rolname FROM pg_roles WHERE rolname IN ('orla_app', 'tria_app') ORDER BY rolname = 'orla_app' DESC LIMIT 1),
    true
  );
  IF current_setting('comites.papel_app') = '' THEN
    RAISE EXCEPTION 'papel do app ausente; as migracoes 0070 e anteriores precisam ter rodado';
  END IF;
  IF to_regclass('core.strategy_plan_runs') IS NULL OR to_regprocedure('core.strategy_plan_inquilino()') IS NULL
     OR to_regprocedure('core.strategy_plan_nao_apaga()') IS NULL OR to_regprocedure('core.redigir_plano(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'Strategy Plan ausente; as migracoes 0143 a 0151 precisam ter rodado';
  END IF;
  IF to_regprocedure('core.decisao_chamador_e_app()') IS NULL OR to_regprocedure('core.decisao_chamador_e_worker()') IS NULL THEN
    RAISE EXCEPTION 'core.decisao_chamador_e_app ou _worker ausente; a migracao 0141 precisa ter rodado';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS core.strategy_plan_deliberations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES core.organizations(id) ON DELETE RESTRICT,
  client_id        uuid NOT NULL REFERENCES core.clients(id) ON DELETE CASCADE,
  plan_id          uuid NOT NULL,
  version_id       uuid NOT NULL,
  execution_id     uuid NOT NULL REFERENCES core.strategy_plan_runs(id) ON DELETE CASCADE,
  comite           text NOT NULL CHECK (comite ~ '^[a-z][a-z0-9_]{1,47}$'),
  rodada           smallint NOT NULL CHECK (rodada IN (0, 1, 2)),
  membro           text CHECK (membro IS NULL OR membro ~ '^[a-z][a-z0-9_]{1,47}$'),
  payload          jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND pg_column_size(payload) <= 20480),
  agent_run_id     text NOT NULL CHECK (agent_run_id ~ '^[A-Za-z0-9._:-]{1,120}$'),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT strategy_plan_deliberations_membro_na_rodada0 CHECK ((rodada = 0) = (membro IS NOT NULL)),
  CONSTRAINT strategy_plan_deliberations_plano_fk FOREIGN KEY (plan_id, organization_id, client_id)
    REFERENCES core.strategy_plans (id, organization_id, client_id) ON DELETE CASCADE,
  CONSTRAINT strategy_plan_deliberations_versao_fk FOREIGN KEY (version_id, organization_id, client_id)
    REFERENCES core.strategy_plan_versions (id, organization_id, client_id) ON DELETE CASCADE
);

COMMENT ON TABLE core.strategy_plan_deliberations IS
  'Deliberação interna dos comitês do planejador (24K-134): rodada 0 é o parecer de cada membro (membro obrigatório), rodadas 1 e 2 são as mesas do comitê (sem membro). O parecer final do comitê continua sendo o evento parecer de core.strategy_plan_events, com persona igual à chave do comitê. Serve para retomar a etapa do Comitê sem refazer chamadas e para derivar os comitês convocados na raiz. Imutável (só a redação LGPD troca o payload), só o agente com execução ativa e ficha grava, nunca aparece na tela. Some com o cliente no expurgo.';
COMMENT ON COLUMN core.strategy_plan_deliberations.payload IS
  'Parecer do membro (rodada 0) ou rodada da mesa (1 e 2), já validados pelo domínio. Texto do modelo: nunca vai para auditoria nem log; a redação do plano o troca por {"redigido": true}.';
COMMENT ON COLUMN core.strategy_plan_deliberations.execution_id IS
  'Execução (core.strategy_plan_runs) que gravou; o gatilho confere que está rodando, com lease vigente, mesmo plano e agent_run_id e ficha igual a tentativas.';

CREATE UNIQUE INDEX IF NOT EXISTS strategy_plan_deliberations_unica
  ON core.strategy_plan_deliberations (version_id, comite, rodada, (coalesce(membro, '')));
CREATE INDEX IF NOT EXISTS strategy_plan_deliberations_cliente
  ON core.strategy_plan_deliberations (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS strategy_plan_deliberations_execucao
  ON core.strategy_plan_deliberations (execution_id);

DO $$
DECLARE
  papel text := current_setting('comites.papel_app');
  condicao text := 'organization_id = core.current_organization() AND core.cliente_no_escopo(client_id)
                AND EXISTS (SELECT 1 FROM core.clients c WHERE c.id = strategy_plan_deliberations.client_id AND c.organization_id = strategy_plan_deliberations.organization_id)';
BEGIN
  ALTER TABLE core.strategy_plan_deliberations ENABLE ROW LEVEL SECURITY;
  ALTER TABLE core.strategy_plan_deliberations FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS strategy_plan_deliberations_leitura ON core.strategy_plan_deliberations;
  DROP POLICY IF EXISTS strategy_plan_deliberations_insercao ON core.strategy_plan_deliberations;
  EXECUTE format('CREATE POLICY strategy_plan_deliberations_leitura ON core.strategy_plan_deliberations FOR SELECT TO %I USING (%s)', papel, condicao);
  EXECUTE format('CREATE POLICY strategy_plan_deliberations_insercao ON core.strategy_plan_deliberations FOR INSERT TO %I WITH CHECK (%s)', papel, condicao);
  REVOKE ALL ON core.strategy_plan_deliberations FROM PUBLIC;
  EXECUTE format('REVOKE ALL ON core.strategy_plan_deliberations FROM %I', papel);
  EXECUTE format('GRANT SELECT, INSERT ON core.strategy_plan_deliberations TO %I', papel);
END $$;

CREATE OR REPLACE FUNCTION core.strategy_plan_deliberacao_autoridade()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF core.decisao_chamador_e_app() AND NOT core.decisao_chamador_e_worker() THEN
    RAISE EXCEPTION 'deliberação do comitê só pela credencial do worker (agente com execução ativa)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF nullif(current_setting('app.user_id', true), '') IS NOT NULL THEN
    RAISE EXCEPTION 'deliberação do comitê é escrita de agente; a sessão não pode carregar app.user_id' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION core.strategy_plan_deliberacao_autoridade IS
  'BEFORE INSERT de core.strategy_plan_deliberations (gatilho a_autoridade, depois de a0_inquilino e antes de b_antes), sem SECURITY DEFINER para enxergar o papel real: o papel do app sem a credencial do worker é negado e a sessão não pode carregar app.user_id (só o agente grava). Superusuário passa (migração e testes).';

CREATE OR REPLACE FUNCTION core.strategy_plan_deliberacao_antes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_ficha_texto text;
  v_ficha       integer;
  v_achou       integer;
  v_status      text;
  v_total       integer;
BEGIN
  v_ficha_texto := nullif(current_setting('orla.ficha_execucao', true), '');
  IF v_ficha_texto IS NULL THEN
    IF NOT coalesce((SELECT r.rolsuper FROM pg_roles r WHERE r.rolname = session_user), false) THEN
      RAISE EXCEPTION 'escrita de agente exige execução ativa e a ficha da reserva (orla.ficha_execucao) na transação' USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF v_ficha_texto !~ '^[0-9]{1,5}$' THEN
    RAISE EXCEPTION 'escrita de agente exige execução ativa e ficha válida (orla.ficha_execucao é inteiro)' USING ERRCODE = 'insufficient_privilege';
  ELSE
    v_ficha := v_ficha_texto::integer;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('orla:strategy_plan'), hashtext(NEW.client_id::text));
  SELECT 1 INTO v_achou FROM core.strategy_plan_runs r
   WHERE r.id = NEW.execution_id AND r.agent_run_id = NEW.agent_run_id AND r.plan_id = NEW.plan_id
     AND r.organization_id = NEW.organization_id AND r.client_id = NEW.client_id
     AND r.status = 'rodando' AND r.lease_until > now()
     AND (v_ficha IS NULL OR r.tentativas = v_ficha)
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'escrita de agente exige execução ativa deste plano (rodando, lease vigente, mesmo agent_run_id e ficha igual a tentativas)' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT v.status INTO v_status FROM core.strategy_plan_versions v
   WHERE v.id = NEW.version_id AND v.plan_id = NEW.plan_id
     AND v.organization_id = NEW.organization_id AND v.client_id = NEW.client_id AND v.redacted_at IS NULL;
  IF v_status IS DISTINCT FROM 'rascunho' THEN
    RAISE EXCEPTION 'deliberação do comitê só vale em versão rascunho do mesmo plano (está %)', coalesce(v_status, 'inexistente') USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.rodada = 0 AND (jsonb_typeof(NEW.payload->'persona') IS DISTINCT FROM 'string' OR NEW.payload->>'persona' IS DISTINCT FROM NEW.membro
       OR NEW.payload->>'veredito' NOT IN ('aprova', 'aprova_com_ajuste', 'reprova')) THEN
    RAISE EXCEPTION 'parecer de membro exige payload.persona igual ao membro e veredito válido' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.rodada > 0 AND (NEW.payload->>'comite' IS DISTINCT FROM NEW.comite OR (NEW.payload->>'rodada') IS DISTINCT FROM NEW.rodada::text
       OR jsonb_typeof(NEW.payload->'debate') IS DISTINCT FROM 'array') THEN
    RAISE EXCEPTION 'rodada da mesa exige payload.comite e payload.rodada iguais aos da linha e debate em lista' USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO v_total FROM core.strategy_plan_deliberations d WHERE d.version_id = NEW.version_id;
  IF v_total >= 160 THEN
    RAISE EXCEPTION 'teto de deliberações por versão atingido (160)' USING ERRCODE = 'ORT01';
  END IF;

  NEW.created_at := clock_timestamp();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION core.strategy_plan_deliberacao_antes IS
  'BEFORE INSERT de core.strategy_plan_deliberations (gatilho b_antes, depois de a0_inquilino e a_autoridade). Mesma regra de core.strategy_plan_agente_com_execucao: ficha (orla.ficha_execucao) obrigatória e inteira fora do superusuário, trava consultiva do cliente e depois a linha da execução (mesma id, agent_run_id, plano, organização e cliente, rodando, lease vigente e tentativas igual à ficha) lida com FOR SHARE; senão 42501. A versão tem de ser rascunho não redigido do mesmo plano. Rodada 0 exige payload.persona igual ao membro e veredito válido; rodadas 1 e 2 exigem payload.comite e payload.rodada iguais aos da linha. Teto de 160 linhas por versão (ORT01). SECURITY DEFINER para ler a execução sem depender da RLS; compara organização, cliente e plano explicitamente.';

REVOKE ALL ON FUNCTION core.strategy_plan_deliberacao_antes() FROM PUBLIC;

CREATE OR REPLACE FUNCTION core.strategy_plan_deliberacao_imutavel()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF core.decisao_chamador_e_app() THEN
    RAISE EXCEPTION 'deliberação do comitê é imutável para o app' USING ERRCODE = 'restrict_violation';
  END IF;
  IF current_setting('orla.redigindo_plano', true) = OLD.version_id::text
     AND NEW.payload = '{"redigido": true}'::jsonb
     AND (to_jsonb(NEW) - 'payload') = (to_jsonb(OLD) - 'payload') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'deliberação do comitê é imutável' USING ERRCODE = 'restrict_violation';
END;
$$;

COMMENT ON FUNCTION core.strategy_plan_deliberacao_imutavel IS
  'BEFORE UPDATE de core.strategy_plan_deliberations: nega o app e o worker sempre; para os demais nega tudo, exceto a redação LGPD do payload dentro de core.redigir_plano (marca orla.redigindo_plano com o id da versão, local à transação).';

DROP TRIGGER IF EXISTS strategy_plan_deliberations_a0_inquilino ON core.strategy_plan_deliberations;
CREATE TRIGGER strategy_plan_deliberations_a0_inquilino BEFORE INSERT ON core.strategy_plan_deliberations
  FOR EACH ROW EXECUTE FUNCTION core.strategy_plan_inquilino();
DROP TRIGGER IF EXISTS strategy_plan_deliberations_a_autoridade ON core.strategy_plan_deliberations;
CREATE TRIGGER strategy_plan_deliberations_a_autoridade BEFORE INSERT ON core.strategy_plan_deliberations
  FOR EACH ROW EXECUTE FUNCTION core.strategy_plan_deliberacao_autoridade();
DROP TRIGGER IF EXISTS strategy_plan_deliberations_b_antes ON core.strategy_plan_deliberations;
CREATE TRIGGER strategy_plan_deliberations_b_antes BEFORE INSERT ON core.strategy_plan_deliberations
  FOR EACH ROW EXECUTE FUNCTION core.strategy_plan_deliberacao_antes();
DROP TRIGGER IF EXISTS strategy_plan_deliberations_imutavel ON core.strategy_plan_deliberations;
CREATE TRIGGER strategy_plan_deliberations_imutavel BEFORE UPDATE ON core.strategy_plan_deliberations
  FOR EACH ROW EXECUTE FUNCTION core.strategy_plan_deliberacao_imutavel();
DROP TRIGGER IF EXISTS strategy_plan_deliberations_nao_apaga ON core.strategy_plan_deliberations;
CREATE TRIGGER strategy_plan_deliberations_nao_apaga BEFORE DELETE ON core.strategy_plan_deliberations
  FOR EACH ROW EXECUTE FUNCTION core.strategy_plan_nao_apaga();

CREATE TABLE IF NOT EXISTS core.strategy_committee_settings (
  organization_id  uuid NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
  comite           text NOT NULL CHECK (comite ~ '^[a-z][a-z0-9_]{1,47}$'),
  ligado           boolean NOT NULL,
  atualizado_por   uuid REFERENCES core.users(id) ON DELETE SET NULL,
  atualizado_em    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, comite),
  CONSTRAINT strategy_committee_settings_risco_legal_ligado CHECK (comite <> 'risco_legal' OR ligado)
);

COMMENT ON TABLE core.strategy_committee_settings IS
  'Liga e desliga, por organização, cada comitê do planejador (24K-134). Sem linha o comitê está ligado. risco_legal nunca fica desligado (CHECK, gatilho e serviço). Escrita só de owner ou admin pela Config da IA, com auditoria; o worker só lê.';

DO $$
DECLARE
  papel text := current_setting('comites.papel_app');
BEGIN
  ALTER TABLE core.strategy_committee_settings ENABLE ROW LEVEL SECURITY;
  ALTER TABLE core.strategy_committee_settings FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS strategy_committee_settings_tenant ON core.strategy_committee_settings;
  EXECUTE format(
    'CREATE POLICY strategy_committee_settings_tenant ON core.strategy_committee_settings FOR ALL TO %I
       USING (organization_id = core.current_organization() AND core.current_clients() IS NULL)
       WITH CHECK (organization_id = core.current_organization() AND core.current_clients() IS NULL)', papel);
  REVOKE ALL ON core.strategy_committee_settings FROM PUBLIC;
  EXECUTE format('REVOKE ALL ON core.strategy_committee_settings FROM %I', papel);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON core.strategy_committee_settings TO %I', papel);
END $$;

CREATE OR REPLACE FUNCTION core.strategy_committee_setting_escrita()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_usuario uuid;
BEGIN
  IF NEW.comite = 'risco_legal' AND NOT NEW.ligado THEN
    RAISE EXCEPTION 'o comitê de risco e legal não pode ser desligado' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.comite IS DISTINCT FROM OLD.comite) THEN
    RAISE EXCEPTION 'organização e comitê da configuração não mudam' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NOT core.decisao_chamador_e_app() THEN
    RETURN NEW;
  END IF;
  IF NEW.organization_id IS DISTINCT FROM core.current_organization() THEN
    RAISE EXCEPTION 'organização fora do contexto da sessão' USING ERRCODE = 'insufficient_privilege';
  END IF;
  v_usuario := nullif(current_setting('app.user_id', true), '')::uuid;
  IF v_usuario IS NULL OR NOT EXISTS (
       SELECT 1 FROM core.memberships_of(v_usuario) m
        WHERE m.organization_id = NEW.organization_id AND m.role IN ('owner', 'admin')) THEN
    RAISE EXCEPTION 'ligar ou desligar comitê exige papel owner ou admin' USING ERRCODE = 'insufficient_privilege';
  END IF;
  NEW.atualizado_por := v_usuario;
  NEW.atualizado_em := now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION core.strategy_committee_setting_escrita IS
  'BEFORE INSERT OR UPDATE de core.strategy_committee_settings, sem SECURITY DEFINER (enxerga o papel real). Para qualquer chamador: risco_legal desligado é recusado (23514) e organização e comitê não mudam. Para o app e o worker: organização igual à da sessão e app.user_id de membro vivo com papel owner ou admin (core.memberships_of); o worker, sem pessoa, não escreve. Fixa atualizado_por e atualizado_em. O ON DELETE SET NULL do usuário roda como dono da tabela e não passa pela checagem de papel. Superusuário passa direto (migração e testes).';

DROP TRIGGER IF EXISTS strategy_committee_settings_escrita ON core.strategy_committee_settings;
CREATE TRIGGER strategy_committee_settings_escrita BEFORE INSERT OR UPDATE ON core.strategy_committee_settings
  FOR EACH ROW EXECUTE FUNCTION core.strategy_committee_setting_escrita();

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
    UPDATE core.strategy_plan_deliberations
       SET payload = '{"redigido": true}'::jsonb
     WHERE version_id = v_id AND payload <> '{"redigido": true}'::jsonb;
    PERFORM set_config('orla.redigindo_plano', '', true);
  END LOOP;

  PERFORM set_config('orla.redigindo_plano', v_ver.plan_id::text, true);
  UPDATE core.strategy_plans SET whatsapp = NULL
   WHERE id = v_ver.plan_id AND organization_id = v_ver.organization_id AND client_id = v_ver.client_id AND whatsapp IS NOT NULL;
  PERFORM set_config('orla.redigindo_plano', '', true);
END;
$$;

COMMENT ON FUNCTION core.redigir_plano IS
  'Redação LGPD do Strategy Plan (ADR 0056 §10, molde de core.redigir_decisao): redige a versão e todas as versões do mesmo plano (plan_id), com ou sem supersedes_id. Em cada versão ainda não redigida troca content por {"redigido": true}, marca redacted_at e grava um evento redigida (com o motivo) como auditoria; em TODAS as versões do plano, inclusive as já redigidas, troca por {"redigido": true} o payload de qualquer evento e de qualquer deliberação de comitê (core.strategy_plan_deliberations, 0153) ainda não redigidos. Por fim anula o whatsapp do plano (0150). Idempotente: sem versão nova a redigir, não grava evento redigida. Só o worker executa; o app não tem EXECUTE.';

COMMIT;
