BEGIN;

DO $$
BEGIN
  PERFORM set_config(
    'contexto.papel_app',
    (SELECT rolname FROM pg_roles WHERE rolname IN ('orla_app', 'tria_app') ORDER BY rolname = 'orla_app' DESC LIMIT 1),
    true
  );
END $$;

CREATE TABLE IF NOT EXISTS core.client_context_links (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES core.organizations(id) ON DELETE RESTRICT,
  client_id             uuid NOT NULL REFERENCES core.clients(id) ON DELETE CASCADE,
  token_hash            text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  sections              text[] NOT NULL CHECK (
                          cardinality(sections) BETWEEN 1 AND 20
                          AND array_to_string(sections, ',') ~ '^[a-z_]{1,40}(,[a-z_]{1,40})*$'),
  expires_at            timestamptz NOT NULL,
  revoked_at            timestamptz,
  created_by            uuid REFERENCES core.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  first_used_at         timestamptz,
  last_used_at          timestamptz,
  submitted_at          timestamptz,
  note                  text CHECK (note IS NULL OR length(note) BETWEEN 1 AND 500),
  connection_invite_id  uuid REFERENCES integrations.connection_invites(id) ON DELETE SET NULL,
  CONSTRAINT client_context_links_prazo CHECK (expires_at > created_at)
);

COMMENT ON TABLE core.client_context_links IS
  'Link público para o cliente preencher o mapa de contexto sem conta na Orla (ADR 0026). O segredo é o token (256 bits), guardado só como SHA-256: quem lê o banco não consegue montar a URL. Escopo: um cliente e um recorte de seções.';
COMMENT ON COLUMN core.client_context_links.note IS
  'Mensagem da equipe exibida ao cliente no topo do formulário. Não é nota interna.';
COMMENT ON COLUMN core.client_context_links.connection_invite_id IS
  'Quando o link de contexto vai junto do convite de integração: a página do convite mostra as duas tarefas. Um convite tem no máximo um link de contexto vivo.';

