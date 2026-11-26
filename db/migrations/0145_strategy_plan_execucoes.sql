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
  IF to_regclass('core.strategy_plan_versions') IS NULL OR to_regprocedure('core.strategy_plan_inquilino()') IS NULL THEN
    RAISE EXCEPTION 'core.strategy_plan_versions ausente; a migracao 0143 precisa ter rodado';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS core.strategy_plan_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES core.organizations(id) ON DELETE RESTRICT,
  client_id        uuid NOT NULL REFERENCES core.clients(id) ON DELETE CASCADE,
  plan_id          uuid NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('criar', 'ajustar', 'revisar')),
  pedido           jsonb NOT NULL CHECK (
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
                           AND (pedido - 'motivo') = '{}'::jsonb))),
  base_version_id  uuid,
  status           text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'rodando', 'concluida', 'falhou', 'cancelada')),
  etapa            text NOT NULL DEFAULT 'ler_brain' CHECK (etapa IN ('ler_brain', 'redigir', 'comite', 'ajustar', 'gates', 'fim')),
  rodada           smallint NOT NULL DEFAULT 0 CHECK (rodada >= 0),
  tentativas       smallint NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
  falhas           smallint NOT NULL DEFAULT 0 CHECK (falhas >= 0),
  erro_codigo      text CHECK (erro_codigo IS NULL OR erro_codigo IN
                     ('ia_nao_configurada', 'ia_limite', 'ia_saida_invalida', 'ia_falha', 'ia_tempo', 'brain_indisponivel', 'gate_reprovado', 'interno')),
  agent_run_id     text NOT NULL CHECK (agent_run_id ~ '^[A-Za-z0-9._:-]{1,120}$'),
  requested_by     uuid REFERENCES core.users(id) ON DELETE SET NULL,
  requested_kind   text NOT NULL CHECK (requested_kind IN ('usuario', 'sistema')),
  lease_until      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT strategy_plan_runs_plano_fk FOREIGN KEY (plan_id, organization_id, client_id)
    REFERENCES core.strategy_plans (id, organization_id, client_id) ON DELETE CASCADE,
  CONSTRAINT strategy_plan_runs_versao_base_fk FOREIGN KEY (base_version_id, organization_id, client_id)
    REFERENCES core.strategy_plan_versions (id, organization_id, client_id) ON DELETE CASCADE,
  CONSTRAINT strategy_plan_runs_agent_run_id_key UNIQUE (agent_run_id),
  CONSTRAINT strategy_plan_runs_falha_com_codigo CHECK (status <> 'falhou' OR erro_codigo IS NOT NULL),
  CONSTRAINT strategy_plan_runs_concluida_sem_erro CHECK (status <> 'concluida' OR (erro_codigo IS NULL AND etapa = 'fim')),
  CONSTRAINT strategy_plan_runs_sistema_sem_pessoa CHECK (requested_kind <> 'sistema' OR requested_by IS NULL)
);

COMMENT ON TABLE core.strategy_plan_runs IS
  'Pedido de trabalho longo do agente sobre um plano (ADR 0062 §9): criar, ajustar ou revisar. Pessoa insere (owner, admin ou operator) e só cancela; o worker reserva com lease e avança status e etapa. No máximo uma execução ativa (pendente ou rodando) por plano. Sem DELETE (só o expurgo do cliente leva). pedido vira {"redigido": true} quando uma versão do plano é redigida (LGPD).';
COMMENT ON COLUMN core.strategy_plan_runs.kind IS
  'criar: pedido é a intenção validada pelo esquema do domínio; ajustar: pedido é {instrucao}; revisar: pedido é {motivo}.';
COMMENT ON COLUMN core.strategy_plan_runs.pedido IS
  'Até 8 KB. Contém texto livre da pessoa (objetivo da intenção ou instrução de ajuste), por isso a redação de qualquer versão do plano o troca por {"redigido": true}. Nunca vai para auditoria nem para log.';
COMMENT ON COLUMN core.strategy_plan_runs.base_version_id IS
  'Versão do mesmo plano sobre a qual a execução trabalha (conferida por gatilho); nula em criar.';
