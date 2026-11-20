#!/usr/bin/env bash
set -euo pipefail

VM="${1:-tria-producao-vm}"
ZONE="${2:-us-central1-a}"
PROJETO="$(gcloud config get-value project 2>/dev/null)"
BUCKET="${PROJETO}-${VM%-vm}-backups"

estado="$(gcloud compute instances describe "$VM" --zone "$ZONE" --format='value(status)')"

if [ "$estado" = "RUNNING" ] && [ "${SEM_BACKUP:-}" != "1" ]; then
  objeto="postgres/$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
  echo "backup lógico do postgres em gs://${BUCKET}/${objeto} ..."
  if gcloud compute ssh "$VM" --zone "$ZONE" --tunnel-through-iap --quiet --command "bash -s" <<REMOTO
set -euo pipefail
arquivo="\$(mktemp)"
trap 'rm -f "\$arquivo"' EXIT
sudo docker exec orla-postgres pg_dumpall -U postgres | gzip -9 > "\$arquivo"
token="\$(gcloud auth print-access-token)"
curl -sSf -X POST \
  -H "Authorization: Bearer \$token" \
  -H "Content-Type: application/gzip" \
  --data-binary @"\$arquivo" \
  "https://storage.googleapis.com/upload/storage/v1/b/${BUCKET}/o?uploadType=media&ifGenerationMatch=0&name=${objeto//\//%2F}" > /dev/null
echo "tamanho: \$(du -h "\$arquivo" | cut -f1)"
REMOTO
  then
    echo "backup gravado."
  else
    echo "AVISO: o backup lógico falhou; o snapshot diário do disco continua valendo. Desligando mesmo assim." >&2
  fi
fi

echo "desligando $VM em $ZONE — app, n8n e postgres ficam fora do ar até religar."
gcloud compute instances stop "$VM" --zone "$ZONE"
echo "desligada."
