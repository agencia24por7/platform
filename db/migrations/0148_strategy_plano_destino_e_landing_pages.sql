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
  IF to_regclass('core.strategy_plans') IS NULL OR to_regprocedure('core.strategy_plan_inquilino()') IS NULL THEN
    RAISE EXCEPTION 'core.strategy_plans ausente; a migracao 0143 precisa ter rodado';
  END IF;
  IF to_regprocedure('core.decisao_chamador_e_app()') IS NULL OR to_regprocedure('core.decisao_chamador_e_worker()') IS NULL THEN
    RAISE EXCEPTION 'core.decisao_chamador_e_app ou _worker ausente; a migracao 0141 precisa ter rodado';
  END IF;
END $$;

ALTER TABLE core.clients ADD COLUMN IF NOT EXISTS whatsapp text;
ALTER TABLE core.clients DROP CONSTRAINT IF EXISTS clients_whatsapp_e164;
ALTER TABLE core.clients ADD CONSTRAINT clients_whatsapp_e164
  CHECK (whatsapp IS NULL OR whatsapp ~ '^\+[1-9][0-9]{7,14}$');

COMMENT ON COLUMN core.clients.whatsapp IS
  'WhatsApp comercial do cliente em E.164 (+5511999998888), ou NULL se ainda nao informado. Dado de cadastro operacional, nao Contexto versionado (ADR 0051): e lido pelo plano como destino de conversa. Validado e normalizado no servidor; o CHECK e a defesa final.';

CREATE TABLE IF NOT EXISTS core.client_landing_pages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES core.organizations(id) ON DELETE RESTRICT,
  client_id        uuid NOT NULL REFERENCES core.clients(id) ON DELETE CASCADE,
  url              text NOT NULL CHECK (length(url) <= 2048 AND url ~ '^https://[^\s/@?#]+([/?#]\S*)?$'),
  rotulo           text NOT NULL CHECK (length(btrim(rotulo)) BETWEEN 1 AND 120),
  criada_em        timestamptz NOT NULL DEFAULT now(),
  arquivada_em     timestamptz,
  CONSTRAINT client_landing_pages_id_inquilino UNIQUE (id, organization_id, client_id)
);

COMMENT ON TABLE core.client_landing_pages IS
  'Paginas de destino do cliente (24K-132). O app so tem SELECT, INSERT e UPDATE de arquivada_em (arquivar e unico caminho de remocao; o plano referencia a pagina). URL unica entre as ativas do mesmo cliente. Escrita exige owner, admin ou operator (gatilho). Some com o cliente no expurgo.';

CREATE UNIQUE INDEX IF NOT EXISTS client_landing_pages_url_ativa
  ON core.client_landing_pages (client_id, lower(url)) WHERE arquivada_em IS NULL;
CREATE INDEX IF NOT EXISTS client_landing_pages_cliente
  ON core.client_landing_pages (client_id, criada_em DESC);

DO $$
DECLARE
  papel text := current_setting('contexto.papel_app');
  condicao text := 'organization_id = core.current_organization() AND core.cliente_no_escopo(client_id)
                AND EXISTS (SELECT 1 FROM core.clients c WHERE c.id = client_landing_pages.client_id)';
BEGIN
  ALTER TABLE core.client_landing_pages ENABLE ROW LEVEL SECURITY;
  ALTER TABLE core.client_landing_pages FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS client_landing_pages_leitura ON core.client_landing_pages;
  DROP POLICY IF EXISTS client_landing_pages_insercao ON core.client_landing_pages;
  DROP POLICY IF EXISTS client_landing_pages_atualizacao ON core.client_landing_pages;
  EXECUTE format('CREATE POLICY client_landing_pages_leitura ON core.client_landing_pages FOR SELECT TO %I USING (%s)', papel, condicao);
  EXECUTE format('CREATE POLICY client_landing_pages_insercao ON core.client_landing_pages FOR INSERT TO %I WITH CHECK (%s)', papel, condicao);
  EXECUTE format('CREATE POLICY client_landing_pages_atualizacao ON core.client_landing_pages FOR UPDATE TO %I USING (%s) WITH CHECK (%s)', papel, condicao, condicao);
  REVOKE ALL ON core.client_landing_pages FROM PUBLIC;
  EXECUTE format('REVOKE ALL ON core.client_landing_pages FROM %I', papel);
  EXECUTE format('GRANT SELECT, INSERT ON core.client_landing_pages TO %I', papel);
  EXECUTE format('GRANT UPDATE (arquivada_em) ON core.client_landing_pages TO %I', papel);
END $$;

