import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PASTAS_DE_CLIENTES = ['clientes', 'agencia'];
export const SAIDA_OK = 0;
export const SAIDA_DEFINITIVA = 1;
export const SAIDA_CONEXAO = 2;
export const PREFIXO_DA_PLATAFORMA = 'ORLA ·';
export const TAG_DA_PLATAFORMA = 'platform';
export const NOME_DO_MANIFESTO = 'clientes-manifesto.json';
const STATUS_DE_CONEXAO = [502, 503, 504];
const CHAVES_DE_CONFIGURACAO = [
  'executionOrder',
  'saveDataErrorExecution',
  'saveDataSuccessExecution',
  'saveManualExecutions',
  'saveExecutionProgress',
  'executionTimeout',
  'errorWorkflow',
  'timezone',
  'callerPolicy',
];

const USO = `uso: node scripts/n8n-aplicar-clientes.mjs [pasta-dos-workflows] [opções]

Aplica no n8n os fluxos de n8n/workflows/clientes/ e n8n/workflows/agencia/ (ADR 0009, adendo de 2026-11-24; ADR 0053).
Cada arquivo só é aplicado se constar no manifesto (n8n/${NOME_DO_MANIFESTO}, ou <pasta>/${NOME_DO_MANIFESTO}), que vincula o caminho do arquivo
ao id e ao nome do workflow. Arquivo fora do manifesto, id inexistente, nome divergente e workflow da plataforma
(tag platform ou nome começando por "${PREFIXO_DA_PLATAFORMA}") impedem a aplicação daquele arquivo.

opções:
  --aplicar              grava no n8n; sem ela, só mostra o que mudaria
  --backup-dir <dir>     obrigatório com --aplicar: guarda o JSON anterior de cada workflow antes do PUT
  --backup-dir-host <dir> caminho do mesmo diretório no host, só para as mensagens (padrão: o próprio --backup-dir)
  --manifesto <arquivo>  manifesto alternativo
  --propor-manifesto     só leitura: lista candidatos arquivo → id/nome por nome exato, sem gravar nada

Saída: 0 ok; 1 erro definitivo (não repetir; inclui qualquer falha depois de iniciado um PUT); 2 n8n indisponível
ou erro de rede antes de qualquer PUT, na listagem ou em GET (pode repetir).
Precisa de N8N_API_URL e N8N_API_KEY no ambiente.`;

export class ErroDeConexao extends Error {}

export function listarArquivos(raiz) {
  return PASTAS_DE_CLIENTES.flatMap((pasta) => {
    const base = join(raiz, pasta);
    try {
      statSync(base);
    } catch {
      return [];
    }
    const andar = (dir) =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entrada) => {
        const caminho = join(dir, entrada.name);
        if (entrada.isDirectory()) return andar(caminho);
        return entrada.name.endsWith('.json') ? [caminho] : [];
      });
    return andar(base).sort();
  });
}

export function configuracaoPermitida(settings = {}) {
  return Object.fromEntries(CHAVES_DE_CONFIGURACAO.filter((chave) => settings[chave] !== undefined).map((chave) => [chave, settings[chave]]));
}

const ehGatilhoDeWebhook = (no) => /webhook/i.test(no.type ?? '');

export function credenciaisDeExemplo(modelo) {
  return (modelo.nodes ?? []).flatMap((no) =>
    Object.values(no.credentials ?? {})
      .filter((credencial) => String(credencial?.id ?? '').startsWith('a-definir'))
      .map(() => no.name),
  );
}

export function mesclarComImplantado(modelo, atual) {
  const atuais = new Map((atual.nodes ?? []).map((no) => [no.name, no]));
  const nodes = (modelo.nodes ?? []).map((no) => {
    const implantado = atuais.get(no.name);
    if (no.webhookId || !implantado?.webhookId || ehGatilhoDeWebhook(no)) return no;
    return { ...no, webhookId: implantado.webhookId };
  });
  return { ...modelo, nodes };
}

function noComparavel(no) {
  return {
    name: no.name,
    type: no.type,
    typeVersion: no.typeVersion,
    parameters: no.parameters ?? {},
    credentials: no.credentials ?? {},
    disabled: Boolean(no.disabled),
    onError: no.onError ?? null,
    retryOnFail: Boolean(no.retryOnFail),
    maxTries: no.maxTries ?? null,
    waitBetweenTries: no.waitBetweenTries ?? null,
    alwaysOutputData: Boolean(no.alwaysOutputData),
    executeOnce: Boolean(no.executeOnce),
    webhookId: ehGatilhoDeWebhook(no) ? (no.webhookId ?? null) : null,
  };
}

