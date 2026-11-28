BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  PERFORM set_config(
    'cultura.papel_app',
    (SELECT rolname FROM pg_roles WHERE rolname IN ('orla_app', 'tria_app') ORDER BY rolname = 'orla_app' DESC LIMIT 1),
    true
  );
  IF current_setting('cultura.papel_app') = '' THEN
    RAISE EXCEPTION 'papel do app ausente; as migracoes 0070 e anteriores precisam ter rodado';
  END IF;
  IF to_regprocedure('core.decisao_chamador_e_app()') IS NULL OR to_regprocedure('core.decisao_chamador_e_worker()') IS NULL THEN
    RAISE EXCEPTION 'core.decisao_chamador_e_app ou _worker ausente; a migracao 0141 precisa ter rodado';
  END IF;
  IF to_regclass('core.client_landing_pages') IS NULL THEN
    RAISE EXCEPTION 'core.client_landing_pages ausente; a migracao 0148 precisa ter rodado';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION core.texto_de_sinal_sem_pessoa(p_texto text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT p_texto IS NOT NULL
     AND p_texto !~ '(^|[^[:alnum:]_])@[[:alnum:]_.]{2,}'
     AND p_texto !~ '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}'
     AND p_texto !~ '\+55\s?\(?[0-9]{2}\)?\s?9?[0-9]{4}[-\s]?[0-9]{4}'
     AND p_texto !~ '\([0-9]{2}\)\s?9?[0-9]{4}[-\s]?[0-9]{4}'
     AND p_texto !~ '(^|[^0-9])[0-9]{2}\s9?[0-9]{4}-[0-9]{4}([^0-9]|$)'
     AND p_texto !~ '(^|[^0-9])[1-9][0-9]9[0-9]{8}([^0-9]|$)'
     AND p_texto !~ '[0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]{2}'
$$;

COMMENT ON FUNCTION core.texto_de_sinal_sem_pessoa IS
  'Defesa final do banco para sinais de cultura (24K-134): falso quando o texto traz @handle, e-mail, telefone brasileiro ou CPF. O sinal descreve fenomeno publico, nunca pessoa. A validacao completa fica no dominio (src/modules/brain/domain/cultura.ts); esta funcao cobre os padroes inequivocos e nao substitui revisao.';

CREATE TABLE IF NOT EXISTS core.client_culture_signals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES core.organizations(id) ON DELETE RESTRICT,
  client_id        uuid NOT NULL REFERENCES core.clients(id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN ('tendencia', 'meme', 'conversa', 'comunidade', 'referencia_criativa', 'anti_referencia')),
  titulo           text NOT NULL CHECK (length(titulo) BETWEEN 1 AND 160 AND titulo = btrim(titulo) AND core.texto_de_sinal_sem_pessoa(titulo)),
  resumo           text NOT NULL CHECK (length(resumo) BETWEEN 1 AND 600 AND resumo = btrim(resumo) AND core.texto_de_sinal_sem_pessoa(resumo)),
  fonte_url        text NOT NULL CHECK (length(fonte_url) <= 2048 AND fonte_url ~ '^https://[^\s/@?#]+([/?#]\S*)?$'),
  fonte_nome       text NOT NULL CHECK (length(fonte_nome) BETWEEN 1 AND 120 AND fonte_nome = btrim(fonte_nome) AND core.texto_de_sinal_sem_pessoa(fonte_nome)),
  plataforma       text CHECK (plataforma IS NULL OR plataforma ~ '^[a-z][a-z0-9_]{1,47}$'),
  observado_em     date NOT NULL,
  valido_ate       date NOT NULL,
  nota_evidencia   text NOT NULL CHECK (nota_evidencia IN ('A', 'B', 'C', 'D')),
  origem           text NOT NULL CHECK (origem IN ('manual', 'coletor')),
  criado_por       uuid REFERENCES core.users(id) ON DELETE SET NULL,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  arquivado_em     timestamptz,
  CONSTRAINT client_culture_signals_validade CHECK (valido_ate >= observado_em AND valido_ate <= observado_em + 90),
  CONSTRAINT client_culture_signals_autoria CHECK (origem = 'manual' OR criado_por IS NULL),
  CONSTRAINT client_culture_signals_id_inquilino UNIQUE (id, organization_id, client_id)
);

