import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync, execFileSync } from 'node:child_process'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, existsSync, realpathSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  avaliarComando,
  avaliarEscrita,
  avaliarMergeEmDev,
  consultarPRNoGitHub,
  TIMEOUT_GH_MS,
  CHECKS_OBRIGATORIOS,
  REPOSITORIO_PR,
} from '../.claude/hooks/lib/politicas.mjs'
import { executarGuarda, lerEvento } from '../.claude/hooks/lib/guarda.mjs'

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MARCADOR = 'AUTORIZO_MERGE_EM_DEV'
const REPO = 'github.com/agencia24por7/platform'
const SHA = '0123456789abcdef0123456789abcdef01234567'
const falso = (...partes) => partes.join('')
const arq = (path, changeType = 'MODIFIED') => ({ path, changeType })

const comando = (numero = 3, forma = 'merge', sha = SHA) => `${MARCADOR}=${numero} gh pr merge ${numero} --repo ${REPO} --${forma} --match-head-commit ${sha}`

const execucao = (workflowName, name, conclusion = 'SUCCESS', startedAt = '2026-11-22T10:00:00Z', status = 'COMPLETED', run = 100) => ({
  __typename: 'CheckRun',
  workflowName,
  name,
  status,
  conclusion,
  startedAt,
  detailsUrl: `https://${REPO}/actions/runs/${run}/job/1`,
})

const ciVerde = () => [
  execucao('ci', 'qualidade'),
  execucao('ci', 'integracao'),
  execucao('infra', 'plan', 'SKIPPED', undefined, undefined, 200),
  execucao('outro', 'aviso', 'NEUTRAL', undefined, undefined, 300),
]

function pr(numero = 3, sobrescritas = {}) {
  return {
    baseRefName: 'dev',
    state: 'OPEN',
    isDraft: false,
    isCrossRepository: false,
    reviewDecision: '',
    mergeable: 'MERGEABLE',
    headRefOid: SHA,
    url: `https://${REPO}/pull/${numero}`,
    files: [arq('src/a.ts'), arq('docs/b.md')],
    changedFiles: 2,
    statusCheckRollup: ciVerde(),
    ...sobrescritas,
  }
}

const resolvedor = (dados) => () => dados
const resolvedorProibido = () => {
  throw new Error('o GitHub não deveria ser consultado')
}

function avaliar(sobrescritas = {}, { numero = 3, forma = 'merge', sha = SHA, modo = 'auto' } = {}) {
  return avaliarMergeEmDev(comando(numero, forma, sha), resolvedor(pr(numero, sobrescritas)), modo)
}

test('permite as três formas de merge, com repo e sha, quando tudo confere e não há confirmação humana', () => {
  for (const forma of ['merge', 'squash', 'rebase']) {
    for (const modo of ['auto', 'bypassPermissions']) {
      const consultados = []
      const resultado = avaliarMergeEmDev(comando(42, forma), (numero) => {
        consultados.push(numero)
        return pr(42)
      }, modo)
      assert.equal(resultado.decisao, 'allow', `${forma} ${modo}`)
      assert.ok(resultado.motivo.length > 0)
      assert.deepEqual(consultados, ['42'])
    }
  }
  assert.equal(REPOSITORIO_PR, REPO)
})

test('em modo com confirmação humana a verificação verde vira ask, nunca allow', () => {
  for (const modo of ['default', 'plan', 'acceptEdits', undefined]) {
    const resultado = avaliarComando(comando(7, 'squash'), modo, resolvedor(pr(7)))
    assert.equal(resultado?.decisao, 'ask', String(modo))
    assert.match(resultado.motivo, /verificad|confere|CI/i)
  }
})

test('verificação que falha continua deny em qualquer modo', () => {
  for (const modo of ['default', 'plan', 'auto', 'bypassPermissions', undefined]) {
    const resultado = avaliarComando(comando(7), modo, resolvedor(pr(7, { baseRefName: 'main' })))
    assert.equal(resultado?.decisao, 'deny', String(modo))
  }
})

test('sem o marcador o comportamento antigo é preservado', () => {
  assert.equal(avaliarMergeEmDev('gh pr merge 42 --merge', resolvedorProibido, 'auto'), null)
  assert.equal(avaliarComando('gh pr merge 42 --merge', 'default', resolvedorProibido)?.decisao, 'ask')
  assert.equal(avaliarComando('gh pr merge 42 --merge', 'auto', resolvedorProibido)?.decisao, 'deny')
  assert.equal(avaliarComando('gh pr merge 42 --merge', 'bypassPermissions', resolvedorProibido)?.decisao, 'deny')
})

test('nega quando o número do marcador difere do número do merge', () => {
  const diferente = `${MARCADOR}=1 gh pr merge 2 --repo ${REPO} --merge --match-head-commit ${SHA}`
  assert.equal(avaliarMergeEmDev(diferente, resolvedorProibido, 'auto').decisao, 'deny')
})

test('nega base main com o motivo do ADR 0034 e qualquer outra base', () => {
  const main = avaliar({ baseRefName: 'main' })
  assert.equal(main.decisao, 'deny')
  assert.match(main.motivo, /merge em main é do humano \(ADR 0034\)/)
  for (const base of ['release', 'feature/x', 'DEV', '', null, undefined]) {
    assert.equal(avaliar({ baseRefName: base }).decisao, 'deny', String(base))
  }
})

test('nega PR fechado, mesclado ou rascunho', () => {
  for (const state of ['CLOSED', 'MERGED', 'open', undefined]) assert.equal(avaliar({ state }).decisao, 'deny', String(state))
  for (const isDraft of [true, undefined, null, 'false']) assert.equal(avaliar({ isDraft }).decisao, 'deny', String(isDraft))
})

test('nega PR de fork, com mudanças pedidas ou com conflito', () => {
  for (const isCrossRepository of [true, undefined, null, 'false']) assert.equal(avaliar({ isCrossRepository }).decisao, 'deny', String(isCrossRepository))
  assert.equal(avaliar({ reviewDecision: 'CHANGES_REQUESTED' }).decisao, 'deny')
  assert.equal(avaliar({ mergeable: 'CONFLICTING' }).decisao, 'deny')
  assert.equal(avaliar({ reviewDecision: 'APPROVED', mergeable: 'MERGEABLE' }).decisao, 'allow')
  assert.equal(avaliar({ reviewDecision: 'REVIEW_REQUIRED', mergeable: 'UNKNOWN' }).decisao, 'allow')
})

test('nega quando a URL não é a do repositório da plataforma com o mesmo número', () => {
  for (const url of ['https://github.com/outro/repo/pull/3', `https://${REPO}/pull/4`, `https://${REPO}/pull/3/files`, '', null, undefined]) {
    assert.equal(avaliar({ url }).decisao, 'deny', String(url))
  }
})

test('nega quando o head do PR difere do sha do comando', () => {
  assert.equal(avaliar({ headRefOid: 'f'.repeat(40) }).decisao, 'deny')
  for (const headRefOid of ['', null, undefined, SHA.toUpperCase()]) assert.equal(avaliar({ headRefOid }).decisao, 'deny', String(headRefOid))
})

