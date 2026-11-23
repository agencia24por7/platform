import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, copyFileSync, chmodSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const scriptDeSeguranca = join(raiz, 'scripts', 'seguranca-verificar.mjs')
const falso = (...partes) => partes.join('')
const SHA_FIXO = 'a'.repeat(40)

function git(pasta, ...argumentos) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...argumentos], { cwd: pasta, encoding: 'utf8' }).trim()
}

function criarRepositorio() {
  const pasta = mkdtempSync(join(tmpdir(), 'git-hooks-'))
  git(pasta, 'init', '-q', '-b', 'dev')
  mkdirSync(join(pasta, 'db', 'migrations'), { recursive: true })
  writeFileSync(join(pasta, 'db', 'migrations', '0001_base.sql'), 'create table a (id int);\n')
  writeFileSync(join(pasta, 'db', 'corte-gate.txt'), '# gate\n')
  git(pasta, 'add', '.')
  git(pasta, 'commit', '-q', '-m', 'base')
  return pasta
}

function escrever(pasta, caminho, conteudo) {
  mkdirSync(dirname(join(pasta, caminho)), { recursive: true })
  writeFileSync(join(pasta, caminho), conteudo)
}

function verificar(pasta, argumentos, entrada = '', env = {}) {
  return spawnSync('node', [scriptDeSeguranca, ...argumentos], {
    cwd: pasta,
    encoding: 'utf8',
    input: entrada,
    env: { ...process.env, ...env },
  })
}

function preparar(pasta, caminho, conteudo) {
  escrever(pasta, caminho, conteudo)
  git(pasta, 'add', caminho)
}

test('alteração limpa no índice passa', () => {
  const pasta = criarRepositorio()
  try {
    preparar(pasta, 'src/a.ts', 'export const a = 1\n')
    const resultado = verificar(pasta, ['--staged'])
    assert.equal(resultado.status, 0, resultado.stderr)
  } finally {
    rmSync(pasta, { recursive: true, force: true })
  }
})

test('segredo no índice bloqueia e o valor nunca aparece na saída', () => {
  const pasta = criarRepositorio()
  try {
    const valor = falso('ghp', '_', 'Q'.repeat(36))
    preparar(pasta, 'src/b.ts', `export const t = '${valor}'\n`)
    const resultado = verificar(pasta, ['--staged'])
    assert.equal(resultado.status, 1)
    assert.match(resultado.stderr, /src\/b\.ts:1 \[segredo\]/)
    assert.ok(!resultado.stderr.includes(valor) && !resultado.stdout.includes(valor))
  } finally {
    rmSync(pasta, { recursive: true, force: true })
  }
})

test('arquivo .env versionado bloqueia, mas .env.example passa', () => {
  const pasta = criarRepositorio()
  try {
    preparar(pasta, '.env.example', 'A=\n')
    assert.equal(verificar(pasta, ['--staged']).status, 0)
    preparar(pasta, '.env', 'A=1\n')
    const resultado = verificar(pasta, ['--staged'])
    assert.equal(resultado.status, 1)
    assert.match(resultado.stderr, /\[arquivo-sensivel\]/)
  } finally {
    rmSync(pasta, { recursive: true, force: true })
  }
})

test('padrões inseguros de código são barrados fora de teste e tolerados em teste', () => {
  const pasta = criarRepositorio()
  try {
    preparar(pasta, 'src/c.ts', 'const o = { rejectUnauthorized: false }\n')
    assert.match(verificar(pasta, ['--staged']).stderr, /\[tls-desligado\]/)
    git(pasta, 'reset', '-q')
    preparar(pasta, 'src/d.ts', 'const r = eval(entrada)\n')
    assert.match(verificar(pasta, ['--staged']).stderr, /\[eval-dinamico\]/)
    git(pasta, 'reset', '-q')
    preparar(pasta, 'src/e.ts', 'await sql.unsafe(`select * from t where id = ${id}`)\n')
    assert.match(verificar(pasta, ['--staged']).stderr, /\[sql-interpolado\]/)
    git(pasta, 'reset', '-q')
    preparar(pasta, 'src/e.test.ts', 'const r = eval(entrada)\n')
    assert.equal(verificar(pasta, ['--staged']).status, 0)
  } finally {
    rmSync(pasta, { recursive: true, force: true })
  }
})

