import { NextResponse, type NextRequest } from 'next/server';
import { env } from '@/shared/config/env';
import { comoPublico } from '@/shared/db/client';
import { withoutTenant } from '@/shared/db/tenant';
import { logger } from '@/shared/logging/logger';
import { consume } from '@/shared/security/rateLimit';
import { secureCompare } from '@/shared/security/tokens';
import {
  assinaturaDaMetaValida,
  referenciaExternaDoWhatsapp,
  resumirAvisoDoWhatsapp,
} from '@/modules/connections/domain/whatsappWebhook';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 1_000_000;
const RATE_LIMIT = 300;
const RATE_WINDOW_MS = 60_000;

function ipDoClienteViaProxyConfiavel(request: NextRequest): string {
  const encadeamento = request.headers.get('x-forwarded-for')?.split(',') ?? [];
  return encadeamento.at(-1)?.trim() || 'desconhecido';
}

export function GET(request: NextRequest): NextResponse {
  const query = request.nextUrl.searchParams;
  const verifyToken = env().WHATSAPP_WEBHOOK_VERIFY_TOKEN;

  if (
    !verifyToken ||
    query.get('hub.mode') !== 'subscribe' ||
    !secureCompare(query.get('hub.verify_token') ?? '', verifyToken)
  ) {
    logger.warn('webhook.whatsapp.handshake_recusado', {});
    return NextResponse.json({ error: 'verificacao_falhou' }, { status: 403 });
  }

  return new NextResponse(query.get('hub.challenge') ?? '', { status: 200 });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const appSecret = env().META_APP_SECRET;
  if (!appSecret) {
    logger.warn('webhook.whatsapp.app_nao_configurado', {});
    return NextResponse.json({ error: 'app_indisponivel' }, { status: 503 });
  }

  const sourceIp = ipDoClienteViaProxyConfiavel(request);
  const verdict = consume(`webhook:whatsapp:${sourceIp}`, RATE_LIMIT, RATE_WINDOW_MS);
  if (!verdict.allowed) {
    return NextResponse.json(
      { error: 'limite_excedido' },
      { status: 429, headers: { 'Retry-After': String(verdict.retryAfterSeconds) } },
    );
  }

  const raw = await request.text();
  if (raw.length === 0 || raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'corpo_invalido' }, { status: 400 });
  }

  if (!assinaturaDaMetaValida(raw, request.headers.get('x-hub-signature-256'), appSecret)) {
    logger.warn('webhook.whatsapp.assinatura_invalida', { sourceIp });
    return NextResponse.json({ error: 'assinatura_invalida' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    logger.warn('webhook.whatsapp.corpo_nao_json', { sourceIp });
    return NextResponse.json({ recebido: true });
  }

  const externalRef = referenciaExternaDoWhatsapp(payload) ?? 'desconhecido';

  const resumo = resumirAvisoDoWhatsapp(payload, env().TRIA_SESSION_SECRET);
  try {
    await comoPublico(() =>
      withoutTenant(async (tx) => {
        await tx`
          SELECT integrations.record_whatsapp_inbound(NULL, 'cloud_api', ${externalRef}, ${tx.json(resumo as never)})
        `;
      }),
    );
  } catch (erro) {
    logger.error('webhook.whatsapp.gravacao_falhou', { erro: String(erro) });
    return NextResponse.json({ error: 'gravacao_falhou' }, { status: 503, headers: { 'Retry-After': '30' } });
  }

  return NextResponse.json({ recebido: true });
}
