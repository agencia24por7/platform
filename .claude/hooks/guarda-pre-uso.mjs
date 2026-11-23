#!/usr/bin/env node
function bloquear(motivo) {
  process.stderr.write(`[guarda do projeto] a guarda falhou e a ferramenta foi bloqueada por padrão: ${motivo}\n`)
  process.exit(2)
}

try {
  const guarda = await import('./lib/guarda.mjs')
  const evento = await guarda.lerEvento(process.stdin)
  process.exitCode = guarda.executarGuarda({
    evento,
    saida: (texto) => process.stdout.write(texto),
    erro: (texto) => process.stderr.write(texto),
  })
} catch (erro) {
  bloquear(erro instanceof Error ? erro.message : 'erro desconhecido')
}
