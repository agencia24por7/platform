BEGIN;

DROP FUNCTION IF EXISTS integrations.tokens_com_chave_antiga(text, integer);

CREATE FUNCTION integrations.tokens_com_chave_antiga(p_versao_primaria text, p_limite integer DEFAULT 50)
RETURNS TABLE (connection_id uuid, organization_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT t.connection_id, t.organization_id
  FROM integrations.connection_tokens t
  WHERE t.kms_key_version <> p_versao_primaria
     OR (t.access_kms_key_version IS NOT NULL AND t.access_kms_key_version <> p_versao_primaria)
  ORDER BY t.updated_at
  LIMIT greatest(least(p_limite, 200), 1);
$$;

COMMENT ON FUNCTION integrations.tokens_com_chave_antiga IS
  'Varredura de recifragem do cofre (ADR 0042): conexões cujo segredo ou token de acesso foi selado com uma versão da chave diferente da primária. Só devolve ponteiros; a recifragem acontece dentro do tenant, com trava de linha.';

DO $$
DECLARE
  papel_app text := (SELECT rolname FROM pg_roles WHERE rolname IN ('orla_app', 'tria_app') ORDER BY rolname = 'orla_app' DESC LIMIT 1);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orla_worker') THEN
    RAISE EXCEPTION 'papel orla_worker ausente; a 0070 precisa ter rodado antes';
  END IF;
  REVOKE ALL ON FUNCTION integrations.tokens_com_chave_antiga(text, integer) FROM PUBLIC;
  EXECUTE format('REVOKE ALL ON FUNCTION integrations.tokens_com_chave_antiga(text, integer) FROM %I', papel_app);
  GRANT EXECUTE ON FUNCTION integrations.tokens_com_chave_antiga(text, integer) TO orla_worker;
END $$;

COMMIT;
