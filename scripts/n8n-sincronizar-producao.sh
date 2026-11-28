#!/usr/bin/env bash
set -euo pipefail
set +x
cd "$(dirname "$0")/.."

USO='uso: scripts/n8n-sincronizar-producao.sh --projeto <id> --vm <nome> [--zona <zona>] [--aplicar] [--criar] [--adotar]
       scripts/n8n-sincronizar-producao.sh --projeto <id> --vm <nome> [--zona <zona>] --ativar <id> [--aplicar]

Abre o túnel IAP até o n8n da VM (só em 127.0.0.1), lê a chave da API do Secret Manager (<vm sem -vm>-n8n-api-key)
sem eco, roda npm run n8n:sincronizar com as opções dadas e fecha o túnel ao sair (ADR 0009, ADR 0069 §1).
Com --ativar <id>: roda scripts/n8n-ativar.mjs, que recusa sem mostrar conteúdo o que tiver a tag credaz ou
agencia ou não for da plataforma (ADR 0053) e, com --aplicar, ativa só esse workflow (não sincroniza).
Sem alvo padrão (ADR 0028): --projeto e --vm são obrigatórios. Sem --aplicar, só simula.'

PROJETO=""
VM=""
ZONA="us-central1-a"
ATIVAR=""
APLICAR=""
REPASSE=()

valor() {
  [[ $# -ge 2 && -n "$2" && "$2" != --* ]] || { echo "$1 exige um valor" >&2; echo "$USO" >&2; exit 2; }
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help|--ajuda) echo "$USO"; exit 0 ;;
    --projeto) valor "$@"; PROJETO="$2"; shift 2 ;;
    --vm) valor "$@"; VM="$2"; shift 2 ;;
    --zona) valor "$@"; ZONA="$2"; shift 2 ;;
    --ativar) valor "$@"; ATIVAR="$2"; shift 2 ;;
    --aplicar) APLICAR="--aplicar"; shift ;;
    --criar|--adotar) REPASSE+=("$1"); shift ;;
    *) echo "opção desconhecida: $1" >&2; echo "$USO" >&2; exit 2 ;;
  esac
done

[[ "$PROJETO" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] || { echo "--projeto ausente ou fora do formato" >&2; exit 2; }
[[ "$VM" =~ ^[a-z][a-z0-9-]{0,61}-vm$ ]] || { echo "--vm ausente ou fora do formato (<prefixo>-vm)" >&2; exit 2; }
[[ "$ZONA" =~ ^[a-z]+-[a-z]+[0-9]-[a-z]$ ]] || { echo "--zona fora do formato" >&2; exit 2; }
if [[ -n "$ATIVAR" ]]; then
  [[ "$ATIVAR" =~ ^[A-Za-z0-9]{8,32}$ ]] || { echo "--ativar exige o id do workflow" >&2; exit 2; }
  [[ ${#REPASSE[@]} -eq 0 ]] || { echo "--ativar não se combina com --criar ou --adotar" >&2; exit 2; }
fi

SEGREDO="${VM%-vm}-n8n-api-key"
PORTA_LOCAL=15678
URL_LOCAL="http://127.0.0.1:$PORTA_LOCAL"
MODO="simulação"
[[ -n "$APLICAR" ]] && MODO="APLICA"
ACAO="sincronizar ${REPASSE[*]:-}"
[[ -n "$ATIVAR" ]] && ACAO="ativar $ATIVAR"

echo "alvo: projeto=$PROJETO vm=$VM zona=$ZONA segredo=$SEGREDO modo=$MODO ação=$ACAO"

command -v lsof > /dev/null || { echo "lsof é necessário para conferir a porta do túnel" >&2; exit 1; }
porta_ocupada() { lsof -nP -iTCP:"$PORTA_LOCAL" -sTCP:LISTEN > /dev/null 2>&1; }

if porta_ocupada; then
  echo "a porta $PORTA_LOCAL já está em uso: feche o túnel ou o processo que a ocupa antes de rodar este script" >&2
  exit 1
fi

IP=$(gcloud compute ssh "$VM" --project "$PROJETO" --zone "$ZONA" --tunnel-through-iap --quiet --command \
  "sudo docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' orla-n8n" 2>/dev/null | awk '{print $1}')
[[ "$IP" =~ ^[0-9.]+$ ]] || { echo "não achei o IP do orla-n8n na VM (ela está ligada?)" >&2; exit 1; }

fechar_tunel() {
  kill -TERM -- "-$TUNEL" 2>/dev/null || kill -TERM "$TUNEL" 2>/dev/null || true
  for _ in 1 2 3 4 5; do porta_ocupada || return 0; sleep 1; done
  kill -KILL -- "-$TUNEL" 2>/dev/null || true
  porta_ocupada && echo "aviso: o túnel na porta $PORTA_LOCAL continua aberto; encerre-o à mão" >&2
  return 0
}

set -m
gcloud compute ssh "$VM" --project "$PROJETO" --zone "$ZONA" --tunnel-through-iap --quiet -- \
  -N -o ExitOnForwardFailure=yes -L "127.0.0.1:$PORTA_LOCAL:$IP:5678" > /dev/null 2>&1 &
TUNEL=$!
set +m
trap fechar_tunel EXIT
trap 'exit 1' HUP INT TERM

curl -q -sf -o /dev/null --retry 15 --retry-delay 2 --retry-connrefused --max-time 5 "$URL_LOCAL/healthz" \
  || { echo "o n8n não respondeu pelo túnel" >&2; exit 1; }
kill -0 "$TUNEL" 2>/dev/null || { echo "o túnel caiu antes de usar a chave" >&2; exit 1; }
OUVINTES=$(lsof -nP -t -iTCP:"$PORTA_LOCAL" -sTCP:LISTEN 2>/dev/null || true)
[[ -n "$OUVINTES" ]] || { echo "não achei quem escuta a porta $PORTA_LOCAL" >&2; exit 1; }
for pid in $OUVINTES; do
  grupo=$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')
  [[ "$grupo" == "$TUNEL" ]] || { echo "a porta $PORTA_LOCAL é de outro processo (pid $pid), não do túnel: a chave não é lida" >&2; exit 1; }
done

CHAVE=$(gcloud secrets versions access latest --secret="$SEGREDO" --project "$PROJETO" 2>/dev/null) \
  || { echo "não consegui ler o segredo $SEGREDO" >&2; exit 1; }
[[ -n "$CHAVE" ]] || { echo "o segredo $SEGREDO está vazio" >&2; exit 1; }

if [[ -n "$ATIVAR" ]]; then
  N8N_API_URL="$URL_LOCAL" N8N_API_KEY="$CHAVE" \
    node --experimental-strip-types scripts/n8n-ativar.mjs "$ATIVAR" ${APLICAR:+"$APLICAR"}
  exit $?
fi

N8N_API_URL="$URL_LOCAL" N8N_API_KEY="$CHAVE" \
  npm run -s n8n:sincronizar -- ${REPASSE[@]+"${REPASSE[@]}"} ${APLICAR:+"$APLICAR"}
