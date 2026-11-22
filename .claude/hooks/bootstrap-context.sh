#!/usr/bin/env bash
set -euo pipefail

raiz="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$raiz"

situacao_de() {
  head -n 8 "$1" | sed -nE 's/^.*([Ss]tatus|Situação): *([^.]*).*$/\2/p' | head -1 | tr -d '\r'
}

titulo_de() {
  grep -m 1 '^# ' "$1" | sed 's/^# //' || basename "$1"
}

ramo=$(git branch --show-current 2>/dev/null || true)
echo "=== CONTEXTO DO PROJETO platform (injetado pelo SessionStart) ==="
echo "Branch: ${ramo:-detached} | Pasta: $(basename "$raiz")"
echo ""

if [ -d docs/adr ]; then
  total=$(find docs/adr -name '*.md' | wc -l | tr -d ' ')
  echo "## ADRs ($total em docs/adr; ADR aceito não se contradiz, só se supera com novo ADR)"
  echo "Fora de 'aceita/accepted':"
  fora=0
  for arquivo in $(find docs/adr -name '*.md' | sort); do
    situacao=$(situacao_de "$arquivo")
    case "$situacao" in
      aceit*|accepted*) ;;
      *) echo "- [${situacao:-sem situação}] $arquivo -> $(titulo_de "$arquivo")"; fora=$((fora + 1)) ;;
    esac
  done
  [ "$fora" -eq 0 ] && echo "- nenhum"
  echo "Mais recentes:"
  for arquivo in $(find docs/adr -name '*.md' | sort | tail -5); do
    echo "- $arquivo -> $(titulo_de "$arquivo")"
  done
  echo ""
fi

outros=""
documentos=""
[ -d docs ] && documentos=$(find docs -name '*.md' -not -path 'docs/adr/*' | sort)
for arquivo in $documentos; do
  situacao=$(situacao_de "$arquivo")
  [ -z "$situacao" ] && continue
  case "$situacao" in deprecated*|superseded*) continue ;; esac
  outros="$outros- [$situacao] $arquivo -> $(titulo_de "$arquivo")"$'\n'
done
if [ -n "$outros" ]; then
  echo "## Outros documentos vivos"
  printf '%s\n' "$outros"
fi

echo "## Regras por escopo (carregam sozinhas ao tocar a área): .claude/rules/"
[ -d .claude/rules ] && ls .claude/rules | sed 's/^/- /' || true
echo ""

if [ -f HANDOFF.md ]; then
  echo "## HANDOFF ATIVO (HANDOFF.md, primeiras 50 linhas)"
  head -n 50 HANDOFF.md
  echo ""
fi

sujos=$(git status --short 2>/dev/null | head -n 20 || true)
if [ -n "$sujos" ]; then
  echo "## ARQUIVOS MODIFICADOS NESTA PASTA"
  echo "$sujos"
  echo ""
fi

echo "INSTRUÇÃO: antes de propor ou alterar código, leia com Read os ADRs ligados à tarefa. Detalhes do ambiente: docs/ambiente/README.md"