COMMENT ON COLUMN core.strategy_plan_runs.status IS
  'pendente, rodando, concluida, falhou ou cancelada. Worker: pendente para rodando, rodando para concluida, falhou ou pendente (nova tentativa); pessoa: pendente ou rodando para cancelada; nada sai de estado final.';
COMMENT ON COLUMN core.strategy_plan_runs.etapa IS
  'Andamento: ler_brain, redigir, comite, ajustar, gates, fim. Só o worker muda.';
COMMENT ON COLUMN core.strategy_plan_runs.rodada IS
  'Rodadas já feitas entre ajuste e Gates (limite aplicado pelo código).';
COMMENT ON COLUMN core.strategy_plan_runs.tentativas IS
  'Vezes que o worker reservou esta execução; sobe a cada nova reserva.';
COMMENT ON COLUMN core.strategy_plan_runs.falhas IS
  'Falhas transitórias já tratadas (IA fora do ar, saída inválida, Brain indisponível); só sobe. Limita as novas tentativas sem confundir com tentativas, que conta reservas, inclusive as de retomada por orçamento de tempo.';
COMMENT ON COLUMN core.strategy_plan_runs.erro_codigo IS
  'Código de lista fechada da falha; nunca texto livre nem mensagem de fornecedor.';
COMMENT ON COLUMN core.strategy_plan_runs.agent_run_id IS
  'Identificador único desta execução, usado como agent_run_id nas versões e eventos que ela grava (ADR 0056 §9). Entra nos tetos do agente.';
COMMENT ON COLUMN core.strategy_plan_runs.requested_by IS
  'Pessoa que pediu: o app.user_id da transação (gatilho). Vira NULL se o usuário for apagado.';
COMMENT ON COLUMN core.strategy_plan_runs.requested_kind IS
  'usuario (pela web, exige requested_by) ou sistema (só pela credencial do worker, sem pessoa).';
COMMENT ON COLUMN core.strategy_plan_runs.lease_until IS
  'Até quando o worker que reservou tem a execução; vencido, outra reserva pode retomá-la.';
COMMENT ON COLUMN core.strategy_plan_runs.created_at IS
  'Para o app e o worker é sempre now() (strategy_plan_inquilino).';
COMMENT ON COLUMN core.strategy_plan_runs.updated_at IS
  'Para o app e o worker é sempre now() a cada insert e update (gatilho).';

CREATE UNIQUE INDEX IF NOT EXISTS strategy_plan_runs_uma_ativa
  ON core.strategy_plan_runs (plan_id) WHERE status IN ('pendente', 'rodando');
CREATE INDEX IF NOT EXISTS strategy_plan_runs_plano ON core.strategy_plan_runs (plan_id, created_at DESC);
CREATE INDEX IF NOT EXISTS strategy_plan_runs_fila
  ON core.strategy_plan_runs (organization_id, created_at) WHERE status IN ('pendente', 'rodando');

DO $$
DECLARE
  papel text := current_setting('contexto.papel_app');
  papel_worker text := current_setting('contexto.papel_worker');
  condicao text := 'organization_id = core.current_organization() AND core.cliente_no_escopo(client_id)
                AND EXISTS (SELECT 1 FROM core.clients c WHERE c.id = strategy_plan_runs.client_id)';
BEGIN
  ALTER TABLE core.strategy_plan_runs ENABLE ROW LEVEL SECURITY;
  ALTER TABLE core.strategy_plan_runs FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS strategy_plan_runs_leitura ON core.strategy_plan_runs;
  DROP POLICY IF EXISTS strategy_plan_runs_insercao ON core.strategy_plan_runs;
  DROP POLICY IF EXISTS strategy_plan_runs_atualizacao ON core.strategy_plan_runs;
  EXECUTE format('CREATE POLICY strategy_plan_runs_leitura ON core.strategy_plan_runs FOR SELECT TO %I USING (%s)', papel, condicao);
  EXECUTE format('CREATE POLICY strategy_plan_runs_insercao ON core.strategy_plan_runs FOR INSERT TO %I WITH CHECK (%s)', papel, condicao);
  EXECUTE format('CREATE POLICY strategy_plan_runs_atualizacao ON core.strategy_plan_runs FOR UPDATE TO %I USING (%s) WITH CHECK (%s)', papel, condicao, condicao);
  REVOKE ALL ON core.strategy_plan_runs FROM PUBLIC;
  EXECUTE format('REVOKE ALL ON core.strategy_plan_runs FROM %I', papel);
  EXECUTE format('REVOKE ALL ON core.strategy_plan_runs FROM %I', papel_worker);
  EXECUTE format('GRANT SELECT, INSERT ON core.strategy_plan_runs TO %I', papel);
  EXECUTE format('GRANT UPDATE (status) ON core.strategy_plan_runs TO %I', papel);
  EXECUTE format('GRANT UPDATE (status, etapa, rodada, tentativas, falhas, erro_codigo, lease_until, updated_at) ON core.strategy_plan_runs TO %I', papel_worker);
