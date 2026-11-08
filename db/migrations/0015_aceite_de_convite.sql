BEGIN;

ALTER TYPE automation.task_kind ADD VALUE IF NOT EXISTS 'mcc_accept';

COMMENT ON TYPE automation.task_kind IS
  'mcc_invite sai da administradora e cria o vínculo pendente. mcc_accept é feito com a credencial da conta convidada, porque o Google exige que quem aceita seja ela.';

COMMIT;
