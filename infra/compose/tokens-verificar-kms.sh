#!/bin/sh
set -eu

ARQUIVO="${1:-/opt/tria/.env}"
FORMATO='^projects/[a-z0-9-]+/locations/[a-z0-9-]+/keyRings/[A-Za-z0-9_-]+/cryptoKeys/[A-Za-z0-9_-]+$'

[ -f "$ARQUIVO" ] || { echo "arquivo de ambiente ausente: $ARQUIVO" >&2; exit 1; }
chave=$(sed -n 's/^TOKENS_KMS_KEY=//p' "$ARQUIVO" | tail -n 1)

if ! printf '%s' "$chave" | grep -q -E "$FORMATO"; then
  echo "TOKENS_KMS_KEY ausente ou fora do formato projects/.../cryptoKeys/... em $ARQUIVO." >&2
  echo "Sem ela o cofre de tokens falha fechado e o corte (0121/0122) deixaria todas as conexões sem como reautorizar. Deploy interrompido antes das migrações (ADR 0032)." >&2
  exit 1
fi

projeto=$(printf '%s' "$chave" | cut -d/ -f2)
local_=$(printf '%s' "$chave" | cut -d/ -f4)
anel=$(printf '%s' "$chave" | cut -d/ -f6)
nome=$(printf '%s' "$chave" | cut -d/ -f8)

pasta=$(mktemp -d)
trap 'rm -rf "$pasta"' EXIT
printf 'orla-verificacao-do-cofre-%s' "$(date +%s)" > "$pasta/claro"
printf 'orla.tokens.verificacao' > "$pasta/aad"

kms() {
  gcloud kms "$1" --quiet --project "$projeto" --location "$local_" --keyring "$anel" --key "$nome" \
    --additional-authenticated-data-file "$pasta/aad" --plaintext-file "$2" --ciphertext-file "$3"
}

kms encrypt "$pasta/claro" "$pasta/cifrado" || { echo "o KMS recusou cifrar com $chave (chave, IAM ou API)." >&2; exit 1; }
kms decrypt "$pasta/volta" "$pasta/cifrado" || { echo "o KMS recusou decifrar com $chave." >&2; exit 1; }

if ! cmp -s "$pasta/claro" "$pasta/volta"; then
  echo "o KMS devolveu outro conteúdo ao decifrar." >&2
  exit 1
fi
if cmp -s "$pasta/claro" "$pasta/cifrado"; then
  echo "o 'cifrado' é igual ao texto claro: o KMS não cifrou." >&2
  exit 1
fi
echo "cofre de tokens: cifrar e decifrar no KMS conferidos ($chave)"