END $$;

CREATE OR REPLACE FUNCTION core.strategy_plan_run_insercao()
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
  NEW.updated_at := now();

  IF NEW.status <> 'pendente' OR NEW.etapa <> 'ler_brain' OR NEW.rodada <> 0 OR NEW.tentativas <> 0 OR NEW.falhas <> 0
     OR NEW.erro_codigo IS NOT NULL OR NEW.lease_until IS NOT NULL THEN
    RAISE EXCEPTION 'execução nasce pendente, na etapa ler_brain, sem andamento, erro nem lease' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.base_version_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM core.strategy_plan_versions v
        WHERE v.id = NEW.base_version_id AND v.plan_id = NEW.plan_id
          AND v.organization_id = NEW.organization_id AND v.client_id = NEW.client_id) THEN
    RAISE EXCEPTION 'versão base não é deste plano' USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF core.decisao_chamador_e_worker() THEN
    IF v_usuario IS NOT NULL OR NEW.requested_kind <> 'sistema' THEN
      RAISE EXCEPTION 'o worker só cria execução do sistema, sem usuário na sessão' USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSE
    IF NEW.requested_kind <> 'usuario' OR v_usuario IS NULL OR NEW.requested_by IS DISTINCT FROM v_usuario THEN
      RAISE EXCEPTION 'execução de pessoa exige requested_by igual ao usuário da sessão' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT EXISTS (
         SELECT 1 FROM core.memberships_of(v_usuario) m
          WHERE m.organization_id = NEW.organization_id AND m.role IN ('owner', 'admin', 'operator')) THEN
      RAISE EXCEPTION 'pedir execução exige papel owner, admin ou operator' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION core.strategy_plan_run_insercao IS
  'BEFORE INSERT de core.strategy_plan_runs (depois de a0_inquilino, sem DEFINER): execução nasce pendente em ler_brain, sem andamento, falhas, erro nem lease; a versão base é do mesmo plano; pela web, requested_kind usuario, requested_by igual ao app.user_id e papel owner, admin ou operator (core.memberships_of); pelo worker, só sistema e sem app.user_id. Superusuário não é checado.';

CREATE OR REPLACE FUNCTION core.strategy_plan_run_atualizacao()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_novo      jsonb := to_jsonb(NEW);
  v_velho     jsonb := to_jsonb(OLD);
  v_usuario   uuid;
  v_do_worker text[] := ARRAY['status', 'etapa', 'rodada', 'tentativas', 'falhas', 'erro_codigo', 'lease_until', 'updated_at'];
  v_encerrada boolean := false;
