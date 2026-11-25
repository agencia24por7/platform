import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, copyFileSync, chmodSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { detectarSegredo } from '../.claude/hooks/lib/politicas.mjs'
import { LINHA_MAXIMA, SOBREPOSICAO_DE_FATIA, TODOS_OS_PADROES, PADROES_DE_SEGREDO, fatiasDaLinha } from '../scripts/seguranca-padroes.mjs'

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const scriptDeSeguranca = join(raiz, 'scripts', 'seguranca-verificar.mjs')
const falso = (...partes) => partes.join('')
const SHA_FIXO = 'a'.repeat(40)
const assinatura = (texto) => createHash('sha256').update(texto.trim().replace(/\s+/g, ' ')).digest('hex').slice(0, 12)
const LINHA_ABERTA = 'source_ranges = ["0.0.0.0/0"]'

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
    preparar(pasta, 'infra/terraform/rede.tf', `${LINHA_ABERTA}\n`)
    assert.match(verificar(pasta, ['--staged']).stderr, /\[terraform-aberto-ao-mundo\]/)
    escrever(pasta, '.githooks/seguranca-allowlist.txt', `infra/terraform/rede.tf::terraform-aberto-ao-mundo::${assinatura(LINHA_ABERTA)}::1\n`)
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
    copyFileSync(join(raiz, 'scripts', 'seguranca-padroes.mjs'), join(pasta, 'scripts', 'seguranca-padroes.mjs'))
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

function segredoBloqueado(pasta, caminho, conteudo) {
  git(pasta, 'reset', '-q')
  preparar(pasta, caminho, conteudo)
  const resultado = verificar(pasta, ['--staged'])
  git(pasta, 'reset', '-q')
  return resultado
}

function comRepositorio(corpo) {
  const pasta = criarRepositorio()
  try {
    corpo(pasta)
  } finally {
    rmSync(pasta, { recursive: true, force: true })
  }
}

test('URL com credencial embutida bloqueia; placeholder, variável e host local passam', () => {
  comRepositorio((pasta) => {
    const real = falso("export const u = 'postgres://app:", 'Zx9kQ2mV7tR4', "@db.interno:5432/x'\n")
    const bloqueado = segredoBloqueado(pasta, 'src/u.ts', real)
    assert.equal(bloqueado.status, 1)
    assert.match(bloqueado.stderr, /src\/u\.ts:1 \[segredo\]/)
    assert.ok(!bloqueado.stderr.includes('Zx9kQ2mV7tR4'))
    for (const livre of [
      "export const u = 'postgres://user:password@host/x'\n",
      "export const u = 'postgres://usuario:senha@host/x'\n",
      "export const u = 'postgres://app:${SENHA}@host/x'\n",
      "export const u = 'postgres://app:Zx9kQ2mV7tR4@localhost:5432/x'\n",
      "export const u = 'https://exemplo.com/caminho'\n",
    ]) assert.equal(segredoBloqueado(pasta, 'src/u.ts', livre).status, 0, livre)
  })
})

test('atribuição sem aspas em .sh, .yml e .env.* bloqueia; referência e exemplo passam', () => {
  comRepositorio((pasta) => {
    const valor = falso('Zx9kQ2mV7tR4', 'pL8nB3cW5yH6')
    for (const [caminho, conteudo] of [
      ['scripts/x.sh', `export API_TOKEN=${valor}\n`],
      ['deploy/x.yml', `  senha: ${valor}\n`],
      ['config/x.tf', `ENCRYPTION_KEY=${valor}\n`],
      ['.env.ci', `CHAVE_SECRETA=${valor}\n`],
    ]) {
      const resultado = segredoBloqueado(pasta, caminho, conteudo)
      assert.equal(resultado.status, 1, caminho)
      assert.match(resultado.stderr, /\[segredo\]/)
      assert.ok(!resultado.stderr.includes(valor))
    }
    for (const [caminho, conteudo] of [
      ['scripts/x.sh', 'export API_TOKEN=$(cat arquivo)\n'],
      ['scripts/y.sh', 'TOKEN="${TOKEN_DO_AMBIENTE}"\n'],
      ['deploy/x.yml', '  token: ${{ secrets.TOKEN_DO_ROBO }}\n'],
      ['deploy/y.yml', '  senha: changeme1234567890abc\n'],
      ['deploy/z.yml', '  secret_id: google_secret_manager_secret.token.secret_id\n'],
      ['src/ignorado.ts', `const API_TOKEN=${valor}\n`],
    ]) assert.equal(segredoBloqueado(pasta, caminho, conteudo).status, 0, `${caminho}: ${conteudo}`)
  })
})

