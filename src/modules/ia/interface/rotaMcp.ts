import { CorpoAcimaDoLimite, declaradoAcimaDoLimite, lerCorpoLimitado } from '@/shared/http/corpoLimitado';
import { enderecoDoCliente } from '@/shared/http/enderecoDoCliente';
import { CABECALHO_DO_REQUEST_ID, resolverRequestId } from '@/shared/http/requestId';
import type { EscopoDoAgente } from '../domain/ferramenta.ts';

export const TENTATIVAS_POR_ORIGEM_POR_MINUTO = 120;
const JANELA_MS = 60_000;
const SEM_ORIGEM = 'desconhecida';

export const METODOS_ACEITOS: readonly string[] = [
  'initialize',
  'notifications/initialized',
  'ping',
  'server/discover',
  'tools/list',
  'tools/call',
];

export type DominioDoLimiteMcp = 'ip' | 'ia';

type Veredito = { readonly allowed: boolean; readonly retryAfterSeconds: number };

export type DependenciasDaRotaMcp = {
  readonly habilitado: boolean;
  readonly origemDoApp: string;
  readonly chamadasPorMinuto: number;
  readonly corpoMaximo: number;
  autenticar(candidata: string, origem: Pick<EscopoDoAgente, 'requestId' | 'sourceIp'>): Promise<EscopoDoAgente | null>;
  manipular(request: Request, escopo: EscopoDoAgente): Promise<Response>;
  consumir(dominio: DominioDoLimiteMcp, chave: string, limite: number, janelaMs: number): Veredito;
};

function recusa(status: number, titulo: string, requestId: string, extras: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ title: titulo, status, requestId }), {
    status,
    headers: { 'Content-Type': 'application/problem+json', 'Cache-Control': 'no-store', 'X-Request-Id': requestId, ...extras },
  });
}

function portador(request: Request): string | null {
  const cabecalho = request.headers.get('authorization');
  if (!cabecalho?.startsWith('Bearer ')) return null;
  const candidata = cabecalho.slice('Bearer '.length).trim();
  return candidata.length > 0 ? candidata : null;
}

function origemEstranha(request: Request, origemDoApp: string): boolean {
  const origem = request.headers.get('origin');
  return origem !== null && origem !== origemDoApp;
}

type CorpoLido = { readonly texto: string } | { readonly recusa: 400 | 413 };

function mensagemUnicaAceita(texto: string): boolean {
  let mensagem: unknown;
  try {
    mensagem = JSON.parse(texto);
  } catch {
    return false;
  }
  if (mensagem === null || typeof mensagem !== 'object' || Array.isArray(mensagem)) return false;
  const metodo = (mensagem as { method?: unknown }).method;
  return typeof metodo === 'string' && METODOS_ACEITOS.includes(metodo);
}

async function lerMensagem(request: Request, maximo: number): Promise<CorpoLido> {
  try {
    const texto = await lerCorpoLimitado(request.body, maximo);
    return mensagemUnicaAceita(texto) ? { texto } : { recusa: 400 };
  } catch (erro) {
    if (erro instanceof CorpoAcimaDoLimite) return { recusa: 413 };
    throw erro;
  }
}

function comCorpo(request: Request, texto: string): Request {
  const cabecalhos = new Headers(request.headers);
  cabecalhos.delete('content-length');
  return new Request(request.url, { method: request.method, headers: cabecalhos, body: texto });
}

function comRequestId(resposta: Response, requestId: string): Response {
  const cabecalhos = new Headers(resposta.headers);
  cabecalhos.set('X-Request-Id', requestId);
  cabecalhos.set('Cache-Control', 'no-store');
  return new Response(resposta.body, { status: resposta.status, headers: cabecalhos });
}

export function criarRotaMcp(deps: DependenciasDaRotaMcp): (request: Request) => Promise<Response> {
  return async (request) => {
    const requestId = resolverRequestId(request.headers.get(CABECALHO_DO_REQUEST_ID));
    if (!deps.habilitado) return recusa(404, 'Recurso não encontrado.', requestId);
    if (origemEstranha(request, deps.origemDoApp)) return recusa(403, 'Origem não permitida.', requestId);
    if (declaradoAcimaDoLimite(request.headers.get('content-length'), deps.corpoMaximo)) {
      return recusa(413, 'Corpo da requisição acima do limite.', requestId);
    }

    const sourceIp = enderecoDoCliente(request.headers);
    const porOrigem = deps.consumir('ip', `mcp:origem:${sourceIp ?? SEM_ORIGEM}`, TENTATIVAS_POR_ORIGEM_POR_MINUTO, JANELA_MS);
    if (!porOrigem.allowed) {
      return recusa(429, 'Limite de chamadas excedido.', requestId, { 'Retry-After': String(porOrigem.retryAfterSeconds) });
    }

    const candidata = portador(request);
    const escopo = candidata ? await deps.autenticar(candidata, { requestId, sourceIp }) : null;
    if (!escopo) return recusa(401, 'Credencial de agente ausente ou inválida.', requestId, { 'WWW-Authenticate': 'Bearer' });

    const porCredencial = deps.consumir('ia', `mcp:credencial:${escopo.credencialId}`, deps.chamadasPorMinuto, JANELA_MS);
    if (!porCredencial.allowed) {
      return recusa(429, 'Limite de chamadas excedido.', requestId, { 'Retry-After': String(porCredencial.retryAfterSeconds) });
    }

    const corpo = await lerMensagem(request, deps.corpoMaximo);
    if ('recusa' in corpo) {
      const titulo = corpo.recusa === 413 ? 'Corpo da requisição acima do limite.' : 'Envie uma única mensagem JSON-RPC de um método aceito.';
      return recusa(corpo.recusa, titulo, requestId);
    }

    return comRequestId(await deps.manipular(comCorpo(request, corpo.texto), escopo), requestId);
  };
}
