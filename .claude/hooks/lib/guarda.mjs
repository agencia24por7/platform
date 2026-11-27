import { existsSync, realpathSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { isAbsolute, join, relative } from 'node:path'
import { avaliarBusca, avaliarComando, avaliarEscrita, avaliarLeitura } from './politicas.mjs'

export function lerEvento(stdin) {
  let bruto = ''
  stdin.setEncoding('utf8')
  return new Promise((resolver) => {
    stdin.on('data', (pedaco) => (bruto += pedaco))
    stdin.on('end', () => {
      try {
        resolver(JSON.parse(bruto))
      } catch {
        resolver({})
      }
    })
  })
}

function responder(saida, { decisao, motivo }) {
  saida(JSON.stringify({
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
    execFileSync('git', ['ls-files', '--error-unmatch', relative(raiz, caminhoAbsoluto)], { cwd: raiz, stdio: 'ignore', timeout: 2000 })
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

function ramoDoDiretorio(diretorio) {
  try {
    return execFileSync('git', ['-C', diretorio, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 }).trim()
  } catch {
    return null
  }
}

const FLAGS_DO_PUSH_COM_VALOR = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec'])
const SEM_ASPAS = /^["']|["']$/g

function avaliarPushSemDestino(comando, diretorioBase) {
  const pushes = String(comando ?? '').matchAll(/\bgit\b((?:\s+(?:-[cC]\s+(?:"[^"]*"|'[^']*'|\S+)|--[\w-]+(?:=\S+)?))*)\s+push\b([^;&|\n]*)/g)
  for (const push of pushes) {
    const diretorioDoC = /-C\s+("[^"]*"|'[^']*'|\S+)/.exec(push[1])?.[1]
    const diretorio = diretorioDoC ? absoluto(diretorioDoC.replace(SEM_ASPAS, ''), diretorioBase) : diretorioBase
    const tokens = push[2].trim().split(/\s+/).filter(Boolean)
    const posicionais = []
    for (let indice = 0; indice < tokens.length; indice += 1) {
      if (FLAGS_DO_PUSH_COM_VALOR.has(tokens[indice])) indice += 1
      else if (!tokens[indice].startsWith('-')) posicionais.push(tokens[indice].replace(SEM_ASPAS, ''))
    }
    const semDestinoExplicito = posicionais.length <= 1 || posicionais.slice(1).every((argumento) => argumento === 'HEAD' || argumento === '@')
    if (!semDestinoExplicito) continue
    const ramo = ramoDoDiretorio(diretorio)
    if (ramo === null) return { decisao: 'ask', motivo: 'Não foi possível descobrir o ramo atual para um push sem destino explícito: confirme.' }
    if (ramo === 'main') return { decisao: 'deny', motivo: 'Push a partir da main sem destino explícito é push direto em main: use PR e gh pr merge.' }
  }
  return null
}

function decidir(evento, raiz) {
  const ferramenta = evento.tool_name
  const entrada = evento.tool_input ?? {}
  if (ferramenta === 'Bash') {
    return avaliarPushSemDestino(entrada.command, evento.cwd ?? raiz) ?? avaliarComando(entrada.command)
  }
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

export function executarGuarda({ evento, saida, erro, ambiente = process.env }) {
  try {
    const raiz = ambiente.CLAUDE_PROJECT_DIR ?? evento.cwd ?? process.cwd()
    const resultado = decidir(evento, raiz)
    if (resultado) responder(saida, resultado)
    return 0
  } catch (excecao) {
    if (evento.tool_name === 'Bash') {
      erro(`[guarda do projeto] erro inesperado ao avaliar o comando: ${excecao instanceof Error ? excecao.message : 'desconhecido'}\n`)
      return 2
    }
    throw excecao
  }
}
