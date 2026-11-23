import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, posix } from 'node:path'

const SINAIS_OPUS = [
  /arquitet|modelagem|planej|estrat[eé]gia|\bdesign\b|trade-?off|\badr\b/i,
  /seguran[cç]a|vulnerab|auth|autentica|autoriza|\brls\b|tenant|inquilino|segredo|token|kms|cofre|lgpd|privacidade|dado pessoal/i,
  /revis[aã]o|revisar|audit|adversarial|code.?review/i,
  /migra[cç][aã]o destrutiva|\bdrop\b|corte|release|produ[cç][aã]o|terraform|infra\b|deploy/i,
  /causa.?raiz|n[aã]o consigo achar|falhou de novo|race condition|concorr[eê]ncia/i,
]

const SINAIS_ESFORCO_MAXIMO = [
  /causa.?raiz|falhou de novo|race condition|concorr[eê]ncia/i,
  /audit|adversarial|vulnerab|pentest/i,
  /migra[cç][aã]o destrutiva|\bcorte\b/i,
]

const SINAIS_HAIKU = [
  /^\s*(liste|listar|mapeie|mapear|onde (est[aá]|fica)|quais arquivos|procure|buscar|busque|encontre)\b/i,
  /resum(a|ir|o) (o )?(log|erro|sa[ií]da|arquivo)/i,
  /\b(grep|localizar|rastrear depend[eê]ncia|quem chama)\b/i,
]

const SINAIS_DE_ACAO = /revis|audit|corrij|implement|refator|reescrev|altere|mude|crie|escreva|aplique|migre|planej|projet/i

const SINAIS_SONNET_COMPLEXO = [
  /refator|reescrev|implement|integra[cç][aã]o|nova (feature|funcionalidade|tela|p[aá]gina)|v[aá]rios arquivos|m[uú]ltiplos m[oó]dulos/i,
]

export function classificarTarefa(prompt) {
  const texto = String(prompt ?? '')
  if (texto.trim().length < 12) return { nivel: 'sonnet', esforco: 'medium', motivo: 'curto' }
  if (SINAIS_HAIKU.some((sinal) => sinal.test(texto)) && !SINAIS_DE_ACAO.test(texto)) {
    return { nivel: 'haiku', esforco: 'low', motivo: 'exploracao' }
  }
  if (SINAIS_OPUS.some((sinal) => sinal.test(texto))) {
    const maximo = SINAIS_ESFORCO_MAXIMO.some((sinal) => sinal.test(texto))
    return { nivel: 'opus', esforco: maximo ? 'max' : 'high', motivo: 'critica' }
  }
  if (SINAIS_SONNET_COMPLEXO.some((sinal) => sinal.test(texto))) return { nivel: 'sonnet', esforco: 'high', motivo: 'complexa' }
  return { nivel: 'sonnet', esforco: 'medium', motivo: 'padrao' }
}

export function orientacaoDeModelo({ nivel, esforco }) {
  if (nivel === 'opus') {
    return `Modelo: tarefa crítica (esforço ${esforco}). O cache é por modelo: não troque o modelo desta sessão no meio. Delegue a análise ao subagente security-reviewer (Opus) ou, se a sessão toda é desse tipo, /handoff, /clear e reinicie com scripts/start.sh "<tarefa>" (escolhe o modelo pela tarefa). Implementação delimitada vai para subagente Sonnet.`
  }
  if (nivel === 'haiku') {
    return 'Modelo: tarefa de busca ou resumo. Delegue ao subagente explorer (Haiku, esforço baixo) e trabalhe só com a conclusão dele.'
  }
  if (esforco === 'high') {
    return 'Esforço: tarefa complexa de implementação. Use /effort high para esta tarefa e volte a medium ao terminar.'
  }
  return null
}

export function nivelDeContexto(bytes, limites = { aviso: 700_000, critico: 1_200_000 }) {
  if (bytes >= limites.critico) return 'critico'
  if (bytes >= limites.aviso) return 'aviso'
  return 'ok'
}

export function mensagemDeContexto(nivel, bytes) {
  const kb = Math.round(bytes / 1024)
  if (nivel === 'critico') {
    return `Contexto: a transcrição da sessão tem ~${kb} KB. Encerre a etapa agora: /handoff e depois /clear (se as últimas voltas foram erradas, /rewind em vez de /compact). Não inicie trabalho novo nesta sessão.`
  }
  if (nivel === 'aviso') {
    return `Contexto: a transcrição da sessão tem ~${kb} KB. Termine a etapa atual, use o subagente explorer para buscas amplas e prepare /handoff (ou /compact focado em decisões, arquivos alterados e pendências, se precisar seguir nesta sessão).`
  }
  return null
}

