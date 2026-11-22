#!/usr/bin/env bash
set -uo pipefail

raiz="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$raiz" || exit 0

entrada=$(cat)
ja_continuando=$(printf '%s' "$entrada" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{process.stdout.write(String(JSON.parse(d).stop_hook_active===true))}catch{process.stdout.write("false")}})')
[ "$ja_continuando" = "true" ] && exit 0
[ -d node_modules ] || exit 0

alterados=$(git status --porcelain 2>/dev/null | sed 's/^...//' | grep -E '\.(ts|tsx)$' || true)
[ -z "$alterados" ] && exit 0

log=$(mktemp)
falhas=""

if ! npx --no-install tsc --noEmit > "$log" 2>&1; then
  falhas="typecheck falhou:"$'\n'"$(head -n 30 "$log")"
else
  modulos=$(printf '%s\n' "$alterados" | sed -nE 's#^src/modules/([^/]+)/.*#\1#p' | sort -u)
  for modulo in $modulos; do
    testes=$(find src/modules/"$modulo" -name '*.test.ts')
    [ -z "$testes" ] && continue
    if ! node --test --experimental-strip-types $testes > "$log" 2>&1; then
      falhas="${falhas}testes de unidade de src/modules/${modulo} falharam:"$'\n'"$(grep -E '^# (fail|pass)|not ok' "$log" | head -n 20)"$'\n'
    fi
  done
fi

rm -f "$log"
[ -z "$falhas" ] && exit 0

printf '%s' "$falhas" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>process.stdout.write(JSON.stringify({decision:"block",reason:"Corrija antes de encerrar.\n"+d})))'
exit 0
