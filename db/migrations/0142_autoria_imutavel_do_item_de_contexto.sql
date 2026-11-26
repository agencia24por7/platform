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
  IF NOT (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'a migracao 0142 precisa de papel que ignora RLS: o backfill da origem leria zero linhas';
  END IF;
END $$;

ALTER TABLE core.client_context_items
  ADD COLUMN origem text NOT NULL DEFAULT 'equipe'
  CONSTRAINT client_context_items_origem_valida CHECK (origem IN ('cliente', 'equipe'));

COMMENT ON COLUMN core.client_context_items.origem IS
  'Quem criou o item, fixado no INSERT e imutável (gatilho client_context_items_origem_imutavel): cliente só quando nasceu pelo link (core.contexto_link_salvar_item); equipe para todo o resto. source diz quem escreveu por último e muda na edição; origem não. ADR 0059.';

ALTER TABLE core.client_context_items DISABLE TRIGGER client_context_items_touch;
ALTER TABLE core.client_context_items DISABLE TRIGGER client_context_items_revisao;

UPDATE core.client_context_items i
   SET origem = 'cliente'
 WHERE EXISTS (
   SELECT 1 FROM core.client_context_revisions r
    WHERE r.target = 'item'
      AND r.item_id = i.id
      AND r.client_id = i.client_id
      AND r.operation = 'criar'
      AND r.via_link_id IS NOT NULL
      AND r.actor_user_id IS NULL
      AND r.after ->> 'source' = 'cliente');

ALTER TABLE core.client_context_items ENABLE TRIGGER client_context_items_touch;
ALTER TABLE core.client_context_items ENABLE TRIGGER client_context_items_revisao;

CREATE OR REPLACE FUNCTION core.contexto_origem_imutavel()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.origem IS DISTINCT FROM OLD.origem THEN
    RAISE EXCEPTION 'a origem do item de contexto não muda depois de criado'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'client_context_items_origem_imutavel';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION core.contexto_origem_imutavel IS
  'Recusa qualquer UPDATE que troque a origem de um item de contexto, venha do app, do worker ou do dono. A origem decide o que o link pode remover (ADR 0059).';

REVOKE ALL ON FUNCTION core.contexto_origem_imutavel() FROM PUBLIC;

DROP TRIGGER IF EXISTS client_context_items_origem_imutavel ON core.client_context_items;
CREATE TRIGGER client_context_items_origem_imutavel BEFORE UPDATE ON core.client_context_items
  FOR EACH ROW EXECUTE FUNCTION core.contexto_origem_imutavel();

CREATE OR REPLACE FUNCTION core.contexto_link_salvar_item(
  p_token_hash text, p_section text, p_list_key text, p_item_id uuid, p_data jsonb, p_epistemic text,
  p_versao_esperada integer, p_maximo integer)
RETURNS TABLE (resultado text, item_id uuid, versao integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
VOLATILE
AS $$
DECLARE
  v_link   core.client_context_links;
  v_atual  core.client_context_items;
  v_id     uuid;
  v_versao integer;
BEGIN
  v_link := core.contexto_link_valido(p_token_hash);
  IF v_link.id IS NULL THEN
    RETURN QUERY SELECT 'recusado'::text, NULL::uuid, NULL::integer;
    RETURN;
  END IF;
  IF NOT (p_section = ANY (v_link.sections)) OR p_epistemic NOT IN ('fato', 'hipotese', 'desejo')
     OR jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN
    RETURN QUERY SELECT 'fora_do_escopo'::text, NULL::uuid, NULL::integer;
    RETURN;
  END IF;

  PERFORM set_config('app.context_link_id', v_link.id::text, true);
  UPDATE core.client_context_links SET last_used_at = now() WHERE id = v_link.id;

  IF p_item_id IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_link.client_id::text || ':' || p_list_key, 61));
    IF (SELECT count(*) FROM core.client_context_items
         WHERE client_id = v_link.client_id AND list_key = p_list_key) >= least(greatest(coalesce(p_maximo, 500), 1), 500) THEN
      RETURN QUERY SELECT 'limite'::text, NULL::uuid, NULL::integer;
      RETURN;
    END IF;
    INSERT INTO core.client_context_items
      (organization_id, client_id, section, list_key, position, data, epistemic, source, origem, review, shareable,
       updated_via_link)
    VALUES (v_link.organization_id, v_link.client_id, p_section, p_list_key,
            coalesce((SELECT max(position) + 1 FROM core.client_context_items
                       WHERE client_id = v_link.client_id AND list_key = p_list_key), 0),
            p_data, p_epistemic, 'cliente', 'cliente', 'confirmado', true, v_link.id)
    RETURNING id INTO v_id;
    RETURN QUERY SELECT 'ok'::text, v_id, 1;
    RETURN;
  END IF;

  SELECT * INTO v_atual FROM core.client_context_items i
   WHERE i.id = p_item_id AND i.client_id = v_link.client_id AND i.section = p_section AND i.list_key = p_list_key
   FOR UPDATE;

  IF v_atual.id IS NULL
     OR NOT core.contexto_visivel_ao_cliente(v_atual.shareable, v_atual.source, v_atual.review, v_atual.epistemic) THEN
    RETURN QUERY SELECT 'nao_encontrado'::text, NULL::uuid, NULL::integer;
    RETURN;
  END IF;
  IF p_versao_esperada IS DISTINCT FROM v_atual.version THEN
    RETURN QUERY SELECT 'conflito'::text, v_atual.id, v_atual.version;
    RETURN;
  END IF;

  UPDATE core.client_context_items
     SET data = p_data, epistemic = p_epistemic, source = 'cliente', review = 'confirmado', shareable = true,
         version = version + 1, updated_by = NULL, updated_via_link = v_link.id
   WHERE id = v_atual.id
  RETURNING version INTO v_versao;

  RETURN QUERY SELECT 'ok'::text, v_atual.id, v_versao;
