ALTER TABLE integrations.connection_accounts
  ADD COLUMN client_id uuid REFERENCES core.clients(id) ON DELETE SET NULL;

COMMENT ON COLUMN integrations.connection_accounts.client_id IS
  'Vínculo direto a um cliente para recursos sem conta de anúncio (propriedade do GA4, contêiner do GTM, site do Search Console, canal do YouTube, local do GBP). Para contas de anúncio o vínculo continua passando por ad_account_id.';
