#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, accessSync, constants } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const rapido = process.argv.includes('--rapido')
const ajuda = process.argv.includes('--help') || process.argv.includes('-h')

if (ajuda) {
  console.log('Uso: node scripts/ambiente-verificar.mjs [--rapido]\nValida CLAUDE.md, .claude/, orca.yaml e scripts/start.sh contra docs/ambiente/README.md. Só lê arquivos; --rapido pula a execução dos hooks.')
  process.exit(0)
}

const LIMITE_CLAUDE_MD = 120
const LIMITE_RULE = 60
const LIMITE_CONTEXTO_INICIAL = 10000
const MODELOS = new Set(['sonnet', 'opus', 'haiku', 'inherit'])
const ESFORCOS_DE_SETTINGS = new Set(['low', 'medium', 'high', 'xhigh'])
const ESFORCOS_DE_AGENTE = new Set(['low', 'medium', 'high', 'xhigh', 'max'])
const CAMINHO_FORA_DO_PROJETO = new RegExp(['/Users/', '\\$HOME', '~/'].join('|'))
const DOIS_ASTERISCOS_E_BARRA = new RegExp('\\*\\*' + '/', 'g')
const falhas = []
const falhar = (mensagem) => falhas.push(mensagem)
const caminho = (...partes) => join(raiz, ...partes)
const ler = (...partes) => readFileSync(caminho(...partes), 'utf8')
const linhas = (texto) => texto.replace(/\n$/, '').split('\n').length

function frontmatter(texto) {
  const achado = texto.match(/^---\n([\s\S]*?)\n---\n/)
  if (!achado) return null
  const campos = {}
  let chaveLista = null
  for (const linha of achado[1].split('\n')) {
    const item = linha.match(/^\s+-\s+"?(.*?)"?\s*$/)
    if (item && chaveLista) {
      campos[chaveLista].push(item[1])
      continue
    }
    const par = linha.match(/^([\w-]+):\s*(.*)$/)
    if (!par) continue
    if (par[2] === '') {
      chaveLista = par[1]
      campos[chaveLista] = []
    } else {
      chaveLista = null
      campos[par[1]] = par[2]
    }
  }
  return campos
}

function globParaRegex(glob) {
  const corpo = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(DOIS_ASTERISCOS_E_BARRA, '\u0001')
    .replace(/\*\*/g, '\u0002')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0001/g, '(?:.*' + '/)?')
    .replace(/\u0002/g, '.*')
  return new RegExp(`^${corpo}$`)
}

function arquivosRastreados() {
  const saida = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: raiz, encoding: 'utf8' })
  return saida.split('\n').filter(Boolean)
}

function executavel(...partes) {
  try {
    accessSync(caminho(...partes), constants.X_OK)
    return true
  } catch {
    return false
  }
}

