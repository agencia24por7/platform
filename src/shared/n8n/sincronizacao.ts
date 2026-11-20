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
