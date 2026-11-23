import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const hook = (nome) => join(raiz, '.claude', 'hooks', nome)

test('verificador do ambiente passa no repositório', () => {
  const resultado = spawnSync('node', ['scripts/ambiente-verificar.mjs'], { cwd: raiz, encoding: 'utf8' })
  assert.equal(resultado.status, 0, resultado.stderr)
})

test('start.sh --dry-run monta o comando do agente arquiteto com a tarefa', () => {
  const saida = execFileSync('bash', ['scripts/start.sh', '--opus', '--dry-run', 'ajustar', 'o', 'painel'], { cwd: raiz, encoding: 'utf8' })
  assert.match(saida, /--agent arquiteto/)
  assert.match(saida, /--model opus/)
  assert.match(saida.replaceAll('\\', ''), /ajustar o painel/)
})

test('start.sh rejeita opção desconhecida e ajuda sai com sucesso', () => {
  const invalida = spawnSync('bash', ['scripts/start.sh', '--nada'], { cwd: raiz, encoding: 'utf8' })
  assert.equal(invalida.status, 2)
  const ajuda = spawnSync('bash', ['scripts/start.sh', '--help'], { cwd: raiz, encoding: 'utf8' })
  assert.equal(ajuda.status, 0)
})

test('bootstrap-context injeta ADRs, regras e respeita o limite de tamanho', () => {
  const saida = execFileSync(hook('bootstrap-context.sh'), { cwd: raiz, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: raiz } })
  assert.match(saida, /## ADRs/)
  const adrs = readdirSync(join(raiz, 'docs', 'adr')).filter((nome) => nome.endsWith('.md')).sort()
  assert.match(saida, new RegExp(`## ADRs \\(${adrs.length} em docs/adr`))
  for (const recente of adrs.slice(-5)) assert.ok(saida.includes(`docs/adr/${recente}`), `ADR recente ausente do contexto: ${recente}`)
  assert.match(saida, /\.claude\/rules/)
  assert.ok(saida.length <= 10000, `contexto inicial com ${saida.length} caracteres`)
})

test('bootstrap-context inclui o HANDOFF quando existe e some quando não existe', () => {
  const pasta = mkdtempSync(join(tmpdir(), 'ambiente-'))
  try {
    execFileSync('git', ['init', '-q'], { cwd: pasta })
    const sem = execFileSync(hook('bootstrap-context.sh'), { cwd: pasta, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: pasta } })
    assert.doesNotMatch(sem, /HANDOFF ATIVO/)
    writeFileSync(join(pasta, 'HANDOFF.md'), '# Tarefa\nfazer X\n')
    const com = execFileSync(hook('bootstrap-context.sh'), { cwd: pasta, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: pasta } })
    assert.match(com, /HANDOFF ATIVO/)
    assert.match(com, /fazer X/)
  } finally {
    rmSync(pasta, { recursive: true, force: true })
  }
})

test('hook de parada não bloqueia sem alterações e respeita stop_hook_active', () => {
  const pasta = mkdtempSync(join(tmpdir(), 'ambiente-'))
  try {
    execFileSync('git', ['init', '-q'], { cwd: pasta })
    const env = { ...process.env, CLAUDE_PROJECT_DIR: pasta }
    const limpo = spawnSync(hook('verificar-ao-parar.sh'), { cwd: pasta, env, input: '{}', encoding: 'utf8' })
    assert.equal(limpo.status, 0)
    assert.equal(limpo.stdout, '')
    const continuando = spawnSync(hook('verificar-ao-parar.sh'), { cwd: pasta, env, input: '{"stop_hook_active":true}', encoding: 'utf8' })
    assert.equal(continuando.status, 0)
    assert.equal(continuando.stdout, '')
  } finally {
    rmSync(pasta, { recursive: true, force: true })
  }
})

test('hook de parada bloqueia quando o typecheck falha', () => {
  const pasta = mkdtempSync(join(tmpdir(), 'ambiente-'))
  try {
    execFileSync('git', ['init', '-q'], { cwd: pasta })
    execFileSync('mkdir', ['-p', join(pasta, 'node_modules', '.bin')])
    writeFileSync(join(pasta, 'node_modules', '.bin', 'tsc'), '#!/bin/sh\necho "erro de tipo simulado"\nexit 2\n', { mode: 0o755 })
    writeFileSync(join(pasta, 'a.ts'), 'export const x: number = "texto"\n')
    const env = { ...process.env, CLAUDE_PROJECT_DIR: pasta, PATH: `${join(pasta, 'node_modules', '.bin')}:${process.env.PATH}` }
    const resultado = spawnSync(hook('verificar-ao-parar.sh'), { cwd: pasta, env, input: '{}', encoding: 'utf8' })
    assert.equal(resultado.status, 0)
    const decisao = JSON.parse(resultado.stdout)
    assert.equal(decisao.decision, 'block')
    assert.match(decisao.reason, /typecheck falhou/)
  } finally {
    rmSync(pasta, { recursive: true, force: true })
  }
})

test('settings do projeto não escapam do repositório e protegem leituras sensíveis', () => {
  const configuracao = JSON.parse(readFileSync(join(raiz, '.claude', 'settings.json'), 'utf8'))
  assert.equal(configuracao.agent, 'arquiteto')
  assert.doesNotMatch(JSON.stringify(configuracao), /\/Users\/|\$HOME/)
  assert.ok(configuracao.permissions.deny.some((regra) => regra.includes('.env')))
})
