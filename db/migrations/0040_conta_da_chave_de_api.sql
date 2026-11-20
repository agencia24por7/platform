BEGIN;

INSERT INTO integrations.connection_accounts
  (organization_id, connection_id, platform, external_id, name, currency, timezone, manager_external_id, inactive)
SELECT c.organization_id, c.id, c.platform, c.external_id, c.label, 'BRL', 'America/Sao_Paulo', NULL, false
FROM integrations.connections c
WHERE c.grant_type = 'api_key'
  AND c.platform IN ('rdstation', 'apify', 'zapi')
  AND c.status <> 'revoked'
ON CONFLICT (connection_id, external_id) DO NOTHING;

COMMIT;
