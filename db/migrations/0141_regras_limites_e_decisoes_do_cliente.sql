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
END $$;

CREATE TABLE IF NOT EXISTS core.limit_definitions (
  key              text NOT NULL,
  version          integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  organization_id  uuid,
  name             text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  description      text CHECK (description IS NULL OR length(description) <= 1000),
  category         text NOT NULL CHECK (category IN ('investimento', 'eficiencia')),
  measure          text NOT NULL CHECK (measure IN ('gasto', 'custo_por_aquisicao', 'custo_por_lead', 'retorno')),
  unit             text NOT NULL CHECK (unit IN ('brl_centavos', 'razao', 'percentual')),
  period           text NOT NULL CHECK (period IN ('mes', 'dia', 'total')),
  direction        text NOT NULL CHECK (direction IN ('teto', 'piso')),
  min_value        text NOT NULL CHECK (min_value ~ '^[0-9]{1,18}(\.[0-9]{1,6})?$'),
  max_value        text NOT NULL CHECK (max_value ~ '^[0-9]{1,18}(\.[0-9]{1,6})?$'),
  scopes           text[] NOT NULL DEFAULT ARRAY['cliente']::text[]
                     CHECK (cardinality(scopes) BETWEEN 1 AND 2 AND scopes <@ ARRAY['cliente', 'plataforma']::text[]),
  essential        boolean NOT NULL DEFAULT false,
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key, version),
  CONSTRAINT limit_definitions_chave CHECK (key ~ '^[a-z][a-z0-9_]{0,39}\.[a-z][a-z0-9_]{0,79}$' AND split_part(key, '.', 1) = category),
  CONSTRAINT limit_definitions_faixa CHECK (
    CASE WHEN min_value ~ '^[0-9]{1,18}(\.[0-9]{1,6})?$' AND max_value ~ '^[0-9]{1,18}(\.[0-9]{1,6})?$'
         THEN min_value::numeric <= max_value::numeric ELSE false END)
);

COMMENT ON TABLE core.limit_definitions IS
  'Tipos de limite do cliente (ADR 0051). Dado, não código: tipo novo é INSERT. Global da plataforma (organization_id nulo; coluna reservada). Definição não se edita: mudar unidade ou faixa cria versão nova (mesma key); só active muda. O app só lê.';
COMMENT ON COLUMN core.limit_definitions.organization_id IS
  'Reservada para o catálogo próprio por agência (fase futura); nula = global da plataforma. Sem FK de propósito: uma limpeza em cascata de core.organizations (testes, restauração) não pode levar o catálogo global. A existência da organização, quando não nula, é validada no INSERT por core.limite_definicao_antes_insercao; a FK com ON DELETE CASCADE entra junto com a fase do catálogo por agência.';
COMMENT ON COLUMN core.limit_definitions.measure IS
  'Vocabulário de medidas que o código sabe calcular (gasto, custo_por_aquisicao, custo_por_lead, retorno). Medida nova exige código.';
COMMENT ON COLUMN core.limit_definitions.min_value IS
  'Limite inferior aceito para o valor da decisão, em texto decimal não negativo, na unidade da definição.';
COMMENT ON COLUMN core.limit_definitions.scopes IS
  'Tipos de escopo aceitos: cliente (cliente inteiro) e/ou plataforma (escopo plataforma:<chave>).';
COMMENT ON COLUMN core.limit_definitions.essential IS
  'Lacuna cobrada na completude de Regras quando o cliente não tem decisão vigente com esta chave.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'core.client_context_links'::regclass AND conname = 'client_context_links_id_inquilino'
  ) THEN
    ALTER TABLE core.client_context_links
      ADD CONSTRAINT client_context_links_id_inquilino UNIQUE (id, organization_id, client_id);
  END IF;
END $$;

COMMENT ON CONSTRAINT client_context_links_id_inquilino ON core.client_context_links IS
  'Alvo da FK composta de core.client_decisions.via_link_id (ADR 0051): o link referenciado é do mesmo cliente e da mesma organização da decisão.';

