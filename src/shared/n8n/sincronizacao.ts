import { createHash } from 'node:crypto';
import type { CorpoDeWorkflow } from './clienteN8n.ts';

type Credencial = { readonly id: string; readonly name: string };

export type No = {
  readonly name: string;
  readonly type: string;
  readonly id?: string;
  readonly webhookId?: string;
  readonly parameters?: Record<string, unknown>;
  readonly credentials?: Record<string, Credencial>;
  readonly [campo: string]: unknown;
};

export type Workflow = {
  readonly name: string;
  readonly nodes: readonly No[];
  readonly connections: Record<string, unknown>;
  readonly settings: Record<string, unknown>;
};

export type Mescla = {
  readonly corpo: CorpoDeWorkflow;
  readonly pendencias: readonly string[];
};

export const NOTA_DE_ORIGEM = 'Origem no repositório';

const MARCADOR = /^a-definir/;
const VERSAO_NA_NOTA = /versão: ([0-9a-f]{16})/;
const ARQUIVO_NA_NOTA = /Arquivo: `([^`]+)`/;

const ehExpressao = (valor: unknown) => typeof valor === 'string' && valor.startsWith('=');

function workflowIdLiteral(no: No): string | null {
  const referencia = no.parameters?.['workflowId'];
  if (!referencia || typeof referencia !== 'object') return null;

  const valor = (referencia as { value?: unknown }).value;
  if (typeof valor !== 'string' || ehExpressao(valor)) return null;

  return valor;
}

function credencialDoTipo(nos: readonly No[], tipo: string): Credencial | undefined {
  return nos.find((no) => no.credentials?.[tipo])?.credentials?.[tipo];
}

function vincularNo(doRepositorio: No, implantados: readonly No[], pendencias: string[]): No {
  const implantado = implantados.find((no) => no.name === doRepositorio.name);
  const no: Record<string, unknown> = structuredClone(doRepositorio);

  if (implantado?.id) no['id'] = implantado.id;
  if (implantado?.webhookId) no['webhookId'] = implantado.webhookId;

  if (doRepositorio.credentials) {
    const credenciais: Record<string, Credencial> = {};
    for (const [tipo, doRepo] of Object.entries(doRepositorio.credentials)) {
      const vinculada = implantado?.credentials?.[tipo] ?? credencialDoTipo(implantados, tipo) ?? doRepo;
      if (MARCADOR.test(vinculada.id)) pendencias.push(`${doRepositorio.name}: credencial ${tipo} sem vínculo`);
      credenciais[tipo] = vinculada;
    }
    no['credentials'] = credenciais;
  }

  const literal = workflowIdLiteral(doRepositorio);
  if (literal !== null) {
    const vinculado = (implantado && workflowIdLiteral(implantado)) ?? literal;
    if (MARCADOR.test(vinculado)) pendencias.push(`${doRepositorio.name}: sub-workflow sem vínculo`);
    no['parameters'] = {
      ...(no['parameters'] as Record<string, unknown>),
      workflowId: { ...(doRepositorio.parameters!['workflowId'] as object), value: vinculado },
    };
  }

  return no as No;
}

function ordenado(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(ordenado);
  if (!valor || typeof valor !== 'object') return valor;

  return Object.fromEntries(
    Object.keys(valor)
      .sort()
      .map((chave) => [chave, ordenado((valor as Record<string, unknown>)[chave])]),
  );
}

export function versaoDoModelo(modelo: Workflow): string {
  return createHash('sha256').update(JSON.stringify(ordenado(modelo))).digest('hex').slice(0, 16);
}

export function versaoImplantada(implantado: Workflow): string | null {
  const nota = implantado.nodes.find((no) => no.name === NOTA_DE_ORIGEM);
  return String(nota?.parameters?.['content'] ?? '').match(VERSAO_NA_NOTA)?.[1] ?? null;
}

export function arquivoDeOrigem(implantado: Workflow): string | null {
  const nota = implantado.nodes.find((no) => no.name === NOTA_DE_ORIGEM);
  return String(nota?.parameters?.['content'] ?? '').match(ARQUIVO_NA_NOTA)?.[1] ?? null;
}

export function localizarImplantado<W extends Workflow>(
  arquivo: string,
  nome: string,
  implantados: readonly W[],
): { readonly workflow: W; readonly por: 'arquivo' | 'nome' } | null {
  const porArquivo = implantados.filter((workflow) => arquivoDeOrigem(workflow) === arquivo);
  if (porArquivo.length === 1) return { workflow: porArquivo[0]!, por: 'arquivo' };
  if (porArquivo.length > 1) throw new Error(`mais de um workflow implantado aponta para ${arquivo}`);

  const semOrigem = implantados.filter((workflow) => workflow.name === nome && arquivoDeOrigem(workflow) === null);
  if (semOrigem.length > 1) throw new Error(`mais de um workflow sem origem chamado "${nome}"`);
  return semOrigem[0] ? { workflow: semOrigem[0], por: 'nome' } : null;
}

export const TAGS_INTOCAVEIS = ['credaz', 'agencia'];

export type EtiquetaDoWorkflow = { readonly name: string };

export type AvaliacaoDoAlvo = { readonly permitido: true } | { readonly permitido: false; readonly motivo: string };

export function avaliarAlvo(
  implantado: Workflow & { readonly tags?: readonly EtiquetaDoWorkflow[] },
  opcoes: { readonly adotar: boolean; readonly tagDaPlataforma: string },
): AvaliacaoDoAlvo {
  const nomesDasTags = (implantado.tags ?? []).map((tag) => tag.name.toLowerCase());
  const intocavel = TAGS_INTOCAVEIS.find((tag) => nomesDasTags.includes(tag));
  if (intocavel) return { permitido: false, motivo: `workflow com a tag ${intocavel} nunca é alterado pela sincronização` };

  const conhecido = arquivoDeOrigem(implantado) !== null || nomesDasTags.includes(opcoes.tagDaPlataforma);
  if (!conhecido && !opcoes.adotar) {
    return { permitido: false, motivo: `sem nota de origem nem a tag ${opcoes.tagDaPlataforma}: use --adotar para assumi-lo` };
  }
  return { permitido: true };
}

const chaveDaCredencial = (tipo: string, nome: string) => `${tipo}|${nome}`;

export function credenciaisPorNome(implantados: readonly Workflow[]): ReadonlyMap<string, Credencial> {
  const vistas = new Map<string, Credencial | null>();
  for (const no of implantados.flatMap((workflow) => workflow.nodes)) {
    for (const [tipo, credencial] of Object.entries(no.credentials ?? {})) {
      if (MARCADOR.test(credencial.id) || MARCADOR.test(credencial.name)) continue;
      const chave = chaveDaCredencial(tipo, credencial.name);
      const anterior = vistas.get(chave);
      vistas.set(chave, anterior === undefined || anterior?.id === credencial.id ? credencial : null);
    }
  }
  return new Map([...vistas].filter((par): par is [string, Credencial] => par[1] !== null));
}

export function modeloComCredenciaisPorNome(modelo: Workflow, conhecidas: ReadonlyMap<string, Credencial>): Workflow {
  return {
    ...modelo,
    nodes: modelo.nodes.map((no) => {
      if (!no.credentials) return no;
      const credenciais = Object.fromEntries(
        Object.entries(no.credentials).map(([tipo, credencial]) => [
          tipo,
          MARCADOR.test(credencial.id) ? (conhecidas.get(chaveDaCredencial(tipo, credencial.name)) ?? credencial) : credencial,
        ]),
      );
      return { ...no, credentials: credenciais };
    }),
  };
}

export const PREFIXO_DO_FLUXO_DE_ERRO = 'origem:';
export const ARQUIVO_DOS_ALERTAS = 'n8n/workflows/plataforma/alertas-de-falha.json';

export type FluxoDeErroResolvido = { readonly modelo: Workflow; readonly aviso: string | null };

export function resolverFluxoDeErro(modelo: Workflow, implantados: readonly Workflow[]): FluxoDeErroResolvido {
  const declarado = modelo.settings['errorWorkflow'];
  if (typeof declarado !== 'string' || !declarado.startsWith(PREFIXO_DO_FLUXO_DE_ERRO)) return { modelo, aviso: null };

  const arquivo = declarado.slice(PREFIXO_DO_FLUXO_DE_ERRO.length);
  const alvos = implantados.filter((implantado) => arquivoDeOrigem(implantado) === arquivo);
  if (alvos.length > 1) throw new Error(`mais de um workflow implantado aponta para ${arquivo}`);

  const { errorWorkflow: _removido, ...restante } = modelo.settings;
  const id = (alvos[0] as (Workflow & { readonly id?: string }) | undefined)?.id;
  if (!id) return { modelo: { ...modelo, settings: restante }, aviso: `fluxo de erro ${arquivo} ainda não implantado: o workflow fica sem errorWorkflow` };
  return { modelo: { ...modelo, settings: { ...restante, errorWorkflow: id } }, aviso: null };
}

function notaDeOrigem(arquivo: string, versao: string): No {
  return {
    name: NOTA_DE_ORIGEM,
    type: 'n8n-nodes-base.stickyNote',
    typeVersion: 1,
    position: [-480, -240],
    parameters: {
      content: `## Gerado pelo repositório\nArquivo: \`${arquivo}\`\n\nNão edite aqui: altere o arquivo e rode \`npm run n8n:sincronizar\`.\n\nversão: ${versao}`,
      width: 400,
      height: 220,
    },
  };
}

export function mesclar(doRepositorio: Workflow, implantado: Workflow | null, nome: string, arquivo: string): Mescla {
  const pendencias: string[] = [];
  const nos = doRepositorio.nodes
    .filter((no) => no.name !== NOTA_DE_ORIGEM)
    .map((no) => vincularNo(no, implantado?.nodes ?? [], pendencias));

  return {
    corpo: {
      name: nome,
      nodes: [...nos, notaDeOrigem(arquivo, versaoDoModelo(doRepositorio))],
      connections: doRepositorio.connections,
      settings: doRepositorio.settings,
    },
    pendencias,
  };
}
