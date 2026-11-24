import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PASTAS_DE_CLIENTES = ['clientes', 'agencia'];
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

const USO = `uso: node scripts/n8n-aplicar-clientes.mjs [pasta-dos-workflows] [--aplicar]

Aplica no n8n os fluxos de n8n/workflows/clientes/ e n8n/workflows/agencia/ (ADR 0009, adendo de 2026-11-24).
Cada arquivo é casado com o workflow implantado de mesmo nome; nome ausente ou repetido para a aplicação
daquele arquivo. Sem --aplicar, só mostra o que mudaria. Workflow ativo continua ativo.
Precisa de N8N_API_URL e N8N_API_KEY no ambiente.`;

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

export function escolherImplantado(implantados, nome) {
  const candidatos = implantados.filter((w) => w.name === nome && !w.isArchived);
  if (candidatos.length === 0) return { erro: 'ausente' };
  if (candidatos.length > 1) return { erro: 'repetido', ids: candidatos.map((w) => w.id) };
  return { workflow: candidatos[0] };
}

export function planejar(modelo, implantados) {
  const exemplos = credenciaisDeExemplo(modelo);
  if (exemplos.length) return { acao: 'credencial-de-exemplo', nome: modelo.name, nos: exemplos };
  const escolha = escolherImplantado(implantados, modelo.name);
  if (escolha.erro) return { acao: escolha.erro, nome: modelo.name, ids: escolha.ids };
  const atual = escolha.workflow;
  if (assinatura(atual) === assinatura(modelo)) return { acao: 'igual', nome: modelo.name, id: atual.id };
  return { acao: 'atualizar', nome: modelo.name, id: atual.id, ativo: Boolean(atual.active) };
}

function criarApi(url, chave) {
  const base = url.replace(/\/$/, '');
  return async (metodo, caminho, corpo) => {
    const resposta = await fetch(`${base}/api/v1${caminho}`, {
      method: metodo,
      headers: { 'X-N8N-API-KEY': chave, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    const texto = await resposta.text();
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

async function principal(argumentos) {
  if (argumentos.some((a) => ['--help', '-h', '--ajuda'].includes(a))) {
    console.log(USO);
    return 0;
  }
  const aplicar = argumentos.includes('--aplicar');
  const raiz = argumentos.find((a) => !a.startsWith('--')) ?? 'n8n/workflows';
  const { N8N_API_URL, N8N_API_KEY } = process.env;
  if (!N8N_API_URL || !N8N_API_KEY) {
    console.error('Defina N8N_API_URL e N8N_API_KEY no ambiente.');
    return 1;
  }
  const api = criarApi(N8N_API_URL, N8N_API_KEY);
  const implantados = await listarImplantados(api);
  let falhas = 0;
  for (const arquivo of listarArquivos(raiz)) {
    const modelo = JSON.parse(readFileSync(arquivo, 'utf8'));
    const plano = planejar(modelo, implantados);
    const rotulo = `${relative(raiz, arquivo)} → "${plano.nome}"`;
    if (plano.acao === 'ausente') {
      console.warn(`IGNORADO ${rotulo}: não há workflow implantado com esse nome`);
      continue;
    }
    if (plano.acao === 'credencial-de-exemplo') {
      console.error(`ERRO ${rotulo}: credencial de exemplo (a-definir…) em ${plano.nos.join(', ')}`);
      falhas += 1;
      continue;
    }
    if (plano.acao === 'repetido') {
      console.error(`ERRO ${rotulo}: mais de um workflow com esse nome (${plano.ids.join(', ')})`);
      falhas += 1;
      continue;
    }
    if (plano.acao === 'igual') {
      console.log(`igual ${rotulo} (${plano.id})`);
      continue;
    }
    if (!aplicar) {
      console.log(`atualizaria ${rotulo} (${plano.id})`);
      continue;
    }
    try {
      const atual = await api('GET', `/workflows/${plano.id}`);
      const final = mesclarComImplantado(modelo, atual);
      await api('PUT', `/workflows/${plano.id}`, {
        name: final.name,
        nodes: final.nodes,
        connections: final.connections,
        settings: configuracaoPermitida(final.settings),
      });
      if (plano.ativo) await api('POST', `/workflows/${plano.id}/activate`);
      console.log(`atualizado ${rotulo} (${plano.id})${plano.ativo ? ', reativado' : ''}`);
    } catch (erro) {
      console.error(`ERRO ${rotulo}: ${erro.message}`);
      falhas += 1;
    }
  }
  return falhas ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  principal(process.argv.slice(2)).then(
    (codigo) => process.exit(codigo),
    (erro) => {
      console.error(erro.message);
      process.exit(1);
    },
  );
}
