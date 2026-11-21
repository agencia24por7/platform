#!/bin/sh
set -eu

PG_CONTAINER="${PG_CONTAINER:-orla-postgres}"
PG_USER="${PG_USER:-postgres}"
PG_DB="${PG_DB:-tria}"
MIGRACOES_DIR="${MIGRACOES_DIR:-/opt/tria/migrations}"
SINCRONIZAR_SENHA_WORKER="${SINCRONIZAR_SENHA_WORKER:-1}"
TRAVA="hashtext('orla:migracoes')"
NOME_VALIDO='^[0-9]{4}_[a-z0-9_]+(\.sem_transacao)?\.sql$'
MIGRAR_MODO="${MIGRAR_MODO:-aplicar}"
CORTE_GATE_ARQUIVO="${CORTE_GATE_ARQUIVO:-/opt/tria/corte-gate.txt}"
PREFLIGHT_MARCA="${PREFLIGHT_MARCA:-/opt/tria/.preflight-ok}"
RELEASE_CORTE_AUTORIZADO="${RELEASE_CORTE_AUTORIZADO:-0}"
RELEASE_ID="${RELEASE_ID:-}"

LEDGER="CREATE TABLE IF NOT EXISTS public.schema_migrations (
  nome        text PRIMARY KEY,
  aplicada_em timestamptz NOT NULL DEFAULT now()
)"

psql_admin() {
  docker exec -i -e PGOPTIONS='-c client_min_messages=warning' "$PG_CONTAINER" psql -X -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 "$@"
}

roda_sem_transacao() {
  case "$1" in
    *.sem_transacao.sql) return 0 ;;
    *) return 1 ;;
  esac
}

controle_de_transacao_restante() {
  grep -n -i -E '^[[:space:]]*(BEGIN|COMMIT|ROLLBACK|ABORT|START[[:space:]]+TRANSACTION)([[:space:]]+(WORK|TRANSACTION))?[[:space:]]*;' "$1" || true
}

corpo_sem_begin_commit() {
  sed -e '/^BEGIN;[[:space:]]*$/d' -e '/^COMMIT;[[:space:]]*$/d' "$1"
}

aplicar_em_transacao() {
  arquivo="$1"
  nome="$2"
  corpo=$(mktemp)
  corpo_sem_begin_commit "$arquivo" > "$corpo"

  restante=$(controle_de_transacao_restante "$corpo")
  if [ -n "$restante" ]; then
    rm -f "$corpo"
    echo "recusado"
    echo "$nome controla a transação fora do par BEGIN;/COMMIT; de topo:" >&2
    echo "$restante" >&2
    echo "Remova esse controle ou renomeie para NNNN_nome.sem_transacao.sql (ADR 0028)." >&2
    exit 1
  fi

  status=0
  {
    echo "SELECT pg_advisory_xact_lock($TRAVA);"
    echo "INSERT INTO public.schema_migrations (nome) VALUES ('$nome');"
    cat "$corpo"
    echo ";"
  } | psql_admin -q --single-transaction -f - > /dev/null || status=$?
  rm -f "$corpo"

  if [ "$status" -ne 0 ]; then
    echo "falhou (transação desfeita; nada de $nome ficou aplicado)"
    exit "$status"
  fi
}

aplicar_sem_transacao() {
  psql_admin -q -f - < "$1" > /dev/null
  psql_admin -q -c "INSERT INTO public.schema_migrations (nome) VALUES ('$2')" > /dev/null
}

sincronizar_senha_do_worker() {
  docker exec -i "$PG_CONTAINER" sh -c '
    if [ -z "${WORKER_DB_PASSWORD:-}" ]; then
      echo "WORKER_DB_PASSWORD ausente no contêiner do Postgres; o papel orla_worker ficaria sem senha." >&2
      exit 1
    fi
    exec psql -X -U "$1" -d "$2" -v ON_ERROR_STOP=1 -q -v senha="$WORKER_DB_PASSWORD"
  ' sh "$PG_USER" "$PG_DB" <<'SQL'
SELECT format('ALTER ROLE orla_worker WITH LOGIN PASSWORD %L', :'senha')
 WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orla_worker') \gexec
SQL
}