CREATE TABLE IF NOT EXISTS core.client_decisions (
  id                               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id                  uuid NOT NULL REFERENCES core.organizations(id) ON DELETE RESTRICT,
  client_id                        uuid NOT NULL REFERENCES core.clients(id) ON DELETE CASCADE,
  number                           integer NOT NULL DEFAULT 0 CHECK (number >= 0),
  category                         text NOT NULL CHECK (category IN
                                     ('investimento', 'eficiencia', 'publico', 'etica_marca', 'segmento', 'governanca', 'processo')),
  nature                           text NOT NULL CHECK (nature IN ('limite', 'regra', 'decisao')),
  origin                           text NOT NULL CHECK (origin IN ('cliente', 'agencia', 'agente')),
  strength                         text NOT NULL DEFAULT 'dura' CHECK (strength IN ('dura', 'orientacao')),
  key                              text CHECK (key IS NULL OR key ~ '^[a-z][a-z0-9_]{0,39}(\.[a-z][a-z0-9_]{0,79})?$'),
  scope                            text NOT NULL DEFAULT 'cliente' CHECK (scope ~ '^(cliente|plataforma:[a-z][a-z0-9_]{0,39})$'),
  title                            text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  context                          text CHECK (context IS NULL OR length(context) <= 2000),
  body                             text CHECK (body IS NULL OR length(body) <= 4000),
  value                            jsonb CHECK (value IS NULL OR pg_column_size(value) <= 1024),
  valid_from                       date,
  valid_until                      date,
  status                           text NOT NULL DEFAULT 'vigente' CHECK (status IN ('proposta', 'vigente', 'superada', 'revogada', 'rejeitada')),
  supersedes_id                    uuid REFERENCES core.client_decisions(id) ON DELETE NO ACTION,
  decided_by                       uuid REFERENCES core.users(id) ON DELETE SET NULL,
  on_behalf_of                     text CHECK (on_behalf_of IS NULL OR length(on_behalf_of) BETWEEN 1 AND 200),
  evidence                         text CHECK (evidence IS NULL OR length(evidence) <= 1000),
  without_advertiser_confirmation  boolean NOT NULL DEFAULT false,
  via_link_id                      uuid,
  agent_id                         text CHECK (agent_id IS NULL OR agent_id ~ '^[A-Za-z0-9._:-]{1,80}$'),
  agent_run_id                     text CHECK (agent_run_id IS NULL OR agent_run_id ~ '^[A-Za-z0-9._:-]{1,120}$'),
  agent_set_hash                   text CHECK (agent_set_hash IS NULL OR agent_set_hash ~ '^[0-9a-f]{64}$'),
  idempotency_key                  text CHECK (idempotency_key IS NULL OR idempotency_key ~ '^[A-Za-z0-9._:-]{1,120}$'),
  definition_key                   text,
  definition_version               integer,
  review_flag                      text CHECK (review_flag IS NULL OR review_flag = 'revisar_e_converter_em_limite'),
  redacted_at                      timestamptz,
  created_at                       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_decisions_definicao_fk FOREIGN KEY (definition_key, definition_version)
    REFERENCES core.limit_definitions (key, version) ON DELETE RESTRICT,
  CONSTRAINT client_decisions_link_fk FOREIGN KEY (via_link_id, organization_id, client_id)
    REFERENCES core.client_context_links (id, organization_id, client_id) ON DELETE NO ACTION,
  CONSTRAINT client_decisions_id_inquilino UNIQUE (id, organization_id, client_id),
  CONSTRAINT client_decisions_numero_unico UNIQUE (client_id, number) DEFERRABLE INITIALLY IMMEDIATE,
  CONSTRAINT client_decisions_vigencia CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until >= valid_from),
  CONSTRAINT client_decisions_definicao_junta CHECK ((definition_key IS NULL) = (definition_version IS NULL)),
  CONSTRAINT client_decisions_limite CHECK (
    nature <> 'limite'
    OR (key IS NOT NULL AND value IS NOT NULL AND definition_key IS NOT NULL AND category IN ('investimento', 'eficiencia'))),
  CONSTRAINT client_decisions_valor_so_do_limite CHECK (nature = 'limite' OR (value IS NULL AND definition_key IS NULL)),
  CONSTRAINT client_decisions_regra CHECK (nature <> 'regra' OR (key IS NOT NULL AND body IS NOT NULL)),
  CONSTRAINT client_decisions_agente CHECK (
    (origin = 'agente') = (agent_id IS NOT NULL)
    AND (origin = 'agente' OR (agent_run_id IS NULL AND agent_set_hash IS NULL AND idempotency_key IS NULL))),
  CONSTRAINT client_decisions_agente_processo CHECK (origin <> 'agente' OR nature <> 'decisao' OR category = 'processo'),
  CONSTRAINT client_decisions_redigida CHECK (
    redacted_at IS NULL OR (title = '[redigido]' AND (on_behalf_of IS NULL OR on_behalf_of = '[redigido]')))
);

COMMENT ON TABLE core.client_decisions IS
  'Regras, limites e decisões do cliente (ADR 0051). Registro imutável: o app só tem SELECT e INSERT; gatilhos negam UPDATE e DELETE no conteúdo. status muda só pelo gatilho de client_decision_events; a única mudança de conteúdo é a redação LGPD (core.redigir_decisao). Some com o cliente no expurgo (ON DELETE CASCADE).';
COMMENT ON COLUMN core.client_decisions.number IS
  'Número sequencial por cliente, sem buraco, atribuído pelo banco sob trava por cliente. O valor enviado é ignorado.';
COMMENT ON COLUMN core.client_decisions.value IS
  'Só para natureza limite: {"valor":"<decimal em texto>","unidade":"<unidade da definição>"}. O gatilho valida unidade e faixa contra a versão guardada em definition_key/definition_version.';
COMMENT ON COLUMN core.client_decisions.supersedes_id IS
  'Decisão que esta substitui. Definido no INSERT e validado (mesmo cliente, natureza, chave e escopo; anterior vigente). A anterior vira superada por evento na mesma transação (vigente nasce superando; proposta supera ao ser efetivada).';
COMMENT ON COLUMN core.client_decisions.origin IS
  'De onde veio a decisão. agente exige agent_id; agente só insere decisão de processo como vigente e limite ou regra como proposta; cliente nunca insere limite ou regra vigente (só propõe). O banco não prova que o chamador é agente: para o app e o worker, limite ou regra vigente com origem diferente de agente exige decided_by (uma pessoa), igual ao app.user_id da transação e membro vivo da organização. app.user_id é autodeclarado: defende contra bug de código, não contra quem tem a credencial do worker.';
COMMENT ON COLUMN core.client_decisions.decided_by IS
  'Pessoa que decidiu. Obrigatória (para o app e o worker) em limite ou regra que nasce vigente com origem diferente de agente; quando presente, em qualquer natureza e status, é o app.user_id da transação e membro vivo da organização. Vira NULL se o usuário for apagado.';
COMMENT ON COLUMN core.client_decisions.via_link_id IS
  'Link público de contexto (fase futura). FK composta (via_link_id, organization_id, client_id): o link é do mesmo cliente e organização. ON DELETE NO ACTION: apagar um link referenciado é recusado (hoje links só saem pela cascata do cliente; SET NULL geraria UPDATE que a imutabilidade nega). Limitação a resolver na Fase 7.';
COMMENT ON COLUMN core.client_decisions.created_at IS
  'Instante do registro. Para o app e o worker é sempre now() (o teto diário do agente se conta por ele); só o script de migração do Contexto (worker, GUC orla.migracao_contexto) preserva a data original.';
COMMENT ON COLUMN core.client_decisions.valid_from IS
  'Início da vigência. Decisão que supera outra (supersedes_id) não nasce vigente nem é efetivada com início futuro: a anterior deixaria de valer antes da nova (v1).';
COMMENT ON COLUMN core.client_decisions.agent_id IS
  'Autodeclaração de chamador já autenticado pelo segredo do worker: rastreio e idempotência, não prova de identidade.';
COMMENT ON COLUMN core.client_decisions.review_flag IS
  'revisar_e_converter_em_limite: texto livre com número migrado das seções J e K, à espera de revisão humana.';
COMMENT ON COLUMN core.client_decisions.redacted_at IS
  'Instante da redação LGPD: título, contexto, texto, evidência e on_behalf_of viram [redigido], assim como o motivo livre dos eventos da decisão; linha, valor e histórico permanecem.';

CREATE UNIQUE INDEX IF NOT EXISTS client_decisions_uma_vigente
  ON core.client_decisions (client_id, key, scope)
  WHERE status = 'vigente' AND nature IN ('limite', 'regra');