BEGIN
  IF NOT core.decisao_chamador_e_app() THEN
    IF NEW.requested_by IS NULL AND OLD.requested_by IS NOT NULL AND (v_novo - 'requested_by') = (v_velho - 'requested_by') THEN
      RETURN NEW;
    END IF;
    IF coalesce(current_setting('orla.redigindo_plano', true), '') <> ''
       AND NEW.pedido = '{"redigido": true}'::jsonb AND (v_novo - 'pedido') = (v_velho - 'pedido')
       AND EXISTS (SELECT 1 FROM core.strategy_plan_versions v
                    WHERE v.id::text = current_setting('orla.redigindo_plano', true) AND v.plan_id = OLD.plan_id) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'execução do plano é imutável fora do worker e da pessoa que cancela' USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.status IN ('concluida', 'falhou', 'cancelada') THEN
    RAISE EXCEPTION 'execução em estado final (%) não muda', OLD.status USING ERRCODE = 'check_violation';
  END IF;

  IF core.decisao_chamador_e_worker() THEN
    IF NEW.rodada < OLD.rodada OR NEW.tentativas < OLD.tentativas OR NEW.falhas < OLD.falhas THEN
      RAISE EXCEPTION 'rodada, tentativas e falhas só crescem' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.tentativas <> OLD.tentativas AND NOT (
         NEW.tentativas = OLD.tentativas + 1 AND NEW.status = 'rodando'
         AND (OLD.status = 'pendente' OR (OLD.status = 'rodando' AND (OLD.lease_until IS NULL OR OLD.lease_until < now())))) THEN
      RAISE EXCEPTION 'tentativas só sobem de 1 e só junto da reserva (pendente ou lease vencido, para rodando)' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'rodando' AND NEW.tentativas <> OLD.tentativas + 1
       AND (OLD.status = 'pendente' OR (OLD.status = 'rodando' AND (OLD.lease_until IS NULL OR OLD.lease_until < now()))) THEN
      RAISE EXCEPTION 'toda reserva (pendente para rodando, ou rodando com lease vencido) sobe tentativas em exatamente 1' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.tentativas > OLD.tentativas AND NEW.tentativas > 20 THEN
      NEW.status := 'falhou';
      NEW.erro_codigo := 'interno';
      NEW.lease_until := NULL;
      v_novo := to_jsonb(NEW);
      v_encerrada := true;
    END IF;
    IF (v_novo - v_do_worker) <> (v_velho - v_do_worker) THEN
      RAISE EXCEPTION 'o worker só muda status, etapa, rodada, tentativas, falhas, erro_codigo e lease_until' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND (OLD.status, NEW.status) NOT IN
         (('pendente', 'rodando'), ('rodando', 'concluida'), ('rodando', 'falhou'), ('rodando', 'pendente'))
       AND NOT (v_encerrada AND OLD.status = 'pendente' AND NEW.status = 'falhou') THEN
      RAISE EXCEPTION 'transição inválida de execução: % para %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    v_usuario := nullif(current_setting('app.user_id', true), '')::uuid;
    IF v_usuario IS NULL OR NOT EXISTS (
         SELECT 1 FROM core.memberships_of(v_usuario) m
          WHERE m.organization_id = OLD.organization_id AND m.role IN ('owner', 'admin', 'operator')) THEN
      RAISE EXCEPTION 'cancelar execução exige papel owner, admin ou operator' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF (v_novo - 'status' - 'updated_at') <> (v_velho - 'status' - 'updated_at') OR NEW.status <> 'cancelada' THEN
      RAISE EXCEPTION 'pessoa só cancela a execução: status pendente ou rodando para cancelada' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION core.strategy_plan_run_atualizacao IS
  'BEFORE UPDATE de core.strategy_plan_runs (sem DEFINER). Teto de reservas: a reserva que leva tentativas acima de 20 (pendente ou rodando com lease vencido para rodando) é reescrita aqui para falhou com erro_codigo interno e sem lease, e pendente para falhou só vale nesse caso (a 21ª reserva), nunca por UPDATE direto; toda reserva sobe tentativas em exatamente 1, e tentativas só sobe de 1 e só junto da transição para rodando de uma execução pendente ou de uma rodando com o lease vencido (reserva); o código tem a constante MAXIMO_DE_RESERVAS com o mesmo valor. Fora do app e do worker só vale o SET NULL de requested_by e a redação do pedido dentro de core.redigir_plano. Nada sai de estado final. Worker: só status, etapa, rodada, tentativas, falhas, erro_codigo, lease_until e updated_at, com pendente para rodando, rodando para concluida, falhou ou pendente, e rodada, tentativas e falhas que só crescem. Pessoa com papel owner, admin ou operator: só status de pendente ou rodando para cancelada. updated_at é now().';