CREATE INDEX IF NOT EXISTS client_context_links_cliente ON core.client_context_links (client_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS client_context_links_um_por_convite
  ON core.client_context_links (connection_invite_id)
  WHERE connection_invite_id IS NOT NULL AND revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS core.client_context_entries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES core.organizations(id) ON DELETE RESTRICT,
  client_id         uuid NOT NULL REFERENCES core.clients(id) ON DELETE CASCADE,
  section           text NOT NULL CHECK (section ~ '^[a-z_]{1,40}$'),
  field_key         text NOT NULL CHECK (field_key ~ '^[a-z][a-z0-9_]{0,79}$'),
  value             jsonb NOT NULL CHECK (pg_column_size(value) <= 65536),
  epistemic         text NOT NULL DEFAULT 'fato' CHECK (epistemic IN ('fato', 'hipotese', 'desejo')),
  source            text NOT NULL DEFAULT 'equipe' CHECK (source IN ('cliente', 'equipe', 'pesquisa', 'ia')),
  review            text NOT NULL DEFAULT 'confirmado' CHECK (review IN ('confirmado', 'sugerido')),
  shareable         boolean NOT NULL DEFAULT false,
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_by        uuid REFERENCES core.users(id) ON DELETE SET NULL,
  updated_via_link  uuid REFERENCES core.client_context_links(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_context_entries_unica UNIQUE (client_id, field_key)
);

COMMENT ON TABLE core.client_context_entries IS
  'Um valor escalar do mapa de contexto (catálogo em src/modules/clients/domain/contexto/catalogo.ts). field_key nunca é renomeada. version é a trava otimista: quem grava manda a versão que leu.';
COMMENT ON COLUMN core.client_context_entries.shareable IS
  'A equipe marcou o valor como exibível no formulário do cliente. Hipótese e sugestão não confirmada nunca aparecem, mesmo marcadas.';

CREATE TABLE IF NOT EXISTS core.client_context_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES core.organizations(id) ON DELETE RESTRICT,
  client_id         uuid NOT NULL REFERENCES core.clients(id) ON DELETE CASCADE,
  section           text NOT NULL CHECK (section ~ '^[a-z_]{1,40}$'),
  list_key          text NOT NULL CHECK (list_key ~ '^[a-z][a-z0-9_]{0,79}$'),
  position          integer NOT NULL CHECK (position >= 0),
  data              jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object' AND pg_column_size(data) <= 65536),
  epistemic         text NOT NULL DEFAULT 'fato' CHECK (epistemic IN ('fato', 'hipotese', 'desejo')),
  source            text NOT NULL DEFAULT 'equipe' CHECK (source IN ('cliente', 'equipe', 'pesquisa', 'ia')),
  review            text NOT NULL DEFAULT 'confirmado' CHECK (review IN ('confirmado', 'sugerido')),
  shareable         boolean NOT NULL DEFAULT false,
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_by        uuid REFERENCES core.users(id) ON DELETE SET NULL,
  updated_via_link  uuid REFERENCES core.client_context_links(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE core.client_context_items IS
  'Item de uma lista do mapa de contexto (redes, produtos, personas, concorrentes, campanhas…). O id é estável e vira a chave do item no brain exportado (uma linha JSONL por item).';

CREATE INDEX IF NOT EXISTS client_context_items_lista ON core.client_context_items (client_id, list_key, position);

CREATE TABLE IF NOT EXISTS core.client_context_revisions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES core.organizations(id) ON DELETE RESTRICT,
  client_id        uuid NOT NULL REFERENCES core.clients(id) ON DELETE CASCADE,
  target           text NOT NULL CHECK (target IN ('campo', 'item')),
  section          text NOT NULL,
  key              text NOT NULL,
  item_id          uuid,
  operation        text NOT NULL CHECK (operation IN ('criar', 'alterar', 'status', 'remover')),
  before           jsonb,
  after            jsonb,
  version          integer,
  actor_user_id    uuid REFERENCES core.users(id) ON DELETE SET NULL,
  via_link_id      uuid REFERENCES core.client_context_links(id) ON DELETE SET NULL,
  occurred_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE core.client_context_revisions IS
  'Histórico só de acréscimo do mapa de contexto, escrito pelo gatilho core.contexto_apos_mudanca. O app só lê. Pode conter dado pessoal de depoimento: some com o cliente no expurgo (ON DELETE CASCADE).';

CREATE INDEX IF NOT EXISTS client_context_revisions_cliente ON core.client_context_revisions (client_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS core.client_context_files (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES core.organizations(id) ON DELETE RESTRICT,
  client_id        uuid NOT NULL REFERENCES core.clients(id) ON DELETE CASCADE,
  section          text NOT NULL CHECK (section ~ '^[a-z_]{1,40}$'),
  field_key        text NOT NULL CHECK (field_key ~ '^[a-z][a-z0-9_]{0,79}$'),
  item_id          uuid REFERENCES core.client_context_items(id) ON DELETE SET NULL,
  object_path      text NOT NULL UNIQUE CHECK (length(object_path) <= 1024 AND position('..' IN object_path) = 0),
  filename         text NOT NULL CHECK (length(filename) BETWEEN 1 AND 255),
  mime             text NOT NULL CHECK (length(mime) BETWEEN 3 AND 120),
  size_bytes       bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 26214400),
  sha256           text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  source           text NOT NULL CHECK (source IN ('cliente', 'equipe', 'pesquisa', 'ia')),
  shareable        boolean NOT NULL DEFAULT false,
  created_by       uuid REFERENCES core.users(id) ON DELETE SET NULL,
  via_link_id      uuid REFERENCES core.client_context_links(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  CONSTRAINT client_context_files_no_prefixo CHECK (
    object_path LIKE 'orgs/' || organization_id::text || '/clientes/' || client_id::text || '/%')
);

COMMENT ON TABLE core.client_context_files IS
  'Metadados de arquivos do contexto. O conteúdo fica no bucket, sob orgs/{org}/clientes/{cliente}/ (ADR 0026); o CHECK impede registrar caminho fora do prefixo do próprio cliente.';

CREATE INDEX IF NOT EXISTS client_context_files_cliente ON core.client_context_files (client_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS core.client_context_brain (
  client_id        uuid PRIMARY KEY REFERENCES core.clients(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL REFERENCES core.organizations(id) ON DELETE RESTRICT,
  requested_at     timestamptz NOT NULL DEFAULT now(),
  exported_hash    text CHECK (exported_hash IS NULL OR exported_hash ~ '^[0-9a-f]{64}$'),
  exported_at      timestamptz,
  schema_version   integer,
  last_attempt_at  timestamptz,
  last_error       text CHECK (last_error IS NULL OR length(last_error) <= 500),
  attempts         integer NOT NULL DEFAULT 0 CHECK (attempts >= 0)
);

COMMENT ON TABLE core.client_context_brain IS
  'Estado da exportação do company brain por cliente. requested_at sobe a cada mudança (gatilho); o exportador grava hash, instante e erro. Pendente = requested_at depois da última tentativa.';

DO $$
DECLARE
  tabela text;
BEGIN
  FOREACH tabela IN ARRAY ARRAY['client_context_links', 'client_context_entries', 'client_context_items',
                                'client_context_revisions', 'client_context_files', 'client_context_brain']
  LOOP
    EXECUTE format('ALTER TABLE core.%I ENABLE ROW LEVEL SECURITY', tabela);
    EXECUTE format('ALTER TABLE core.%I FORCE ROW LEVEL SECURITY', tabela);
    EXECUTE format('DROP POLICY IF EXISTS %I ON core.%I', tabela || '_tenant', tabela);
    EXECUTE format(
      'CREATE POLICY %I ON core.%I FOR ALL TO %I
         USING (organization_id = core.current_organization() AND core.cliente_no_escopo(client_id)
                AND EXISTS (SELECT 1 FROM core.clients c WHERE c.id = %I.client_id))
         WITH CHECK (organization_id = core.current_organization() AND core.cliente_no_escopo(client_id)
                AND EXISTS (SELECT 1 FROM core.clients c WHERE c.id = %I.client_id))',
      tabela || '_tenant', tabela, current_setting('contexto.papel_app'), tabela, tabela);
  END LOOP;

  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON core.client_context_links TO %I', current_setting('contexto.papel_app'));
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON core.client_context_entries TO %I', current_setting('contexto.papel_app'));
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON core.client_context_items TO %I', current_setting('contexto.papel_app'));
  EXECUTE format('GRANT SELECT ON core.client_context_revisions TO %I', current_setting('contexto.papel_app'));
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON core.client_context_files TO %I', current_setting('contexto.papel_app'));
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON core.client_context_brain TO %I', current_setting('contexto.papel_app'));
END $$;

DROP TRIGGER IF EXISTS client_context_entries_touch ON core.client_context_entries;
CREATE TRIGGER client_context_entries_touch BEFORE UPDATE ON core.client_context_entries
  FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();
DROP TRIGGER IF EXISTS client_context_items_touch ON core.client_context_items;
CREATE TRIGGER client_context_items_touch BEFORE UPDATE ON core.client_context_items
  FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();

CREATE OR REPLACE FUNCTION core.contexto_apos_mudanca()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_novo      jsonb := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
  v_velho     jsonb := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  v_linha     jsonb := coalesce(to_jsonb(NEW), to_jsonb(OLD));
  v_cliente   uuid := (coalesce(v_novo, v_velho) ->> 'client_id')::uuid;
  v_ignorar   text[] := ARRAY['id', 'organization_id', 'client_id', 'section', 'field_key', 'list_key', 'position',
                              'version', 'updated_by', 'updated_via_link', 'created_at', 'updated_at'];
  v_antes     jsonb;
  v_depois    jsonb;
  v_operacao  text;
  v_usuario   uuid;
  v_link      uuid;
  v_conteudo  text;
BEGIN
  v_linha := coalesce(v_novo, v_velho);

  IF NOT EXISTS (SELECT 1 FROM core.clients WHERE id = v_cliente) THEN
    RETURN NULL;
  END IF;

  INSERT INTO core.client_context_brain (client_id, organization_id)
  VALUES (v_cliente, (v_linha ->> 'organization_id')::uuid)
  ON CONFLICT (client_id) DO UPDATE SET requested_at = now();

  IF TG_TABLE_NAME = 'client_context_files' THEN
    RETURN NULL;
  END IF;

  v_conteudo := CASE WHEN TG_TABLE_NAME = 'client_context_entries' THEN 'value' ELSE 'data' END;
  v_antes := v_velho - v_ignorar;
  v_depois := v_novo - v_ignorar;

  IF TG_OP = 'INSERT' THEN
    v_operacao := 'criar';
  ELSIF TG_OP = 'DELETE' THEN
    v_operacao := 'remover';
  ELSIF v_antes = v_depois THEN
    RETURN NULL;
  ELSIF v_antes -> v_conteudo IS DISTINCT FROM v_depois -> v_conteudo THEN
    v_operacao := 'alterar';
  ELSE
    v_operacao := 'status';
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_usuario := nullif(current_setting('app.user_id', true), '')::uuid;
    v_link := nullif(current_setting('app.context_link_id', true), '')::uuid;
  ELSE
    v_usuario := (v_novo ->> 'updated_by')::uuid;
    v_link := (v_novo ->> 'updated_via_link')::uuid;
  END IF;
  IF v_usuario IS NOT NULL AND NOT EXISTS (SELECT 1 FROM core.users WHERE id = v_usuario) THEN
    v_usuario := NULL;
  END IF;
  IF v_link IS NOT NULL AND NOT EXISTS (SELECT 1 FROM core.client_context_links WHERE id = v_link) THEN
    v_link := NULL;
  END IF;

  INSERT INTO core.client_context_revisions
    (organization_id, client_id, target, section, key, item_id, operation, before, after, version,
     actor_user_id, via_link_id)
  VALUES (
    (v_linha ->> 'organization_id')::uuid,
    v_cliente,
    CASE WHEN TG_TABLE_NAME = 'client_context_entries' THEN 'campo' ELSE 'item' END,
    v_linha ->> 'section',
    coalesce(v_linha ->> 'field_key', v_linha ->> 'list_key'),
    CASE WHEN TG_TABLE_NAME = 'client_context_items' THEN (v_linha ->> 'id')::uuid END,
    v_operacao,
    v_antes,
    v_depois,
    (v_linha ->> 'version')::integer,
    v_usuario,
    v_link
  );

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION core.contexto_apos_mudanca IS
  'Gatilho único do mapa de contexto: escreve a revisão (antes/depois, autor, link) e marca o brain do cliente como pendente. Ignora o efeito cascata do expurgo (cliente já apagado). SECURITY DEFINER para o histórico ser só de acréscimo: o app não tem INSERT em client_context_revisions.';

REVOKE ALL ON FUNCTION core.contexto_apos_mudanca() FROM PUBLIC;

DROP TRIGGER IF EXISTS client_context_entries_revisao ON core.client_context_entries;
CREATE TRIGGER client_context_entries_revisao AFTER INSERT OR UPDATE OR DELETE ON core.client_context_entries
  FOR EACH ROW EXECUTE FUNCTION core.contexto_apos_mudanca();
DROP TRIGGER IF EXISTS client_context_items_revisao ON core.client_context_items;
CREATE TRIGGER client_context_items_revisao AFTER INSERT OR UPDATE OR DELETE ON core.client_context_items
  FOR EACH ROW EXECUTE FUNCTION core.contexto_apos_mudanca();
DROP TRIGGER IF EXISTS client_context_files_brain ON core.client_context_files;
CREATE TRIGGER client_context_files_brain AFTER INSERT OR UPDATE OR DELETE ON core.client_context_files
  FOR EACH ROW EXECUTE FUNCTION core.contexto_apos_mudanca();

CREATE OR REPLACE FUNCTION core.contexto_revogar_links_do_excluido()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE core.client_context_links
     SET revoked_at = now()
   WHERE client_id = NEW.id AND revoked_at IS NULL;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION core.contexto_revogar_links_do_excluido IS
  'Exclusão lógica do cliente (ADR 0022) revoga os links de contexto. Restaurar não os revive, como acontece com os convites de integração.';

REVOKE ALL ON FUNCTION core.contexto_revogar_links_do_excluido() FROM PUBLIC;

DROP TRIGGER IF EXISTS clients_revoga_links_de_contexto ON core.clients;
CREATE TRIGGER clients_revoga_links_de_contexto AFTER UPDATE OF excluido_em ON core.clients
  FOR EACH ROW WHEN (OLD.excluido_em IS NULL AND NEW.excluido_em IS NOT NULL)
  EXECUTE FUNCTION core.contexto_revogar_links_do_excluido();

CREATE OR REPLACE FUNCTION core.contexto_link_valido(p_token_hash text)
RETURNS core.client_context_links
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT l.*
  FROM core.client_context_links l
  JOIN core.clients c ON c.id = l.client_id
  WHERE l.token_hash = p_token_hash
    AND l.revoked_at IS NULL
    AND l.expires_at > now()
    AND c.excluido_em IS NULL;
$$;

COMMENT ON FUNCTION core.contexto_link_valido IS
  'Ponto único que decide se um link de contexto vale: hash conhecido, não revogado, não vencido, cliente não excluído. Só as outras travessias chamam; o app não tem EXECUTE.';

REVOKE ALL ON FUNCTION core.contexto_link_valido(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION core.contexto_visivel_ao_cliente(p_shareable boolean, p_source text, p_review text, p_epistemic text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT p_shareable AND (p_source = 'cliente' OR (p_review = 'confirmado' AND p_epistemic <> 'hipotese'));
$$;

COMMENT ON FUNCTION core.contexto_visivel_ao_cliente IS
  'Mesma regra de ehVisivelAoCliente (tipos.ts): o cliente vê só o que a equipe marcou como compartilhável e não é hipótese nem sugestão, além do que ele mesmo escreveu.';

CREATE OR REPLACE FUNCTION core.contexto_link_abrir(p_token_hash text)
RETURNS TABLE (
  link_id            uuid,
  organization_id    uuid,
  client_id          uuid,
  organization_name  text,
  client_name        text,
  sections           text[],
  expires_at         timestamptz,
  submitted_at       timestamptz,
  note               text,
  uso_bytes          bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
VOLATILE
AS $$
#variable_conflict use_column
DECLARE
  v_link core.client_context_links;
BEGIN
  v_link := core.contexto_link_valido(p_token_hash);
  IF v_link.id IS NULL THEN
    RETURN;
  END IF;

  UPDATE core.client_context_links
     SET first_used_at = coalesce(first_used_at, now()), last_used_at = now()
   WHERE id = v_link.id;

  RETURN QUERY
  SELECT v_link.id, v_link.organization_id, v_link.client_id, o.name, c.name, v_link.sections, v_link.expires_at,
         v_link.submitted_at, v_link.note,
         (SELECT coalesce(sum(f.size_bytes), 0)::bigint FROM core.client_context_files f
           WHERE f.client_id = v_link.client_id AND f.deleted_at IS NULL)
  FROM core.clients c
  JOIN core.organizations o ON o.id = c.organization_id
  WHERE c.id = v_link.client_id;
END;
$$;

COMMENT ON FUNCTION core.contexto_link_abrir IS
  'Travessia de tenant do formulário público: resolve pelo hash do token e devolve só o escopo (cliente, seções, prazo) e os nomes para exibir. Registra o uso.';

CREATE OR REPLACE FUNCTION core.contexto_link_ler(p_token_hash text, p_campos text[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
DECLARE
  v_link core.client_context_links;
BEGIN
  v_link := core.contexto_link_valido(p_token_hash);
  IF v_link.id IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'campos', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'section', e.section, 'field_key', e.field_key, 'value', e.value, 'epistemic', e.epistemic,
               'source', e.source, 'version', e.version) ORDER BY e.field_key)
      FROM core.client_context_entries e
      WHERE e.client_id = v_link.client_id
        AND e.section = ANY (v_link.sections)
        AND e.field_key = ANY (p_campos)
        AND core.contexto_visivel_ao_cliente(e.shareable, e.source, e.review, e.epistemic)), '[]'::jsonb),
    'itens', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', i.id, 'section', i.section, 'list_key', i.list_key, 'position', i.position, 'data', i.data,
               'epistemic', i.epistemic, 'source', i.source, 'version', i.version) ORDER BY i.list_key, i.position, i.id)
      FROM core.client_context_items i
      WHERE i.client_id = v_link.client_id
        AND i.section = ANY (v_link.sections)
        AND i.list_key = ANY (p_campos)
        AND core.contexto_visivel_ao_cliente(i.shareable, i.source, i.review, i.epistemic)), '[]'::jsonb),
    'arquivos', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', f.id, 'section', f.section, 'field_key', f.field_key, 'item_id', f.item_id,
               'filename', f.filename, 'mime', f.mime, 'size_bytes', f.size_bytes, 'source', f.source,
               'created_at', f.created_at) ORDER BY f.created_at, f.id)
      FROM core.client_context_files f
      WHERE f.client_id = v_link.client_id
        AND f.deleted_at IS NULL
        AND f.shareable
        AND f.section = ANY (v_link.sections)
        AND f.field_key = ANY (p_campos)), '[]'::jsonb)
  );