test('allowlist: o PR só é elegível se todo arquivo está nas pastas de aplicação', () => {
  const permitidos = ['src/x.ts', 'app/x.tsx', 'db/migrations/0001_a.sql', 'docs/a.md', 'docs/adr/0050-x.md', 'tests/a.test.mjs', 'public/logo.svg', 'docs/.github/x.md', 'src/scripts/x.ts', './src/x.ts', 'SRC/X.ts', 'src//x.ts', 'src/../app/x.tsx']
  for (const path of permitidos) assert.equal(avaliar({ files: [arq(path)], changedFiles: 1 }).decisao, 'allow', path)
  const todos = permitidos.slice(0, 7).map((path) => arq(path))
  assert.equal(avaliar({ files: todos, changedFiles: todos.length }).decisao, 'allow')
})

test('allowlist: qualquer arquivo fora das pastas de aplicação é do humano', () => {
  const fora = [
    'next.config.js',
    'next.config.ts',
    'next.config.mjs',
    'CLAUDE.md',
    'AGENTS.md',
    'orca.yaml',
    '.mcp.json',
    'tsconfig.json',
    'tsconfig.build.json',
    'package.json',
    'package-lock.json',
    'Dockerfile',
    'Dockerfile.prod',
    '.env.example',
    '.gitignore',
    '.dockerignore',
    '.npmrc',
    '.nvmrc',
    'CODEOWNERS',
    'docs/release/roteiro.md',
    'DOCS/RELEASE/roteiro.md',
    './docs/release/x.md',
    'docs/../docs/release/x.md',
    'db/corte-gate.txt',
    'db/outro/x.sql',
    'n8n/workflows/a.json',
    '../fora.txt',
    '/etc/x',
    '',
  ]
  for (const path of fora) {
    const resultado = avaliar({ files: [arq('src/a.ts'), arq(path)], changedFiles: 2 })
    assert.equal(resultado.decisao, 'deny', path)
    assert.match(resultado.motivo, /fora das pastas de aplicação é do humano/, path)
  }
})

test('allowlist: .github, .claude, .githooks, scripts e infra têm negação explícita com mensagem própria', () => {
  const protegidos = [
    '.github/workflows/ci.yml',
    '.github/CODEOWNERS',
    '.claude/hooks/lib/politicas.mjs',
    '.claude/settings.json',
    '.githooks/pre-commit',
    'scripts/ambiente-verificar.mjs',
    'infra/terraform/main.tf',
    './scripts/x.sh',
    './/.claude/x',
    '.GITHUB/workflows/ci.yml',
    '.CLAUDE/hooks/x',
    'SCRIPTS/x.sh',
    'a/../.github/workflows/ci.yml',
    '/scripts/x.sh',
    'scripts//x.sh',
    '.github\\workflows\\ci.yml',
  ]
  for (const path of protegidos) {
    const resultado = avaliar({ files: [arq('src/a.ts'), arq(path)], changedFiles: 2 })
    assert.equal(resultado.decisao, 'deny', path)
    assert.match(resultado.motivo, /muda o CI, a guarda, scripts ou infra é do humano/, path)
  }
})

test('renomeação, cópia e changeType ausente ou desconhecido são negados; adição, modificação e remoção passam', () => {
  for (const changeType of ['RENAMED', 'COPIED', 'renamed', undefined, null, '', 'DESCONHECIDO']) {
    const resultado = avaliar({ files: [{ path: 'src/a.ts', changeType }], changedFiles: 1 })
    assert.equal(resultado.decisao, 'deny', String(changeType))
    assert.match(resultado.motivo, /changeType|renomeia|copia/, String(changeType))
  }
  for (const changeType of ['ADDED', 'MODIFIED', 'DELETED', 'CHANGED']) {
    assert.equal(avaliar({ files: [arq('src/a.ts', changeType)], changedFiles: 1 }).decisao, 'allow', changeType)
  }
})

test('lista de arquivos truncada, ausente ou malformada é negada', () => {
  assert.equal(avaliar({ files: [arq('src/a.ts')], changedFiles: 150 }).decisao, 'deny')
  assert.equal(avaliar({ files: [arq('src/a.ts'), arq('src/b.ts')], changedFiles: 1 }).decisao, 'deny')
  for (const files of [undefined, null, 'a.ts', {}]) assert.equal(avaliar({ files }).decisao, 'deny', String(files))
  for (const changedFiles of [undefined, null, '2', NaN]) assert.equal(avaliar({ changedFiles }).decisao, 'deny', String(changedFiles))
  for (const item of [null, {}, { path: 5, changeType: 'MODIFIED' }, 'a.ts']) assert.equal(avaliar({ files: [item], changedFiles: 1 }).decisao, 'deny', JSON.stringify(item))
})

test('CI: rollup só com SKIPPED ou sem os checks obrigatórios é negado e o motivo diz qual falta', () => {
  const soSkipped = [execucao('ci', 'qualidade', 'SKIPPED'), execucao('ci', 'integracao', 'SKIPPED')]
  assert.equal(avaliar({ statusCheckRollup: soSkipped }).decisao, 'deny')
  for (const obrigatorio of CHECKS_OBRIGATORIOS) {
    const semEle = ciVerde().filter((item) => !(item.workflowName === obrigatorio.workflowName && item.name === obrigatorio.name))
    const resultado = avaliar({ statusCheckRollup: semEle })
    assert.equal(resultado.decisao, 'deny', obrigatorio.name)
    assert.ok(resultado.motivo.includes(obrigatorio.name), resultado.motivo)
  }
  const outroWorkflow = [execucao('infra', 'qualidade'), execucao('infra', 'integracao')]
  assert.equal(avaliar({ statusCheckRollup: outroWorkflow }).decisao, 'deny')
  assert.deepEqual(CHECKS_OBRIGATORIOS.map((item) => item.name).sort(), ['integracao', 'qualidade'])
})

test('CI: qualidade e integracao precisam vir da mesma execução do workflow', () => {
  const execucoesDiferentes = [execucao('ci', 'qualidade', 'SUCCESS', undefined, undefined, 100), execucao('ci', 'integracao', 'SUCCESS', undefined, undefined, 101)]
  assert.equal(avaliar({ statusCheckRollup: execucoesDiferentes }).decisao, 'deny')
  const semUrl = [{ ...execucao('ci', 'qualidade'), detailsUrl: undefined }, execucao('ci', 'integracao')]
  assert.equal(avaliar({ statusCheckRollup: semUrl }).decisao, 'deny')
  const urlSemRun = [{ ...execucao('ci', 'qualidade'), detailsUrl: 'https://exemplo.com/x' }, execucao('ci', 'integracao')]
  assert.equal(avaliar({ statusCheckRollup: urlSemRun }).decisao, 'deny')
})