COMMENT ON TABLE core.client_culture_signals IS
  'Sinais de cultura e referencias criativas do cliente (24K-134, ADR 0075): tendencia, meme, conversa emergente, movimento de comunidade, referencia de campanha e anti-referencia, todos de fenomeno publico e nunca de pessoa. Alimentam o provedor culture do Brain. Validade obrigatoria de ate 90 dias. O app so tem SELECT, INSERT e UPDATE de arquivado_em (arquivar e o unico caminho de remocao); coletor entra pelo worker com origem coletor. Escrita manual exige owner, admin ou operator (gatilho). Unico por cliente, URL da fonte (sem caixa) e dia observado, inclusive arquivado, para o coletor nao recriar o que a equipe arquivou. Some com o cliente no expurgo.';
COMMENT ON COLUMN core.client_culture_signals.titulo IS 'Nome do fenomeno publico. O gatilho e o CHECK recusam @handle, e-mail, telefone e CPF.';
COMMENT ON COLUMN core.client_culture_signals.resumo IS 'O que esta acontecendo, em ate 600 caracteres. Chega ao modelo como conteudo nao confiavel: e dado, nunca instrucao.';
COMMENT ON COLUMN core.client_culture_signals.fonte_url IS 'Link https publico da observacao, sem credencial. Fica no app e nunca vai ao modelo; o catalogo leva so o dominio.';
COMMENT ON COLUMN core.client_culture_signals.nota_evidencia IS 'Mesma escala A a D do conhecimento global; nota D nunca sustenta meta nem afirmacao.';
COMMENT ON COLUMN core.client_culture_signals.criado_por IS 'Pessoa que cadastrou (origem manual), fixada pelo gatilho a partir de app.user_id. Nula para o coletor e, depois, se a pessoa for removida.';

CREATE UNIQUE INDEX IF NOT EXISTS client_culture_signals_fonte_dia
  ON core.client_culture_signals (client_id, lower(fonte_url), observado_em);
CREATE INDEX IF NOT EXISTS client_culture_signals_vigencia
  ON core.client_culture_signals (client_id, valido_ate DESC) WHERE arquivado_em IS NULL;

DO $$
DECLARE
  papel text := current_setting('cultura.papel_app');
  condicao text := 'organization_id = core.current_organization() AND core.cliente_no_escopo(client_id)
                AND EXISTS (SELECT 1 FROM core.clients c WHERE c.id = client_culture_signals.client_id AND c.organization_id = client_culture_signals.organization_id)';
BEGIN
  ALTER TABLE core.client_culture_signals ENABLE ROW LEVEL SECURITY;
  ALTER TABLE core.client_culture_signals FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS client_culture_signals_leitura ON core.client_culture_signals;
  DROP POLICY IF EXISTS client_culture_signals_insercao ON core.client_culture_signals;
  DROP POLICY IF EXISTS client_culture_signals_atualizacao ON core.client_culture_signals;
  EXECUTE format('CREATE POLICY client_culture_signals_leitura ON core.client_culture_signals FOR SELECT TO %I USING (%s)', papel, condicao);
  EXECUTE format('CREATE POLICY client_culture_signals_insercao ON core.client_culture_signals FOR INSERT TO %I WITH CHECK (%s)', papel, condicao);
  EXECUTE format('CREATE POLICY client_culture_signals_atualizacao ON core.client_culture_signals FOR UPDATE TO %I USING (%s) WITH CHECK (%s)', papel, condicao, condicao);
  REVOKE ALL ON core.client_culture_signals FROM PUBLIC;
  EXECUTE format('REVOKE ALL ON core.client_culture_signals FROM %I', papel);
  EXECUTE format('GRANT SELECT, INSERT ON core.client_culture_signals TO %I', papel);
  EXECUTE format('GRANT UPDATE (arquivado_em) ON core.client_culture_signals TO %I', papel);
END $$;

