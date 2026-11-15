BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tria_app')
     AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orla_app') THEN
    ALTER ROLE tria_app RENAME TO orla_app;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tria_worker')
     AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orla_worker') THEN
    ALTER ROLE tria_worker RENAME TO orla_worker;
  END IF;
END $$;

COMMIT;
