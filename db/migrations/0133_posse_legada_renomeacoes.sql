BEGIN;

CREATE OR REPLACE FUNCTION core.registrar_renomeacao_de_cliente()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    INSERT INTO audit.audit_log (organization_id, actor_type, action, target_type, target_id, metadata)
    VALUES (NEW.organization_id, 'system', 'client.renamed', 'client', NEW.id::text,
            jsonb_build_object('de', OLD.name, 'deId', NEW.id::text, 'para', NEW.name, 'paraId', NEW.id::text));
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION core.registrar_renomeacao_de_cliente IS
  'Toda troca de nome de cliente vira client.renamed na trilha, com o nome antigo e o novo amarrados ao id (ADR 0033). É a evidência que o preenchimento de posse legada usa para não atribuir linha antiga ao cliente que herdou o nome.';

REVOKE ALL ON FUNCTION core.registrar_renomeacao_de_cliente() FROM PUBLIC;

DROP TRIGGER IF EXISTS clients_registrar_renomeacao ON core.clients;
CREATE TRIGGER clients_registrar_renomeacao AFTER UPDATE OF name ON core.clients
  FOR EACH ROW EXECUTE FUNCTION core.registrar_renomeacao_de_cliente();

CREATE OR REPLACE FUNCTION automation.nomes_de_cliente_na_historia()
RETURNS TABLE (organization_id uuid, nome text, client_id uuid)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT c.organization_id, c.name, c.id FROM core.clients c
  UNION
  SELECT l.organization_id, l.metadata ->> 'name', (l.target_id)::uuid
    FROM audit.audit_log l
   WHERE l.organization_id IS NOT NULL AND l.target_type = 'client'
     AND l.action IN ('client.status_changed', 'client.create')
     AND jsonb_typeof(l.metadata) = 'object' AND jsonb_typeof(l.metadata -> 'name') = 'string'
     AND l.target_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  UNION
  SELECT l.organization_id, l.metadata ->> par.nome, (l.metadata ->> par.id)::uuid
    FROM audit.audit_log l
   CROSS JOIN (VALUES ('de', 'deId'), ('para', 'paraId'), ('cliente', 'clientId')) AS par(nome, id)
   WHERE l.organization_id IS NOT NULL
     AND jsonb_typeof(l.metadata) = 'object'
     AND NOT (l.metadata ? 'idsPreenchidosPela')
     AND jsonb_typeof(l.metadata -> par.nome) = 'string'
     AND (l.metadata ->> par.id) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
$$;

COMMENT ON FUNCTION automation.nomes_de_cliente_na_historia IS
  'Todo par (nome, cliente) conhecido na organização (ADR 0033): nome atual, nome gravado em client.status_changed e client.create, os dois lados de client.renamed e os pares nome+id das linhas de posse gravadas pelo app. Linhas que a própria 0080 preencheu não contam como evidência.';

REVOKE ALL ON FUNCTION automation.nomes_de_cliente_na_historia() FROM PUBLIC;

CREATE OR REPLACE FUNCTION automation.cliente_pelo_nome_na_historia(p_organizacao uuid, p_nome text, p_em timestamptz)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  WITH candidatos AS (
    SELECT DISTINCT h.client_id
      FROM automation.nomes_de_cliente_na_historia() h
     WHERE h.organization_id = p_organizacao AND h.nome = p_nome AND h.nome <> '[cliente expurgado]'
  )
  SELECT CASE WHEN count(*) = 1 THEN (array_agg(k.client_id))[1] END
    FROM candidatos k
   WHERE (SELECT count(*) FROM candidatos) = 1
     AND EXISTS (SELECT 1 FROM core.clients c WHERE c.id = k.client_id AND c.created_at <= p_em);
$$;

COMMENT ON FUNCTION automation.cliente_pelo_nome_na_historia IS
  'Dono de uma linha antiga da trilha pelo nome (ADR 0033): só quando, em toda a história da organização (nomes atuais, renomeações, status e pares gravados), o nome aponta para exatamente um cliente e esse cliente já existia no instante da linha. Nome que passou por outro cliente, ou cliente criado depois da linha, devolve NULL: dono desconhecido.';

REVOKE ALL ON FUNCTION automation.cliente_pelo_nome_na_historia(uuid, text, timestamptz) FROM PUBLIC;

CREATE OR REPLACE FUNCTION automation.corrigir_ids_de_posse_legados()
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public
VOLATILE
AS $$
DECLARE
  v_removidos integer := 0;
  v_preenchidos integer := 0;
  v_desconhecidos integer := 0;
  v_linha record;
  v_par record;
  v_esperado uuid;
  v_metadata jsonb;
  v_removidos_da_linha jsonb;
