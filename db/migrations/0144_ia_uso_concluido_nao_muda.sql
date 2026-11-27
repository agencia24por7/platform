BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION core.ai_usage_so_conclui_reserva() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF OLD.result <> 'reservada' OR NEW.result = 'reservada' THEN
    RAISE EXCEPTION 'linha de uso de IA concluida nao muda' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION core.ai_usage_so_conclui_reserva IS
  'A linha de uso só muda uma vez, de reservada para o desfecho (ADR 0058 §6). Depois disso ninguém zera tokens nem volta a reserva.';

DROP TRIGGER IF EXISTS ai_usage_so_conclui_reserva ON core.ai_usage;
CREATE TRIGGER ai_usage_so_conclui_reserva BEFORE UPDATE ON core.ai_usage
  FOR EACH ROW EXECUTE FUNCTION core.ai_usage_so_conclui_reserva();

COMMIT;