CREATE OR REPLACE FUNCTION core.client_culture_signal_escrita()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_usuario uuid;
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF NOT core.decisao_chamador_e_app() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - 'arquivado_em' - 'criado_por') IS DISTINCT FROM (to_jsonb(OLD) - 'arquivado_em' - 'criado_por')
       OR (NEW.criado_por IS DISTINCT FROM OLD.criado_por AND NEW.criado_por IS NOT NULL) THEN
      RAISE EXCEPTION 'sinal de cultura só se arquiva; o conteúdo não se edita' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.arquivado_em IS NOT DISTINCT FROM OLD.arquivado_em THEN
      RETURN NEW;
    END IF;
    IF OLD.arquivado_em IS NOT NULL OR NEW.arquivado_em IS NULL THEN
      RAISE EXCEPTION 'sinal de cultura só se arquiva, uma vez' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NOT core.cliente_no_escopo(OLD.client_id) OR OLD.organization_id IS DISTINCT FROM core.current_organization() THEN
      RAISE EXCEPTION 'organização ou cliente fora do contexto da sessão' USING ERRCODE = 'insufficient_privilege';
    END IF;
    v_usuario := nullif(current_setting('app.user_id', true), '')::uuid;
    IF v_usuario IS NULL OR NOT EXISTS (
         SELECT 1 FROM core.memberships_of(v_usuario) m
          WHERE m.organization_id = OLD.organization_id AND m.role IN ('owner', 'admin', 'operator')) THEN
      RAISE EXCEPTION 'arquivar sinal de cultura exige papel owner, admin ou operator' USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.arquivado_em := now();
    RETURN NEW;
  END IF;

  IF NEW.organization_id IS DISTINCT FROM core.current_organization() OR NOT core.cliente_no_escopo(NEW.client_id)
     OR NOT EXISTS (SELECT 1 FROM core.clients c WHERE c.id = NEW.client_id AND c.organization_id = NEW.organization_id) THEN
    RAISE EXCEPTION 'organização ou cliente fora do contexto da sessão' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.observado_em > v_hoje + 1 THEN
    RAISE EXCEPTION 'observado_em no futuro' USING ERRCODE = 'check_violation';
  END IF;
  NEW.criado_em := now();
  NEW.arquivado_em := NULL;

  IF core.decisao_chamador_e_worker() THEN
    IF NEW.origem <> 'coletor' OR NEW.criado_por IS NOT NULL THEN
      RAISE EXCEPTION 'o worker só grava sinal de cultura com origem coletor e sem autor' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  v_usuario := nullif(current_setting('app.user_id', true), '')::uuid;
  IF v_usuario IS NULL THEN
    RAISE EXCEPTION 'escrita de sinal de cultura exige usuário na sessão' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM core.memberships_of(v_usuario) m
        WHERE m.organization_id = NEW.organization_id AND m.role IN ('owner', 'admin', 'operator')) THEN
    RAISE EXCEPTION 'gravar sinal de cultura exige papel owner, admin ou operator' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.origem <> 'manual' THEN
    RAISE EXCEPTION 'o app só grava sinal de cultura com origem manual' USING ERRCODE = 'insufficient_privilege';
  END IF;
  NEW.criado_por := v_usuario;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION core.client_culture_signal_escrita IS
  'BEFORE INSERT OR UPDATE de core.client_culture_signals, sem SECURITY DEFINER (enxerga o papel real). App ou worker: organizacao e cliente iguais aos da sessao. Worker so insere com origem coletor e sem autor (o worker herda o papel do app, entao a checagem de pessoa nao vale para ele). App exige app.user_id com papel owner, admin ou operator, origem manual, e fixa criado_por. UPDATE so aceita arquivar uma vez, por pessoa com esse papel; a unica outra mudanca tolerada e criado_por virar nulo (ON DELETE SET NULL do usuario). observado_em nao passa de amanha (America/Sao_Paulo). Superusuario e dono passam direto (migracao e testes).';

DROP TRIGGER IF EXISTS client_culture_signals_escrita ON core.client_culture_signals;
CREATE TRIGGER client_culture_signals_escrita BEFORE INSERT OR UPDATE ON core.client_culture_signals
  FOR EACH ROW EXECUTE FUNCTION core.client_culture_signal_escrita();

COMMIT;