BEGIN
  FOR v_linha IN
    SELECT l.id, l.organization_id, l.occurred_at, l.metadata
      FROM audit.audit_log l
     WHERE l.action IN ('ad_account.reassigned', 'ad_account.unlinked', 'connection_account.reassigned',
                        'connection_account.unlink', 'connection_account.link')
       AND jsonb_typeof(l.metadata) = 'object'
       AND l.metadata ->> 'idsPreenchidosPela' = '0080'
       AND NOT (l.metadata ? 'idsRevistosPela')
     FOR UPDATE OF l
  LOOP
    v_metadata := v_linha.metadata;
    v_removidos_da_linha := '{}'::jsonb;
    FOR v_par IN SELECT * FROM (VALUES ('de', 'deId'), ('para', 'paraId'), ('cliente', 'clientId')) AS p(nome, id) LOOP
      IF jsonb_typeof(v_metadata -> v_par.nome) = 'string' AND v_metadata ? v_par.id THEN
        v_esperado := automation.cliente_pelo_nome_na_historia(v_linha.organization_id, v_metadata ->> v_par.nome, v_linha.occurred_at);
        IF v_esperado IS NULL OR v_esperado::text <> v_metadata ->> v_par.id THEN
          v_removidos_da_linha := v_removidos_da_linha || jsonb_build_object(v_par.id, v_metadata ->> v_par.id);
          v_metadata := v_metadata - v_par.id;
        END IF;
      END IF;
    END LOOP;
    IF v_removidos_da_linha <> '{}'::jsonb THEN
      v_removidos := v_removidos + 1;
      v_metadata := v_metadata || jsonb_build_object('idsRemovidosPela', '0133', 'idsRemovidos', v_removidos_da_linha);
    END IF;
    UPDATE audit.audit_log SET metadata = v_metadata || jsonb_build_object('idsRevistosPela', '0133') WHERE id = v_linha.id;
  END LOOP;

  FOR v_linha IN
    SELECT l.id, l.organization_id, l.occurred_at, l.metadata, l.action
      FROM audit.audit_log l
     WHERE l.action IN ('ad_account.reassigned', 'ad_account.unlinked', 'connection_account.reassigned',
                        'connection_account.unlink', 'connection_account.link')
       AND jsonb_typeof(l.metadata) = 'object'
       AND NOT (l.metadata ? 'posseDesconhecida')
     FOR UPDATE OF l
  LOOP
    v_metadata := v_linha.metadata;
    FOR v_par IN
      SELECT * FROM (VALUES ('de', 'deId'), ('para', 'paraId'), ('cliente', 'clientId')) AS p(nome, id)
       WHERE (p.id = 'deId' AND v_linha.action <> 'connection_account.link')
          OR (p.id = 'paraId' AND v_linha.action IN ('ad_account.reassigned', 'connection_account.reassigned'))
          OR (p.id = 'clientId' AND v_linha.action = 'connection_account.link')
    LOOP
      IF jsonb_typeof(v_metadata -> v_par.nome) = 'string' AND NOT (v_metadata ? v_par.id) THEN
        v_esperado := automation.cliente_pelo_nome_na_historia(v_linha.organization_id, v_metadata ->> v_par.nome, v_linha.occurred_at);
        IF v_esperado IS NOT NULL THEN
          v_metadata := v_metadata || jsonb_build_object(v_par.id, v_esperado::text, 'idsPreenchidosPela', '0133');
          v_preenchidos := v_preenchidos + 1;
        ELSIF v_par.id = 'deId' THEN
          v_metadata := v_metadata || jsonb_build_object('posseDesconhecida', true);
          v_desconhecidos := v_desconhecidos + 1;
        END IF;
      END IF;
    END LOOP;
    IF v_metadata IS DISTINCT FROM v_linha.metadata THEN
      UPDATE audit.audit_log SET metadata = v_metadata WHERE id = v_linha.id;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('linhasCorrigidas', v_removidos, 'idsPreenchidos', v_preenchidos,
                            'posseDesconhecida', v_desconhecidos);
END;
$$;

COMMENT ON FUNCTION automation.corrigir_ids_de_posse_legados IS
  'Corretivo da 0080 (ADR 0033). Primeiro revisa as linhas que a 0080 preencheu: id que o nome já não aponta sem ambiguidade (pela história com renomeações e pela data de criação do cliente) sai de deId/paraId/clientId e fica guardado em idsRemovidos, com idsRemovidosPela 0133. Depois preenche com a regra nova o que ainda falta e marca posseDesconhecida onde o dono anterior segue ambíguo, para o casamento por nome de dono_anterior_da_auditoria não atribuir a linha a quem herdou o nome. Idempotente: linha revista ganha idsRevistosPela. Só o dono do banco executa.';

REVOKE ALL ON FUNCTION automation.corrigir_ids_de_posse_legados() FROM PUBLIC;

CREATE OR REPLACE FUNCTION automation.dono_anterior_da_auditoria(p_organizacao uuid, p_metadata jsonb)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE WHEN p_metadata ? 'posseDesconhecida' AND NOT (p_metadata ? 'deId') THEN NULL
         ELSE (
           SELECT CASE WHEN count(*) = 1 THEN (array_agg(c.id))[1] END
             FROM core.clients c
            WHERE c.organization_id = p_organizacao
              AND CASE
                    WHEN p_metadata ? 'deId' THEN c.id::text = p_metadata ->> 'deId'
                    ELSE c.id::text = p_metadata ->> 'de' OR c.name = p_metadata ->> 'de'
                  END)
         END;
$$;

COMMENT ON FUNCTION automation.dono_anterior_da_auditoria IS
  'Dono anterior gravado numa linha da trilha (ADR 0023, 0033). Linha nova traz metadata.deId e casa pelo id. Linha marcada posseDesconhecida (corretivo da 0133) devolve NULL. Linha antiga sem marca casa pelo nome só se exatamente um cliente da organização tiver esse nome.';

REVOKE ALL ON FUNCTION automation.dono_anterior_da_auditoria(uuid, jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION automation.preencher_ids_de_posse_legados()
RETURNS jsonb
LANGUAGE sql
VOLATILE
SET search_path = pg_catalog, public
AS $$
  SELECT automation.corrigir_ids_de_posse_legados();
$$;

COMMENT ON FUNCTION automation.preencher_ids_de_posse_legados IS
  'Nome da 0080 mantido para quem já o chama: delega a automation.corrigir_ids_de_posse_legados (regra da 0133, ADR 0033). A regra antiga atribuía nome antigo de cliente renomeado a quem herdou o nome.';

REVOKE ALL ON FUNCTION automation.preencher_ids_de_posse_legados() FROM PUBLIC;

SELECT automation.corrigir_ids_de_posse_legados();

COMMIT;
