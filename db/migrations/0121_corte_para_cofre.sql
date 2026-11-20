BEGIN;

DO $$
BEGIN
  PERFORM set_config(
    'tokens.papel_app',
    (SELECT rolname FROM pg_roles WHERE rolname IN ('orla_app', 'tria_app') ORDER BY rolname = 'orla_app' DESC LIMIT 1),
    true
  );
END $$;

CREATE TABLE IF NOT EXISTS integrations.corte_para_cofre_refs (
  connection_id    uuid PRIMARY KEY,
  organization_id  uuid NOT NULL,
  platform         text NOT NULL,
  status_anterior  text NOT NULL,
  credential_ref   text,
  coletor_ref      text,
  executor_ref     text,
  capturado_em     timestamptz NOT NULL DEFAULT now(),
  limpo_em         timestamptz
);

COMMENT ON TABLE integrations.corte_para_cofre_refs IS
  'Estado do corte para o cofre de tokens (ADR 0032): os ponteiros do n8n de cada conexão no instante do corte. É a fonte de verdade do script de limpeza do n8n (scripts/n8n-limpar-legado.mjs), que marca limpo_em por conexão. Sem chave estrangeira de propósito: a linha sobrevive à remoção da conexão para que a limpeza do n8n não perca o ponteiro. Some numa migração posterior, depois da verificação.';

REVOKE ALL ON integrations.corte_para_cofre_refs FROM PUBLIC;

INSERT INTO integrations.corte_para_cofre_refs
  (connection_id, organization_id, platform, status_anterior, credential_ref, coletor_ref, executor_ref)
SELECT n.id, n.organization_id, n.platform::text, n.status::text, n.credential_ref, n.coletor_ref, n.executor_ref
FROM integrations.connections n
WHERE NOT EXISTS (SELECT 1 FROM integrations.connection_tokens t WHERE t.connection_id = n.id)
ON CONFLICT (connection_id) DO NOTHING;

INSERT INTO audit.audit_log (organization_id, actor_type, action, target_type, target_id, metadata)
SELECT r.organization_id, 'system', 'connection.corte_para_cofre', 'connection', r.connection_id::text,
       jsonb_build_object(
         'status_anterior', r.status_anterior,
         'plataforma', r.platform,
         'tinha_credencial_n8n', r.credential_ref IS NOT NULL AND r.credential_ref LIKE 'n8n:credential:%',
         'tinha_coletor', r.coletor_ref IS NOT NULL,
         'tinha_executor', r.executor_ref IS NOT NULL)
FROM integrations.corte_para_cofre_refs r
WHERE NOT EXISTS (
  SELECT 1 FROM audit.audit_log l
  WHERE l.action = 'connection.corte_para_cofre' AND l.target_id = r.connection_id::text);

ALTER TABLE integrations.connections ALTER COLUMN credential_ref DROP NOT NULL;

COMMENT ON COLUMN integrations.connections.credential_ref IS
  'DEPRECADA desde o corte para o cofre (ADR 0032): sempre nula. O segredo vive em integrations.connection_tokens. A coluna sai na 0122.';

UPDATE integrations.connections n
SET status = CASE WHEN n.status = 'revoked' THEN n.status ELSE 'reauth_pending' END,
    credential_ref = NULL,
    coletor_ref = NULL,
    executor_ref = NULL
WHERE NOT EXISTS (SELECT 1 FROM integrations.connection_tokens t WHERE t.connection_id = n.id);

UPDATE automation.account_tasks t
SET status = 'failed', outcome = 'corte_para_cofre: reautorize a conexão e peça de novo'
WHERE t.status IN ('pending', 'running');

CREATE OR REPLACE FUNCTION integrations.conexao_ativa_exige_token()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.status IN ('active', 'expiring', 'degraded')
     AND NOT EXISTS (SELECT 1 FROM integrations.connection_tokens t WHERE t.connection_id = NEW.id) THEN
    RAISE EXCEPTION 'conexão % ativa sem token no cofre', NEW.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;

COMMENT ON FUNCTION integrations.conexao_ativa_exige_token IS
  'Modo único do cofre (ADR 0032): conexão ativa sem linha em connection_tokens é estado inválido. Gatilho de restrição adiado para o fim da transação, para a autorização gravar conexão e token juntos.';

DROP TRIGGER IF EXISTS conexao_ativa_exige_token ON integrations.connections;
CREATE CONSTRAINT TRIGGER conexao_ativa_exige_token
  AFTER INSERT OR UPDATE OF status ON integrations.connections
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION integrations.conexao_ativa_exige_token();

COMMIT;