na_lista_do_corte() {
  [ -f "$CORTE_GATE_ARQUIVO" ] || return 1
  sed -e 's/#.*//' -e 's/[[:space:]]//g' "$CORTE_GATE_ARQUIVO" | grep -qxF "$1"
}

marca_do_preflight_confere() {
  [ -n "$RELEASE_ID" ] && [ -f "$PREFLIGHT_MARCA" ] && [ "$(head -n 1 "$PREFLIGHT_MARCA")" = "$RELEASE_ID" ]
}

psql_admin -q -c "$LEDGER" > /dev/null

ja_tinha_migracoes=$(psql_admin -At -c "SELECT count(*) FROM public.schema_migrations")
pendentes=""
pendentes_do_corte=""
for arquivo in "$MIGRACOES_DIR"/*.sql; do
  [ -e "$arquivo" ] || continue
  nome=$(basename "$arquivo")

  if ! printf '%s' "$nome" | grep -q -E "$NOME_VALIDO"; then
    echo "nome de migração fora do padrão NNNN_nome.sql: $nome" >&2
    exit 1
  fi

  ja_aplicada=$(psql_admin -At -c "SELECT 1 FROM public.schema_migrations WHERE nome = '$nome'")
  if [ -n "$ja_aplicada" ]; then
    [ "$MIGRAR_MODO" = "listar" ] || echo "pulando $nome"
    continue
  fi
  pendentes="$pendentes $nome"
  if na_lista_do_corte "$nome"; then pendentes_do_corte="$pendentes_do_corte $nome"; fi
done

corte_exige_autorizacao=0
if [ -n "$pendentes_do_corte" ] && [ "$ja_tinha_migracoes" != "0" ]; then corte_exige_autorizacao=1; fi

if [ "$MIGRAR_MODO" = "listar" ]; then
  total=0
  for nome in $pendentes; do
    total=$((total + 1))
    if na_lista_do_corte "$nome"; then echo "pendente (corte) $nome"; else echo "pendente $nome"; fi
  done
  echo "$total migração(ões) pendente(s)."
  if [ "$corte_exige_autorizacao" = "1" ]; then echo "corte pendente:$pendentes_do_corte"; fi
  exit 0
fi

if [ "$corte_exige_autorizacao" = "1" ]; then
  if [ "$RELEASE_CORTE_AUTORIZADO" != "1" ]; then
    echo "corte bloqueado: pendentes do corte:$pendentes_do_corte" >&2
    echo "Falta RELEASE_CORTE_AUTORIZADO=1 (input autorizar_corte do deploy). Nenhuma migração foi aplicada." >&2
    exit 3
  fi
  if ! marca_do_preflight_confere; then
    echo "corte bloqueado: a marca do pre-flight ($PREFLIGHT_MARCA) não é da release '$RELEASE_ID'." >&2
    echo "Rode o pre-flight desta release antes (scripts/preflight-release.sh). Nenhuma migração foi aplicada." >&2
    exit 3
  fi
  echo "corte autorizado para a release $RELEASE_ID:$pendentes_do_corte"
fi

aplicadas=0
for nome in $pendentes; do
  arquivo="$MIGRACOES_DIR/$nome"
  printf 'aplicando %s ... ' "$nome"
  if roda_sem_transacao "$nome"; then
    aplicar_sem_transacao "$arquivo" "$nome"
    echo "ok (sem transação)"
  else
    aplicar_em_transacao "$arquivo" "$nome"
    echo "ok"
  fi
  aplicadas=$((aplicadas + 1))
done

if [ "$SINCRONIZAR_SENHA_WORKER" = "1" ]; then
  sincronizar_senha_do_worker
  echo "senha do papel orla_worker sincronizada"
fi

echo "$aplicadas migração(ões) aplicada(s)."