test('CI: pendente, com falha, vazio ou malformado é negado', () => {
  const casos = {
    pendente: [...ciVerde(), execucao('x', 'y', '', undefined, 'IN_PROGRESS')],
    enfileirado: [...ciVerde(), execucao('x', 'y', '', undefined, 'QUEUED')],
    concluidoSemConclusao: [...ciVerde(), execucao('x', 'y', '')],
    falha: [...ciVerde(), execucao('x', 'y', 'FAILURE')],
    cancelado: [...ciVerde(), execucao('x', 'y', 'CANCELLED')],
    expirado: [...ciVerde(), execucao('x', 'y', 'TIMED_OUT')],
    acaoNecessaria: [...ciVerde(), execucao('x', 'y', 'ACTION_REQUIRED')],
    obrigatorioFalhou: [execucao('ci', 'qualidade', 'FAILURE'), execucao('ci', 'integracao')],
    obrigatorioNeutro: [execucao('ci', 'qualidade', 'NEUTRAL'), execucao('ci', 'integracao')],
    vazio: [],
    ausente: undefined,
    nulo: null,
    naoLista: 'SUCCESS',
    itemNulo: [...ciVerde(), null],
    minusculo: [execucao('ci', 'qualidade', 'success'), execucao('ci', 'integracao')],
  }
  for (const [nome, statusCheckRollup] of Object.entries(casos)) {
    assert.equal(avaliar({ statusCheckRollup }).decisao, 'deny', nome)
  }
})

test('CI: só a execução mais recente de cada check conta', () => {
  const falhouDepoisPassou = [
    execucao('ci', 'qualidade', 'FAILURE', '2026-11-22T09:00:00Z', undefined, 99),
    execucao('ci', 'qualidade', 'SUCCESS', '2026-11-22T10:00:00Z'),
    execucao('ci', 'integracao'),
  ]
  assert.equal(avaliar({ statusCheckRollup: falhouDepoisPassou }).decisao, 'allow')
  const ordemInvertida = [falhouDepoisPassou[1], falhouDepoisPassou[0], falhouDepoisPassou[2]]
  assert.equal(avaliar({ statusCheckRollup: ordemInvertida }).decisao, 'allow')
  const passouDepoisFalhou = [
    execucao('ci', 'qualidade', 'SUCCESS', '2026-11-22T09:00:00Z'),
    execucao('ci', 'qualidade', 'FAILURE', '2026-11-22T10:00:00Z'),
    execucao('ci', 'integracao'),
  ]
  assert.equal(avaliar({ statusCheckRollup: passouDepoisFalhou }).decisao, 'deny')
  const reexecucaoEmAndamento = [
    execucao('ci', 'qualidade', 'SUCCESS', '2026-11-22T09:00:00Z'),
    execucao('ci', 'qualidade', '', '2026-11-22T10:00:00Z', 'IN_PROGRESS'),
    execucao('ci', 'integracao'),
  ]
  assert.equal(avaliar({ statusCheckRollup: reexecucaoEmAndamento }).decisao, 'deny')
  const reexecucaoSemHora = [
    execucao('ci', 'qualidade', 'SUCCESS', '2026-11-22T09:00:00Z'),
    { ...execucao('ci', 'qualidade', '', undefined, 'QUEUED'), startedAt: undefined },
    execucao('ci', 'integracao'),
  ]
  assert.equal(avaliar({ statusCheckRollup: reexecucaoSemHora }).decisao, 'deny')
})

test('CI: StatusContext verde é aceito e qualquer outro estado nega', () => {
  const contexto = (state) => ({ __typename: 'StatusContext', context: 'ci/externo', state, startedAt: '2026-11-22T10:00:00Z' })
  assert.equal(avaliar({ statusCheckRollup: [...ciVerde(), contexto('SUCCESS')] }).decisao, 'allow')
  for (const state of ['FAILURE', 'ERROR', 'PENDING', 'EXPECTED', undefined]) {
    assert.equal(avaliar({ statusCheckRollup: [...ciVerde(), contexto(state)] }).decisao, 'deny', String(state))
  }
})

test('fecha por padrão quando o resolvedor falha ou devolve lixo', () => {
  const lancar = () => {
    throw new Error('gh falhou')
  }
  assert.equal(avaliarMergeEmDev(comando(), lancar, 'auto').decisao, 'deny')
  for (const lixo of [null, undefined, 'texto', 42, [], {}]) {
    assert.equal(avaliarMergeEmDev(comando(), resolvedor(lixo), 'auto').decisao, 'deny', JSON.stringify(lixo))
  }
})

test('exceção durante a verificação vira deny, não erro não capturado', () => {
  const armadilha = { toString() { throw new TypeError('boom') }, valueOf() { throw new TypeError('boom') } }
  const rollup = [{ ...execucao('ci', 'qualidade'), workflowName: armadilha }, execucao('ci', 'integracao')]
  assert.equal(avaliar({ statusCheckRollup: rollup }).decisao, 'deny')
  const arquivos = [{ path: armadilha, changeType: 'MODIFIED' }]
  assert.equal(avaliar({ files: arquivos, changedFiles: 1 }).decisao, 'deny')
  const raro = { get baseRefName() { throw new RangeError('boom') } }
  assert.equal(avaliarMergeEmDev(comando(), resolvedor(raro), 'auto').decisao, 'deny')
})

test('nega forma fora do exato, sem consultar o GitHub, em qualquer modo', () => {
  const inicio = `${MARCADOR}=5 gh pr merge 5`
  const exato = `${inicio} --repo ${REPO} --merge --match-head-commit ${SHA}`
  const negados = [
    `${inicio} --merge --match-head-commit ${SHA}`,
    `${inicio} --repo outro/repo --merge --match-head-commit ${SHA}`,
    `${inicio} --repo github.com/agencia24por7/outro --merge --match-head-commit ${SHA}`,
    `${inicio} --repo=${REPO} --merge --match-head-commit ${SHA}`,
    `${inicio} --repo https://${REPO} --merge --match-head-commit ${SHA}`,
    `${inicio} --repo ${REPO}x --merge --match-head-commit ${SHA}`,
    `${inicio} --repo ${REPO.replace('.', 'X')} --merge --match-head-commit ${SHA}`,
    `${inicio} --merge --repo ${REPO} --match-head-commit ${SHA}`,
    `${inicio} --repo ${REPO} --merge`,
    `${inicio} --repo ${REPO} --squash`,
    `${inicio} --repo ${REPO} --merge --match-head-commit`,
    `${inicio} --repo ${REPO} --merge --match-head-commit ${SHA.slice(0, 39)}`,
    `${inicio} --repo ${REPO} --merge --match-head-commit ${SHA}0`,
    `${inicio} --repo ${REPO} --merge --match-head-commit ${SHA.toUpperCase()}`,
    `${inicio} --repo ${REPO} --merge --match-head-commit ${'g'.repeat(40)}`,
    `${inicio} --repo ${REPO} --match-head-commit ${SHA} --merge`,
    `${exato} --admin`,
    `${inicio} --admin --repo ${REPO} --merge --match-head-commit ${SHA}`,
    `${exato} --auto`,
    `${exato} --delete-branch`,
    `${exato} --body x`,
    `${exato}; echo x`,
    `${exato} && echo oi`,
    `${exato} | tee saida`,
    `${exato} $(echo x)`,
    `${exato} \`echo x\``,
    `${exato} > saida`,
    `${exato}\ngh pr merge 6 --admin`,
    `${exato}\n`,
    `${exato}\r`,
    `${exato}\r\n`,
    `${exato} `,
    `${exato} `,
    `${exato}\t`,
    `${inicio} --repo ${REPO} --merge  --match-head-commit ${SHA}`,
    `${inicio}`,
    `${MARCADOR}=5 FOO=bar gh pr merge 5 --repo ${REPO} --merge --match-head-commit ${SHA}`,
    `${MARCADOR}=5 ${exato}`,
    `${MARCADOR}=5 gh pr merge outro --repo ${REPO} --merge --match-head-commit ${SHA}`,
    `${MARCADOR}=5 gh pr merge https://github.com/o/r/pull/5 --repo ${REPO} --merge --match-head-commit ${SHA}`,
    `${MARCADOR}=5 gh pr merge 5 --repo ${REPO} --MERGE --match-head-commit ${SHA}`,
    `${MARCADOR}=5  gh pr merge 5 --repo ${REPO} --merge --match-head-commit ${SHA}`,
    `${MARCADOR}=5\tgh pr merge 5 --repo ${REPO} --merge --match-head-commit ${SHA}`,
    `${MARCADOR}= gh pr merge 5 --repo ${REPO} --merge --match-head-commit ${SHA}`,
    `${MARCADOR}=05 gh pr merge 05 --repo ${REPO} --merge --match-head-commit ${SHA}`,
    `${MARCADOR}=0 gh pr merge 0 --repo ${REPO} --merge --match-head-commit ${SHA}`,
    `${MARCADOR}=12345678 gh pr merge 12345678 --repo ${REPO} --merge --match-head-commit ${SHA}`,
    `${MARCADOR}=99999999999999999999 gh pr merge 99999999999999999999 --repo ${REPO} --merge --match-head-commit ${SHA}`,
    `${MARCADOR}=-1 gh pr merge -1 --repo ${REPO} --merge --match-head-commit ${SHA}`,
    `${MARCADOR}=1e3 gh pr merge 1e3 --repo ${REPO} --merge --match-head-commit ${SHA}`,
    `${MARCADOR}=٣ gh pr merge ٣ --repo ${REPO} --merge --match-head-commit ${SHA}`,
    `${exato} ${'x'.repeat(10000)}`,
  ]
  for (const texto of negados) {
    for (const modo of ['default', 'auto']) {
      assert.equal(avaliarComando(texto, modo, resolvedorProibido)?.decisao, 'deny', JSON.stringify(texto))
    }
  }
})

