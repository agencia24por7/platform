BEGIN;

DO $$
BEGIN
  PERFORM set_config(
    'coleta.papel_app',
    (SELECT rolname FROM pg_roles WHERE rolname IN ('orla_app', 'tria_app') ORDER BY rolname = 'orla_app' DESC LIMIT 1),
    true
  );
END $$;

CREATE OR REPLACE FUNCTION automation.dimensao_fontes()
RETURNS TABLE (
  organization_id  uuid,
  platform         text,
  external_id      text,
  origem           text,
  client_id        uuid,
  status           text,
  nome             text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT a.organization_id, a.platform::text, a.external_id, 'ad_account',
         CASE WHEN a.status = 'unlinked' THEN NULL ELSE a.client_id END,
         a.status::text, a.name
  FROM integrations.ad_accounts a

  UNION ALL

  SELECT r.organization_id, r.platform, r.external_id, 'connection_account', r.client_id, r.state, r.name
  FROM (
    SELECT DISTINCT ON (ca.organization_id, ca.platform, ca.external_id)
           ca.organization_id, ca.platform::text AS platform, ca.external_id, ca.client_id, ca.state::text AS state, ca.name
    FROM integrations.connection_accounts ca
    WHERE ca.platform NOT IN ('google', 'meta')
    ORDER BY ca.organization_id, ca.platform, ca.external_id,
             (ca.state = 'linked' AND ca.client_id IS NOT NULL) DESC, ca.inactive, ca.discovered_at DESC, ca.id
  ) r;
$$;

COMMENT ON FUNCTION automation.dimensao_fontes IS
  'Estado atual de posse de cada fonte (organização, plataforma, external_id — a mesma chave gravada nos fatos do BigQuery), para a sincronização diária de dim_fonte_scd2. Atravessa tenants como fontes_de_coleta. Conta de anúncio desvinculada sai sem cliente; recurso repetido em duas conexões vale pela linha vinculada mais recente.';

CREATE OR REPLACE FUNCTION automation.dimensao_clientes()
RETURNS TABLE (
  organization_id   uuid,
  client_id         uuid,
  nome              text,
  status            text,
  parent_client_id  uuid,
  business_model    text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT c.organization_id, c.id, c.name, c.status::text, c.parent_client_id, c.business_model::text
  FROM core.clients c;
$$;

COMMENT ON FUNCTION automation.dimensao_clientes IS
  'Estado atual dos clientes para a sincronização diária de dim_cliente_scd2.';

CREATE OR REPLACE FUNCTION automation.dimensao_mudancas_de_posse()
RETURNS TABLE (
  organization_id     uuid,
  platform            text,
  external_id         text,
  em                  timestamptz,
  dono_conhecido      boolean,
  client_id_anterior  uuid,
  status_anterior     text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT a.organization_id, a.platform::text, a.external_id, l.occurred_at,
         l.action = 'ad_account.relinked' OR coalesce(de.id, CASE WHEN l.action = 'ad_account.unlinked' THEN a.client_id END) IS NOT NULL,
         CASE WHEN l.action = 'ad_account.relinked' THEN NULL
              ELSE coalesce(de.id, CASE WHEN l.action = 'ad_account.unlinked' THEN a.client_id END) END,
         CASE WHEN l.action = 'ad_account.relinked' THEN 'unlinked' ELSE 'linked' END
  FROM audit.audit_log l
  JOIN integrations.ad_accounts a ON l.target_type = 'ad_account' AND l.target_id = a.id::text
  LEFT JOIN core.clients de ON de.organization_id = a.organization_id AND (de.name = l.metadata ->> 'de' OR de.id::text = l.metadata ->> 'de')
  WHERE l.action IN ('ad_account.reassigned', 'ad_account.unlinked', 'ad_account.relinked')

  UNION ALL

  SELECT a.organization_id, a.platform::text, a.external_id, a.updated_at, true, a.client_id, 'linked'
  FROM integrations.ad_accounts a
  WHERE a.status = 'unlinked'
    AND NOT EXISTS (
      SELECT 1 FROM audit.audit_log l
      WHERE l.action = 'ad_account.unlinked' AND l.target_type = 'ad_account' AND l.target_id = a.id::text
    )

  UNION ALL

  SELECT ca.organization_id, ca.platform::text, ca.external_id, l.occurred_at,
         l.action = 'connection_account.link' OR de.id IS NOT NULL,
         CASE WHEN l.action = 'connection_account.link' THEN NULL ELSE de.id END,
         CASE WHEN l.action = 'connection_account.link' THEN 'discovered' ELSE 'linked' END
  FROM audit.audit_log l
  JOIN integrations.connection_accounts ca ON l.target_type = 'connection_account' AND l.target_id = ca.id::text
  LEFT JOIN core.clients de ON de.organization_id = ca.organization_id AND (de.name = l.metadata ->> 'de' OR de.id::text = l.metadata ->> 'de')
  WHERE l.action IN ('connection_account.reassigned', 'connection_account.unlink', 'connection_account.link')
    AND ca.platform NOT IN ('google', 'meta');
$$;

COMMENT ON FUNCTION automation.dimensao_mudancas_de_posse IS
  'Mudanças de posse reconstruídas da trilha de auditoria (mover, desvincular, vincular), com o dono ANTERIOR a cada mudança. Usada só na primeira carga de cada fonte em dim_fonte_scd2. O dono anterior vem do nome gravado em metadata.de; nome que não casa mais com um cliente marca o dono como desconhecido.';

REVOKE ALL ON FUNCTION automation.dimensao_fontes() FROM PUBLIC;
REVOKE ALL ON FUNCTION automation.dimensao_clientes() FROM PUBLIC;
REVOKE ALL ON FUNCTION automation.dimensao_mudancas_de_posse() FROM PUBLIC;

DO $$ BEGIN
  EXECUTE format('GRANT EXECUTE ON FUNCTION automation.dimensao_fontes() TO %I', current_setting('coleta.papel_app'));
  EXECUTE format('GRANT EXECUTE ON FUNCTION automation.dimensao_clientes() TO %I', current_setting('coleta.papel_app'));
  EXECUTE format('GRANT EXECUTE ON FUNCTION automation.dimensao_mudancas_de_posse() TO %I', current_setting('coleta.papel_app'));
END $$;

COMMIT;