CREATE OR REPLACE FUNCTION core.client_landing_page_escrita()
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
  IF NEW.organization_id IS DISTINCT FROM core.current_organization() OR NOT core.cliente_no_escopo(NEW.client_id)
     OR NOT EXISTS (SELECT 1 FROM core.clients c WHERE c.id = NEW.client_id) THEN
    RAISE EXCEPTION 'organização ou cliente fora do contexto da sessão' USING ERRCODE = 'insufficient_privilege';
  END IF;
  v_usuario := nullif(current_setting('app.user_id', true), '')::uuid;
  IF v_usuario IS NULL THEN
    RAISE EXCEPTION 'escrita de landing page exige usuário na sessão' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM core.memberships_of(v_usuario) m
        WHERE m.organization_id = NEW.organization_id AND m.role IN ('owner', 'admin', 'operator')) THEN
    RAISE EXCEPTION 'gravar landing page exige papel owner, admin ou operator' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.criada_em := now();
    NEW.arquivada_em := NULL;
  ELSE
    IF OLD.arquivada_em IS NOT NULL OR NEW.arquivada_em IS NULL THEN
      RAISE EXCEPTION 'landing page só se arquiva, uma vez' USING ERRCODE = 'restrict_violation';
    END IF;
    NEW.arquivada_em := now();
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION core.client_landing_page_escrita IS
  'BEFORE INSERT OR UPDATE de core.client_landing_pages, sem SECURITY DEFINER. Para o app: organização e cliente iguais aos da sessão e visíveis pela RLS de core.clients; exige app.user_id com papel owner, admin ou operator (core.memberships_of); viewer é negado. INSERT fixa criada_em e deixa arquivada_em nula; UPDATE só aceita arquivar uma página ainda ativa e fixa arquivada_em em now().';

DROP TRIGGER IF EXISTS client_landing_pages_escrita ON core.client_landing_pages;
CREATE TRIGGER client_landing_pages_escrita BEFORE INSERT OR UPDATE ON core.client_landing_pages
  FOR EACH ROW EXECUTE FUNCTION core.client_landing_page_escrita();

ALTER TABLE core.strategy_plans DROP CONSTRAINT IF EXISTS strategy_plans_tipo_unico;
CREATE INDEX IF NOT EXISTS strategy_plans_cliente_tipo ON core.strategy_plans (client_id, plan_type_key);

ALTER TABLE core.strategy_plans ADD COLUMN IF NOT EXISTS plataformas text[];
ALTER TABLE core.strategy_plans ADD COLUMN IF NOT EXISTS whatsapp text;
ALTER TABLE core.strategy_plans ADD COLUMN IF NOT EXISTS landing_page_id uuid;

ALTER TABLE core.strategy_plans DROP CONSTRAINT IF EXISTS strategy_plans_plataformas_validas;
ALTER TABLE core.strategy_plans ADD CONSTRAINT strategy_plans_plataformas_validas CHECK (
  plataformas IS NULL OR (
    cardinality(plataformas) BETWEEN 1 AND 13
    AND plataformas <@ ARRAY['google', 'meta', 'youtube', 'tiktok', 'linkedin', 'microsoft', 'x', 'pinterest', 'kwai', 'whatsapp', 'email', 'rd_station', 'outra']::text[]));
ALTER TABLE core.strategy_plans DROP CONSTRAINT IF EXISTS strategy_plans_whatsapp_e164;
ALTER TABLE core.strategy_plans ADD CONSTRAINT strategy_plans_whatsapp_e164 CHECK (whatsapp IS NULL OR whatsapp ~ '^\+[1-9][0-9]{7,14}$');
ALTER TABLE core.strategy_plans DROP CONSTRAINT IF EXISTS strategy_plans_landing_page_fk;
ALTER TABLE core.strategy_plans ADD CONSTRAINT strategy_plans_landing_page_fk FOREIGN KEY (landing_page_id, organization_id, client_id)
  REFERENCES core.client_landing_pages (id, organization_id, client_id);

CREATE INDEX IF NOT EXISTS strategy_plans_landing_page ON core.strategy_plans (landing_page_id);

COMMENT ON TABLE core.strategy_plans IS
  'Identidade estável do plano por cliente (ADR 0056 §2 e §9). Planos do mesmo tipo são independentes: o mesmo cliente pode ter vários (24K-132). Imutável: o app só tem SELECT e INSERT; gatilho nega UPDATE e DELETE. O conteúdo vive em core.strategy_plan_versions. Some com o cliente no expurgo (ON DELETE CASCADE).';
COMMENT ON COLUMN core.strategy_plans.plataformas IS
  'Plataformas do plano (lista de PLATAFORMAS em src/modules/strategy/domain/plano.ts), de 1 a 13, validada por CHECK. NULL so em planos anteriores a 0148 (sem dado inventado); plano novo sempre preenche, imposto no servico. Duplicatas sao recusadas no servidor.';
COMMENT ON COLUMN core.strategy_plans.whatsapp IS
  'WhatsApp de destino do plano em E.164. NULL so em planos anteriores a 0148; plano novo sempre preenche, imposto no servico.';
COMMENT ON COLUMN core.strategy_plans.landing_page_id IS
  'Pagina de destino do plano, do mesmo cliente e organizacao (FK composta; MATCH SIMPLE ignora a linha quando NULL). NULL so em planos anteriores a 0148; plano novo sempre preenche, imposto no servico.';

COMMIT;
