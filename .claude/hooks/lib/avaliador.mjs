import { parentPort, workerData } from 'node:worker_threads'
import { executarGuarda } from './guarda.mjs'

let saida = ''
let erro = ''

try {
  const codigo = executarGuarda({
    evento: workerData.evento,
    saida: (texto) => {
      saida += texto
    },
    erro: (texto) => {
      erro += texto
    },
  })
  parentPort.postMessage({ codigo, saida, erro })
} catch (excecao) {
  parentPort.postMessage({ falha: excecao instanceof Error ? excecao.message : 'erro desconhecido' })
}
