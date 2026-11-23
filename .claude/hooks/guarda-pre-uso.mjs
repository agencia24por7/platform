#!/usr/bin/env node
import { existsSync, realpathSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { isAbsolute, join, relative } from 'node:path'
import { avaliarBusca, avaliarComando, avaliarEscrita, avaliarLeitura } from './lib/politicas.mjs'

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

function responder({ decisao, motivo }) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decisao,
      permissionDecisionReason: `[guarda do projeto] ${motivo}`,
    },
  }))
}

function absoluto(caminho, raiz) {
  return isAbsolute(caminho) ? caminho : join(raiz, caminho)
}

function versionado(caminhoAbsoluto, raiz) {
  if (!existsSync(caminhoAbsoluto)) return false
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', relative(raiz, caminhoAbsoluto)], { cwd: raiz, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function conteudoDaEscrita(ferramenta, entrada) {
  if (ferramenta === 'Write') return entrada.content
  if (ferramenta === 'Edit') return entrada.new_string
  if (ferramenta === 'MultiEdit') return (entrada.edits ?? []).map((edicao) => edicao.new_string).join('\n')
  return ''
}

function caminhosParaAvaliar(caminho, raiz) {
  if (!caminho) return []
  const completo = absoluto(caminho, raiz)
  let real = completo
  try {
    real = realpathSync.native(completo)
  } catch {
    real = completo
  }
  return [...new Set([caminho, relative(raiz, real)])]
}

function primeiraDecisao(caminhos, avaliar) {
  for (const caminho of caminhos) {
    const resultado = avaliar(caminho)
    if (resultado) return resultado
  }
  return null
}

function decidir(ferramenta, entrada, raiz) {
  if (ferramenta === 'Bash') return avaliarComando(entrada.command, evento.permission_mode)
  if (ferramenta === 'Grep' || ferramenta === 'Glob') {
    const glob = entrada.glob ?? (ferramenta === 'Glob' ? entrada.pattern : undefined)
    const caminhos = caminhosParaAvaliar(entrada.path ?? '', raiz)
    return primeiraDecisao(caminhos.length > 0 ? caminhos : [''], (caminho) => avaliarBusca({ caminho, glob }))
  }
  const caminho = entrada.file_path ?? entrada.notebook_path ?? ''
  const caminhos = caminhosParaAvaliar(caminho, raiz)
  if (ferramenta === 'Read') {
    const completo = absoluto(caminho, raiz)
    const tamanho = existsSync(completo) ? statSync(completo).size : 0
    const comRecorte = entrada.limit != null || entrada.offset != null
    return primeiraDecisao(caminhos, (candidato) => avaliarLeitura({ caminho: candidato, tamanho, comRecorte }))
  }
  const conteudo = conteudoDaEscrita(ferramenta, entrada)
  const completo = absoluto(caminho, raiz)
  return primeiraDecisao(caminhos, (candidato) => avaliarEscrita({ caminho: candidato, conteudo, existeVersionado: versionado(completo, raiz) }))
}

const evento = await lerEntrada()
const raiz = process.env.CLAUDE_PROJECT_DIR ?? evento.cwd ?? process.cwd()
const resultado = decidir(evento.tool_name, evento.tool_input ?? {}, raiz)
if (resultado) responder(resultado)
