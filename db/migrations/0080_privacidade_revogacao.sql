BEGIN;

DO $$
BEGIN
  PERFORM set_config(
    'privacidade.papel_app',
    (SELECT rolname FROM pg_roles WHERE rolname IN ('orla_app', 'tria_app') ORDER BY rolname = 'orla_app' DESC LIMIT 1),
    true
  );
  PERFORM set_config(
    'privacidade.papel_worker',
    coalesce((SELECT rolname FROM pg_roles WHERE rolname = 'orla_worker'), current_setting('privacidade.papel_app')),
    true
  );
END $$;

CREATE SCHEMA IF NOT EXISTS privacidade;

DO $$ BEGIN
  EXECUTE format('GRANT USAGE ON SCHEMA privacidade TO %I', current_setting('privacidade.papel_app'));
END $$;

COMMENT ON SCHEMA privacidade IS
  'Pedidos de exclusão vindos das plataformas e a fila de expurgo de fontes (ADR 0029).';

CREATE OR REPLACE FUNCTION integrations.familia_do_provedor(p_plataforma text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    WHEN p_plataforma IN ('google', 'ga4', 'gtm', 'searchconsole', 'youtube', 'gbp') THEN 'google'
    WHEN p_plataforma IN ('meta', 'pixel', 'leadads', 'whatsapp') THEN 'meta'
  END;
$$;

COMMENT ON FUNCTION integrations.familia_do_provedor IS
  'Provedor OAuth da plataforma: um único cliente OAuth do Google e um único app da Meta servem todas as plataformas da família, então uma autorização da mesma pessoa é compartilhada entre elas (ADR 0029).';

CREATE OR REPLACE FUNCTION integrations.acesso_compartilhado(p_connection uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  WITH alvo AS (
    SELECT c.id, c.external_id, integrations.familia_do_provedor(c.platform::text) AS familia
    FROM integrations.connections c
    WHERE c.id = p_connection AND c.organization_id = core.current_organization()
  )
  SELECT EXISTS (
    SELECT 1
    FROM alvo a
    JOIN integrations.connections o ON o.external_id = a.external_id AND o.id <> a.id
    WHERE a.familia IS NOT NULL
      AND o.status <> 'revoked'
      AND integrations.familia_do_provedor(o.platform::text) = a.familia
  );
$$;

COMMENT ON FUNCTION integrations.acesso_compartilhado IS
  'Verdadeiro se a pessoa que autorizou esta conexão (mesmo external_id) autoriza outra conexão não revogada da mesma família de provedor, em qualquer organização. Revogar no provedor derrubaria a outra conexão, então removerConexao não revoga nesse caso (ADR 0029). Só responde para conexão da organização do contexto e devolve apenas um booleano.';

REVOKE ALL ON FUNCTION integrations.acesso_compartilhado(uuid) FROM PUBLIC;

DO $$ BEGIN
  EXECUTE format('GRANT EXECUTE ON FUNCTION integrations.acesso_compartilhado(uuid) TO %I', current_setting('privacidade.papel_app'));
END $$;

CREATE TABLE IF NOT EXISTS privacidade.pedidos_de_exclusao (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origem                 text NOT NULL CHECK (origem IN ('meta')),
  codigo_de_confirmacao  text NOT NULL UNIQUE CHECK (codigo_de_confirmacao ~ '^[A-Z0-9]{16,64}$'),
  usuario_externo_hash   text NOT NULL CHECK (usuario_externo_hash ~ '^[0-9a-f]{64}$'),
  status                 text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'em_andamento', 'concluido')),
  criado_em              timestamptz NOT NULL DEFAULT now(),
  atualizado_em          timestamptz NOT NULL DEFAULT now(),
  concluido_em           timestamptz,
  evidencia              text CHECK (evidencia IS NULL OR length(evidencia) <= 2000),
  base_legal             text NOT NULL DEFAULT 'Termos da Plataforma Meta (callback de exclusão de dados); LGPD art. 18, VI',
  CONSTRAINT pedidos_de_exclusao_conclusao_coerente CHECK ((status = 'concluido') = (concluido_em IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS pedidos_de_exclusao_um_aberto_por_usuario
  ON privacidade.pedidos_de_exclusao (origem, usuario_externo_hash) WHERE status <> 'concluido';

COMMENT ON TABLE privacidade.pedidos_de_exclusao IS
  'Pedidos de exclusão de dados recebidos pelo callback da Meta (POST /api/meta/exclusao). Guarda só o pseudônimo do usuário (HMAC-SHA256 com o segredo de sessão), nunca o id da Meta. Um pedido aberto por usuário: um segundo aviso devolve o mesmo código (ADR 0029).';

CREATE TABLE IF NOT EXISTS privacidade.pedidos_de_exclusao_conexoes (
  pedido_id        uuid NOT NULL REFERENCES privacidade.pedidos_de_exclusao(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
  connection_id    uuid NOT NULL REFERENCES integrations.connections(id) ON DELETE CASCADE,
  PRIMARY KEY (pedido_id, connection_id)
);

CREATE INDEX IF NOT EXISTS pedidos_de_exclusao_conexoes_org_idx
  ON privacidade.pedidos_de_exclusao_conexoes (organization_id);

COMMENT ON TABLE privacidade.pedidos_de_exclusao_conexoes IS
  'Conexões da Meta (de qualquer organização) autorizadas pelo usuário do pedido: é por elas que o admin vê o pedido pendente na tela do conector.';

ALTER TABLE privacidade.pedidos_de_exclusao ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacidade.pedidos_de_exclusao FORCE ROW LEVEL SECURITY;
ALTER TABLE privacidade.pedidos_de_exclusao_conexoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacidade.pedidos_de_exclusao_conexoes FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  EXECUTE 'DROP POLICY IF EXISTS pedidos_de_exclusao_conexoes_tenant ON privacidade.pedidos_de_exclusao_conexoes';
  EXECUTE format(
    'CREATE POLICY pedidos_de_exclusao_conexoes_tenant ON privacidade.pedidos_de_exclusao_conexoes FOR SELECT TO %I
       USING (organization_id = core.current_organization() AND core.current_clients() IS NULL)',
    current_setting('privacidade.papel_app'));

  EXECUTE 'DROP POLICY IF EXISTS pedidos_de_exclusao_tenant ON privacidade.pedidos_de_exclusao';
  EXECUTE format(
    'CREATE POLICY pedidos_de_exclusao_tenant ON privacidade.pedidos_de_exclusao FOR SELECT TO %I
       USING (EXISTS (SELECT 1 FROM privacidade.pedidos_de_exclusao_conexoes l WHERE l.pedido_id = pedidos_de_exclusao.id))',
    current_setting('privacidade.papel_app'));

  EXECUTE format('GRANT SELECT ON privacidade.pedidos_de_exclusao, privacidade.pedidos_de_exclusao_conexoes TO %I',
    current_setting('privacidade.papel_app'));
END $$;

CREATE OR REPLACE FUNCTION privacidade.registrar_pedido_de_exclusao_meta(
  p_usuario_hash text,
  p_usuario_externo text,
  p_codigo text
)
RETURNS TABLE (codigo text, situacao text, novo boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
VOLATILE
AS $$
DECLARE
  v_id uuid;
  v_codigo text;
  v_situacao text;
  v_novo boolean := false;
BEGIN
  IF p_usuario_externo IS NULL OR p_usuario_externo !~ '^[0-9]{1,32}$' THEN
    RAISE EXCEPTION 'usuário da Meta inválido';
  END IF;

  SELECT p.id, p.codigo_de_confirmacao, p.status INTO v_id, v_codigo, v_situacao
    FROM privacidade.pedidos_de_exclusao p
   WHERE p.origem = 'meta' AND p.usuario_externo_hash = p_usuario_hash AND p.status <> 'concluido'
   FOR UPDATE;

  IF v_id IS NULL THEN
    INSERT INTO privacidade.pedidos_de_exclusao AS p (origem, codigo_de_confirmacao, usuario_externo_hash)
    VALUES ('meta', p_codigo, p_usuario_hash)
    ON CONFLICT (origem, usuario_externo_hash) WHERE status <> 'concluido' DO NOTHING
    RETURNING p.id, p.codigo_de_confirmacao, p.status INTO v_id, v_codigo, v_situacao;

    IF v_id IS NULL THEN
      SELECT p.id, p.codigo_de_confirmacao, p.status INTO v_id, v_codigo, v_situacao
        FROM privacidade.pedidos_de_exclusao p
       WHERE p.origem = 'meta' AND p.usuario_externo_hash = p_usuario_hash AND p.status <> 'concluido';
    ELSE
      v_novo := true;
    END IF;
  END IF;

  INSERT INTO privacidade.pedidos_de_exclusao_conexoes (pedido_id, organization_id, connection_id)
  SELECT v_id, c.organization_id, c.id
    FROM integrations.connections c
   WHERE c.external_id = p_usuario_externo
     AND integrations.familia_do_provedor(c.platform::text) = 'meta'
     AND c.status <> 'revoked'
  ON CONFLICT DO NOTHING;

  IF v_novo THEN
    INSERT INTO audit.audit_log (organization_id, actor_type, action, target_type, target_id, metadata)
    SELECT l.organization_id, 'system', 'privacidade.pedido_de_exclusao_recebido', 'connection', l.connection_id::text,
           jsonb_build_object('origem', 'meta', 'codigo', v_codigo)
      FROM privacidade.pedidos_de_exclusao_conexoes l
     WHERE l.pedido_id = v_id;
  END IF;

  RETURN QUERY SELECT v_codigo, v_situacao, v_novo;
END;
$$;

COMMENT ON FUNCTION privacidade.registrar_pedido_de_exclusao_meta IS
  'Callback de exclusão de dados da Meta (ADR 0029). Idempotente por usuário: com pedido aberto, devolve o mesmo código. O id da Meta só serve para achar as conexões que ele autorizou e não é gravado; fica o pseudônimo. Grava privacidade.pedido_de_exclusao_recebido na trilha de cada organização afetada.';

REVOKE ALL ON FUNCTION privacidade.registrar_pedido_de_exclusao_meta(text, text, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION privacidade.situacao_do_pedido_de_exclusao(p_codigo text)
RETURNS TABLE (situacao text, criado_em timestamptz, concluido_em timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT p.status, p.criado_em, p.concluido_em
    FROM privacidade.pedidos_de_exclusao p
   WHERE p.codigo_de_confirmacao = p_codigo;
$$;

COMMENT ON FUNCTION privacidade.situacao_do_pedido_de_exclusao IS
  'Página pública /exclusao-de-dados/status/[codigo]: só a situação e as datas, nenhum dado pessoal.';

REVOKE ALL ON FUNCTION privacidade.situacao_do_pedido_de_exclusao(text) FROM PUBLIC;

DO $$ BEGIN
  EXECUTE format('GRANT EXECUTE ON FUNCTION privacidade.registrar_pedido_de_exclusao_meta(text, text, text) TO %I',
    current_setting('privacidade.papel_app'));
  EXECUTE format('GRANT EXECUTE ON FUNCTION privacidade.situacao_do_pedido_de_exclusao(text) TO %I',
    current_setting('privacidade.papel_app'));
END $$;

CREATE OR REPLACE FUNCTION privacidade.atualizar_pedido_de_exclusao(
  p_codigo text,
  p_situacao text,
  p_evidencia text,
  p_por text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
VOLATILE
AS $$
DECLARE
  v_pedido privacidade.pedidos_de_exclusao%ROWTYPE;
BEGIN
  IF p_situacao NOT IN ('em_andamento', 'concluido') THEN
    RAISE EXCEPTION 'situação inválida: %', p_situacao;
  END IF;
  IF p_situacao = 'concluido' AND length(btrim(coalesce(p_evidencia, ''))) = 0 THEN
    RAISE EXCEPTION 'concluir exige a evidência do que foi feito';
  END IF;

  UPDATE privacidade.pedidos_de_exclusao
     SET status = p_situacao,
         atualizado_em = now(),
         concluido_em = CASE WHEN p_situacao = 'concluido' THEN now() END,
         evidencia = coalesce(nullif(btrim(p_evidencia), ''), evidencia)
   WHERE codigo_de_confirmacao = p_codigo AND status <> 'concluido'
  RETURNING * INTO v_pedido;

  IF v_pedido.id IS NULL THEN
    RAISE EXCEPTION 'pedido % não existe ou já foi concluído', p_codigo;
  END IF;

  INSERT INTO audit.audit_log (organization_id, actor_type, action, target_type, target_id, metadata)
  SELECT l.organization_id, 'system', 'privacidade.pedido_de_exclusao_' || p_situacao, 'connection', l.connection_id::text,
         jsonb_build_object('origem', v_pedido.origem, 'codigo', v_pedido.codigo_de_confirmacao, 'por', left(p_por, 200))
    FROM privacidade.pedidos_de_exclusao_conexoes l
   WHERE l.pedido_id = v_pedido.id;

  RETURN jsonb_build_object('codigo', v_pedido.codigo_de_confirmacao, 'situacao', v_pedido.status, 'concluidoEm', v_pedido.concluido_em);
END;
$$;

COMMENT ON FUNCTION privacidade.atualizar_pedido_de_exclusao IS
  'Atendimento do pedido de exclusão (scripts/titular.mjs pedidos-de-exclusao). Só o dono do banco executa.';

REVOKE ALL ON FUNCTION privacidade.atualizar_pedido_de_exclusao(text, text, text, text) FROM PUBLIC;

CREATE TABLE IF NOT EXISTS privacidade.expurgos_de_fonte (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
  platform         text NOT NULL CHECK (platform ~ '^[a-z][a-z0-9_]*$'),
  external_id      text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 200),
  motivo           text NOT NULL CHECK (motivo IN ('conexao_removida', 'sem_autorizacao_ativa')),
  apos             timestamptz NOT NULL DEFAULT now(),
  criado_em        timestamptz NOT NULL DEFAULT now(),
  tentativas       integer NOT NULL DEFAULT 0,
  ultimo_erro      text CHECK (ultimo_erro IS NULL OR length(ultimo_erro) <= 500),
  concluido_em     timestamptz,
  cancelado_em     timestamptz,
  CONSTRAINT expurgos_de_fonte_um_desfecho CHECK (concluido_em IS NULL OR cancelado_em IS NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS expurgos_de_fonte_um_aberto
  ON privacidade.expurgos_de_fonte (organization_id, platform, external_id)
  WHERE concluido_em IS NULL AND cancelado_em IS NULL;

COMMENT ON TABLE privacidade.expurgos_de_fonte IS
  'Fila do expurgo dos dados de uma fonte no BigQuery quando a autorização acaba (Políticas do YouTube API Services III.E.4: 7 dias após remover, 30 após revogar no Google). removerConexao enfileira e tenta na hora; o job diário do YouTube refaz o que falhou e enfileira, com 7 dias de carência, fonte que ficou sem autorização ativa (ADR 0029).';

ALTER TABLE privacidade.expurgos_de_fonte ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacidade.expurgos_de_fonte FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION privacidade.enfileirar_expurgo_da_conexao(p_connection uuid)
RETURNS TABLE (id uuid, organization_id uuid, platform text, external_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
VOLATILE
AS $$
#variable_conflict use_column
DECLARE
  v_organizacao uuid := core.current_organization();
BEGIN
  IF v_organizacao IS NULL OR NOT EXISTS (
    SELECT 1 FROM integrations.connections c WHERE c.id = p_connection AND c.organization_id = v_organizacao
  ) THEN
    RAISE EXCEPTION 'conexão % não é da organização do contexto', p_connection;
  END IF;

  INSERT INTO privacidade.expurgos_de_fonte AS e (organization_id, platform, external_id, motivo, apos)
  SELECT DISTINCT ca.organization_id, ca.platform::text, ca.external_id, 'conexao_removida', now()
    FROM integrations.connection_accounts ca
   WHERE ca.connection_id = p_connection
     AND ca.platform::text = 'youtube'
     AND NOT EXISTS (
       SELECT 1
         FROM integrations.connection_accounts o
         JOIN integrations.connections c ON c.id = o.connection_id
        WHERE o.organization_id = ca.organization_id AND o.platform = ca.platform AND o.external_id = ca.external_id
          AND o.connection_id <> p_connection AND c.status IN ('active', 'expiring'))
  ON CONFLICT (organization_id, platform, external_id) WHERE concluido_em IS NULL AND cancelado_em IS NULL
  DO UPDATE SET apos = LEAST(e.apos, EXCLUDED.apos), motivo = EXCLUDED.motivo;

  UPDATE integrations.connection_accounts ca
     SET name = ca.external_id
   WHERE ca.connection_id = p_connection AND ca.platform::text = 'youtube' AND ca.name <> ca.external_id;

  RETURN QUERY
  SELECT e.id, e.organization_id, e.platform, e.external_id
    FROM privacidade.expurgos_de_fonte e
   WHERE e.organization_id = v_organizacao AND e.concluido_em IS NULL AND e.cancelado_em IS NULL
     AND e.platform = 'youtube'
     AND e.external_id IN (SELECT ca.external_id FROM integrations.connection_accounts ca WHERE ca.connection_id = p_connection);
END;
$$;

COMMENT ON FUNCTION privacidade.enfileirar_expurgo_da_conexao IS
  'removerConexao (ADR 0029): enfileira o expurgo dos canais do YouTube da conexão que nenhuma outra conexão ativa da organização alcança, troca o nome do canal pelo id (o título é dado da API do YouTube) e devolve os expurgos abertos para o app tentar na hora.';

CREATE OR REPLACE FUNCTION privacidade.preparar_conformidade_youtube()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
VOLATILE
AS $$
DECLARE
  v_nomes integer;
  v_enfileirados integer;
  v_cancelados integer;
BEGIN
  UPDATE integrations.connection_accounts
     SET name = external_id
   WHERE platform::text = 'youtube' AND discovered_at < now() - interval '30 days' AND name <> external_id;
  GET DIAGNOSTICS v_nomes = ROW_COUNT;

  UPDATE privacidade.expurgos_de_fonte e
     SET cancelado_em = now()
   WHERE e.concluido_em IS NULL AND e.cancelado_em IS NULL AND e.motivo = 'sem_autorizacao_ativa'
     AND EXISTS (
       SELECT 1
         FROM integrations.connection_accounts o
         JOIN integrations.connections c ON c.id = o.connection_id
        WHERE o.organization_id = e.organization_id AND o.platform::text = e.platform AND o.external_id = e.external_id
          AND c.status IN ('active', 'expiring'));
  GET DIAGNOSTICS v_cancelados = ROW_COUNT;

  INSERT INTO privacidade.expurgos_de_fonte (organization_id, platform, external_id, motivo, apos)
  SELECT f.organization_id, 'youtube', f.external_id, 'sem_autorizacao_ativa', now() + interval '7 days'
    FROM (
      SELECT ca.organization_id, ca.external_id, max(ca.discovered_at) AS visto_em
        FROM integrations.connection_accounts ca
       WHERE ca.platform::text = 'youtube'
       GROUP BY ca.organization_id, ca.external_id
    ) f
   WHERE NOT EXISTS (
       SELECT 1
         FROM integrations.connection_accounts o
         JOIN integrations.connections c ON c.id = o.connection_id
        WHERE o.organization_id = f.organization_id AND o.platform::text = 'youtube' AND o.external_id = f.external_id
          AND c.status IN ('active', 'expiring'))
     AND NOT EXISTS (
       SELECT 1 FROM privacidade.expurgos_de_fonte e
        WHERE e.organization_id = f.organization_id AND e.platform = 'youtube' AND e.external_id = f.external_id
          AND ((e.concluido_em IS NULL AND e.cancelado_em IS NULL) OR e.concluido_em >= f.visto_em))
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_enfileirados = ROW_COUNT;

  RETURN jsonb_build_object('nomesTrocadosPeloId', v_nomes, 'enfileirados', v_enfileirados, 'cancelados', v_cancelados);
END;
$$;

COMMENT ON FUNCTION privacidade.preparar_conformidade_youtube IS
  'Job diário do YouTube (ADR 0029), lado Postgres: troca pelo id o nome de canal não renovado há 30 dias (a descoberta renova discovered_at), cancela expurgo de canal que voltou a ter autorização ativa e enfileira, com 7 dias de carência, canal sem conexão ativa que não foi expurgado desde a última descoberta.';

CREATE OR REPLACE FUNCTION privacidade.expurgos_de_fonte_vencidos(p_limite integer)
RETURNS TABLE (id uuid, organization_id uuid, platform text, external_id text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT e.id, e.organization_id, e.platform, e.external_id
    FROM privacidade.expurgos_de_fonte e
   WHERE e.concluido_em IS NULL AND e.cancelado_em IS NULL AND e.apos <= now()
   ORDER BY e.apos, e.id
   LIMIT least(greatest(coalesce(p_limite, 50), 1), 500);
$$;

CREATE OR REPLACE FUNCTION privacidade.registrar_resultado_do_expurgo(p_id uuid, p_erro text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
VOLATILE
AS $$
  UPDATE privacidade.expurgos_de_fonte
     SET concluido_em = CASE WHEN p_erro IS NULL THEN now() END,
         tentativas = tentativas + 1,
         ultimo_erro = left(p_erro, 500)
   WHERE id = p_id AND concluido_em IS NULL AND cancelado_em IS NULL;
$$;

REVOKE ALL ON FUNCTION privacidade.enfileirar_expurgo_da_conexao(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION privacidade.preparar_conformidade_youtube() FROM PUBLIC;
REVOKE ALL ON FUNCTION privacidade.expurgos_de_fonte_vencidos(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION privacidade.registrar_resultado_do_expurgo(uuid, text) FROM PUBLIC;

DO $$ BEGIN
  EXECUTE format('GRANT EXECUTE ON FUNCTION privacidade.enfileirar_expurgo_da_conexao(uuid) TO %I', current_setting('privacidade.papel_app'));
  EXECUTE format('GRANT EXECUTE ON FUNCTION privacidade.preparar_conformidade_youtube() TO %I', current_setting('privacidade.papel_worker'));
  EXECUTE format('GRANT EXECUTE ON FUNCTION privacidade.expurgos_de_fonte_vencidos(integer) TO %I', current_setting('privacidade.papel_worker'));
  EXECUTE format('GRANT EXECUTE ON FUNCTION privacidade.registrar_resultado_do_expurgo(uuid, text) TO %I', current_setting('privacidade.papel_app'));
END $$;

CREATE OR REPLACE FUNCTION automation.preencher_ids_de_posse_legados()
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public
VOLATILE
AS $$
DECLARE
  v_de integer;
  v_para integer;
  v_cliente integer;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS nomes_de_cliente_sem_ambiguidade (organization_id uuid, nome text, client_id uuid) ON COMMIT DROP;
  TRUNCATE nomes_de_cliente_sem_ambiguidade;

  INSERT INTO nomes_de_cliente_sem_ambiguidade (organization_id, nome, client_id)
  SELECT ev.organization_id, ev.nome, (array_agg(DISTINCT ev.client_id))[1]
    FROM (
      SELECT c.organization_id, c.name AS nome, c.id AS client_id FROM core.clients c
      UNION
      SELECT l.organization_id, l.metadata ->> par.nome, (l.metadata ->> par.id)::uuid
        FROM audit.audit_log l
       CROSS JOIN (VALUES ('de', 'deId'), ('para', 'paraId'), ('cliente', 'clientId')) AS par(nome, id)
       WHERE l.organization_id IS NOT NULL
         AND jsonb_typeof(l.metadata) = 'object'
         AND jsonb_typeof(l.metadata -> par.nome) = 'string'
         AND (l.metadata ->> par.id) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ) ev
   WHERE ev.nome IS NOT NULL AND ev.nome <> '[cliente expurgado]'
   GROUP BY ev.organization_id, ev.nome
  HAVING count(DISTINCT ev.client_id) = 1;

  UPDATE audit.audit_log l
     SET metadata = l.metadata || jsonb_build_object('deId', u.client_id::text, 'idsPreenchidosPela', '0080')
    FROM nomes_de_cliente_sem_ambiguidade u
   WHERE l.action IN ('ad_account.reassigned', 'ad_account.unlinked', 'connection_account.reassigned',
                      'connection_account.unlink', 'connection_account.link')
     AND jsonb_typeof(l.metadata) = 'object'
     AND NOT (l.metadata ? 'deId')
     AND u.organization_id = l.organization_id
     AND u.nome = l.metadata ->> 'de';
  GET DIAGNOSTICS v_de = ROW_COUNT;

  UPDATE audit.audit_log l
     SET metadata = l.metadata || jsonb_build_object('paraId', u.client_id::text, 'idsPreenchidosPela', '0080')
    FROM nomes_de_cliente_sem_ambiguidade u
   WHERE l.action IN ('ad_account.reassigned', 'connection_account.reassigned')
     AND jsonb_typeof(l.metadata) = 'object'
     AND NOT (l.metadata ? 'paraId')
     AND u.organization_id = l.organization_id
     AND u.nome = l.metadata ->> 'para';
  GET DIAGNOSTICS v_para = ROW_COUNT;

  UPDATE audit.audit_log l
     SET metadata = l.metadata || jsonb_build_object('clientId', u.client_id::text, 'idsPreenchidosPela', '0080')
    FROM nomes_de_cliente_sem_ambiguidade u
   WHERE l.action = 'connection_account.link'
     AND jsonb_typeof(l.metadata) = 'object'
     AND NOT (l.metadata ? 'clientId')
     AND u.organization_id = l.organization_id
     AND u.nome = l.metadata ->> 'cliente';
  GET DIAGNOSTICS v_cliente = ROW_COUNT;

  RETURN jsonb_build_object('deId', v_de, 'paraId', v_para, 'clientId', v_cliente);
END;
$$;

COMMENT ON FUNCTION automation.preencher_ids_de_posse_legados IS
  'Preenche deId/paraId/clientId nas linhas antigas de posse da trilha (mover, desvincular, vincular) quando o nome gravado aponta para exatamente um cliente em toda a história da organização: o nome atual de cada cliente (excluído ou não) e os pares nome+id que linhas novas da trilha gravaram, o que cobre nome antigo de cliente renomeado. Nome ambíguo ou desconhecido fica sem id (dono desconhecido). Idempotente. Só o dono do banco executa (ADR 0029).';

REVOKE ALL ON FUNCTION automation.preencher_ids_de_posse_legados() FROM PUBLIC;

SELECT automation.preencher_ids_de_posse_legados();

COMMIT;
