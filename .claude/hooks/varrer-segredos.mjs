#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { linhasComSegredo, arquivoSensivel } from './lib/politicas.mjs'
import { linhasAdicionadas } from './lib/diff.mjs'

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
  const diff = git(['-c', 'core.quotePath=false', 'diff', 'HEAD', '-U0', '--no-color', '--no-renames'])
  for (const linha of linhasAdicionadas(diff)) {
    if (IGNORADOS.test(linha.arquivo)) continue
    const tipos = linhasComSegredo(linha.texto)
    if (tipos.length > 0) achados.push({ arquivo: linha.arquivo, linha: linha.linha, tipos: tipos[0].tipos })
  }
  return achados
}

function achadosEmNaoRastreados() {
  const achados = []
  const lista = git(['-c', 'core.quotePath=false', 'ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean)
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
