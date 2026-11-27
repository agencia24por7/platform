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


export function avaliarEscrita({ caminho, conteudo, existeVersionado }) {
  const alvo = String(caminho ?? '')
  if (arquivoSensivel(alvo)) return { decisao: 'deny', motivo: 'Não grave em arquivo de segredo (.env, chave, credencial). Segredo é criado pelo humano ou por pipe sem eco.' }
  if (/(^|[/])(node_modules|\.next)[/]/.test(alvo)) return { decisao: 'deny', motivo: 'Diretório gerado: não edite à mão.' }
  if (/(^|[/])package-lock\.json$/.test(alvo)) return { decisao: 'deny', motivo: 'O lockfile só muda pelo npm (npm install / npm ci).' }
  const achados = detectarSegredo(conteudo)
  if (achados.length > 0) return { decisao: 'deny', motivo: `Conteúdo com aparência de segredo (${achados.join(', ')}). Use variável de ambiente ou Secret Manager; nunca o valor no código.` }
  if (/(^|[/])(?:\.claude[/]hooks[/]|\.claude[/]settings[^/]*\.json$|\.claude\.json$|claude-profiles[/][^/]+[/]home[/](?:settings[^/]*\.json|CLAUDE\.md)$)/i.test(alvo.replace(/\\/g, '/').replace(/[/](?:[.][/])+/g, '/').replace(/[/]{2,}/g, '/'))) {
    return { decisao: 'ask', motivo: 'Editar a guarda ou os settings do Claude Code muda o que protege a sessão: confirme a edição.' }
  }
  if (/disableAllHooks/.test(String(conteudo ?? ''))) {
    return { decisao: 'ask', motivo: 'Desligar os hooks do Claude Code remove a guarda: confirme.' }
  }
  if (existeVersionado && /(^|[/])db[/]migrations[/][^/]+\.sql$/.test(alvo)) {
    return { decisao: 'ask', motivo: 'Migração já versionada é imutável: o livro-razão pode ter aplicado a versão antiga. Crie uma migração nova, salvo exceção que o humano confirme.' }
  }
  return null
}

const COMPRIMENTO_MAXIMO_DO_COMANDO = 30_000

