#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { detectarSegredo, arquivoSensivel } from '../.claude/hooks/lib/politicas.mjs'

const AJUDA = `Uso: node scripts/seguranca-verificar.mjs <modo>

Modos (só leem o git; nada é gravado):
  --staged          alterações no índice (pre-commit)
  --push [remoto]   commits que seriam enviados, lidos de stdin no formato do pre-push
  --range A..B      diferença entre dois commits
  --arvore          árvore versionada inteira (CI)

Verifica segredo, arquivo sensível, padrão inseguro de código, workflow, Terraform,
dependência, migração imutável e migração destrutiva fora de db/corte-gate.txt.
No --push também roda typecheck, testes de unidade e npm audit.
Exceção consciente: uma linha "caminho::id" em .githooks/seguranca-allowlist.txt.`

const argumentos = process.argv.slice(2)
if (argumentos.includes('--help') || argumentos.includes('-h') || argumentos.length === 0) {
  console.log(AJUDA)
  process.exit(argumentos.length === 0 ? 2 : 0)
}

const ZEROS = /^0+$/
const TAMANHO_MAXIMO = 200_000
const ARQUIVO_DE_CODIGO = /\.(ts|tsx|js|mjs|cjs|sh|yml|yaml|tf)$/
const ARQUIVO_DE_TESTE = /(^|[/])tests[/]|\.test\.(?:ts|mjs)$/
const TIPO_HEURISTICO = 'atribuição de segredo'
const DESTRUTIVO = /\b(?:DROP\s+(?:TABLE|COLUMN|SCHEMA)|TRUNCATE)\b/i

