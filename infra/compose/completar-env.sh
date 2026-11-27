#!/bin/sh
set -eu

ARQUIVO="${1:-/opt/tria/.env}"

valor() {
  sed -n "s/^$1=//p" "$ARQUIVO" | tail -n 1
}

codificar() {
  if printf '%s' "$1" | grep -q -E '^[A-Za-z0-9._~-]+$'; then
    printf '%s' "$1"
    return 0
  fi
  if command -v python3 > /dev/null 2>&1; then
    python3 -I -c 'import sys, urllib.parse; sys.stdout.write(urllib.parse.quote(sys.argv[1], safe=""))' "$1"
    return 0
  fi
  echo "WORKER_DB_PASSWORD tem caracteres que exigem codificação e não há python3 na máquina." >&2
  return 1
}

[ -f "$ARQUIVO" ] || { echo "arquivo de ambiente ausente: $ARQUIVO" >&2; exit 1; }

url_da_web=$(valor DATABASE_URL)
senha=$(valor WORKER_DB_PASSWORD)
[ -n "$url_da_web" ] || { echo "DATABASE_URL ausente em $ARQUIVO" >&2; exit 1; }
[ -n "$senha" ] || { echo "WORKER_DB_PASSWORD ausente em $ARQUIVO" >&2; exit 1; }

esquema="${url_da_web%%://*}"
destino="${url_da_web##*@}"
case "$esquema" in
  postgres|postgresql) ;;
  *) echo "DATABASE_URL com esquema inesperado: $esquema" >&2; exit 1 ;;
esac

url_do_worker="$esquema://orla_worker:$(codificar "$senha")@$destino"

metadado() {
  curl -sf --max-time 5 -H 'Metadata-Flavor: Google' "${METADADOS_URL:-http://metadata.google.internal/computeMetadata/v1}/$1" 2>/dev/null || true
}

chave_do_kms=$(valor TOKENS_KMS_KEY)
if [ -z "$chave_do_kms" ]; then
  projeto=$(metadado project/project-id)
  zona=$(metadado instance/zone)
  instancia=$(metadado instance/name)
  regiao=$(printf '%s' "${zona##*/}" | sed -E 's/-[a-z]$//')
  prefixo=${instancia%-vm}
  if [ -n "$projeto" ] && [ -n "$regiao" ] && [ -n "$instancia" ] && [ "$prefixo" != "$instancia" ]; then
    chave_do_kms="projects/$projeto/locations/$regiao/keyRings/$prefixo-tokens/cryptoKeys/conexoes"
    echo "TOKENS_KMS_KEY derivada dos metadados da VM (como o startup faz): $chave_do_kms"
  else
    echo "TOKENS_KMS_KEY ausente e os metadados da VM não responderam: a verificação do KMS vai barrar o deploy." >&2
  fi
fi

projeto_da_vm=""
instancia_da_vm=""
prefixo_da_vm=""
if [ -z "${METADADOS_URL:-}" ] && command -v gcloud > /dev/null 2>&1; then
  projeto_da_vm=$(metadado project/project-id)
  instancia_da_vm=$(metadado instance/name)
  prefixo_da_vm=${instancia_da_vm%-vm}
fi

vm_identificada() {
  [ -n "$projeto_da_vm" ] && [ -n "$instancia_da_vm" ] && [ "$prefixo_da_vm" != "$instancia_da_vm" ]
}

segredo_opcional() {
  vm_identificada || return 0
  gcloud secrets versions access latest --secret="$prefixo_da_vm-$1" --project="$projeto_da_vm" 2>/dev/null || true
}

pimenta_da_meta=$(valor META_EXCLUSAO_PEPPER)
[ -n "$pimenta_da_meta" ] || pimenta_da_meta=$(segredo_opcional meta-exclusao-pepper)
[ -n "$pimenta_da_meta" ] || echo "META_EXCLUSAO_PEPPER ausente: com META_APP_SECRET definido o app não sobe em produção (ADR 0033)." >&2