test('nome em português e ENCRYPTION_KEY entre aspas bloqueiam; UUID e nome de campo passam', () => {
  comRepositorio((pasta) => {
    const valor = falso('Zx9kQ2mV7tR4', 'pL8nB3cW5yH6dd')
    for (const nome of ['senha', 'segredo', 'chave', 'ENCRYPTION_KEY']) {
      const resultado = segredoBloqueado(pasta, 'src/p.ts', `export const ${nome} = '${valor}'\n`)
      assert.equal(resultado.status, 1, nome)
      assert.match(resultado.stderr, /\[segredo\]/)
    }
    assert.equal(segredoBloqueado(pasta, 'src/p.ts', "const SONDA_DA_CHAVE = '00000000-0000-4000-8000-000000000000'\n").status, 0)
    assert.equal(segredoBloqueado(pasta, 'src/p.ts', "ChaveDeCorrespondencia: 'chave_de_correspondencia',\n").status, 0)
    assert.equal(segredoBloqueado(pasta, 'src/p.test.ts', `export const senha = '${valor}'\n`).status, 0)
  })
})

test('JWT e webhook do Slack bloqueiam; menção sem o segredo passa', () => {
  comRepositorio((pasta) => {
    const jwt = falso('ey', 'JhbGciOiJIUzI1NiJ9', '.', 'ey', 'JzdWIiOiIxMjM0NTY3ODkwIn0', '.', 'SflKxwRJSMeKKF2QT4fw')
    const webhook = falso('https://hooks.slack', '.com/services/', 'T0ABCDEFG/B0ABCDEFG/', 'Xy9Zk2mV7tR4pL8n')
    for (const [caminho, conteudo] of [['docs/a.md', `exemplo ${jwt}\n`], ['src/b.ts', `const u = '${webhook}'\n`]]) {
      const resultado = segredoBloqueado(pasta, caminho, conteudo)
      assert.equal(resultado.status, 1, caminho)
      assert.match(resultado.stderr, /\[segredo\]/)
      assert.ok(!resultado.stderr.includes(jwt) && !resultado.stderr.includes(webhook))
    }
    assert.equal(segredoBloqueado(pasta, 'docs/c.md', 'O webhook vive em hooks.slack.com/services/ e não vai para o repositório. Um JWT começa com eyJ.\n').status, 0)
  })
})

test('hexadecimal de 32+ caracteres junto de nome sensível bloqueia, inclusive no JSON de credencial do n8n', () => {
  comRepositorio((pasta) => {
    const hex = 'a1b2c3d4'.repeat(5)
    for (const [caminho, conteudo] of [
      ['src/h.ts', `export const apiKey = '${hex}'\n`],
      ['config/h.yml', `encryption_key: ${hex}\n`],
      ['n8n/c.json', `{"name": "api_key", "value": "${hex}"}\n`],
      ['n8n/d.json', `{\n  "name": "client_secret",\n  "type": "string",\n  "value": "${hex}"\n}\n`],
      ['n8n/e.json', `{\n  "value": "${hex}",\n  "name": "meu_token"\n}\n`],
    ]) {
      const resultado = segredoBloqueado(pasta, caminho, conteudo)
      assert.equal(resultado.status, 1, caminho)
      assert.match(resultado.stderr, /\[segredo\]/)
      assert.ok(!resultado.stderr.includes(hex))
    }
    for (const [caminho, conteudo] of [
      ['src/h.ts', `export const checksum = '${hex}'\n`],
      ['n8n/c.json', `{"name": "regiao", "value": "${hex}"}\n`],
      ['n8n/d.json', `{\n  "name": "client_secret",\n  "a": 1,\n  "b": 2,\n  "c": 3,\n  "d": 4,\n  "value": "${hex}"\n}\n`],
      ['n8n/e.json', '{"name": "api_key", "value": "curto"}\n'],
    ]) assert.equal(segredoBloqueado(pasta, caminho, conteudo).status, 0, `${caminho}: ${conteudo}`)
  })
})

test('--arvore varre arquivo grande e linha gigante, e pula binário', () => {
  comRepositorio((pasta) => {
    const valor = falso('ghp', '_', 'Z'.repeat(36))
    const enchimento = 'const x = 1\n'.repeat(30_000)
    escrever(pasta, 'src/grande.ts', `${enchimento}export const t = '${valor}'\n`)
    escrever(pasta, 'src/gigante.ts', `${'a'.repeat(450_000)}'${valor}'${'b'.repeat(10)}\n`)
    writeFileSync(join(pasta, 'src', 'binario.bin'), Buffer.concat([Buffer.from([0, 1, 2, 3]), Buffer.from(`'${valor}'\n`)]))
    git(pasta, 'add', '.')
    const resultado = verificar(pasta, ['--arvore'])
    assert.equal(resultado.status, 1)
    assert.match(resultado.stderr, /src\/grande\.ts:30001 \[segredo\]/)
    assert.match(resultado.stderr, /src\/gigante\.ts:1 \[segredo\]/)
    assert.doesNotMatch(resultado.stderr, /binario\.bin/)
    assert.ok(!resultado.stderr.includes(valor))
  })
})