test('aceita o maior número de 7 dígitos e rejeita zero à esquerda', () => {
  assert.equal(avaliar({}, { numero: 9999999 }).decisao, 'allow')
  assert.equal(avaliar({}, { numero: 1, forma: 'rebase' }).decisao, 'allow')
  assert.equal(avaliarMergeEmDev(`${MARCADOR}=01 gh pr merge 01 --repo ${REPO} --merge --match-head-commit ${SHA}`, resolvedorProibido, 'auto').decisao, 'deny')
})

test('o marcador só vale para gh pr merge: nenhum outro comando é afrouxado', () => {
  const lerSegredo = falso('cat ', '.', 'env')
  const comandos = [
    'gh workflow run deploy.yml',
    'gh workflow run deploy.yml -f autorizar_corte=true',
    'gh api -X PUT repos/o/r/pulls/1/merge',
    'gh api repos/o/r/pulls/1/merge',
    'gh release create v1',
    'gh run rerun 1',
    'git push origin main',
    'git push origin HEAD:main',
    'terraform apply',
    'terraform destroy',
    'bq rm -f -t tria_dw.x',
    'gcloud secrets versions add x --data-file=-',
    'gcloud secrets versions access latest --secret=x',
    lerSegredo,
    'git commit --no-verify -m x',
    'git push --force origin feature',
    'gh pr edit 1 --base main',
  ]
  for (const semMarcador of comandos) {
    for (const modo of ['default', 'auto', 'bypassPermissions']) {
      const obtido = avaliarComando(`${MARCADOR}=1 ${semMarcador}`, modo, resolvedorProibido)
      assert.equal(obtido?.decisao, 'deny', `${semMarcador} (${modo})`)
    }
  }
})

test('marcador fora do início, em maiúsculas diferentes ou com espaços não vira exceção', () => {
  const exato = `gh pr merge 5 --repo ${REPO} --merge --match-head-commit ${SHA}`
  const comandos = [
    `echo oi; ${MARCADOR}=5 ${exato}`,
    `${exato} ${MARCADOR}=5`,
    `export ${MARCADOR}=5; ${exato}`,
    `${MARCADOR.toLowerCase()}=5 ${exato}`,
    ` ${MARCADOR}=5 ${exato}`,
    `\n${MARCADOR}=5 ${exato}`,
    `${MARCADOR} =5 ${exato}`,
    `X${MARCADOR}=5 ${exato}`,
  ]
  for (const texto of comandos) {
    assert.equal(avaliarComando(texto, 'auto', resolvedorProibido)?.decisao, 'deny', JSON.stringify(texto))
    assert.equal(avaliarMergeEmDev(texto, resolvedorProibido, 'auto'), null, JSON.stringify(texto))
  }
})

test('gh pr edit que troca a base é ask em modo com confirmação e deny sem confirmação', () => {
  const trocas = [
    'gh pr edit 5 --base main',
    'gh pr edit 5 --base=main',
    'gh pr edit --base release 5',
    'gh pr edit 5 -B main',
    'gh pr edit 5 -Bmain',
    'gh pr edit 5 --title x --base main',
    'gh pr edit 5 --title "a|b" --base main',
    'gh pr edit 5 --title "a;b" -Bmain',
  ]
  for (const texto of trocas) {
    assert.equal(avaliarComando(texto, 'default', resolvedorProibido)?.decisao, 'ask', texto)
    assert.equal(avaliarComando(texto, 'auto', resolvedorProibido)?.decisao, 'deny', texto)
  }
  assert.equal(avaliarComando('gh pr edit 5 --title novo', 'auto', resolvedorProibido), null)
})

test('o timeout do gh cabe na metade do timeout do hook em settings.json', () => {
  const configuracao = JSON.parse(readFileSync(join(raiz, '.claude', 'settings.json'), 'utf8'))
  const comandosDoHook = Object.values(configuracao.hooks ?? {}).flat().flatMap((grupo) => grupo.hooks ?? [])
  const guarda = comandosDoHook.find((item) => String(item.command).includes('guarda-pre-uso.mjs'))
  assert.ok(guarda, 'hook guarda-pre-uso.mjs não encontrado em settings.json')
  assert.ok(Number.isFinite(guarda.timeout), 'o hook precisa declarar timeout')
  assert.ok(TIMEOUT_GH_MS <= (guarda.timeout * 1000) / 2, `timeout do gh (${TIMEOUT_GH_MS} ms) maior que a metade do hook (${guarda.timeout} s)`)
})

const envDoGhEm = (base) => ({
  PATH: '/usr/bin:/bin',
  HOME: base,
  GH_CONFIG_DIR: `${base}/config`,
  XDG_STATE_HOME: `${base}/state`,
  XDG_CACHE_HOME: `${base}/cache`,
  XDG_CONFIG_HOME: `${base}/xdg-config`,
  GH_NO_UPDATE_NOTIFIER: '1',
  GH_PROMPT_DISABLED: '1',
  NO_COLOR: '1',
})

function ambienteDoGh(extra = {}) {
  const criados = []
  const removidos = []
  return {
    criados,
    removidos,
    criarDiretorio: () => {
      criados.push('/tmp/gh-guarda-x')
      return '/tmp/gh-guarda-x'
    },
    removerDiretorio: (caminho) => removidos.push(caminho),
    ...extra,
  }
}