END;
$$;

COMMENT ON FUNCTION core.contexto_link_ler IS
  'O que o cliente vê pelo link: só seções do link, só campos que o catálogo libera (p_campos vem do app) e só valores visíveis ao cliente. Nunca notas internas, hipóteses ou sugestões.';

CREATE OR REPLACE FUNCTION core.contexto_link_salvar_campo(
  p_token_hash text, p_section text, p_field_key text, p_value jsonb, p_epistemic text, p_versao_esperada integer)
RETURNS TABLE (resultado text, versao integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
VOLATILE
AS $$
DECLARE
  v_link     core.client_context_links;
  v_atual    core.client_context_entries;
  v_visivel  boolean;
  v_versao   integer;
BEGIN
  v_link := core.contexto_link_valido(p_token_hash);
  IF v_link.id IS NULL THEN
    RETURN QUERY SELECT 'recusado'::text, NULL::integer;
    RETURN;
  END IF;
  IF NOT (p_section = ANY (v_link.sections)) OR p_epistemic NOT IN ('fato', 'hipotese', 'desejo') THEN
    RETURN QUERY SELECT 'fora_do_escopo'::text, NULL::integer;
    RETURN;
  END IF;

  PERFORM set_config('app.context_link_id', v_link.id::text, true);
  UPDATE core.client_context_links SET last_used_at = now() WHERE id = v_link.id;

  SELECT * INTO v_atual FROM core.client_context_entries
   WHERE client_id = v_link.client_id AND field_key = p_field_key
   FOR UPDATE;

  IF v_atual.id IS NOT NULL AND v_atual.section <> p_section THEN
    RETURN QUERY SELECT 'fora_do_escopo'::text, NULL::integer;
    RETURN;
  END IF;

  v_visivel := v_atual.id IS NOT NULL
               AND core.contexto_visivel_ao_cliente(v_atual.shareable, v_atual.source, v_atual.review, v_atual.epistemic);
  v_versao := CASE WHEN v_visivel THEN v_atual.version ELSE 0 END;

  IF p_versao_esperada IS DISTINCT FROM v_versao THEN
    RETURN QUERY SELECT 'conflito'::text, v_versao;
    RETURN;
  END IF;

  IF p_value IS NULL OR p_value = 'null'::jsonb THEN
    IF v_visivel THEN
      DELETE FROM core.client_context_entries WHERE id = v_atual.id;
    END IF;
    RETURN QUERY SELECT 'ok'::text, 0;
    RETURN;
  END IF;

  IF v_atual.id IS NULL THEN
    INSERT INTO core.client_context_entries
      (organization_id, client_id, section, field_key, value, epistemic, source, review, shareable, updated_via_link)
    VALUES (v_link.organization_id, v_link.client_id, p_section, p_field_key, p_value, p_epistemic,
            'cliente', 'confirmado', true, v_link.id);
    RETURN QUERY SELECT 'ok'::text, 1;
    RETURN;
  END IF;

  UPDATE core.client_context_entries
     SET value = p_value, epistemic = p_epistemic, source = 'cliente', review = 'confirmado', shareable = true,
         version = version + 1, updated_by = NULL, updated_via_link = v_link.id
   WHERE id = v_atual.id
  RETURNING version INTO v_versao;

  RETURN QUERY SELECT 'ok'::text, v_versao;
END;
$$;

COMMENT ON FUNCTION core.contexto_link_salvar_campo IS
  'Autosave do formulário público, idempotente pela versão: o cliente manda a versão que leu (0 se não via valor). Valor que ele não via (interno ou hipótese da equipe) é substituído pelo dele e o anterior fica na revisão. Grava fonte = cliente.';

CREATE OR REPLACE FUNCTION core.contexto_link_salvar_item(
  p_token_hash text, p_section text, p_list_key text, p_item_id uuid, p_data jsonb, p_epistemic text,
  p_versao_esperada integer)
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
    IF (SELECT count(*) FROM core.client_context_items
         WHERE client_id = v_link.client_id AND list_key = p_list_key) >= 500 THEN
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

COMMENT ON FUNCTION core.contexto_link_salvar_item IS
  'Cria (p_item_id nulo) ou altera um item de lista pelo link. Alterar exige item visível ao cliente, da mesma seção e lista, e a versão que ele leu.';

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
   WHERE id = p_item_id AND client_id = v_link.client_id AND section = ANY (v_link.sections) AND source = 'cliente'
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
  'O cliente só remove item que ele mesmo escreveu (fonte = cliente). Item da equipe não some pelo link.';

CREATE OR REPLACE FUNCTION core.contexto_link_concluir(p_token_hash text)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
VOLATILE
AS $$
DECLARE
  v_link core.client_context_links;
  v_em   timestamptz;
BEGIN
  v_link := core.contexto_link_valido(p_token_hash);
  IF v_link.id IS NULL THEN
    RETURN NULL;
  END IF;
  UPDATE core.client_context_links
     SET submitted_at = now(), last_used_at = now()
   WHERE id = v_link.id
  RETURNING submitted_at INTO v_em;
  RETURN v_em;
END;
$$;

COMMENT ON FUNCTION core.contexto_link_concluir IS
  'O cliente avisa que terminou. O link continua valendo até vencer ou ser revogado, para correções.';

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
     WHERE id = p_item_id AND client_id = v_link.client_id AND source = 'cliente') THEN
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
  'Registra o metadado de um arquivo que o cliente enviou pelo link, depois de o objeto ter sido gravado no bucket. A cota é conferida sob trava por cliente; o caminho só passa pelo CHECK se estiver no prefixo do cliente.';

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
    AND i.status <> 'revoked'
    AND l.revoked_at IS NULL
    AND l.expires_at > now()
    AND c.excluido_em IS NULL
  ORDER BY l.created_at DESC
  LIMIT 1;
