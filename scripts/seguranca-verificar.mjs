#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { closeSync, existsSync, openSync, readFileSync, readSync } from 'node:fs'
import { basename, join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { arquivoSensivel } from '../.claude/hooks/lib/politicas.mjs'
import { linhasAdicionadas, alteracoesDoNameStatus } from '../.claude/hooks/lib/diff.mjs'
import { PADROES_DE_CODIGO, PADROES_DE_WORKFLOW, PADROES_DE_TERRAFORM, PADROES_DE_PACOTE, TIPOS_HEURISTICOS, SOBREPOSICAO_DE_FATIA, criarDetectorDeCredencialVizinha, fatiasDaLinha, tiposDeSegredo } from './seguranca-padroes.mjs'

const AJUDA = `Uso: node scripts/seguranca-verificar.mjs <modo>

Modos (só leem o git; nada é gravado):
  --staged          alterações no índice (pre-commit)
  --push [remoto]   commits que seriam enviados, lidos de stdin no formato do pre-push
  --range A..B      diferença entre dois commits (CI: base do PR ou "before" do push até HEAD)
  --arvore          árvore versionada inteira (CI); arquivo grande é varrido por blocos, binário é pulado
  --sugerir         com --arvore: imprime as entradas de allowlist para os achados atuais (sem valores)

Verifica segredo, arquivo sensível, padrão inseguro de código, workflow, Terraform,
dependência, migração imutável e migração destrutiva fora de db/corte-gate.txt.
No --push também roda typecheck, testes de unidade e npm audit.
Exceção consciente: uma linha "caminho::id::assinatura::contagem" em .githooks/seguranca-allowlist.txt
(formato no cabeçalho do arquivo; gere com --arvore --sugerir).`

const argumentos = process.argv.slice(2)
if (argumentos.includes('--help') || argumentos.includes('-h') || argumentos.length === 0) {
  console.log(AJUDA)
  process.exit(argumentos.length === 0 ? 2 : 0)
}

const ZEROS = /^0+$/
const TAMANHO_DO_BLOCO = 1 << 20
const EXTENSOES_BINARIAS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'bmp', 'tif', 'tiff', 'heic', 'psd', 'pdf', 'woff', 'woff2', 'ttf', 'otf', 'eot', 'zip', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'jar', 'war', 'wasm', 'mp3', 'mp4', 'm4a', 'mov', 'avi', 'webm', 'ogg', 'wav', 'flac', 'bin', 'exe', 'dll', 'so', 'dylib', 'node', 'class', 'pyc', 'sqlite', 'sqlite3', 'db', 'xlsx', 'docx', 'pptx']
const ARQUIVO_BINARIO = new RegExp(`\\.(?:${EXTENSOES_BINARIAS.join('|')})$`, 'i')
const BYTES_PARA_DETECTAR_BINARIO = 8000
const LIMITE_DE_LEITURA = 1_000_000
const LIMITE_DA_SAIDA_DO_GIT = 400_000_000
const ARVORE_VAZIA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
const ARQUIVO_DE_CODIGO = /\.(ts|tsx|js|mjs|cjs|sh|yml|yaml|tf)$/
const ARQUIVO_DE_TESTE = /(^|[/])tests[/]|\.test\.(?:ts|mjs)$/
const FORMATO_DA_ENTRADA = /^(.+)::([a-z0-9-]+)::([0-9a-f]{12}|-)::([1-9]\d*)$/
const ASSINATURA_DE_ARQUIVO = '-'
const DROP_QUALQUER = /\bDROP\b/gi
const TRUNCATE = /\bTRUNCATE\b/i
const DROP_SEM_PERDA_DE_DADO = /(?<=\bON COMMIT )DROP\b|DROP (?:CONSTRAINT|DEFAULT|NOT NULL)\b/iy
const DROP_DE_OBJETO_SEM_DADO = /DROP (INDEX|POLICY|TRIGGER|FUNCTION|PROCEDURE|VIEW)\b/iy
const OBJETOS_COM_CASCATA_PERIGOSA = new Set(['FUNCTION', 'PROCEDURE', 'VIEW'])
const ALTER = /\bALTER\b/i
const CASCADE = /\bCASCADE\b/i
const EXECUTE_COM_CONCATENACAO = /\bEXECUTE\s+'(?:[^']|'')*'\s*\|\|/i
const META_COMANDO_PSQL = /(?:^|;)[ \t]*\\|\\(?:g|gexec|gset|gx)\b/m
const ABERTURA_DE_DOLAR = /\$(?:[A-Za-z_\u0080-\uffff][A-Za-z0-9_\u0080-\uffff]*)?\$/y
const CARACTERE_DE_IDENTIFICADOR = /[A-Za-z0-9_$\u0080-\uffff]/
const MODOS_DE_BLOCO = ['aninhado', 'simples', 'nenhum']
const MODOS_DE_LINHA = [true, false]
const MODOS_DE_LITERAL = ['nenhum', 'sql', 'sql-com-barra', 'dolar', 'dolar-sql', 'dolar-sql-com-barra']
const VARIANTES_DE_NORMALIZACAO = MODOS_DE_BLOCO.flatMap((bloco) => MODOS_DE_LINHA.flatMap((linha) => MODOS_DE_LITERAL.map((literais) => ({ bloco, linha, literais }))))
const ESPACO = /\s/