test('consultarPRNoGitHub fixa o repositório, usa caminho absoluto, config vazia, ambiente mínimo e limites', () => {
  const chamadas = []
  const executar = (programa, argumentos, opcoes) => {
    chamadas.push({ programa, argumentos, opcoes })
    return JSON.stringify(pr(9))
  }
  const diretorios = ambienteDoGh()
  const ambiente = {
    PATH: '/tmp/gravavel',
    HOME: '/home/u',
    LANG: 'pt_BR.UTF-8',
    GH_REPO: 'outro/repo',
    GH_HOST: 'ghe.exemplo',
    GH_TOKEN: 'x',
    GITHUB_TOKEN: 'y',
    GH_CONFIG_DIR: '/tmp/cfg',
    SSL_CERT_FILE: '/tmp/ca',
    HTTPS_PROXY: 'http://p',
    HTTP_PROXY: 'http://p',
    NODE_OPTIONS: '--require /tmp/x.js',
    CLAUDE_PROJECT_DIR: '/projeto',
  }
  const existe = (caminho) => caminho === '/usr/local/bin/gh' || caminho === '/usr/bin/gh'
  const dados = consultarPRNoGitHub('9', { existe, executar, ambiente, ...diretorios })
  assert.equal(dados.baseRefName, 'dev')
  assert.equal(chamadas.length, 1)
  const [{ programa, argumentos, opcoes }] = chamadas
  assert.equal(programa, '/usr/local/bin/gh')
  assert.deepEqual(argumentos.slice(0, 6), ['pr', 'view', '9', '--repo', REPO, '--json'])
  for (const campo of ['baseRefName', 'state', 'isDraft', 'statusCheckRollup', 'headRefOid', 'url', 'isCrossRepository', 'reviewDecision', 'mergeable', 'files', 'changedFiles']) {
    assert.ok(argumentos[6].split(',').includes(campo), campo)
  }
  assert.equal(opcoes.timeout, TIMEOUT_GH_MS)
  assert.equal(opcoes.maxBuffer, 1024 * 1024)
  assert.equal(opcoes.cwd, '/projeto')
  assert.equal(opcoes.encoding, 'utf8')
  assert.equal(opcoes.shell, undefined)
  assert.deepEqual(opcoes.stdio, ['ignore', 'pipe', 'ignore'])
  assert.deepEqual(opcoes.env, { ...envDoGhEm('/tmp/gh-guarda-x'), LANG: 'pt_BR.UTF-8', GH_TOKEN: 'x', GITHUB_TOKEN: 'y' })
  assert.notEqual(opcoes.env.HOME, '/home/u')
  assert.deepEqual(diretorios.criados, ['/tmp/gh-guarda-x'])
  assert.deepEqual(diretorios.removidos, ['/tmp/gh-guarda-x'])
  const soGithubToken = []
  consultarPRNoGitHub('9', { existe, executar: (p, a, o) => (soGithubToken.push(o.env), JSON.stringify(pr(9))), ambiente: { HOME: '/home/u', GITHUB_TOKEN: 'z' }, ...ambienteDoGh() })
  assert.deepEqual(soGithubToken[0], { ...envDoGhEm('/tmp/gh-guarda-x'), GITHUB_TOKEN: 'z' })
})

test('o gh nunca escreve no diretório de trabalho: HOME e XDG apontam para o temporário, removido no fim', () => {
  const pasta = mkdtempSync(join(tmpdir(), 'gh-cwd-'))
  const trabalho = join(pasta, 'trabalho')
  mkdirSync(trabalho)
  const falsoGh = join(pasta, 'gh-falso.sh')
  writeFileSync(falsoGh, `#!/bin/sh\nmkdir -p "$HOME/.local/state/gh" "$XDG_STATE_HOME/gh" "$XDG_CACHE_HOME/gh" "$GH_CONFIG_DIR"\necho x > "$HOME/.local/state/gh/state.yml"\necho x > "$XDG_STATE_HOME/gh/state.yml"\necho '${JSON.stringify(pr(9))}'\n`)
  chmodSync(falsoGh, 0o755)
  const bases = []
  try {
    const executar = (programa, argumentos, opcoes) => {
      bases.push(opcoes.env.HOME)
      return execFileSync(falsoGh, argumentos, opcoes)
    }
    const dados = consultarPRNoGitHub('9', { existe: () => true, executar, ambiente: { GH_TOKEN: 'x', CLAUDE_PROJECT_DIR: trabalho } })
    assert.equal(dados.baseRefName, 'dev')
    assert.deepEqual(readdirSync(trabalho), [])
    assert.equal(bases.length, 1)
    assert.ok(bases[0].startsWith(tmpdir()) || bases[0].startsWith(realpathSync(tmpdir())), bases[0])
    assert.equal(existsSync(bases[0]), false)
  } finally {
    rmSync(pasta, { recursive: true, force: true })
  }
})

test('sem token no ambiente do hook a consulta nega com motivo claro, sem rodar o gh nem criar diretório', () => {
  const diretorios = ambienteDoGh()
  const ambiente = { HOME: '/home/u', GH_TOKEN: '', GITHUB_TOKEN: undefined }
  assert.throws(() => consultarPRNoGitHub('9', { existe: () => true, executar: resolvedorProibido, ambiente, ...diretorios }), /sem GH_TOKEN no ambiente do hook/)
  assert.deepEqual(diretorios.criados, [])
  const ausente = () => consultarPRNoGitHub('9', { existe: () => true, executar: resolvedorProibido, ambiente, ...diretorios })
  const resultado = avaliarMergeEmDev(comando(9), () => ausente(), 'auto')
  assert.equal(resultado.decisao, 'deny')
  assert.match(resultado.motivo, /exige token no ambiente do Claude Code/)
})

test('o diretório de configuração temporário é removido mesmo quando o gh falha', () => {
  const diretorios = ambienteDoGh()
  const executar = () => {
    throw new Error('timeout')
  }
  assert.throws(() => consultarPRNoGitHub('9', { existe: () => true, executar, ambiente: { GH_TOKEN: 'x' }, ...diretorios }), /timeout/)
  assert.deepEqual(diretorios.removidos, ['/tmp/gh-guarda-x'])
})

test('consultarPRNoGitHub tenta homebrew primeiro e nega quando nenhum gh absoluto existe', () => {
  const tentados = []
  const executar = (programa) => {
    tentados.push(programa)
    return JSON.stringify(pr(9))
  }
  consultarPRNoGitHub('9', { existe: () => true, executar, ambiente: { GH_TOKEN: 'x' }, ...ambienteDoGh() })
  assert.deepEqual(tentados, ['/opt/homebrew/bin/gh'])
  const ausente = () => consultarPRNoGitHub('9', { existe: () => false, executar: resolvedorProibido, ambiente: {} })
  assert.throws(ausente, /gh não encontrado/)
  const resultado = avaliarMergeEmDev(comando(9), () => ausente(), 'auto')
  assert.equal(resultado.decisao, 'deny')
  assert.match(resultado.motivo, /gh não encontrado/)
})

