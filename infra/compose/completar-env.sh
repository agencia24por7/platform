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

temporario=$(mktemp "$ARQUIVO.XXXXXX")
grep -v -e '^DATABASE_URL_WORKER=' -e '^TOKENS_KMS_KEY=' "$ARQUIVO" > "$temporario" || true
printf 'DATABASE_URL_WORKER=%s\n' "$url_do_worker" >> "$temporario"
printf 'TOKENS_KMS_KEY=%s\n' "$chave_do_kms" >> "$temporario"
chmod 600 "$temporario"
mv "$temporario" "$ARQUIVO"
echo "DATABASE_URL_WORKER derivada de DATABASE_URL (papel orla_worker, destino $destino)"