const REGRAS_DE_COMANDO = [
  { padrao: /\bcurl\b[^|;&]*\|\s*(sudo\s+)?(ba|z)?sh\b|\bwget\b[^|;&]*\|\s*(sudo\s+)?(ba|z)?sh\b/, decisao: 'deny', motivo: 'Baixar e executar script direto no shell é proibido. Baixe, leia e só então execute.' },
  { padrao: /\b(cat|less|more|head|tail|bat|nl|cut|sort|uniq|vim?|nano|tr|wc|column|paste|fold|rev|tac|while|read|strings|xxd|od|sed|awk|grep|rg|cp|mv|ln|tar|zip|gzip|base64|openssl|python3?|node|perl|ruby|source|xargs|diff|jq|curl|wget|scp|rsync|tee|git\s+(?:show|diff|add))\b[^|;&]*(?<![\w-])(\.env(?!\.example)(\.[\w.-]+)?|[\w./-]*\.(pem|key|p12|pfx)|id_rsa|id_ed25519|credentials\.json)\b/i, decisao: 'deny', motivo: 'Leitura de arquivo de segredo bloqueada. Nunca imprima valor de segredo.' },
  { padrao: /<\s*["']?[^\s|;&<>]*(?:\.env(?!\.example)(?:\.[\w.-]+)?|\.(?:pem|key|p12|pfx)|id_rsa|id_ed25519|credentials\.json)\b/i, decisao: 'deny', motivo: 'Redirecionar arquivo de segredo para um comando o expõe. Nunca imprima valor de segredo.' },
  { padrao: /(?:^|[;&|\n]|\bsudo\s)\s*(?:printenv|env(?:\s+-\S+)*|export(?:\s+-p)?|declare\s+-x|set)\s*(?:$|[|;&\n>])/, decisao: 'deny', motivo: 'Despejar o ambiente expõe segredos. Consulte uma variável específica pelo nome sem imprimir o valor.' },
  { padrao: /(?:\bexec(?:\s+\S+){1,4}?\s+|--command[=\s]+|\s--\s+)["']?(?:printenv|env(?:\s+-\S+)*|export(?:\s+-p)?|declare\s+-x)\s*(?:$|[|;&\n>'"])/, decisao: 'deny', motivo: 'Despejar o ambiente de outra máquina ou contêiner expõe segredos. Consulte uma variável específica sem imprimir o valor.' },
  { padrao: /\bprintenv\s+\S*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|PRIVATE_?KEY|DATABASE_URL)/i, decisao: 'deny', motivo: 'Imprimir variável de segredo expõe o valor.' },
  { padrao: /\bnode\b[^;&|\n]*process\.env(?![.[\w])/, decisao: 'deny', motivo: 'Despejar process.env expõe segredos. Leia uma variável específica pelo nome sem imprimir o valor.' },
  { padrao: /\bnode\b[^;&|\n]*\s-p\b[^;&|\n]*process\.env/, decisao: 'deny', motivo: 'node -p imprime o valor da variável de ambiente.' },
  { padrao: /\/proc\/[\w$*]*\/environ|\bpython3?\b[^\n]*\s-c\b[^\n]*os\.environ|\bdocker\s+inspect\b[^;&|\n]*\bEnv\b/, decisao: 'deny', motivo: 'Ler o ambiente de um processo ou contêiner expõe segredos.' },
  { padrao: /\b(?:echo|printf|print)\b[^|;&]*\$\{?\w*(TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|PRIVATE_?KEY|DATABASE_URL)\w*/i, decisao: 'deny', motivo: 'Não imprima variável de segredo.' },
  { padrao: /(\brm\b|\bgcloud\s+storage\s+rm\b|\bgsutil\s+(-m\s+)?rm\b|\bgcloud\s+sql\s+backups\s+delete\b|\bDROP\b)[^;&|]*backup/i, decisao: 'deny', motivo: 'Backups do Postgres nunca são apagados.' },
  { padrao: /\bgcloud\s+storage\s+buckets\s+(?:update|delete)\b[^;&|\n]*backup/i, decisao: 'deny', motivo: 'Mudar ou apagar o bucket de backups (inclusive por regra de ciclo de vida) é proibido.' },
  { padrao: /\bgsutil\s+(?:lifecycle|retention|versioning|rm)\b[^;&|\n]*backup/i, decisao: 'deny', motivo: 'Mudar ou apagar o bucket de backups (inclusive por regra de ciclo de vida) é proibido.' },
  { padrao: /\brm\s+(?:-[a-z]*r[a-z]*|--recursive)(?:\s+-[a-z]+)*\s+(?:[/]\*?|~|\$HOME|\.git|\*)\s*(?:$|[;&|])/, decisao: 'deny', motivo: 'Remoção recursiva em raiz, HOME, .git ou curinga solto.' },
  { padrao: /\bgcloud\b(?=[^;&|\n]*\bsecrets\b)(?=[^;&|\n]*\bversions\b)(?=[^;&|\n]*\baccess\b)/, decisao: 'deny', motivo: 'Ler o valor de um segredo direto no comando imprime o segredo no contexto. Use um script do projeto que o leia sem eco.' },
  { padrao: /\bgh\s+pr\s+merge\b[^;&|\n]*--admin\b/, decisao: 'deny', motivo: 'Merge com --admin passa por cima do CI e das regras do repositório (ADR 0069, item 6).' },
  { padrao: /\bgit\b(?:\s+-[cC]\s+\S+)*\s+push\b[^;&|]*(?:[\s:+](?:refs\/heads\/)?main(?=\s|$|["'])|--all\b|--mirror\b)/, decisao: 'deny', motivo: 'Push direto em main não passa pelo CI: use PR e gh pr merge.' },
  { padrao: /^(?=[\s\S]*\bgit\b(?:\s+-[cC]\s+\S+)*\s+(?:checkout|switch)\s+(?:-\S+\s+)*main\b)(?=[\s\S]*\bgit\b(?:\s+-[cC]\s+\S+)*\s+push\b)/, decisao: 'deny', motivo: 'Trocar para main e dar push no mesmo comando é push direto em main: use PR e gh pr merge.' },
  { padrao: /\bgcloud\s+sql\s+(backups\s+delete|instances\s+delete)\b/, decisao: 'deny', motivo: 'Apagar backup ou instância do Postgres é proibido.' },
  { padrao: /(?:(?<![-=])>>?(?!&)|\btee\b|\bsed\s+(?:-[a-zA-Z]*i|--in-place)|\bperl\s+-[a-zA-Z]*i|\b(?:cp|mv|rm|ln|install|chmod|truncate|dd)\b)[^;&|\n]*\.claude[/\\](?:hooks|settings[^/\s]*\.json)/i, decisao: 'ask', motivo: 'Alterar a guarda ou os settings do Claude Code por shell muda o que protege a sessão: confirme a edição.' },
  { padrao: /\bgit\b[^;&|\n]*\b(?:checkout|restore|apply|reset|stash|rm|mv)\b[^;&|\n]*\.claude[/\\](?:hooks|settings)/i, decisao: 'ask', motivo: 'Restaurar ou reescrever a guarda ou os settings do Claude Code pelo git muda o que protege a sessão: confirme.' },
  { padrao: /\b(?:rm|mv)\b[^;&|\n]*[\s"'/]\.claude[/\\]?["']?(?:\s|$)/i, decisao: 'ask', motivo: 'Apagar ou mover a pasta .claude remove a guarda: confirme.' },
  { padrao: /\.claude(?:[/\\][^\s;&|]*)?["']?\s*(?:&&|;)\s*(?:rm|mv|cp|sed|tee|find|echo|printf|dd)\b/i, decisao: 'ask', motivo: 'Entrar em .claude e alterar arquivos muda a guarda: confirme.' },
  { padrao: /\bfind\b[^;&|\n]*\.claude[^;&|\n]*(?:-delete|-exec)/i, decisao: 'ask', motivo: 'Apagar ou executar sobre arquivos de .claude muda a guarda: confirme.' },
  { padrao: /(?:>|\btee\b|\bcp\b|\bmv\b|\brm\b|\bsed\s+-i|\bln\b)[^;&|\n]*(?:claude-profiles|CLAUDE_CONFIG_DIR|\.claude\.json)/i, decisao: 'ask', motivo: 'Alterar a configuração do Claude Code do usuário pode desligar a guarda: confirme.' },
  { padrao: /disableAllHooks/, decisao: 'ask', motivo: 'Desligar os hooks do Claude Code remove a guarda: confirme.' },
  { padrao: /\bterraform\b[^;&|\n]*(?:\bdestroy\b|-destroy\b)/, decisao: 'ask', motivo: 'Destruir recurso é irreversível: confirme o alvo, o plan e a reversão (ADR 0069, item 7).' },
  { padrao: /\bautorizar_corte\b\]?["']?\s*[=:]\s*["']?true|\bRELEASE_CORTE_AUTORIZADO\b/i, decisao: 'ask', motivo: 'IRREVERSÍVEL: o corte roda migração destrutiva sem volta. Confirme depois do pre-flight verde e do backup (ADR 0034, ADR 0069, item 7).' },
  { padrao: /\bgh\s+api\b(?=[^;&|\n]*(?:git\/refs\/heads\/main|\/rulesets\b|branches\/[^\s/]+\/protection))(?=[^;&|\n]*(?:\s-[XfF]\b|--method|--field|--raw-field|--input))/, decisao: 'ask', motivo: 'Mudar a branch main, os rulesets ou a proteção de branch pela API tira o controle do repositório: confirme.' },
  { padrao: /\bbq\b(?:\s+-\S*)*\s+rm\b|\bbq\b[^;&|\n]*\b(?:mk\b[^;&|\n]*--force|load\b[^;&|\n]*--replace)/, decisao: 'ask', motivo: 'Apagar ou sobrescrever tabela no BigQuery é irreversível: confirme o alvo (ADR 0069, item 7).' },
  { padrao: /^(?=[\s\S]*\bbq\b)(?=[\s\S]*\b(?:DROP|TRUNCATE|DELETE\s+FROM|CREATE\s+OR\s+REPLACE)\b)/i, decisao: 'ask', motivo: 'SQL destrutivo ou que sobrescreve no BigQuery: confirme o alvo e a necessidade (ADR 0069, item 7). Falso positivo é aceito.' },
  { padrao: /\bgcloud\b(?=[^;&|\n]*\bsecrets\b)(?=[^;&|\n]*\b(?:delete|destroy|disable)\b)/, decisao: 'ask', motivo: 'Apagar ou desativar segredo não tem volta: confirme o segredo e a versão (ADR 0069, item 7).' },
  { padrao: /\bgcloud\s+(?:sql\s+databases|compute\s+(?:instances|disks)|projects|container\s+clusters)\s+delete\b|\bgcloud\s+storage\s+rm\b/, decisao: 'ask', motivo: 'Apagar recurso ou dado em produção é irreversível: confirme o alvo (ADR 0069, item 7).' },
  { padrao: /\bgcloud\s+kms\s+keys\s+(versions\s+(destroy|disable)|update)\b/, decisao: 'ask', motivo: 'Desativar ou destruir versão de chave KMS não tem volta: confirme a chave e a recifragem com avaliadas = 0 e falhas = 0 (ADR 0042).' },
  { padrao: /\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f|checkout\s+--\s|checkout\s+\.|restore\s+\.|branch\s+-D|worktree\s+remove)/, decisao: 'ask', motivo: 'Pode descartar trabalho não commitado ou de outro agente.' },
  { padrao: /\bgit\b(?:\s+-[cC]\s+\S+)*\s+push\b[^;&|]*(--force|\s-f\b)/, decisao: 'ask', motivo: 'Reescreve histórico remoto.' },
  { padrao: /\b(psql|docker\s+exec)\b[^;&|]*\b(DROP|TRUNCATE|DELETE\s+FROM)\b/i, decisao: 'ask', motivo: 'Comando destrutivo em banco: confirme o alvo e a necessidade.' },
]

function normalizarComando(texto) {
  return texto
    .replace(/\\\r?\n/g, ' ')
    .replace(/(^|\s)#[^\n]*/g, '$1')
    .replace(/\s--(?:project|account|impersonate-service-account|configuration|billing-project|format|quiet|verbosity)(?:=|\s+)\S+/g, ' ')
    .replace(/\s(?:--quiet|-q)\b/g, ' ')
    .replace(/\bgcloud\s+(?:alpha|beta)\b/g, 'gcloud')
    .replace(/\/(?:\.\/)+/g, '/')
    .replace(/\/{2,}/g, '/')
}

function avaliarTrecho(texto) {
  let pergunta = null
  for (const variante of [texto, normalizarComando(texto)]) {
    for (const regra of REGRAS_DE_COMANDO) {
      if (!regra.padrao.test(variante)) continue
      if (regra.decisao === 'deny') return { decisao: 'deny', motivo: regra.motivo }
      pergunta ??= regra
    }
  }
  return pergunta ? { decisao: pergunta.decisao, motivo: pergunta.motivo } : null
}

export function avaliarComando(comando) {
  const original = String(comando ?? '')
  if (original.length > COMPRIMENTO_MAXIMO_DO_COMANDO) {
    return { decisao: 'deny', motivo: `Comando com mais de ${COMPRIMENTO_MAXIMO_DO_COMANDO} caracteres não pode ser avaliado com segurança pela guarda. Grave o conteúdo com a ferramenta de escrita e rode um comando curto.` }
  }
  return avaliarTrecho(original)
}

export function linhasComSegredo(texto) {
  const resultado = []
  String(texto ?? '').split('\n').forEach((linha, indice) => {
    const achados = detectarSegredo(linha)
    if (achados.length > 0) resultado.push({ linha: indice + 1, tipos: achados })
  })
  return resultado
}
