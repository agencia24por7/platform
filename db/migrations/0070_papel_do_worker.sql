BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orla_app') THEN
    RAISE EXCEPTION 'papel orla_app ausente; a 0034 precisa ter rodado antes';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orla_worker') THEN
    CREATE ROLE orla_worker LOGIN;
  END IF;

  EXECUTE format('GRANT CONNECT ON DATABASE %I TO orla_worker', current_database());
END $$;

ALTER ROLE orla_worker WITH LOGIN INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;

GRANT orla_app TO orla_worker;

COMMENT ON ROLE orla_worker IS
  'Rotas /api/v0 (n8n). Herda orla_app (políticas RLS TO orla_app valem para membros) e é o único a executar as funções SECURITY DEFINER de automation, core.aplicar_retencao e as filas do brain de contexto (core.contexto_brains_pendentes, core.contexto_clientes_para_reconstruir), que atravessam inquilinos. Senha sincronizada pelo migrar.sh a partir de WORKER_DB_PASSWORD. ADR 0028.';

DO $$
DECLARE
  funcao regprocedure;
BEGIN
  FOR funcao IN
    SELECT p.oid::regprocedure
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE p.prosecdef
       AND p.prorettype <> 'trigger'::regtype
       AND (
         n.nspname = 'automation'
         OR (n.nspname = 'core' AND p.proname IN ('aplicar_retencao', 'contexto_brains_pendentes', 'contexto_clientes_para_reconstruir'))
       )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', funcao);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM orla_app', funcao);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO orla_worker', funcao);
  END LOOP;
END $$;

COMMIT;
