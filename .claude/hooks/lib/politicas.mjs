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

const ARQUIVO_SENSIVEL = /(^|[/])(\.env(\.(?!example$)[\w.-]+)?|[^/]*\.(pem|key|p12|pfx)|id_(rsa|ed25519|ecdsa)|credentials\.json|service-account[^/]*\.json)$/

export function arquivoSensivel(caminho) {
  return ARQUIVO_SENSIVEL.test(String(caminho ?? ''))
}

const GLOB_SENSIVEL = /(^|[/*])(\.env(?!\.example)|[^/]*\.(pem|key|p12|pfx)|id_(rsa|ed25519|ecdsa)|credentials|service-account)/

export function avaliarBusca({ caminho, glob }) {
  if (caminho && arquivoSensivel(caminho)) {
    return { decisao: 'deny', motivo: 'Busca em arquivo sensível: segredo nunca entra no contexto.' }
  }
  if (glob && GLOB_SENSIVEL.test(String(glob))) {
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
  if (existeVersionado && /(^|[/])db[/]migrations[/][^/]+\.sql$/.test(alvo)) {
    return { decisao: 'ask', motivo: 'Migração já versionada é imutável: o livro-razão pode ter aplicado a versão antiga. Crie uma migração nova, salvo exceção que o humano confirme.' }
  }
  return null
}

const REGRAS_DE_COMANDO = [
  { padrao: /\bcurl\b[^|;&]*\|\s*(sudo\s+)?(ba|z)?sh\b|\bwget\b[^|;&]*\|\s*(sudo\s+)?(ba|z)?sh\b/, decisao: 'deny', motivo: 'Baixar e executar script direto no shell é proibido. Baixe, leia e só então execute.' },
  { padrao: /\b(cat|less|more|head|tail|bat|nl|strings|xxd|od|sed|awk|grep|rg|cp|mv|ln|tar|zip|gzip|base64|openssl|python3?|node|perl|ruby|source|xargs|diff|jq|curl|wget|scp|rsync|tee|git\s+(?:show|diff|add))\b[^|;&]*(?<![\w-])(\.env(?!\.example)(\.[\w.-]+)?|[\w./-]*\.(pem|key|p12|pfx)|id_rsa|id_ed25519|credentials\.json)\b/, decisao: 'deny', motivo: 'Leitura de arquivo de segredo bloqueada. Nunca imprima valor de segredo.' },
  { padrao: /(?:^|[;&|(]\s*)(?:printenv|env|export\s+-p|set)\s*(?:$|[|;&])/, decisao: 'deny', motivo: 'Despejar o ambiente expõe segredos. Consulte uma variável específica pelo nome sem imprimir o valor.' },
  { padrao: /\becho\b[^|;&]*\$\{?\w*(TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|PRIVATE_?KEY)\w*/i, decisao: 'deny', motivo: 'Não imprima variável de segredo.' },
  { padrao: /\bgcloud\s+secrets\s+versions\s+access\b/, decisao: 'deny', motivo: 'Ler o valor de um segredo imprime o segredo. Crie versões por pipe sem eco e peça ao humano para conferir.' },
  { padrao: /(\brm\b|\bgcloud\s+storage\s+rm\b|\bgsutil\s+(-m\s+)?rm\b|\bgcloud\s+sql\s+backups\s+delete\b|\bDROP\b)[^;&|]*backup/i, decisao: 'deny', motivo: 'Backups do Postgres nunca são apagados.' },
  { padrao: /\brm\s+(?:-[a-z]*r[a-z]*|--recursive)(?:\s+-[a-z]+)*\s+(?:[/]\*?|~|\$HOME|\.git|\*)\s*(?:$|[;&|])/, decisao: 'deny', motivo: 'Remoção recursiva em raiz, HOME, .git ou curinga solto.' },
  { padrao: /\bgit\s+push\b[^;&|]*(\bmain\b|HEAD:main)/, decisao: 'deny', motivo: 'Push em main só pelo fluxo de release (docs/release/), executado pelo humano.' },
  { padrao: /\bbq-ddl\.mjs\b(?=[^;&|]*--prod)(?![^;&|]*--dry-run)/, decisao: 'deny', motivo: 'DDL em produção: rode com --dry-run e entregue o passo ao humano (ADR 0028).' },
  { padrao: /\bgh\s+(workflow\s+run|pr\s+merge|release\s+create)\b/, decisao: 'ask', motivo: 'Dispara workflow, merge ou release: ação externa que o humano confirma.' },
  { padrao: /\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f|checkout\s+--\s|checkout\s+\.|restore\s+\.|branch\s+-D|worktree\s+remove)/, decisao: 'ask', motivo: 'Pode descartar trabalho não commitado ou de outro agente.' },
  { padrao: /\bgit\s+(?:commit|push|merge|am|cherry-pick)\b[^;&|]*--no-verify|\bgit\s+commit\b[^;&|]*\s-n\b/, decisao: 'deny', motivo: 'Contornar os hooks de segurança do git é proibido. Corrija o achado ou registre a exceção na allowlist por PR.' },
  { padrao: /\bgit\s+(?:-c\s+core\.hooksPath\b|config\b(?![^;&|]*--(?:get|list))[^;&|]*core\.hooksPath\b(?![^;&|]*\.githooks))|\b(?:HUSKY|SKIP_SIMPLE_GIT_HOOKS)=0\b/, decisao: 'deny', motivo: 'Não desative nem troque os hooks do git do projeto (core.hooksPath deve ser .githooks).' },
  { padrao: /\bgit\s+push\b[^;&|]*(--force|\s-f\b)/, decisao: 'ask', motivo: 'Reescreve histórico remoto.' },
  { padrao: /\b(psql|docker\s+exec)\b[^;&|]*\b(DROP|TRUNCATE|DELETE\s+FROM)\b/i, decisao: 'ask', motivo: 'Comando destrutivo em banco: confirme o alvo e a necessidade.' },
]

export function avaliarComando(comando) {
  const texto = String(comando ?? '')
  for (const regra of REGRAS_DE_COMANDO) {
    if (regra.padrao.test(texto)) return { decisao: regra.decisao, motivo: regra.motivo }
  }
  return null
}

export function linhasComSegredo(texto) {
  const resultado = []
  String(texto ?? '').split('\n').forEach((linha, indice) => {
    const achados = detectarSegredo(linha)
    if (achados.length > 0) resultado.push({ linha: indice + 1, tipos: achados })
  })
  return resultado
}
