ALTER TYPE integrations.platform ADD VALUE IF NOT EXISTS 'rdstation';
ALTER TYPE integrations.platform ADD VALUE IF NOT EXISTS 'apify';
ALTER TYPE integrations.grant_type ADD VALUE IF NOT EXISTS 'api_key';

COMMENT ON TYPE integrations.platform IS
  'Fornecedores conectaveis. Nem todo fornecedor tem conta de anuncio: rdstation e apify entram como conexao e nao produzem metrica.';

COMMENT ON TYPE integrations.grant_type IS
  'Como a autorizacao foi obtida. api_key cobre o fornecedor que nao fala OAuth: a chave vai direto para o cofre e o banco guarda so a referencia.';
