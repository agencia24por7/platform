BEGIN;

DO $$
BEGIN
  PERFORM set_config(
    'brain.papel_app',
    (SELECT rolname FROM pg_roles WHERE rolname IN ('orla_app', 'tria_app') ORDER BY rolname = 'orla_app' DESC LIMIT 1),
    true
  );
  PERFORM set_config(
    'brain.papel_worker',
    coalesce((SELECT rolname FROM pg_roles WHERE rolname = 'orla_worker'), current_setting('brain.papel_app')),
    true
  );
END $$;

CREATE TABLE core.client_brain_catalog_state (
  client_id            uuid PRIMARY KEY REFERENCES core.clients(id) ON DELETE CASCADE,
  organization_id      uuid NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
  pendente             boolean NOT NULL DEFAULT true,
  motivo               text CHECK (motivo IS NULL OR length(motivo) <= 80),
  solicitado_em        timestamptz NOT NULL DEFAULT now(),
  publicado_em         timestamptz,
  ultimo_hash          text CHECK (ultimo_hash IS NULL OR ultimo_hash ~ '^[0-9a-f]{64}$'),
  entradas             integer CHECK (entradas IS NULL OR entradas >= 0),
  ultima_tentativa_em  timestamptz,
  ultimo_erro          text CHECK (ultimo_erro IS NULL OR length(ultimo_erro) <= 500),
  tentativas           integer NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
  atualizado_em        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX client_brain_catalog_state_org_idx ON core.client_brain_catalog_state (organization_id);

COMMENT ON TABLE core.client_brain_catalog_state IS
  'Estado da publicação do catálogo do company brain no bucket (ADR 0030): último hash publicado, quando, se há pedido pendente e a última falha. Só metadado: o catálogo em si vive em orgs/{org}/clientes/{cliente}/brain/.';

CREATE TABLE core.client_brain_coverage (
  client_id        uuid NOT NULL REFERENCES core.clients(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
  tabela           text NOT NULL CHECK (tabela ~ '^[a-z][a-z0-9_]{1,62}$'),
  desde            date,
  ate              date,
  linhas           bigint NOT NULL DEFAULT 0 CHECK (linhas >= 0),
  dias_com_dado    integer CHECK (dias_com_dado IS NULL OR dias_com_dado >= 0),
  medido_em        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, tabela),
  CONSTRAINT client_brain_coverage_janela CHECK (desde IS NULL OR ate IS NULL OR ate >= desde)
);

CREATE INDEX client_brain_coverage_org_idx ON core.client_brain_coverage (organization_id);

COMMENT ON TABLE core.client_brain_coverage IS
  'Cópia no Postgres da última medida de cobertura por cliente e tabela (gov_cobertura_cliente no BigQuery), para o catálogo montar rápido sem consultar o BigQuery (ADR 0030).';

DO $$ BEGIN
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON core.client_brain_catalog_state TO %I', current_setting('brain.papel_app'));
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON core.client_brain_coverage TO %I', current_setting('brain.papel_app'));
END $$;

ALTER TABLE core.client_brain_catalog_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.client_brain_catalog_state FORCE ROW LEVEL SECURITY;
ALTER TABLE core.client_brain_coverage ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.client_brain_coverage FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  EXECUTE format(
    'CREATE POLICY client_brain_catalog_state_tenant ON core.client_brain_catalog_state FOR ALL TO %I
       USING (organization_id = core.current_organization() AND core.cliente_no_escopo(client_id)
              AND EXISTS (SELECT 1 FROM core.clients c WHERE c.id = client_brain_catalog_state.client_id
                          AND c.organization_id = client_brain_catalog_state.organization_id))
       WITH CHECK (organization_id = core.current_organization() AND core.cliente_no_escopo(client_id)
              AND EXISTS (SELECT 1 FROM core.clients c WHERE c.id = client_brain_catalog_state.client_id
                          AND c.organization_id = client_brain_catalog_state.organization_id))',
    current_setting('brain.papel_app'));
  EXECUTE format(
    'CREATE POLICY client_brain_coverage_tenant ON core.client_brain_coverage FOR ALL TO %I
       USING (organization_id = core.current_organization() AND core.cliente_no_escopo(client_id)
              AND EXISTS (SELECT 1 FROM core.clients c WHERE c.id = client_brain_coverage.client_id
                          AND c.organization_id = client_brain_coverage.organization_id))
       WITH CHECK (organization_id = core.current_organization() AND core.cliente_no_escopo(client_id)
              AND EXISTS (SELECT 1 FROM core.clients c WHERE c.id = client_brain_coverage.client_id
                          AND c.organization_id = client_brain_coverage.organization_id))',
    current_setting('brain.papel_app'));
END $$;

CREATE FUNCTION core.brain_resolver_cliente(p_client_id uuid)
RETURNS TABLE (organization_id uuid, client_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT c.organization_id, c.id
  FROM core.clients c
  JOIN core.organizations o ON o.id = c.organization_id
  WHERE c.id = p_client_id AND c.excluido_em IS NULL AND o.status <> 'archived';
$$;

COMMENT ON FUNCTION core.brain_resolver_cliente IS
  'Resolve a organização de um cliente para a API do brain, que roda com credencial de worker e sem contexto de tenant (molde de automation.resolve_coleta_fonte). Cliente excluído logicamente não resolve: a API responde 404.';

CREATE FUNCTION core.brain_clientes_para_publicar(p_limite integer DEFAULT 50)
RETURNS TABLE (organization_id uuid, client_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT c.organization_id, c.id
  FROM core.clients c
  JOIN core.organizations o ON o.id = c.organization_id
  LEFT JOIN core.client_brain_catalog_state s ON s.client_id = c.id
  WHERE c.excluido_em IS NULL
    AND c.status = 'active'
    AND o.status = 'active'
    AND (
      s.client_id IS NULL
      OR s.pendente
      OR s.publicado_em IS NULL
      OR s.publicado_em < now() - interval '20 hours'
      OR EXISTS (SELECT 1 FROM automation.coletas k WHERE k.client_id = c.id AND k.finished_at > s.publicado_em)
    )
    AND (
      s.ultimo_erro IS NULL
      OR s.ultima_tentativa_em IS NULL
      OR s.ultima_tentativa_em < now() - make_interval(mins => least(5 * power(2, least(s.tentativas, 8))::integer, 720))
    )
  ORDER BY s.publicado_em NULLS FIRST, c.id
  LIMIT greatest(least(p_limite, 500), 1);
$$;

COMMENT ON FUNCTION core.brain_clientes_para_publicar IS
  'Varredura do catálogo (ADR 0030): clientes ativos sem publicação, com pedido pendente, com coleta concluída depois da última publicação ou publicados há mais de 20 horas. Falha recente espera com recuo exponencial (5 min a 12 h).';

CREATE FUNCTION core.brain_clientes_excluidos_publicados(p_limite integer DEFAULT 50)
RETURNS TABLE (organization_id uuid, client_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT s.organization_id, s.client_id
  FROM core.client_brain_catalog_state s
  JOIN core.clients c ON c.id = s.client_id
  WHERE c.excluido_em IS NOT NULL AND s.publicado_em IS NOT NULL
  ORDER BY s.client_id
  LIMIT greatest(least(p_limite, 500), 1);
$$;

COMMENT ON FUNCTION core.brain_clientes_excluidos_publicados IS
  'Clientes excluídos logicamente que ainda têm catálogo publicado no bucket: a varredura apaga orgs/{org}/clientes/{cliente}/brain/ e marca despublicado.';

CREATE FUNCTION core.brain_marcar_despublicado(p_client_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
VOLATILE
AS $$
  UPDATE core.client_brain_catalog_state s
  SET publicado_em = NULL, ultimo_hash = NULL, pendente = false, motivo = 'cliente_excluido', atualizado_em = now()
  WHERE s.client_id = p_client_id
    AND EXISTS (SELECT 1 FROM core.clients c WHERE c.id = s.client_id AND c.excluido_em IS NOT NULL);
$$;

COMMENT ON FUNCTION core.brain_marcar_despublicado IS
  'Fecha o estado do catálogo de um cliente excluído depois de apagar o prefixo brain/ do bucket. Só age em cliente excluído, que a política de RLS esconde do papel do app.';

CREATE FUNCTION core.brain_clientes_para_medir(p_limite integer DEFAULT 25)
RETURNS TABLE (organization_id uuid, client_id uuid, plataformas text[])
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  WITH fontes AS (
    SELECT a.client_id, a.platform::text AS platform
    FROM integrations.ad_accounts a
    WHERE a.status = 'linked'
    UNION
    SELECT ca.client_id, ca.platform::text
    FROM integrations.connection_accounts ca
    WHERE ca.client_id IS NOT NULL AND ca.state = 'linked' AND NOT ca.inactive AND ca.ad_account_id IS NULL
  ),
  medidas AS (
    SELECT m.client_id, max(m.medido_em) AS em FROM core.client_brain_coverage m GROUP BY m.client_id
  )
  SELECT c.organization_id, c.id, array_agg(DISTINCT f.platform ORDER BY f.platform)
  FROM core.clients c
  JOIN core.organizations o ON o.id = c.organization_id
  JOIN fontes f ON f.client_id = c.id
  LEFT JOIN medidas m ON m.client_id = c.id
  WHERE c.excluido_em IS NULL AND c.status = 'active' AND o.status = 'active'
    AND (m.em IS NULL OR m.em < now() - interval '20 hours')
  GROUP BY c.organization_id, c.id, m.em
  ORDER BY m.em NULLS FIRST, c.id
  LIMIT greatest(least(p_limite, 200), 1);
$$;

COMMENT ON FUNCTION core.brain_clientes_para_medir IS
  'Clientes ativos com fonte vinculada cuja cobertura no BigQuery não foi medida nas últimas 20 horas (no máximo uma medida por dia por cliente, ADR 0030).';

REVOKE ALL ON FUNCTION core.brain_resolver_cliente(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION core.brain_clientes_para_publicar(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION core.brain_clientes_excluidos_publicados(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION core.brain_marcar_despublicado(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION core.brain_clientes_para_medir(integer) FROM PUBLIC;

DO $$ BEGIN
  EXECUTE format('GRANT EXECUTE ON FUNCTION core.brain_resolver_cliente(uuid) TO %I', current_setting('brain.papel_worker'));
  EXECUTE format('GRANT EXECUTE ON FUNCTION core.brain_clientes_para_publicar(integer) TO %I', current_setting('brain.papel_worker'));
  EXECUTE format('GRANT EXECUTE ON FUNCTION core.brain_clientes_excluidos_publicados(integer) TO %I', current_setting('brain.papel_worker'));
  EXECUTE format('GRANT EXECUTE ON FUNCTION core.brain_marcar_despublicado(uuid) TO %I', current_setting('brain.papel_worker'));
  EXECUTE format('GRANT EXECUTE ON FUNCTION core.brain_clientes_para_medir(integer) TO %I', current_setting('brain.papel_worker'));
END $$;

COMMIT;