function fimDoComentarioDeBloco(sql, inicio, aninhado) {
  let profundidade = 1
  let posicao = inicio + 2
  while (posicao < sql.length && profundidade > 0) {
    if (aninhado && sql.startsWith('/*', posicao)) {
      profundidade += 1
      posicao += 2
    } else if (sql.startsWith('*/', posicao)) {
      profundidade -= 1
      posicao += 2
    } else {
      posicao += 1
    }
  }
  return posicao
}

function normalizarSql(sql, { bloco, linha, literais }) {
  const saida = []
  let espacoPendente = false
  const emitir = (caractere) => {
    if (ESPACO.test(caractere)) {
      espacoPendente = true
      return
    }
    if (espacoPendente && saida.length > 0) saida.push(' ')
    espacoPendente = false
    saida.push(caractere)
  }
  const aspasSimples = literais !== 'nenhum' && literais !== 'dolar'
  const dolar = literais.startsWith('dolar')
  let dentroDeLiteral = false
  let posicao = 0
  while (posicao < sql.length) {
    const caractere = sql[posicao]
    if (dentroDeLiteral) {
      emitir(caractere)
      if (literais.endsWith('sql-com-barra') && caractere === '\\' && posicao + 1 < sql.length) {
        emitir(sql[posicao + 1])
        posicao += 2
        continue
      }
      if (caractere === "'") dentroDeLiteral = false
      posicao += 1
      continue
    }
    if (dolar && caractere === '$' && !(posicao > 0 && CARACTERE_DE_IDENTIFICADOR.test(sql[posicao - 1]))) {
      ABERTURA_DE_DOLAR.lastIndex = posicao
      const abertura = ABERTURA_DE_DOLAR.exec(sql)
      if (abertura) {
        const marca = abertura[0]
        const fechamento = sql.indexOf(marca, posicao + marca.length)
        const fim = fechamento < 0 ? sql.length : fechamento + marca.length
        for (let i = posicao; i < fim; i += 1) emitir(sql[i])
        posicao = fim
        continue
      }
    }
    if (caractere === "'" && aspasSimples) {
      dentroDeLiteral = true
      emitir(caractere)
      posicao += 1
      continue
    }
    if (bloco !== 'nenhum' && sql.startsWith('/*', posicao)) {
      posicao = fimDoComentarioDeBloco(sql, posicao, bloco === 'aninhado')
      espacoPendente = true
      continue
    }
    if (linha && sql.startsWith('--', posicao)) {
      while (posicao < sql.length && sql[posicao] !== '\n' && sql[posicao] !== '\r') posicao += 1
      espacoPendente = true
      continue
    }
    emitir(caractere)
    posicao += 1
  }
  return saida.join('')
}

function declaracaoTemDropDestrutivo(declaracao) {
  let temAlter
  let temCascade
  DROP_QUALQUER.lastIndex = 0
  for (let achado = DROP_QUALQUER.exec(declaracao); achado; achado = DROP_QUALQUER.exec(declaracao)) {
    DROP_SEM_PERDA_DE_DADO.lastIndex = achado.index
    if (DROP_SEM_PERDA_DE_DADO.test(declaracao)) continue
    DROP_DE_OBJETO_SEM_DADO.lastIndex = achado.index
    const objeto = DROP_DE_OBJETO_SEM_DADO.exec(declaracao)
    if (!objeto) return true
    temAlter ??= ALTER.test(declaracao)
    if (temAlter) return true
    if (!OBJETOS_COM_CASCATA_PERIGOSA.has(objeto[1].toUpperCase())) continue
    temCascade ??= CASCADE.test(declaracao)
    if (temCascade) return true
  }
  return false
}

