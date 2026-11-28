BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  PERFORM set_config(
    'producao.papel_app',
    (SELECT rolname FROM pg_roles WHERE rolname IN ('orla_app', 'tria_app') ORDER BY rolname = 'orla_app' DESC LIMIT 1),
    true
  );
  PERFORM set_config(
    'producao.papel_worker',
    (SELECT rolname FROM pg_roles WHERE rolname IN ('orla_worker', 'tria_worker') ORDER BY rolname = 'orla_worker' DESC LIMIT 1),
    true
  );
  IF current_setting('producao.papel_app') = '' OR current_setting('producao.papel_worker') = '' THEN
    RAISE EXCEPTION 'papeis do app e do worker ausentes; as migracoes 0070 e anteriores precisam ter rodado';
  END IF;
  IF to_regclass('core.strategy_plan_deliberations') IS NULL OR to_regprocedure('core.strategy_plan_inquilino()') IS NULL
     OR to_regprocedure('core.strategy_plan_nao_apaga()') IS NULL OR to_regprocedure('core.redigir_plano(uuid,text)') IS NULL
     OR to_regprocedure('core.memberships_of(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Strategy Plan ausente; as migracoes 0143 a 0153 precisam ter rodado';
  END IF;
  IF to_regprocedure('core.decisao_chamador_e_app()') IS NULL OR to_regprocedure('core.decisao_chamador_e_worker()') IS NULL THEN
    RAISE EXCEPTION 'core.decisao_chamador_e_app ou _worker ausente; a migracao 0141 precisa ter rodado';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS core.strategy_production_plans (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES core.organizations(id) ON DELETE RESTRICT,
  client_id        uuid NOT NULL REFERENCES core.clients(id) ON DELETE CASCADE,
  plan_id          uuid NOT NULL,
  version_id       uuid NOT NULL,
  numero           integer NOT NULL CHECK (numero BETWEEN 1 AND 1000),
  status           text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'pronto', 'falhou')),
  conteudo         jsonb CHECK (conteudo IS NULL OR (jsonb_typeof(conteudo) = 'object' AND pg_column_size(conteudo) <= 262144)),
  progresso        jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(progresso) = 'object' AND pg_column_size(progresso) <= 262144),
  erro_codigo      text CHECK (erro_codigo IS NULL OR erro_codigo IN
                     ('ia_nao_configurada', 'ia_limite', 'ia_saida_invalida', 'ia_falha', 'ia_tempo', 'brain_indisponivel',
                      'conferencia_reprovada', 'plano_fora_do_estado', 'plano_sem_campanhas', 'interno')),
  motivo           text CHECK (motivo IS NULL OR motivo ~ '^[A-Za-z0-9_.:;,=-]{1,240}$'),
  tentativas       smallint NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
  falhas           smallint NOT NULL DEFAULT 0 CHECK (falhas >= 0),
  lease_until      timestamptz,
  agent_run_id     text NOT NULL CHECK (agent_run_id ~ '^[A-Za-z0-9._:-]{1,120}$'),
  requested_by     uuid REFERENCES core.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  concluido_em     timestamptz,
  redigido_em      timestamptz,
  CONSTRAINT strategy_production_plans_plano_fk FOREIGN KEY (plan_id, organization_id, client_id)
    REFERENCES core.strategy_plans (id, organization_id, client_id) ON DELETE CASCADE,
  CONSTRAINT strategy_production_plans_versao_fk FOREIGN KEY (version_id, organization_id, client_id)
    REFERENCES core.strategy_plan_versions (id, organization_id, client_id) ON DELETE CASCADE,
  CONSTRAINT strategy_production_plans_agent_run_id_key UNIQUE (agent_run_id),
  CONSTRAINT strategy_production_plans_numero_unico UNIQUE (version_id, numero),
  CONSTRAINT strategy_production_plans_pendente_sem_resultado CHECK (status <> 'pendente' OR (conteudo IS NULL AND erro_codigo IS NULL AND concluido_em IS NULL)),
  CONSTRAINT strategy_production_plans_pronto_com_conteudo CHECK (status <> 'pronto' OR (conteudo IS NOT NULL AND erro_codigo IS NULL AND lease_until IS NULL AND concluido_em IS NOT NULL)),
  CONSTRAINT strategy_production_plans_falha_com_codigo CHECK (status <> 'falhou' OR (erro_codigo IS NOT NULL AND conteudo IS NULL AND lease_until IS NULL AND concluido_em IS NOT NULL))
);

