BEGIN;

DO $$
BEGIN
  PERFORM set_config(
    'alertas.papel_app',
    (SELECT rolname FROM pg_roles WHERE rolname IN ('orla_app', 'tria_app') ORDER BY rolname = 'orla_app' DESC LIMIT 1),
    true
  );
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orla_worker') THEN
    RAISE EXCEPTION 'papel orla_worker ausente; a 0070 precisa ter rodado antes';
  END IF;
END $$;

DO $$ BEGIN
  EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON automation.alertas FROM %I', current_setting('alertas.papel_app'));
END $$;

GRANT SELECT, INSERT, UPDATE ON automation.alertas TO orla_worker;

COMMENT ON TABLE automation.alertas IS
  'Falhas de workflow do n8n recebidas pelo fluxo "alertas de falha" da plataforma (ADR 0025, adendo). Tabela de plataforma, sem organization_id: a mensagem chega truncada e sem token nem dado pessoal. Repetições da mesma assinatura (workflow + mensagem) dentro de 1 hora só incrementam ocorrencias. O papel do app só lê; escreve o orla_worker e apaga core.aplicar_retencao (90 dias).';

COMMIT;