$$;

COMMENT ON FUNCTION core.contexto_link_pelo_convite IS
  'A página do convite de integração mostra também o formulário de contexto: o token do convite leva ao link de contexto amarrado a ele. O hash devolvido só circula no servidor.';

CREATE OR REPLACE FUNCTION core.contexto_brains_pendentes(p_limite integer, p_espera interval)
RETURNS TABLE (organization_id uuid, client_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT b.organization_id, b.client_id
  FROM core.client_context_brain b
  JOIN core.clients c ON c.id = b.client_id
  WHERE c.excluido_em IS NULL
    AND b.requested_at < now() - p_espera
    AND (b.last_attempt_at IS NULL OR b.requested_at > b.last_attempt_at
         OR (b.last_error IS NOT NULL
             AND b.last_attempt_at < now() - least(b.attempts, 12) * interval '5 minutes'))
  ORDER BY b.requested_at
  LIMIT least(greatest(p_limite, 1), 500);
$$;

COMMENT ON FUNCTION core.contexto_brains_pendentes IS
  'Fila de reexportação do brain para uma varredura periódica: cliente mudou depois da última tentativa (já passado o tempo de espera) ou falhou e venceu o recuo.';

DO $$
DECLARE
  assinatura text;
BEGIN
  FOREACH assinatura IN ARRAY ARRAY[
    'core.contexto_link_abrir(text)',
    'core.contexto_link_ler(text, text[])',
    'core.contexto_link_salvar_campo(text, text, text, jsonb, text, integer)',
    'core.contexto_link_salvar_item(text, text, text, uuid, jsonb, text, integer)',
    'core.contexto_link_remover_item(text, uuid, integer)',
    'core.contexto_link_concluir(text)',
    'core.contexto_link_registrar_arquivo(text, uuid, text, text, uuid, text, text, text, bigint, text, bigint)',
    'core.contexto_link_pelo_convite(text)',
    'core.contexto_brains_pendentes(integer, interval)'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', assinatura);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I', assinatura, current_setting('contexto.papel_app'));
  END LOOP;
END $$;

COMMIT;