CREATE UNIQUE INDEX IF NOT EXISTS client_decisions_idempotencia
  ON core.client_decisions (client_id, agent_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS client_decisions_cliente_status
  ON core.client_decisions (client_id, status, category);
CREATE INDEX IF NOT EXISTS client_decisions_antecessora
  ON core.client_decisions (supersedes_id) WHERE supersedes_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS core.client_decision_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES core.organizations(id) ON DELETE RESTRICT,
  client_id        uuid NOT NULL REFERENCES core.clients(id) ON DELETE CASCADE,
  decision_id      uuid NOT NULL,
  type             text NOT NULL CHECK (type IN ('proposta', 'efetivada', 'rejeitada', 'superada', 'revogada', 'redigida')),
  actor_kind       text NOT NULL DEFAULT 'usuario' CHECK (actor_kind IN ('usuario', 'agente', 'sistema')),
  actor_user_id    uuid REFERENCES core.users(id) ON DELETE SET NULL,
  reason           text CHECK (reason IS NULL OR length(reason) <= 500),
  successor_id     uuid,
  request_id       text CHECK (request_id IS NULL OR length(request_id) <= 120),
  occurred_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_decision_events_decisao_fk FOREIGN KEY (decision_id, organization_id, client_id)
    REFERENCES core.client_decisions (id, organization_id, client_id) ON DELETE CASCADE,
  CONSTRAINT client_decision_events_motivo CHECK (
    type NOT IN ('revogada', 'redigida') OR (reason IS NOT NULL AND length(btrim(reason)) >= 3))
);

COMMENT ON TABLE core.client_decision_events IS
  'Histórico só de acréscimo do ciclo de vida das decisões (ADR 0051). INSERT aqui, feito pelo app ou pelos gatilhos, dispara core.decisao_apos_evento, que aplica a transição de status ou recusa a inválida. O app e o worker só inserem efetivada, rejeitada e revogada, sempre em nome de uma pessoa; proposta, superada e redigida só nascem dos gatilhos e de core.redigir_decisao. A única mudança depois do INSERT é a redação LGPD do motivo (reason vira [redigido]) feita por core.redigir_decisao.';
COMMENT ON COLUMN core.client_decision_events.successor_id IS
  'No evento superada: a decisão que substituiu. Sem FK para o expurgo do cliente não esbarrar em ordem de cascata.';

CREATE INDEX IF NOT EXISTS client_decision_events_decisao ON core.client_decision_events (decision_id, occurred_at);
CREATE INDEX IF NOT EXISTS client_decision_events_cliente ON core.client_decision_events (client_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS core.regras_migracao_contexto (
  organization_id  uuid NOT NULL REFERENCES core.organizations(id) ON DELETE RESTRICT,
  client_id        uuid NOT NULL REFERENCES core.clients(id) ON DELETE CASCADE,
  field_key        text NOT NULL CHECK (field_key ~ '^[a-z][a-z0-9_]{0,79}$'),
  decision_id      uuid NOT NULL,
  migrated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, field_key),
  CONSTRAINT regras_migracao_contexto_decisao_fk FOREIGN KEY (decision_id, organization_id, client_id)
    REFERENCES core.client_decisions (id, organization_id, client_id) ON DELETE CASCADE
);

COMMENT ON TABLE core.regras_migracao_contexto IS
  'Livro imutável da migração das seções J e K do Contexto para Regras (ADR 0051 §9): uma linha por cliente e campo migrado, com a decisão criada. É a prova de idempotência do scripts/regras-migrar-contexto.mjs; a redação LGPD e a revogação não a tocam, então reexecutar nunca recria o texto. O app só lê: o privilégio de INSERT existe no papel do app (o worker o herda, sem grant próprio, ADR 0043), mas a única política de INSERT é do papel do worker e a RLS é forçada, então só o worker (papel do script) insere; ninguém edita nem apaga; some com o cliente no expurgo.';

DO $$
DECLARE
  papel text := current_setting('contexto.papel_app');
  tabela text;
