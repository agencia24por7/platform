BEGIN;

ALTER TYPE automation.task_kind ADD VALUE IF NOT EXISTS 'bm_partner_request';

COMMENT ON TYPE automation.task_kind IS
  'mcc_invite sai da administradora e cria o vínculo pendente. mcc_accept é feito com a credencial da conta convidada, porque o Google exige que quem aceita seja ela. bm_partner_request é o equivalente para Meta: pede acesso à conta de anúncio do cliente usando a credencial já conectada da agência, sem precisar de usuário de sistema.';

ALTER TABLE automation.account_tasks
  ADD COLUMN client_id uuid REFERENCES core.clients(id) ON DELETE SET NULL;

COMMENT ON COLUMN automation.account_tasks.client_id IS
  'Só preenchido em bm_partner_request: é o que permite mostrar o pedido na página do cliente. mcc_invite/mcc_accept continuam sem cliente — aparecem na página da conexão, antes de existir vínculo.';

COMMIT;
