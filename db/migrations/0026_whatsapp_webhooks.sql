BEGIN;

ALTER TABLE integrations.connections ADD COLUMN webhook_token text UNIQUE;

COMMENT ON COLUMN integrations.connections.webhook_token IS
  'Segredo de alta entropia exigido na URL do webhook (ex.: Z-API). Só a conexão que o possui pode gravar eventos — o id da conexão sozinho não basta, porque pode vazar em log, print ou configuração copiada.';

CREATE TABLE integrations.whatsapp_inbound_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id  uuid REFERENCES integrations.connections(id) ON DELETE SET NULL,
  source         text NOT NULL CHECK (source IN ('zapi', 'cloud_api')),
  external_ref   text NOT NULL CHECK (length(external_ref) BETWEEN 1 AND 128),
  payload        jsonb NOT NULL,
  received_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX whatsapp_inbound_events_connection_idx ON integrations.whatsapp_inbound_events (connection_id, received_at);
CREATE INDEX whatsapp_inbound_events_pending_idx ON integrations.whatsapp_inbound_events (source, external_ref, received_at) WHERE connection_id IS NULL;

COMMENT ON TABLE integrations.whatsapp_inbound_events IS
  'Entrada crua do webhook do WhatsApp (Z-API ou Cloud API), antes de qualquer leitura de clid ou casamento com lead. Nenhuma política de RLS concede acesso direto: só as funções abaixo tocam a tabela. O processamento (extrair referral/ctwa_clid, casar com o cliente) é a próxima fase.';

ALTER TABLE integrations.whatsapp_inbound_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations.whatsapp_inbound_events FORCE ROW LEVEL SECURITY;

CREATE FUNCTION integrations.resolve_webhook_connection(p_token text, p_platform integrations.platform)
RETURNS TABLE (connection_id uuid, status integrations.connection_status)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT id, status
  FROM integrations.connections
  WHERE webhook_token = p_token AND platform = p_platform;
$$;

COMMENT ON FUNCTION integrations.resolve_webhook_connection IS
  'Única travessia de tenant do sistema. Resolve pelo segredo da URL, nunca pelo id da conexão — um id vazado não basta pra gravar evento. Confirma a plataforma esperada e nunca devolve segredo nem dado de outra plataforma.';

REVOKE ALL ON FUNCTION integrations.resolve_webhook_connection(text, integrations.platform) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION integrations.resolve_webhook_connection(text, integrations.platform) TO tria_app;

CREATE FUNCTION integrations.record_whatsapp_inbound(
  p_connection_id uuid,
  p_source text,
  p_external_ref text,
  p_payload jsonb
)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  INSERT INTO integrations.whatsapp_inbound_events (connection_id, source, external_ref, payload)
  VALUES (p_connection_id, p_source, p_external_ref, p_payload)
  RETURNING id;
$$;

COMMENT ON FUNCTION integrations.record_whatsapp_inbound IS
  'Única travessia de tenant do sistema. Grava o evento cru do webhook — connection_id pode vir nulo quando ainda não foi possível casar o phone_number_id da Cloud API a um cliente; isso é resolvido na próxima fase, não aqui.';

REVOKE ALL ON FUNCTION integrations.record_whatsapp_inbound(uuid, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION integrations.record_whatsapp_inbound(uuid, text, text, jsonb) TO tria_app;

COMMIT;
