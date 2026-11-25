#!/bin/sh
set -eu

PILHA="${PILHA:-/opt/tria}"
REDE_INTERNA="${REDE_INTERNA:-orla_interna}"
INTERNA_DESEJADA=true
BLOQUEAR="${BLOQUEAR:-$PILHA/metadados-bloquear.sh}"

compose() {
  docker compose -f "$PILHA/docker-compose.prod.yml" --project-directory "$PILHA" "$@"
}

atual=""
if docker network inspect "$REDE_INTERNA" > /dev/null 2>&1; then
  atual=$(docker network inspect -f '{{.Internal}}' "$REDE_INTERNA")
fi

recriar=0
if [ -n "$atual" ] && [ "$atual" != "$INTERNA_DESEJADA" ]; then
  recriar=1
fi

if [ "$recriar" = 1 ]; then
  grep -q '^APP_IMAGE=' "$PILHA/.env" || { echo "FALHA: $PILHA/.env sem APP_IMAGE; não dá para religar a versão atual depois de recriar a rede." >&2; exit 1; }
  echo "rede $REDE_INTERNA com internal=$atual e o compose pede internal=$INTERNA_DESEJADA: parando a pilha para recriar as redes (volumes intactos)"
  compose down --remove-orphans
fi

bloqueio=0
sh "$BLOQUEAR" instalar || bloqueio=1

if [ "$recriar" = 1 ]; then
  compose up -d
  echo "pilha religada com a versão atual do .env, nas redes novas"
elif grep -q '^APP_IMAGE=' "$PILHA/.env" 2>/dev/null && [ -z "$(docker ps -q --filter name=^orla-postgres$)" ]; then
  echo "pilha parada com versão conhecida no .env (transição interrompida?): religando"
  compose up -d
fi

if [ "$bloqueio" != 0 ]; then
  echo "FALHA: bloqueio de metadados não instalado; o deploy para aqui." >&2
  exit 1
fi
echo "rede e bloqueio de metadados prontos"
