BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'core' AND table_name = 'client_brain_performance' AND column_name = 'chave'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'core' AND table_name = 'client_brain_performance' AND column_name = 'item'
  ) THEN
    ALTER TABLE core.client_brain_performance RENAME COLUMN chave TO item;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'core.client_brain_performance'::regclass AND conname = 'client_brain_performance_chave'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'core.client_brain_performance'::regclass AND conname = 'client_brain_performance_item'
  ) THEN
    ALTER TABLE core.client_brain_performance RENAME CONSTRAINT client_brain_performance_chave TO client_brain_performance_item;
  END IF;
END $$;

COMMENT ON COLUMN core.client_brain_performance.item IS
  'Identificador da fatia no recorte (id da campanha, região, faixa etária e gênero etc.). Vazio no recorte total.';

COMMIT;