BEGIN
  EXECUTE format($f$
    CREATE OR REPLACE FUNCTION core.decisao_chamador_e_app() RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path = pg_catalog
    AS $b$
      SELECT pg_catalog.pg_has_role(current_user, %L, 'member')
         AND NOT (SELECT r.rolsuper FROM pg_catalog.pg_roles r WHERE r.rolname = current_user)
    $b$
  $f$, papel);

  EXECUTE format($f$
    CREATE OR REPLACE FUNCTION core.decisao_chamador_e_worker() RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path = pg_catalog
    AS $b$
      SELECT pg_catalog.pg_has_role(current_user, %L, 'member')
         AND NOT (SELECT r.rolsuper FROM pg_catalog.pg_roles r WHERE r.rolname = current_user)
    $b$
  $f$, current_setting('contexto.papel_worker'));

  FOREACH tabela IN ARRAY ARRAY['client_decisions', 'client_decision_events']
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

  ALTER TABLE core.regras_migracao_contexto ENABLE ROW LEVEL SECURITY;
  ALTER TABLE core.regras_migracao_contexto FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS regras_migracao_contexto_leitura ON core.regras_migracao_contexto;
  DROP POLICY IF EXISTS regras_migracao_contexto_insercao ON core.regras_migracao_contexto;
  EXECUTE format(
    'CREATE POLICY regras_migracao_contexto_leitura ON core.regras_migracao_contexto FOR SELECT TO %I
       USING (organization_id = core.current_organization() AND core.cliente_no_escopo(client_id)
              AND EXISTS (SELECT 1 FROM core.clients c WHERE c.id = regras_migracao_contexto.client_id))', papel);
  EXECUTE format(
    'CREATE POLICY regras_migracao_contexto_insercao ON core.regras_migracao_contexto FOR INSERT TO %I
       WITH CHECK (organization_id = core.current_organization() AND core.cliente_no_escopo(client_id)
              AND EXISTS (SELECT 1 FROM core.clients c WHERE c.id = regras_migracao_contexto.client_id))',
    current_setting('contexto.papel_worker'));
  REVOKE ALL ON core.regras_migracao_contexto FROM PUBLIC;
  EXECUTE format('REVOKE ALL ON core.regras_migracao_contexto FROM %I', papel);
  EXECUTE format('REVOKE ALL ON core.regras_migracao_contexto FROM %I', current_setting('contexto.papel_worker'));
  EXECUTE format('GRANT SELECT, INSERT ON core.regras_migracao_contexto TO %I', papel);

  ALTER TABLE core.limit_definitions ENABLE ROW LEVEL SECURITY;
  ALTER TABLE core.limit_definitions FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS limit_definitions_leitura ON core.limit_definitions;
  EXECUTE format(
    'CREATE POLICY limit_definitions_leitura ON core.limit_definitions FOR SELECT TO %I
       USING (organization_id IS NULL OR organization_id = core.current_organization())', papel);
  REVOKE ALL ON core.limit_definitions FROM PUBLIC;
  EXECUTE format('REVOKE ALL ON core.limit_definitions FROM %I', papel);
  EXECUTE format('GRANT SELECT ON core.limit_definitions TO %I', papel);
END $$;

COMMENT ON FUNCTION core.decisao_chamador_e_app IS
  'Verdadeiro quando a sessão executa como o papel do app ou do worker (que herda o do app). Superusuário nunca conta (pg_has_role é verdadeiro para ele). Dentro de função SECURITY DEFINER o usuário corrente é o dono, então a checagem não é falsificável por GUC.';
COMMENT ON FUNCTION core.decisao_chamador_e_worker IS
  'Verdadeiro quando a sessão executa como o papel do worker (não superusuário). Usado para a única exceção de data: o script de migração do Contexto preserva created_at.';

CREATE OR REPLACE FUNCTION core.regras_migracao_imutavel()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'livro da migração do contexto é só de acréscimo' USING ERRCODE = 'restrict_violation';
END;
$$;

COMMENT ON FUNCTION core.regras_migracao_imutavel IS
  'BEFORE UPDATE de core.regras_migracao_contexto: nega sempre (prova de migração não se edita).';

DROP TRIGGER IF EXISTS regras_migracao_contexto_imutavel ON core.regras_migracao_contexto;
CREATE TRIGGER regras_migracao_contexto_imutavel BEFORE UPDATE ON core.regras_migracao_contexto
  FOR EACH ROW EXECUTE FUNCTION core.regras_migracao_imutavel();

CREATE OR REPLACE FUNCTION core.limite_definicao_imutavel()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF (to_jsonb(NEW) - 'active') IS DISTINCT FROM (to_jsonb(OLD) - 'active') THEN
    RAISE EXCEPTION 'definição de limite não se edita: crie uma versão nova (só active muda)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION core.limite_definicao_imutavel IS
  'Gatilho de core.limit_definitions: nega UPDATE de colunas de conteúdo; só active pode mudar.';

CREATE OR REPLACE FUNCTION core.limite_definicao_antes_insercao()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.organization_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM core.organizations o WHERE o.id = NEW.organization_id) THEN
    RAISE EXCEPTION 'organização da definição de limite inexistente' USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION core.limite_definicao_antes_insercao IS
  'Gatilho BEFORE INSERT de core.limit_definitions: no lugar da FK de organization_id (que deixaria uma limpeza em cascata de organizations apagar o catálogo global), recusa definição de organização inexistente. organization_id não muda depois (core.limite_definicao_imutavel).';

DROP TRIGGER IF EXISTS limit_definitions_antes ON core.limit_definitions;
CREATE TRIGGER limit_definitions_antes BEFORE INSERT ON core.limit_definitions
  FOR EACH ROW EXECUTE FUNCTION core.limite_definicao_antes_insercao();

DROP TRIGGER IF EXISTS limit_definitions_imutavel ON core.limit_definitions;
CREATE TRIGGER limit_definitions_imutavel BEFORE UPDATE ON core.limit_definitions
  FOR EACH ROW EXECUTE FUNCTION core.limite_definicao_imutavel();

INSERT INTO core.limit_definitions
  (key, version, name, description, category, measure, unit, period, direction, min_value, max_value, scopes, essential)
VALUES
  ('investimento.teto_mensal', 1, 'Teto de investimento mensal',
   'Máximo que pode ser gasto em mídia por mês.', 'investimento', 'gasto', 'brl_centavos', 'mes', 'teto',
   '0', '100000000000', ARRAY['cliente', 'plataforma'], true),
  ('investimento.teto_diario', 1, 'Teto de investimento diário',
   'Máximo que pode ser gasto em mídia por dia.', 'investimento', 'gasto', 'brl_centavos', 'dia', 'teto',
   '0', '10000000000', ARRAY['cliente', 'plataforma'], false),
  ('investimento.piso_mensal', 1, 'Piso de investimento mensal',
   'Mínimo que deve ser investido em mídia por mês.', 'investimento', 'gasto', 'brl_centavos', 'mes', 'piso',
   '0', '100000000000', ARRAY['cliente', 'plataforma'], false),
  ('eficiencia.cac_maximo', 1, 'CAC máximo',
   'Maior custo de aquisição de cliente aceito.', 'eficiencia', 'custo_por_aquisicao', 'brl_centavos', 'total', 'teto',
   '0', '1000000000', ARRAY['cliente', 'plataforma'], true),
  ('eficiencia.cpl_maximo', 1, 'CPL máximo',
   'Maior custo por lead aceito.', 'eficiencia', 'custo_por_lead', 'brl_centavos', 'total', 'teto',
   '0', '1000000000', ARRAY['cliente', 'plataforma'], false),
  ('eficiencia.cpa_maximo', 1, 'CPA máximo',
   'Maior custo por aquisição (conversão) aceito.', 'eficiencia', 'custo_por_aquisicao', 'brl_centavos', 'total', 'teto',
   '0', '1000000000', ARRAY['cliente', 'plataforma'], false),
  ('eficiencia.roas_minimo', 1, 'ROAS mínimo',
   'Menor retorno sobre o investimento em mídia aceito, como razão (receita ÷ gasto).', 'eficiencia', 'retorno', 'razao', 'total', 'piso',
   '0', '1000', ARRAY['cliente', 'plataforma'], false)
ON CONFLICT (key, version) DO NOTHING;

CREATE OR REPLACE FUNCTION core.decisao_antes_insercao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_org       uuid;
  v_def       core.limit_definitions;
  v_prev      core.client_decisions;
  v_texto     text;
  v_ator      text;
  v_teto_exec integer;
  v_teto_dia  integer;
  v_na_exec   bigint;
  v_no_dia    bigint;
BEGIN
  SELECT organization_id INTO v_org FROM core.clients WHERE id = NEW.client_id;
  IF v_org IS NULL OR v_org <> NEW.organization_id THEN
    RAISE EXCEPTION 'cliente inexistente ou de outra organização'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('orla:decisoes'), hashtext(NEW.client_id::text));

  IF NEW.status NOT IN ('proposta', 'vigente') THEN
    RAISE EXCEPTION 'decisão nasce proposta ou vigente; os demais estados vêm de evento'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.redacted_at IS NOT NULL THEN
    RAISE EXCEPTION 'decisão não nasce redigida' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.origin = 'cliente' AND NEW.nature IN ('limite', 'regra') AND NEW.status = 'vigente' THEN
    RAISE EXCEPTION 'cliente só propõe limite ou regra; uma pessoa da agência efetiva' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.origin = 'agente' THEN
    IF NEW.nature = 'decisao' AND NOT (NEW.category = 'processo' AND NEW.status = 'vigente') THEN
      RAISE EXCEPTION 'agente só registra decisão de processo como vigente' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.nature IN ('limite', 'regra') AND NEW.status <> 'proposta' THEN
      RAISE EXCEPTION 'agente só registra limite ou regra como proposta' USING ERRCODE = 'check_violation';
    END IF;

    v_teto_exec := least(coalesce(nullif(current_setting('orla.teto_agente_por_execucao', true), '')::integer, 50), 50);
    v_teto_dia := least(coalesce(nullif(current_setting('orla.teto_agente_por_dia', true), '')::integer, 200), 200);
    SELECT count(*) FILTER (WHERE agent_run_id IS NOT DISTINCT FROM NEW.agent_run_id),
           count(*) FILTER (WHERE created_at >= now() - interval '1 day')
      INTO v_na_exec, v_no_dia
      FROM core.client_decisions
     WHERE client_id = NEW.client_id AND origin = 'agente';
    IF v_na_exec >= v_teto_exec THEN
      RAISE EXCEPTION 'teto de decisões do agente por execução atingido (%)', v_teto_exec USING ERRCODE = 'ORT01';
    END IF;
    IF v_no_dia >= v_teto_dia THEN
      RAISE EXCEPTION 'teto diário de decisões de agentes para este cliente atingido (%)', v_teto_dia USING ERRCODE = 'ORT02';
    END IF;
  END IF;

  IF NEW.supersedes_id IS NOT NULL AND NEW.status = 'vigente'
     AND NEW.valid_from IS NOT NULL AND NEW.valid_from > current_date THEN
    RAISE EXCEPTION 'alteração não pode começar no futuro: a anterior deixaria de valer antes da nova'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.nature = 'limite' THEN
    SELECT * INTO v_def FROM core.limit_definitions
     WHERE key = NEW.definition_key AND version = NEW.definition_version;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'definição de limite inexistente' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT v_def.active THEN
      RAISE EXCEPTION 'definição de limite desativada' USING ERRCODE = 'check_violation';
    END IF;
    IF v_def.organization_id IS NOT NULL AND v_def.organization_id <> NEW.organization_id THEN
      RAISE EXCEPTION 'definição de limite de outra organização' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.key <> v_def.key OR NEW.category <> v_def.category THEN
      RAISE EXCEPTION 'chave ou categoria do limite não conferem com a definição' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT (split_part(NEW.scope, ':', 1) = ANY (v_def.scopes)) THEN
      RAISE EXCEPTION 'escopo não aceito por esta definição de limite' USING ERRCODE = 'check_violation';
    END IF;
    IF jsonb_typeof(NEW.value) <> 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(NEW.value)) <> 2
       OR jsonb_typeof(NEW.value -> 'valor') IS DISTINCT FROM 'string'
       OR jsonb_typeof(NEW.value -> 'unidade') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'valor do limite deve ser {"valor":"<decimal>","unidade":"<unidade>"}' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.value ->> 'unidade' <> v_def.unit THEN
      RAISE EXCEPTION 'unidade do valor (%) difere da definição (%)', NEW.value ->> 'unidade', v_def.unit
        USING ERRCODE = 'check_violation';
    END IF;
    v_texto := NEW.value ->> 'valor';
    IF v_texto !~ (CASE WHEN v_def.unit = 'brl_centavos' THEN '^[0-9]{1,18}$' ELSE '^[0-9]{1,15}(\.[0-9]{1,6})?$' END) THEN
      RAISE EXCEPTION 'valor do limite malformado para a unidade %', v_def.unit USING ERRCODE = 'check_violation';
    END IF;
    IF v_texto::numeric < v_def.min_value::numeric OR v_texto::numeric > v_def.max_value::numeric THEN
      RAISE EXCEPTION 'valor do limite fora da faixa da definição (% a %)', v_def.min_value, v_def.max_value
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  SELECT coalesce(max(number), 0) + 1 INTO NEW.number FROM core.client_decisions WHERE client_id = NEW.client_id;

  IF NEW.supersedes_id IS NOT NULL THEN
    SELECT * INTO v_prev FROM core.client_decisions WHERE id = NEW.supersedes_id FOR UPDATE;
    IF NOT FOUND OR v_prev.client_id <> NEW.client_id OR v_prev.organization_id <> NEW.organization_id THEN
      RAISE EXCEPTION 'decisão a superar não existe neste cliente' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF v_prev.status <> 'vigente' THEN
      RAISE EXCEPTION 'só decisão vigente pode ser superada (está %)', v_prev.status USING ERRCODE = 'check_violation';
    END IF;
    IF v_prev.nature <> NEW.nature OR v_prev.category <> NEW.category
       OR (NEW.nature IN ('limite', 'regra') AND (v_prev.key IS DISTINCT FROM NEW.key OR v_prev.scope <> NEW.scope)) THEN
      RAISE EXCEPTION 'a decisão que supera deve ter a mesma natureza, chave e escopo' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'vigente' THEN
      v_ator := CASE WHEN NEW.decided_by IS NOT NULL THEN 'usuario' WHEN NEW.origin = 'agente' THEN 'agente' ELSE 'sistema' END;
      INSERT INTO core.client_decision_events
        (organization_id, client_id, decision_id, type, actor_kind, actor_user_id, successor_id, request_id)
      VALUES (v_prev.organization_id, v_prev.client_id, v_prev.id, 'superada', v_ator, NEW.decided_by, NEW.id,
              left(nullif(current_setting('app.request_id', true), ''), 120));
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION core.decisao_antes_insercao IS
  'BEFORE INSERT de core.client_decisions: trava por cliente (pg_advisory_xact_lock), número sequencial sem buraco, autoridade por origem (agente só propõe limite ou regra; cliente só propõe), teto de decisões do agente contado sob a mesma trava (por execução e por cliente em 24 h; padrão 50 e 200, os GUCs orla.teto_agente_por_execucao e orla.teto_agente_por_dia só reduzem; SQLSTATE ORT01 e ORT02), definição de limite ativa, da organização ou global, e valor contra a versão guardada (unidade e faixa), supersessão (a anterior vira superada por evento, antes do índice único de vigente; nunca com início futuro). SECURITY DEFINER para gravar o evento que o app não pode gravar; a checagem de quem chama fica em core.decisao_autoridade_do_chamador, que não é DEFINER.';

