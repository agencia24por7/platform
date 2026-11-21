BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM integrations.corte_para_cofre_refs WHERE limpo_em IS NULL) THEN
    RAISE EXCEPTION 'corte_para_cofre_refs ainda tem conexões sem limpo_em: rode scripts/n8n-limpar-legado.mjs --aplicar antes (ADR 0032)';
  END IF;
  IF EXISTS (SELECT 1 FROM integrations.connections WHERE credential_ref IS NOT NULL OR coletor_ref IS NOT NULL OR executor_ref IS NOT NULL) THEN
    RAISE EXCEPTION 'ainda há conexão com ponteiro do n8n: a imagem anterior ao corte voltou a rodar? confira antes de remover';
  END IF;
END $$;

DROP TABLE integrations.corte_para_cofre_refs;

ALTER TABLE integrations.connections DROP COLUMN credential_ref;
ALTER TABLE integrations.connections DROP COLUMN coletor_ref;
ALTER TABLE integrations.connections DROP COLUMN executor_ref;

COMMIT;
