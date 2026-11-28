import { Readable } from 'node:stream';
import { clienteNoEscopo } from '@/../app/clientes/[id]/_escopo';
import { modules } from '@/composition';
import { requestId } from '@/shared/http/actions';
import { comRequestId } from '@/shared/http/comRequestId';
import { activeContext } from '@/shared/http/currentOrganization';
import { cabecalhosDeImagemEmLinha, cabecalhosDeRevalidacao } from '@/shared/storage/politicaDeArquivos';

export const dynamic = 'force-dynamic';

const SEM_CACHE = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
const ETAG = /^"([0-9a-f]{64})"$/;

function vazio(status: number): Response {
  return new Response(null, { status, headers: SEM_CACHE });
}

export async function GET(request: Request, { params }: { params: Promise<{ clienteId: string }> }) {
  const id = await requestId();
  return comRequestId(id, servirLogo(request, params));
}

async function servirLogo(request: Request, params: Promise<{ clienteId: string }>): Promise<Response> {
  const { clienteId } = await params;
  const ctx = await activeContext();
  if (!ctx) return vazio(401);
  const cliente = await clienteNoEscopo(ctx, clienteId);
  if (!cliente) return vazio(404);

  const conhecido = ETAG.exec(request.headers.get('if-none-match') ?? '')?.[1] ?? null;
  const resultado = await modules().contexto.abrirLogo({ organizationId: ctx.organization.id, clientId: cliente.id, papelDeQuemLe: ctx.role }, conhecido);
  if (!resultado.ok) return vazio(resultado.error.code === 'unavailable' ? 503 : 404);
  if (resultado.value.tipo === 'ausente') return vazio(404);

  if (resultado.value.tipo === 'sem_mudanca') {
    return new Response(null, { status: 304, headers: cabecalhosDeRevalidacao(resultado.value.sha256) ?? SEM_CACHE });
  }

  const { logo } = resultado.value;
  const cabecalhos = cabecalhosDeImagemEmLinha(logo.contentType, logo.sha256);
  if (!cabecalhos) {
    logo.conteudo.destroy();
    return vazio(404);
  }
  return new Response(Readable.toWeb(logo.conteudo) as ReadableStream<Uint8Array>, { status: 200, headers: { ...cabecalhos, 'Content-Length': String(logo.tamanhoBytes) } });
}
