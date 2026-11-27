BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  PERFORM set_config(
    'ia.papel_app',
    (SELECT rolname FROM pg_roles WHERE rolname IN ('orla_app', 'tria_app') ORDER BY rolname = 'orla_app' DESC LIMIT 1),
    true
  );
  IF current_setting('ia.papel_app') = '' THEN
    RAISE EXCEPTION 'papel do app ausente; as migracoes 0070 e anteriores precisam ter rodado';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orla_worker') THEN
    RAISE EXCEPTION 'papel orla_worker ausente; a 0070 precisa ter rodado antes';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS core.ai_provider_keys (
  organization_id   uuid NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
  provider          text NOT NULL CHECK (provider IN ('anthropic', 'google', 'openai', 'xai', 'moonshot')),
  key_ciphertext    bytea NOT NULL CHECK (octet_length(key_ciphertext) BETWEEN 32 AND 16384),
  kms_key_version   text NOT NULL CHECK (length(kms_key_version) BETWEEN 1 AND 400),
  key_algorithm     text NOT NULL CHECK (key_algorithm IN ('aes-256-gcm+kms', 'aes-256-gcm+local')),
  key_label         text NOT NULL CHECK (length(key_label) BETWEEN 4 AND 24),
  models            text[] NOT NULL DEFAULT '{}' CHECK (cardinality(models) <= 500),
  models_listed_at  timestamptz,
  created_by        uuid REFERENCES core.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, provider)
);

COMMENT ON TABLE core.ai_provider_keys IS
  'Chave de API de fornecedor de modelo, por organização (ADR 0058). O valor fica selado em envelope com a mesma chave mestra do cofre de tokens (ADR 0032); kms_key_version entra na varredura de recifragem (ADR 0042). key_label é o rótulo mascarado. models guarda a lista devolvida pelo fornecedor quando a chave foi testada.';

DROP TRIGGER IF EXISTS ai_provider_keys_touch ON core.ai_provider_keys;
CREATE TRIGGER ai_provider_keys_touch BEFORE UPDATE ON core.ai_provider_keys
  FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();

CREATE TABLE IF NOT EXISTS core.ai_task_models (
  organization_id  uuid NOT NULL,
  task             text NOT NULL CHECK (task ~ '^[a-z][a-z0-9_]{2,47}$'),
  provider         text NOT NULL,
  model            text NOT NULL CHECK (model ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$'),
  updated_by       uuid REFERENCES core.users(id) ON DELETE SET NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, task),
  FOREIGN KEY (organization_id, provider) REFERENCES core.ai_provider_keys(organization_id, provider) ON DELETE CASCADE
);

COMMENT ON TABLE core.ai_task_models IS
  'Fornecedor e modelo escolhidos por tarefa de IA, por organização (ADR 0057 §2). Remover a chave do fornecedor remove as escolhas que dependiam dela: a tarefa volta a ficar bloqueada.';