const PADROES_DE_SEGREDO = [
  ['chave privada', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/],
  ['chave AWS', /\bAKIA[0-9A-Z]{16}\b/],
  ['token GitHub', /\b(?:ghp|gho|ghs|ghu)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{30,}\b/],
  ['token Slack', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ['chave Google API', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['token OAuth Google', /\bya29\.[0-9A-Za-z_-]{20,}\b/],
  ['token Meta', /\bEAA[A-Za-z0-9]{50,}\b/],
  ['chave sk-', /\bsk-[A-Za-z0-9_-]{24,}\b/],
  ['atribuição de segredo', /\b(?:secret|token|passw(?:or)?d|api[_-]?key|private[_-]?key)\w*["']?\s*[:=]\s*["'][A-Za-z0-9/+=_-]{24,}["']/i],
]

export function detectarSegredo(texto) {
  const alvo = String(texto ?? '')
  return PADROES_DE_SEGREDO.filter(([, padrao]) => padrao.test(alvo)).map(([nome]) => nome)
}

const ARQUIVO_SENSIVEL = /(^|[/])(\.env(\.(?!example$)[\w.-]+)?|[^/]*\.(pem|key|p12|pfx)|id_(rsa|ed25519|ecdsa)|credentials\.json|service-account[^/]*\.json)$/i

export function arquivoSensivel(caminho) {
  return ARQUIVO_SENSIVEL.test(String(caminho ?? ''))
}

const GLOB_SENSIVEL = /(^|[/*])(\.env(?!\.example)|[^/]*\.(pem|key|p12|pfx)|id_(rsa|ed25519|ecdsa)|credentials|service-account)/i

const SONDAS_DE_SEGREDO = ['.env', '.env.local', '.env.production', 'chave.pem', 'chave.key', 'cert.p12', 'cert.pfx', 'id_rsa', 'id_ed25519', 'credentials.json', 'service-account.json']

function globParaRegex(glob) {
  let corpo = ''
  let chaves = 0
  for (let indice = 0; indice < glob.length; indice += 1) {
    const caractere = glob[indice]
    if (caractere === '*') {
      if (glob[indice + 1] === '*') {
        corpo += '.*'
        indice += 1
      } else corpo += '[^/]*'
    } else if (caractere === '?') corpo += '[^/]'
    else if (caractere === '[') {
      const fim = glob.indexOf(']', indice + 1)
      if (fim > indice) {
        corpo += '[' + glob.slice(indice + 1, fim).replace(/^!/, '^') + ']'
        indice = fim
      } else corpo += '\\['
    } else if (caractere === '{') {
      corpo += '(?:'
      chaves += 1
    } else if (caractere === '}' && chaves > 0) {
      corpo += ')'
      chaves -= 1
    } else if (caractere === ',' && chaves > 0) corpo += '|'
    else corpo += caractere.replace(/[.+^$()|\\]/g, '\\$&')
  }
  return new RegExp('^(?:.*[/])?' + corpo + '$', 'i')
}

export function globAlcancaSegredo(glob) {
  let regex
  try {
    regex = globParaRegex(String(glob))
  } catch {
    return true
  }
  return SONDAS_DE_SEGREDO.some((sonda) => regex.test(sonda) || regex.test('x/' + sonda))
}

export function avaliarBusca({ caminho, glob }) {
  if (caminho && arquivoSensivel(caminho)) {
    return { decisao: 'deny', motivo: 'Busca em arquivo sensível: segredo nunca entra no contexto.' }
  }
  if (glob && (GLOB_SENSIVEL.test(String(glob)) || globAlcancaSegredo(glob))) {
    return { decisao: 'deny', motivo: 'Busca por arquivos de segredo (.env, chaves, credenciais) bloqueada.' }
  }
  return null
}

const TAMANHO_MAXIMO_LEITURA = 100_000

export function avaliarLeitura({ caminho, tamanho, comRecorte }) {
  if (arquivoSensivel(caminho)) {
    return { decisao: 'deny', motivo: 'Arquivo sensível: segredo nunca entra no contexto. Peça ao humano o dado necessário ou use o nome da variável.' }
  }
  if (!comRecorte && tamanho > TAMANHO_MAXIMO_LEITURA) {
    return { decisao: 'deny', motivo: `Arquivo de ${Math.round(tamanho / 1024)} KB lido por inteiro. Localize com grep -n e leia o trecho com offset e limit.` }
  }
  return null
}

export function avaliarEscrita({ caminho, conteudo, existeVersionado, modoDePermissao }) {
  const alvo = String(caminho ?? '')
  if (arquivoSensivel(alvo)) return { decisao: 'deny', motivo: 'Não grave em arquivo de segredo (.env, chave, credencial). Segredo é criado pelo humano ou por pipe sem eco.' }
  const alvoUnificado = alvo.replace(/\\/g, '/')
  if (/(^|[/])\.config[/]gh[/]/i.test(alvoUnificado)) return { decisao: 'deny', motivo: 'A configuração do gh define o que a guarda verifica: só o humano altera (ADR 0048).' }
  if (/(^|[/])(node_modules|\.next)[/]/.test(alvo)) return { decisao: 'deny', motivo: 'Diretório gerado: não edite à mão.' }
  if (/(^|[/])package-lock\.json$/.test(alvo)) return { decisao: 'deny', motivo: 'O lockfile só muda pelo npm (npm install / npm ci).' }
  const achados = detectarSegredo(conteudo)
  if (achados.length > 0) return { decisao: 'deny', motivo: `Conteúdo com aparência de segredo (${achados.join(', ')}). Use variável de ambiente ou Secret Manager; nunca o valor no código.` }
  if (/(^|[/])(?:\.claude[/]hooks[/]|\.githooks[/]|\.claude[/]settings[^/]*\.json$)/i.test(alvoUnificado)) {
    return { decisao: MODOS_SEM_CONFIRMACAO.has(modoDePermissao) ? 'deny' : 'ask', motivo: MOTIVO_AUTOPROTECAO }
  }
  if (existeVersionado && /(^|[/])db[/]migrations[/][^/]+\.sql$/.test(alvo)) {
    return { decisao: 'ask', motivo: 'Migração já versionada é imutável: o livro-razão pode ter aplicado a versão antiga. Crie uma migração nova, salvo exceção que o humano confirme.' }
  }
  return null
}

const ALVO_PROTEGIDO = String.raw`\S*(?:\.claude/hooks|\.claude/settings|\.githooks|\.config/gh)\S*`
const MOTIVO_AUTOPROTECAO = 'Gravar na guarda do projeto, nos settings do Claude Code ou na configuração do gh muda aquilo em que a guarda confia: só com autorização explícita, em sessão interativa do humano (ADR 0048).'

const regraDeGravacao = (fonte) => ({ padrao: new RegExp(fonte, 'i'), decisao: 'ask', producao: true, motivo: MOTIVO_AUTOPROTECAO })

const REGRAS_DE_COMANDO = [
  { padrao: /\bcurl\b[^|;&]*\|\s*(sudo\s+)?(ba|z)?sh\b|\bwget\b[^|;&]*\|\s*(sudo\s+)?(ba|z)?sh\b/, decisao: 'deny', motivo: 'Baixar e executar script direto no shell é proibido. Baixe, leia e só então execute.' },
  { padrao: /\b(cat|less|more|head|tail|bat|nl|strings|xxd|od|sed|awk|grep|rg|cp|mv|ln|tar|zip|gzip|base64|openssl|python3?|node|perl|ruby|source|xargs|diff|jq|curl|wget|scp|rsync|tee|git\s+(?:show|diff|add))\b[^|;&]*(?<![\w-])(\.env(?!\.example)(\.[\w.-]+)?|[\w./-]*\.(pem|key|p12|pfx)|id_rsa|id_ed25519|credentials\.json)\b/i, decisao: 'deny', motivo: 'Leitura de arquivo de segredo bloqueada. Nunca imprima valor de segredo.' },
  { padrao: /(?:^|[;&|(]\s*)(?:printenv|env|export\s+-p|set)\s*(?:$|[|;&])/, decisao: 'deny', motivo: 'Despejar o ambiente expõe segredos. Consulte uma variável específica pelo nome sem imprimir o valor.' },
  { padrao: /\becho\b[^|;&]*\$\{?\w*(TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|PRIVATE_?KEY)\w*/i, decisao: 'deny', motivo: 'Não imprima variável de segredo.' },
  { padrao: /\bgcloud\s+secrets\s+versions\s+access\b/, decisao: 'deny', motivo: 'Ler o valor de um segredo imprime o segredo. Crie versões por pipe sem eco e peça ao humano para conferir.' },
  { padrao: /(\brm\b|\bgcloud\s+storage\s+rm\b|\bgsutil\s+(-m\s+)?rm\b|\bgcloud\s+sql\s+backups\s+delete\b|\bDROP\b)[^;&|]*backup/i, decisao: 'deny', motivo: 'Backups do Postgres nunca são apagados.' },
  { padrao: /\brm\s+(?:-[a-z]*r[a-z]*|--recursive)(?:\s+-[a-z]+)*\s+(?:[/]\*?|~|\$HOME|\.git|\*)\s*(?:$|[;&|])/, decisao: 'deny', motivo: 'Remoção recursiva em raiz, HOME, .git ou curinga solto.' },
  { padrao: /\bgit\s+push\b[^;&|]*(\bmain\b|HEAD:main)/, decisao: 'deny', motivo: 'Push em main só pelo fluxo de release (docs/release/), executado pelo humano.' },
  { padrao: /\bbq-ddl\.mjs\b(?=[^;&|]*--prod)(?![^;&|]*--dry-run)/, decisao: 'ask', producao: true, motivo: 'DDL em produção: só com autorização explícita do humano para esta operação, depois do --dry-run e de ler o alvo impresso (ADR 0028, ADR 0046).' },
  { padrao: /\bbq-ddl\.mjs\b[^;&|]*--confirmar/, decisao: 'ask', producao: true, motivo: 'DDL com --confirmar aplica de verdade: só com autorização explícita do humano para este alvo (ADR 0028, ADR 0046).' },
  { padrao: /^(?=[\s\S]*\bbq\b)(?=[\s\S]*\b(?:rm|mk|update|cp|load|DROP|TRUNCATE|DELETE|ALTER|CREATE|INSERT|MERGE)\b)/i, decisao: 'ask', producao: true, motivo: 'Comando cita bq junto de verbo ou SQL que muda objeto: só com autorização explícita do humano (ADR 0046). Falso positivo é aceito; o erro para o outro lado não.' },
  { padrao: /\bterraform\b(?:\s+-\S+)*\s+(apply|destroy|import|state\s+(rm|mv|push))\b/, decisao: 'deny', motivo: 'Terraform em produção só pelo caminho do CI (infra.yml na main). O agente aciona o workflow; apply local e o bootstrap são do humano (ADR 0046).' },
  { padrao: /\bgcloud\s+secrets\s+(versions\s+(add|destroy|disable)|delete|create|update|add-iam-policy-binding)\b/, decisao: 'ask', producao: true, motivo: 'Muda segredo em produção: só com autorização explícita; o valor vem do humano ou é gerado sem eco e nunca é impresso (ADR 0046).' },
  { padrao: /\bgcloud\s+kms\s+keys\s+(versions\s+(destroy|disable)|update)\b/, decisao: 'ask', producao: true, motivo: 'Desativar ou destruir versão de chave KMS não tem volta: só com autorização nomeando a chave e depois da recifragem com avaliadas = 0 e falhas = 0 provada (ADR 0042, ADR 0047).' },
  { padrao: /\bgcloud\s+sql\s+(backups\s+delete|instances\s+delete)\b/, decisao: 'deny', motivo: 'Apagar backup ou instância do Postgres é proibido.' },
  { padrao: /\bgh\s+api\b[^;&|]*(\/merge\b|dispatches|(?:-X|--method)[= ]*(?!GET\b)\w+|\s-[fF]|\s--(?:field|raw-field|input)\b|mutation)/i, decisao: 'ask', producao: true, motivo: 'Chamada de API do GitHub que escreve (merge, dispatch, POST, PUT, PATCH, DELETE ou mutation): ação externa que o humano autoriza (ADR 0046).' },
  { padrao: /\bautorizar_corte=true\b/, decisao: 'ask', producao: true, motivo: 'IRREVERSÍVEL: o corte roda migração destrutiva sem volta. Só com autorização explícita, depois do pre-flight verde e do backup (ADR 0034, ADR 0046).' },
  { padrao: /\bgh\s+(workflow\s+run|run\s+rerun|pr\s+merge|release\s+create)\b/, decisao: 'ask', producao: true, motivo: 'Dispara workflow, merge ou release: ação externa que o humano autoriza para esta operação (ADR 0046). Merge em main exige autorização nomeando o PR e o roteiro de docs/release/ cumprido (ADR 0034, ADR 0047).' },
  { padrao: /\bgh\s+pr\s+edit\b[^\n]*(?:--base\b|\s-B)/, decisao: 'ask', producao: true, motivo: 'Trocar a base de um PR muda para onde o merge vai (inclusive main): ação que o humano autoriza (ADR 0046, ADR 0047, ADR 0048).' },
  { padrao: /\bgh\s+alias\s+(set|import|delete)\b/, decisao: 'ask', producao: true, motivo: 'Alias do gh pode redefinir comandos e contornar as regras desta guarda: só com autorização explícita do humano (ADR 0048).' },
  regraDeGravacao(String.raw`(?<![-=])>>?(?!&)\s*["']?${ALVO_PROTEGIDO}`),
  regraDeGravacao(String.raw`\btee\b[^;&|\n]*\s["']?${ALVO_PROTEGIDO}`),
  regraDeGravacao(String.raw`\b(?:cp|mv|ln|install)\b[^;&|\n]*\s["']?${ALVO_PROTEGIDO}["']?(?:\s+\d?>&?\S*)*\s*(?:$|[;&|])`),
  regraDeGravacao(String.raw`\b(?:cp|mv|ln|install)\b[^;&|\n]*\s(?:-t\s*|--target-directory[= ]\s*)["']?${ALVO_PROTEGIDO}`),
  regraDeGravacao(String.raw`\bdd\b[^;&|\n]*\bof=["']?${ALVO_PROTEGIDO}`),
  regraDeGravacao(String.raw`\b(?:sed|perl)\b(?=[^;&|\n]*\s(?:-[a-zA-Z]*i|--in-place))[^;&|\n]*\s["']?${ALVO_PROTEGIDO}`),
  regraDeGravacao(String.raw`\b(?:rm|unlink|truncate|rmdir)\b[^;&|\n]*\s["']?${ALVO_PROTEGIDO}`),
  { padrao: /\bgh\s+config\s+set\b/, decisao: 'ask', producao: true, motivo: 'Configuração do gh (socket, browser, protocolo) pode desviar o que a guarda verifica: só com autorização explícita do humano (ADR 0048).' },
  { padrao: /\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f|checkout\s+--\s|checkout\s+\.|restore\s+\.|branch\s+-D|worktree\s+remove)/, decisao: 'ask', motivo: 'Pode descartar trabalho não commitado ou de outro agente.' },
  { padrao: /\bgit\s+(?:commit|push|merge|am|cherry-pick)\b[^;&|]*--no-verify|\bgit\s+commit\b[^;&|]*\s-n\b/, decisao: 'deny', motivo: 'Contornar os hooks de segurança do git é proibido. Corrija o achado ou registre a exceção na allowlist por PR.' },
  { padrao: /\bgit\s+(?:-c\s+core\.hooksPath\b|config\b(?![^;&|]*--(?:get|list))[^;&|]*core\.hooksPath\b(?![^;&|]*\.githooks))|\b(?:HUSKY|SKIP_SIMPLE_GIT_HOOKS)=0\b/, decisao: 'deny', motivo: 'Não desative nem troque os hooks do git do projeto (core.hooksPath deve ser .githooks).' },
  { padrao: /\bgit\s+push\b[^;&|]*(--force|\s-f\b)/, decisao: 'ask', motivo: 'Reescreve histórico remoto.' },
  { padrao: /\b(psql|docker\s+exec)\b[^;&|]*\b(DROP|TRUNCATE|DELETE\s+FROM)\b/i, decisao: 'ask', motivo: 'Comando destrutivo em banco: confirme o alvo e a necessidade.' },
]

function normalizarComando(texto) {
  return texto
    .replace(/\\\r?\n/g, ' ')
    .replace(/(^|\s)#[^\n]*/g, '$1')
    .replace(/\s--(?:project|account|impersonate-service-account|configuration|billing-project|format|quiet)(?:=|\s+)\S+/g, ' ')
    .replace(/\s(?:--quiet|-q)\b/g, ' ')
    .replace(/\bgcloud\s+(?:alpha|beta)\b/g, 'gcloud')
}

const MODOS_SEM_CONFIRMACAO = new Set(['bypassPermissions', 'auto'])

const MARCADOR_MERGE_EM_DEV = 'AUTORIZO_MERGE_EM_DEV='
const CONCLUSOES_VERDES = new Set(['SUCCESS', 'SKIPPED', 'NEUTRAL'])
const CAMINHOS_GH = ['/opt/homebrew/bin/gh', '/usr/local/bin/gh', '/usr/bin/gh']
const CAMPOS_PR = 'baseRefName,state,isDraft,statusCheckRollup,headRefOid,url,isCrossRepository,reviewDecision,mergeable,files,changedFiles'
const LIMITE_SAIDA_GH = 1024 * 1024
const PATH_MINIMO_GH = '/usr/bin:/bin'
const VARIAVEIS_REPASSADAS_AO_GH = ['LANG', 'GH_TOKEN', 'GITHUB_TOKEN']
const MOTIVO_SEM_TOKEN = 'sem GH_TOKEN no ambiente do hook; a exceção de merge exige token no ambiente do Claude Code'
const PASTAS_DO_CI_DA_GUARDA_E_DA_INFRA = ['.github/', '.claude/', '.githooks/', 'scripts/', 'infra/']
const CAMINHOS_ONDE_O_AGENTE_PODE_MESCLAR = ['src/', 'app/', 'db/migrations/', 'docs/', 'tests/', 'public/']
const PASTA_DE_RELEASE = 'docs/release/'
const MUDANCAS_ACEITAS_NO_ARQUIVO = new Set(['ADDED', 'CHANGED', 'DELETED', 'MODIFIED'])
const EXECUCAO_DO_WORKFLOW = new RegExp('/actions/runs/([0-9]+)/')

export const TIMEOUT_GH_MS = 5000
export const REPOSITORIO_PR = 'github.com/agencia24por7/platform'

const URL_DE_PR = `https://${REPOSITORIO_PR}/pull/`
const FORMA_MERGE_EM_DEV = new RegExp(
  `^AUTORIZO_MERGE_EM_DEV=([1-9][0-9]{0,6}) gh pr merge ([1-9][0-9]{0,6}) --repo ${REPOSITORIO_PR.replace(/[.]/g, '\\.')} --(?:merge|squash|rebase) --match-head-commit ([0-9a-f]{40})$`,
)
export const CHECKS_OBRIGATORIOS = [
  { workflowName: 'ci', name: 'qualidade' },
  { workflowName: 'ci', name: 'integracao' },
]

class ErroDeConsulta extends Error {}

export function consultarPRNoGitHub(numero, dependencias = {}) {
  const {
    existe = existsSync,
    executar = execFileSync,
    ambiente = process.env,
    criarDiretorio = () => mkdtempSync(join(tmpdir(), 'gh-guarda-')),
    removerDiretorio = (caminho) => rmSync(caminho, { recursive: true, force: true }),
  } = dependencias
  const gh = CAMINHOS_GH.find((caminho) => existe(caminho))
  if (!gh) throw new ErroDeConsulta(`gh não encontrado em ${CAMINHOS_GH.join(', ')}`)
  const env = { PATH: PATH_MINIMO_GH, GH_NO_UPDATE_NOTIFIER: '1', GH_PROMPT_DISABLED: '1', NO_COLOR: '1' }
  for (const nome of VARIAVEIS_REPASSADAS_AO_GH) if (ambiente[nome]) env[nome] = ambiente[nome]
  if (!env.GH_TOKEN && !env.GITHUB_TOKEN) throw new ErroDeConsulta(MOTIVO_SEM_TOKEN)
  const base = criarDiretorio()
  Object.assign(env, {
    HOME: base,
    GH_CONFIG_DIR: join(base, 'config'),
    XDG_STATE_HOME: join(base, 'state'),
    XDG_CACHE_HOME: join(base, 'cache'),
    XDG_CONFIG_HOME: join(base, 'xdg-config'),
  })
  try {
    const saida = executar(gh, ['pr', 'view', numero, '--repo', REPOSITORIO_PR, '--json', CAMPOS_PR], {
      encoding: 'utf8',
      timeout: TIMEOUT_GH_MS,
      maxBuffer: LIMITE_SAIDA_GH,
      stdio: ['ignore', 'pipe', 'ignore'],
      cwd: ambiente.CLAUDE_PROJECT_DIR ?? process.cwd(),
      env,
    })
    return JSON.parse(saida)
  } finally {
    removerDiretorio(base)
  }
}

function caminhoNormalizado(caminho) {
  const unificado = caminho.toLowerCase().replace(/\\/g, '/')
  return posix.normalize(unificado).replace(/^(?:[.]?\/)+/, '')
}

function comecaPorAlgum(normalizado, prefixos) {
  return prefixos.some((prefixo) => normalizado.startsWith(prefixo))
}

function problemaDoCaminho(caminho) {
  const normalizado = caminhoNormalizado(caminho)
  if (comecaPorAlgum(normalizado, PASTAS_DO_CI_DA_GUARDA_E_DA_INFRA)) return 'PR que muda o CI, a guarda, scripts ou infra é do humano'
  const dentroDaAllowlist = comecaPorAlgum(normalizado, CAMINHOS_ONDE_O_AGENTE_PODE_MESCLAR) && !normalizado.startsWith(PASTA_DE_RELEASE)
  return dentroDaAllowlist ? null : 'PR que toca fora das pastas de aplicação é do humano'
}

function itemVerde(item) {
  if (item.status === undefined && item.state !== undefined) return item.state === 'SUCCESS'
  return item.status === 'COMPLETED' && CONCLUSOES_VERDES.has(item.conclusion)
}

function instanteDoItem(item) {
  const instante = Date.parse(item.startedAt ?? item.completedAt ?? '')
  if (!Number.isNaN(instante)) return instante
  return itemVerde(item) ? 0 : Infinity
}

function chaveDoItem(item) {
  return `${item.workflowName ?? ''}\u0000${item.name ?? item.context ?? ''}`
}

function substituiExecucao(novo, atual) {
  const instanteNovo = instanteDoItem(novo)
  const instanteAtual = instanteDoItem(atual)
  return instanteNovo > instanteAtual || (instanteNovo === instanteAtual && !itemVerde(novo))
}

function problemaDoCI(rollup) {
  if (!Array.isArray(rollup) || rollup.length === 0) return 'o rollup de checks está vazio ou ausente'
  const recentes = new Map()
  for (const item of rollup) {
    if (!item || typeof item !== 'object') return 'o rollup de checks tem item malformado'
    const atual = recentes.get(chaveDoItem(item))
    if (!atual || substituiExecucao(item, atual)) recentes.set(chaveDoItem(item), item)
  }
  for (const obrigatorio of CHECKS_OBRIGATORIOS) {
    const nome = `${obrigatorio.workflowName}/${obrigatorio.name}`
    const item = recentes.get(chaveDoItem(obrigatorio))
    if (!item) return `falta o check obrigatório ${nome}`
    if (item.status !== 'COMPLETED' || item.conclusion !== 'SUCCESS') return `o check obrigatório ${nome} não está SUCCESS`
  }
  const execucoes = CHECKS_OBRIGATORIOS.map((obrigatorio) => EXECUCAO_DO_WORKFLOW.exec(String(recentes.get(chaveDoItem(obrigatorio)).detailsUrl ?? ''))?.[1])
  if (execucoes.some((execucao) => execucao === undefined)) return 'não foi possível identificar a execução do workflow dos checks obrigatórios'
  if (new Set(execucoes).size !== 1) return 'os checks obrigatórios vêm de execuções diferentes do workflow'
  const pendente = [...recentes.values()].find((item) => !itemVerde(item))
  if (pendente) return `o check ${pendente.workflowName ?? ''}/${pendente.name ?? pendente.context ?? '?'} não está verde`
  return null
}

function negarMerge(motivo) {
  return { decisao: 'deny', motivo: `Merge autorizado em dev negado: ${motivo} (ADR 0048).` }
}

function problemaDosArquivos(pr) {
  if (!Array.isArray(pr.files) || !Number.isInteger(pr.changedFiles)) return 'a lista de arquivos do PR está ausente ou malformada'
  if (pr.files.length !== pr.changedFiles) return 'a lista de arquivos do PR veio truncada'
  if (pr.files.some((arquivo) => !arquivo || typeof arquivo.path !== 'string')) return 'a lista de arquivos do PR tem item malformado'
  if (pr.files.some((arquivo) => !MUDANCAS_ACEITAS_NO_ARQUIVO.has(arquivo.changeType))) return 'o PR renomeia ou copia arquivos, ou o changeType de algum arquivo é ausente ou desconhecido'
  for (const arquivo of pr.files) {
    const problema = problemaDoCaminho(arquivo.path)
    if (problema) return problema
  }
  return null
}

function problemaDoPR(pr, numero, sha) {
  if (pr.baseRefName === 'main') return 'merge em main é do humano (ADR 0034)'
  if (pr.baseRefName !== 'dev') return 'a base do PR não é dev'
  if (pr.state !== 'OPEN') return 'o PR não está aberto'
  if (pr.isDraft !== false) return 'o PR é rascunho ou o estado de rascunho é desconhecido'
  if (pr.isCrossRepository !== false) return 'o PR vem de outro repositório (fork) ou a origem é desconhecida'
  if (pr.url !== `${URL_DE_PR}${numero}`) return 'a URL do PR não é a do repositório da plataforma'
  if (pr.headRefOid !== sha) return 'o head do PR difere do sha do comando'
  if (pr.reviewDecision === 'CHANGES_REQUESTED') return 'o PR tem mudanças pedidas na revisão'
  if (pr.mergeable === 'CONFLICTING') return 'o PR tem conflito com a base'
  return problemaDosArquivos(pr) ?? problemaDoCI(pr.statusCheckRollup)
}

export function avaliarMergeEmDev(comando, consultarPR = consultarPRNoGitHub, modoDePermissao) {
  const texto = String(comando ?? '')
  if (!texto.startsWith(MARCADOR_MERGE_EM_DEV)) return null
  const forma = FORMA_MERGE_EM_DEV.exec(texto)
  if (!forma) return negarMerge(`o marcador só vale na forma exata "AUTORIZO_MERGE_EM_DEV=<n> gh pr merge <n> --repo ${REPOSITORIO_PR} --merge|--squash|--rebase --match-head-commit <sha40>", sem outras flags, encadeamento ou outro comando`)
  const [, numero, numeroDoMerge, sha] = forma
  if (numero !== numeroDoMerge) return negarMerge('o número do marcador difere do número do PR')
  try {
    return decidirMergeVerificado(consultarPR, numero, sha, modoDePermissao)
  } catch (erro) {
    return negarMerge(erro instanceof ErroDeConsulta ? erro.message : 'erro ao consultar ou avaliar o PR (fecha por padrão)')
  }
}

function decidirMergeVerificado(consultarPR, numero, sha, modoDePermissao) {
  const pr = consultarPR(numero)
  if (!pr || typeof pr !== 'object' || Array.isArray(pr)) return negarMerge('resposta do GitHub inválida (fecha por padrão)')
  const problema = problemaDoPR(pr, numero, sha)
  if (problema) return negarMerge(problema)
  const motivo = `Merge do PR ${numero} em dev verificado: base dev, aberto, pronto, head ${sha.slice(0, 7)}, sem mudança em workflows, checks obrigatórios e CI verdes (ADR 0048).`
  if (!MODOS_SEM_CONFIRMACAO.has(modoDePermissao)) return { decisao: 'ask', motivo: `${motivo} Confirme: neste modo o humano decide.` }
  return { decisao: 'allow', motivo }
}

export function avaliarComando(comando, modoDePermissao, consultarPR = consultarPRNoGitHub) {
  const original = String(comando ?? '')
  const mergeEmDev = avaliarMergeEmDev(original, consultarPR, modoDePermissao)
  if (mergeEmDev) return mergeEmDev
  const variantes = [original, normalizarComando(original)]
  let pergunta = null
  for (const texto of variantes) {
    for (const regra of REGRAS_DE_COMANDO) {
      if (!regra.padrao.test(texto)) continue
      if (regra.decisao === 'deny') return { decisao: 'deny', motivo: regra.motivo }
      if (!pergunta || (regra.producao && !pergunta.producao)) pergunta = regra
    }
  }
  if (!pergunta) return null
  if (pergunta.producao && MODOS_SEM_CONFIRMACAO.has(modoDePermissao)) {
    return { decisao: 'deny', motivo: `${pergunta.motivo} Neste modo de permissão não há confirmação humana, então a operação é negada.` }
  }
  return { decisao: pergunta.decisao, motivo: pergunta.motivo }
}

export function linhasComSegredo(texto) {
  const resultado = []
  String(texto ?? '').split('\n').forEach((linha, indice) => {
    const achados = detectarSegredo(linha)
    if (achados.length > 0) resultado.push({ linha: indice + 1, tipos: achados })
  })
  return resultado
}
