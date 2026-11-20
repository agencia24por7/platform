BEGIN;

DO $$
BEGIN
  PERFORM set_config(
    'exclusao.papel_app',
    (SELECT rolname FROM pg_roles WHERE rolname IN ('orla_app', 'tria_app') ORDER BY rolname = 'orla_app' DESC LIMIT 1),
    true
  );
END $$;

ALTER TABLE core.clients
  ADD COLUMN IF NOT EXISTS excluido_em timestamptz,
  ADD COLUMN IF NOT EXISTS excluido_por text;

ALTER TABLE core.clients DROP CONSTRAINT IF EXISTS clients_excluido_por_valido;
ALTER TABLE core.clients ADD CONSTRAINT clients_excluido_por_valido CHECK (
  (excluido_em IS NULL AND excluido_por IS NULL)
  OR (excluido_em IS NOT NULL AND length(btrim(coalesce(excluido_por, ''))) BETWEEN 1 AND 200)
);

COMMENT ON COLUMN core.clients.excluido_em IS
  'Exclusão lógica (ADR 0022). Preenchido, o cliente e tudo o que pende dele somem do app pelas políticas de RLS; nenhuma linha é apagada. core.restaurar_cliente desfaz; core.expurgar_cliente apaga de vez.';
COMMENT ON COLUMN core.clients.excluido_por IS
  'Quem pediu a exclusão lógica (operador ou script), para a trilha.';

ALTER TABLE core.clients DROP CONSTRAINT IF EXISTS clients_name_unique_per_org;
CREATE UNIQUE INDEX IF NOT EXISTS clients_nome_unico_entre_ativos
  ON core.clients (organization_id, name) WHERE excluido_em IS NULL;

COMMENT ON INDEX core.clients_nome_unico_entre_ativos IS
  'O nome é único só entre clientes não excluídos: um cliente excluído não impede cadastrar outro com o mesmo nome. Restaurar confere a colisão.';

DO $$ BEGIN
  EXECUTE 'DROP POLICY IF EXISTS clients_tenant ON core.clients';
  EXECUTE format(
    'CREATE POLICY clients_tenant ON core.clients FOR ALL TO %I
       USING (organization_id = core.current_organization() AND core.cliente_no_escopo(id) AND excluido_em IS NULL)
       WITH CHECK (organization_id = core.current_organization() AND core.cliente_no_escopo(id) AND excluido_em IS NULL)',
    current_setting('exclusao.papel_app'));

  EXECUTE 'DROP POLICY IF EXISTS ad_accounts_tenant ON integrations.ad_accounts';
  EXECUTE format(
    'CREATE POLICY ad_accounts_tenant ON integrations.ad_accounts FOR ALL TO %I
       USING (organization_id = core.current_organization() AND core.cliente_no_escopo(client_id)
              AND EXISTS (SELECT 1 FROM core.clients c WHERE c.id = ad_accounts.client_id))
       WITH CHECK (organization_id = core.current_organization() AND core.cliente_no_escopo(client_id)
              AND EXISTS (SELECT 1 FROM core.clients c WHERE c.id = ad_accounts.client_id))',
    current_setting('exclusao.papel_app'));

  EXECUTE 'DROP POLICY IF EXISTS coletas_tenant ON automation.coletas';
  EXECUTE format(
    'CREATE POLICY coletas_tenant ON automation.coletas FOR ALL TO %I
       USING (organization_id = core.current_organization() AND core.cliente_no_escopo(client_id)
              AND EXISTS (SELECT 1 FROM core.clients c WHERE c.id = coletas.client_id))
       WITH CHECK (organization_id = core.current_organization() AND core.cliente_no_escopo(client_id)
              AND EXISTS (SELECT 1 FROM core.clients c WHERE c.id = coletas.client_id))',
    current_setting('exclusao.papel_app'));

  EXECUTE 'DROP POLICY IF EXISTS connection_invites_tenant ON integrations.connection_invites';
  EXECUTE format(
    'CREATE POLICY connection_invites_tenant ON integrations.connection_invites FOR ALL TO %I
       USING (organization_id = core.current_organization()
              AND EXISTS (SELECT 1 FROM core.clients c WHERE c.id = connection_invites.client_id))
       WITH CHECK (organization_id = core.current_organization()
              AND EXISTS (SELECT 1 FROM core.clients c WHERE c.id = connection_invites.client_id))',
    current_setting('exclusao.papel_app'));

  EXECUTE 'DROP POLICY IF EXISTS account_tasks_tenant ON automation.account_tasks';
  EXECUTE format(
    'CREATE POLICY account_tasks_tenant ON automation.account_tasks FOR ALL TO %I
       USING (organization_id = core.current_organization() AND core.current_clients() IS NULL
              AND (client_id IS NULL OR EXISTS (SELECT 1 FROM core.clients c WHERE c.id = account_tasks.client_id)))
       WITH CHECK (organization_id = core.current_organization() AND core.current_clients() IS NULL
              AND (client_id IS NULL OR EXISTS (SELECT 1 FROM core.clients c WHERE c.id = account_tasks.client_id)))',
    current_setting('exclusao.papel_app'));