test('migração versionada é imutável e migração destrutiva exige o portão', () => {
  const pasta = criarRepositorio()
  try {
    preparar(pasta, 'db/migrations/0001_base.sql', 'create table a (id bigint);\n')
    assert.match(verificar(pasta, ['--staged']).stderr, /\[migracao-imutavel\]/)
    git(pasta, 'reset', '-q', '--hard')
    preparar(pasta, 'db/migrations/0002_limpar.sql', 'drop table a;\n')
    assert.match(verificar(pasta, ['--staged']).stderr, /\[migracao-destrutiva-fora-do-portao\]/)
    preparar(pasta, 'db/corte-gate.txt', '# gate\n0002_limpar.sql\n')
    assert.equal(verificar(pasta, ['--staged']).status, 0)
    git(pasta, 'reset', '-q', '--hard')
    preparar(pasta, 'db/migrations/0003_nova.sql', 'create index concurrently if not exists i on a (id);\n')
    assert.equal(verificar(pasta, ['--staged']).status, 0)
  } finally {
    rmSync(pasta, { recursive: true, force: true })
  }
})

test('workflow, Terraform e package.json recebem as regras da cadeia de suprimentos', () => {
  const pasta = criarRepositorio()
  try {
    preparar(pasta, '.github/workflows/x.yml', 'jobs:\n  a:\n    steps:\n      - uses: actions/checkout@v4\n')
    assert.match(verificar(pasta, ['--staged']).stderr, /\[workflow-acao-sem-sha\]/)
    git(pasta, 'reset', '-q')
    preparar(pasta, '.github/workflows/x.yml', `jobs:\n  a:\n    steps:\n      - uses: actions/checkout@${SHA_FIXO}\n`)
    assert.equal(verificar(pasta, ['--staged']).status, 0)
    git(pasta, 'reset', '-q')
    preparar(pasta, 'infra/terraform/rede.tf', 'source_ranges = ["0.0.0.0/0"]\n')
    assert.match(verificar(pasta, ['--staged']).stderr, /\[terraform-aberto-ao-mundo\]/)
    escrever(pasta, '.githooks/seguranca-allowlist.txt', 'infra/terraform/rede.tf::terraform-aberto-ao-mundo\n')
    assert.equal(verificar(pasta, ['--staged']).status, 0)
    git(pasta, 'reset', '-q')
    preparar(pasta, 'package.json', '{\n  "scripts": {\n    "postinstall": "node x.js"\n  }\n}\n')
    assert.match(verificar(pasta, ['--staged']).stderr, /\[pacote-script-de-instalacao\]/)
  } finally {
    rmSync(pasta, { recursive: true, force: true })
  }
})

