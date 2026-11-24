#!/usr/bin/env node
const LIMITE_DE_TEMPO_MS = 8000
const COMO_DESTRAVAR = 'Para destravar, no terminal: git checkout -- .claude/hooks (restaura a guarda); ou desligue o hook em /hooks dentro do Claude Code.'

function bloquear(motivo) {
  process.stderr.write(`[guarda do projeto] a guarda falhou e a ferramenta foi bloqueada por padrão: ${motivo}\n${COMO_DESTRAVAR}\n`)
  process.exit(2)
}

setTimeout(() => bloquear('tempo esgotado antes de decidir (a guarda precisa responder antes do timeout do hook)'), LIMITE_DE_TEMPO_MS).unref()
process.stdin.on('error', (erro) => bloquear(`erro ao ler o evento: ${erro.message}`))

function eventoValido(evento) {
  return evento !== null && typeof evento === 'object' && typeof evento.tool_name === 'string' && evento.tool_name.length > 0
}

try {
  const guarda = await import('./lib/guarda.mjs')
  const evento = await guarda.lerEvento(process.stdin)
  if (!eventoValido(evento)) bloquear('evento vazio, inválido ou sem tool_name')
  process.exitCode = guarda.executarGuarda({
    evento,
    saida: (texto) => process.stdout.write(texto),
    erro: (texto) => process.stderr.write(texto),
  })
} catch (erro) {
  bloquear(erro instanceof Error ? erro.message : 'erro desconhecido')
}