END $$;

COMMENT ON POLICY clients_tenant ON core.clients IS
  'Cliente visível = da organização, no recorte e não excluído. As tabelas que pendem do cliente repetem a regra com EXISTS em core.clients, que já vem filtrado por esta política: um só lugar decide o que é cliente visível.';
COMMENT ON POLICY ad_accounts_tenant ON integrations.ad_accounts IS
  'Conta de cliente excluído some. metrics_daily, metrics_restatements e sync_runs herdam, porque as políticas delas consultam ad_accounts.';

DROP FUNCTION IF EXISTS core.excluir_cliente(uuid);

CREATE OR REPLACE FUNCTION core.expurgar_cliente(p_cliente uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
VOLATILE
AS $$
DECLARE
  v_organizacao uuid;
  v_contas uuid[];
  revisoes integer;
  metricas integer;
  execucoes integer;
  coletas integer;
  convites integer;
  acessos integer;
  contas integer;
BEGIN
  SELECT organization_id INTO v_organizacao FROM core.clients WHERE id = p_cliente;
  IF v_organizacao IS NULL THEN
    RAISE EXCEPTION 'cliente % não existe', p_cliente;
  END IF;
  IF EXISTS (SELECT 1 FROM core.clients WHERE parent_client_id = p_cliente) THEN
    RAISE EXCEPTION 'cliente % tem clientes vinculados; expurgue-os antes', p_cliente;
  END IF;

  SELECT coalesce(array_agg(id), '{}') INTO v_contas FROM integrations.ad_accounts WHERE client_id = p_cliente;

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
          jsonb_build_object('contas', contas, 'metricas', metricas));

  RETURN jsonb_build_object(
    'organizacao', v_organizacao,
    'revisoes', revisoes,
    'metricas', metricas,
    'execucoes', execucoes,
    'coletas', coletas,
    'convites', convites,
    'acessos', acessos,
    'contas', contas
  );
END;
$$;

COMMENT ON FUNCTION core.expurgar_cliente IS
  'Expurgo: apaga o cliente e todo o seu histórico no Postgres. Só para obrigação legal de eliminação (LGPD), nunca como exclusão do dia a dia, que é core.excluir_cliente. O BigQuery é expurgado pelo scripts/titular.mjs expurgar-cliente. Só o dono do banco executa.';

