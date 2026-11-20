import { NextResponse, type NextRequest } from 'next/server';
import { modules } from '@/composition';
import { logger } from '@/shared/logging/logger';
import { consume } from '@/shared/security/rateLimit';
import { CorpoAcimaDoLimite, declaradoAcimaDoLimite, lerCorpoLimitado } from '@/shared/http/corpoLimitado';
import { TAMANHO_MAXIMO_DO_SIGNED_REQUEST } from '@/modules/privacidade/domain/pedidoDeExclusaoMeta';

export const dynamic = 'force-dynamic';

const LIMITE_DO_CORPO = 8_192;
const LIMITE_POR_IP = 30;
const JANELA_MS = 60_000;

function ipDoClienteViaProxyConfiavel(request: NextRequest): string {
  const encadeamento = request.headers.get('x-forwarded-for')?.split(',') ?? [];
  return encadeamento.at(-1)?.trim() || 'desconhecido';
}

function signedRequestDo(corpo: string, tipo: string | null): string | null {
  if (tipo?.includes('application/json')) {
    try {
      const valor = (JSON.parse(corpo) as { signed_request?: unknown }).signed_request;
      return typeof valor === 'string' ? valor : null;
    } catch {
      return null;
    }
  }
  return new URLSearchParams(corpo).get('signed_request');
}

const recusar = (erro: string, status: number) => NextResponse.json({ error: erro }, { status });

export async function POST(request: NextRequest): Promise<NextResponse> {
  const sourceIp = ipDoClienteViaProxyConfiavel(request);
  const veredito = consume(`meta:exclusao:${sourceIp}`, LIMITE_POR_IP, JANELA_MS);
  if (!veredito.allowed) {
    return NextResponse.json(
      { error: 'limite_excedido' },
      { status: 429, headers: { 'Retry-After': String(veredito.retryAfterSeconds) } },
    );
  }

  let corpo: string;
  try {
    if (declaradoAcimaDoLimite(request.headers.get('content-length'), LIMITE_DO_CORPO)) throw new CorpoAcimaDoLimite();
    corpo = await lerCorpoLimitado(request.body, LIMITE_DO_CORPO);
  } catch (erro) {
    if (erro instanceof CorpoAcimaDoLimite) return recusar('corpo_acima_do_limite', 413);
    return recusar('corpo_invalido', 400);
  }

  const signedRequest = signedRequestDo(corpo, request.headers.get('content-type'));
  if (!signedRequest || signedRequest.length > TAMANHO_MAXIMO_DO_SIGNED_REQUEST) return recusar('signed_request_ausente', 400);

  const registro = await modules().pedidosDeExclusao.registrarDaMeta(signedRequest);
  if (!registro.ok) {
    if (registro.motivo === 'app_nao_configurado') {
      logger.warn('meta.exclusao.app_nao_configurado', {});
      return recusar('app_indisponivel', 503);
    }
    logger.warn('meta.exclusao.recusado', { motivo: registro.motivo, sourceIp });
    return recusar(registro.motivo, registro.motivo === 'assinatura_invalida' ? 401 : 400);
  }

  logger.info('meta.exclusao.registrado', { novo: registro.novo });
  return NextResponse.json(registro.resposta);
}