test('nenhum interruptor de ambiente altera a política do guarda', () => {
  const politicas = readFileSync(join(raiz, '.claude', 'hooks', 'lib', 'politicas.mjs'), 'utf8')
  const guarda = readFileSync(join(raiz, '.claude', 'hooks', 'lib', 'guarda.mjs'), 'utf8')
  const cli = readFileSync(join(raiz, '.claude', 'hooks', 'guarda-pre-uso.mjs'), 'utf8')
  for (const fonte of [politicas, guarda, cli]) assert.doesNotMatch(fonte, /ORLA_GUARDA/)
  assert.doesNotMatch(cli, /consultarPR/)
})

function rodarGuarda(evento, { consultarPR = resolvedorProibido, ambiente = {}, falharPrimeiraSaida = false } = {}) {
  const saidas = []
  const erros = []
  let falhou = !falharPrimeiraSaida
  const codigo = executarGuarda({
    evento,
    ambiente,
    consultarPR,
    saida: (texto) => {
      if (!falhou) {
        falhou = true
        throw new Error('falha de escrita')
      }
      saidas.push(texto)
    },
    erro: (texto) => erros.push(texto),
  })
  return { codigo, saidas, erros, resposta: saidas.length ? JSON.parse(saidas.join('')).hookSpecificOutput : null }
}

test('executarGuarda lê o evento de um stream e emite permissionDecision allow para o merge verificado', async () => {
  const bruto = JSON.stringify({ tool_name: 'Bash', tool_input: { command: comando(9) }, permission_mode: 'auto', cwd: raiz })
  const evento = await lerEvento(Readable.from([bruto.slice(0, 20), bruto.slice(20)]))
  const consultados = []
  const { codigo, resposta } = rodarGuarda(evento, { consultarPR: (numero) => (consultados.push(numero), pr(9)) })
  assert.equal(codigo, 0)
  assert.deepEqual(consultados, ['9'])
  assert.equal(resposta.hookEventName, 'PreToolUse')
  assert.equal(resposta.permissionDecision, 'allow')
  assert.match(resposta.permissionDecisionReason, /^\[guarda do projeto\]/)
})

test('executarGuarda: ask em modo default, deny para main e sem marcador, e entrada inválida não quebra', async () => {
  const bash = (texto, modo) => ({ tool_name: 'Bash', tool_input: { command: texto }, permission_mode: modo })
  assert.equal(rodarGuarda(bash(comando(9), 'default'), { consultarPR: resolvedor(pr(9)) }).resposta.permissionDecision, 'ask')
  const main = rodarGuarda(bash(comando(9), 'auto'), { consultarPR: resolvedor(pr(9, { baseRefName: 'main' })) })
  assert.equal(main.resposta.permissionDecision, 'deny')
  assert.match(main.resposta.permissionDecisionReason, /ADR 0034/)
  assert.equal(rodarGuarda(bash('gh pr merge 9 --merge', 'auto')).resposta.permissionDecision, 'deny')
  assert.deepEqual(await lerEvento(Readable.from(['não é json'])), {})
  assert.equal(rodarGuarda({}).codigo, 0)
})

test('executarGuarda: exceção inesperada em Bash com marcador vira deny; sem marcador sai com código 2', () => {
  const armadilha = { toString() { throw new TypeError('boom') } }
  const semMarcador = rodarGuarda({ tool_name: 'Bash', tool_input: { command: armadilha }, permission_mode: 'auto' })
  assert.equal(semMarcador.codigo, 2)
  assert.ok(semMarcador.erros.join('').length > 0)
  assert.equal(semMarcador.resposta, null)
  const comMarcador = rodarGuarda({ tool_name: 'Bash', tool_input: { command: comando(9) }, permission_mode: 'auto' }, { consultarPR: resolvedor(pr(9)), falharPrimeiraSaida: true })
  assert.equal(comMarcador.codigo, 0)
  assert.equal(comMarcador.resposta.permissionDecision, 'deny')
})

test('o hook real (CLI) nega sem consultar o GitHub: sem marcador, forma inválida e gh pr edit de base', () => {
  const rodar = (texto, modo = 'auto') => {
    const resultado = spawnSync('node', [join(raiz, '.claude', 'hooks', 'guarda-pre-uso.mjs')], {
      cwd: raiz,
      encoding: 'utf8',
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: texto }, permission_mode: modo, cwd: raiz }),
      env: { ...process.env, CLAUDE_PROJECT_DIR: raiz },
    })
    if (!resultado.stdout) assert.fail(`o hook não imprimiu nada (status ${resultado.status}): ${resultado.stderr}`)
    return JSON.parse(resultado.stdout).hookSpecificOutput
  }
  assert.equal(rodar('gh pr merge 9 --merge').permissionDecision, 'deny')
  assert.equal(rodar(`${MARCADOR}=9 gh pr merge 9 --merge`).permissionDecision, 'deny')
  assert.equal(rodar(`${MARCADOR}=9 gh pr merge 9 --admin --repo ${REPO} --merge --match-head-commit ${SHA}`, 'default').permissionDecision, 'deny')
  assert.equal(rodar('gh pr edit 9 -Bmain').permissionDecision, 'deny')
  assert.equal(rodar('gh pr edit 9 -Bmain', 'default').permissionDecision, 'ask')
})

test('gh alias e gh config set podem contornar a guarda: ask com confirmação, deny sem', () => {
  const comandos = ['gh alias set pe "pr edit"', 'gh alias import aliases.yml', 'gh alias delete pe', 'gh config set http_unix_socket /tmp/s', 'gh config set browser x']
  for (const texto of comandos) {
    assert.equal(avaliarComando(texto, 'default', resolvedorProibido)?.decisao, 'ask', texto)
    assert.equal(avaliarComando(texto, 'auto', resolvedorProibido)?.decisao, 'deny', texto)
    assert.equal(avaliarComando(`${MARCADOR}=1 ${texto}`, 'auto', resolvedorProibido)?.decisao, 'deny', texto)
  }
  for (const leitura of ['gh alias list', 'gh config get editor', 'gh config list']) assert.equal(avaliarComando(leitura, 'auto', resolvedorProibido), null, leitura)
})

test('avaliarEscrita nega a configuração do gh e os settings do Claude Code', () => {
  const negados = [
    '/Users/u/.config/gh/config.yml',
    '/Users/u/.config/gh/hosts.yml',
    '.config/gh/config.yml',
    '/Users/u/.claude/settings.json',
    '.claude/settings.json',
    '.claude/settings.local.json',
    '/repo/.claude/settings.local.json',
  ]
  for (const caminho of negados) {
    assert.equal(avaliarEscrita({ caminho, conteudo: '{}', existeVersionado: false, modoDePermissao: 'auto' })?.decisao, 'deny', caminho)
  }
  for (const caminho of ['/repo/src/config/gh.ts', '/repo/docs/ambiente/README.md', '/repo/.claude/rules/testes.md', '/repo/.claude/settings-notas.md']) {
    assert.equal(avaliarEscrita({ caminho, conteudo: 'x', existeVersionado: false }), null, caminho)
  }
})

