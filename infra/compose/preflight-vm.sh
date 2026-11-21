#!/bin/sh
set -u

PILHA="${PILHA:-/opt/tria}"
ARQUIVO_ENV="${ARQUIVO_ENV:-$PILHA/.env}"
MIGRAR_SH="${MIGRAR_SH:-$PILHA/migrar.sh}"
PG_CONTAINER="${PG_CONTAINER:-orla-postgres}"
GCS_UPLOAD_URL="${GCS_UPLOAD_URL:-https://storage.googleapis.com/upload/storage/v1}"
RELEASE_ID="${RELEASE_ID:-}"
IMAGEM="${IMAGEM:-}"
RELEASE_CORTE_AUTORIZADO="${RELEASE_CORTE_AUTORIZADO:-0}"
BQ_DDL_APLICADO="${BQ_DDL_APLICADO:-}"
ESPERA_DO_POSTGRES="${ESPERA_DO_POSTGRES:-60}"

SEGREDOS_OBRIGATORIOS="postgres-password app-db-password worker-db-password database-url worker-token session-secret n8n-encryption-key n8n-db-password proxy-basic-auth"
SEGREDOS_OPCIONAIS="n8n-api-key meta-login-config-id leadads-login-config-id alert-webhook-url google-oauth-client-id meta-app-id rdstation-client-id"

falhas=0
falhar() { echo "FALHA: $*" >&2; falhas=$((falhas + 1)); }
ok() { echo "ok: $*"; }
aviso() { echo "aviso: $*"; }

metadado() {
  curl -sf --max-time 5 -H 'Metadata-Flavor: Google' "${METADADOS_URL:-http://metadata.google.internal/computeMetadata/v1}/$1" 2>/dev/null || true
}

valor() {
  sed -n "s/^$1=//p" "$ARQUIVO_ENV" | tail -n 1
}

tem_segredo() {
  [ -n "$(gcloud secrets versions access latest --secret="$PREFIXO-$1" --project="$PROJETO" 2>/dev/null)" ]
}

compose() {
  env APP_IMAGE="$IMAGEM" docker compose -f "$PILHA/docker-compose.prod.yml" --project-directory "$PILHA" "$@"
}

[ -n "$RELEASE_ID" ] || { echo "RELEASE_ID ausente (o sha do commit implantado)." >&2; exit 2; }
[ -n "$IMAGEM" ] || { echo "IMAGEM ausente (a imagem nova do app)." >&2; exit 2; }
[ -f "$ARQUIVO_ENV" ] || { echo "arquivo de ambiente ausente: $ARQUIVO_ENV" >&2; exit 1; }

PROJETO=$(metadado project/project-id)
INSTANCIA=$(metadado instance/name)
PREFIXO=${INSTANCIA%-vm}
if [ -z "$PROJETO" ] || [ -z "$INSTANCIA" ] || [ "$PREFIXO" = "$INSTANCIA" ]; then
  echo "metadados da VM não responderam (projeto/instância): não dá para conferir nada." >&2
  exit 1
fi
echo "pre-flight da release $RELEASE_ID em $INSTANCIA ($PROJETO)"

echo "== 1. segredos no Secret Manager (versão habilitada e não vazia)"
for nome in $SEGREDOS_OBRIGATORIOS; do
  if tem_segredo "$nome"; then ok "$PREFIXO-$nome"; else falhar "$PREFIXO-$nome sem versão habilitada (obrigatório)"; fi
done
if tem_segredo meta-app-secret; then
  if tem_segredo meta-exclusao-pepper; then
    ok "$PREFIXO-meta-exclusao-pepper"
  else
    falhar "$PREFIXO-meta-exclusao-pepper sem versão: com meta-app-secret o app não sobe (ADR 0033)"
  fi
fi
for nome in $SEGREDOS_OPCIONAIS; do
  tem_segredo "$nome" || aviso "$PREFIXO-$nome sem versão (opcional: a função correspondente fica desligada)"
done

