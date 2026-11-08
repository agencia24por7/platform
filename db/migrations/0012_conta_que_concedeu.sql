BEGIN;

ALTER TABLE integrations.connections
  ADD COLUMN account_email text
  CHECK (account_email IS NULL OR position('@' in account_email) > 1);

COMMENT ON COLUMN integrations.connections.account_email IS
  'E-mail da conta que concedeu o acesso. Guardado para que a agência saiba de qual conta veio cada autorização ao gerenciar várias.';

COMMIT;