test('--range barra migração destrutiva fora do portão e migração alterada, mesmo commitadas sem os hooks', () => {
  comRepositorio((pasta) => {
    const base = git(pasta, 'rev-parse', 'HEAD')
    escrever(pasta, 'db/migrations/0002_limpar.sql', 'drop table a;\n')
    git(pasta, 'add', '.')
    git(pasta, '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'drop')
    assert.equal(verificar(pasta, ['--arvore']).status, 0)
    const fora = verificar(pasta, ['--range', `${base}..HEAD`])
    assert.equal(fora.status, 1)
    assert.match(fora.stderr, /\[migracao-destrutiva-fora-do-portao\]/)

    escrever(pasta, 'db/corte-gate.txt', '# gate\n0002_limpar.sql\n')
    git(pasta, 'add', '.')
    git(pasta, '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'portao')
    assert.equal(verificar(pasta, ['--range', `${base}..HEAD`]).status, 0)

    escrever(pasta, 'db/migrations/0001_base.sql', 'create table a (id bigint);\n')
    git(pasta, 'add', '.')
    git(pasta, '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'altera')
    const alterada = verificar(pasta, ['--range', `${base}..HEAD`])
    assert.equal(alterada.status, 1)
    assert.match(alterada.stderr, /\[migracao-imutavel\]/)
  })
})

test('--range falha fechado com revisão inexistente e aceita base nula (push de ramo novo)', () => {
  comRepositorio((pasta) => {
    const inexistente = verificar(pasta, ['--range', `${'b'.repeat(40)}..HEAD`])
    assert.equal(inexistente.status, 2)
    assert.match(inexistente.stderr, /revisão não encontrada/)
    const nulo = verificar(pasta, ['--range', `${'0'.repeat(40)}..HEAD`])
    assert.equal(nulo.status, 0, nulo.stderr)
  })
})

test('allowlist amarra o conteúdo: linha trocada, linha igual a mais e entrada velha falham', () => {
  comRepositorio((pasta) => {
    const entrada = `infra/terraform/rede.tf::terraform-aberto-ao-mundo::${assinatura(LINHA_ABERTA)}::1\n`
    escrever(pasta, 'infra/terraform/rede.tf', `${LINHA_ABERTA}\n`)
    git(pasta, 'add', '.')
    const sugerida = verificar(pasta, ['--arvore', '--sugerir'])
    assert.equal(sugerida.status, 0)
    assert.equal(sugerida.stdout, entrada)

    escrever(pasta, '.githooks/seguranca-allowlist.txt', entrada)
    assert.equal(verificar(pasta, ['--arvore']).status, 0)
    assert.equal(verificar(pasta, ['--staged']).status, 0)

    escrever(pasta, 'infra/terraform/rede.tf', `${LINHA_ABERTA}\n${LINHA_ABERTA}\n`)
    const duplicada = verificar(pasta, ['--arvore'])
    assert.equal(duplicada.status, 1)
    assert.match(duplicada.stderr, /\[allowlist-divergente\]/)

    escrever(pasta, 'infra/terraform/rede.tf', 'source_ranges = ["0.0.0.0/0"]  # outra\nsource_ranges = ["0.0.0.0/0"]\n')
    git(pasta, 'add', '.')
    assert.match(verificar(pasta, ['--staged']).stderr, /\[terraform-aberto-ao-mundo\]/)

    escrever(pasta, 'infra/terraform/rede.tf', 'resource "x" "y" {}\n')
    const obsoleta = verificar(pasta, ['--arvore'])
    assert.equal(obsoleta.status, 1)
    assert.match(obsoleta.stderr, /\[allowlist-divergente\]/)
  })
})

test('allowlist no formato antigo (sem assinatura) é rejeitada', () => {
  comRepositorio((pasta) => {
    escrever(pasta, '.githooks/seguranca-allowlist.txt', 'infra/terraform/rede.tf::terraform-aberto-ao-mundo\n')
    const resultado = verificar(pasta, ['--arvore'])
    assert.equal(resultado.status, 2)
    assert.match(resultado.stderr, /entrada inválida/)
  })
})

test('o CI roda a varredura da árvore e a do intervalo, sem interpolar evento em run', () => {
  const ci = readFileSync(join(raiz, '.github', 'workflows', 'ci.yml'), 'utf8')
  assert.match(ci, /fetch-depth: 0/)
  assert.match(ci, /seguranca-verificar\.mjs --range/)
  for (const linha of ci.split('\n').filter((texto) => texto.includes('github.event'))) assert.match(linha, /^\s+[A-Z_]+:\s*\$\{\{/, linha)
})

const UNIDADES_ADVERSARIAS = ['token', 'token=', 'senha="', 'eyJa.', 'ab://c:', ' ', 'hooks.slack.com/services/', 'token=a1b2', 'curl ', '.unsafe(`', '"a":"', 'secret: ', 'ghp_', 'Bearer ', `token${' '.repeat(60)}= "a`, `token = "${'a'.repeat(30)} `, 'password: aaaaaaaaaaaaaaaaaaaaaaa ']
const TAMANHO_BASE_ADVERSARIO = 100_000
const LIMITE_DE_CRESCIMENTO_AO_DOBRAR = 3
const MEDICOES_POR_TAMANHO = 3

function tempoDaVarreduraMs(tamanho) {
  const pasta = criarRepositorio()
  try {
    UNIDADES_ADVERSARIAS.forEach((unidade, indice) => {
      const linha = `${unidade.repeat(Math.ceil(tamanho / unidade.length))}\n`
      escrever(pasta, `a${indice}.yml`, linha)
      escrever(pasta, `.github/workflows/w${indice}.yml`, linha)
    })
    git(pasta, 'add', '.')
    const inicio = process.hrtime.bigint()
    const resultado = verificar(pasta, ['--staged'])
    const decorrido = Number(process.hrtime.bigint() - inicio) / 1_000_000
    assert.notEqual(resultado.status, 2, resultado.stderr)
    return decorrido
  } finally {
    rmSync(pasta, { recursive: true, force: true })
  }
}

function menorTempoMs(tamanho) {
  return Math.min(...Array.from({ length: MEDICOES_POR_TAMANHO }, () => tempoDaVarreduraMs(tamanho)))
}

test('entrada adversarial não gera custo quadrático: dobrar a linha não mais que triplica o tempo', () => {
  const crescimento = menorTempoMs(TAMANHO_BASE_ADVERSARIO * 2) / menorTempoMs(TAMANHO_BASE_ADVERSARIO)
  assert.ok(crescimento < LIMITE_DE_CRESCIMENTO_AO_DOBRAR, `custo cresceu ${crescimento.toFixed(1)}x ao dobrar a entrada`)
})

test('segredo que atravessa a fronteira da fatia de linha é detectado em qualquer posição', () => {
  comRepositorio((pasta) => {
    const token = falso('ghp', '_', 'V'.repeat(36))
    const atribuicao = `senha = '${falso('Zx9kQ2mV7tR4', 'pL8nB3cW5yH6dd')}'`
    for (const [segredo, nome] of [[token, 'token'], [atribuicao, 'atribuição']]) {
      for (const deslocamento of [7900, 7960, 7975, 7990, 7999, 8000, 13900, 13990]) {
        const linha = `${' '.repeat(deslocamento)}${segredo}${' '.repeat(50)}\n`
        const resultado = segredoBloqueado(pasta, 'src/fronteira.ts', linha)
        assert.equal(resultado.status, 1, `${nome} em ${deslocamento}`)
        assert.match(resultado.stderr, /src\/fronteira\.ts:1 \[segredo\]/)
      }
    }
  })
})

test('varredura de arquivo enorme numa linha só termina com saída limitada', () => {
  comRepositorio((pasta) => {
    escrever(pasta, 'src/enorme.ts', `${'token='.repeat(500_000)}\n`)
    git(pasta, 'add', '.')
    assert.notEqual(verificar(pasta, ['--arvore']).status, 2)
  })
})

const repetir = (caractere, vezes) => caractere.repeat(vezes)
const ESPACOS_ATE_20 = repetir(' ', 20)
const ESPACOS_ATE_8 = repetir(' ', 8)
const ESPACOS_ATE_64 = repetir(' ', 64)

const EXEMPLARES_MAXIMOS = {
  'tls-desligado': `NODE_TLS_REJECT_UNAUTHORIZED${ESPACOS_ATE_20}=${ESPACOS_ATE_20}'0`,
  'html-injetado': falso('dangerously', 'SetInnerHTML'),
  'eval-dinamico': `new${ESPACOS_ATE_20}Function${ESPACOS_ATE_20}(`,
  'sql-interpolado': `.unsafe${ESPACOS_ATE_20}(${ESPACOS_ATE_20}\`${repetir('a', 1000)}\${`,
  'shell-interpolado': `execSync${ESPACOS_ATE_20}(${ESPACOS_ATE_20}\`${repetir('a', 1000)}\${`,
  'cors-aberto': `Access-Control-Allow-Origin'${ESPACOS_ATE_20}:${ESPACOS_ATE_20}'*'`,
  'workflow-pull-request-target': 'pull_request_target',
  'workflow-permissao-total': `permissions:${ESPACOS_ATE_20}write-all`,
  'workflow-acao-sem-sha': `${repetir(' ', 40)}-${ESPACOS_ATE_20}uses:${ESPACOS_ATE_20}${repetir('a', 200)}@v1`,
  'workflow-baixa-e-executa': `curl ${repetir('x', 499)}|${ESPACOS_ATE_20}sudo${ESPACOS_ATE_20}bash`,
  'terraform-aberto-ao-mundo': '"0.0.0.0/0"',
  'terraform-publico': 'allAuthenticatedUsers',
  'terraform-papel-amplo': '"roles/editor"',
  'pacote-script-de-instalacao': `"postinstall"${ESPACOS_ATE_20}:`,
  'pacote-origem-nao-registrada': `"${repetir('a', 200)}"${ESPACOS_ATE_20}:${ESPACOS_ATE_20}"github:`,
  'chave privada': falso('-----BEGIN OPENSSH ', 'PRIVATE KEY-----'),
  'chave AWS': `AKIA${repetir('A', 16)}`,
  'token GitHub': `github_pat_${repetir('a', 512)}`,
  'token Slack': `xoxb-${repetir('a', 512)}`,
  'chave Google API': `AIza${repetir('a', 35)}`,
  'token OAuth Google': `ya29.${repetir('a', 512)}`,
  'token Meta': `EAA${repetir('A', 512)}`,
  'chave sk-': `sk-${repetir('a', 512)}`,
  'atribuição de segredo': `private_key${repetir('a', 120)}"${ESPACOS_ATE_64}:${ESPACOS_ATE_64}"${repetir('a', 512)}"`,
  JWT: `eyJ${repetir('a', 100)}.eyJ${repetir('a', 100)}`,
  'webhook Slack': `hooks.slack.com/services/${repetir('a', 200)}`,
  'hexadecimal junto de nome sensível': `encryption_key${repetir('a', 120)}"${ESPACOS_ATE_64}:${ESPACOS_ATE_64}"${repetir('a', 256)}`,
  'url-com-credencial': `a${repetir('b', 20)}://${repetir('u', 64)}:${repetir('p', 100)}@${repetir('h', 100)}`,
  'atribuicao-em-portugues': `encryption_key${repetir('a', 120)}"${ESPACOS_ATE_64}:${ESPACOS_ATE_64}"${repetir('a', 512)}"`,
  'atribuicao-sem-aspas': `encryption_key${repetir('a', 120)}${ESPACOS_ATE_64}=${ESPACOS_ATE_64}${repetir('a', 256)}`,
  'json-nome-sensivel': `"name"${ESPACOS_ATE_8}:${ESPACOS_ATE_8}"${repetir('x', 60)}encryption_key${repetir('x', 60)}"`,
  'json-valor-hexadecimal': `"value"${ESPACOS_ATE_8}:${ESPACOS_ATE_8}"${repetir('a', 256)}`,
}

const FOLGA_MINIMA_DA_SOBREPOSICAO = 512
const DIFERENCA_MAXIMA_ENTRE_DECLARADO_E_REAL = 15
const FRONTEIRAS_DE_FATIA = [LINHA_MAXIMA, LINHA_MAXIMA + (LINHA_MAXIMA - SOBREPOSICAO_DE_FATIA)]

const semEstado = (padrao) => new RegExp(padrao.source, padrao.flags.replace('g', ''))
const idDoPadrao = (entrada) => entrada.id

function quantificadoresIlimitados(padrao) {
  const semEscapes = padrao.source.replace(/\\./g, '')
  const semClasses = semEscapes.replace(/\[(?:[^\]\\])*\]/g, '')
  return /[*+]|\{\d+,\}/.test(semClasses)
}

function posicoesAoRedorDe(fronteira, comprimento) {
  const passo = Math.max(1, Math.floor(comprimento / 8))
  const posicoes = new Set([0])
  for (let posicao = fronteira - comprimento - 20; posicao <= fronteira + 20; posicao += passo) posicoes.add(Math.max(0, posicao))
  for (const extra of [fronteira - comprimento, fronteira - comprimento + 1, fronteira - 1, fronteira]) posicoes.add(Math.max(0, extra))
  return [...posicoes]
}

test('invariante da fatia: nenhum padrão tem quantificador sem limite e todos têm exemplar máximo', () => {
  assert.ok(LINHA_MAXIMA >= 4000 && LINHA_MAXIMA <= 8000)
  for (const entrada of TODOS_OS_PADROES) {
    assert.ok(!quantificadoresIlimitados(entrada.padrao), `${idDoPadrao(entrada)} tem quantificador sem limite`)
    assert.ok(EXEMPLARES_MAXIMOS[idDoPadrao(entrada)], `${idDoPadrao(entrada)} sem exemplar no teste`)
    assert.ok(entrada.maximo + FOLGA_MINIMA_DA_SOBREPOSICAO <= SOBREPOSICAO_DE_FATIA, `${idDoPadrao(entrada)} maior que a sobreposição com folga`)
  }
  const ids = TODOS_OS_PADROES.map(idDoPadrao)
  assert.equal(new Set(ids).size, ids.length)
  assert.deepEqual(Object.keys(EXEMPLARES_MAXIMOS).sort(), [...ids].sort())
})

test('o comprimento máximo declarado de cada padrão é o do exemplar máximo', () => {
  for (const entrada of TODOS_OS_PADROES) {
    const exemplar = EXEMPLARES_MAXIMOS[idDoPadrao(entrada)]
    const casamento = exemplar.match(semEstado(entrada.padrao))
    assert.ok(casamento, `${idDoPadrao(entrada)} não casa o próprio exemplar`)
    assert.ok(casamento[0].length <= entrada.maximo, `${idDoPadrao(entrada)}: casamento ${casamento[0].length} acima do declarado ${entrada.maximo}`)
    assert.ok(entrada.maximo - casamento[0].length <= DIFERENCA_MAXIMA_ENTRE_DECLARADO_E_REAL, `${idDoPadrao(entrada)}: declarado ${entrada.maximo} folgado demais para ${casamento[0].length}`)
  }
})

test('exemplar de tamanho máximo é detectado em toda posição ao redor de cada fronteira de fatia', () => {
  for (const entrada of TODOS_OS_PADROES) {
    const exemplar = EXEMPLARES_MAXIMOS[idDoPadrao(entrada)]
    const padrao = semEstado(entrada.padrao)
    const fronteiras = entrada.inicioDeLinha ? [0] : FRONTEIRAS_DE_FATIA
    for (const fronteira of fronteiras) {
      for (const posicao of posicoesAoRedorDe(fronteira, exemplar.length)) {
        if (entrada.inicioDeLinha && posicao !== 0) continue
        const texto = `${repetir(' ', posicao)}${exemplar} ${repetir(' ', 40)}`
        const detectado = [...fatiasDaLinha({ arquivo: 'a', linha: 1, texto })].some((fatia) => padrao.test(fatia.texto))
        assert.ok(detectado, `${idDoPadrao(entrada)} perdido na posição ${posicao}`)
      }
    }
  }
})

test('os casos do revisor: JWT de payload 1200 e SQL interpolado atravessando a fronteira, pelo script', () => {
  comRepositorio((pasta) => {
    const jwt = `eyJ${repetir('a', 30)}.eyJ${repetir('b', 1200)}.${repetir('c', 342)}`
    for (const posicao of [100, 4900, 7000, 7900, 7990]) {
      const resultado = segredoBloqueado(pasta, 'docs/j.md', `${repetir(' ', posicao)}${jwt}\n`)
      assert.equal(resultado.status, 1, `JWT em ${posicao}`)
    }
    const sql = `await sql.unsafe(\`${repetir('x', 1000)}\${id}\`)`
    for (const posicao of [100, 6900, 7000, 7500, 7900, 7999]) {
      const resultado = segredoBloqueado(pasta, 'src/q.ts', `${repetir(' ', posicao)}${sql}\n`)
      assert.equal(resultado.status, 1, `sql em ${posicao}`)
      assert.match(resultado.stderr, /\[sql-interpolado\]/)
    }
  })
})

test('os padrões base do script cobrem os mesmos tipos de politicas.mjs, sem deriva', () => {
  const fonte = readFileSync(join(raiz, '.claude', 'hooks', 'lib', 'politicas.mjs'), 'utf8')
  const bloco = fonte.slice(fonte.indexOf('const PADROES_DE_SEGREDO = ['), fonte.indexOf('export function detectarSegredo'))
  const tiposDoAmbiente = [...bloco.matchAll(/^\s*\['([^']+)',/gm)].map((casamento) => casamento[1])
  assert.ok(tiposDoAmbiente.length >= 9)
  const tiposDoScript = PADROES_DE_SEGREDO.map(({ tipo }) => tipo)
  for (const tipo of tiposDoAmbiente) assert.ok(tiposDoScript.includes(tipo), `tipo novo em politicas.mjs sem versão limitada no script: ${tipo}`)
  for (const [tipo, exemplar] of [
    ['chave privada', falso('-----BEGIN ', 'PRIVATE KEY-----')],
    ['chave AWS', `AKIA${repetir('A', 16)}`],
    ['token GitHub', `ghp_${repetir('a', 36)}`],
    ['token Slack', `xoxb-${repetir('1', 12)}`],
    ['chave Google API', `AIza${repetir('a', 35)}`],
    ['token OAuth Google', `ya29.${repetir('a', 24)}`],
    ['token Meta', `EAA${repetir('A', 52)}`],
    ['chave sk-', `sk-${repetir('a', 26)}`],
    ['atribuição de segredo', `token = "${repetir('a', 26)}"`],
  ]) {
    assert.ok(detectarSegredo(exemplar).includes(tipo), `ambiente não detecta ${tipo}`)
    assert.ok(PADROES_DE_SEGREDO.some((entrada) => entrada.tipo === tipo && semEstado(entrada.padrao).test(exemplar)), `script não detecta ${tipo}`)
  }
})

const NOMES_DE_ATRIBUICAO = ['token', 'secret', 'password', 'passwd', 'api_key', 'api-key', 'private_key', `PASSWORD_FOR_THE_LEGACY_${repetir('X', 80)}_READONLY`, `token_${repetir('a', 100)}`]
const ESPACOS_ANTES = [0, 1, 2, 8, 20, 40, 60]
const ESPACOS_DEPOIS = [0, 1, 60]
const COMPRIMENTOS_DE_VALOR = [24, 25, 100, 512, 513, 5000]
const POSICOES_NA_LINHA = [0, 7900]

function detectadoPeloScript(tipo, texto) {
  const padrao = semEstado(PADROES_DE_SEGREDO.find((entrada) => entrada.tipo === tipo).padrao)
  return [...fatiasDaLinha({ arquivo: 'a', linha: 1, texto })].some((fatia) => padrao.test(fatia.texto))
}

test('paridade com politicas.mjs: tudo que a atribuição original acusa a versão limitada também acusa', () => {
  let acusadasPeloOriginal = 0
  for (const nome of NOMES_DE_ATRIBUICAO) {
    for (const antes of ESPACOS_ANTES) {
      for (const depois of ESPACOS_DEPOIS) {
        for (const separador of [':', '=']) {
          for (const aspaNoNome of ['', '"']) {
            for (const comprimento of COMPRIMENTOS_DE_VALOR) {
              for (const fechamento of ['"', '']) {
                const atribuicao = `${nome}${aspaNoNome}${repetir(' ', antes)}${separador}${repetir(' ', depois)}"${repetir('a', comprimento)}${fechamento}`
                for (const posicao of POSICOES_NA_LINHA) {
                  const texto = `${repetir(' ', posicao)}${atribuicao} x`
                  if (!detectarSegredo(texto).includes('atribuição de segredo')) continue
                  acusadasPeloOriginal += 1
                  assert.ok(detectadoPeloScript('atribuição de segredo', texto), `perdido: ${nome.slice(0, 12)} antes=${antes} depois=${depois} valor=${comprimento} fecha=${fechamento !== ''} pos=${posicao}`)
                }
              }
            }
          }
        }
      }
    }
  }
  assert.ok(acusadasPeloOriginal > 1000)
})

test('paridade com politicas.mjs: tokens de prefixo conhecido, de qualquer comprimento e com qualquer sufixo', () => {
  const tipos = [
    ['token GitHub', 'ghp_', 30], ['token GitHub', 'github_pat_', 30], ['token Slack', 'xoxb-', 10],
    ['token OAuth Google', 'ya29.', 20], ['token Meta', 'EAA', 50], ['chave sk-', 'sk-', 24],
  ]
  for (const [tipo, prefixo, minimo] of tipos) {
    for (const comprimento of [minimo, minimo + 1, 100, 512, 513, 5000]) {
      for (const sufixo of ['', ' ', '"', '_', 'é']) {
        const texto = `x ${falso(prefixo, repetir('a', comprimento))}${sufixo}`
        if (!detectarSegredo(texto).includes(tipo)) continue
        assert.ok(detectadoPeloScript(tipo, texto), `${tipo} perdido com ${comprimento} caracteres`)
      }
    }
  }
})

test('exemplares do revisor: Terraform alinhado, YAML alinhado, nome longo e valor acima de 512', () => {
  comRepositorio((pasta) => {
    const valor = repetir('a', 30)
    const casos = [
      ['infra/terraform/x.tf', `  password            = "${valor}"\n`],
      ['deploy/x.yml', `  secret:                         "${valor}"\n`],
      ['config/x.ts', `PASSWORD_FOR_THE_LEGACY_APPLICATION_SERVICE_ACCOUNT_READONLY="${valor}"\n`],
      ['src/x.ts', `const c = { token: "${repetir('a', 700)}" }\n`],
    ]
    for (const [caminho, conteudo] of casos) {
      const resultado = segredoBloqueado(pasta, caminho, conteudo)
      assert.equal(resultado.status, 1, caminho)
      assert.match(resultado.stderr, /\[segredo\]/)
    }
  })
})

const LINHA_NULA = '0'.repeat(40)

function verificarEmTodosOsModos(pasta, base) {
  const remoto = mkdtempSync(join(tmpdir(), 'git-remoto-'))
  try {
    execFileSync('git', ['init', '-q', '--bare', '-b', 'dev'], { cwd: remoto })
    git(pasta, 'remote', 'add', 'origin', remoto)
    const resultados = { staged: verificar(pasta, ['--staged']), arvore: verificar(pasta, ['--arvore']) }
    git(pasta, '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'alteracao')
    const cabeca = git(pasta, 'rev-parse', 'HEAD')
    git(pasta, 'push', '-q', 'origin', `${base}:refs/heads/dev`)
    git(pasta, 'fetch', '-q', 'origin')
    resultados.intervalo = verificar(pasta, ['--range', `${base}..${cabeca}`])
    resultados.push = verificar(pasta, ['--push', 'origin'], `refs/heads/x ${cabeca} refs/heads/feature ${LINHA_NULA}\n`)
    return resultados
  } finally {
    rmSync(remoto, { recursive: true, force: true })
  }
}

test('arquivo sensível por nome com extensão binária é acusado em todos os modos', () => {
  comRepositorio((pasta) => {
    const base = git(pasta, 'rev-parse', 'HEAD')
    const nomes = ['.env.gz', 'd/.env.db', '.env.production.zip']
    for (const caminho of nomes) {
      escrever(pasta, caminho, 'x')
      writeFileSync(join(pasta, caminho), Buffer.from([0, 1, 2, 3]))
    }
    git(pasta, 'add', '.')
    const resultados = verificarEmTodosOsModos(pasta, base)
    for (const [modo, resultado] of Object.entries(resultados)) {
      assert.equal(resultado.status, 1, modo)
      for (const caminho of nomes) assert.ok(resultado.stderr.includes(`${caminho} [arquivo-sensivel]`), `${modo}: ${caminho}`)
    }
  })
})

test('texto com extensão de imagem é varrido; binário de verdade com a mesma extensão é pulado', () => {
  comRepositorio((pasta) => {
    const base = git(pasta, 'rev-parse', 'HEAD')
    const token = falso('ghp', '_', 'T'.repeat(36))
    escrever(pasta, 'src/texto.png', `linha\nconst t = '${token}'\n`)
    escrever(pasta, 'src/arquivo.zip', `const t = '${token}'\n`)
    writeFileSync(join(pasta, 'src', 'real.png'), Buffer.concat([Buffer.from([137, 80, 78, 71, 0, 0]), Buffer.from(`'${token}'\n`)]))
    git(pasta, 'add', '.')
    const resultados = verificarEmTodosOsModos(pasta, base)
    for (const [modo, resultado] of Object.entries(resultados)) {
      assert.equal(resultado.status, 1, modo)
      assert.match(resultado.stderr, /src\/texto\.png:2 \[segredo\]/, modo)
      assert.match(resultado.stderr, /src\/arquivo\.zip:1 \[segredo\]/, modo)
      assert.doesNotMatch(resultado.stderr, /real\.png/, modo)
      assert.ok(!resultado.stderr.includes(token))
    }
  })
})

test('byte nulo em arquivo que não é binário conhecido gera um achado por arquivo e barra em todos os modos', () => {
  comRepositorio((pasta) => {
    const base = git(pasta, 'rev-parse', 'HEAD')
    const token = falso('ghp', '_', 'N'.repeat(36))
    escrever(pasta, 'src/nulo.ts', `// antes\u0000depois\nexport const t = '${token}'\n`)
    escrever(pasta, 'src/tarde.ts', `${'x\n'.repeat(5000)}\u0000\nexport const t = '${token}'\n`)
    git(pasta, 'add', '.')
    const resultados = verificarEmTodosOsModos(pasta, base)
    for (const [modo, resultado] of Object.entries(resultados)) {
      assert.equal(resultado.status, 1, modo)
      assert.ok(resultado.stderr.includes('src/nulo.ts [byte-nulo-em-arquivo-de-texto]'), modo)
      assert.ok(resultado.stderr.includes('src/tarde.ts [byte-nulo-em-arquivo-de-texto]'), modo)
      assert.ok(!resultado.stderr.includes(token))
    }
  })
})

test('binário grande com extensão desconhecida gera exatamente um achado e a allowlist o excetua com uma entrada', () => {
  comRepositorio((pasta) => {
    const linha = Buffer.concat([Buffer.from([0, 1, 2, 3]), Buffer.from('abcdefghij\n')])
    writeFileSync(join(pasta, 'dados.parquet'), Buffer.concat(Array.from({ length: 200_000 }, () => linha)))
    git(pasta, 'add', '.')
    for (const modo of ['--arvore', '--staged']) {
      const resultado = verificar(pasta, [modo])
      assert.equal(resultado.status, 1, modo)
      assert.match(resultado.stderr, /1 problema\(s\)/, modo)
      assert.ok(resultado.stderr.includes('dados.parquet [byte-nulo-em-arquivo-de-texto]'))
    }
    escrever(pasta, '.githooks/seguranca-allowlist.txt', 'dados.parquet::byte-nulo-em-arquivo-de-texto::-::1\n')
    for (const modo of ['--arvore', '--staged']) assert.equal(verificar(pasta, [modo]).status, 0, modo)
  })
})
