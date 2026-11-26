BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  PERFORM set_config(
    'ia.papel_app',
    (SELECT rolname FROM pg_roles WHERE rolname IN ('orla_app', 'tria_app') ORDER BY rolname = 'orla_app' DESC LIMIT 1),
    true
  );
  IF current_setting('ia.papel_app') = '' THEN
    RAISE EXCEPTION 'papel do app ausente; as migracoes 0070 e anteriores precisam ter rodado';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS core.agent_credentials (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
  name             text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  token_hash       text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  token_label      text NOT NULL CHECK (length(token_label) BETWEEN 8 AND 24),
  client_ids       uuid[] CHECK (client_ids IS NULL OR cardinality(client_ids) BETWEEN 1 AND 200),
  tools            text[] NOT NULL CHECK (
                     cardinality(tools) BETWEEN 1 AND 50
                     AND array_to_string(tools, ',') ~ '^[a-z][a-z0-9_]{2,63}(,[a-z][a-z0-9_]{2,63})*$'),
  expires_at       timestamptz NOT NULL,
  revoked_at       timestamptz,
  created_by       uuid REFERENCES core.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_used_at     timestamptz,
  CONSTRAINT agent_credentials_prazo CHECK (expires_at > created_at AND expires_at <= created_at + interval '90 days')
);

COMMENT ON TABLE core.agent_credentials IS
  'Credencial de agente por organização (ADR 0057). O segredo tem 256 bits e fica só como SHA-256: quem lê o banco não monta a credencial. Escopo: uma organização, uma lista de clientes (NULL = todos da organização) e as ferramentas permitidas. Validade obrigatória de no máximo 90 dias.';
COMMENT ON COLUMN core.agent_credentials.token_label IS
  'Rótulo mascarado para a tela (prefixo e quatro últimos caracteres). Não permite reconstruir o segredo.';
COMMENT ON COLUMN core.agent_credentials.client_ids IS
  'NULL = todos os clientes da organização. A leitura sempre confere também a organização do cliente, então um id de outra organização nesta lista não abre nada.';

CREATE INDEX IF NOT EXISTS agent_credentials_organizacao ON core.agent_credentials (organization_id, created_at DESC);

DO $$
DECLARE
  papel text := current_setting('ia.papel_app');
BEGIN
  ALTER TABLE core.agent_credentials ENABLE ROW LEVEL SECURITY;
  ALTER TABLE core.agent_credentials FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS agent_credentials_leitura ON core.agent_credentials;
  DROP POLICY IF EXISTS agent_credentials_insercao ON core.agent_credentials;
  DROP POLICY IF EXISTS agent_credentials_revogacao ON core.agent_credentials;
  EXECUTE format(
    'CREATE POLICY agent_credentials_leitura ON core.agent_credentials FOR SELECT TO %I
       USING (organization_id = core.current_organization())', papel);
  EXECUTE format(
    'CREATE POLICY agent_credentials_insercao ON core.agent_credentials FOR INSERT TO %I
       WITH CHECK (organization_id = core.current_organization() AND created_by = core.current_user_id())', papel);
  EXECUTE format(
    'CREATE POLICY agent_credentials_revogacao ON core.agent_credentials FOR UPDATE TO %I
       USING (organization_id = core.current_organization())
       WITH CHECK (organization_id = core.current_organization() AND revoked_at IS NOT NULL)', papel);
  REVOKE ALL ON core.agent_credentials FROM PUBLIC;
  EXECUTE format('REVOKE ALL ON core.agent_credentials FROM %I', papel);
  EXECUTE format('GRANT SELECT ON core.agent_credentials TO %I', papel);
  EXECUTE format(
    'GRANT INSERT (organization_id, name, token_hash, token_label, client_ids, tools, expires_at, created_by)
       ON core.agent_credentials TO %I', papel);
  EXECUTE format('GRANT UPDATE (revoked_at) ON core.agent_credentials TO %I', papel);
END $$;

CREATE OR REPLACE FUNCTION core.agente_resolver(p_token_hash text)
RETURNS TABLE (
  credential_id    uuid,
  organization_id  uuid,
  client_ids       uuid[],
  tools            text[],
  expires_at       timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
VOLATILE
AS $$
#variable_conflict use_column
DECLARE
  v_credencial core.agent_credentials;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN;
  END IF;

  SELECT a.* INTO v_credencial
    FROM core.agent_credentials a
    JOIN core.organizations o ON o.id = a.organization_id
   WHERE a.token_hash = p_token_hash
     AND a.revoked_at IS NULL
     AND a.expires_at > now()
     AND o.status <> 'archived';

  IF v_credencial.id IS NULL THEN
    RETURN;
  END IF;

  UPDATE core.agent_credentials
     SET last_used_at = now()
   WHERE id = v_credencial.id
     AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute');

  RETURN QUERY
  SELECT v_credencial.id, v_credencial.organization_id, v_credencial.client_ids, v_credencial.tools, v_credencial.expires_at;
END;
$$;

COMMENT ON FUNCTION core.agente_resolver IS
  'Travessia de tenant do servidor MCP (ADR 0057, categoria prova de segredo do ADR 0045): resolve pelo SHA-256 da credencial e devolve só o escopo. Credencial revogada, vencida ou de organização arquivada não resolve. Registra o uso no máximo uma vez por minuto.';

DO $$
BEGIN
  REVOKE ALL ON FUNCTION core.agente_resolver(text) FROM PUBLIC;
  EXECUTE format('GRANT EXECUTE ON FUNCTION core.agente_resolver(text) TO %I', current_setting('ia.papel_app'));
END $$;

COMMIT;