function ordenado(valor) {
  if (Array.isArray(valor)) return valor.map(ordenado);
  if (valor && typeof valor === 'object') {
    return Object.fromEntries(Object.keys(valor).sort().map((chave) => [chave, ordenado(valor[chave])]));
  }
  return valor;
}

export function assinatura(workflow) {
  const nos = [...(workflow.nodes ?? [])].map(noComparavel).sort((a, b) => a.name.localeCompare(b.name));
  return JSON.stringify(ordenado({ nos, conexoes: workflow.connections ?? {}, configuracao: configuracaoPermitida(workflow.settings) }));
}

export const RETENCAO_DE_BACKUPS = 20;
const TIMEOUT_PADRAO_MS = 30000;

export function normalizarTexto(valor) {
  return String(valor ?? '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function ehDaPlataforma(workflow) {
  const nome = normalizarTexto(workflow?.name);
  const etiquetas = Array.isArray(workflow?.tags) ? workflow.tags : [];
  return nome.startsWith(normalizarTexto(PREFIXO_DA_PLATAFORMA)) || etiquetas.some((etiqueta) => normalizarTexto(etiqueta?.name ?? etiqueta) === TAG_DA_PLATAFORMA);
}

export function escolherImplantado(implantados, nome) {
  const candidatos = implantados.filter((w) => w.name === nome && !w.isArchived && !ehDaPlataforma(w));
  if (candidatos.length === 0) return { erro: 'ausente' };
  if (candidatos.length > 1) return { erro: 'repetido', ids: candidatos.map((w) => w.id) };
  return { workflow: candidatos[0] };
}

export function validarManifesto(bruto) {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) throw new Error('manifesto inválido: esperado um objeto { "arquivo": { "id", "nome" } }');
  const manifesto = new Map();
  const ids = new Set();
  for (const [arquivo, entrada] of Object.entries(bruto)) {
    const id = typeof entrada?.id === 'string' ? entrada.id.trim() : '';
    const nome = typeof entrada?.nome === 'string' ? entrada.nome : '';
    if (!id || !nome.trim()) throw new Error(`manifesto inválido: "${arquivo}" precisa de id e nome em texto não vazio`);
    if (ids.has(id)) throw new Error(`manifesto inválido: o id ${id} aparece em mais de um arquivo`);
    ids.add(id);
    manifesto.set(arquivo.split(sep).join('/'), { id, nome });
  }
  return manifesto;
}

export function lerManifesto(caminho, { opcional = false } = {}) {
  if (!existsSync(caminho)) {
    if (opcional) return new Map();
    throw new Error(`manifesto ausente: ${caminho}`);
  }
  let bruto;
  try {
    bruto = JSON.parse(readFileSync(caminho, 'utf8'));
  } catch (erro) {
    throw new Error(`manifesto ilegível (${caminho}): ${erro.message}`);
  }
  return validarManifesto(bruto);
}

export function caminhoDoManifesto(raiz, explicito) {
  if (explicito) return explicito;
  const candidatos = [join(raiz, NOME_DO_MANIFESTO), join(raiz, '..', NOME_DO_MANIFESTO)];
  return candidatos.find((caminho) => existsSync(caminho)) ?? candidatos[0];
}

export function copiaMaisRecente(diretorio, id) {
  if (!diretorio || !existsSync(diretorio)) return undefined;
  const idSeguro = String(id).replace(/[^A-Za-z0-9_-]/g, '_');
  const padrao = new RegExp(`^${idSeguro}-\\d{4}-\\d{2}-\\d{2}T[0-9-]+Z\\.json$`);
  const maisRecente = readdirSync(diretorio).filter((nome) => padrao.test(nome)).sort().pop();
  if (!maisRecente) return undefined;
  try {
    return JSON.parse(readFileSync(join(diretorio, maisRecente), 'utf8'));
  } catch {
    return undefined;
  }
}

