#!/bin/sh
set -eu

RAIZ=$(cd "$(dirname "$0")/.." && pwd)
COMPOSE="$RAIZ/infra/compose/docker-compose.prod.yml"
IMAGEM=$(sed -n 's/^[[:space:]]*image:[[:space:]]*\(caddy[^[:space:]]*\)$/\1/p' "$COMPOSE")
REDE="smoke-corpo-$$"
PORTA="${PORTA:-18080}"
APP="http://app.smoke.local"
UPSTREAM_IMAGEM="${UPSTREAM_IMAGEM:-node:22-alpine}"
UPSTREAM_JS="require('http').createServer((q,s)=>{let n=0;q.on('data',c=>{n+=c.length});q.on('error',()=>{});q.on('end',()=>s.end(String(n)))}).listen(Number(process.env.PORTA))"
N8N="http://n8n.smoke.local"

[ -n "$IMAGEM" ] || { echo "imagem do caddy não encontrada em $COMPOSE" >&2; exit 1; }

limpar() {
  docker rm -f "$REDE-proxy" "$REDE-app" "$REDE-n8n" > /dev/null 2>&1 || true
  docker network rm "$REDE" > /dev/null 2>&1 || true
}
trap limpar EXIT

docker network create "$REDE" > /dev/null
docker run -d --name "$REDE-app" --network "$REDE" --network-alias app -e PORTA=3000 "$UPSTREAM_IMAGEM" \
  node -e "$UPSTREAM_JS" > /dev/null
docker run -d --name "$REDE-n8n" --network "$REDE" --network-alias n8n -e PORTA=5678 "$UPSTREAM_IMAGEM" \
  node -e "$UPSTREAM_JS" > /dev/null
docker run -d --name "$REDE-proxy" --network "$REDE" -p "127.0.0.1:$PORTA:80" \
  -e APP_HOST="$APP" -e N8N_HOST="$N8N" -e ACME_EMAIL=smoke@example.invalid \
  -v "$RAIZ/infra/compose/Caddyfile:/etc/caddy/Caddyfile:ro" \
  -v "$RAIZ/infra/compose/n8n.caddy:/etc/caddy/n8n.caddy:ro" \
  "$IMAGEM" sh -c 'mkdir -p /etc/caddy/conf.d && cp /etc/caddy/n8n.caddy /etc/caddy/conf.d/n8n.caddy && exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile' > /dev/null

for tentativa in $(seq 1 30); do
  curl -s -o /dev/null "http://127.0.0.1:$PORTA/" -H "Host: app.smoke.local" && break
  sleep 1
done

CORPO=$(mktemp)
trap 'rm -f "$CORPO"; limpar' EXIT

falhas=0
conferir() {
  host="$1"; caminho="$2"; bytes="$3"; esperado="$4"
  head -c "$bytes" /dev/zero > "$CORPO"
  obtido=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Host: $host" \
    -H 'Content-Type: application/octet-stream' --data-binary "@$CORPO" "http://127.0.0.1:$PORTA$caminho")
  if [ "$obtido" = "$esperado" ]; then
    echo "ok    $host$caminho $bytes bytes -> $obtido"
  else
    echo "FALHA $host$caminho $bytes bytes -> $obtido (esperado $esperado)"
    falhas=$((falhas + 1))
  fi
}

conferir app.smoke.local /api/webhooks/whatsapp 500000 200
conferir app.smoke.local /api/webhooks/whatsapp 2000000 413
conferir app.smoke.local /api/v0/coleta/gravar 2000000 413
conferir app.smoke.local /api/v0/coleta/gravar 100 200
conferir app.smoke.local /api/v0/coleta/token 100 404
conferir app.smoke.local /api/v0/coleta/token/ 100 404
conferir app.smoke.local //api/v0/coleta/token 100 404
conferir app.smoke.local /api/v0/coleta/./token 100 404
conferir app.smoke.local /api/v0/coleta/%74oken 100 404
conferir app.smoke.local /api/v0/tokens/renovar-proativo 100 404
conferir app.smoke.local /api/v0/tarefas/token 100 404
conferir app.smoke.local /api/contexto/arquivos 20000000 200
conferir app.smoke.local /api/contexto/arquivos 31000000 413
conferir n8n.smoke.local /webhook/qualquer 2000000 413
conferir n8n.smoke.local /api/portaria/receber 2000000 413

[ "$falhas" -eq 0 ] || { docker logs "$REDE-proxy" 2>&1 | tail -n 20; exit 1; }
echo "limites de corpo do proxy conferidos"