REVOKE ALL ON FUNCTION core.decisao_antes_insercao() FROM PUBLIC;

CREATE OR REPLACE FUNCTION core.decisao_autoridade_do_chamador()
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

  IF NOT (core.decisao_chamador_e_worker() AND NEW.origin <> 'agente'
          AND coalesce(current_setting('orla.migracao_contexto', true), '') = 'sim') THEN
    NEW.created_at := now();
  END IF;

  IF NEW.nature IN ('limite', 'regra') AND NEW.status = 'vigente' AND NEW.origin <> 'agente' AND NEW.decided_by IS NULL THEN
    RAISE EXCEPTION 'limite ou regra vigente exige a pessoa que decidiu (decided_by)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.decided_by IS NOT NULL THEN
    IF NEW.decided_by IS DISTINCT FROM v_usuario THEN
      RAISE EXCEPTION 'decided_by tem de ser o usuário da sessão' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT core.is_member(NEW.organization_id, NEW.decided_by) THEN
      RAISE EXCEPTION 'decided_by não é membro vivo da organização' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION core.decisao_autoridade_do_chamador IS
  'BEFORE INSERT de core.client_decisions (antes de decisao_antes_insercao, por ordem alfabética do gatilho), sem SECURITY DEFINER para enxergar o papel real. Para o app e o worker: created_at é sempre now() (o teto diário do agente não se burla por data retroativa), exceto no script de migração do Contexto (papel do worker, origem diferente de agente e GUC local orla.migracao_contexto = sim), que preserva a data original; limite ou regra que nasce vigente com origem diferente de agente exige decided_by; decided_by, quando presente, é o app.user_id da transação e membro vivo da organização (core.is_member). app.user_id é autodeclarado pelo chamador: isto defende contra bug de código, não contra quem tem a credencial do worker. Superusuário (migração, operação manual) não é checado.';