export function planejar(modelo, entrada, implantado, ultimaCopia) {
  if (!entrada) return { acao: 'fora-do-manifesto', nome: modelo.name };
  if (ehDaPlataforma(modelo)) return { acao: 'alvo-da-plataforma', nome: modelo.name, id: entrada.id };
  const exemplos = credenciaisDeExemplo(modelo);
  if (exemplos.length) return { acao: 'credencial-de-exemplo', nome: modelo.name, nos: exemplos };
  if (!implantado) return { acao: 'id-inexistente', nome: modelo.name, id: entrada.id };
  if (!Array.isArray(implantado.tags)) return { acao: 'tags-ausentes', nome: modelo.name, id: entrada.id };
  if (ehDaPlataforma(implantado)) return { acao: 'alvo-da-plataforma', nome: modelo.name, id: entrada.id };
  if (implantado.name !== entrada.nome || modelo.name !== entrada.nome) {
    return { acao: 'nome-divergente', nome: modelo.name, id: entrada.id, esperado: entrada.nome, implantado: implantado.name };
  }
  if (ultimaCopia?.active === true && !implantado.active) return { acao: 'desligado-apos-falha', nome: modelo.name, id: entrada.id };
  if (assinatura(implantado) === assinatura(modelo)) return { acao: 'igual', nome: modelo.name, id: implantado.id };
  return { acao: 'atualizar', nome: modelo.name, id: implantado.id, ativo: Boolean(implantado.active) };
}

