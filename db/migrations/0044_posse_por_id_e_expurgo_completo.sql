BEGIN;

DO $$
BEGIN
  PERFORM set_config(
    'revisao.papel_app',
    (SELECT rolname FROM pg_roles WHERE rolname IN ('orla_app', 'tria_app') ORDER BY rolname = 'orla_app' DESC LIMIT 1),
    true
  );
END $$;

CREATE OR REPLACE FUNCTION automation.dono_anterior_da_auditoria(p_organizacao uuid, p_metadata jsonb)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE WHEN count(*) = 1 THEN (array_agg(c.id))[1] END
  FROM core.clients c
  WHERE c.organization_id = p_organizacao
    AND CASE
          WHEN p_metadata ? 'deId' THEN c.id::text = p_metadata ->> 'deId'
          ELSE c.id::text = p_metadata ->> 'de' OR c.name = p_metadata ->> 'de'
        END;
$$;

COMMENT ON FUNCTION automation.dono_anterior_da_auditoria IS
  'Dono anterior gravado numa linha da auditoria (ADR 0023). Linha nova traz metadata.deId (uuid) e casa pelo id. Linha antiga só tem o nome em metadata.de: casa pelo nome só se exatamente um cliente da organização (excluído ou não) tiver esse nome; nome repetido ou que não casa devolve NULL, e o dono fica desconhecido.';

REVOKE ALL ON FUNCTION automation.dono_anterior_da_auditoria(uuid, jsonb) FROM PUBLIC;

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
  CROSS JOIN LATERAL (SELECT automation.dono_anterior_da_auditoria(a.organization_id, l.metadata) AS id) de
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
  CROSS JOIN LATERAL (SELECT automation.dono_anterior_da_auditoria(ca.organization_id, l.metadata) AS id) de
  WHERE l.action IN ('connection_account.reassigned', 'connection_account.unlink', 'connection_account.link')
    AND ca.platform NOT IN ('google', 'meta');
$$;

COMMENT ON FUNCTION automation.dimensao_mudancas_de_posse IS
  'Mudanças de posse reconstruídas da trilha de auditoria (mover, desvincular, vincular), com o dono ANTERIOR a cada mudança. Usada só na primeira carga de cada fonte em dim_fonte_scd2. O dono anterior vem de automation.dono_anterior_da_auditoria: metadata.deId quando existe; nas linhas antigas, o nome em metadata.de só quando não é ambíguo (ADR 0023).';