test('avaliarEscrita ignora caixa e barras invertidas ao proteger a config do gh e os settings', () => {
  const variantes = [
    '/Users/u/.Config/GH/config.yml',
    '/Users/u/.CONFIG/gh/hosts.yml',
    '.config\\gh\\config.yml',
    'C:\\Users\\u\\.config\\gh\\hosts.yml',
    '.CLAUDE/Settings.json',
    '/repo/.Claude/SETTINGS.local.JSON',
    '.claude\\settings.json',
  ]
  for (const caminho of variantes) {
    assert.equal(avaliarEscrita({ caminho, conteudo: '{}', existeVersionado: false, modoDePermissao: 'auto' })?.decisao, 'deny', caminho)
  }
})

test('avaliarEscrita: o deny de conteúdo com aparência de segredo vale antes do ask da autoproteção', () => {
  const comSegredo = `const k = '${falso('AKI', 'A', 'ABCDEFGHIJKLMNOP')}'`
  for (const caminho of ['.githooks/pre-commit', '.claude/hooks/lib/x.mjs', '.claude/settings.json']) {
    for (const modoDePermissao of ['default', 'plan', 'acceptEdits', 'auto', 'bypassPermissions', undefined]) {
      assert.equal(avaliarEscrita({ caminho, conteudo: comSegredo, existeVersionado: false, modoDePermissao })?.decisao, 'deny', `${caminho} ${modoDePermissao}`)
    }
    assert.equal(avaliarEscrita({ caminho, conteudo: 'x', existeVersionado: false, modoDePermissao: 'default' })?.decisao, 'ask', caminho)
    assert.equal(avaliarEscrita({ caminho, conteudo: 'x', existeVersionado: false, modoDePermissao: 'auto' })?.decisao, 'deny', caminho)
  }
})

function rodarCli(entrada, { fechar = true, limiteMs = 20000 } = {}) {
  return new Promise((resolver) => {
    const inicio = Date.now()
    const filho = spawn('node', [join(raiz, '.claude', 'hooks', 'guarda-pre-uso.mjs')], { cwd: raiz })
    let stdout = ''
    let stderr = ''
    filho.stdout.on('data', (pedaco) => (stdout += pedaco))
    filho.stderr.on('data', (pedaco) => (stderr += pedaco))
    const limite = setTimeout(() => filho.kill('SIGKILL'), limiteMs)
    filho.on('close', (codigo) => {
      clearTimeout(limite)
      resolver({ codigo, stdout, stderr, duracao: Date.now() - inicio })
    })
    if (entrada !== undefined) filho.stdin.write(entrada)
    if (fechar) filho.stdin.end()
  })
}

test('o CLI fecha por padrão com stdin vazio, JSON inválido ou evento sem tool_name', async () => {
  for (const entrada of ['', 'não é json', '{}', '[]', 'null', JSON.stringify({ tool_input: { command: 'ls' } }), JSON.stringify({ tool_name: '' })]) {
    const resultado = await rodarCli(entrada)
    assert.equal(resultado.codigo, 2, JSON.stringify(entrada))
    assert.equal(resultado.stdout, '', JSON.stringify(entrada))
    assert.match(resultado.stderr, /guarda do projeto/, JSON.stringify(entrada))
  }
})

test('o CLI bloqueia por tempo esgotado antes do timeout do hook em settings.json', async () => {
  const resultado = await rodarCli(undefined, { fechar: false })
  assert.equal(resultado.codigo, 2)
  assert.match(resultado.stderr, /tempo/i)
  assert.ok(resultado.duracao >= 7000, `bloqueou cedo demais: ${resultado.duracao} ms`)
  assert.ok(resultado.duracao < 10000, `bloqueou depois do timeout do hook: ${resultado.duracao} ms`)
})

test('a mensagem de falha de carga ensina o humano a destravar', () => {
  const cli = readFileSync(join(raiz, '.claude', 'hooks', 'guarda-pre-uso.mjs'), 'utf8')
  const pasta = mkdtempSync(join(tmpdir(), 'guarda-falha-'))
  try {
    mkdirSync(join(pasta, 'lib'))
    writeFileSync(join(pasta, 'guarda-pre-uso.mjs'), cli)
    writeFileSync(join(pasta, 'lib', 'guarda.mjs'), 'export function ((\n')
    const resultado = spawnSync('node', [join(pasta, 'guarda-pre-uso.mjs')], { cwd: pasta, encoding: 'utf8', input: '{}' })
    assert.equal(resultado.status, 2)
    assert.match(resultado.stderr, /git checkout -- \.claude\/hooks/)
    assert.match(resultado.stderr, /\/hooks/)
  } finally {
    rmSync(pasta, { recursive: true, force: true })
  }
})

test('autoproteção: escrever na guarda e nos settings é ask com confirmação e deny sem confirmação; config do gh é deny sempre', () => {
  const protegidos = [
    '/repo/.claude/hooks/lib/politicas.mjs',
    '.claude/hooks/guarda-pre-uso.mjs',
    '/repo/.githooks/pre-commit',
    '.githooks/pre-push',
    '.claude/settings.json',
    '/repo/.claude/settings.local.json',
    '/Users/u/.claude/settings.json',
    '.CLAUDE/Hooks/x.mjs',
    '.GITHOOKS/pre-commit',
    '.claude\\hooks\\x.mjs',
    '.claude/Settings.JSON',
  ]
  for (const caminho of protegidos) {
    for (const modoDePermissao of ['default', 'plan', 'acceptEdits', undefined]) {
      assert.equal(avaliarEscrita({ caminho, conteudo: 'x', existeVersionado: true, modoDePermissao })?.decisao, 'ask', `${caminho} (${modoDePermissao})`)
    }
    for (const modoDePermissao of ['auto', 'bypassPermissions']) {
      assert.equal(avaliarEscrita({ caminho, conteudo: 'x', existeVersionado: true, modoDePermissao })?.decisao, 'deny', `${caminho} (${modoDePermissao})`)
    }
  }
  for (const modoDePermissao of ['default', 'auto', undefined]) {
    assert.equal(avaliarEscrita({ caminho: '/Users/u/.config/gh/config.yml', conteudo: 'x', existeVersionado: false, modoDePermissao })?.decisao, 'deny', String(modoDePermissao))
  }
  for (const caminho of ['/repo/.claude/rules/testes.md', '/repo/.claude/agents/arquiteto.md', '/repo/docs/ambiente/README.md', '/repo/.claude/settings-notas.md', '/repo/src/hooks/x.ts', '/repo/tests/ambiente-x.test.mjs']) {
    assert.equal(avaliarEscrita({ caminho, conteudo: 'x', existeVersionado: false, modoDePermissao: 'auto' }), null, caminho)
  }
})

test('autoproteção: o guarda emite ask ou deny para Write e Edit na própria guarda', () => {
  const alvo = join(raiz, '.claude', 'hooks', 'lib', 'politicas.mjs')
  const evento = (ferramenta, modo) => ({ tool_name: ferramenta, tool_input: { file_path: alvo, content: 'x', new_string: 'x', old_string: 'a' }, permission_mode: modo, cwd: raiz })
  for (const ferramenta of ['Write', 'Edit']) {
    assert.equal(rodarGuarda(evento(ferramenta, 'default')).resposta.permissionDecision, 'ask', ferramenta)
    assert.equal(rodarGuarda(evento(ferramenta, 'auto')).resposta.permissionDecision, 'deny', ferramenta)
    assert.equal(rodarGuarda(evento(ferramenta, 'bypassPermissions')).resposta.permissionDecision, 'deny', ferramenta)
  }
})

