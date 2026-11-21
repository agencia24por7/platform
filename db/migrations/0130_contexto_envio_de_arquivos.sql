BEGIN;

DO $$
BEGIN
  PERFORM set_config(
    'contexto.papel_app',
    (SELECT rolname FROM pg_roles WHERE rolname IN ('orla_app', 'tria_app') ORDER BY rolname = 'orla_app' DESC LIMIT 1),
    true
  );
  PERFORM set_config(
    'contexto.papel_worker',
    coalesce((SELECT rolname FROM pg_roles WHERE rolname = 'orla_worker'), current_setting('contexto.papel_app')),
    true
  );
END $$;

CREATE TABLE IF NOT EXISTS core.client_context_file_reservations (
  id               uuid PRIMARY KEY,
  organization_id  uuid NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
  client_id        uuid NOT NULL REFERENCES core.clients(id) ON DELETE CASCADE,
  link_id          uuid REFERENCES core.client_context_links(id) ON DELETE SET NULL,
  object_path      text NOT NULL UNIQUE CHECK (length(object_path) <= 1024 AND position('..' IN object_path) = 0),
  size_bytes       bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 26214400),
  criada_em        timestamptz NOT NULL DEFAULT now(),
  vence_em         timestamptz NOT NULL DEFAULT now() + interval '15 minutes',
  consumida_em     timestamptz,
  liberada_em      timestamptz,
  varrida_em       timestamptz,
  CONSTRAINT client_context_file_reservations_no_prefixo CHECK (
    object_path LIKE 'orgs/' || organization_id::text || '/clientes/' || client_id::text || '/arquivos/%'),
  CONSTRAINT client_context_file_reservations_um_desfecho CHECK (consumida_em IS NULL OR liberada_em IS NULL)
);

COMMENT ON TABLE core.client_context_file_reservations IS
  'Reserva de cota de um envio de arquivo do contexto (ADR 0033). Todo envio reserva antes de gravar no bucket: a cota do cliente conta arquivos registrados mais reservas abertas, sob trava por cliente, e o orçamento por link conta todas as reservas da última hora. A linha do arquivo só entra consumindo a reserva (gatilho contexto_arquivo_exige_reserva). Reserva não consumida vira objeto órfão a apagar pela varredura (varrida_em).';

CREATE INDEX IF NOT EXISTS client_context_file_reservations_abertas
  ON core.client_context_file_reservations (client_id) WHERE consumida_em IS NULL AND liberada_em IS NULL;
CREATE INDEX IF NOT EXISTS client_context_file_reservations_do_link
  ON core.client_context_file_reservations (link_id, criada_em) WHERE link_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS client_context_file_reservations_a_varrer
  ON core.client_context_file_reservations (criada_em) WHERE consumida_em IS NULL AND varrida_em IS NULL;

ALTER TABLE core.client_context_file_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.client_context_file_reservations FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  EXECUTE 'DROP POLICY IF EXISTS client_context_file_reservations_tenant ON core.client_context_file_reservations';
  EXECUTE format(
    'CREATE POLICY client_context_file_reservations_tenant ON core.client_context_file_reservations FOR ALL TO %I
       USING (organization_id = core.current_organization() AND core.cliente_no_escopo(client_id)
              AND EXISTS (SELECT 1 FROM core.clients c WHERE c.id = client_context_file_reservations.client_id))
       WITH CHECK (organization_id = core.current_organization() AND core.cliente_no_escopo(client_id)
              AND EXISTS (SELECT 1 FROM core.clients c WHERE c.id = client_context_file_reservations.client_id))',
    current_setting('contexto.papel_app'));
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON core.client_context_file_reservations TO %I', current_setting('contexto.papel_app'));
END $$;

CREATE OR REPLACE FUNCTION core.contexto_uso_reservado(p_cliente uuid)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT (SELECT coalesce(sum(f.size_bytes), 0) FROM core.client_context_files f
           WHERE f.client_id = p_cliente AND f.deleted_at IS NULL)
       + (SELECT coalesce(sum(r.size_bytes), 0) FROM core.client_context_file_reservations r
           WHERE r.client_id = p_cliente AND r.consumida_em IS NULL AND r.liberada_em IS NULL AND r.vence_em > now())::bigint;
