#!/usr/bin/env bash
set -euo pipefail

VM="${1:-tria-producao-vm}"
ZONE="${2:-us-central1-a}"

echo "desligando $VM em $ZONE — app, n8n e postgres ficam fora do ar até religar."
gcloud compute instances stop "$VM" --zone "$ZONE"
echo "desligada."
