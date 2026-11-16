#!/usr/bin/env bash
set -euo pipefail

VM="${1:-tria-producao-vm}"
ZONE="${2:-us-central1-a}"

gcloud compute instances start "$VM" --zone "$ZONE"

echo "aguardando a aplicação responder..."
for tentativa in $(seq 1 30); do
  if curl -sf "https://${APP_HOSTNAME:-platform.agencia24por7.com}/api/health" > /dev/null; then
    echo "no ar."
    exit 0
  fi
  sleep 5
done

echo "a VM subiu mas a aplicação ainda não respondeu depois de ~2.5min — confira manualmente." >&2
exit 1