function criarApi(url, chave, timeoutMs = TIMEOUT_PADRAO_MS) {
  const base = url.replace(/\/$/, '');
  return async (metodo, caminho, corpo, { aceitar404 = false } = {}) => {
    let resposta;
    let texto;
    try {
      resposta = await fetch(`${base}/api/v1${caminho}`, {
        method: metodo,
        headers: { 'X-N8N-API-KEY': chave, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: corpo ? JSON.stringify(corpo) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
      texto = await resposta.text();
    } catch (erro) {
      throw new ErroDeConexao(`${metodo} ${caminho}: ${erro?.cause?.code ?? erro?.name ?? 'falha de rede'}`);
    }
    if (aceitar404 && resposta.status === 404) return null;
    if (STATUS_DE_CONEXAO.includes(resposta.status)) throw new ErroDeConexao(`${metodo} ${caminho}: HTTP ${resposta.status}`);
    if (!resposta.ok) throw new Error(`${metodo} ${caminho}: HTTP ${resposta.status} ${texto.slice(0, 300)}`);
    return texto ? JSON.parse(texto) : {};
  };
}

async function listarImplantados(api) {
  const todos = [];
  let cursor;
  do {
    const pagina = await api('GET', `/workflows?limit=250${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    todos.push(...(pagina.data ?? []));
    cursor = pagina.nextCursor;
  } while (cursor);
  return todos;
}

export function conteudoDoBackup(workflow) {
  return {
    name: workflow.name,
    nodes: workflow.nodes ?? [],
    connections: workflow.connections ?? {},
    settings: workflow.settings ?? {},
    active: Boolean(workflow.active),
  };
}

function expurgarBackupsAntigos(diretorio, idSeguro) {
  const padrao = new RegExp(`^${idSeguro}-\\d{4}-\\d{2}-\\d{2}T[0-9-]+Z\\.json$`);
  const arquivos = readdirSync(diretorio).filter((nome) => padrao.test(nome)).sort();
  const [maisAntigo, ...demais] = arquivos;
  if (!maisAntigo) return;
  for (const nome of demais.slice(0, Math.max(0, demais.length - RETENCAO_DE_BACKUPS))) unlinkSync(join(diretorio, nome));
}

export function gravarBackup(diretorio, atual, agora = new Date()) {
  mkdirSync(diretorio, { recursive: true, mode: 0o700 });
  chmodSync(diretorio, 0o700);
  const idSeguro = String(atual.id).replace(/[^A-Za-z0-9_-]/g, '_');
  const carimbo = agora.toISOString().replace(/[:.]/g, '-');
  const caminho = join(diretorio, `${idSeguro}-${carimbo}.json`);
  writeFileSync(caminho, JSON.stringify(conteudoDoBackup(atual)), { mode: 0o600, flag: 'wx' });
  chmodSync(caminho, 0o600);
  expurgarBackupsAntigos(diretorio, idSeguro);
  return caminho;
}

const corpoDoPut = (workflow) => ({
  name: workflow.name,
  nodes: workflow.nodes,
  connections: workflow.connections,
  settings: configuracaoPermitida(workflow.settings),
});

const assinaturaCompleta = (workflow) => JSON.stringify([workflow.name, assinatura(workflow)]);

export function interpretarArgumentos(argumentos) {
  const opcoes = { aplicar: false, proporManifesto: false, backupDir: undefined, backupDirHost: undefined, manifesto: undefined, raiz: undefined, ajuda: false };
  for (let i = 0; i < argumentos.length; i += 1) {
    const a = argumentos[i];
    if (['--help', '-h', '--ajuda'].includes(a)) opcoes.ajuda = true;
    else if (a === '--aplicar') opcoes.aplicar = true;
    else if (a === '--propor-manifesto') opcoes.proporManifesto = true;
    else if (a === '--backup-dir' || a === '--backup-dir-host' || a === '--manifesto') {
      const valor = argumentos[i + 1];
      if (!valor || valor.startsWith('--')) throw new Error(`${a} exige um valor`);
      if (a === '--backup-dir') opcoes.backupDir = valor;
      else if (a === '--backup-dir-host') opcoes.backupDirHost = valor;
      else opcoes.manifesto = valor;
      i += 1;
    } else if (a.startsWith('--')) throw new Error(`opção desconhecida: ${a}`);
    else if (opcoes.raiz === undefined) opcoes.raiz = a;
    else throw new Error(`argumento inesperado: ${a}`);
  }
  return opcoes;
}

async function proporManifesto(api, raiz, manifesto, saida) {
  const implantados = await listarImplantados(api);
  for (const arquivo of listarArquivos(raiz)) {
    const chave = relative(raiz, arquivo).split(sep).join('/');
    if (manifesto.has(chave)) continue;
    let modelo;
    try {
      modelo = JSON.parse(readFileSync(arquivo, 'utf8'));
    } catch {
      saida.error(`ERRO ${chave}: JSON ilegível`);
      continue;
    }
    const escolha = escolherImplantado(implantados, modelo.name);
    if (escolha.erro === 'ausente') saida.log(`${chave} → sem candidato por nome exato "${modelo.name}"`);
    else if (escolha.erro === 'repetido') saida.log(`${chave} → ambíguo "${modelo.name}": ids ${escolha.ids.join(', ')}`);
    else saida.log(`${chave} → id ${escolha.workflow.id} nome "${escolha.workflow.name}"`);
  }
  return SAIDA_OK;
}

const marcarPendente = (saida, id, motivo) => saida.error(`estado-pendente: ${id} ${motivo}`);

function mudouDesde(antes, depois) {
  return assinaturaCompleta(antes) !== assinaturaCompleta(depois);
}

function conferir(depois, { ativo, assinaturaEsperada }) {
  if (Boolean(depois.active) !== ativo) return { ok: false, motivo: `estado ativo esperado ${ativo}, encontrado ${Boolean(depois.active)}` };
  if (assinaturaCompleta(depois) !== assinaturaEsperada) return { ok: false, motivo: 'o conteúdo implantado difere do esperado' };
  const publicacao = ativo && Boolean(depois.versionId && depois.activeVersionId);
  if (publicacao && depois.versionId !== depois.activeVersionId) return { ok: false, motivo: 'versionId e activeVersionId diferem: a versão publicada não é a gravada' };
  return { ok: true, publicacao };
}

const descreverConferencia = (conferencia) => (conferencia.publicacao ? 'conteúdo e versão publicada conferidos' : 'conteúdo conferido; versão publicada não verificada');

async function ciclarAtivacao(api, caminho, rotulo, saida) {
  for (const acao of ['deactivate', 'activate']) {
    try {
      await api('POST', `${caminho}/${acao}`);
    } catch (erro) {
      saida.error(`aviso ${rotulo}: POST ${acao} respondeu erro (${erro.message})`);
    }
  }
}

async function aplicarArquivo({ api, plano, modelo, rotulo, backupDir, backupDirHost, saida }) {
  const atual = await api('GET', `/workflows/${plano.id}`);
  let backup;
  try {
    backup = gravarBackup(backupDir, atual);
  } catch (erro) {
    saida.error(`ERRO ${rotulo}: backup não gravado (${erro.message}); nada foi alterado`);
    return SAIDA_DEFINITIVA;
  }
  const noHost = join(backupDirHost, basename(backup));
  const antes = conteudoDoBackup(atual);
  const estavaAtivo = antes.active;
  const final = mesclarComImplantado(modelo, atual);
  const esperado = assinaturaCompleta(final);
  const caminho = `/workflows/${plano.id}`;
  const aviso = estavaAtivo ? 'o gatilho pode ter ficado fora do ar; ' : '';

  const restaurar = async ({ reescrever }) => {
    if (reescrever) {
      try {
        await api('PUT', caminho, corpoDoPut(antes));
      } catch (erro) {
        saida.error(`aviso ${rotulo}: PUT de restauração respondeu erro (${erro.message}); conferindo o estado`);
      }
    }
    if (estavaAtivo) await ciclarAtivacao(api, caminho, rotulo, saida);
    let depois;
    try {
      depois = await api('GET', caminho);
      const conferencia = conferir(depois, { ativo: estavaAtivo, assinaturaEsperada: assinaturaCompleta(antes) });
      if (conferencia.ok) {
        const situacao = reescrever ? 'restaurado' : 'conteúdo original mantido em';
        const ciclo = estavaAtivo ? '; gatilho desativado e reativado' : '';
        saida.error(`${situacao} ${rotulo} (${plano.id}) a partir de ${noHost}${ciclo}; ${descreverConferencia(conferencia)}`);
        return;
      }
      saida.error(`aviso ${rotulo}: conferência da restauração falhou (${conferencia.motivo})`);
    } catch (erro) {
      saida.error(`aviso ${rotulo}: conferência da restauração falhou (${erro.message})`);
    }
    if (estavaAtivo && depois && !depois.active && assinaturaCompleta(depois) === assinaturaCompleta(antes)) {
      saida.error(`ERRO ${rotulo}: gatilho DESLIGADO; conteúdo íntegro; rode só POST /api/v1/workflows/${plano.id}/activate (cópia anterior em ${noHost})`);
      marcarPendente(saida, plano.id, 'gatilho-desligado-conteudo-integro');
      return;
    }
    saida.error(`ERRO ${rotulo}: restauração não confirmada; ${aviso}restaurar à mão a partir de ${noHost} (docs/n8n-clientes-manifesto.md)`);
    marcarPendente(saida, plano.id, 'restauracao-nao-confirmada');
  };

  try {
    await api('PUT', caminho, corpoDoPut(final));
  } catch (erro) {
    const porConexao = erro instanceof ErroDeConexao ? '; falha de conexão, o estado no n8n é desconhecido' : '';
    saida.error(`ERRO ${rotulo}: PUT falhou (${erro.message})${porConexao}; ${aviso}conferindo o estado`);
    let vigente;
    try {
      vigente = await api('GET', caminho);
    } catch (erroDoGet) {
      saida.error(`ERRO ${rotulo}: não foi possível ler o workflow depois da falha (${erroDoGet.message}); ${aviso}nada foi restaurado; restaurar à mão a partir de ${noHost} (docs/n8n-clientes-manifesto.md)`);
      marcarPendente(saida, plano.id, 'estado-desconhecido-apos-falha-de-put');
      return SAIDA_DEFINITIVA;
    }
    const alterado = mudouDesde(antes, vigente);
    if (alterado || estavaAtivo) await restaurar({ reescrever: alterado });
    return SAIDA_DEFINITIVA;
  }

  let conferencia;
  try {
    if (estavaAtivo) await api('POST', `${caminho}/activate`);
    conferencia = conferir(await api('GET', caminho), { ativo: estavaAtivo, assinaturaEsperada: esperado });
    if (!conferencia.ok) throw new Error(conferencia.motivo);
  } catch (erro) {
    saida.error(`ERRO ${rotulo}: conferência após aplicar falhou (${erro.message}); ${aviso}restaurando o JSON anterior`);
    await restaurar({ reescrever: true });
    return SAIDA_DEFINITIVA;
  }
  saida.log(`atualizado ${rotulo} (${plano.id})${estavaAtivo ? ', reativado' : ''}; ${descreverConferencia(conferencia)}; cópia anterior ${noHost}`);
  return SAIDA_OK;
}

const MENSAGENS_DE_RECUSA = {
  'fora-do-manifesto': () => 'arquivo fora do manifesto (rode --propor-manifesto e revise)',
  'alvo-da-plataforma': (p) => `alvo é workflow da plataforma (tag ${TAG_DA_PLATAFORMA} ou nome "${PREFIXO_DA_PLATAFORMA}…"), id ${p.id}`,
  'tags-ausentes': (p) => `o n8n não devolveu as tags do workflow ${p.id}; não dá para provar que não é da plataforma`,
  'desligado-apos-falha': (p) => `a cópia anterior mais recente do id ${p.id} diz ativo, mas o workflow está inativo: possível gatilho desligado por falha anterior; confira o fluxo no n8n, corrija e mova a cópia antes de repetir`,
  'id-inexistente': (p) => `não existe workflow com o id ${p.id}`,
  'nome-divergente': (p) => `nome divergente (manifesto "${p.esperado}", implantado "${p.implantado}", arquivo "${p.nome}")`,
  'credencial-de-exemplo': (p) => `credencial de exemplo (a-definir…) em ${p.nos.join(', ')}`,
};

export async function executar(argumentos, ambiente = process.env, saida = console) {
  let opcoes;
  try {
    opcoes = interpretarArgumentos(argumentos);
  } catch (erro) {
    saida.error(erro.message);
    return SAIDA_DEFINITIVA;
  }
  if (opcoes.ajuda) {
    saida.log(USO);
    return SAIDA_OK;
  }
  if (opcoes.aplicar && opcoes.proporManifesto) {
    saida.error('--aplicar e --propor-manifesto não combinam');
    return SAIDA_DEFINITIVA;
  }
  if (opcoes.aplicar && !opcoes.backupDir) {
    saida.error('--aplicar exige --backup-dir <dir>; nada foi alterado');
    return SAIDA_DEFINITIVA;
  }
  const raiz = opcoes.raiz ?? 'n8n/workflows';
  const { N8N_API_URL, N8N_API_KEY } = ambiente;
  if (!N8N_API_URL || !N8N_API_KEY) {
    saida.error('Defina N8N_API_URL e N8N_API_KEY no ambiente.');
    return SAIDA_DEFINITIVA;
  }
  let manifesto;
  try {
    manifesto = lerManifesto(caminhoDoManifesto(raiz, opcoes.manifesto), { opcional: opcoes.proporManifesto });
  } catch (erro) {
    saida.error(erro.message);
    return SAIDA_DEFINITIVA;
  }
  const limite = Number.parseInt(ambiente.N8N_API_TIMEOUT_MS ?? '', 10);
  const api = criarApi(N8N_API_URL, N8N_API_KEY, limite > 0 ? limite : TIMEOUT_PADRAO_MS);
  if (opcoes.proporManifesto) {
    try {
      return await proporManifesto(api, raiz, manifesto, saida);
    } catch (erro) {
      saida.error(erro.message);
      return erro instanceof ErroDeConexao ? SAIDA_CONEXAO : SAIDA_DEFINITIVA;
    }
  }
  let definitivas = 0;
  let conexao = 0;
  for (const arquivo of listarArquivos(raiz)) {
    const chave = relative(raiz, arquivo).split(sep).join('/');
    let modelo;
    try {
      modelo = JSON.parse(readFileSync(arquivo, 'utf8'));
    } catch {
      saida.error(`ERRO ${chave}: JSON ilegível`);
      definitivas += 1;
      continue;
    }
    const entrada = manifesto.get(chave);
    const rotulo = `${chave} → "${modelo.name}"`;
    try {
      const implantado = entrada ? await api('GET', `/workflows/${encodeURIComponent(entrada.id)}`, undefined, { aceitar404: true }) : undefined;
      const plano = planejar(modelo, entrada, implantado ?? undefined, entrada ? copiaMaisRecente(opcoes.backupDir, entrada.id) : undefined);
      if (MENSAGENS_DE_RECUSA[plano.acao]) {
        saida.error(`ERRO ${rotulo}: ${MENSAGENS_DE_RECUSA[plano.acao](plano)}`);
        definitivas += 1;
      } else if (plano.acao === 'igual') {
        saida.log(`igual ${rotulo} (${plano.id})`);
      } else if (!opcoes.aplicar) {
        saida.log(`atualizaria ${rotulo} (${plano.id})`);
      } else if ((await aplicarArquivo({ api, plano, modelo, rotulo, backupDir: opcoes.backupDir, backupDirHost: opcoes.backupDirHost ?? opcoes.backupDir, saida })) !== SAIDA_OK) {
        definitivas += 1;
      }
    } catch (erro) {
      saida.error(`ERRO ${rotulo}: ${erro.message}`);
      if (erro instanceof ErroDeConexao) conexao += 1;
      else definitivas += 1;
    }
  }
  if (definitivas) return SAIDA_DEFINITIVA;
  return conexao ? SAIDA_CONEXAO : SAIDA_OK;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  executar(process.argv.slice(2)).then(
    (codigo) => process.exit(codigo),
    (erro) => {
      console.error(erro.message);
      process.exit(erro instanceof ErroDeConexao ? SAIDA_CONEXAO : SAIDA_DEFINITIVA);
    },
  );
}
