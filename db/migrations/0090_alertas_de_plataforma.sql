BEGIN;

DO $$
BEGIN
  PERFORM set_config(
    'alertas.papel_app',
    (SELECT rolname FROM pg_roles WHERE rolname IN ('orla_app', 'tria_app') ORDER BY rolname = 'orla_app' DESC LIMIT 1),
    true
  );
END $$;

CREATE TABLE automation.alertas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id   text,
  workflow_nome text NOT NULL CHECK (length(workflow_nome) BETWEEN 1 AND 200),
  no            text CHECK (no IS NULL OR length(no) <= 200),
  mensagem      text NOT NULL CHECK (length(mensagem) <= 500),
  assinatura    text NOT NULL CHECK (assinatura ~ '^[0-9a-f]{64}$'),
  ocorrencias   integer NOT NULL DEFAULT 1 CHECK (ocorrencias >= 1),
  primeira_em   timestamptz NOT NULL DEFAULT now(),
  ultima_em     timestamptz NOT NULL DEFAULT now(),
  resolvido_em  timestamptz
);

COMMENT ON TABLE automation.alertas IS
  'Falhas de workflow do n8n recebidas pelo fluxo "alertas de falha" da plataforma (ADR 0025, adendo). Tabela de plataforma, sem organization_id: a mensagem chega truncada e sem token nem dado pessoal. Repetições da mesma assinatura (workflow + mensagem) dentro de 1 hora só incrementam ocorrencias.';

CREATE INDEX alertas_abertos_idx ON automation.alertas (ultima_em DESC) WHERE resolvido_em IS NULL;
CREATE INDEX alertas_assinatura_idx ON automation.alertas (assinatura, ultima_em DESC);

ALTER TABLE automation.alertas ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation.alertas FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON automation.alertas TO %I', current_setting('alertas.papel_app'));
  EXECUTE format(
    'CREATE POLICY alertas_app ON automation.alertas FOR ALL TO %I USING (true) WITH CHECK (true)',
    current_setting('alertas.papel_app')
  );
END $$;

COMMIT;