CREATE OR REPLACE FUNCTION core.expurgar_cliente(p_cliente uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
VOLATILE
AS $$
DECLARE
  v_organizacao uuid;
  v_nome text;
  v_nome_exclusivo boolean;
  v_contas uuid[];
  revisoes integer;
  metricas integer;
  execucoes integer;
  coletas integer;
  convites integer;
  acessos integer;
  contas integer;
  recursos integer;
  auditoria integer;
BEGIN
  SELECT organization_id, name INTO v_organizacao, v_nome FROM core.clients WHERE id = p_cliente;
  IF v_organizacao IS NULL THEN
    RAISE EXCEPTION 'cliente % não existe', p_cliente;
  END IF;
  IF EXISTS (SELECT 1 FROM core.clients WHERE parent_client_id = p_cliente) THEN
    RAISE EXCEPTION 'cliente % tem clientes vinculados; expurgue-os antes', p_cliente;
  END IF;

  v_nome_exclusivo := NOT EXISTS (
    SELECT 1 FROM core.clients WHERE organization_id = v_organizacao AND name = v_nome AND id != p_cliente
  );

  SELECT coalesce(array_agg(id), '{}') INTO v_contas FROM integrations.ad_accounts WHERE client_id = p_cliente;

  UPDATE audit.audit_log l
     SET metadata = (
       SELECT jsonb_object_agg(
                e.key,
                CASE WHEN e.key IN ('de', 'para', 'cliente', 'name') AND (
                       (e.value #>> '{}') = v_nome AND v_nome_exclusivo
                       OR l.metadata ->> (CASE e.key WHEN 'de' THEN 'deId' WHEN 'para' THEN 'paraId' ELSE 'clientId' END) = p_cliente::text
                       OR (e.key = 'name' AND l.target_type = 'client' AND l.target_id = p_cliente::text))
                     THEN to_jsonb('[cliente expurgado]'::text)
                     ELSE e.value END)
       FROM jsonb_each(l.metadata) e)
   WHERE l.organization_id = v_organizacao
     AND jsonb_typeof(l.metadata) = 'object'
     AND EXISTS (
       SELECT 1 FROM jsonb_each(l.metadata) e
       WHERE e.key IN ('de', 'para', 'cliente', 'name')
         AND (e.value #>> '{}') IS DISTINCT FROM '[cliente expurgado]'
         AND ((e.value #>> '{}') = v_nome AND v_nome_exclusivo
              OR l.metadata ->> (CASE e.key WHEN 'de' THEN 'deId' WHEN 'para' THEN 'paraId' ELSE 'clientId' END) = p_cliente::text
              OR (e.key = 'name' AND l.target_type = 'client' AND l.target_id = p_cliente::text)));
  GET DIAGNOSTICS auditoria = ROW_COUNT;

  UPDATE integrations.connection_accounts
     SET state = CASE WHEN state = 'linked' THEN 'discovered' ELSE state END,
         client_id = NULL,
         ad_account_id = NULL
   WHERE client_id = p_cliente OR ad_account_id = ANY (v_contas);
  GET DIAGNOSTICS recursos = ROW_COUNT;

  DELETE FROM metrics.metrics_restatements WHERE ad_account_id = ANY (v_contas);
  GET DIAGNOSTICS revisoes = ROW_COUNT;
  DELETE FROM metrics.metrics_daily WHERE ad_account_id = ANY (v_contas);
  GET DIAGNOSTICS metricas = ROW_COUNT;
  DELETE FROM automation.sync_runs WHERE ad_account_id = ANY (v_contas);
  GET DIAGNOSTICS execucoes = ROW_COUNT;
  DELETE FROM automation.coletas WHERE client_id = p_cliente OR ad_account_id = ANY (v_contas);
  GET DIAGNOSTICS coletas = ROW_COUNT;
  DELETE FROM integrations.connection_invites WHERE client_id = p_cliente;
  GET DIAGNOSTICS convites = ROW_COUNT;
  DELETE FROM core.member_clients WHERE client_id = p_cliente;
  GET DIAGNOSTICS acessos = ROW_COUNT;
  DELETE FROM integrations.ad_accounts WHERE client_id = p_cliente;
  GET DIAGNOSTICS contas = ROW_COUNT;
  DELETE FROM core.clients WHERE id = p_cliente;

  INSERT INTO audit.audit_log (organization_id, actor_type, action, target_type, target_id, metadata)
  VALUES (v_organizacao, 'system', 'client.purged', 'client', p_cliente::text,
          jsonb_build_object('contas', contas, 'metricas', metricas, 'recursosLiberados', recursos,
                             'auditoriaAnonimizada', auditoria));

  RETURN jsonb_build_object(
    'organizacao', v_organizacao,
    'revisoes', revisoes,
    'metricas', metricas,
    'execucoes', execucoes,
    'coletas', coletas,
    'convites', convites,
    'acessos', acessos,
    'contas', contas,
    'recursosLiberados', recursos,
    'auditoriaAnonimizada', auditoria
  );
END;
$$;

COMMENT ON FUNCTION core.expurgar_cliente IS
  'Expurgo: apaga o cliente e todo o seu histórico no Postgres. Só para obrigação legal de eliminação (LGPD), nunca como exclusão do dia a dia, que é core.excluir_cliente. Antes de apagar, troca o nome do cliente por [cliente expurgado] na trilha (de, para, cliente, name: pelo id gravado ao lado ou, se o nome é só dele na organização, pelo nome) e devolve os recursos que eram dele ao estado discovered, sem cliente (ADR 0023). O BigQuery é expurgado pelo scripts/titular.mjs expurgar-cliente, antes desta função. Só o dono do banco executa.';

REVOKE ALL ON FUNCTION core.expurgar_cliente(uuid) FROM PUBLIC;

COMMIT;
