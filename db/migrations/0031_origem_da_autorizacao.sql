BEGIN;

ALTER TABLE integrations.connections
  ADD COLUMN authorized_via text NOT NULL DEFAULT 'staff'
    CHECK (authorized_via IN ('staff', 'invite'));

COMMENT ON COLUMN integrations.connections.authorized_via IS
  'staff é quem tem sessão na Orla; invite é o próprio cliente, pelo link de convite. Existe porque Google Ads e Meta Ads entraram no convite por link: sem isso, uma conexão que o cliente autorizou sozinho (a conta de anúncio dele) seria indistinguível de uma conexão que a equipe autorizou com a credencial administradora da agência — e código como o pedido de acesso Meta Partner ou o link para a MCC do Google Ads precisa necessariamente da segunda, nunca da primeira. Fixo no momento em que a conexão nasce; renovar (renew) não muda quem autorizou da primeira vez.';

COMMIT;
