#!/usr/bin/env bash
set -euo pipefail

SERVICO="${1:?uso: scripts/tunel.sh n8n|postgres}"
VM="${VM:-tria-producao-vm}"
ZONE="${ZONE:-us-central1-a}"

case "$SERVICO" in
  n8n) CONTAINER=orla-n8n; PORTA=5678; LOCAL=15678 ;;
  postgres) CONTAINER=orla-postgres; PORTA=5432; LOCAL=15432 ;;
  *) echo "serviço desconhecido: $SERVICO (use n8n ou postgres)" >&2; exit 1 ;;
esac

IP=$(gcloud compute ssh "$VM" --zone "$ZONE" --tunnel-through-iap --command \
  "sudo docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' $CONTAINER" 2>/dev/null | awk '{print $1}')
[[ "$IP" =~ ^[0-9.]+$ ]] || { echo "não achei o IP de $CONTAINER na VM (ela está ligada?)" >&2; exit 1; }

echo "$SERVICO em localhost:$LOCAL (Ctrl+C encerra)"
exec gcloud compute ssh "$VM" --zone "$ZONE" --tunnel-through-iap -- -N -L "$LOCAL:$IP:$PORTA"
