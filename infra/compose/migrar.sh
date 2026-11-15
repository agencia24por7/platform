#!/bin/sh
set -eu

LEDGER="CREATE TABLE IF NOT EXISTS public.schema_migrations (
  nome        text PRIMARY KEY,
  aplicada_em timestamptz NOT NULL DEFAULT now()
)"

psql_admin() {
  docker exec -i orla-postgres psql -U postgres -d tria -v ON_ERROR_STOP=1 "$@"
}

psql_admin -q -c "$LEDGER"

for arquivo in /opt/tria/migrations/*.sql; do
  nome=$(basename "$arquivo")
  ja_aplicada=$(psql_admin -At -c "SELECT 1 FROM public.schema_migrations WHERE nome = '$nome'")

  if [ -n "$ja_aplicada" ]; then
    echo "pulando $nome"
    continue
  fi

  printf 'aplicando %s ... ' "$nome"
  psql_admin -q < "$arquivo"
  psql_admin -q -c "INSERT INTO public.schema_migrations (nome) VALUES ('$nome')"
  echo "ok"
done