COMMENT ON TABLE core.strategy_production_plans IS
  'Plano de produção (Production Director, ADR 0074): etapa própria depois dos Gates, gerada sob demanda a partir de uma versão vigente (autorizada) do plano. Cada geração é uma linha nova (numero sobe por versão do plano), nunca sobrescreve. Pessoa (owner, admin ou operator) só insere o pedido pendente; o worker reserva com lease e ficha (tentativas), grava o progresso por campanha e termina em pronto (conteudo) ou falhou (erro_codigo e motivo compacto, sem texto do modelo). Estado final é imutável; só a redação LGPD (core.redigir_plano) troca conteudo e progresso. Sem DELETE: some com o cliente no expurgo.';
COMMENT ON COLUMN core.strategy_production_plans.conteudo IS
  'Plano de produção conferido pelo domínio (entregáveis, roteiros, prompts, referências por URN do pacote, ferramentas, custos e workflow por campanha). Texto do modelo: nunca vai para auditoria nem log; a redação o troca por {"redigido": true}.';
COMMENT ON COLUMN core.strategy_production_plans.progresso IS
  'Resultados já conferidos por campanha enquanto a geração está pendente, para retomar sem pagar de novo; esvazia ao terminar.';
COMMENT ON COLUMN core.strategy_production_plans.motivo IS
  'Motivo compacto da falha (códigos e caminhos, lista fechada de caracteres); nunca texto do modelo.';
COMMENT ON COLUMN core.strategy_production_plans.tentativas IS
  'Reservas do worker; é a ficha que cerca as escritas. Acima de 40 o gatilho encerra a geração como falhou/interno (cada reserva produz ao menos uma campanha; o plano tem até 30).';

CREATE UNIQUE INDEX IF NOT EXISTS strategy_production_plans_uma_pendente
  ON core.strategy_production_plans (plan_id) WHERE status = 'pendente';
CREATE INDEX IF NOT EXISTS strategy_production_plans_plano
  ON core.strategy_production_plans (plan_id, created_at DESC);
CREATE INDEX IF NOT EXISTS strategy_production_plans_fila
  ON core.strategy_production_plans (created_at) WHERE status = 'pendente';
CREATE INDEX IF NOT EXISTS strategy_production_plans_cliente
  ON core.strategy_production_plans (client_id, created_at DESC);

DO $$
DECLARE
  papel text := current_setting('producao.papel_app');
  papel_worker text := current_setting('producao.papel_worker');
  condicao text := 'organization_id = core.current_organization() AND core.cliente_no_escopo(client_id)
                AND EXISTS (SELECT 1 FROM core.clients c WHERE c.id = strategy_production_plans.client_id AND c.organization_id = strategy_production_plans.organization_id)';
BEGIN
  ALTER TABLE core.strategy_production_plans ENABLE ROW LEVEL SECURITY;
  ALTER TABLE core.strategy_production_plans FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS strategy_production_plans_leitura ON core.strategy_production_plans;
  DROP POLICY IF EXISTS strategy_production_plans_insercao ON core.strategy_production_plans;
  DROP POLICY IF EXISTS strategy_production_plans_atualizacao ON core.strategy_production_plans;
  EXECUTE format('CREATE POLICY strategy_production_plans_leitura ON core.strategy_production_plans FOR SELECT TO %I USING (%s)', papel, condicao);
  EXECUTE format('CREATE POLICY strategy_production_plans_insercao ON core.strategy_production_plans FOR INSERT TO %I WITH CHECK (%s)', papel, condicao);
  EXECUTE format('CREATE POLICY strategy_production_plans_atualizacao ON core.strategy_production_plans FOR UPDATE TO %I USING (%s) WITH CHECK (%s)', papel, condicao, condicao);
  REVOKE ALL ON core.strategy_production_plans FROM PUBLIC;
  EXECUTE format('REVOKE ALL ON core.strategy_production_plans FROM %I', papel);
  EXECUTE format('REVOKE ALL ON core.strategy_production_plans FROM %I', papel_worker);
  EXECUTE format('GRANT SELECT, INSERT ON core.strategy_production_plans TO %I', papel);
  EXECUTE format('GRANT UPDATE (status, conteudo, progresso, erro_codigo, motivo, tentativas, falhas, lease_until, updated_at, concluido_em) ON core.strategy_production_plans TO %I', papel_worker);
END $$;