echo "== 2. completar o .env sem reiniciar a VM"
if sh "$PILHA/completar-env.sh" "$ARQUIVO_ENV"; then ok "completar-env.sh"; else falhar "completar-env.sh"; fi

echo "== 3. portão do corte"
if [ -s "$PILHA/corte-gate.txt" ]; then ok "corte-gate.txt presente"; else falhar "$PILHA/corte-gate.txt ausente: o migrar.sh ficaria sem portão"; fi

echo "== 4. cofre de tokens (KMS: cifrar e decifrar de verdade)"
if sh "$PILHA/tokens-verificar-kms.sh" "$ARQUIVO_ENV"; then ok "KMS"; else falhar "KMS (TOKENS_KMS_KEY, IAM da VM ou API cloudkms)"; fi

echo "== 5. bucket do contexto"
bucket=$(valor CONTEXT_BUCKET)
if [ -z "$bucket" ]; then
  falhar "CONTEXT_BUCKET vazio no .env"
elif gcloud storage ls --project="$PROJETO" "gs://$bucket" > /dev/null 2>&1; then
  ok "gs://$bucket acessível pela conta da VM"
else
  falhar "gs://$bucket inexistente ou sem acesso da VM (Terraform contexto.tf aplicado?)"
fi

echo "== 6. DDL do BigQuery desta release"
esperado="$PILHA/preflight-bq.txt"
release_do_bq=$(sed -n 's/^release:[[:space:]]*//p' "$esperado" 2>/dev/null | head -n 1)
bq_projeto=$(valor BQ_PROJECT_ID)
bq_dataset=$(valor BQ_DATASET)
[ -n "$bq_dataset" ] || bq_dataset=tria_dw
faltando=""
nao_verificados=""
if [ ! -f "$esperado" ] || [ -z "$bq_projeto" ]; then
  falhar "sem $esperado ou sem BQ_PROJECT_ID: não dá para conferir o BigQuery"