const PADROES_DE_CODIGO = [
  { id: 'tls-desligado', padrao: /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0/, mensagem: 'Validação de certificado TLS desligada' },
  { id: 'html-injetado', padrao: new RegExp('dangerously' + 'SetInnerHTML'), mensagem: 'HTML injetado sem sanitização (XSS)' },
  { id: 'eval-dinamico', padrao: /\beval\s*\(|new\s+Function\s*\(/, mensagem: 'Execução dinâmica de código' },
  { id: 'sql-interpolado', padrao: /\.unsafe\s*\(\s*`[^`]*\$\{/, mensagem: 'SQL montado por interpolação (injeção)' },
  { id: 'shell-interpolado', padrao: /\bexec(?:Sync)?\s*\(\s*`[^`]*\$\{/, mensagem: 'Comando de shell montado por interpolação (injeção)' },
  { id: 'cors-aberto', padrao: /Access-Control-Allow-Origin['"]?\s*[:,]\s*['"]\*['"]/, mensagem: 'CORS aberto para qualquer origem' },
]

const PADROES_DE_WORKFLOW = [
  { id: 'workflow-pull-request-target', padrao: /\bpull_request_target\b/, mensagem: 'pull_request_target executa código de fork com segredos' },
  { id: 'workflow-permissao-total', padrao: /permissions:\s*write-all/, mensagem: 'Permissão write-all no workflow' },
  { id: 'workflow-acao-sem-sha', padrao: /^\s*-?\s*uses:\s*(?!\.[/]|docker:[/][/])[^\s@]+@(?![0-9a-f]{40}(?:\s|$))/, mensagem: 'Ação de terceiro sem fixar o commit (SHA de 40 caracteres)' },
  { id: 'workflow-baixa-e-executa', padrao: /\b(?:curl|wget)\b[^|\n]*\|\s*(?:sudo\s+)?(?:ba|z)?sh\b/, mensagem: 'Baixa e executa script no workflow' },
]

const PADROES_DE_TERRAFORM = [
  { id: 'terraform-aberto-ao-mundo', padrao: /["']0\.0\.0\.0[/]0["']/, mensagem: 'Faixa 0.0.0.0/0 aberta' },
  { id: 'terraform-publico', padrao: /\ball(?:Authenticated)?Users\b/, mensagem: 'Recurso público (allUsers)' },
  { id: 'terraform-papel-amplo', padrao: /["']roles[/](?:owner|editor)["']/, mensagem: 'Papel amplo demais (owner ou editor)' },
]

const PADROES_DE_PACOTE = [
  { id: 'pacote-script-de-instalacao', padrao: /"(?:preinstall|install|postinstall)"\s*:/, mensagem: 'Script de instalação no package.json' },
  { id: 'pacote-origem-nao-registrada', padrao: /"[^"]+"\s*:\s*"(?:git\+|github:|https?:|file:|latest$|\*$)/, mensagem: 'Dependência fora do registro ou sem versão fixa' },
]

function git(argumentosGit, opcoes = {}) {
  try {
    return execFileSync('git', argumentosGit, { cwd: raiz, encoding: 'utf8', maxBuffer: 50_000_000, stdio: ['ignore', 'pipe', 'ignore'], ...opcoes })
  } catch {
    return ''
  }
}

const raiz = git(['rev-parse', '--show-toplevel']).trim() || process.cwd()

function lerAllowlist() {
  const arquivo = join(raiz, '.githooks', 'seguranca-allowlist.txt')
  if (!existsSync(arquivo)) return new Set()
  const linhas = readFileSync(arquivo, 'utf8').split('\n').map((linha) => linha.trim())
  return new Set(linhas.filter((linha) => linha && !linha.startsWith('#')))
}

function portaoDeCorte() {
  const arquivo = join(raiz, 'db', 'corte-gate.txt')
  if (!existsSync(arquivo)) return new Set()
  const linhas = readFileSync(arquivo, 'utf8').split('\n').map((linha) => linha.trim())
  return new Set(linhas.filter((linha) => linha && !linha.startsWith('#')))
}

function linhasAdicionadas(textoDoDiff) {
  const resultado = []
  let arquivo = ''
  let linhaNova = 0
  for (const linha of textoDoDiff.split('\n')) {
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
    resultado.push({ arquivo, linha: linhaNova, texto: linha.slice(1) })
  }
  return resultado
}

function alteracoesDoDiff(textoNomes) {
  return textoNomes.split('\n').filter(Boolean).map((linha) => {
    const [status, ...resto] = linha.split('\t')
    return { status: status[0], arquivo: resto[resto.length - 1] }
  })
}

function contextoDoIndice() {
  const diff = (extra) => git(['diff', '--cached', '--no-color', '--no-renames', ...extra])
  return {
    alteracoes: alteracoesDoDiff(diff(['--name-status'])),
    adicionadas: linhasAdicionadas(diff(['-U0'])),
    conteudo: (arquivo) => git(['show', `:${arquivo}`]),
  }
}

function contextoDoIntervalo(inicio, fim) {
  const diff = (extra) => git(['diff', `${inicio}..${fim}`, '--no-color', '--no-renames', ...extra])
  return {
    alteracoes: alteracoesDoDiff(diff(['--name-status'])),
    adicionadas: linhasAdicionadas(diff(['-U0'])),
    conteudo: (arquivo) => git(['show', `${fim}:${arquivo}`]),
  }
}

function contextoDaArvore() {
  const arquivos = git(['ls-files']).split('\n').filter(Boolean)
  const adicionadas = []
  for (const arquivo of arquivos) {
    const completo = join(raiz, arquivo)
    try {
      if (statSync(completo).size > TAMANHO_MAXIMO) continue
      readFileSync(completo, 'utf8').split('\n').forEach((texto, indice) => adicionadas.push({ arquivo, linha: indice + 1, texto }))
    } catch {
      continue
    }
  }
  return { alteracoes: arquivos.map((arquivo) => ({ status: 'A', arquivo })), adicionadas, conteudo: () => '', arvore: true }
}

function verificarContexto(contexto) {
  const achados = []
  const achar = (arquivo, linha, id, mensagem) => achados.push({ arquivo, linha, id, mensagem })
  const aplicar = (lista, linha) => {
    for (const regra of lista) if (regra.padrao.test(linha.texto)) achar(linha.arquivo, linha.linha, regra.id, regra.mensagem)
  }

  for (const { status, arquivo } of contexto.alteracoes) {
    if (status !== 'D' && arquivoSensivel(arquivo)) achar(arquivo, 0, 'arquivo-sensivel', 'Arquivo de segredo versionado')
  }

  for (const linha of contexto.adicionadas) {
    const ehTeste = ARQUIVO_DE_TESTE.test(linha.arquivo)
    for (const tipo of detectarSegredo(linha.texto)) {
      if (ehTeste && tipo === TIPO_HEURISTICO) continue
      achar(linha.arquivo, linha.linha, 'segredo', `Possível segredo (${tipo}); o valor não é exibido`)
    }
    if (ARQUIVO_DE_CODIGO.test(linha.arquivo) && !ehTeste) aplicar(PADROES_DE_CODIGO, linha)
    if (linha.arquivo.startsWith('.github/workflows/')) aplicar(PADROES_DE_WORKFLOW, linha)
    if (/^infra[/].*\.tf$/.test(linha.arquivo)) aplicar(PADROES_DE_TERRAFORM, linha)
    if (linha.arquivo === 'package.json') aplicar(PADROES_DE_PACOTE, linha)
  }

  if (!contexto.arvore) {
    const portao = portaoDeCorte()
    for (const { status, arquivo } of contexto.alteracoes) {
      if (!/^db[/]migrations[/][^/]+\.sql$/.test(arquivo)) continue
      if (status !== 'A') {
        achar(arquivo, 0, 'migracao-imutavel', 'Migração versionada é imutável (alterada, removida ou renomeada)')
        continue
      }
      if (DESTRUTIVO.test(contexto.conteudo(arquivo)) && !portao.has(basename(arquivo))) {
        achar(arquivo, 0, 'migracao-destrutiva-fora-do-portao', 'Migração destrutiva precisa constar em db/corte-gate.txt (ADR 0034)')
      }
    }
  }
  return achados
}

function aplicarAllowlist(achados) {
  const permitidos = lerAllowlist()
  return achados.filter((achado) => !permitidos.has(`${achado.arquivo}::${achado.id}`))
}

function relatar(achados) {
  console.error(`verificação de segurança: ${achados.length} problema(s)`)
  for (const achado of achados.slice(0, 40)) {
    const onde = achado.linha > 0 ? `${achado.arquivo}:${achado.linha}` : achado.arquivo
    console.error(`- ${onde} [${achado.id}] ${achado.mensagem}`)
  }
  if (achados.length > 40) console.error(`- e mais ${achados.length - 40}`)
  console.error('Corrija. Exceção consciente: linha "caminho::id" em .githooks/seguranca-allowlist.txt (revisada no PR).')
}

function lerRefsDoPush() {
  const bruto = readFileSync(0, 'utf8')
  return bruto.split('\n').filter(Boolean).map((linha) => {
    const [refLocal, shaLocal, refRemota, shaRemota] = linha.split(' ')
    return { refLocal, shaLocal, refRemota, shaRemota }
  })
}

function baseDeBranchNovo(shaLocal, remoto) {
  for (const candidato of [`refs/remotes/${remoto}/dev`, `refs/remotes/${remoto}/main`]) {
    const base = git(['merge-base', shaLocal, candidato]).trim()
    if (base) return base
  }
  return git(['hash-object', '-t', 'tree', '/dev/null']).trim()
}

function verificarRefsDoPush(remoto) {
  const bloqueios = []
  const intervalos = []
  for (const { refRemota, shaLocal, shaRemota } of lerRefsDoPush()) {
    const apagando = ZEROS.test(shaLocal)
    if (refRemota === 'refs/heads/main' && process.env.RELEASE_PUSH_MAIN_AUTORIZADO !== '1') {
      bloqueios.push({ arquivo: refRemota, linha: 0, id: 'push-em-main', mensagem: 'Push em main só pelo fluxo de release (docs/release/), executado pelo humano com RELEASE_PUSH_MAIN_AUTORIZADO=1' })
      continue
    }
    if (apagando) continue
    const novo = ZEROS.test(shaRemota)
    const remotoConhecido = !novo && spawnSync('git', ['cat-file', '-e', shaRemota], { cwd: raiz }).status === 0
    if (remotoConhecido) {
      const ancestral = spawnSync('git', ['merge-base', '--is-ancestor', shaRemota, shaLocal], { cwd: raiz })
      if (ancestral.status === 1) {
        bloqueios.push({ arquivo: refRemota, linha: 0, id: 'push-forcado', mensagem: 'Push que reescreve histórico remoto (não é fast-forward)' })
        continue
      }
    }
    intervalos.push([remotoConhecido ? shaRemota : baseDeBranchNovo(shaLocal, remoto), shaLocal])
  }
  return { bloqueios, intervalos }
}

function executarEtapa(nome, comando, argumentosComando) {
  const inicio = Date.now()
  const resultado = spawnSync(comando, argumentosComando, { cwd: raiz, encoding: 'utf8', maxBuffer: 50_000_000 })
  const segundos = Math.round((Date.now() - inicio) / 1000)
  return { nome, resultado, segundos }
}

function verificacoesPesadas(arquivosAlterados) {
  const falhas = []
  const temProjeto = existsSync(join(raiz, 'package.json')) && existsSync(join(raiz, 'node_modules'))
  if (!temProjeto) return falhas
  const pacote = JSON.parse(readFileSync(join(raiz, 'package.json'), 'utf8'))
  const etapas = []
  if (pacote.scripts?.typecheck) etapas.push(['typecheck', 'npm', ['run', '--silent', 'typecheck']])
  if (pacote.scripts?.['test:unit']) etapas.push(['testes de unidade', 'npm', ['run', '--silent', 'test:unit']])
  if (arquivosAlterados.some((arquivo) => /^(\.claude[/]|CLAUDE\.md$|orca\.yaml$|scripts[/]start\.sh$|\.githooks[/])/.test(arquivo)) && pacote.scripts?.['ambiente:verificar']) {
    etapas.push(['ambiente de agentes', 'node', ['scripts/ambiente-verificar.mjs', '--rapido']])
  }
  for (const [nome, comando, argumentosComando] of etapas) {
    const { resultado, segundos } = executarEtapa(nome, comando, argumentosComando)
    console.error(`${resultado.status === 0 ? 'ok' : 'FALHOU'}: ${nome} (${segundos}s)`)
    if (resultado.status !== 0) falhas.push({ arquivo: nome, linha: 0, id: 'etapa-falhou', mensagem: `${nome} falhou:\n${String(resultado.stdout + resultado.stderr).split('\n').slice(-25).join('\n')}` })
  }
  const auditoria = executarEtapa('npm audit', 'npm', ['audit', '--audit-level=high'])
  const saidaAuditoria = String(auditoria.resultado.stdout) + String(auditoria.resultado.stderr)
  if (auditoria.resultado.status !== 0 && /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|network|offline/i.test(saidaAuditoria)) {
    console.error('aviso: npm audit sem rede; o CI repete a auditoria')
  } else if (auditoria.resultado.status !== 0) {
    falhas.push({ arquivo: 'npm audit', linha: 0, id: 'dependencia-vulneravel', mensagem: `Vulnerabilidade alta ou crítica:\n${saidaAuditoria.split('\n').slice(-20).join('\n')}` })
  } else {
    console.error(`ok: npm audit (${auditoria.segundos}s)`)
  }
  return falhas
}

function executarModo() {
  if (argumentos.includes('--staged')) return aplicarAllowlist(verificarContexto(contextoDoIndice()))
  if (argumentos.includes('--arvore')) return aplicarAllowlist(verificarContexto(contextoDaArvore()))
  const intervalo = argumentos.indexOf('--range')
  if (intervalo >= 0) {
    const [inicio, fim] = String(argumentos[intervalo + 1] ?? '').split('..')
    if (!inicio || !fim) {
      console.error('--range exige A..B')
      process.exit(2)
    }
    return aplicarAllowlist(verificarContexto(contextoDoIntervalo(inicio, fim)))
  }
  const indicePush = argumentos.indexOf('--push')
  if (indicePush >= 0) {
    const remoto = argumentos[indicePush + 1] && !argumentos[indicePush + 1].startsWith('--') ? argumentos[indicePush + 1] : 'origin'
    const { bloqueios, intervalos } = verificarRefsDoPush(remoto)
    const achados = [...bloqueios]
    const arquivosAlterados = new Set()
    for (const [inicio, fim] of intervalos) {
      const contexto = contextoDoIntervalo(inicio, fim)
      contexto.alteracoes.forEach(({ arquivo }) => arquivosAlterados.add(arquivo))
      achados.push(...verificarContexto(contexto))
    }
    const filtrados = aplicarAllowlist(achados)
    if (filtrados.length === 0 && intervalos.length > 0) filtrados.push(...verificacoesPesadas([...arquivosAlterados]))
    return filtrados
  }
  console.error(AJUDA)
  process.exit(2)
}

const achados = executarModo()
if (achados.length > 0) {
  relatar(achados)
  process.exit(1)
}
console.log('verificação de segurança ok')
