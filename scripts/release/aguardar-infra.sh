#!/bin/sh
set -u

SHA="${SHA:?SHA ausente}"
INFRA_ESPERADO="${INFRA_ESPERADO:-auto}"
TEMPO_MAXIMO="${TEMPO_MAXIMO:-1500}"
CARENCIA="${CARENCIA:-120}"
INTERVALO="${INTERVALO:-20}"
WORKFLOW="${WORKFLOW:-infra.yml}"

case "$INFRA_ESPERADO" in
  0|1|auto) ;;
  *) echo "INFRA_ESPERADO deve ser 0, 1 ou auto" >&2; exit 2 ;;
esac

inicio=$(date +%s)
echo "aguardando o $WORKFLOW do commit $SHA (infra esperada: $INFRA_ESPERADO, até ${TEMPO_MAXIMO}s)"
while :; do
  decorrido=$(( $(date +%s) - inicio ))
  linha=$(gh run list --workflow "$WORKFLOW" --commit "$SHA" --limit 1 --json status,conclusion,databaseId \
    --jq '.[0] | select(.) | "\(.status) \(.conclusion) \(.databaseId)"' 2>/dev/null) || {
    echo "não consegui consultar as execuções do $WORKFLOW (permissão actions: read?)" >&2
    exit 1
  }

  if [ -z "$linha" ]; then
    if [ "$decorrido" -ge "$CARENCIA" ]; then
      if [ "$INFRA_ESPERADO" = "1" ]; then
        echo "FALHA: o commit mexeu em infra/terraform, mas nenhum $WORKFLOW apareceu em ${CARENCIA}s." >&2
        exit 1
      fi
      echo "nenhum $WORKFLOW para este commit (sem mudança de Terraform): segue o deploy."
      exit 0
    fi
  else
    set -- $linha
    estado="$1"
    conclusao="${2:-}"
    execucao="${3:-}"
    if [ "$estado" = "completed" ]; then
      if [ "$conclusao" = "success" ]; then
        echo "ok: $WORKFLOW $execucao aplicado com sucesso; KMS, bucket e metadados da VM estão no lugar."
        exit 0
      fi
      echo "FALHA: $WORKFLOW $execucao terminou com '$conclusao'. O deploy não migra sobre infra pela metade." >&2
      exit 1
    fi
    echo "$WORKFLOW $execucao: $estado (${decorrido}s); lembre de aprovar o ambiente producao do apply."
  fi

  if [ "$decorrido" -ge "$TEMPO_MAXIMO" ]; then
    echo "FALHA: o $WORKFLOW não terminou em ${TEMPO_MAXIMO}s." >&2
    exit 1
  fi
  sleep "$INTERVALO"
done