CREATE OR REPLACE FUNCTION core.decisao_apos_insercao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO core.client_decision_events
    (organization_id, client_id, decision_id, type, actor_kind, actor_user_id, request_id)
  VALUES (NEW.organization_id, NEW.client_id, NEW.id,
          CASE WHEN NEW.status = 'proposta' THEN 'proposta' ELSE 'efetivada' END,
          CASE WHEN NEW.decided_by IS NOT NULL THEN 'usuario' WHEN NEW.origin = 'agente' THEN 'agente' ELSE 'sistema' END,
          NEW.decided_by,
          left(nullif(current_setting('app.request_id', true), ''), 120));

  INSERT INTO core.client_context_brain (client_id, organization_id)
  VALUES (NEW.client_id, NEW.organization_id)
  ON CONFLICT (client_id) DO UPDATE SET requested_at = now();

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION core.decisao_apos_insercao IS
  'AFTER INSERT de core.client_decisions: grava o evento inicial (proposta ou efetivada) e marca o brain do cliente como pendente (requested_at sobe), como core.contexto_apos_mudanca.';

REVOKE ALL ON FUNCTION core.decisao_apos_insercao() FROM PUBLIC;

CREATE OR REPLACE FUNCTION core.decisao_antes_do_evento()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_natureza text;
BEGIN
  IF core.decisao_chamador_e_app() THEN
    IF NEW.type NOT IN ('efetivada', 'rejeitada', 'revogada') THEN
      RAISE EXCEPTION 'evento % só nasce dos gatilhos e de core.redigir_decisao', NEW.type
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.actor_kind <> 'usuario' OR NEW.actor_user_id IS NULL THEN
      RAISE EXCEPTION 'evento % exige uma pessoa (actor_kind usuario e actor_user_id)', NEW.type
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.actor_user_id IS DISTINCT FROM nullif(current_setting('app.user_id', true), '')::uuid THEN
      RAISE EXCEPTION 'actor_user_id tem de ser o usuário da sessão' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT core.is_member(NEW.organization_id, NEW.actor_user_id) THEN
      RAISE EXCEPTION 'actor_user_id não é membro vivo da organização' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF NEW.actor_kind = 'agente' AND NEW.type IN ('efetivada', 'rejeitada', 'revogada') THEN
    SELECT nature INTO v_natureza FROM core.client_decisions WHERE id = NEW.decision_id;
    IF v_natureza IN ('limite', 'regra') THEN
      RAISE EXCEPTION 'agente nunca efetiva, rejeita nem revoga limite ou regra' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION core.decisao_antes_do_evento IS
  'BEFORE INSERT de core.client_decision_events (sem DEFINER, enxerga o papel real): o app e o worker só inserem efetivada, rejeitada e revogada, sempre com actor_kind usuario e actor_user_id igual ao app.user_id da transação e membro vivo da organização (app.user_id é autodeclarado: defende contra bug, não contra a credencial do worker). proposta, superada e redigida são internos. Para qualquer chamador, actor_kind agente nunca efetiva, rejeita nem revoga limite ou regra.';

DROP TRIGGER IF EXISTS client_decision_events_antes ON core.client_decision_events;
CREATE TRIGGER client_decision_events_antes BEFORE INSERT ON core.client_decision_events
  FOR EACH ROW EXECUTE FUNCTION core.decisao_antes_do_evento();

CREATE OR REPLACE FUNCTION core.decisao_apos_evento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_dec     core.client_decisions;
  v_prev    core.client_decisions;
  v_eventos bigint;
  v_novo    text;
