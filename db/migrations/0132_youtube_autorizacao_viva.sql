BEGIN;

DO $$
BEGIN
  PERFORM set_config(
    'privacidade.papel_app',
    (SELECT rolname FROM pg_roles WHERE rolname IN ('orla_app', 'tria_app') ORDER BY rolname = 'orla_app' DESC LIMIT 1),
    true
  );
  PERFORM set_config(
    'privacidade.papel_worker',
    coalesce((SELECT rolname FROM pg_roles WHERE rolname = 'orla_worker'), current_setting('privacidade.papel_app')),
    true
  );
END $$;

ALTER TABLE integrations.connections ADD COLUMN IF NOT EXISTS status_desde timestamptz;
UPDATE integrations.connections SET status_desde = updated_at WHERE status_desde IS NULL;
ALTER TABLE integrations.connections ALTER COLUMN status_desde SET DEFAULT now();
ALTER TABLE integrations.connections ALTER COLUMN status_desde SET NOT NULL;

COMMENT ON COLUMN integrations.connections.status_desde IS
  'Quando a conexão entrou no status atual (gatilho connections_status_desde). Mede a carência de 30 dias de reauth_pending e degraded antes de o canal do YouTube contar como sem autorização (ADR 0033).';

CREATE OR REPLACE FUNCTION integrations.marcar_status_desde()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_desde := now();
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION integrations.marcar_status_desde() FROM PUBLIC;

DROP TRIGGER IF EXISTS connections_status_desde ON integrations.connections;
CREATE TRIGGER connections_status_desde BEFORE INSERT OR UPDATE ON integrations.connections
  FOR EACH ROW EXECUTE FUNCTION integrations.marcar_status_desde();