test('autoproteção no Bash: gravar com destino na guarda, nos settings ou na config do gh é ask, e deny sem confirmação', () => {
  const gravacoes = [
    'echo x > .claude/hooks/a.mjs',
    'echo x>>.githooks/pre-commit',
    'printf x > .claude/settings.json',
    'echo x > ~/.config/gh/config.yml',
    'echo x > "$HOME/.config/gh/hosts.yml"',
    'echo x 2> .claude/hooks/erro.log',
    'tee .claude/hooks/a.mjs',
    'echo a | tee -a .claude/settings.local.json',
    'cp /tmp/x .claude/hooks/a.mjs',
    'cp /tmp/x .claude/hooks/a.mjs 2>/dev/null',
    'cp -t .claude/hooks /tmp/x',
    'mv /tmp/x .githooks/pre-commit',
    'ln -s /tmp/x .claude/hooks/y',
    'install -m 755 x .claude/hooks/y',
    'dd if=/tmp/x of=.claude/hooks/a',
    "sed -i '' s/a/b/ .claude/hooks/x.mjs",
    'sed -i.bak s/a/b/ .githooks/pre-commit',
    'sed --in-place s/a/b/ .claude/settings.json',
    "perl -pi -e 's/a/b/' .claude/hooks/x.mjs",
    'rm .claude/hooks/x.mjs',
    'rm -rf .githooks',
    'truncate -s 0 .claude/settings.json',
    'cp x .CLAUDE/HOOKS/a.mjs',
    'cd /tmp && echo x > /repo/.claude/hooks/a.mjs',
  ]
  for (const texto of gravacoes) {
    assert.equal(avaliarComando(texto, 'default', resolvedorProibido)?.decisao, 'ask', texto)
    assert.equal(avaliarComando(texto, 'auto', resolvedorProibido)?.decisao, 'deny', texto)
    assert.equal(avaliarComando(texto, 'bypassPermissions', resolvedorProibido)?.decisao, 'deny', texto)
  }
})

test('autoproteção no Bash: leitura com esses caminhos como argumento continua permitida', () => {
  const leituras = [
    'node --test tests/ambiente-merge-em-dev.test.mjs',
    'sed -n 1,5p .claude/hooks/lib/politicas.mjs',
    'sed -n 1,5p .claude/settings.json',
    'git add .claude',
    'git add .claude/hooks/guarda-pre-uso.mjs',
    'git diff -- .claude/hooks',
    'rtk grep -n foo .claude/hooks',
    'cat .claude/hooks/guarda-pre-uso.mjs',
    'head -5 .githooks/pre-commit',
    'ls .claude/hooks 2>&1',
    'ls -la .claude/hooks > /tmp/lista.txt 2>&1',
    'cp .claude/hooks/guarda-pre-uso.mjs /tmp/copia.mjs',
    'cat .claude/hooks/x.mjs > /tmp/saida.txt',
    'diff .claude/hooks/a.mjs .claude/hooks/b.mjs',
    'grep foo .claude/settings.json 2>&1',
    'node .claude/hooks/guarda-pre-uso.mjs < /tmp/evento.json',
    'echo oi > /tmp/x',
    'sed -i s/a/b/ src/x.ts',
    'tee /tmp/log.txt',
    'ls .config/gh 2>&1',
    'gh config get editor',
  ]
  for (const texto of leituras) {
    assert.equal(avaliarComando(texto, 'auto', resolvedorProibido), null, texto)
  }
})

test('integração com o ADR 0047 de dev: main e KMS continuam ask, e o marcador nunca vale para main', () => {
  const kms = ['gcloud kms keys versions disable 1 --key=k --keyring=r --location=l', 'gcloud kms keys versions destroy 1 --key=k --keyring=r --location=l']
  for (const texto of kms) {
    assert.equal(avaliarComando(texto, 'default', resolvedorProibido)?.decisao, 'ask', texto)
    assert.equal(avaliarComando(texto, 'auto', resolvedorProibido)?.decisao, 'deny', texto)
    assert.equal(avaliarComando(`${MARCADOR}=1 ${texto}`, 'default', resolvedorProibido)?.decisao, 'deny', texto)
  }
  for (const modo of ['default', 'auto', 'bypassPermissions']) {
    const paraMain = avaliarComando(comando(9), modo, resolvedor(pr(9, { baseRefName: 'main' })))
    assert.equal(paraMain.decisao, 'deny', modo)
    assert.match(paraMain.motivo, /ADR 0034/)
  }
  const semMarcador = avaliarComando('gh pr merge 9 --merge', 'default', resolvedorProibido)
  assert.equal(semMarcador.decisao, 'ask')
  assert.match(semMarcador.motivo, /ADR 0047/)
  assert.equal(avaliarComando('gh pr merge 9 --merge', 'auto', resolvedorProibido).decisao, 'deny')
  assert.equal(avaliarComando(falso('git push origin ', 'main'), 'default', resolvedorProibido).decisao, 'deny')
})

test('o CLI do guarda fecha por padrão: se a guarda não carrega, sai com código 2 e não deixa nada passar', () => {
  const cli = readFileSync(join(raiz, '.claude', 'hooks', 'guarda-pre-uso.mjs'), 'utf8')
  const escreverGuarda = (pasta, conteudo) => writeFileSync(join(pasta, 'lib', 'guarda.mjs'), conteudo)
  const casos = {
    'erro de sintaxe': (pasta) => escreverGuarda(pasta, 'export function ((\n'),
    'marcador de conflito': (pasta) => escreverGuarda(pasta, `${'<'.repeat(7)} HEAD\nexport const a = 1\n${'='.repeat(7)}\nexport const a = 2\n${'>'.repeat(7)} dev\n`),
    'import quebrado': (pasta) => escreverGuarda(pasta, "import './nao-existe.mjs'\nexport const lerEvento = 1\n"),
    'módulo ausente': () => {},
  }
  for (const [nome, preparar] of Object.entries(casos)) {
    const pasta = mkdtempSync(join(tmpdir(), 'guarda-falha-'))
    try {
      mkdirSync(join(pasta, 'lib'))
      writeFileSync(join(pasta, 'guarda-pre-uso.mjs'), cli)
      preparar(pasta)
      const resultado = spawnSync('node', [join(pasta, 'guarda-pre-uso.mjs')], {
        cwd: pasta,
        encoding: 'utf8',
        input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' }, permission_mode: 'auto' }),
      })
      assert.equal(resultado.status, 2, `${nome}: ${resultado.stderr}`)
      assert.equal(resultado.stdout, '', nome)
      assert.match(resultado.stderr, /guarda do projeto/, nome)
    } finally {
      rmSync(pasta, { recursive: true, force: true })
    }
  }
})

test('o CLI com a guarda real carrega e decide (sanidade do import dinâmico)', () => {
  const resultado = spawnSync('node', [join(raiz, '.claude', 'hooks', 'guarda-pre-uso.mjs')], {
    cwd: raiz,
    encoding: 'utf8',
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'gh pr merge 9 --merge' }, permission_mode: 'auto' }),
  })
  assert.equal(resultado.status, 0)
  assert.equal(JSON.parse(resultado.stdout).hookSpecificOutput.permissionDecision, 'deny')
})