$$;

COMMENT ON FUNCTION core.contexto_uso_reservado IS
  'Uso de armazenamento do cliente para a cota (ADR 0033): arquivos não apagados mais reservas abertas e não vencidas. Só as funções de reserva chamam, sob pg_advisory_xact_lock(hashtextextended(client_id, 60)).';

REVOKE ALL ON FUNCTION core.contexto_uso_reservado(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION core.contexto_reservar_arquivo_da_equipe(
  p_cliente uuid, p_id uuid, p_object_path text, p_size_bytes bigint, p_cota_bytes bigint)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
VOLATILE
AS $$
DECLARE
  v_organizacao uuid := core.current_organization();
BEGIN
  IF v_organizacao IS NULL OR NOT core.cliente_no_escopo(p_cliente) OR NOT EXISTS (
    SELECT 1 FROM core.clients c WHERE c.id = p_cliente AND c.organization_id = v_organizacao AND c.excluido_em IS NULL
  ) THEN
    RETURN 'recusado';
  END IF;
  IF p_size_bytes IS NULL OR p_size_bytes <= 0 OR p_size_bytes > 26214400 THEN
    RETURN 'tamanho_invalido';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_cliente::text, 60));
  IF core.contexto_uso_reservado(p_cliente) + p_size_bytes > least(p_cota_bytes, 524288000) THEN
    RETURN 'cota_excedida';
  END IF;

  INSERT INTO core.client_context_file_reservations (id, organization_id, client_id, object_path, size_bytes)
  VALUES (p_id, v_organizacao, p_cliente, p_object_path, p_size_bytes);
  RETURN 'ok';
END;
$$;

COMMENT ON FUNCTION core.contexto_reservar_arquivo_da_equipe IS
  'Envio da equipe (ADR 0033): reserva a cota antes de gravar no bucket, sob trava por cliente, contando arquivos e reservas abertas. Exige o contexto de tenant da sessão (organização e recorte de clientes).';

REVOKE ALL ON FUNCTION core.contexto_reservar_arquivo_da_equipe(uuid, uuid, text, bigint, bigint) FROM PUBLIC;

CREATE OR REPLACE FUNCTION core.contexto_link_reservar_arquivo(
  p_token_hash text, p_id uuid, p_section text, p_item_id uuid, p_object_path text, p_size_bytes bigint,
  p_cota_bytes bigint, p_orcamento_bytes_hora bigint, p_envios_hora integer)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
VOLATILE
AS $$
DECLARE
  v_link   core.client_context_links;
  v_bytes  bigint;
  v_envios integer;
BEGIN
  v_link := core.contexto_link_valido(p_token_hash);
  IF v_link.id IS NULL THEN
    RETURN 'recusado';
  END IF;
  IF NOT (p_section = ANY (v_link.sections)) THEN
    RETURN 'fora_do_escopo';
  END IF;
  IF p_item_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM core.client_context_items
     WHERE id = p_item_id AND client_id = v_link.client_id AND source = 'cliente') THEN
    RETURN 'fora_do_escopo';
  END IF;
  IF p_size_bytes IS NULL OR p_size_bytes <= 0 OR p_size_bytes > 26214400 THEN
    RETURN 'tamanho_invalido';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_link.client_id::text, 60));

  SELECT coalesce(sum(r.size_bytes), 0), count(*) INTO v_bytes, v_envios
    FROM core.client_context_file_reservations r
   WHERE r.link_id = v_link.id AND r.criada_em > now() - interval '1 hour';
  IF v_envios >= least(greatest(p_envios_hora, 1), 120)
     OR v_bytes + p_size_bytes > least(greatest(p_orcamento_bytes_hora, 1), 524288000) THEN
    RETURN 'orcamento_excedido';
  END IF;

  IF core.contexto_uso_reservado(v_link.client_id) + p_size_bytes > least(p_cota_bytes, 524288000) THEN
    RETURN 'cota_excedida';
  END IF;

  INSERT INTO core.client_context_file_reservations (id, organization_id, client_id, link_id, object_path, size_bytes)
  VALUES (p_id, v_link.organization_id, v_link.client_id, v_link.id, p_object_path, p_size_bytes);
  UPDATE core.client_context_links SET last_used_at = now() WHERE id = v_link.id;
  RETURN 'ok';