BEGIN
  SELECT * INTO v_dec FROM core.client_decisions WHERE id = NEW.decision_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT count(*) INTO v_eventos FROM core.client_decision_events
   WHERE decision_id = NEW.decision_id AND id <> NEW.id;

  IF NEW.type = 'proposta' THEN
    IF v_dec.status <> 'proposta' OR v_eventos > 0 THEN
      RAISE EXCEPTION 'evento proposta só abre a vida de uma decisão proposta' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.type = 'efetivada' THEN
    IF v_dec.status = 'vigente' AND v_eventos = 0 THEN
      v_novo := NULL;
    ELSIF v_dec.status = 'proposta' THEN
      IF v_dec.valid_until IS NOT NULL AND v_dec.valid_until < current_date THEN
        RAISE EXCEPTION 'a vigência desta proposta já terminou' USING ERRCODE = 'check_violation';
      END IF;
      IF v_dec.nature = 'limite' AND NOT EXISTS (
           SELECT 1 FROM core.limit_definitions
            WHERE key = v_dec.definition_key AND version = v_dec.definition_version AND active) THEN
        RAISE EXCEPTION 'definição de limite desativada: a proposta não pode ser efetivada' USING ERRCODE = 'check_violation';
      END IF;
      IF v_dec.supersedes_id IS NOT NULL AND v_dec.valid_from IS NOT NULL AND v_dec.valid_from > current_date THEN
        RAISE EXCEPTION 'alteração não pode começar no futuro: a anterior deixaria de valer antes da nova'
          USING ERRCODE = 'check_violation';
      END IF;
      IF v_dec.supersedes_id IS NOT NULL THEN
        SELECT * INTO v_prev FROM core.client_decisions WHERE id = v_dec.supersedes_id FOR UPDATE;
        IF v_prev.status <> 'vigente' THEN
          RAISE EXCEPTION 'a decisão que esta proposta supera não está mais vigente (está %)', v_prev.status
            USING ERRCODE = 'check_violation';
        END IF;
        INSERT INTO core.client_decision_events
          (organization_id, client_id, decision_id, type, actor_kind, actor_user_id, successor_id, request_id)
        VALUES (v_prev.organization_id, v_prev.client_id, v_prev.id, 'superada', NEW.actor_kind, NEW.actor_user_id,
                v_dec.id, NEW.request_id);
      END IF;
      v_novo := 'vigente';
    ELSE
      RAISE EXCEPTION 'transição inválida: % não pode ser efetivada', v_dec.status USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.type = 'rejeitada' THEN
    IF v_dec.status <> 'proposta' THEN
      RAISE EXCEPTION 'transição inválida: só proposta pode ser rejeitada (está %)', v_dec.status USING ERRCODE = 'check_violation';
    END IF;
    v_novo := 'rejeitada';
  ELSIF NEW.type = 'superada' THEN
    IF v_dec.status <> 'vigente' THEN
      RAISE EXCEPTION 'transição inválida: só vigente pode ser superada (está %)', v_dec.status USING ERRCODE = 'check_violation';
    END IF;
    v_novo := 'superada';
  ELSIF NEW.type = 'revogada' THEN
    IF v_dec.status <> 'vigente' THEN
      RAISE EXCEPTION 'transição inválida: só vigente pode ser revogada (está %)', v_dec.status USING ERRCODE = 'check_violation';
    END IF;
    v_novo := 'revogada';
  END IF;

  IF v_novo IS NOT NULL THEN
    UPDATE core.client_decisions SET status = v_novo WHERE id = v_dec.id;
  END IF;

  INSERT INTO core.client_context_brain (client_id, organization_id)
  VALUES (NEW.client_id, NEW.organization_id)
  ON CONFLICT (client_id) DO UPDATE SET requested_at = now();

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION core.decisao_apos_evento IS
  'AFTER INSERT de core.client_decision_events: aplica a transição de status (proposta para vigente ou rejeitada; vigente para superada ou revogada), recusa as inválidas (inclusive efetivar proposta vencida, de definição desativada ou que supera com início futuro), supera a anterior ao efetivar uma proposta que a substitui e marca o brain pendente. Único caminho que muda status (padrão de core.contexto_apos_mudanca).';

REVOKE ALL ON FUNCTION core.decisao_apos_evento() FROM PUBLIC;

DROP TRIGGER IF EXISTS client_decisions_a_autoridade ON core.client_decisions;
CREATE TRIGGER client_decisions_a_autoridade BEFORE INSERT ON core.client_decisions
  FOR EACH ROW EXECUTE FUNCTION core.decisao_autoridade_do_chamador();
DROP TRIGGER IF EXISTS client_decisions_antes ON core.client_decisions;
CREATE TRIGGER client_decisions_antes BEFORE INSERT ON core.client_decisions
  FOR EACH ROW EXECUTE FUNCTION core.decisao_antes_insercao();
DROP TRIGGER IF EXISTS client_decisions_depois ON core.client_decisions;
CREATE TRIGGER client_decisions_depois AFTER INSERT ON core.client_decisions
  FOR EACH ROW EXECUTE FUNCTION core.decisao_apos_insercao();
DROP TRIGGER IF EXISTS client_decision_events_depois ON core.client_decision_events;
CREATE TRIGGER client_decision_events_depois AFTER INSERT ON core.client_decision_events
  FOR EACH ROW EXECUTE FUNCTION core.decisao_apos_evento();

CREATE OR REPLACE FUNCTION core.decisao_imutavel()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_novo    jsonb := to_jsonb(NEW);
  v_velho   jsonb := to_jsonb(OLD);
  v_redacao text[] := ARRAY['title', 'context', 'body', 'evidence', 'on_behalf_of', 'redacted_at'];
BEGIN
  IF core.decisao_chamador_e_app() THEN
    RAISE EXCEPTION 'decisão é imutável para o app' USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.decided_by IS NULL AND OLD.decided_by IS NOT NULL AND (v_novo - 'decided_by') = (v_velho - 'decided_by') THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND (v_novo - 'status') = (v_velho - 'status') AND pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  IF OLD.redacted_at IS NULL AND NEW.redacted_at IS NOT NULL
     AND NEW.title = '[redigido]' AND NEW.context = '[redigido]' AND NEW.body = '[redigido]'
     AND (NEW.evidence IS NULL OR NEW.evidence = '[redigido]')
     AND (NEW.on_behalf_of IS NULL OR NEW.on_behalf_of = '[redigido]')
     AND (v_novo - v_redacao) = (v_velho - v_redacao) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'decisão é imutável: o status muda só por evento e o conteúdo só por core.redigir_decisao'
    USING ERRCODE = 'restrict_violation';
END;
$$;

COMMENT ON FUNCTION core.decisao_imutavel IS
  'BEFORE UPDATE de core.client_decisions: nega tudo, exceto o status vindo do gatilho de evento (profundidade de gatilho maior que 1), a redação LGPD e o SET NULL de decided_by quando o usuário é apagado.';