END;
$$;

COMMENT ON FUNCTION core.contexto_link_salvar_item(text, text, text, uuid, jsonb, text, integer, integer) IS
  'Cria (p_item_id nulo) ou altera um item de lista pelo link. Criar confere o máximo da lista do catálogo (teto 500) sob trava por (cliente, lista), ADR 0033, e grava origem = cliente. Alterar exige item visível ao cliente, da mesma seção e lista, e a versão que ele leu; troca source para cliente mas nunca a origem (ADR 0059).';

CREATE OR REPLACE FUNCTION core.contexto_link_remover_item(p_token_hash text, p_item_id uuid, p_versao_esperada integer)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
VOLATILE
AS $$
DECLARE
  v_link  core.client_context_links;
  v_atual core.client_context_items;
BEGIN
  v_link := core.contexto_link_valido(p_token_hash);
  IF v_link.id IS NULL THEN
    RETURN 'recusado';
  END IF;

  SELECT * INTO v_atual FROM core.client_context_items
   WHERE id = p_item_id AND client_id = v_link.client_id AND section = ANY (v_link.sections)
     AND origem = 'cliente' AND source = 'cliente'
   FOR UPDATE;
  IF v_atual.id IS NULL THEN
    RETURN 'nao_encontrado';
  END IF;
  IF p_versao_esperada IS DISTINCT FROM v_atual.version THEN
    RETURN 'conflito';
  END IF;

  PERFORM set_config('app.context_link_id', v_link.id::text, true);
  PERFORM set_config('app.user_id', '', true);
  UPDATE core.client_context_links SET last_used_at = now() WHERE id = v_link.id;
  DELETE FROM core.client_context_items WHERE id = v_atual.id;
  RETURN 'ok';
END;
$$;

