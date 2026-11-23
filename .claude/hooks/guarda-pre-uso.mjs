#!/usr/bin/env node
import { executarGuarda, lerEvento } from './lib/guarda.mjs'

const evento = await lerEvento(process.stdin)
process.exitCode = executarGuarda({
  evento,
  saida: (texto) => process.stdout.write(texto),
  erro: (texto) => process.stderr.write(texto),
})
