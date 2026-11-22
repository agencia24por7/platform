#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { linhasComSegredo, arquivoSensivel } from './lib/politicas.mjs'

const raiz = process.env.CLAUDE_PROJECT_DIR ?? process.cwd()
const TAMANHO_MAXIMO = 200_000
const IGNORADOS = /(^|[/])(package-lock\.json|\.env\.example|tsconfig\.tsbuildinfo)$/

function lerEntrada() {
  let bruto = ''
  process.stdin.setEncoding('utf8')
  return new Promise((resolver) => {
    process.stdin.on('data', (pedaco) => (bruto += pedaco))
    process.stdin.on('end', () => {
      try {
        resolver(JSON.parse(bruto))
      } catch {
        resolver({})
      }
    })
  })
}

function git(argumentos) {
  try {
    return execFileSync('git', argumentos, { cwd: raiz, encoding: 'utf8', maxBuffer: 20_000_000 })
  } catch {
    return ''
  }
}

function achadosNoDiff() {
  const achados = []
  let arquivo = ''
  let linhaNova = 0
  for (const linha of git(['diff', 'HEAD', '-U0', '--no-color']).split('\n')) {
    const cabecalho = linha.match(/^\+\+\+ b\/(.*)$/)
    if (cabecalho) {
      arquivo = cabecalho[1]
      continue
    }
    const trecho = linha.match(/^@@ -\S+ \+(\d+)/)
    if (trecho) {
      linhaNova = Number(trecho[1]) - 1
      continue
    }
    if (!linha.startsWith('+') || linha.startsWith('+++')) continue
    linhaNova += 1
    if (IGNORADOS.test(arquivo)) continue
    const tipos = linhasComSegredo(linha.slice(1))
    if (tipos.length > 0) achados.push({ arquivo, linha: linhaNova, tipos: tipos[0].tipos })
  }
  return achados
}

function achadosEmNaoRastreados() {
  const achados = []
  const lista = git(['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean)
  for (const arquivo of lista) {
    if (IGNORADOS.test(arquivo)) continue
    if (arquivoSensivel(arquivo)) {
      achados.push({ arquivo, linha: 0, tipos: ['arquivo de segredo fora do .gitignore'] })
      continue
    }
    try {
      const completo = join(raiz, arquivo)
      if (statSync(completo).size > TAMANHO_MAXIMO) continue
      for (const item of linhasComSegredo(readFileSync(completo, 'utf8'))) achados.push({ arquivo, linha: item.linha, tipos: item.tipos })
    } catch {
      continue
    }
  }
  return achados
}

const evento = await lerEntrada()
if (evento.stop_hook_active === true) process.exit(0)

const achados = [...achadosNoDiff(), ...achadosEmNaoRastreados()]
if (achados.length === 0) process.exit(0)

const detalhe = achados.slice(0, 15).map((achado) => `- ${achado.arquivo}:${achado.linha} (${achado.tipos.join(', ')})`).join('\n')
process.stdout.write(JSON.stringify({
  decision: 'block',
  reason: `Possível segredo nas alterações. Remova o valor (use variável de ambiente ou Secret Manager) antes de encerrar. O valor não é exibido.\n${detalhe}`,
}))