COMMENT ON FUNCTION core.contexto_link_remover_item IS
  'O cliente só remove item que nasceu pelo link (origem = cliente, imutável) e que a equipe não assumiu depois (source = cliente). Item criado pela equipe não some pelo link, mesmo depois de o cliente editá-lo (ADR 0059).';

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
     WHERE id = p_item_id AND client_id = v_link.client_id AND origem = 'cliente' AND source = 'cliente') THEN
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
  'Envio pelo link público (ADR 0033), antes de ler o corpo e de gravar no bucket: confere link, seção e item (só item que nasceu pelo link e que a equipe não assumiu, ADR 0059), aplica o orçamento do link (bytes e envios na última hora, contando também envios que falharam) e a cota do cliente com as reservas abertas, sob trava por cliente.';

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
     WHERE id = p_item_id AND client_id = v_link.client_id AND origem = 'cliente' AND source = 'cliente') THEN
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
  'Segunda metade do envio pelo link (ADR 0033): depois de o objeto estar no bucket, registra o metadado consumindo a reserva do mesmo link. O caminho vem da reserva, não do pedido. Item, se houver, confere de novo a origem imutável (ADR 0059).';

CREATE OR REPLACE FUNCTION core.contexto_link_registrar_arquivo(
  p_token_hash text, p_id uuid, p_section text, p_field_key text, p_item_id uuid, p_object_path text,
  p_filename text, p_mime text, p_size_bytes bigint, p_sha256 text, p_cota_bytes bigint)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
VOLATILE
AS $$
DECLARE
  v_link core.client_context_links;
  v_uso  bigint;
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
     WHERE id = p_item_id AND client_id = v_link.client_id AND origem = 'cliente' AND source = 'cliente') THEN
    RETURN 'fora_do_escopo';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_link.client_id::text, 60));
  SELECT coalesce(sum(size_bytes), 0) INTO v_uso FROM core.client_context_files
   WHERE client_id = v_link.client_id AND deleted_at IS NULL;
  IF v_uso + p_size_bytes > least(p_cota_bytes, 524288000) THEN
    RETURN 'cota_excedida';
  END IF;

  INSERT INTO core.client_context_files
    (id, organization_id, client_id, section, field_key, item_id, object_path, filename, mime, size_bytes, sha256,
     source, shareable, via_link_id)
  VALUES (p_id, v_link.organization_id, v_link.client_id, p_section, p_field_key, p_item_id, p_object_path,
          p_filename, p_mime, p_size_bytes, p_sha256, 'cliente', true, v_link.id);
  UPDATE core.client_context_links SET last_used_at = now() WHERE id = v_link.id;
  RETURN 'ok';
END;
$$;

COMMENT ON FUNCTION core.contexto_link_registrar_arquivo IS
  'DESATIVADA pela 0130 (ADR 0033): registrava depois de gravar no bucket, sem reserva nem orçamento do link. Substituída por contexto_link_reservar_arquivo + contexto_link_confirmar_arquivo; o app não tem mais EXECUTE e o gatilho de reserva recusa o INSERT. A 0142 só alinhou a conferência do item à origem imutável (ADR 0059), sem devolver o EXECUTE.';

REVOKE ALL ON FUNCTION core.contexto_link_registrar_arquivo(text, uuid, text, text, uuid, text, text, text, bigint, text, bigint) FROM PUBLIC;

DO $$
DECLARE
  assinatura text;
BEGIN
  FOREACH assinatura IN ARRAY ARRAY[
    'core.contexto_link_salvar_item(text, text, text, uuid, jsonb, text, integer, integer)',
    'core.contexto_link_remover_item(text, uuid, integer)',
    'core.contexto_link_reservar_arquivo(text, uuid, text, uuid, text, bigint, bigint, bigint, integer)',
    'core.contexto_link_confirmar_arquivo(text, uuid, text, text, uuid, text, text, bigint, text)'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', assinatura);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I', assinatura, current_setting('contexto.papel_app'));
  END LOOP;
END $$;

COMMIT;
