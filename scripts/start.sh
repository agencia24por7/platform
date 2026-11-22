#!/usr/bin/env bash
set -euo pipefail

raiz=$(cd "$(dirname "$0")/.." && pwd)
cd "$raiz"

uso() {
  cat <<'EOF'
Uso: scripts/start.sh [opções] [tarefa em texto livre]

Inicia uma sessão Claude no projeto platform já como o agente "arquiteto",
com o índice de ADRs, as regras e o HANDOFF injetados pelo hook de início.

  --opus               força o Opus (planejamento e arquitetura)
  --modelo <id>        força o modelo (sonnet, opus, haiku ou id completo)
  --esforco <nivel>    força o esforço (low, medium, high, xhigh, max)
  --sem-auto           não escolhe modelo e esforço pela tarefa (usa o padrão do agente)
  --worktree <nome>    abre a tarefa num worktree novo (pelo Orca, se estiver rodando; senão claude -w)
  --dry-run            imprime o comando e não executa
  -h, --help           esta ajuda

Com uma tarefa em texto e sem --modelo/--opus, o modelo e o esforço são escolhidos pela
tarefa (.claude/hooks/lib/politicas.mjs): crítica = Opus, o resto = Sonnet. O modelo fica
fixo na sessão porque o cache é por modelo.
EOF
}

modelo=""
esforco=""
automatico=1
worktree=""
simulado=0
tarefa=""

while [ $# -gt 0 ]; do
  case "$1" in
    --opus) modelo="opus" ;;
    --modelo) [ $# -ge 2 ] || { echo "--modelo exige um valor" >&2; exit 2; }; modelo="$2"; shift ;;
    --esforco) [ $# -ge 2 ] || { echo "--esforco exige um valor" >&2; exit 2; }; esforco="$2"; shift ;;
    --sem-auto) automatico=0 ;;
    --worktree) [ $# -ge 2 ] || { echo "--worktree exige um nome" >&2; exit 2; }; worktree="$2"; shift ;;
    --dry-run) simulado=1 ;;
    -h|--help) uso; exit 0 ;;
    --) shift; tarefa="${tarefa:+$tarefa }$*"; break ;;
    -*) echo "opção desconhecida: $1" >&2; uso >&2; exit 2 ;;
    *) tarefa="${tarefa:+$tarefa }$1" ;;
  esac
  shift
done

command -v claude > /dev/null || { echo "claude não encontrado no PATH" >&2; exit 1; }
[ -f .claude/agents/arquiteto.md ] || { echo "falta .claude/agents/arquiteto.md" >&2; exit 1; }

git config core.hooksPath .githooks

if [ ! -d node_modules ]; then
  echo "aviso: node_modules ausente; rode 'npm ci' antes de testar ou compilar" >&2
fi

prompt="Início de sessão. Siga o protocolo 'Ao iniciar' do seu agente: use o índice e o HANDOFF já injetados e confirme o estado em uma linha."
if [ -n "$tarefa" ]; then
  prompt="$prompt Tarefa desta sessão: $tarefa"
else
  prompt="$prompt Depois pergunte qual é a tarefa."
fi

if [ "$automatico" -eq 1 ] && [ -n "$tarefa" ]; then
  escolha=$(node .claude/hooks/lib/classificar.mjs "$tarefa" 2>/dev/null || echo "sonnet medium")
  nivel_escolhido=${escolha% *}
  esforco_escolhido=${escolha#* }
  [ -z "$modelo" ] && [ "$nivel_escolhido" = "opus" ] && modelo="opus"
  [ -z "$esforco" ] && esforco="$esforco_escolhido"
fi

id_do_modelo() {
  case "$1" in
    opus) echo "claude-opus-5-5" ;;
    sonnet) echo "claude-sonnet-5-5" ;;
    haiku) echo "claude-haiku-5-5" ;;
    *) echo "$1" ;;
  esac
}

nome="platform${worktree:+: $worktree}"
comando=(claude --agent arquiteto --name "$nome")
[ -n "$modelo" ] && comando+=(--model "$modelo")
[ -n "$esforco" ] && comando+=(--effort "$esforco")

orca_disponivel() {
  command -v orca > /dev/null && orca worktree list --repo "path:$raiz" --json > /dev/null 2>&1
}

if [ -n "$worktree" ]; then
  if orca_disponivel; then
    comando=(orca worktree create --repo "path:$raiz" --name "$worktree" --agent claude --prompt "$prompt" --setup run --activate)
    modelo_orca=$(id_do_modelo "${modelo:-sonnet}")
    comando+=(--model "$modelo_orca")
    [ -n "$esforco" ] && comando+=(--effort "$esforco")
  else
    echo "Orca indisponível: usando claude -w (rode 'npm ci' no worktree novo)" >&2
    comando+=(--worktree "$worktree" "$prompt")
  fi
else
  comando+=("$prompt")
fi

if [ "$simulado" -eq 1 ]; then
  printf '%q ' "${comando[@]}"
  echo
  exit 0
fi

exec "${comando[@]}"