else
  for item in $(sed -e 's/#.*//' -e '/^release:/d' "$esperado"); do
    tabela=${item%%.*}
    coluna=""
    [ "$tabela" = "$item" ] || coluna=${item#*.}
    if ! command -v bq > /dev/null 2>&1; then
      nao_verificados="$nao_verificados $item"
      continue
    fi
    if saida=$(bq --project_id="$bq_projeto" show --format=json "$bq_projeto:$bq_dataset.$tabela" 2>&1 < /dev/null); then
      if [ -n "$coluna" ] && ! printf '%s' "$saida" | grep -q "\"name\":[[:space:]]*\"$coluna\""; then
        faltando="$faltando $item"
      fi
    elif printf '%s' "$saida" | grep -qi 'not found'; then
      faltando="$faltando $item"
    else
      nao_verificados="$nao_verificados $item"
    fi
  done
  if [ -n "$faltando" ]; then
    falhar "BigQuery sem:$faltando. Rode antes: node scripts/bq-ddl.mjs --prod --dry-run e depois --prod --confirmar"
  elif [ -n "$nao_verificados" ]; then
    if [ -n "$release_do_bq" ] && [ "$BQ_DDL_APLICADO" = "$release_do_bq" ]; then
      aviso "BigQuery não verificável pela VM ($nao_verificados); aceito pelo atestado BQ_DDL_APLICADO=$release_do_bq"
    else
      falhar "BigQuery não verificável pela VM ($nao_verificados). Aplique a DDL e ateste com BQ_DDL_APLICADO=$release_do_bq (input bq_ddl_aplicado do deploy)"
    fi
  else
    ok "BigQuery $bq_projeto:$bq_dataset tem os objetos da release $release_do_bq"
  fi
fi

echo "== 7. imagem nova e ambiente que o app vai receber (schema do env.ts, sem imprimir valor)"
gcloud auth configure-docker "${IMAGEM%%/*}" --quiet > /dev/null 2>&1 || true
if docker pull "$IMAGEM" > /dev/null; then
  ok "imagem baixada"
  if compose run --rm --no-deps -T app node --experimental-strip-types --no-warnings /app/release/validarAmbienteCli.ts; then
    ok "ambiente de produção válido"
  else
    falhar "ambiente de produção inválido (lista acima)"
  fi
else
  falhar "não baixou $IMAGEM"
fi

if [ "$falhas" -gt 0 ]; then
  echo "pre-flight REPROVADO: $falhas falha(s). Nada foi tocado no banco." >&2
  exit 1
fi

echo "== 8. Postgres"
compose up -d postgres > /dev/null 2>&1 || { echo "FALHA: não subiu o Postgres" >&2; exit 1; }
tentativas=0
until docker exec "$PG_CONTAINER" pg_isready -U postgres -d tria > /dev/null 2>&1; do
  tentativas=$((tentativas + 1))
  [ "$tentativas" -lt "$ESPERA_DO_POSTGRES" ] || { echo "FALHA: Postgres não ficou pronto" >&2; exit 1; }
  sleep 2
done
ok "Postgres pronto"

echo "== 9. migrações pendentes"
lista=$(MIGRAR_MODO=listar MIGRACOES_DIR="$PILHA/migrations" CORTE_GATE_ARQUIVO="$PILHA/corte-gate.txt" sh "$MIGRAR_SH") \
  || { echo "FALHA: não listou as migrações" >&2; exit 1; }
printf '%s\n' "$lista"
pendentes=$(printf '%s\n' "$lista" | sed -n 's/^\([0-9][0-9]*\) migração(ões) pendente(s)\.$/\1/p')
[ -n "$pendentes" ] || pendentes=0
if printf '%s\n' "$lista" | grep -q '^corte pendente:'; then
  if [ "$RELEASE_CORTE_AUTORIZADO" != "1" ]; then
    echo "BLOQUEADO: o corte (0121/0122) está pendente e o deploy não tem autorização." >&2
    echo "Nada foi tocado no banco e a versão anterior continua no ar. Siga o runbook e rode o deploy" >&2
    echo "por workflow_dispatch com autorizar_corte=true." >&2
    exit 3
  fi
  echo "corte autorizado para esta release"
fi

if [ "$pendentes" -gt 0 ]; then
  echo "== 10. backup lógico antes das migrações"
  bucket_de_backup="$PROJETO-$PREFIXO-backups"
  objeto="postgres/pre-release-$RELEASE_ID-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
  nome_codificado=$(printf '%s' "$objeto" | sed 's#/#%2F#g')
  pasta=$(mktemp -d)
  trap 'rm -rf "$pasta"' EXIT
  chmod 700 "$pasta"
  docker exec "$PG_CONTAINER" pg_dumpall -U postgres > "$pasta/dump.sql" || { echo "FALHA: pg_dumpall" >&2; exit 1; }
  [ -s "$pasta/dump.sql" ] || { echo "FALHA: dump vazio" >&2; exit 1; }
  gzip -9 "$pasta/dump.sql" || { echo "FALHA: gzip do dump" >&2; exit 1; }
  token=$(gcloud auth print-access-token 2>/dev/null) || { echo "FALHA: sem token da conta da VM" >&2; exit 1; }
  printf 'Authorization: Bearer %s\n' "$token" > "$pasta/cabecalho"
  if curl -sSf -X POST -H @"$pasta/cabecalho" -H 'Content-Type: application/gzip' --data-binary @"$pasta/dump.sql.gz" \
    "$GCS_UPLOAD_URL/b/$bucket_de_backup/o?uploadType=media&ifGenerationMatch=0&name=$nome_codificado" > /dev/null; then
    ok "backup gs://$bucket_de_backup/$objeto ($(du -h "$pasta/dump.sql.gz" | cut -f1))"
  else
    echo "FALHA: o envio do backup lógico falhou; sem backup não há migração." >&2
    exit 1
  fi
fi

umask 077
printf '%s\n%s\n' "$RELEASE_ID" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$PILHA/.preflight-ok"
echo "pre-flight APROVADO para $RELEASE_ID ($pendentes migração(ões) pendente(s))"
