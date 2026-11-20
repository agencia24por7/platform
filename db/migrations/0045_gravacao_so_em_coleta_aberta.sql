BEGIN;

DO $$
BEGIN
  PERFORM set_config(
    'coleta.papel_app',
    (SELECT rolname FROM pg_roles WHERE rolname IN ('orla_app', 'tria_app') ORDER BY rolname = 'orla_app' DESC LIMIT 1),
    true
  );
END $$;

DROP FUNCTION IF EXISTS automation.resolve_coleta_contexto(uuid);

CREATE FUNCTION automation.resolve_coleta_contexto(p_coleta_id uuid)
RETURNS TABLE (
  organization_id  uuid,
  client_id        uuid,
  platform         text,
  external_id      text,
  currency         char(3),
  coleta_status    text,
  cliente_excluido boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT c.organization_id, c.client_id, c.platform::text, a.external_id, a.currency, c.status::text,
         cl.id IS NULL OR cl.excluido_em IS NOT NULL
  FROM automation.coletas c
  JOIN integrations.ad_accounts a ON a.id = c.ad_account_id
  LEFT JOIN core.clients cl ON cl.id = c.client_id
  WHERE c.id = p_coleta_id AND c.fonte_tipo = 'ad_account'

  UNION ALL

  SELECT c.organization_id, c.client_id, c.platform::text, ca.external_id, ca.currency, c.status::text,
         cl.id IS NULL OR cl.excluido_em IS NOT NULL
  FROM automation.coletas c
  JOIN integrations.connection_accounts ca ON ca.id = c.connection_account_id
  LEFT JOIN core.clients cl ON cl.id = c.client_id
  WHERE c.id = p_coleta_id AND c.fonte_tipo = 'connection_account';
$$;

COMMENT ON FUNCTION automation.resolve_coleta_contexto IS
  'Resolve organização/cliente/plataforma/externalId a partir só da coleta_id, para o worker gravar no BigQuery sem nunca confiar em tenant vindo do corpo da requisição — lá não existe RLS, então quem garante o isolamento é sempre o servidor resolvendo a partir de um identificador que ele mesmo emitiu (o coletaId devolvido por abrir_coleta). Devolve também o status da coleta e se o cliente foi excluído: o serviço só grava em coleta running de cliente não excluído (ADR 0023).';

REVOKE ALL ON FUNCTION automation.resolve_coleta_contexto(uuid) FROM PUBLIC;

DO $$ BEGIN
  EXECUTE format('GRANT EXECUTE ON FUNCTION automation.resolve_coleta_contexto(uuid) TO %I', current_setting('coleta.papel_app'));
END $$;

COMMIT;
