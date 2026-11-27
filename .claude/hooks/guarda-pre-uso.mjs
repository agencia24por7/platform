#!/usr/bin/env node
import { Worker } from 'node:worker_threads'

const LIMITE_DE_TEMPO_MS = 6000
const COMO_DESTRAVAR = 'Para destravar, no terminal: git checkout -- .claude/hooks (restaura a guarda); ou desligue o hook em /hooks dentro do Claude Code.'

function bloquear(motivo) {
  process.stderr.write(`[guarda do projeto] a guarda falhou e a ferramenta foi bloqueada por padrão: ${motivo}\n${COMO_DESTRAVAR}\n`)
  process.exit(2)
}

setTimeout(() => bloquear('tempo esgotado antes de decidir (a avaliação roda num worker com limite de tempo)'), LIMITE_DE_TEMPO_MS).unref()
process.stdin.on('error', (erro) => bloquear(`erro ao ler o evento: ${erro.message}`))

function eventoValido(evento) {
  return evento !== null && typeof evento === 'object' && typeof evento.tool_name === 'string' && evento.tool_name.length > 0
}

function avaliarNoWorker(evento) {
  const worker = new Worker(new URL('./lib/avaliador.mjs', import.meta.url), { workerData: { evento } })
  let respondeu = false
  worker.on('message', (resposta) => {
    respondeu = true
    if (typeof resposta.falha === 'string') bloquear(resposta.falha)
    if (resposta.saida) process.stdout.write(resposta.saida)
    if (resposta.erro) process.stderr.write(resposta.erro)
    process.exitCode = resposta.codigo
    worker.terminate()
  })
  worker.on('error', (erro) => bloquear(erro.message))
  worker.on('exit', () => {
    if (!respondeu) bloquear('o worker terminou sem decidir')
  })
}

try {
  const guarda = await import('./lib/guarda.mjs')
  const evento = await guarda.lerEvento(process.stdin)
  if (!eventoValido(evento)) bloquear('evento vazio, inválido ou sem tool_name')
  avaliarNoWorker(evento)
} catch (erro) {
  bloquear(erro instanceof Error ? erro.message : 'erro desconhecido')
}