CREATE OR REPLACE FUNCTION privacidade.conexao_no_corte(p_connection uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
BEGIN
  IF to_regclass('integrations.corte_para_cofre_refs') IS NULL THEN
    RETURN false;
  END IF;
  RETURN EXISTS (SELECT 1 FROM integrations.corte_para_cofre_refs r
                  WHERE r.connection_id = p_connection AND r.status_anterior <> 'revoked');
END;
$$;

COMMENT ON FUNCTION privacidade.conexao_no_corte IS
  'A conexão foi capturada no corte para o cofre (ADR 0032) sem estar revogada. Devolve false quando a tabela do corte já não existe.';

REVOKE ALL ON FUNCTION privacidade.conexao_no_corte(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION privacidade.corte_do_cofre_em_andamento()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
BEGIN
  IF to_regclass('integrations.corte_para_cofre_refs') IS NULL THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1
      FROM integrations.corte_para_cofre_refs r
      JOIN integrations.connections c ON c.id = r.connection_id
     WHERE r.status_anterior <> 'revoked' AND c.status = 'reauth_pending');
END;
$$;

COMMENT ON FUNCTION privacidade.corte_do_cofre_em_andamento IS
  'Corte para o cofre (ADR 0032) em andamento: alguma conexão capturada no corte, que não estava revogada, ainda espera reautorização. Enquanto for verdade, o job do YouTube não enfileira nem executa expurgo por falta de autorização (ADR 0033): o corte põe todas as conexões em reauth_pending de uma vez.';

REVOKE ALL ON FUNCTION privacidade.corte_do_cofre_em_andamento() FROM PUBLIC;

CREATE OR REPLACE FUNCTION privacidade.autorizacao_viva(p_status integrations.connection_status, p_status_desde timestamptz, p_connection uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT CASE
    WHEN p_status IN ('active', 'expiring') THEN true
    WHEN p_status IN ('reauth_pending', 'degraded') THEN
      p_status_desde > now() - interval '30 days'
      OR (p_status = 'reauth_pending' AND privacidade.conexao_no_corte(p_connection))
    ELSE false
  END;
$$;

COMMENT ON FUNCTION privacidade.autorizacao_viva IS
  'Se uma conexão ainda conta como autorização do usuário para o YouTube (ADR 0033): active e expiring sempre; reauth_pending e degraded por 30 dias desde que entraram no status (o usuário pode reautorizar) e, a conexão capturada no corte do cofre, enquanto não for reautorizada ou revogada. revoked e conexão removida nunca contam.';

REVOKE ALL ON FUNCTION privacidade.autorizacao_viva(integrations.connection_status, timestamptz, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION privacidade.canal_autorizado(p_organizacao uuid, p_external_id text, p_exceto uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM integrations.connection_accounts o
      JOIN integrations.connections c ON c.id = o.connection_id
     WHERE o.organization_id = p_organizacao AND o.platform::text = 'youtube' AND o.external_id = p_external_id
       AND (p_exceto IS NULL OR o.connection_id <> p_exceto)
       AND privacidade.autorizacao_viva(c.status, c.status_desde, c.id));
$$;

REVOKE ALL ON FUNCTION privacidade.canal_autorizado(uuid, text, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION privacidade.enfileirar_expurgo_da_conexao(p_connection uuid)
RETURNS TABLE (id uuid, organization_id uuid, platform text, external_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
VOLATILE
AS $$
#variable_conflict use_column
DECLARE
  v_organizacao uuid := core.current_organization();
BEGIN
  IF v_organizacao IS NULL OR NOT EXISTS (
    SELECT 1 FROM integrations.connections c WHERE c.id = p_connection AND c.organization_id = v_organizacao
  ) THEN
    RAISE EXCEPTION 'conexão % não é da organização do contexto', p_connection;
  END IF;

  INSERT INTO privacidade.expurgos_de_fonte AS e (organization_id, platform, external_id, motivo, apos)
  SELECT DISTINCT ca.organization_id, ca.platform::text, ca.external_id, 'conexao_removida', now()
    FROM integrations.connection_accounts ca
   WHERE ca.connection_id = p_connection
     AND ca.platform::text = 'youtube'
     AND NOT privacidade.canal_autorizado(ca.organization_id, ca.external_id, p_connection)
  ON CONFLICT (organization_id, platform, external_id) WHERE concluido_em IS NULL AND cancelado_em IS NULL
  DO UPDATE SET apos = LEAST(e.apos, EXCLUDED.apos), motivo = EXCLUDED.motivo;

  UPDATE integrations.connection_accounts ca
     SET name = ca.external_id
   WHERE ca.connection_id = p_connection AND ca.platform::text = 'youtube' AND ca.name <> ca.external_id;

  RETURN QUERY
  SELECT e.id, e.organization_id, e.platform, e.external_id
    FROM privacidade.expurgos_de_fonte e
   WHERE e.organization_id = v_organizacao AND e.concluido_em IS NULL AND e.cancelado_em IS NULL
     AND e.platform = 'youtube'
     AND e.external_id IN (SELECT ca.external_id FROM integrations.connection_accounts ca WHERE ca.connection_id = p_connection);
END;
$$;

COMMENT ON FUNCTION privacidade.enfileirar_expurgo_da_conexao IS
  'removerConexao (ADR 0029, 0033): enfileira o expurgo dos canais do YouTube da conexão que nenhuma outra conexão da organização ainda autoriza (privacidade.autorizacao_viva), troca o nome do canal pelo id e devolve os expurgos abertos para o app tentar na hora.';

CREATE OR REPLACE FUNCTION privacidade.preparar_conformidade_youtube()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
VOLATILE
AS $$
DECLARE
  v_nomes integer;
  v_enfileirados integer := 0;
  v_cancelados integer;
  v_corte boolean := privacidade.corte_do_cofre_em_andamento();
BEGIN
  UPDATE integrations.connection_accounts
     SET name = external_id
   WHERE platform::text = 'youtube' AND discovered_at < now() - interval '30 days' AND name <> external_id;
  GET DIAGNOSTICS v_nomes = ROW_COUNT;

  UPDATE privacidade.expurgos_de_fonte e
     SET cancelado_em = now()
   WHERE e.concluido_em IS NULL AND e.cancelado_em IS NULL AND e.motivo = 'sem_autorizacao_ativa'
     AND privacidade.canal_autorizado(e.organization_id, e.external_id, NULL);
  GET DIAGNOSTICS v_cancelados = ROW_COUNT;

  IF NOT v_corte THEN
    INSERT INTO privacidade.expurgos_de_fonte (organization_id, platform, external_id, motivo, apos)
    SELECT f.organization_id, 'youtube', f.external_id, 'sem_autorizacao_ativa', now() + interval '7 days'
      FROM (
        SELECT ca.organization_id, ca.external_id, max(ca.discovered_at) AS visto_em
          FROM integrations.connection_accounts ca
         WHERE ca.platform::text = 'youtube'
         GROUP BY ca.organization_id, ca.external_id
      ) f
     WHERE NOT privacidade.canal_autorizado(f.organization_id, f.external_id, NULL)
       AND NOT EXISTS (
         SELECT 1 FROM privacidade.expurgos_de_fonte e
          WHERE e.organization_id = f.organization_id AND e.platform = 'youtube' AND e.external_id = f.external_id
            AND ((e.concluido_em IS NULL AND e.cancelado_em IS NULL) OR e.concluido_em >= f.visto_em))
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_enfileirados = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('nomesTrocadosPeloId', v_nomes, 'enfileirados', v_enfileirados, 'cancelados', v_cancelados,
                            'pausadoPeloCorte', v_corte);
END;
$$;

COMMENT ON FUNCTION privacidade.preparar_conformidade_youtube IS
  'Job diário do YouTube (ADR 0029, 0033), lado Postgres: troca pelo id o nome de canal não renovado há 30 dias, cancela expurgo de canal que voltou a ter autorização viva e enfileira, com 7 dias de carência, canal sem autorização viva (reauth_pending e degraded têm 30 dias de carência antes disso). Com o corte do cofre em andamento não enfileira nada (pausadoPeloCorte).';

CREATE OR REPLACE FUNCTION privacidade.expurgos_de_fonte_vencidos(p_limite integer)
RETURNS TABLE (id uuid, organization_id uuid, platform text, external_id text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT e.id, e.organization_id, e.platform, e.external_id
    FROM privacidade.expurgos_de_fonte e
   WHERE e.concluido_em IS NULL AND e.cancelado_em IS NULL AND e.apos <= now()
     AND (e.motivo <> 'sem_autorizacao_ativa'
          OR (NOT privacidade.corte_do_cofre_em_andamento()
              AND NOT privacidade.canal_autorizado(e.organization_id, e.external_id, NULL)))
   ORDER BY e.apos, e.id
   LIMIT least(greatest(coalesce(p_limite, 50), 1), 500);
$$;

COMMENT ON FUNCTION privacidade.expurgos_de_fonte_vencidos IS
  'Expurgos vencidos a executar. O de sem_autorizacao_ativa é conferido de novo na hora: canal que voltou a ter autorização viva, ou corte do cofre em andamento, não sai (ADR 0033).';

UPDATE privacidade.expurgos_de_fonte e
   SET cancelado_em = now()
 WHERE e.concluido_em IS NULL AND e.cancelado_em IS NULL AND e.motivo = 'sem_autorizacao_ativa'
   AND privacidade.canal_autorizado(e.organization_id, e.external_id, NULL);

REVOKE ALL ON FUNCTION privacidade.preparar_conformidade_youtube() FROM PUBLIC;
REVOKE ALL ON FUNCTION privacidade.expurgos_de_fonte_vencidos(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION privacidade.enfileirar_expurgo_da_conexao(uuid) FROM PUBLIC;

DO $$ BEGIN
  EXECUTE format('GRANT EXECUTE ON FUNCTION privacidade.enfileirar_expurgo_da_conexao(uuid) TO %I', current_setting('privacidade.papel_app'));
  EXECUTE format('GRANT EXECUTE ON FUNCTION privacidade.preparar_conformidade_youtube() TO %I', current_setting('privacidade.papel_worker'));
  EXECUTE format('GRANT EXECUTE ON FUNCTION privacidade.expurgos_de_fonte_vencidos(integer) TO %I', current_setting('privacidade.papel_worker'));
END $$;

COMMIT;
