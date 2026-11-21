#!/bin/sh
set -u

VM="${VM:?VM ausente}"
ZONE="${ZONE:?ZONE ausente}"
RELEASE_ID="${RELEASE_ID:?RELEASE_ID ausente}"
IMAGEM="${IMAGEM:?IMAGEM ausente}"
RELEASE_CORTE_AUTORIZADO="${RELEASE_CORTE_AUTORIZADO:-0}"
BQ_DDL_APLICADO="${BQ_DDL_APLICADO:-}"
DISCO="${DISCO:-${VM%-vm}-dados}"
BACKUP_MAX_HORAS="${BACKUP_MAX_HORAS:-24}"
TENTATIVAS_DO_SSH="${TENTATIVAS_DO_SSH:-5}"
PAUSA_DO_SSH="${PAUSA_DO_SSH:-15}"

recusar() { echo "pre-flight: $*" >&2; exit 2; }

printf '%s' "$RELEASE_ID" | grep -q -E '^[0-9a-f]{7,40}$' || recusar "RELEASE_ID fora do formato de sha"
printf '%s' "$IMAGEM" | grep -q -E '^[a-z0-9.:/_@-]+$' || recusar "IMAGEM fora do formato esperado"
printf '%s' "$RELEASE_CORTE_AUTORIZADO" | grep -q -E '^[01]$' || recusar "RELEASE_CORTE_AUTORIZADO deve ser 0 ou 1"
case "$BQ_DDL_APLICADO" in
  *[!A-Za-z0-9._-]*) recusar "BQ_DDL_APLICADO com caractere inválido" ;;
esac

echo "== pre-flight da release $RELEASE_ID (corte autorizado: $RELEASE_CORTE_AUTORIZADO)"

estado=$(gcloud compute instances describe "$VM" --zone "$ZONE" --format='value(status)' 2>/dev/null || true)
[ "$estado" = "RUNNING" ] || { echo "FALHA: $VM não está RUNNING (estado: ${estado:-desconhecido}). Ligue com scripts/vm-ligar.sh." >&2; exit 1; }
echo "ok: $VM RUNNING"

ultimo=$(gcloud compute snapshots list --filter="sourceDisk~/disks/$DISCO\$ AND status=READY" \
  --sort-by=~creationTimestamp --limit=1 --format='value(creationTimestamp)' 2>/dev/null || true)
if [ -z "$ultimo" ]; then
  idade=""
else
  idade=$(node -e 'const t = Date.parse(process.argv[1]); process.stdout.write(Number.isNaN(t) ? "" : String(Math.floor((Date.now() - t) / 3600000)))' "$ultimo")
fi
if [ -z "$idade" ] || [ "$idade" -ge "$BACKUP_MAX_HORAS" ]; then
  echo "FALHA: não há snapshot READY do disco $DISCO com menos de ${BACKUP_MAX_HORAS} h (último: ${ultimo:-nenhum})." >&2
  echo "Tire um agora e rode o deploy de novo:" >&2
  echo "  gcloud compute disks snapshot $DISCO --zone $ZONE --snapshot-names=$DISCO-pre-release-\$(date -u +%Y%m%d%H%M)" >&2
  exit 1
fi
echo "ok: snapshot do disco $DISCO com ${idade} h ($ultimo)"

comando="sudo env RELEASE_ID='$RELEASE_ID' IMAGEM='$IMAGEM' RELEASE_CORTE_AUTORIZADO='$RELEASE_CORTE_AUTORIZADO' BQ_DDL_APLICADO='$BQ_DDL_APLICADO' sh /opt/tria/preflight-vm.sh"
n=1
while :; do
  gcloud compute ssh "$VM" --zone "$ZONE" --tunnel-through-iap --quiet --command "$comando"
  status=$?
  [ "$status" -eq 255 ] || break
  [ "$n" -lt "$TENTATIVAS_DO_SSH" ] || { echo "FALHA: o túnel IAP caiu $n vez(es); pre-flight não concluído." >&2; exit 1; }
  echo "tentativa $n: o túnel IAP caiu; repetindo em ${PAUSA_DO_SSH}s"
  n=$((n + 1))
  sleep "$PAUSA_DO_SSH"
done

case "$status" in
  0) echo "pre-flight aprovado: pode migrar." ;;
  3) echo "pre-flight BLOQUEADO: corte sem autorização. Nada foi tocado no banco." >&2 ;;
  *) echo "pre-flight REPROVADO (código $status). Nada foi tocado no banco." >&2 ;;
esac
exit "$status"