function normalizadoTemSqlDestrutivo(normalizado) {
  if (TRUNCATE.test(normalizado) || EXECUTE_COM_CONCATENACAO.test(normalizado)) return true
  return normalizado.split(';').some((declaracao) => declaracaoTemDropDestrutivo(declaracao))
}

function temSqlDestrutivo(sql) {
  if (META_COMANDO_PSQL.test(sql)) return true
  return VARIANTES_DE_NORMALIZACAO.some((variante) => normalizadoTemSqlDestrutivo(normalizarSql(sql, variante)))
}

function assinaturaDaLinha(texto) {
  return createHash('sha256').update(texto.trim().replace(/\s+/g, ' ')).digest('hex').slice(0, 12)
}

function git(argumentosGit, opcoes = {}) {
  try {
    return execFileSync('git', argumentosGit, { cwd: raiz, encoding: 'utf8', maxBuffer: 50_000_000, stdio: ['ignore', 'pipe', 'ignore'], ...opcoes })
  } catch {
    return ''
  }
}

function gitObrigatorio(argumentosGit) {
  try {
    return execFileSync('git', argumentosGit, { cwd: raiz, encoding: 'utf8', maxBuffer: LIMITE_DA_SAIDA_DO_GIT, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (erro) {
    console.error(`falha ao ler o git (${argumentosGit.slice(-3).join(' ')}): ${String(erro.message).split('\n')[0]}`)
    process.exit(2)
  }
}

const raiz = git(['rev-parse', '--show-toplevel']).trim() || process.cwd()

function lerAllowlist() {
  const arquivo = join(raiz, '.githooks', 'seguranca-allowlist.txt')
  const entradas = new Map()
  if (!existsSync(arquivo)) return entradas
  readFileSync(arquivo, 'utf8').split('\n').forEach((bruta, indice) => {
    const linha = bruta.trim()
    if (!linha || linha.startsWith('#')) return
    const partes = linha.match(FORMATO_DA_ENTRADA)
    if (!partes) {
      console.error(`allowlist: entrada inválida na linha ${indice + 1}; o formato é caminho::id::assinatura::contagem (veja o cabeçalho de .githooks/seguranca-allowlist.txt)`)
      process.exit(2)
    }
    entradas.set(`${partes[1]}::${partes[2]}::${partes[3]}`, Number(partes[4]))
  })
  return entradas
}

function portaoDeCorte() {
  const arquivo = join(raiz, 'db', 'corte-gate.txt')
  if (!existsSync(arquivo)) return new Set()
  const linhas = readFileSync(arquivo, 'utf8').split('\n').map((linha) => linha.trim())
  return new Set(linhas.filter((linha) => linha && !linha.startsWith('#')))
}

function arquivosBinariosDoNumstat(textoComNul) {
  return String(textoComNul).split('\0').filter(Boolean).flatMap((registro) => {
    const partes = registro.match(/^(\S+)\t(\S+)\t(.*)$/s)
    return partes && partes[1] === '-' && partes[2] === '-' ? [partes[3]] : []
  })
}

function adicionadasDoDiff(diff) {
  const adicionadas = linhasAdicionadas(diff(['-U0']))
  const comByteNulo = arquivosBinariosDoNumstat(diff(['--numstat', '-z'])).filter((arquivo) => !ARQUIVO_BINARIO.test(arquivo))
  return [...adicionadas, ...comByteNulo.map((arquivo) => ({ arquivo, linha: 1, texto: '\0' }))]
}

function contextoDoIndice() {
  const diff = (extra) => gitObrigatorio(['-c', 'core.quotePath=false', 'diff', '--cached', '--no-color', '--no-renames', ...extra])
  return {
    alteracoes: alteracoesDoNameStatus(diff(['--name-status', '-z'])),
    adicionadas: adicionadasDoDiff(diff),
    conteudo: (arquivo) => gitObrigatorio(['show', `:${arquivo}`]),
  }
}

function resolverRevisao(revisao) {
  const resolvida = ZEROS.test(revisao) ? ARVORE_VAZIA : revisao
  if (!git(['rev-parse', '--verify', '--quiet', `${resolvida}^{tree}`]).trim()) {
    console.error(`revisão não encontrada no repositório: ${revisao} (o checkout precisa de histórico suficiente, fetch-depth: 0)`)
    process.exit(2)
  }
  return resolvida
}

function contextoDoIntervalo(inicioInformado, fimInformado) {
  const inicio = resolverRevisao(inicioInformado)
  const fim = resolverRevisao(fimInformado)
  const diff = (extra) => gitObrigatorio(['-c', 'core.quotePath=false', 'diff', `${inicio}..${fim}`, '--no-color', '--no-renames', ...extra])
  return {
    alteracoes: alteracoesDoNameStatus(diff(['--name-status', '-z'])),
    adicionadas: adicionadasDoDiff(diff),
    conteudo: (arquivo) => gitObrigatorio(['show', `${fim}:${arquivo}`]),
  }
}

function* fatiasDoArquivo(caminho) {
  const descritor = openSync(caminho, 'r')
  try {
    const decodificador = new StringDecoder('utf8')
    const bloco = Buffer.allocUnsafe(TAMANHO_DO_BLOCO)
    let pendente = ''
    for (;;) {
      const lidos = readSync(descritor, bloco, 0, bloco.length, null)
      if (lidos === 0) break
      const lido = bloco.subarray(0, lidos)
      const linhas = (pendente + decodificador.write(lido)).split('\n')
      pendente = linhas.pop()
      for (const texto of linhas) yield { texto, fimDeLinha: true }
      while (pendente.length > LIMITE_DE_LEITURA) {
        yield { texto: pendente.slice(0, LIMITE_DE_LEITURA), fimDeLinha: false }
        pendente = pendente.slice(LIMITE_DE_LEITURA - SOBREPOSICAO_DE_FATIA)
      }
    }
    yield { texto: pendente + decodificador.end(), fimDeLinha: true }
  } finally {
    closeSync(descritor)
  }
}

function binarioDeFato(caminho) {
  const descritor = openSync(caminho, 'r')
  try {
    const bloco = Buffer.alloc(BYTES_PARA_DETECTAR_BINARIO)
    const lidos = readSync(descritor, bloco, 0, bloco.length, 0)
    return bloco.subarray(0, lidos).includes(0)
  } finally {
    closeSync(descritor)
  }
}

function* linhasDaArvore(arquivos) {
  for (const arquivo of arquivos) {
    let numero = 1
    try {
      if (ARQUIVO_BINARIO.test(arquivo) && binarioDeFato(join(raiz, arquivo))) continue
      for (const { texto, fimDeLinha } of fatiasDoArquivo(join(raiz, arquivo))) {
        yield { arquivo, linha: numero, texto }
        if (texto.includes('\0')) break
        if (fimDeLinha) numero += 1
      }
    } catch (erro) {
      yield { arquivo, linha: 0, texto: '', falhaDeLeitura: String(erro?.code ?? 'erro') }
    }
  }
}

function contextoDaArvore() {
  const arquivos = gitObrigatorio(['-c', 'core.quotePath=false', 'ls-files', '-z']).split('\0').filter(Boolean)
  return { alteracoes: arquivos.map((arquivo) => ({ status: 'A', arquivo })), adicionadas: linhasDaArvore(arquivos), conteudo: () => '', arvore: true }
}

function verificarContexto(contexto) {
  const achados = []
  const achar = (arquivo, linha, id, mensagem, texto) => achados.push({ arquivo, linha, id, mensagem, assinatura: texto === undefined ? ASSINATURA_DE_ARQUIVO : assinaturaDaLinha(texto) })
  const aplicar = (lista, linha) => {
    for (const regra of lista) if (regra.padrao.test(linha.texto)) achar(linha.arquivo, linha.linha, regra.id, regra.mensagem, linha.texto)
  }
  const credencialVizinha = criarDetectorDeCredencialVizinha()

  for (const { status, arquivo } of contexto.alteracoes) {
    if (status !== 'D' && arquivoSensivel(arquivo)) achar(arquivo, 0, 'arquivo-sensivel', 'Arquivo de segredo versionado')
  }

  const arquivosComByteNulo = new Set()
  for (const linhaInteira of contexto.adicionadas) {
    if (arquivosComByteNulo.has(linhaInteira.arquivo)) continue
    if (linhaInteira.falhaDeLeitura) {
      achar(linhaInteira.arquivo, 0, 'falha-de-leitura', `Não foi possível ler o arquivo versionado (${linhaInteira.falhaDeLeitura}); sem leitura não há varredura`)
      continue
    }
    if (linhaInteira.texto.includes('\0')) {
      arquivosComByteNulo.add(linhaInteira.arquivo)
      achar(linhaInteira.arquivo, 0, 'byte-nulo-em-arquivo-de-texto', 'Byte nulo em arquivo que não é binário conhecido (esconde conteúdo de ferramentas que o tratam como binário); o resto do arquivo não é varrido')
      continue
    }
    for (const linha of fatiasDaLinha(linhaInteira)) verificarLinha(linha)
  }

  function verificarLinha(linha) {
    const ehTeste = ARQUIVO_DE_TESTE.test(linha.arquivo)
    for (const tipo of tiposDeSegredo(linha, credencialVizinha)) {
      if (ehTeste && TIPOS_HEURISTICOS.has(tipo)) continue
      achar(linha.arquivo, linha.linha, 'segredo', `Possível segredo (${tipo}); o valor não é exibido`, linha.texto)
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
      if (temSqlDestrutivo(contexto.conteudo(arquivo)) && !portao.has(basename(arquivo))) {
        achar(arquivo, 0, 'migracao-destrutiva-fora-do-portao', 'Migração destrutiva, com meta-comando do psql ou com SQL dinâmico concatenado precisa constar em db/corte-gate.txt (ADR 0034, ADR 0058)')
      }
    }
  }
  return semDuplicatas(achados)
}

function semDuplicatas(achados) {
  const vistos = new Set()
  return achados.filter((achado) => {
    const chave = `${achado.arquivo}:${achado.linha}:${achado.id}`
    if (vistos.has(chave)) return false
    vistos.add(chave)
    return true
  })
}

const chaveDaAllowlist = (achado) => `${achado.arquivo}::${achado.id}::${achado.assinatura ?? ASSINATURA_DE_ARQUIVO}`

function aplicarAllowlist(achados, contexto = {}) {
  const permitidos = lerAllowlist()
  const restantes = []
  const ocorrencias = new Map()
  for (const achado of achados) {
    const chave = chaveDaAllowlist(achado)
    if (!permitidos.has(chave)) {
      restantes.push(achado)
      continue
    }
    ocorrencias.set(chave, (ocorrencias.get(chave) ?? 0) + 1)
  }
  if (contexto.arvore) restantes.push(...divergenciasDaAllowlist(permitidos, ocorrencias))
  return restantes
}

function divergenciasDaAllowlist(permitidos, ocorrencias) {
  const divergencias = []
  for (const [chave, esperado] of permitidos) {
    const encontrado = ocorrencias.get(chave) ?? 0
    if (encontrado === esperado) continue
    const [arquivo, id] = chave.split('::')
    divergencias.push({ arquivo, linha: 0, id: 'allowlist-divergente', mensagem: `A allowlist espera ${esperado} ocorrência(s) de [${id}] com esta assinatura e a árvore tem ${encontrado}; corrija o código ou atualize a entrada (--arvore --sugerir)` })
  }
  return divergencias
}

function sugerirEntradas(achados) {
  const contagem = new Map()
  for (const achado of achados) contagem.set(chaveDaAllowlist(achado), (contagem.get(chaveDaAllowlist(achado)) ?? 0) + 1)
  return [...contagem].map(([chave, quantidade]) => `${chave}::${quantidade}`).sort()
}

function relatar(achados) {
  console.error(`verificação de segurança: ${achados.length} problema(s)`)
  for (const achado of achados.slice(0, 40)) {
    const onde = achado.linha > 0 ? `${achado.arquivo}:${achado.linha}` : achado.arquivo
    console.error(`- ${onde} [${achado.id}] ${achado.mensagem}`)
  }
  if (achados.length > 40) console.error(`- e mais ${achados.length - 40}`)
  console.error('Corrija. Exceção consciente: linha "caminho::id::assinatura::contagem" em .githooks/seguranca-allowlist.txt (revisada no PR; gere com --arvore --sugerir).')
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
  if (argumentos.includes('--arvore')) {
    const achadosDaArvore = verificarContexto(contextoDaArvore())
    if (argumentos.includes('--sugerir')) {
      sugerirEntradas(achadosDaArvore).forEach((entrada) => console.log(entrada))
      process.exit(0)
    }
    return aplicarAllowlist(achadosDaArvore, { arvore: true })
  }
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