CREATE OR REPLACE FUNCTION core.strategy_production_plan_insercao()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_usuario uuid;
  v_status  text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('orla:strategy_producao'), hashtext(NEW.version_id::text));
  SELECT coalesce(max(p.numero), 0) + 1 INTO NEW.numero
    FROM core.strategy_production_plans p WHERE p.version_id = NEW.version_id;

  IF NOT core.decisao_chamador_e_app() THEN
    RETURN NEW;
  END IF;
  IF core.decisao_chamador_e_worker() THEN
    RAISE EXCEPTION 'plano de produção nasce do pedido de uma pessoa, nunca do worker' USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_usuario := nullif(current_setting('app.user_id', true), '')::uuid;
  IF v_usuario IS NULL OR NEW.requested_by IS DISTINCT FROM v_usuario THEN
    RAISE EXCEPTION 'pedido de plano de produção exige requested_by igual ao usuário da sessão' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM core.memberships_of(v_usuario) m
        WHERE m.organization_id = NEW.organization_id AND m.role IN ('owner', 'admin', 'operator')) THEN
    RAISE EXCEPTION 'pedir plano de produção exige papel owner, admin ou operator' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.status <> 'pendente' OR NEW.conteudo IS NOT NULL OR NEW.progresso <> '{}'::jsonb OR NEW.erro_codigo IS NOT NULL
     OR NEW.motivo IS NOT NULL OR NEW.tentativas <> 0 OR NEW.falhas <> 0 OR NEW.lease_until IS NOT NULL
     OR NEW.concluido_em IS NOT NULL OR NEW.redigido_em IS NOT NULL THEN
    RAISE EXCEPTION 'plano de produção nasce pendente, sem conteúdo, progresso, erro nem lease' USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM core.strategy_plans pl
                  WHERE pl.id = NEW.plan_id AND pl.organization_id = NEW.organization_id AND pl.client_id = NEW.client_id
                    AND pl.removido_em IS NULL) THEN
    RAISE EXCEPTION 'plano inexistente ou removido' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT v.status INTO v_status FROM core.strategy_plan_versions v
   WHERE v.id = NEW.version_id AND v.plan_id = NEW.plan_id
     AND v.organization_id = NEW.organization_id AND v.client_id = NEW.client_id AND v.redacted_at IS NULL;
  IF v_status IS DISTINCT FROM 'vigente' THEN
    RAISE EXCEPTION 'plano de produção só nasce de versão vigente do mesmo plano (está %)', coalesce(v_status, 'inexistente') USING ERRCODE = 'check_violation';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION core.strategy_production_plan_insercao IS
  'BEFORE INSERT de core.strategy_production_plans (gatilho b_insercao, depois de a0_inquilino), sem SECURITY DEFINER para enxergar o papel real. Para qualquer chamador: trava consultiva da versão e numero = maior da versão + 1. Para o app: o worker não insere; requested_by é o app.user_id de membro vivo com papel owner, admin ou operator (core.memberships_of); nasce pendente sem conteúdo, progresso, erro, motivo, lease nem andamento; o plano existe e não foi removido; a versão é vigente, do mesmo plano e não redigida. Superusuário só recebe o numero.';

CREATE OR REPLACE FUNCTION core.strategy_production_plan_atualizacao()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_novo      jsonb := to_jsonb(NEW);
  v_velho     jsonb := to_jsonb(OLD);
  v_do_worker text[] := ARRAY['status', 'conteudo', 'progresso', 'erro_codigo', 'motivo', 'tentativas', 'falhas', 'lease_until', 'updated_at', 'concluido_em'];
  v_reserva   boolean;