CREATE OR REPLACE FUNCTION core.decisao_evento_imutavel()
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
     AND current_setting('orla.redigindo_decisao', true) = OLD.decision_id::text
     AND OLD.type <> 'redigida' AND OLD.reason IS NOT NULL AND NEW.reason = '[redigido]'
     AND (to_jsonb(NEW) - 'reason') = (to_jsonb(OLD) - 'reason') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'evento de decisão é só de acréscimo' USING ERRCODE = 'restrict_violation';
END;
$$;

COMMENT ON FUNCTION core.decisao_evento_imutavel IS
  'BEFORE UPDATE de core.client_decision_events: só acréscimo. Exceções estreitas: SET NULL de actor_user_id (usuário apagado) e, só dentro de core.redigir_decisao (marca orla.redigindo_decisao local à transação, que o app não alcança: não tem UPDATE e o gatilho recusa o papel dele), trocar reason por [redigido] nos eventos da decisão redigida, exceto o próprio evento redigida. O DELETE usa core.decisao_nao_apaga.';

CREATE OR REPLACE FUNCTION core.decisao_nao_apaga()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM core.clients WHERE id = OLD.client_id) THEN
    RAISE EXCEPTION 'decisão e evento não se apagam; só o expurgo do cliente os leva' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION core.decisao_nao_apaga IS
  'BEFORE DELETE de core.client_decisions, core.client_decision_events e core.regras_migracao_contexto: nega DELETE enquanto o cliente existe; a cascata do expurgo passa porque o cliente já foi apagado.';

REVOKE ALL ON FUNCTION core.decisao_nao_apaga() FROM PUBLIC;

DROP TRIGGER IF EXISTS client_decisions_imutavel ON core.client_decisions;
CREATE TRIGGER client_decisions_imutavel BEFORE UPDATE ON core.client_decisions
  FOR EACH ROW EXECUTE FUNCTION core.decisao_imutavel();
DROP TRIGGER IF EXISTS client_decisions_nao_apaga ON core.client_decisions;
CREATE TRIGGER client_decisions_nao_apaga BEFORE DELETE ON core.client_decisions
  FOR EACH ROW EXECUTE FUNCTION core.decisao_nao_apaga();
DROP TRIGGER IF EXISTS client_decision_events_imutavel ON core.client_decision_events;
CREATE TRIGGER client_decision_events_imutavel BEFORE UPDATE ON core.client_decision_events
  FOR EACH ROW EXECUTE FUNCTION core.decisao_evento_imutavel();
DROP TRIGGER IF EXISTS client_decision_events_nao_apaga ON core.client_decision_events;
CREATE TRIGGER client_decision_events_nao_apaga BEFORE DELETE ON core.client_decision_events
  FOR EACH ROW EXECUTE FUNCTION core.decisao_nao_apaga();
DROP TRIGGER IF EXISTS regras_migracao_contexto_nao_apaga ON core.regras_migracao_contexto;
CREATE TRIGGER regras_migracao_contexto_nao_apaga BEFORE DELETE ON core.regras_migracao_contexto
  FOR EACH ROW EXECUTE FUNCTION core.decisao_nao_apaga();

CREATE OR REPLACE FUNCTION core.redigir_decisao(p_decisao uuid, p_motivo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_dec core.client_decisions;
  v_id  uuid;
BEGIN
  IF p_motivo IS NULL OR length(btrim(p_motivo)) < 3 OR length(p_motivo) > 500 THEN
    RAISE EXCEPTION 'motivo da redação obrigatório (3 a 500 caracteres)' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_dec FROM core.client_decisions WHERE id = p_decisao;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'decisão inexistente' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('orla:decisoes'), hashtext(v_dec.client_id::text));

  FOR v_id IN
    WITH RECURSIVE cadeia(id) AS (
      SELECT p_decisao
      UNION
      SELECT d.id
        FROM cadeia c
        JOIN core.client_decisions atual ON atual.id = c.id
        JOIN core.client_decisions d
          ON d.client_id = v_dec.client_id
         AND (d.supersedes_id = atual.id OR d.id = atual.supersedes_id)
    )
    SELECT d.id FROM core.client_decisions d JOIN cadeia USING (id)
     WHERE d.redacted_at IS NULL
     ORDER BY d.number
  LOOP
    PERFORM 1 FROM core.client_decisions WHERE id = v_id FOR UPDATE;

    INSERT INTO core.client_decision_events
      (organization_id, client_id, decision_id, type, actor_kind, reason, request_id)
    VALUES (v_dec.organization_id, v_dec.client_id, v_id, 'redigida', 'sistema', p_motivo,
            left(nullif(current_setting('app.request_id', true), ''), 120));

    UPDATE core.client_decisions
       SET title = '[redigido]', context = '[redigido]', body = '[redigido]',
           evidence = CASE WHEN evidence IS NULL THEN NULL ELSE '[redigido]' END,
           on_behalf_of = CASE WHEN on_behalf_of IS NULL THEN NULL ELSE '[redigido]' END,
           redacted_at = now()
     WHERE id = v_id;

    PERFORM set_config('orla.redigindo_decisao', v_id::text, true);
    UPDATE core.client_decision_events
       SET reason = '[redigido]'
     WHERE decision_id = v_id AND type <> 'redigida' AND reason IS NOT NULL AND reason <> '[redigido]';
    PERFORM set_config('orla.redigindo_decisao', '', true);
  END LOOP;
END;
$$;

COMMENT ON FUNCTION core.redigir_decisao IS
  'Redação LGPD (ADR 0051 §7): redige a decisão e toda a sua cadeia de supersessão nos dois sentidos (antecessoras e sucessoras ligadas por supersedes_id, que têm a mesma natureza, chave e escopo e costumam copiar o texto). Em cada decisão ainda não redigida troca título, contexto, texto, evidência e on_behalf_of por [redigido] e o motivo livre dos eventos (revogação, rejeição, efetivação) por [redigido]; mantém a linha, o valor e o motivo do evento redigida; marca redacted_at e grava um evento redigida por decisão afetada (é a auditoria da redação, no próprio banco). Só o worker executa; o app não tem EXECUTE.';

DO $$
BEGIN
  REVOKE ALL ON FUNCTION core.redigir_decisao(uuid, text) FROM PUBLIC;
  EXECUTE format('REVOKE ALL ON FUNCTION core.redigir_decisao(uuid, text) FROM %I', current_setting('contexto.papel_app'));
  EXECUTE format('GRANT EXECUTE ON FUNCTION core.redigir_decisao(uuid, text) TO %I', current_setting('contexto.papel_worker'));
END $$;

COMMIT;