function checarCaminhosCitados(origem, texto) {
  for (const [, trecho] of texto.matchAll(/`([^`\s]+)`/g)) {
    if (!trecho.includes('/') || /[*<>{}~$:]|NNNN/.test(trecho) || /^(https?|npm|node_modules)/.test(trecho)) continue
    if (trecho.startsWith('--') || trecho.startsWith('/')) continue
    if (!existsSync(caminho(trecho))) falhar(`${origem} cita "${trecho}", que não existe`)
  }
}

function checarClaudeMd() {
  if (!existsSync(caminho('CLAUDE.md'))) return falhar('CLAUDE.md não existe')
  const texto = ler('CLAUDE.md')
  const total = linhas(texto)
  if (total > LIMITE_CLAUDE_MD) falhar(`CLAUDE.md tem ${total} linhas (limite ${LIMITE_CLAUDE_MD}); mova o detalhe para .claude/rules/`)
  checarCaminhosCitados('CLAUDE.md', texto)
}

function checarSettings() {
  const arquivo = caminho('.claude', 'settings.json')
  if (!existsSync(arquivo)) return falhar('.claude/settings.json não existe')
  let configuracao
  try {
    configuracao = JSON.parse(readFileSync(arquivo, 'utf8'))
  } catch (erro) {
    return falhar(`.claude/settings.json inválido: ${erro.message}`)
  }
  if (CAMINHO_FORA_DO_PROJETO.test(JSON.stringify(configuracao))) falhar('.claude/settings.json referencia caminho fora do projeto (use $CLAUDE_PROJECT_DIR)')
  if (configuracao.agent && !existsSync(caminho('.claude', 'agents', `${configuracao.agent}.md`))) falhar(`agent "${configuracao.agent}" não tem arquivo em .claude/agents/`)
  const negados = configuracao.permissions?.deny ?? []
  for (const alvo of ['node_modules', '.env', 'package-lock.json']) {
    if (!negados.some((regra) => regra.includes(alvo))) falhar(`permissions.deny não protege ${alvo}`)
  }
  for (const grupos of Object.values(configuracao.hooks ?? {})) {
    for (const grupo of grupos) {
      for (const gancho of grupo.hooks ?? []) {
        const achado = String(gancho.command).match(/\.claude\/hooks\/([\w.-]+)/)
        if (!achado) {
          falhar(`hook sem script em .claude/hooks: ${gancho.command}`)
          continue
        }
        if (!existsSync(caminho('.claude', 'hooks', achado[1]))) falhar(`hook aponta para script inexistente: ${achado[1]}`)
        else if (!executavel('.claude', 'hooks', achado[1])) falhar(`hook sem permissão de execução: ${achado[1]}`)
      }
    }
  }
}

function checarRules(rastreados) {
  const pasta = caminho('.claude', 'rules')
  if (!existsSync(pasta)) return falhar('.claude/rules não existe')
  for (const nome of readdirSync(pasta).filter((arquivo) => arquivo.endsWith('.md'))) {
    const texto = readFileSync(join(pasta, nome), 'utf8')
    const campos = frontmatter(texto)
    if (!campos?.paths?.length) {
      falhar(`rule ${nome} sem frontmatter "paths"`)
      continue
    }
    if (linhas(texto) > LIMITE_RULE) falhar(`rule ${nome} passa de ${LIMITE_RULE} linhas`)
    for (const glob of campos.paths) {
      const regex = globParaRegex(glob)
      if (!rastreados.some((arquivo) => regex.test(arquivo))) falhar(`rule ${nome}: "${glob}" não casa com nenhum arquivo`)
    }
    checarCaminhosCitados(`rule ${nome}`, texto)
  }
}

function checarAgentes() {
  const pasta = caminho('.claude', 'agents')
  if (!existsSync(pasta)) return falhar('.claude/agents não existe')
  const encontrados = {}
  for (const nome of readdirSync(pasta).filter((arquivo) => arquivo.endsWith('.md'))) {
    const campos = frontmatter(readFileSync(join(pasta, nome), 'utf8'))
    const esperado = nome.replace(/\.md$/, '')
    if (!campos) {
      falhar(`agente ${nome} sem frontmatter`)
      continue
    }
    encontrados[esperado] = campos
    if (campos.name !== esperado) falhar(`agente ${nome}: name "${campos.name}" difere do arquivo`)
    if (!campos.description) falhar(`agente ${nome} sem description`)
    if (!MODELOS.has(campos.model)) falhar(`agente ${nome}: model "${campos.model}" fora de ${[...MODELOS].join(', ')}`)
    if (/\b(Edit|Write|MultiEdit)\b/.test(campos.tools ?? '')) falhar(`agente ${nome} não deve ter ferramenta de escrita`)
  }
  for (const obrigatorio of ['arquiteto', 'explorer', 'security-reviewer']) {
    if (!encontrados[obrigatorio]) falhar(`agente obrigatório ausente: ${obrigatorio}`)
  }
  if (encontrados['security-reviewer'] && encontrados['security-reviewer'].model !== 'opus') falhar('security-reviewer deve usar opus')
  if (encontrados.explorer && encontrados.explorer.model !== 'haiku') falhar('explorer deve usar haiku')
}

function checarSkillsEComandos() {
  for (const nome of ['handoff', 'revisar-ambiente', 'economia-de-sessao']) {
    const arquivo = caminho('.claude', 'skills', nome, 'SKILL.md')
    if (!existsSync(arquivo)) {
      falhar(`skill ausente: ${nome}`)
      continue
    }
    const campos = frontmatter(readFileSync(arquivo, 'utf8'))
    if (campos?.name !== nome) falhar(`skill ${nome}: frontmatter name incorreto`)
    if (!campos?.description) falhar(`skill ${nome} sem description`)
  }
  if (!existsSync(caminho('.claude', 'commands', 'start.md'))) falhar('comando /start ausente')
}

function checarOrcaEStart() {
  if (!existsSync(caminho('orca.yaml'))) falhar('orca.yaml não existe')
  else if (!/^scripts:\s*\n\s+setup:/m.test(ler('orca.yaml'))) falhar('orca.yaml sem scripts.setup')
  if (!existsSync(caminho('scripts', 'start.sh'))) return falhar('scripts/start.sh não existe')
  if (!executavel('scripts', 'start.sh')) falhar('scripts/start.sh sem permissão de execução')
  try {
    execFileSync('bash', ['-n', caminho('scripts', 'start.sh')])
  } catch (erro) {
    falhar(`scripts/start.sh com erro de sintaxe: ${erro.message}`)
  }
}

function checarExecucao() {
  try {
    const comando = execFileSync('bash', [caminho('scripts', 'start.sh'), '--dry-run', 'tarefa de teste'], { cwd: raiz, encoding: 'utf8' })
    if (!comando.includes('--agent arquiteto')) falhar('start.sh --dry-run não inicia o agente arquiteto')
  } catch (erro) {
    falhar(`start.sh --dry-run falhou: ${erro.message}`)
  }
  try {
    const saida = execFileSync(caminho('.claude', 'hooks', 'bootstrap-context.sh'), { cwd: raiz, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: raiz } })
    if (saida.length > LIMITE_CONTEXTO_INICIAL) falhar(`bootstrap-context.sh gera ${saida.length} caracteres (limite ${LIMITE_CONTEXTO_INICIAL})`)
    if (!saida.includes('## ADRs')) falhar('bootstrap-context.sh não listou os ADRs')
  } catch (erro) {
    falhar(`bootstrap-context.sh falhou: ${erro.message}`)
  }
}

function checarEconomiaESeguranca() {
  const configuracao = JSON.parse(ler('.claude', 'settings.json'))
  const registrados = (evento) => JSON.stringify(configuracao.hooks?.[evento] ?? [])
  const exigidos = [
    ['PreToolUse', 'guarda-pre-uso.mjs'],
  ]
  for (const [evento, script] of exigidos) {
    if (!registrados(evento).includes(script)) falhar(`hook ${script} não está registrado em ${evento}`)
  }
  for (const chave of ['BASH_MAX_OUTPUT_LENGTH', 'MAX_MCP_OUTPUT_TOKENS', 'CLAUDE_AUTOCOMPACT_PCT_OVERRIDE']) {
    if (!configuracao.env?.[chave]) falhar(`settings.env sem ${chave}`)
  }
  if (!ESFORCOS_DE_SETTINGS.has(configuracao.effortLevel)) falhar(`effortLevel "${configuracao.effortLevel}" inválido (use ${[...ESFORCOS_DE_SETTINGS].join(', ')})`)
  for (const nome of readdirSync(caminho('.claude', 'agents')).filter((arquivo) => arquivo.endsWith('.md'))) {
    const campos = frontmatter(ler('.claude', 'agents', nome)) ?? {}
    if (campos.effort && !ESFORCOS_DE_AGENTE.has(campos.effort)) falhar(`agente ${nome}: effort "${campos.effort}" inválido`)
    if (nome === 'arquiteto.md' && campos.effort) falhar('arquiteto não deve fixar effort (o start.sh decide pela tarefa)')
  }
  for (const arquivo of ['politicas.mjs', 'classificar.mjs']) {
    if (!existsSync(caminho('.claude', 'hooks', 'lib', arquivo))) falhar(`falta .claude/hooks/lib/${arquivo}`)
  }
}

function checarDocumentacao() {
  const guia = caminho('docs', 'ambiente', 'README.md')
  if (!existsSync(guia)) falhar('docs/ambiente/README.md não existe')
  else {
    const texto = readFileSync(guia, 'utf8')
    if (frontmatter(texto)?.status !== 'active') falhar('docs/ambiente/README.md sem "status: active"')
    if (!texto.includes('## Histórico de revisões')) falhar('docs/ambiente/README.md sem a seção "Histórico de revisões"')
    checarCaminhosCitados('docs/ambiente/README.md', texto)
  }
  for (const numero of ['0037', '0038', '0039']) {
    if (!readdirSync(caminho('docs', 'adr')).some((arquivo) => arquivo.startsWith(`${numero}-`))) falhar(`ADR ${numero} não existe`)
  }
  if (!/^HANDOFF\.md$/m.test(ler('.gitignore'))) falhar('.gitignore não ignora HANDOFF.md')
  const pacote = JSON.parse(ler('package.json'))
  if (!pacote.scripts?.['ambiente:verificar']) falhar('package.json sem o script ambiente:verificar')
}

function relatarWorktreesParados() {
  const saida = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: raiz, encoding: 'utf8' })
  const total = saida.split('\n').filter((linha) => linha.startsWith('worktree ')).length
  if (total > 10) console.log(`aviso: ${total} worktrees registrados; revise com "git worktree list" e remova os já mergeados`)
}

const rastreados = arquivosRastreados()
checarClaudeMd()
checarSettings()
checarRules(rastreados)
checarAgentes()
checarSkillsEComandos()
checarOrcaEStart()
checarEconomiaESeguranca()
checarDocumentacao()
if (!rapido) {
  checarExecucao()
  relatarWorktreesParados()
}

if (falhas.length > 0) {
  console.error(`ambiente de agentes: ${falhas.length} problema(s)`)
  for (const falha of falhas) console.error(`- ${falha}`)
  process.exit(1)
}
console.log(`ambiente de agentes ok${rapido ? ' (rápido)' : ''}`)
