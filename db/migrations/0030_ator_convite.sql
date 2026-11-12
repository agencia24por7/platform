BEGIN;

ALTER TYPE audit.actor_type ADD VALUE IF NOT EXISTS 'invite';

COMMENT ON TYPE audit.actor_type IS
  'user é quem tem sessão na Orla. invite é o cliente agindo pela validade de um connection_invite, sem sessão nem conta — o actor_id correspondente é o id do item do convite, nunca um userId.';

COMMIT;