END;
$$;

COMMENT ON FUNCTION core.contexto_link_reservar_arquivo IS
  'Envio pelo link público (ADR 0033), antes de ler o corpo e de gravar no bucket: confere link, seção e item, aplica o orçamento do link (bytes e envios na última hora, contando também envios que falharam) e a cota do cliente com as reservas abertas, sob trava por cliente.';

CREATE OR REPLACE FUNCTION core.contexto_link_confirmar_arquivo(
  p_token_hash text, p_id uuid, p_section text, p_field_key text, p_item_id uuid,
  p_filename text, p_mime text, p_size_bytes bigint, p_sha256 text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
VOLATILE
AS $$
DECLARE
  v_link    core.client_context_links;
  v_reserva core.client_context_file_reservations;
BEGIN
  v_link := core.contexto_link_valido(p_token_hash);
  IF v_link.id IS NULL THEN
    RETURN 'recusado';
  END IF;
  IF NOT (p_section = ANY (v_link.sections)) THEN
    RETURN 'fora_do_escopo';
  END IF;
  IF p_item_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM core.client_context_items
     WHERE id = p_item_id AND client_id = v_link.client_id AND source = 'cliente') THEN
    RETURN 'fora_do_escopo';
  END IF;

  SELECT * INTO v_reserva FROM core.client_context_file_reservations r
   WHERE r.id = p_id AND r.link_id = v_link.id
   FOR UPDATE;
  IF v_reserva.id IS NULL OR v_reserva.consumida_em IS NOT NULL OR v_reserva.liberada_em IS NOT NULL
     OR v_reserva.vence_em <= now() OR p_size_bytes > v_reserva.size_bytes THEN
    RETURN 'reserva_invalida';
  END IF;

  INSERT INTO core.client_context_files
    (id, organization_id, client_id, section, field_key, item_id, object_path, filename, mime, size_bytes, sha256,
     source, shareable, via_link_id)
  VALUES (p_id, v_link.organization_id, v_link.client_id, p_section, p_field_key, p_item_id, v_reserva.object_path,
          p_filename, p_mime, p_size_bytes, p_sha256, 'cliente', true, v_link.id);
  UPDATE core.client_context_links SET last_used_at = now() WHERE id = v_link.id;
  RETURN 'ok';
END;
$$;

COMMENT ON FUNCTION core.contexto_link_confirmar_arquivo IS
  'Segunda metade do envio pelo link (ADR 0033): depois de o objeto estar no bucket, registra o metadado consumindo a reserva do mesmo link. O caminho vem da reserva, não do pedido.';

