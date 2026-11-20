BEGIN;

DO $$
BEGIN
  PERFORM set_config(
    'sessao.papel_app',
    (SELECT rolname FROM pg_roles WHERE rolname IN ('orla_app', 'tria_app') ORDER BY rolname = 'orla_app' DESC LIMIT 1),
    true
  );
END $$;

ALTER TABLE core.users ADD COLUMN IF NOT EXISTS sessoes_validas_desde timestamptz;

COMMENT ON COLUMN core.users.sessoes_validas_desde IS
  'Sessões emitidas antes deste instante são recusadas. O logout e a anonimização do titular gravam now(): a sessão é um HMAC sem estado e, sem isso, um token copiado valeria até expirar (12h).';

CREATE OR REPLACE FUNCTION core.encerrar_sessoes(p_usuario uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
VOLATILE
AS $$
  UPDATE core.users SET sessoes_validas_desde = now() WHERE id = p_usuario;
$$;

REVOKE ALL ON FUNCTION core.encerrar_sessoes(uuid) FROM PUBLIC;
DO $$ BEGIN
  EXECUTE format('GRANT EXECUTE ON FUNCTION core.encerrar_sessoes(uuid) TO %I', current_setting('sessao.papel_app'));
END $$;

CREATE OR REPLACE FUNCTION core.sessao_valida(p_usuario uuid, p_emitida_em timestamptz)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM core.users
     WHERE id = p_usuario AND (sessoes_validas_desde IS NULL OR sessoes_validas_desde <= p_emitida_em)
  );
$$;

COMMENT ON FUNCTION core.sessao_valida IS
  'Para quem confere uma sessão sem o cookie principal (a portaria do n8n): o usuário existe e a sessão não foi encerrada.';

REVOKE ALL ON FUNCTION core.sessao_valida(uuid, timestamptz) FROM PUBLIC;
DO $$ BEGIN
  EXECUTE format('GRANT EXECUTE ON FUNCTION core.sessao_valida(uuid, timestamptz) TO %I', current_setting('sessao.papel_app'));
END $$;

CREATE OR REPLACE FUNCTION core.anonimizar_titular_e_encerrar(p_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
VOLATILE
AS $$
BEGIN
  UPDATE core.users SET sessoes_validas_desde = now() WHERE lower(email) = lower(p_email);
  RETURN core.anonimizar_titular(p_email);
END;
$$;

COMMENT ON FUNCTION core.anonimizar_titular_e_encerrar IS
  'Encerra as sessões abertas do titular e anonimiza. É o que scripts/titular.mjs chama.';

REVOKE ALL ON FUNCTION core.anonimizar_titular_e_encerrar(text) FROM PUBLIC;

COMMIT;
