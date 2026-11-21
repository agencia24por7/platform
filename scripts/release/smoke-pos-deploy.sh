#!/bin/sh
set -u

BASE="${1:?uso: smoke-pos-deploy.sh https://<host>}"
TENTATIVAS_DA_SAUDE="${TENTATIVAS_DA_SAUDE:-20}"
PAUSA_DA_SAUDE="${PAUSA_DA_SAUDE:-10}"
RELEASE_ID="${RELEASE_ID:-desconhecida}"
ALERT_WEBHOOK_URL="${ALERT_WEBHOOK_URL:-}"

falhas=""

codigo() {
  curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$@" 2>/dev/null || true
}

conferir() {
  descricao="$1"
  esperado="$2"
  shift 2
  obtido=$(codigo "$@")
  if [ "$obtido" = "$esperado" ]; then
    echo "ok: $descricao ($obtido)"
  else
    echo "FALHA: $descricao: esperado $esperado, veio ${obtido:-nada}" >&2
    falhas="$falhas
- $descricao: esperado $esperado, veio ${obtido:-nada}"
  fi
}

saude=""
n=1
while [ "$n" -le "$TENTATIVAS_DA_SAUDE" ]; do
  saude=$(codigo "$BASE/api/health")
  [ "$saude" = "200" ] && break
  n=$((n + 1))
  [ "$n" -le "$TENTATIVAS_DA_SAUDE" ] && sleep "$PAUSA_DA_SAUDE"
done
if [ "$saude" = "200" ]; then
  echo "ok: /api/health (200)"
else
  falhas="$falhas
- /api/health não respondeu 200 (último: ${saude:-nada})"
fi

conferir "rota do worker sem token recusa" 401 "$BASE/api/v0/sync/queue"
conferir "cofre: /api/v0/coleta/token não passa pelo proxy (GET)" 404 "$BASE/api/v0/coleta/token"
conferir "cofre: /api/v0/coleta/token não passa pelo proxy (POST)" 404 -X POST -H 'Content-Type: application/json' --data '{}' "$BASE/api/v0/coleta/token"
conferir "cofre: /api/v0/tokens/renovar-proativo não passa pelo proxy" 404 -X POST -H 'Content-Type: application/json' --data '{}' "$BASE/api/v0/tokens/renovar-proativo"
conferir "cofre: /api/v0/tarefas/token não passa pelo proxy" 404 -X POST -H 'Content-Type: application/json' --data '{}' "$BASE/api/v0/tarefas/token"

if [ -z "$falhas" ]; then
  echo "smoke pós-deploy aprovado ($RELEASE_ID)"
  exit 0
fi

echo "smoke pós-deploy REPROVADO ($RELEASE_ID):$falhas" >&2
if [ -n "$ALERT_WEBHOOK_URL" ]; then
  texto=$(printf 'ORLA deploy %s: smoke pós-deploy reprovado em %s%s' "$RELEASE_ID" "$BASE" "$falhas" | node -e 'let t="";process.stdin.on("data",(d)=>t+=d).on("end",()=>process.stdout.write(JSON.stringify({text:t})))')
  curl -s -o /dev/null --max-time 10 -X POST -H 'Content-Type: application/json' --data "$texto" "$ALERT_WEBHOOK_URL" \
    && echo "alerta enviado" || echo "aviso: o alerta não foi entregue" >&2
fi
exit 1
