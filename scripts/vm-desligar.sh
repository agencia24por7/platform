#!/usr/bin/env bash
set -euo pipefail

VM="${1:-tria-producao-vm}"
ZONE="${2:-us-central1-a}"
PROJETO="$(gcloud config get-value project 2>/dev/null)"
BUCKET="${PROJETO}-${VM%-vm}-backups"

estado="$(gcloud compute instances describe "$VM" --zone "$ZONE" --format='value(status)')"

if [ "$estado" = "RUNNING" ] && [ "${SEM_BACKUP:-}" != "1" ]; then
  carimbo="$(date -u +%Y%m%dT%H%M%SZ)"
  destino="gs://${BUCKET}/postgres/${carimbo}.sql.gz"
  echo "backup lógico do postgres em ${destino} ..."
  if gcloud compute ssh "$VM" --zone "$ZONE" --tunnel-through-iap --quiet --command \
    "set -o pipefail; sudo docker exec orla-postgres pg_dumpall -U postgres | gzip -9 | gcloud storage cp - '${destino}' --quiet"; then
    echo "backup gravado."
  else
    echo "AVISO: o backup lógico falhou; o snapshot diário do disco continua valendo. Desligando mesmo assim." >&2
  fi
fi

echo "desligando $VM em $ZONE — app, n8n e postgres ficam fora do ar até religar."
gcloud compute instances stop "$VM" --zone "$ZONE"
echo "desligada."