config_do_leadads=$(valor LEADADS_LOGIN_CONFIG_ID)
[ -n "$config_do_leadads" ] || config_do_leadads=$(segredo_opcional leadads-login-config-id)

webhook_de_alerta=$(valor ALERT_WEBHOOK_URL)
[ -n "$webhook_de_alerta" ] || webhook_de_alerta=$(segredo_opcional alert-webhook-url)

operadores_da_plataforma=$(valor PLATAFORMA_OPERADORES)
[ -n "$operadores_da_plataforma" ] || operadores_da_plataforma=$(segredo_opcional plataforma-operadores)
[ -n "$operadores_da_plataforma" ] || echo "PLATAFORMA_OPERADORES ausente: ninguém entra no n8n nem vê alertas de plataforma (ADR 0043)." >&2

segredo_de_borda=$(segredo_opcional proxy-secret)
if [ -z "$segredo_de_borda" ]; then
  segredo_de_borda=$(valor TRIA_PROXY_SECRET)
  [ -z "$segredo_de_borda" ] || ! vm_identificada || echo "TRIA_PROXY_SECRET: Secret Manager sem resposta, mantido o valor do .env (ADR 0060)." >&2
fi
[ -n "$segredo_de_borda" ] || echo "TRIA_PROXY_SECRET ausente: o IP do cliente fica desconhecido para o limitador (ADR 0060)." >&2

bucket_do_contexto=$(valor CONTEXT_BUCKET)
if [ -z "$bucket_do_contexto" ]; then
  projeto_do_bucket=$(metadado project/project-id)
  instancia_do_bucket=$(metadado instance/name)
  prefixo_do_bucket=${instancia_do_bucket%-vm}
  if [ -n "$projeto_do_bucket" ] && [ -n "$instancia_do_bucket" ] && [ "$prefixo_do_bucket" != "$instancia_do_bucket" ]; then
    bucket_do_contexto="$projeto_do_bucket-$prefixo_do_bucket-contexto"
    echo "CONTEXT_BUCKET derivado dos metadados da VM (convenção do contexto.tf): $bucket_do_contexto"
  else
    echo "CONTEXT_BUCKET ausente e os metadados da VM não responderam: o pre-flight da release vai barrar." >&2
  fi
fi

temporario=$(mktemp "$ARQUIVO.XXXXXX")
grep -v -e '^DATABASE_URL_WORKER=' -e '^TOKENS_KMS_KEY=' -e '^META_EXCLUSAO_PEPPER=' \
  -e '^LEADADS_LOGIN_CONFIG_ID=' -e '^ALERT_WEBHOOK_URL=' -e '^PLATAFORMA_OPERADORES=' -e '^TRIA_PROXY_SECRET=' -e '^CONTEXT_BUCKET=' "$ARQUIVO" > "$temporario" || true
printf 'DATABASE_URL_WORKER=%s\n' "$url_do_worker" >> "$temporario"
printf 'TOKENS_KMS_KEY=%s\n' "$chave_do_kms" >> "$temporario"
printf 'META_EXCLUSAO_PEPPER=%s\n' "$pimenta_da_meta" >> "$temporario"
printf 'LEADADS_LOGIN_CONFIG_ID=%s\n' "$config_do_leadads" >> "$temporario"
printf 'ALERT_WEBHOOK_URL=%s\n' "$webhook_de_alerta" >> "$temporario"
printf 'PLATAFORMA_OPERADORES=%s\n' "$operadores_da_plataforma" >> "$temporario"
printf 'TRIA_PROXY_SECRET=%s\n' "$segredo_de_borda" >> "$temporario"
printf 'CONTEXT_BUCKET=%s\n' "$bucket_do_contexto" >> "$temporario"
chmod 600 "$temporario"
mv "$temporario" "$ARQUIVO"
echo "DATABASE_URL_WORKER derivada de DATABASE_URL (papel orla_worker, destino $destino)"