BEGIN
  IF NOT core.decisao_chamador_e_app() THEN
    IF NEW.requested_by IS NULL AND OLD.requested_by IS NOT NULL AND (v_novo - 'requested_by') = (v_velho - 'requested_by') THEN
      RETURN NEW;
    END IF;
    IF current_setting('orla.redigindo_plano', true) = OLD.version_id::text
       AND (NEW.conteudo IS NULL OR NEW.conteudo = '{"redigido": true}'::jsonb)
       AND NEW.progresso = '{}'::jsonb AND NEW.redigido_em IS NOT NULL
       AND (v_novo - 'conteudo' - 'progresso' - 'redigido_em') = (v_velho - 'conteudo' - 'progresso' - 'redigido_em') THEN
      RETURN NEW;
    END IF;
    IF current_setting('orla.redigindo_plano', true) = OLD.version_id::text AND OLD.status = 'pendente'
       AND NEW.status = 'falhou' AND NEW.erro_codigo = 'plano_fora_do_estado' AND NEW.motivo = 'redigido'
       AND NEW.conteudo IS NULL AND NEW.progresso = '{}'::jsonb AND NEW.lease_until IS NULL
       AND NEW.concluido_em IS NOT NULL AND NEW.redigido_em IS NOT NULL
       AND (v_novo - 'status' - 'erro_codigo' - 'motivo' - 'progresso' - 'lease_until' - 'concluido_em' - 'redigido_em' - 'updated_at')
         = (v_velho - 'status' - 'erro_codigo' - 'motivo' - 'progresso' - 'lease_until' - 'concluido_em' - 'redigido_em' - 'updated_at') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'plano de produção é imutável fora do worker' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NOT core.decisao_chamador_e_worker() THEN
    RAISE EXCEPTION 'só o worker atualiza o plano de produção' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status <> 'pendente' THEN
    RAISE EXCEPTION 'plano de produção em estado final (%) não muda', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.redigido_em IS NOT NULL THEN
    RAISE EXCEPTION 'plano de produção redigido não muda' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.lease_until IS NOT NULL AND NEW.lease_until > now() + interval '15 minutes' THEN
    RAISE EXCEPTION 'lease do plano de produção vale no máximo 15 minutos' USING ERRCODE = 'check_violation';
  END IF;
  IF (v_novo - v_do_worker) <> (v_velho - v_do_worker) THEN
    RAISE EXCEPTION 'o worker só muda status, conteúdo, progresso, erro, motivo, tentativas, falhas, lease e conclusão' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.tentativas < OLD.tentativas OR NEW.falhas < OLD.falhas THEN
    RAISE EXCEPTION 'tentativas e falhas só crescem' USING ERRCODE = 'check_violation';
  END IF;

  v_reserva := NEW.tentativas <> OLD.tentativas;
  IF v_reserva THEN
    IF NEW.tentativas <> OLD.tentativas + 1 OR NEW.status <> 'pendente' OR NEW.lease_until IS NULL OR NEW.lease_until <= now()
       OR (OLD.lease_until IS NOT NULL AND OLD.lease_until > now()) THEN
      RAISE EXCEPTION 'reserva sobe tentativas em 1, só com o lease livre ou vencido, e fixa um lease futuro' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.tentativas > 40 THEN
      NEW.status := 'falhou';
      NEW.erro_codigo := 'interno';
      NEW.motivo := 'teto_de_reservas';
      NEW.lease_until := NULL;
      NEW.conteudo := NULL;
      NEW.concluido_em := now();
    END IF;
  ELSIF OLD.lease_until IS NULL OR OLD.lease_until <= now() THEN
    RAISE EXCEPTION 'escrita do worker exige o lease vigente da reserva' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.status = 'pronto' THEN
    IF NEW.conteudo IS NULL OR NEW.progresso <> '{}'::jsonb OR NEW.lease_until IS NOT NULL THEN
      RAISE EXCEPTION 'pronto exige conteúdo, progresso vazio e lease liberado' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM core.strategy_plan_versions v
                    WHERE v.id = NEW.version_id AND v.organization_id = NEW.organization_id AND v.redacted_at IS NULL) THEN
      RAISE EXCEPTION 'versão redigida não recebe plano de produção' USING ERRCODE = 'check_violation';
    END IF;
    NEW.concluido_em := now();
  ELSIF NEW.status = 'falhou' THEN
    NEW.progresso := '{}'::jsonb;
    NEW.lease_until := NULL;
    NEW.concluido_em := now();
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION core.strategy_production_plan_atualizacao IS
  'BEFORE UPDATE de core.strategy_production_plans, sem SECURITY DEFINER. Fora do app e do worker só vale o SET NULL de requested_by e a redação LGPD (orla.redigindo_plano igual à versão, conteudo e progresso redigidos, redigido_em preenchido). O app sem a credencial do worker não muda nada. O worker: só a partir de pendente, só as colunas de andamento, tentativas e falhas só crescem; a reserva sobe tentativas em 1 com o lease livre ou vencido e fixa lease futuro (acima de 40 reservas encerra como falhou/interno; lease de no máximo 15 minutos; linha redigida não muda); qualquer outra escrita exige o lease vigente; pronto exige conteúdo, progresso vazio, lease liberado e versão não redigida; pronto e falhou fixam concluido_em. updated_at é now().';