CREATE TABLE IF NOT EXISTS core.ai_settings (
  organization_id  uuid PRIMARY KEY REFERENCES core.organizations(id) ON DELETE CASCADE,
  enabled          boolean NOT NULL DEFAULT true,
  daily_calls      integer NOT NULL DEFAULT 200 CHECK (daily_calls BETWEEN 1 AND 100000),
  daily_tokens     bigint NOT NULL DEFAULT 2000000 CHECK (daily_tokens BETWEEN 1000 AND 1000000000),
  updated_by       uuid REFERENCES core.users(id) ON DELETE SET NULL,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE core.ai_settings IS
  'Botão de desligar e tetos diários de IA por organização (ADR 0058). Sem linha valem os padrões: ligada, 200 chamadas e 2 milhões de tokens por dia.';

CREATE TABLE IF NOT EXISTS core.ai_usage (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id  uuid NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
  task             text NOT NULL CHECK (task ~ '^[a-z][a-z0-9_]{2,47}$'),
  provider         text NOT NULL CHECK (provider IN ('anthropic', 'google', 'openai', 'xai', 'moonshot')),
  model            text NOT NULL CHECK (length(model) BETWEEN 1 AND 120),
  result           text NOT NULL DEFAULT 'reservada' CHECK (result ~ '^[a-z_]{2,30}$'),
  reserved_tokens  integer NOT NULL CHECK (reserved_tokens BETWEEN 1 AND 1000000),
  input_tokens     integer NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens    integer NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  steps            integer NOT NULL DEFAULT 0 CHECK (steps >= 0),
  duration_ms      integer NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
  request_id       text CHECK (request_id IS NULL OR length(request_id) BETWEEN 1 AND 64),
  occurred_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE core.ai_usage IS
  'Uma linha por chamada a modelo (ADR 0058). Nasce como reserva, antes da chamada, e recebe o desfecho depois. Só contagens: nunca o texto do pedido nem da resposta. O teto diário soma estas linhas; o app não escolhe occurred_at.';

CREATE INDEX IF NOT EXISTS ai_usage_por_dia ON core.ai_usage (organization_id, occurred_at DESC);

DO $$
DECLARE
  papel text := current_setting('ia.papel_app');
  tabela text;
BEGIN
  FOREACH tabela IN ARRAY ARRAY['ai_provider_keys', 'ai_task_models', 'ai_settings', 'ai_usage']
  LOOP
    EXECUTE format('ALTER TABLE core.%I ENABLE ROW LEVEL SECURITY', tabela);
    EXECUTE format('ALTER TABLE core.%I FORCE ROW LEVEL SECURITY', tabela);
    EXECUTE format('DROP POLICY IF EXISTS %I ON core.%I', tabela || '_tenant', tabela);
    EXECUTE format(
      'CREATE POLICY %I ON core.%I FOR ALL TO %I
         USING (organization_id = core.current_organization() AND core.current_clients() IS NULL)
         WITH CHECK (organization_id = core.current_organization() AND core.current_clients() IS NULL)',
      tabela || '_tenant', tabela, papel);
    EXECUTE format('REVOKE ALL ON core.%I FROM PUBLIC', tabela);
    EXECUTE format('REVOKE ALL ON core.%I FROM %I', tabela, papel);
  END LOOP;

  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON core.ai_provider_keys TO %I', papel);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON core.ai_task_models TO %I', papel);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON core.ai_settings TO %I', papel);
  EXECUTE format('GRANT SELECT ON core.ai_usage TO %I', papel);
  EXECUTE format(
    'GRANT INSERT (organization_id, task, provider, model, reserved_tokens, request_id) ON core.ai_usage TO %I', papel);
  EXECUTE format(
    'GRANT UPDATE (result, input_tokens, output_tokens, steps, duration_ms) ON core.ai_usage TO %I', papel);
END $$;

CREATE OR REPLACE FUNCTION core.ia_chaves_com_versao_antiga(p_versao_primaria text, p_limite integer DEFAULT 50)
RETURNS TABLE (organization_id uuid, provider text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
STABLE
AS $$
  SELECT k.organization_id, k.provider
  FROM core.ai_provider_keys k
  WHERE k.kms_key_version <> p_versao_primaria
  ORDER BY k.updated_at
  LIMIT greatest(least(p_limite, 200), 1);
$$;

COMMENT ON FUNCTION core.ia_chaves_com_versao_antiga IS
  'Varredura de recifragem (ADR 0042 e 0058): chaves de fornecedor de IA seladas com uma versão da chave mestra diferente da primária. Só devolve ponteiros; a recifragem acontece dentro do tenant. Só o worker executa.';

DO $$
BEGIN
  REVOKE ALL ON FUNCTION core.ia_chaves_com_versao_antiga(text, integer) FROM PUBLIC;
  EXECUTE format('REVOKE ALL ON FUNCTION core.ia_chaves_com_versao_antiga(text, integer) FROM %I', current_setting('ia.papel_app'));
  GRANT EXECUTE ON FUNCTION core.ia_chaves_com_versao_antiga(text, integer) TO orla_worker;
END $$;

COMMIT;