CREATE OR REPLACE FUNCTION core.contexto_link_liberar_reserva(p_token_hash text, p_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
VOLATILE
AS $$
  WITH liberada AS (
    UPDATE core.client_context_file_reservations r
       SET liberada_em = now()
      FROM core.client_context_links l
     WHERE r.id = p_id AND r.link_id = l.id AND l.token_hash = p_token_hash
       AND r.consumida_em IS NULL AND r.liberada_em IS NULL
    RETURNING r.id
  )
  SELECT EXISTS (SELECT 1 FROM liberada);
$$;

COMMENT ON FUNCTION core.contexto_link_liberar_reserva IS
  'Envio pelo link que falhou depois da reserva (ADR 0033): devolve a cota. A reserva liberada continua contando no orçamento do link na última hora.';

CREATE OR REPLACE FUNCTION core.contexto_arquivo_exige_reserva()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_reserva core.client_context_file_reservations;
BEGIN
  SELECT * INTO v_reserva FROM core.client_context_file_reservations r WHERE r.id = NEW.id FOR UPDATE;
  IF v_reserva.id IS NULL OR v_reserva.client_id <> NEW.client_id OR v_reserva.object_path <> NEW.object_path
     OR v_reserva.consumida_em IS NOT NULL OR v_reserva.liberada_em IS NOT NULL OR v_reserva.vence_em <= now()
     OR NEW.size_bytes > v_reserva.size_bytes THEN
    RAISE EXCEPTION 'arquivo sem reserva válida' USING ERRCODE = 'check_violation', CONSTRAINT = 'client_context_files_exige_reserva';
  END IF;
  UPDATE core.client_context_file_reservations SET consumida_em = now() WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION core.contexto_arquivo_exige_reserva IS
  'Nenhum arquivo do contexto é registrado sem a reserva aberta do mesmo id, cliente e caminho, com tamanho até o reservado (ADR 0033). Consome a reserva.';

REVOKE ALL ON FUNCTION core.contexto_arquivo_exige_reserva() FROM PUBLIC;

DROP TRIGGER IF EXISTS client_context_files_exige_reserva ON core.client_context_files;
CREATE TRIGGER client_context_files_exige_reserva BEFORE INSERT ON core.client_context_files
  FOR EACH ROW EXECUTE FUNCTION core.contexto_arquivo_exige_reserva();

CREATE OR REPLACE FUNCTION core.contexto_reservas_a_varrer(p_limite integer, p_idade interval)
RETURNS TABLE (id uuid, organization_id uuid, client_id uuid, object_path text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT r.id, r.organization_id, r.client_id, r.object_path
    FROM core.client_context_file_reservations r
   WHERE r.consumida_em IS NULL AND r.varrida_em IS NULL
     AND r.criada_em < now() - greatest(p_idade, interval '1 hour')
     AND (r.liberada_em IS NOT NULL OR r.vence_em <= now())
   ORDER BY r.criada_em, r.id
   LIMIT least(greatest(coalesce(p_limite, 200), 1), 1000);
$$;

COMMENT ON FUNCTION core.contexto_reservas_a_varrer IS
  'Varredura de órfãos (ADR 0033): reservas não consumidas, liberadas ou vencidas, com mais de 1 hora. O objeto de cada uma (se chegou a ser gravado) é apagado do bucket e a reserva é marcada varrida.';

CREATE OR REPLACE FUNCTION core.contexto_reserva_varrida(p_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
VOLATILE
AS $$
  UPDATE core.client_context_file_reservations
     SET varrida_em = now(), liberada_em = coalesce(liberada_em, now())
   WHERE id = p_id AND consumida_em IS NULL AND varrida_em IS NULL;
$$;

CREATE OR REPLACE FUNCTION core.contexto_clientes_para_varrer_arquivos(p_limite integer, p_completa boolean)
RETURNS TABLE (organization_id uuid, client_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT c.organization_id, c.id
    FROM core.clients c
   WHERE p_completa
      OR EXISTS (SELECT 1 FROM core.client_context_file_reservations r
                  WHERE r.client_id = c.id AND r.criada_em > now() - interval '3 days')
      OR EXISTS (SELECT 1 FROM core.client_context_files f
                  WHERE f.client_id = c.id AND (f.created_at > now() - interval '3 days' OR f.deleted_at > now() - interval '3 days'))
   ORDER BY c.organization_id, c.id
   LIMIT least(greatest(coalesce(p_limite, 200), 1), 5000);
$$;

COMMENT ON FUNCTION core.contexto_clientes_para_varrer_arquivos IS
  'Varredura por listagem (ADR 0033): clientes com envio ou remoção de arquivo nos últimos 3 dias (ou todos, com p_completa) para comparar o prefixo arquivos/ do bucket com os registros.';

CREATE OR REPLACE FUNCTION core.contexto_caminhos_conhecidos(p_cliente uuid)
RETURNS TABLE (object_path text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT f.object_path FROM core.client_context_files f WHERE f.client_id = p_cliente AND f.deleted_at IS NULL
  UNION
  SELECT r.object_path FROM core.client_context_file_reservations r
   WHERE r.client_id = p_cliente AND r.consumida_em IS NULL AND r.liberada_em IS NULL AND r.vence_em > now();
$$;

COMMENT ON FUNCTION core.contexto_caminhos_conhecidos IS
  'Objetos de arquivos/ que o bucket deve ter para o cliente: arquivos registrados e não apagados e reservas em andamento. O resto, com mais de 1 hora, é órfão (ADR 0033).';

CREATE OR REPLACE FUNCTION core.contexto_alvo_do_armazenamento(p_organizacao uuid, p_cliente uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM core.clients c
                  WHERE c.id = p_cliente AND c.organization_id = p_organizacao AND c.excluido_em IS NOT NULL)
      THEN 'excluido'
    WHEN NOT EXISTS (SELECT 1 FROM core.clients c WHERE c.id = p_cliente)
     AND EXISTS (SELECT 1 FROM audit.audit_log l
                  WHERE l.action = 'client.purged' AND l.target_type = 'client'
                    AND l.target_id = p_cliente::text AND l.organization_id = p_organizacao)
      THEN 'expurgado'
    WHEN EXISTS (SELECT 1 FROM core.clients c WHERE c.id = p_cliente AND c.organization_id = p_organizacao)
      THEN 'ativo'
    ELSE 'desconhecido'
  END;
$$;

COMMENT ON FUNCTION core.contexto_alvo_do_armazenamento IS
  'Trava do expurgo do bucket (ADR 0033): só apaga prefixo de cliente excluído logicamente (excluido) ou já expurgado do Postgres com client.purged na mesma organização (expurgado). Cliente ativo ou par organização/cliente desconhecido não é tocado.';

CREATE OR REPLACE FUNCTION core.contexto_brains_de_excluidos(p_limite integer)
RETURNS TABLE (organization_id uuid, client_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT b.organization_id, b.client_id
    FROM core.client_context_brain b
    JOIN core.clients c ON c.id = b.client_id
   WHERE c.excluido_em IS NOT NULL AND b.exported_hash IS NOT NULL
   ORDER BY b.client_id
   LIMIT least(greatest(coalesce(p_limite, 50), 1), 500);
$$;

COMMENT ON FUNCTION core.contexto_brains_de_excluidos IS
  'Clientes excluídos logicamente que ainda têm o export do brain do contexto publicado (contexto/brain/): a varredura despublica e zera o hash (ADR 0033).';

CREATE OR REPLACE FUNCTION core.contexto_brain_despublicado(p_cliente uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
VOLATILE
AS $$
  UPDATE core.client_context_brain
     SET exported_hash = NULL, exported_at = NULL, schema_version = NULL
   WHERE client_id = p_cliente;
$$;

COMMENT ON FUNCTION core.contexto_brain_despublicado IS
  'Marca o export do brain do contexto como despublicado. Com o cliente restaurado, a próxima mudança ou reconstrução publica de novo.';

DO $$
DECLARE
  assinatura text;
BEGIN
  FOREACH assinatura IN ARRAY ARRAY[
    'core.contexto_reservar_arquivo_da_equipe(uuid, uuid, text, bigint, bigint)',
    'core.contexto_link_reservar_arquivo(text, uuid, text, uuid, text, bigint, bigint, bigint, integer)',
    'core.contexto_link_confirmar_arquivo(text, uuid, text, text, uuid, text, text, bigint, text)',
    'core.contexto_link_liberar_reserva(text, uuid)'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', assinatura);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I', assinatura, current_setting('contexto.papel_app'));
  END LOOP;

  FOREACH assinatura IN ARRAY ARRAY[
    'core.contexto_reservas_a_varrer(integer, interval)',
    'core.contexto_reserva_varrida(uuid)',
    'core.contexto_clientes_para_varrer_arquivos(integer, boolean)',
    'core.contexto_caminhos_conhecidos(uuid)',
    'core.contexto_alvo_do_armazenamento(uuid, uuid)',
    'core.contexto_brains_de_excluidos(integer)',
    'core.contexto_brain_despublicado(uuid)'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', assinatura);
    IF current_setting('contexto.papel_worker') <> current_setting('contexto.papel_app') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', assinatura, current_setting('contexto.papel_app'));
    END IF;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I', assinatura, current_setting('contexto.papel_worker'));
  END LOOP;

  EXECUTE format(
    'REVOKE EXECUTE ON FUNCTION core.contexto_link_registrar_arquivo(text, uuid, text, text, uuid, text, text, text, bigint, text, bigint) FROM %I',
    current_setting('contexto.papel_app'));
END $$;

COMMENT ON FUNCTION core.contexto_link_registrar_arquivo IS
  'DESATIVADA pela 0130 (ADR 0033): registrava depois de gravar no bucket, sem reserva nem orçamento do link. Substituída por contexto_link_reservar_arquivo + contexto_link_confirmar_arquivo; o app não tem mais EXECUTE e o gatilho de reserva recusa o INSERT.';

COMMIT;