test('--range encontra segredo em commits já feitos', () => {
  const pasta = criarRepositorio()
  try {
    const base = git(pasta, 'rev-parse', 'HEAD')
    escrever(pasta, 'src/f.ts', `export const k = '${falso('AKI', 'A', 'ABCDEFGHIJKLMNOP')}'\n`)
    git(pasta, 'add', '.')
    git(pasta, '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'ruim')
    const resultado = verificar(pasta, ['--range', `${base}..HEAD`])
    assert.equal(resultado.status, 1)
    assert.match(resultado.stderr, /src\/f\.ts:1 \[segredo\]/)
  } finally {
    rmSync(pasta, { recursive: true, force: true })
  }
})

test('--push bloqueia main, histórico reescrito e segredo, e libera push limpo', () => {
  const pasta = criarRepositorio()
  const remoto = mkdtempSync(join(tmpdir(), 'git-remoto-'))
  try {
    execFileSync('git', ['init', '-q', '--bare', '-b', 'dev'], { cwd: remoto })
    git(pasta, 'remote', 'add', 'origin', remoto)
    git(pasta, 'push', '-q', 'origin', 'dev')
    const base = git(pasta, 'rev-parse', 'HEAD')
    escrever(pasta, 'src/g.ts', 'export const g = 1\n')
    git(pasta, 'add', '.')
    git(pasta, 'commit', '-q', '-m', 'limpo')
    const limpo = git(pasta, 'rev-parse', 'HEAD')

    const linha = (refRemota, shaLocal, shaRemota) => `refs/heads/x ${shaLocal} ${refRemota} ${shaRemota}\n`
    assert.equal(verificar(pasta, ['--push', 'origin'], linha('refs/heads/feature', limpo, '0'.repeat(40))).status, 0)

    const emMain = verificar(pasta, ['--push', 'origin'], linha('refs/heads/main', limpo, '0'.repeat(40)))
    assert.equal(emMain.status, 1)
    assert.match(emMain.stderr, /\[push-em-main\]/)
    const liberado = verificar(pasta, ['--push', 'origin'], linha('refs/heads/main', limpo, '0'.repeat(40)), { RELEASE_PUSH_MAIN_AUTORIZADO: '1' })
    assert.equal(liberado.status, 0, liberado.stderr)

    git(pasta, 'reset', '-q', '--hard', base)
    escrever(pasta, 'src/h.ts', 'export const h = 2\n')
    git(pasta, 'add', '.')
    git(pasta, 'commit', '-q', '-m', 'outro')
    const divergente = git(pasta, 'rev-parse', 'HEAD')
    const forcado = verificar(pasta, ['--push', 'origin'], linha('refs/heads/dev', divergente, limpo))
    assert.equal(forcado.status, 1)
    assert.match(forcado.stderr, /\[push-forcado\]|\[push-em-main\]/)

    git(pasta, 'reset', '-q', '--hard', base)
    escrever(pasta, 'src/i.ts', `export const s = '${falso('ghp', '_', 'W'.repeat(36))}'\n`)
    git(pasta, 'add', '.')
    git(pasta, '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'ruim')
    const ruim = git(pasta, 'rev-parse', 'HEAD')
    const comSegredo = verificar(pasta, ['--push', 'origin'], linha('refs/heads/feature', ruim, '0'.repeat(40)))
    assert.equal(comSegredo.status, 1)
    assert.match(comSegredo.stderr, /\[segredo\]/)
  } finally {
    rmSync(pasta, { recursive: true, force: true })
    rmSync(remoto, { recursive: true, force: true })
  }
})

test('hooks reais do git: commit e push passam pelo verificador', () => {
  const pasta = criarRepositorio()
  const remoto = mkdtempSync(join(tmpdir(), 'git-remoto-'))
  try {
    mkdirSync(join(pasta, 'scripts'), { recursive: true })
    mkdirSync(join(pasta, '.claude', 'hooks', 'lib'), { recursive: true })
    mkdirSync(join(pasta, '.githooks'), { recursive: true })
    copyFileSync(scriptDeSeguranca, join(pasta, 'scripts', 'seguranca-verificar.mjs'))
    copyFileSync(join(raiz, '.claude', 'hooks', 'lib', 'politicas.mjs'), join(pasta, '.claude', 'hooks', 'lib', 'politicas.mjs'))
    copyFileSync(join(raiz, '.claude', 'hooks', 'lib', 'diff.mjs'), join(pasta, '.claude', 'hooks', 'lib', 'diff.mjs'))
    for (const nome of ['pre-commit', 'pre-push']) {
      copyFileSync(join(raiz, '.githooks', nome), join(pasta, '.githooks', nome))
      chmodSync(join(pasta, '.githooks', nome), 0o755)
    }
    git(pasta, 'config', 'core.hooksPath', '.githooks')
    execFileSync('git', ['init', '-q', '--bare', '-b', 'dev'], { cwd: remoto })
    git(pasta, 'remote', 'add', 'origin', remoto)

    escrever(pasta, 'src/ruim.ts', `export const s = '${falso('ghp', '_', 'E'.repeat(36))}'\n`)
    git(pasta, 'add', 'src/ruim.ts')
    const barrado = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'ruim'], { cwd: pasta, encoding: 'utf8' })
    assert.notEqual(barrado.status, 0)
    assert.match(barrado.stderr, /\[segredo\]/)
    git(pasta, 'reset', '-q')

    escrever(pasta, 'src/bom.ts', 'export const ok = true\n')
    git(pasta, 'add', 'src/bom.ts')
    git(pasta, 'commit', '-q', '-m', 'bom')
    const enviado = spawnSync('git', ['push', 'origin', 'HEAD:refs/heads/feature'], { cwd: pasta, encoding: 'utf8' })
    assert.equal(enviado.status, 0, enviado.stderr)
    const emMain = spawnSync('git', ['push', 'origin', 'HEAD:refs/heads/main'], { cwd: pasta, encoding: 'utf8' })
    assert.notEqual(emMain.status, 0)
    assert.match(emMain.stderr, /\[push-em-main\]/)
  } finally {
    rmSync(pasta, { recursive: true, force: true })
    rmSync(remoto, { recursive: true, force: true })
  }
})

