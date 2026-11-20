BEGIN;

DO $$
BEGIN
  PERFORM set_config(
    'tokens.papel_app',
    (SELECT rolname FROM pg_roles WHERE rolname IN ('orla_app', 'tria_app') ORDER BY rolname = 'orla_app' DESC LIMIT 1),
    true
  );
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS connections_id_organizacao ON integrations.connections (id, organization_id);

CREATE TABLE IF NOT EXISTS integrations.connection_tokens (
  connection_id            uuid PRIMARY KEY,
  organization_id          uuid NOT NULL,
  tipo                     text NOT NULL CHECK (tipo IN ('oauth_refresh', 'oauth_long_lived', 'api_key')),
  ciphertext               bytea NOT NULL CHECK (octet_length(ciphertext) BETWEEN 32 AND 65536),
  kms_key_version          text NOT NULL CHECK (length(kms_key_version) BETWEEN 1 AND 512),
  algoritmo                text NOT NULL CHECK (algoritmo IN ('aes-256-gcm+kms', 'aes-256-gcm+local')),
  segredo_expira_em        timestamptz,
  access_token_ciphertext  bytea CHECK (access_token_ciphertext IS NULL OR octet_length(access_token_ciphertext) BETWEEN 32 AND 65536),
  access_kms_key_version   text CHECK (access_kms_key_version IS NULL OR length(access_kms_key_version) BETWEEN 1 AND 512),
  access_expires_at        timestamptz,
  refreshed_at             timestamptz,
  ultima_falha_em          timestamptz,
  ultima_falha_codigo      text CHECK (ultima_falha_codigo IS NULL OR ultima_falha_codigo ~ '^[a-z_]{1,40}$'),
  versao                   integer NOT NULL DEFAULT 1 CHECK (versao >= 1),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT connection_tokens_conexao FOREIGN KEY (connection_id, organization_id)
    REFERENCES integrations.connections (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT connection_tokens_acesso_completo CHECK (
    (access_token_ciphertext IS NULL) = (access_expires_at IS NULL)
    AND (access_token_ciphertext IS NULL) = (access_kms_key_version IS NULL)),
  CONSTRAINT connection_tokens_acesso_so_com_refresh CHECK (tipo = 'oauth_refresh' OR access_token_ciphertext IS NULL)
);

COMMENT ON TABLE integrations.connection_tokens IS
  'Cofre de tokens (ADR 0032): o segredo de longa duração de cada conexão, cifrado por envelope (AES-256-GCM com chave de dados embrulhada pela chave do Cloud KMS). O texto claro nunca é gravado. AAD = conexão + plataforma + finalidade: um ciphertext copiado para outra linha não decifra.';
COMMENT ON COLUMN integrations.connection_tokens.ciphertext IS
  'Envelope do segredo de longa duração: refresh token (Google), token de longa duração (Meta) ou chave de API. Formato binário versionado, ver src/modules/tokens/infrastructure/envelope.ts.';
COMMENT ON COLUMN integrations.connection_tokens.kms_key_version IS
  'Versão da chave do KMS que embrulhou a chave de dados (ou "local:v1" fora de produção). Permite saber o que recifrar depois de uma rotação.';
COMMENT ON COLUMN integrations.connection_tokens.segredo_expira_em IS
  'Validade do próprio segredo, quando a plataforma informa (token de longa duração da Meta, ~60 dias). A varredura proativa renova antes do fim.';
COMMENT ON COLUMN integrations.connection_tokens.access_token_ciphertext IS
  'Access token de curta duração em cache, também cifrado, para não renovar a cada execução nem depois de reiniciar o app. Só para refresh token (Google).';
COMMENT ON COLUMN integrations.connection_tokens.versao IS
  'Trava otimista: toda gravação exige a versão lida e a incrementa.';

CREATE INDEX IF NOT EXISTS connection_tokens_a_renovar
  ON integrations.connection_tokens (segredo_expira_em)
  WHERE tipo = 'oauth_long_lived' AND segredo_expira_em IS NOT NULL;

DROP TRIGGER IF EXISTS connection_tokens_touch ON integrations.connection_tokens;
CREATE TRIGGER connection_tokens_touch BEFORE UPDATE ON integrations.connection_tokens
  FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();

ALTER TABLE integrations.connection_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations.connection_tokens FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS connection_tokens_tenant ON integrations.connection_tokens;
DO $$ BEGIN
  EXECUTE format(
    'CREATE POLICY connection_tokens_tenant ON integrations.connection_tokens FOR ALL TO %I
       USING (organization_id = core.current_organization() AND core.current_clients() IS NULL)
       WITH CHECK (organization_id = core.current_organization() AND core.current_clients() IS NULL)',
    current_setting('tokens.papel_app'));
END $$;

DROP FUNCTION IF EXISTS integrations.resolver_conexao_do_token(uuid, uuid);

CREATE FUNCTION integrations.resolver_conexao_do_token(p_coleta_id uuid, p_tarefa_id uuid)
RETURNS TABLE (
  organization_id     uuid,
  connection_id       uuid,
  platform            text,
  connection_status   text,
  origem_em_execucao  boolean,
  fonte_ativa         boolean,
  tenant_ativo        boolean,
  tem_token           boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT c.organization_id, n.id, n.platform::text, n.status::text,
         c.status::text = 'running',
         CASE c.fonte_tipo
           WHEN 'ad_account' THEN coalesce(a.status::text = 'linked' AND a.sync_enabled, false)
           ELSE coalesce(ca.state::text = 'linked' AND NOT ca.inactive AND ca.client_id IS NOT NULL, false)
         END,
         cl.id IS NOT NULL AND cl.excluido_em IS NULL AND cl.status::text = 'active' AND o.status::text = 'active',
         EXISTS (SELECT 1 FROM integrations.connection_tokens t WHERE t.connection_id = n.id)
  FROM automation.coletas c
  LEFT JOIN integrations.ad_accounts a ON c.fonte_tipo = 'ad_account' AND a.id = c.ad_account_id
  LEFT JOIN integrations.connection_accounts ca ON c.fonte_tipo = 'connection_account' AND ca.id = c.connection_account_id
  JOIN integrations.connections n ON n.id = coalesce(a.connection_id, ca.connection_id)
  LEFT JOIN core.clients cl ON cl.id = c.client_id
  JOIN core.organizations o ON o.id = c.organization_id
  WHERE p_coleta_id IS NOT NULL AND p_tarefa_id IS NULL AND c.id = p_coleta_id

  UNION ALL

  SELECT t.organization_id, n.id, n.platform::text, n.status::text,
         t.status::text = 'running',
         true,
         o.status::text = 'active',
         EXISTS (SELECT 1 FROM integrations.connection_tokens k WHERE k.connection_id = n.id)
  FROM automation.account_tasks t
  JOIN integrations.connections n ON n.id = t.connection_id
  JOIN core.organizations o ON o.id = t.organization_id
  WHERE p_tarefa_id IS NOT NULL AND p_coleta_id IS NULL AND t.id = p_tarefa_id;
$$;

COMMENT ON FUNCTION integrations.resolver_conexao_do_token IS
  'Travessia de tenant do cofre de tokens (ADR 0032), no molde de automation.resolve_coleta_contexto: o worker só apresenta um identificador que o próprio servidor emitiu (coletaId de abrir_coleta ou tarefaId de task_queue) e recebe de volta só ponteiros e estados, nunca segredo. O serviço exige origem em execução, fonte e tenant ativos e conexão ativa antes de decifrar.';

DROP FUNCTION IF EXISTS integrations.tokens_a_renovar(timestamptz, integer);

CREATE FUNCTION integrations.tokens_a_renovar(p_antes timestamptz, p_limite integer DEFAULT 50)
RETURNS TABLE (connection_id uuid, organization_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT t.connection_id, t.organization_id
  FROM integrations.connection_tokens t
  JOIN integrations.connections n ON n.id = t.connection_id
  JOIN core.organizations o ON o.id = t.organization_id
  WHERE t.tipo = 'oauth_long_lived'
    AND t.segredo_expira_em IS NOT NULL
    AND t.segredo_expira_em < p_antes
    AND n.status IN ('active', 'expiring', 'degraded')
    AND o.status::text = 'active'
  ORDER BY t.segredo_expira_em
  LIMIT greatest(least(p_limite, 200), 1);
$$;

COMMENT ON FUNCTION integrations.tokens_a_renovar IS
  'Varredura proativa do cofre (ADR 0032): conexões com segredo de longa duração (Meta) perto do fim. Só devolve ponteiros; a renovação acontece dentro do tenant, com trava de linha.';

COMMIT;

BEGIN;

DO $$
DECLARE
  papel_app text := (SELECT rolname FROM pg_roles WHERE rolname IN ('orla_app', 'tria_app') ORDER BY rolname = 'orla_app' DESC LIMIT 1);
BEGIN
  REVOKE ALL ON integrations.connection_tokens FROM PUBLIC;
  REVOKE ALL ON FUNCTION integrations.resolver_conexao_do_token(uuid, uuid) FROM PUBLIC;
  REVOKE ALL ON FUNCTION integrations.tokens_a_renovar(timestamptz, integer) FROM PUBLIC;

  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON integrations.connection_tokens TO %I', papel_app);

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orla_worker') THEN
    RAISE EXCEPTION 'papel orla_worker ausente; a 0070 precisa ter rodado antes';
  END IF;
  EXECUTE format('REVOKE ALL ON FUNCTION integrations.resolver_conexao_do_token(uuid, uuid) FROM %I', papel_app);
  EXECUTE format('REVOKE ALL ON FUNCTION integrations.tokens_a_renovar(timestamptz, integer) FROM %I', papel_app);
  GRANT EXECUTE ON FUNCTION integrations.resolver_conexao_do_token(uuid, uuid) TO orla_worker;
  GRANT EXECUTE ON FUNCTION integrations.tokens_a_renovar(timestamptz, integer) TO orla_worker;
END $$;

COMMIT;
