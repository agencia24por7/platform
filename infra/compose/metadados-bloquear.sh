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
PASTA_DAS_UNIDADES="${PASTA_DAS_UNIDADES:-/etc/systemd/system}"
NOME_DA_VIGIA=orla-metadados-vigiar
MARCADOR=orla-metadados-bloqueio-ausente
ARQUIVO_DE_ALERTA="${ARQUIVO_DE_ALERTA:-/var/log/orla/metadados-bloqueio.log}"
ARQUIVO_DE_TRAVA="${ARQUIVO_DE_TRAVA:-/run/lock/orla-metadados.lock}"
ESPERA_DA_TRAVA="${ESPERA_DA_TRAVA:-60}"
LIMITE_DO_ARQUIVO_DE_ALERTA="${LIMITE_DO_ARQUIVO_DE_ALERTA:-65536}"

uso() {
  echo "uso: metadados-bloquear.sh aplicar|instalar|verificar|vigiar" >&2
  echo "  aplicar    regras na DOCKER-USER: só a ponte $PONTE_DO_APP alcança $METADADOS_V4 (DNS na porta 53 segue liberado)" >&2
  echo "  instalar   copia o script para $INSTALADO, liga o drop-in do docker.service e aplica" >&2
  echo "  verificar  sai 0 só se as regras IPv4 e o salto (primeira regra da DOCKER-USER) estiverem no lugar" >&2
  echo "  vigiar     verificar; se falhar, reaplica uma vez e registra o marcador $MARCADOR no journal e em $ARQUIVO_DE_ALERTA (usado pelo timer $NOME_DA_VIGIA)" >&2
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

salto_na_frente() {
  tabelas="$1"
  lista=$("$tabelas" -w -t filter -S DOCKER-USER 2> /dev/null) || return 1
  primeira=$(printf '%s\n' "$lista" | grep -m 1 '^-A DOCKER-USER ' || true)
  [ "$primeira" = "-A DOCKER-USER -j $CADEIA" ]
}

regras_no_lugar() {
  tabelas="$1"
  regras="$2"
  "$tabelas" -w -t filter -S "$CADEIA" > /dev/null 2>&1 || return 1
  salto_na_frente "$tabelas" || return 1
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

posicoes_do_salto() {
  tabelas="$1"
  "$tabelas" -w -t filter -S DOCKER-USER 2> /dev/null | grep '^-A DOCKER-USER ' | awk -v alvo="-A DOCKER-USER -j $CADEIA" '$0 == alvo { print NR }'
}

remover_saltos_duplicados() {
  tabelas="$1"
  posicoes=$(posicoes_do_salto "$tabelas" | awk 'NR > 1 { print }' | sort -rn) || return 1
  for posicao in $posicoes; do
    "$tabelas" -w -t filter -D DOCKER-USER "$posicao" || return 1
  done
}

garantir_salto() {
  tabelas="$1"
  "$tabelas" -w -t filter -S DOCKER-USER > /dev/null 2>&1 || "$tabelas" -w -t filter -N DOCKER-USER
  salto_na_frente "$tabelas" && return 0
  "$tabelas" -w -t filter -I DOCKER-USER 1 -j "$CADEIA" || return 1
  remover_saltos_duplicados "$tabelas"
}

travar() {
  command -v flock > /dev/null 2>&1 || return 0
  pasta_da_trava=$(dirname "$ARQUIVO_DE_TRAVA")
  mkdir -p "$pasta_da_trava" 2> /dev/null && [ -w "$pasta_da_trava" ] || { echo "aviso: sem pasta gravável para a trava $ARQUIVO_DE_TRAVA; seguindo sem serializar" >&2; return 0; }
  exec 9> "$ARQUIVO_DE_TRAVA"
  flock -w "$ESPERA_DA_TRAVA" 9 || echo "aviso: não obtive a trava $ARQUIVO_DE_TRAVA em ${ESPERA_DA_TRAVA}s; aplicando sem serializar" >&2
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

conferir_v4() {
  regras_no_lugar iptables "$(regras_v4)"
}

gravar_no_arquivo_de_alerta() {
  linha="$1"
  pasta=$(dirname "$ARQUIVO_DE_ALERTA")
  if ! (umask 027; mkdir -p "$pasta" && { [ -e "$ARQUIVO_DE_ALERTA" ] || : > "$ARQUIVO_DE_ALERTA"; }) 2> /dev/null; then
    echo "aviso: não consegui preparar $ARQUIVO_DE_ALERTA; o alerta na nuvem não verá esta ocorrência" >&2
    return 0
  fi
  chmod 0640 "$ARQUIVO_DE_ALERTA" 2> /dev/null || true
  tamanho=$(wc -c < "$ARQUIVO_DE_ALERTA" 2> /dev/null || echo 0)
  if [ "$tamanho" -gt "$LIMITE_DO_ARQUIVO_DE_ALERTA" ]; then
    : > "$ARQUIVO_DE_ALERTA" 2> /dev/null || true
  fi
  printf '%s\n' "$linha" >> "$ARQUIVO_DE_ALERTA" 2> /dev/null \
    || echo "aviso: não consegui gravar em $ARQUIVO_DE_ALERTA; o alerta na nuvem não verá esta ocorrência" >&2
}

registrar_ausencia() {
  resultado="$1"
  prefixo=""
  if [ -n "${JOURNAL_STREAM:-}" ]; then prefixo="<3>"; fi
  linha=$(printf '{"severity":"error","marker":"%s","resultado":"%s","message":"bloqueio de metadados da VM ausente ou diferente do esperado"}' \
    "$MARCADOR" "$resultado")
  printf '%s%s\n' "$prefixo" "$linha"
  gravar_no_arquivo_de_alerta "$linha"
}

vigiar() {
  if conferir_v4; then
    return 0
  fi
  if aplicar && conferir_v4; then
    registrar_ausencia reinstalado
    return 0
  fi
  registrar_ausencia persistente
  return 1
}

instalar_vigia() {
  servico="$PASTA_DAS_UNIDADES/$NOME_DA_VIGIA.service"
  temporizador="$PASTA_DAS_UNIDADES/$NOME_DA_VIGIA.timer"
  mkdir -p "$PASTA_DAS_UNIDADES"
  novo_servico=$(printf '[Unit]\nDescription=Confere o bloqueio de metadados da VM (ORLA)\nAfter=docker.service\n\n[Service]\nType=oneshot\nExecStart=%s vigiar\n' "$INSTALADO")
  novo_temporizador=$(printf '[Unit]\nDescription=Confere o bloqueio de metadados da VM a cada poucos minutos (ORLA)\n\n[Timer]\nOnBootSec=2min\nOnUnitInactiveSec=5min\nAccuracySec=30s\n\n[Install]\nWantedBy=timers.target\n')
  mudou=0
  if [ "$(cat "$servico" 2>/dev/null || true)" != "$novo_servico" ]; then
    printf '%s\n' "$novo_servico" > "$servico"
    mudou=1
  fi
  if [ "$(cat "$temporizador" 2>/dev/null || true)" != "$novo_temporizador" ]; then
    printf '%s\n' "$novo_temporizador" > "$temporizador"
    mudou=1
  fi
  if [ "$mudou" -eq 1 ]; then
    systemctl daemon-reload
    echo "unidades $NOME_DA_VIGIA gravadas: o timer confere o bloqueio no boot e a cada 5 minutos"
  fi
  systemctl enable --now "$NOME_DA_VIGIA.timer"
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
  erro_da_vigia=0
  instalar_vigia || erro_da_vigia=1
  travar
  erro_do_bloqueio=0
  aplicar || erro_do_bloqueio=1
  if [ "$erro_da_vigia" -eq 1 ]; then
    echo "FALHA: a vigia $NOME_DA_VIGIA não foi instalada ou ligada; o bloqueio foi aplicado mesmo assim" >&2
  fi
  [ "$((erro_da_vigia + erro_do_bloqueio))" -eq 0 ]
}

case "$ACAO" in
  aplicar) travar; aplicar ;;
  instalar) instalar ;;
  vigiar) travar; vigiar ;;
  verificar)
    if conferir_v4; then
      echo "ok: bloqueio de metadados no lugar (cadeia $CADEIA, salto em DOCKER-USER)"
    else
      echo "FALHA: bloqueio de metadados ausente ou diferente do esperado" >&2
      exit 1
    fi
    ;;
  -h|--help|--ajuda) uso ;;
  *) uso; exit 2 ;;
esac