REVOKE ALL ON FUNCTION core.expurgar_cliente(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION core.excluir_cliente(p_cliente uuid, p_por text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
VOLATILE
AS $$
DECLARE
  v_cliente core.clients%ROWTYPE;
  contas integer;
  convites integer;
  tarefas integer;
BEGIN
  SELECT * INTO v_cliente FROM core.clients WHERE id = p_cliente FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cliente % não existe', p_cliente;
  END IF;
  IF v_cliente.excluido_em IS NOT NULL THEN
    RAISE EXCEPTION 'cliente % já foi excluído em %', p_cliente, v_cliente.excluido_em;
  END IF;
  IF EXISTS (SELECT 1 FROM core.clients WHERE parent_client_id = p_cliente AND excluido_em IS NULL) THEN
    RAISE EXCEPTION 'cliente % tem clientes vinculados ativos; exclua-os antes', p_cliente;
  END IF;

  UPDATE core.clients
     SET excluido_em = now(), excluido_por = btrim(p_por), status = 'archived'
   WHERE id = p_cliente;

  SELECT count(*) INTO contas FROM integrations.ad_accounts WHERE client_id = p_cliente;

  UPDATE integrations.connection_invite_items i
     SET status = 'revoked'
    FROM integrations.connection_invites v
   WHERE i.invite_id = v.id AND v.client_id = p_cliente AND v.status = 'pending' AND i.status = 'pending';
  UPDATE integrations.connection_invites
     SET status = 'revoked', revoked_at = now()
   WHERE client_id = p_cliente AND status = 'pending';
  GET DIAGNOSTICS convites = ROW_COUNT;

  UPDATE automation.account_tasks
     SET status = 'failed', outcome = 'cliente excluído'
   WHERE client_id = p_cliente AND status = 'pending';
  GET DIAGNOSTICS tarefas = ROW_COUNT;

  INSERT INTO audit.audit_log (organization_id, actor_type, action, target_type, target_id, metadata)
  VALUES (v_cliente.organization_id, 'system', 'client.excluded', 'client', p_cliente::text,
          jsonb_build_object('por', btrim(p_por), 'statusAnterior', v_cliente.status, 'contas', contas,
                             'convitesRevogados', convites, 'tarefasCanceladas', tarefas));

  RETURN jsonb_build_object(
    'organizacao', v_cliente.organization_id,
    'cliente', v_cliente.name,
    'statusAnterior', v_cliente.status,
    'contas', contas,
    'convitesRevogados', convites,
    'tarefasCanceladas', tarefas
  );
END;
$$;

COMMENT ON FUNCTION core.excluir_cliente(uuid, text) IS
  'Exclusão lógica (ADR 0022): marca o cliente como excluído e arquivado, o que tira as fontes dele da coleta (fontes_de_coleta e sync_queue só pegam cliente ativo) e o esconde do app pela RLS. Revoga convites pendentes e cancela tarefas pendentes; não apaga nada. O BigQuery recebe o estado pela sincronização de dimensões. Só o dono do banco executa (scripts/titular.mjs).';

REVOKE ALL ON FUNCTION core.excluir_cliente(uuid, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION core.restaurar_cliente(p_cliente uuid, p_por text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
VOLATILE
AS $$
DECLARE
  v_cliente core.clients%ROWTYPE;
BEGIN
  SELECT * INTO v_cliente FROM core.clients WHERE id = p_cliente FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cliente % não existe', p_cliente;
  END IF;
  IF v_cliente.excluido_em IS NULL THEN
    RAISE EXCEPTION 'cliente % não está excluído', p_cliente;
  END IF;
  IF EXISTS (SELECT 1 FROM core.clients WHERE id = v_cliente.parent_client_id AND excluido_em IS NOT NULL) THEN
    RAISE EXCEPTION 'cliente % pende de um cliente excluído; restaure-o antes', p_cliente;
  END IF;
  IF EXISTS (
    SELECT 1 FROM core.clients
    WHERE organization_id = v_cliente.organization_id AND name = v_cliente.name AND excluido_em IS NULL
  ) THEN
    RAISE EXCEPTION 'já existe cliente ativo chamado "%"; renomeie-o antes de restaurar', v_cliente.name;
  END IF;

  UPDATE core.clients
     SET excluido_em = NULL, excluido_por = NULL, status = 'paused'
   WHERE id = p_cliente;

  INSERT INTO audit.audit_log (organization_id, actor_type, action, target_type, target_id, metadata)
  VALUES (v_cliente.organization_id, 'system', 'client.restored', 'client', p_cliente::text,
          jsonb_build_object('por', btrim(p_por), 'excluidoEm', v_cliente.excluido_em));

  RETURN jsonb_build_object(
    'organizacao', v_cliente.organization_id,
    'cliente', v_cliente.name,
    'excluidoEm', v_cliente.excluido_em,
    'status', 'paused'
  );
END;
$$;

COMMENT ON FUNCTION core.restaurar_cliente(uuid, text) IS
  'Desfaz a exclusão lógica. O cliente volta pausado: retomar a coleta é decisão de quem opera, na tela do cliente. Convites revogados continuam revogados. Só o dono do banco executa (scripts/titular.mjs).';

REVOKE ALL ON FUNCTION core.restaurar_cliente(uuid, text) FROM PUBLIC;

DROP FUNCTION IF EXISTS automation.dimensao_clientes();

CREATE FUNCTION automation.dimensao_clientes()
RETURNS TABLE (
  organization_id   uuid,
  client_id         uuid,
  nome              text,
  status            text,
  parent_client_id  uuid,
  business_model    text,
  excluido_em       timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT c.organization_id, c.id, c.name, c.status::text, c.parent_client_id, c.business_model::text, c.excluido_em
  FROM core.clients c;
$$;

COMMENT ON FUNCTION automation.dimensao_clientes IS
  'Estado atual dos clientes para a sincronização diária de dim_cliente_scd2, inclusive os excluídos logicamente: o serviço grava a versão com status excluido.';

REVOKE ALL ON FUNCTION automation.dimensao_clientes() FROM PUBLIC;
DO $$ BEGIN
  EXECUTE format('GRANT EXECUTE ON FUNCTION automation.dimensao_clientes() TO %I', current_setting('exclusao.papel_app'));
END $$;

COMMIT;
