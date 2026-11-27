#!/bin/sh
set -u

PILHA="${PILHA:-/opt/tria}"
BLOQUEAR="${BLOQUEAR:-$PILHA/metadados-bloquear.sh}"
APP="${APP_CONTAINER:-orla-app}"
N8N="${N8N_CONTAINER:-orla-n8n}"
PROXY="${PROXY_CONTAINER:-orla-proxy}"
URL_IP=http://169.254.169.254/computeMetadata/v1/project/project-id
URL_NOME=http://metadata.google.internal/computeMetadata/v1/project/project-id
SAUDE_INTERNA=http://app:3000/api/health

SONDA='const u=process.argv[1];const h=process.argv[2]==="m"?{"Metadata-Flavor":"Google"}:{};fetch(u,{headers:h,signal:AbortSignal.timeout(5000)}).then((r)=>process.exit(r.ok?10:11),()=>process.exit(20))'
DNS='require("node:dns").promises.lookup(process.argv[1]).then(()=>process.exit(0),()=>process.exit(1))'

falhas=""
falhar() {
  echo "FALHA: $*" >&2
  falhas="$falhas
- $*"
}

sondar_node() {
  docker exec "$1" node -e "$SONDA" "$2" "$3" > /dev/null 2>&1
  echo $?
}

if sh "$BLOQUEAR" verificar; then :; else falhar "regras de bloqueio ausentes no host"; fi

codigo=$(sondar_node "$APP" "$URL_NOME" m)
if [ "$codigo" = 10 ]; then
  echo "ok: o app alcança o servidor de metadados"
else
  falhar "o app não alcançou o servidor de metadados (código $codigo); KMS, BigQuery e GCS dependem dele"
fi

codigo=$(sondar_node "$N8N" "$SAUDE_INTERNA" -)
if [ "$codigo" = 10 ]; then
  echo "ok: a sonda do n8n funciona (alcança $SAUDE_INTERNA)"
  for url in "$URL_IP" "$URL_NOME"; do
    codigo=$(sondar_node "$N8N" "$url" m)
    if [ "$codigo" = 20 ]; then
      echo "ok: o n8n não alcança $url"
    else
      falhar "o n8n alcançou $url (código $codigo)"
    fi
  done
else
  falhar "a sonda do n8n não funcionou nem contra $SAUDE_INTERNA (código $codigo): prova de bloqueio inconclusiva"
fi

if docker exec "$N8N" node -e "$DNS" oauth2.googleapis.com > /dev/null 2>&1; then
  echo "ok: o n8n resolve nomes externos"
else
  falhar "o n8n não resolve nomes externos (DNS pelo servidor de metadados quebrado?)"
fi

if docker exec "$PROXY" wget -q -T 5 -O /dev/null "$SAUDE_INTERNA" > /dev/null 2>&1; then
  if docker exec "$PROXY" wget -q -T 5 -O /dev/null --header 'Metadata-Flavor: Google' "$URL_IP" > /dev/null 2>&1; then
    falhar "o proxy alcançou $URL_IP"
  else
    echo "ok: o proxy não alcança $URL_IP"
  fi
else
  falhar "o wget do proxy não alcançou nem $SAUDE_INTERNA: prova de bloqueio inconclusiva"
fi

if [ -z "$falhas" ]; then
  echo "metadados: só o app alcança o servidor de metadados"
  exit 0
fi
echo "metadados REPROVADO:$falhas" >&2
exit 1
