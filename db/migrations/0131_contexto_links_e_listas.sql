BEGIN;

DO $$
BEGIN
  PERFORM set_config(
    'contexto.papel_app',
    (SELECT rolname FROM pg_roles WHERE rolname IN ('orla_app', 'tria_app') ORDER BY rolname = 'orla_app' DESC LIMIT 1),
    true
  );
END $$;

DROP INDEX IF EXISTS core.client_context_links_um_por_convite;

CREATE OR REPLACE FUNCTION core.contexto_um_link_vivo_por_convite()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.connection_invite_id IS NULL OR NEW.revoked_at IS NOT NULL OR NEW.expires_at <= now() THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.connection_invite_id::text, 62));
  IF EXISTS (
    SELECT 1 FROM core.client_context_links l
     WHERE l.connection_invite_id = NEW.connection_invite_id AND l.id <> NEW.id
       AND l.revoked_at IS NULL AND l.expires_at > now()
  ) THEN
    RAISE EXCEPTION 'o convite já tem um link de contexto vivo'
      USING ERRCODE = 'unique_violation', CONSTRAINT = 'client_context_links_um_vivo_por_convite';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION core.contexto_um_link_vivo_por_convite IS
  'Um convite de integração tem no máximo um link de contexto vivo (não revogado e não vencido), ADR 0033. Substitui o índice único parcial da 0060, que contava link vencido como vivo: o índice não pode usar now().';

REVOKE ALL ON FUNCTION core.contexto_um_link_vivo_por_convite() FROM PUBLIC;

DROP TRIGGER IF EXISTS client_context_links_um_vivo_por_convite ON core.client_context_links;
CREATE TRIGGER client_context_links_um_vivo_por_convite
  BEFORE INSERT OR UPDATE OF revoked_at, expires_at, connection_invite_id ON core.client_context_links
  FOR EACH ROW EXECUTE FUNCTION core.contexto_um_link_vivo_por_convite();

COMMENT ON COLUMN core.client_context_links.connection_invite_id IS
  'Quando o link de contexto vai junto do convite de integração: a página do convite mostra as duas tarefas. Um convite tem no máximo um link de contexto vivo (gatilho client_context_links_um_vivo_por_convite, ADR 0033).';

CREATE OR REPLACE FUNCTION core.contexto_link_pelo_convite(p_invite_token text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT l.token_hash
  FROM integrations.connection_invites i
  JOIN core.client_context_links l ON l.connection_invite_id = i.id AND l.client_id = i.client_id
  JOIN core.clients c ON c.id = l.client_id
  WHERE i.token = p_invite_token
    AND i.status NOT IN ('revoked', 'expired')
    AND i.expires_at > now()
    AND l.revoked_at IS NULL
    AND l.expires_at > now()
    AND c.excluido_em IS NULL
  ORDER BY l.created_at DESC
  LIMIT 1;
$$;

COMMENT ON FUNCTION core.contexto_link_pelo_convite IS
  'A página do convite de integração mostra também o formulário de contexto: o token do convite leva ao link de contexto amarrado a ele, só enquanto o convite vale (não revogado, não vencido pelo status nem pelo expires_at, ADR 0033). O hash devolvido só circula no servidor.';

ALTER TABLE core.client_context_links ADD COLUMN IF NOT EXISTS abertura_registrada_em timestamptz;

COMMENT ON COLUMN core.client_context_links.abertura_registrada_em IS
  'Última vez que a abertura do formulário foi gravada na trilha (client.context.link_opened). A trilha recebe no máximo uma abertura por link por hora (ADR 0033); last_used_at continua registrando todo uso.';

CREATE OR REPLACE FUNCTION core.contexto_link_registrar_abertura(p_token_hash text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
VOLATILE
AS $$
DECLARE
  v_link core.client_context_links;
  v_id   uuid;
BEGIN
  v_link := core.contexto_link_valido(p_token_hash);
  IF v_link.id IS NULL THEN
    RETURN false;
  END IF;
  UPDATE core.client_context_links
     SET abertura_registrada_em = now()
   WHERE id = v_link.id
     AND (abertura_registrada_em IS NULL OR abertura_registrada_em < now() - interval '1 hour')
  RETURNING id INTO v_id;
  RETURN v_id IS NOT NULL;
END;
$$;

COMMENT ON FUNCTION core.contexto_link_registrar_abertura IS
  'Coalesce as aberturas do formulário na trilha: devolve true só para a primeira abertura do link em cada hora (ADR 0033).';

CREATE OR REPLACE FUNCTION core.contexto_limite_de_itens()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.client_id::text || ':' || NEW.list_key, 61));
  IF (SELECT count(*) FROM core.client_context_items
       WHERE client_id = NEW.client_id AND list_key = NEW.list_key) >= 500 THEN
    RAISE EXCEPTION 'a lista chegou ao limite de itens'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'client_context_items_limite_da_lista';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION core.contexto_limite_de_itens IS
  'Teto de 500 itens por lista e cliente, conferido sob trava por (cliente, lista) em todo INSERT (ADR 0033): dois envios simultâneos não passam do teto.';

REVOKE ALL ON FUNCTION core.contexto_limite_de_itens() FROM PUBLIC;

DROP TRIGGER IF EXISTS client_context_items_limite_da_lista ON core.client_context_items;
CREATE TRIGGER client_context_items_limite_da_lista BEFORE INSERT ON core.client_context_items
  FOR EACH ROW EXECUTE FUNCTION core.contexto_limite_de_itens();

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
      (organization_id, client_id, section, list_key, position, data, epistemic, source, review, shareable,
       updated_via_link)
    VALUES (v_link.organization_id, v_link.client_id, p_section, p_list_key,
            coalesce((SELECT max(position) + 1 FROM core.client_context_items
                       WHERE client_id = v_link.client_id AND list_key = p_list_key), 0),
            p_data, p_epistemic, 'cliente', 'confirmado', true, v_link.id)
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
  'Cria (p_item_id nulo) ou altera um item de lista pelo link. Criar confere o máximo da lista do catálogo (teto 500) sob trava por (cliente, lista), ADR 0033. Alterar exige item visível ao cliente, da mesma seção e lista, e a versão que ele leu.';

CREATE OR REPLACE FUNCTION core.contexto_link_salvar_item(
  p_token_hash text, p_section text, p_list_key text, p_item_id uuid, p_data jsonb, p_epistemic text,
  p_versao_esperada integer)
RETURNS TABLE (resultado text, item_id uuid, versao integer)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
VOLATILE
AS $$
  SELECT * FROM core.contexto_link_salvar_item(p_token_hash, p_section, p_list_key, p_item_id, p_data, p_epistemic,
                                               p_versao_esperada, 500);
$$;

COMMENT ON FUNCTION core.contexto_link_salvar_item(text, text, text, uuid, jsonb, text, integer) IS
  'Assinatura antiga (0060), mantida para a imagem anterior durante o deploy: delega à nova com o teto de 500.';

DO $$
DECLARE
  assinatura text;
BEGIN
  FOREACH assinatura IN ARRAY ARRAY[
    'core.contexto_link_registrar_abertura(text)',
    'core.contexto_link_salvar_item(text, text, text, uuid, jsonb, text, integer, integer)',
    'core.contexto_link_salvar_item(text, text, text, uuid, jsonb, text, integer)',
    'core.contexto_link_pelo_convite(text)'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', assinatura);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I', assinatura, current_setting('contexto.papel_app'));
  END LOOP;
END $$;

COMMIT;
