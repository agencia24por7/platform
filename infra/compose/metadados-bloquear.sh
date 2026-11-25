#!/bin/sh
set -eu

ACAO="${1:-}"
PONTE_DO_APP="${PONTE_DO_APP:-orla-app}"
CADEIA="${CADEIA:-ORLA-METADADOS}"
METADADOS_V4=169.254.169.254
METADADOS_V6=fd20:ce::254
INSTALADO="${INSTALADO:-/usr/local/sbin/orla-metadados-bloquear}"
PASTA_DO_DOCKER="${PASTA_DO_DOCKER:-/etc/systemd/system/docker.service.d}"
UNIDADE_DO_DOCKER="$PASTA_DO_DOCKER/orla-metadados.conf"

uso() {
  echo "uso: metadados-bloquear.sh aplicar|instalar|verificar" >&2
  echo "  aplicar    regras na DOCKER-USER: só a ponte $PONTE_DO_APP alcança $METADADOS_V4 (DNS na porta 53 segue liberado)" >&2
  echo "  instalar   copia o script para $INSTALADO, liga o drop-in do docker.service e aplica" >&2
  echo "  verificar  sai 0 só se as regras IPv4 e o salto estiverem no lugar" >&2
}

regras_v4() {
  printf '%s\n' \
    "-d $METADADOS_V4/32 -p udp -m udp --dport 53 -j RETURN" \
    "-d $METADADOS_V4/32 -p tcp -m tcp --dport 53 -j RETURN" \
    "-d $METADADOS_V4/32 -i $PONTE_DO_APP -j RETURN" \
    "-d $METADADOS_V4/32 -p tcp -j REJECT --reject-with tcp-reset" \
    "-d $METADADOS_V4/32 -j REJECT --reject-with icmp-port-unreachable"
}

regras_v6() {
  printf '%s\n' \
    "-d $METADADOS_V6/128 -p udp -m udp --dport 53 -j RETURN" \
    "-d $METADADOS_V6/128 -p tcp -m tcp --dport 53 -j RETURN" \
    "-d $METADADOS_V6/128 -p tcp -j REJECT --reject-with tcp-reset" \
    "-d $METADADOS_V6/128 -j REJECT --reject-with icmp6-port-unreachable"
}

regras_no_lugar() {
  tabelas="$1"
  regras="$2"
  "$tabelas" -w -t filter -S "$CADEIA" > /dev/null 2>&1 || return 1
  "$tabelas" -w -t filter -C DOCKER-USER -j "$CADEIA" > /dev/null 2>&1 || return 1
  esperadas=0
  while IFS= read -r regra; do
    [ -n "$regra" ] || continue
    esperadas=$((esperadas + 1))
    "$tabelas" -w -t filter -C "$CADEIA" $regra > /dev/null 2>&1 || return 1
  done <<REGRAS
$regras
REGRAS
  presentes=$("$tabelas" -w -t filter -S "$CADEIA" | grep -c "^-A $CADEIA " || true)
  [ "$presentes" -eq "$esperadas" ]
}

reescrever_cadeia() {
  restaurar="$1"
  regras="$2"
  {
    echo "*filter"
    echo ":$CADEIA - [0:0]"
    echo "-F $CADEIA"
    printf '%s\n' "$regras" | while IFS= read -r regra; do
      [ -n "$regra" ] && echo "-A $CADEIA $regra"
    done
    echo "COMMIT"
  } | "$restaurar" -w --noflush
}

garantir_salto() {
  tabelas="$1"
  "$tabelas" -w -t filter -S DOCKER-USER > /dev/null 2>&1 || "$tabelas" -w -t filter -N DOCKER-USER
  "$tabelas" -w -t filter -C DOCKER-USER -j "$CADEIA" > /dev/null 2>&1 \
    || "$tabelas" -w -t filter -I DOCKER-USER 1 -j "$CADEIA"
}

aplicar_familia() {
  tabelas="$1"
  restaurar="$2"
  regras="$3"
  if regras_no_lugar "$tabelas" "$regras"; then
    echo "$tabelas: regras de metadados já no lugar"
    return 0
  fi
  reescrever_cadeia "$restaurar" "$regras" || return 1
  garantir_salto "$tabelas" || return 1
  regras_no_lugar "$tabelas" "$regras" || { echo "$tabelas: as regras não conferem depois de aplicadas" >&2; return 1; }
  echo "$tabelas: regras de metadados aplicadas (só $PONTE_DO_APP alcança o servidor de metadados)"
}

aplicar() {
  command -v iptables > /dev/null 2>&1 || { echo "FALHA: iptables ausente; o bloqueio de metadados não foi aplicado" >&2; return 1; }
  aplicar_familia iptables iptables-restore "$(regras_v4)" || { echo "FALHA: bloqueio IPv4 de metadados não aplicado" >&2; return 1; }
  if command -v ip6tables > /dev/null 2>&1; then
    aplicar_familia ip6tables ip6tables-restore "$(regras_v6)" || echo "aviso: bloqueio IPv6 de metadados não aplicado (a pilha não usa IPv6)" >&2
  else
    echo "aviso: ip6tables ausente; bloqueio IPv6 de metadados não aplicado (a pilha não usa IPv6)" >&2
  fi
}

instalar() {
  origem="$0"
  [ -f "$origem" ] || { echo "FALHA: não achei o próprio script em $origem" >&2; return 1; }
  if ! cmp -s "$origem" "$INSTALADO" 2>/dev/null; then
    mkdir -p "$(dirname "$INSTALADO")"
    install -m 0755 "$origem" "$INSTALADO"
  fi
  mkdir -p "$PASTA_DO_DOCKER"
  novo=$(printf '[Service]\nExecStartPre=-%s aplicar\nExecStartPost=-%s aplicar\n' "$INSTALADO" "$INSTALADO")
  if [ "$(cat "$UNIDADE_DO_DOCKER" 2>/dev/null || true)" != "$novo" ]; then
    printf '%s\n' "$novo" > "$UNIDADE_DO_DOCKER"
    systemctl daemon-reload
    echo "drop-in $UNIDADE_DO_DOCKER gravado: o docker reaplica o bloqueio antes e depois de cada início"
  fi
  aplicar
}

case "$ACAO" in
  aplicar) aplicar ;;
  instalar) instalar ;;
  verificar)
    if regras_no_lugar iptables "$(regras_v4)"; then
      echo "ok: bloqueio de metadados no lugar (cadeia $CADEIA, salto em DOCKER-USER)"
    else
      echo "FALHA: bloqueio de metadados ausente ou diferente do esperado" >&2
      exit 1
    fi
    ;;
  -h|--help|--ajuda) uso ;;
  *) uso; exit 2 ;;
esac