CREATE OR REPLACE FUNCTION core.strategy_producao_pendentes(p_limite integer)
RETURNS TABLE (organization_id uuid, client_id uuid, id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT p.organization_id, p.client_id, p.id
    FROM core.strategy_production_plans p
   WHERE p.status = 'pendente'
     AND (p.lease_until IS NULL OR p.lease_until < now())
     AND p.tentativas <= 40
     AND EXISTS (SELECT 1 FROM core.clients c WHERE c.id = p.client_id AND c.excluido_em IS NULL)
     AND EXISTS (SELECT 1 FROM core.strategy_plans pl WHERE pl.id = p.plan_id AND pl.removido_em IS NULL)
   ORDER BY p.created_at, p.id
   LIMIT greatest(least(coalesce(p_limite, 0), 20), 0)
$$;

COMMENT ON FUNCTION core.strategy_producao_pendentes IS
  'Descoberta de trabalho do worker entre inquilinos (molde de core.strategy_runs_pendentes): só (organization_id, client_id, id) dos planos de produção pendentes com lease livre ou vencido, de cliente não excluído e plano não removido, no teto de reservas, mais antigos primeiro, no máximo least(p_limite, 20). Teto de 40 reservas. Nenhum conteúdo. SECURITY DEFINER; EXECUTE só do worker.';

DO $$
BEGIN
  REVOKE ALL ON FUNCTION core.strategy_producao_pendentes(integer) FROM PUBLIC;
  EXECUTE format('REVOKE ALL ON FUNCTION core.strategy_producao_pendentes(integer) FROM %I', current_setting('producao.papel_app'));
  EXECUTE format('GRANT EXECUTE ON FUNCTION core.strategy_producao_pendentes(integer) TO %I', current_setting('producao.papel_worker'));
END $$;

DROP TRIGGER IF EXISTS strategy_production_plans_a0_inquilino ON core.strategy_production_plans;
CREATE TRIGGER strategy_production_plans_a0_inquilino BEFORE INSERT ON core.strategy_production_plans
  FOR EACH ROW EXECUTE FUNCTION core.strategy_plan_inquilino();
DROP TRIGGER IF EXISTS strategy_production_plans_b_insercao ON core.strategy_production_plans;
CREATE TRIGGER strategy_production_plans_b_insercao BEFORE INSERT ON core.strategy_production_plans
  FOR EACH ROW EXECUTE FUNCTION core.strategy_production_plan_insercao();
DROP TRIGGER IF EXISTS strategy_production_plans_atualizacao ON core.strategy_production_plans;
CREATE TRIGGER strategy_production_plans_atualizacao BEFORE UPDATE ON core.strategy_production_plans
  FOR EACH ROW EXECUTE FUNCTION core.strategy_production_plan_atualizacao();
DROP TRIGGER IF EXISTS strategy_production_plans_nao_apaga ON core.strategy_production_plans;
CREATE TRIGGER strategy_production_plans_nao_apaga BEFORE DELETE ON core.strategy_production_plans
  FOR EACH ROW EXECUTE FUNCTION core.strategy_plan_nao_apaga();

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
    UPDATE core.strategy_production_plans
       SET status = 'falhou', erro_codigo = 'plano_fora_do_estado', motivo = 'redigido', progresso = '{}'::jsonb,
           lease_until = NULL, concluido_em = now(), redigido_em = now()
     WHERE version_id = v_id AND status = 'pendente' AND redigido_em IS NULL;
    UPDATE core.strategy_production_plans
       SET conteudo = CASE WHEN conteudo IS NULL THEN NULL ELSE '{"redigido": true}'::jsonb END,
           progresso = '{}'::jsonb,
           redigido_em = coalesce(redigido_em, now())
     WHERE version_id = v_id AND redigido_em IS NULL;
    PERFORM set_config('orla.redigindo_plano', '', true);
  END LOOP;

  PERFORM set_config('orla.redigindo_plano', v_ver.plan_id::text, true);
  UPDATE core.strategy_plans SET whatsapp = NULL
   WHERE id = v_ver.plan_id AND organization_id = v_ver.organization_id AND client_id = v_ver.client_id AND whatsapp IS NOT NULL;
  PERFORM set_config('orla.redigindo_plano', '', true);
END;
$$;

COMMENT ON FUNCTION core.redigir_plano IS
  'Redação LGPD do Strategy Plan (ADR 0056 §10, molde de core.redigir_decisao): redige a versão e todas as versões do mesmo plano (plan_id), com ou sem supersedes_id. Em cada versão ainda não redigida troca content por {"redigido": true}, marca redacted_at e grava um evento redigida (com o motivo) como auditoria; em TODAS as versões do plano, inclusive as já redigidas, troca por {"redigido": true} o payload de qualquer evento e de qualquer deliberação de comitê (core.strategy_plan_deliberations, 0153) ainda não redigidos, e o conteúdo e o progresso de todo plano de produção (core.strategy_production_plans, 0154) ainda não redigido, marcando redigido_em; a geração ainda pendente é encerrada como falhou/plano_fora_do_estado (motivo redigido), e o gatilho recusa qualquer escrita do worker em linha redigida. Por fim anula o whatsapp do plano (0150). Idempotente: sem versão nova a redigir, não grava evento redigida. Só o worker executa; o app não tem EXECUTE.';

COMMIT;
