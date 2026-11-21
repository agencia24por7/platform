BEGIN;

DO $$
BEGIN
  PERFORM set_config(
    'privacidade.papel_app',
    (SELECT rolname FROM pg_roles WHERE rolname IN ('orla_app', 'tria_app') ORDER BY rolname = 'orla_app' DESC LIMIT 1),
    true
  );
END $$;

CREATE OR REPLACE FUNCTION privacidade.registrar_pedido_de_exclusao_meta(
  p_usuario_hash text,
  p_hashes_anteriores text[],
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
  v_anteriores text[] := coalesce(p_hashes_anteriores, '{}');
BEGIN
  IF p_usuario_hash IS NULL OR p_usuario_hash !~ '^[0-9a-f]{64}$'
     OR EXISTS (SELECT 1 FROM unnest(v_anteriores) h WHERE h IS NULL OR h !~ '^[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'pseudônimo inválido';
  END IF;

  UPDATE privacidade.pedidos_de_exclusao p
     SET usuario_externo_hash = p_usuario_hash, atualizado_em = now()
   WHERE p.origem = 'meta' AND p.usuario_externo_hash = ANY (v_anteriores)
     AND p.usuario_externo_hash <> p_usuario_hash
     AND NOT EXISTS (
       SELECT 1 FROM privacidade.pedidos_de_exclusao q
        WHERE q.origem = 'meta' AND q.usuario_externo_hash = p_usuario_hash AND q.status <> 'concluido'
          AND p.status <> 'concluido');

  RETURN QUERY SELECT * FROM privacidade.registrar_pedido_de_exclusao_meta(p_usuario_hash, p_usuario_externo, p_codigo);
END;
$$;

COMMENT ON FUNCTION privacidade.registrar_pedido_de_exclusao_meta(text, text[], text, text) IS
  'Callback de exclusão da Meta com a pimenta dedicada (META_EXCLUSAO_PEPPER, ADR 0033). p_hashes_anteriores são os pseudônimos do mesmo usuário pela derivação antiga (TRIA_SESSION_SECRET): pedido gravado com eles é migrado para o pseudônimo novo antes de decidir se há pedido aberto, e a idempotência sobrevive à troca do segredo de sessão.';

REVOKE ALL ON FUNCTION privacidade.registrar_pedido_de_exclusao_meta(text, text[], text, text) FROM PUBLIC;

DO $$ BEGIN
  EXECUTE format('GRANT EXECUTE ON FUNCTION privacidade.registrar_pedido_de_exclusao_meta(text, text[], text, text) TO %I',
    current_setting('privacidade.papel_app'));
END $$;

COMMENT ON TABLE privacidade.pedidos_de_exclusao IS
  'Pedidos de exclusão de dados recebidos pelo callback da Meta (POST /api/meta/exclusao). Guarda só o pseudônimo do usuário (HMAC-SHA256 com a pimenta META_EXCLUSAO_PEPPER; pedidos antigos, com o segredo de sessão, migram no próximo aviso), nunca o id da Meta. Um pedido aberto por usuário: um segundo aviso devolve o mesmo código (ADR 0029, 0033).';

COMMIT;