CREATE OR REPLACE FUNCTION core.strategy_plan_runs_redigir()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE core.strategy_plan_runs
     SET pedido = '{"redigido": true}'::jsonb
   WHERE plan_id = NEW.plan_id AND organization_id = NEW.organization_id AND client_id = NEW.client_id
     AND pedido <> '{"redigido": true}'::jsonb;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION core.strategy_plan_runs_redigir IS
  'AFTER UPDATE de core.strategy_plan_versions quando redacted_at passa de nulo a preenchido (redação LGPD, core.redigir_plano): troca o pedido de todas as execuções do plano por {"redigido": true}, porque a instrução da pessoa é texto livre. DEFINER para atravessar a RLS; só dispara dentro de redigir_plano.';

REVOKE ALL ON FUNCTION core.strategy_plan_runs_redigir() FROM PUBLIC;

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
   ORDER BY r.created_at, r.id
   LIMIT greatest(least(coalesce(p_limite, 0), 50), 0)
$$;

COMMENT ON FUNCTION core.strategy_runs_pendentes IS
  'Descoberta de trabalho do worker entre inquilinos (molde de core.brain_resolver_cliente): devolve só (organization_id, client_id, id) das execuções pendentes, ou rodando com lease vencido, de clientes não excluídos, mais antigas primeiro, no máximo least(p_limite, 50), e só as que ainda não passaram do teto de reservas (tentativas até 20: a que está no teto é devolvida uma vez para a reserva a encerrar como falhou; acima disso o gatilho já a encerrou). Nenhum conteúdo. SECURITY DEFINER para atravessar a RLS; EXECUTE só do papel do worker, nunca do app.';

DO $$
BEGIN
  REVOKE ALL ON FUNCTION core.strategy_runs_pendentes(integer) FROM PUBLIC;
  EXECUTE format('REVOKE ALL ON FUNCTION core.strategy_runs_pendentes(integer) FROM %I', current_setting('contexto.papel_app'));
  EXECUTE format('GRANT EXECUTE ON FUNCTION core.strategy_runs_pendentes(integer) TO %I', current_setting('contexto.papel_worker'));
END $$;

DROP TRIGGER IF EXISTS strategy_plan_runs_a0_inquilino ON core.strategy_plan_runs;
CREATE TRIGGER strategy_plan_runs_a0_inquilino BEFORE INSERT ON core.strategy_plan_runs
  FOR EACH ROW EXECUTE FUNCTION core.strategy_plan_inquilino();
DROP TRIGGER IF EXISTS strategy_plan_runs_b_insercao ON core.strategy_plan_runs;
CREATE TRIGGER strategy_plan_runs_b_insercao BEFORE INSERT ON core.strategy_plan_runs
  FOR EACH ROW EXECUTE FUNCTION core.strategy_plan_run_insercao();
DROP TRIGGER IF EXISTS strategy_plan_runs_atualizacao ON core.strategy_plan_runs;
CREATE TRIGGER strategy_plan_runs_atualizacao BEFORE UPDATE ON core.strategy_plan_runs
  FOR EACH ROW EXECUTE FUNCTION core.strategy_plan_run_atualizacao();
DROP TRIGGER IF EXISTS strategy_plan_runs_nao_apaga ON core.strategy_plan_runs;
CREATE TRIGGER strategy_plan_runs_nao_apaga BEFORE DELETE ON core.strategy_plan_runs
  FOR EACH ROW EXECUTE FUNCTION core.strategy_plan_nao_apaga();
DROP TRIGGER IF EXISTS strategy_plan_versions_redige_execucoes ON core.strategy_plan_versions;
CREATE TRIGGER strategy_plan_versions_redige_execucoes AFTER UPDATE OF redacted_at ON core.strategy_plan_versions
  FOR EACH ROW WHEN (OLD.redacted_at IS NULL AND NEW.redacted_at IS NOT NULL)
  EXECUTE FUNCTION core.strategy_plan_runs_redigir();

CREATE OR REPLACE FUNCTION core.strategy_plan_agente_com_execucao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_plano  uuid;
  v_achou  integer;
  v_agente boolean;
  v_ficha_texto text;
  v_ficha integer;
