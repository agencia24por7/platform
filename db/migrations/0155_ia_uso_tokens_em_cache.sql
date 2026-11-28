BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE core.ai_usage
  ADD COLUMN IF NOT EXISTS cached_input_tokens integer NOT NULL DEFAULT 0 CHECK (cached_input_tokens >= 0);

COMMENT ON COLUMN core.ai_usage.cached_input_tokens IS
  'Parte de input_tokens que o fornecedor leu de cache de prompt (ADR 0076). Nunca maior que input_tokens. O teto diário continua somando input_tokens inteiro.';

DO $$
DECLARE
  papel text := (SELECT rolname FROM pg_roles WHERE rolname IN ('orla_app', 'tria_app') ORDER BY rolname = 'orla_app' DESC LIMIT 1);
BEGIN
  IF papel IS NULL THEN
    RAISE EXCEPTION 'papel do app ausente; as migracoes 0070 e anteriores precisam ter rodado';
  END IF;
  EXECUTE format('GRANT UPDATE (cached_input_tokens) ON core.ai_usage TO %I', papel);
END $$;

COMMIT;
