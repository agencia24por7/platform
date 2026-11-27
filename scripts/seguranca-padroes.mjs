export const LINHA_MAXIMA = 8000
export const SOBREPOSICAO_DE_FATIA = 2048
export const JANELA_DE_LINHAS_VIZINHAS = 3

const TRECHO_LONGO_MAXIMO = 1000
const ARQUIVO_DE_CONFIGURACAO = /(?:\.(?:sh|ya?ml|tf|tfvars)|(?:^|[/])\.env[^/]*)$/
const NOME_SENSIVEL = '(?:secret|token|passw(?:or)?d|senha|segredo|chave|api[_-]?key|private[_-]?key|encryption[_-]?key|credential)'

export const TIPOS_HEURISTICOS = new Set(['atribuição de segredo', 'atribuição de segredo em português', 'atribuição sem aspas', 'hexadecimal junto de nome sensível', 'credencial exportada com valor hexadecimal'])

export const PADROES_DE_CODIGO = [
  { id: 'tls-desligado', maximo: 75, padrao: /rejectUnauthorized\s{0,20}:\s{0,20}false|NODE_TLS_REJECT_UNAUTHORIZED\s{0,20}=\s{0,20}['"]?0/, mensagem: 'Validação de certificado TLS desligada' },
  { id: 'html-injetado', maximo: 30, padrao: new RegExp('dangerously' + 'SetInnerHTML'), mensagem: 'HTML injetado sem sanitização (XSS)' },
  { id: 'eval-dinamico', maximo: 60, padrao: /\beval\s{0,20}\(|new\s{1,20}Function\s{0,20}\(/, mensagem: 'Execução dinâmica de código' },
  { id: 'sql-interpolado', maximo: 1060, padrao: new RegExp(`\\.unsafe\\s{0,20}\\(\\s{0,20}\`[^\`]{0,${TRECHO_LONGO_MAXIMO}}\\$\\{`), mensagem: 'SQL montado por interpolação (injeção)' },
  { id: 'shell-interpolado', maximo: 1060, padrao: new RegExp(`\\bexec(?:Sync)?\\s{0,20}\\(\\s{0,20}\`[^\`]{0,${TRECHO_LONGO_MAXIMO}}\\$\\{`), mensagem: 'Comando de shell montado por interpolação (injeção)' },
  { id: 'cors-aberto', maximo: 80, padrao: /Access-Control-Allow-Origin['"]?\s{0,20}[:,]\s{0,20}['"]\*['"]/, mensagem: 'CORS aberto para qualquer origem' },
]

export const PADROES_DE_WORKFLOW = [
  { id: 'workflow-pull-request-target', maximo: 20, padrao: /\bpull_request_target\b/, mensagem: 'pull_request_target executa código de fork com segredos' },
  { id: 'workflow-permissao-total', maximo: 45, padrao: /permissions:\s{1,20}write-all/, mensagem: 'Permissão write-all no workflow' },
  { id: 'workflow-acao-sem-sha', inicioDeLinha: true, maximo: 290, padrao: /^\s{0,40}-?\s{0,20}uses:\s{1,20}(?!\.[/]|docker:[/][/])[^\s@]{1,200}@(?![0-9a-f]{40}(?:\s|$))/, mensagem: 'Ação de terceiro sem fixar o commit (SHA de 40 caracteres)' },
  { id: 'workflow-baixa-e-executa', maximo: 560, padrao: /\b(?:curl|wget)\b[^|\n]{0,500}\|\s{0,20}(?:sudo\s{1,20})?(?:ba|z)?sh\b/, mensagem: 'Baixa e executa script no workflow' },
]

export const PADROES_DE_TERRAFORM = [
  { id: 'terraform-aberto-ao-mundo', maximo: 15, padrao: /["']0\.0\.0\.0[/]0["']/, mensagem: 'Faixa 0.0.0.0/0 aberta' },
  { id: 'terraform-publico', maximo: 25, padrao: /\ball(?:Authenticated)?Users\b/, mensagem: 'Recurso público (allUsers)' },
  { id: 'terraform-papel-amplo', maximo: 20, padrao: /["']roles[/](?:owner|editor)["']/, mensagem: 'Papel amplo demais (owner ou editor)' },
]

export const PADROES_DE_PACOTE = [
  { id: 'pacote-script-de-instalacao', maximo: 40, padrao: /"(?:preinstall|install|postinstall)"\s{0,20}:/, mensagem: 'Script de instalação no package.json' },
  { id: 'pacote-origem-nao-registrada', maximo: 255, padrao: /"[^"]{1,200}"\s{0,20}:\s{0,20}"(?:git\+|github:|https?:|file:|latest$|\*$)/, mensagem: 'Dependência fora do registro ou sem versão fixa' },
]

export const PADROES_DE_SEGREDO = [
  { tipo: 'chave privada', maximo: 40, padrao: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { tipo: 'chave AWS', maximo: 25, padrao: /\bAKIA[0-9A-Z]{16}\b/ },
  { tipo: 'token GitHub', maximo: 530, padrao: /\b(?:ghp|gho|ghs|ghu)_[A-Za-z0-9]{30,512}|\bgithub_pat_[A-Za-z0-9_]{30,512}/ },
  { tipo: 'token Slack', maximo: 520, padrao: /\bxox[baprs]-[A-Za-z0-9-]{10,512}/ },
  { tipo: 'chave Google API', maximo: 45, padrao: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { tipo: 'token OAuth Google', maximo: 520, padrao: /\bya29\.[0-9A-Za-z_-]{20,512}/ },
  { tipo: 'token Meta', maximo: 520, padrao: /\bEAA[A-Za-z0-9]{50,512}/ },
  { tipo: 'chave sk-', maximo: 520, padrao: /\bsk-[A-Za-z0-9_-]{24,512}/ },
  { tipo: 'atribuição de segredo', maximo: 780, padrao: /\b(?:secret|token|passw(?:or)?d|api[_-]?key|private[_-]?key)\w{0,120}["']?\s{0,64}[:=]\s{0,64}["'](?=(?<valor>[A-Za-z0-9/+=_-]{24,512}))\k<valor>["'A-Za-z0-9/+=_-]/i },
  { tipo: 'JWT', maximo: 210, padrao: /\beyJ[A-Za-z0-9_-]{8,100}\.eyJ[A-Za-z0-9_-]{8,100}/ },
  { tipo: 'webhook Slack', maximo: 230, padrao: /hooks\.slack\.com\/services\/[A-Za-z0-9/_-]{8,200}/ },
  { tipo: 'hexadecimal junto de nome sensível', maximo: 525, padrao: new RegExp(`${NOME_SENSIVEL}\\w{0,120}["']?\\s{0,64}[:=]\\s{0,64}["']?[0-9a-f]{32,256}`, 'i') },
]

const PADRAO_DE_URL_COM_CREDENCIAL = /\b[a-z][a-z0-9+.-]{1,20}:\/\/([^\s:/@'"`<>${}]{1,64}):([^\s@/'"`]{1,100})@([^\s/'"`:?#]{1,100})/gi
const PADRAO_EM_PORTUGUES = /(?:senha|segredo|chave|encryption[_-]?key)\w{0,120}["']?\s{0,64}[:=]\s{0,64}["'](?=(?<valor>[A-Za-z0-9/+=_-]{24,512}))\k<valor>["'A-Za-z0-9/+=_-]/i
const PADRAO_SEM_ASPAS = new RegExp(`${NOME_SENSIVEL}\\w{0,120}\\s{0,64}[:=]\\s{0,64}(?!["'$<{(])(?=(?<valor>[A-Za-z0-9/+=_-]{20,256}))\\k<valor>(?!\\.)`, 'i')
const NOME_JSON_SENSIVEL = new RegExp(`"name"\\s{0,8}:\\s{0,8}"[^"]{0,60}${NOME_SENSIVEL}[^"]{0,60}"`, 'i')
const VALOR_JSON_HEXADECIMAL = /"value"\s{0,8}:\s{0,8}"[0-9a-f]{32,256}/i

export const PADROES_COM_CAPTURA = [
  { id: 'url-com-credencial', maximo: 300, padrao: PADRAO_DE_URL_COM_CREDENCIAL },
  { id: 'atribuicao-em-portugues', maximo: 780, padrao: PADRAO_EM_PORTUGUES },
  { id: 'atribuicao-sem-aspas', maximo: 525, padrao: PADRAO_SEM_ASPAS },
  { id: 'json-nome-sensivel', maximo: 170, padrao: NOME_JSON_SENSIVEL },
  { id: 'json-valor-hexadecimal', maximo: 285, padrao: VALOR_JSON_HEXADECIMAL },
]

export const TODOS_OS_PADROES = [
  ...PADROES_DE_CODIGO,
  ...PADROES_DE_WORKFLOW,
  ...PADROES_DE_TERRAFORM,
  ...PADROES_DE_PACOTE,
  ...PADROES_DE_SEGREDO.map(({ tipo, maximo, padrao }) => ({ id: tipo, maximo, padrao })),
  ...PADROES_COM_CAPTURA,
]

const SENHAS_DE_EXEMPLO = /^(?:\$.*|\{.*|<.*|%.*|\*+|x+|\.+|passw(?:or)?d|pass|senha|secret|segredo|changeme|change-me|placeholder|exemplo|example)$/i
const VALORES_DE_EXEMPLO = /^(?:x+|changeme|change-me|placeholder|exemplo|example|dummy|fake|test|todo)/i
const FORMATO_DE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HOSTS_LOCAIS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]', 'host.docker.internal'])

export function* fatiasDaLinha(linha) {
  if (linha.texto.length <= LINHA_MAXIMA) {
    yield linha
    return
  }
  const passo = LINHA_MAXIMA - SOBREPOSICAO_DE_FATIA
  for (let inicio = 0; inicio < linha.texto.length; inicio += passo) {
    yield { ...linha, texto: linha.texto.slice(inicio, inicio + LINHA_MAXIMA) }
    if (inicio + LINHA_MAXIMA >= linha.texto.length) return
  }
}

function temUrlComCredencial(texto) {
  for (const [, usuario, senha, host] of texto.matchAll(PADRAO_DE_URL_COM_CREDENCIAL)) {
    if (SENHAS_DE_EXEMPLO.test(senha) || senha === usuario || HOSTS_LOCAIS.has(host.toLowerCase())) continue
    return true
  }
  return false
}

function valorPareceSegredo(valor) {
  if (!valor || VALORES_DE_EXEMPLO.test(valor) || FORMATO_DE_UUID.test(valor)) return false
  return /\d/.test(valor) && /[A-Za-z]/.test(valor)
}

function temAtribuicaoSemAspas(texto, arquivo) {
  if (!ARQUIVO_DE_CONFIGURACAO.test(arquivo)) return false
  return valorPareceSegredo(texto.match(PADRAO_SEM_ASPAS)?.groups?.valor)
}

export function criarDetectorDeCredencialVizinha() {
  let arquivoAtual = null
  let linhaDoNome = Number.NEGATIVE_INFINITY
  let linhaDoValor = Number.NEGATIVE_INFINITY
  return (linha) => {
    if (linha.arquivo !== arquivoAtual) {
      arquivoAtual = linha.arquivo
      linhaDoNome = linhaDoValor = Number.NEGATIVE_INFINITY
    }
    if (NOME_JSON_SENSIVEL.test(linha.texto)) linhaDoNome = linha.linha
    if (VALOR_JSON_HEXADECIMAL.test(linha.texto)) linhaDoValor = linha.linha
    const vizinhas = Math.abs(linhaDoNome - linhaDoValor) <= JANELA_DE_LINHAS_VIZINHAS
    if (vizinhas) linhaDoNome = linhaDoValor = Number.NEGATIVE_INFINITY
    return vizinhas
  }
}

export function tiposDeSegredo(linha, credencialVizinha) {
  const tipos = PADROES_DE_SEGREDO.filter(({ padrao }) => padrao.test(linha.texto)).map(({ tipo }) => tipo)
  if (temUrlComCredencial(linha.texto)) tipos.push('URL com credencial embutida')
  if (valorPareceSegredo(linha.texto.match(PADRAO_EM_PORTUGUES)?.groups?.valor)) tipos.push('atribuição de segredo em português')
  if (temAtribuicaoSemAspas(linha.texto, linha.arquivo)) tipos.push('atribuição sem aspas')
  if (credencialVizinha(linha)) tipos.push('credencial exportada com valor hexadecimal')
  return tipos
}
