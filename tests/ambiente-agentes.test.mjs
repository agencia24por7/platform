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

test('settings do projeto não escapam do repositório e protegem leituras sensíveis', () => {
  const configuracao = JSON.parse(readFileSync(join(raiz, '.claude', 'settings.json'), 'utf8'))
  assert.equal(configuracao.agent, 'arquiteto')
  assert.doesNotMatch(JSON.stringify(configuracao), /\/Users\/|\$HOME/)
  assert.ok(configuracao.permissions.deny.some((regra) => regra.includes('.env')))
})