BEGIN
  IF TG_TABLE_NAME = 'strategy_plan_versions' THEN
    v_agente := NEW.author_kind = 'agente';
    v_plano := NEW.plan_id;
    IF v_agente AND NOT EXISTS (
         SELECT 1 FROM core.strategy_plans pl
          WHERE pl.id = NEW.plan_id AND pl.organization_id = NEW.organization_id AND pl.client_id = NEW.client_id) THEN
      RETURN NEW;
    END IF;
  ELSE
    v_agente := NEW.actor_kind = 'agente';
    IF v_agente THEN
      SELECT v.plan_id INTO v_plano FROM core.strategy_plan_versions v
       WHERE v.id = NEW.version_id AND v.organization_id = NEW.organization_id AND v.client_id = NEW.client_id;
      IF NOT FOUND THEN
        RETURN NEW;
      END IF;
    END IF;
  END IF;
  IF NOT v_agente OR NEW.agent_run_id IS NULL THEN
    RETURN NEW;
  END IF;

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
   WHERE r.agent_run_id = NEW.agent_run_id AND r.plan_id = v_plano
     AND r.organization_id = NEW.organization_id AND r.client_id = NEW.client_id
     AND r.status = 'rodando' AND r.lease_until > now()
     AND (v_ficha IS NULL OR r.tentativas = v_ficha)
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'escrita de agente exige execução ativa deste plano (rodando, lease vigente, mesmo agent_run_id e ficha igual a tentativas)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION core.strategy_plan_agente_com_execucao IS
  'BEFORE INSERT de core.strategy_plan_versions (gatilho a_execucao) e de core.strategy_plan_events (gatilho antes_execucao): toda escrita de agente (author_kind ou actor_kind agente) exige uma linha de core.strategy_plan_runs com o mesmo agent_run_id, no mesmo plano, organização e cliente, status rodando e lease_until no futuro, lida com FOR SHARE; senão 42501. A ficha (tentativas da reserva) vem do GUC orla.ficha_execucao, local à transação: para qualquer sessão que não seja superusuário ele é obrigatório e inteiro (ausente ou inválido, 42501) e a linha da execução tem de ter tentativas igual a ele, de modo que o worker que perdeu a ficha não grava mesmo com o lease ainda vigente do novo dono. Ordem alfabética dos gatilhos: em versões depois de a0_inquilino e a_autoridade e antes de antes (que cancela a versão aberta e conta o teto); em eventos depois de a0_inquilino e antes (autoridade) e antes de b_teto (trava e teto). Pega primeiro a trava consultiva do cliente e só depois a linha da execução (mesma ordem de strategy_plan_apos_evento e de core.redigir_plano, que atualiza as execuções sob a trava), de modo que o cancelamento pela pessoa (UPDATE só da linha da execução, sem trava consultiva) e a edição manual (trava do cliente e linha nova) não formam ciclo: o cancelamento espera quem já leu a linha com FOR SHARE e a leitura que vem depois dele vê cancelada. Evento de ator sistema ou usuario e versão de usuario não são afetados, e agente sem agent_run_id fica para os CHECKs da tabela; evento de versão inexistente e versão de plano inexistente no cliente passam para a FK e para strategy_plan_versao_antes recusarem com o erro de sempre. SECURITY DEFINER para ler a execução sem depender da RLS do chamador; compara organização, cliente e plano explicitamente.';

REVOKE ALL ON FUNCTION core.strategy_plan_agente_com_execucao() FROM PUBLIC;

DROP TRIGGER IF EXISTS strategy_plan_versions_a_execucao ON core.strategy_plan_versions;
CREATE TRIGGER strategy_plan_versions_a_execucao BEFORE INSERT ON core.strategy_plan_versions
  FOR EACH ROW EXECUTE FUNCTION core.strategy_plan_agente_com_execucao();
DROP TRIGGER IF EXISTS strategy_plan_events_antes_execucao ON core.strategy_plan_events;
CREATE TRIGGER strategy_plan_events_antes_execucao BEFORE INSERT ON core.strategy_plan_events
  FOR EACH ROW EXECUTE FUNCTION core.strategy_plan_agente_com_execucao();

COMMIT;