test('a árvore do repositório passa na verificação (paridade com o CI)', () => {
  const resultado = spawnSync('node', [scriptDeSeguranca, '--arvore'], { cwd: raiz, encoding: 'utf8' })
  assert.equal(resultado.status, 0, resultado.stderr)
})

test('hooks do git do projeto estão instalados no repositório e são executáveis', () => {
  const manifesto = JSON.parse(readFileSync(join(raiz, 'package.json'), 'utf8'))
  assert.equal(manifesto.scripts['ambiente:hooks'], 'git config core.hooksPath .githooks')
  assert.equal(manifesto.scripts['seguranca:verificar'], 'node scripts/seguranca-verificar.mjs --arvore')
  for (const nome of ['pre-commit', 'pre-push']) {
    const resultado = spawnSync('test', ['-x', join(raiz, '.githooks', nome)])
    assert.equal(resultado.status, 0, `${nome} sem permissão de execução`)
  }
})

test('linha adicionada que começa com ++ não escapa da varredura', () => {
  const pasta = criarRepositorio()
  try {
    const valor = falso('ghp', '_', 'K'.repeat(36))
    preparar(pasta, 'src/j.ts', `++${valor}\n`)
    const resultado = verificar(pasta, ['--staged'])
    assert.equal(resultado.status, 1)
    assert.match(resultado.stderr, /src\/j\.ts:1 \[segredo\]/)
    assert.ok(!resultado.stderr.includes(valor))
  } finally {
    rmSync(pasta, { recursive: true, force: true })
  }
})

test('nome de arquivo com aspas não desvia a atribuição nem a varredura', () => {
  const pasta = criarRepositorio()
  try {
    preparar(pasta, 'src/we"ird.ts', 'const o = { rejectUnauthorized: false }\n')
    const resultado = verificar(pasta, ['--staged'])
    assert.equal(resultado.status, 1)
    assert.match(resultado.stderr, /\[tls-desligado\]/)
    git(pasta, 'reset', '-q')
    preparar(pasta, 'src/ç-acentuado.ts', `const k = '${falso('AKI', 'A', 'ABCDEFGHIJKLMNOP')}'\n`)
    assert.match(verificar(pasta, ['--staged']).stderr, /ç-acentuado\.ts:1 \[segredo\]/)
  } finally {
    rmSync(pasta, { recursive: true, force: true })
  }
})
