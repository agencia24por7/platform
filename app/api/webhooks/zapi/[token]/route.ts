import { NextResponse, type NextRequest } from 'next/server';
import { resumirAvisoDoWhatsapp } from '@/modules/connections/domain/whatsappWebhook';
import { env } from '@/shared/config/env';
import { comoPublico } from '@/shared/db/client';
import { withTenant, withoutTenant } from '@/shared/db/tenant';
import { logger } from '@/shared/logging/logger';
import { consume } from '@/shared/security/rateLimit';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 500_000;
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await context.params;
  if (!TOKEN.test(token)) {
    return NextResponse.json({ error: 'webhook_invalido' }, { status: 404 });
  }

  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'corpo_invalido' }, { status: 413 });
  }

  const verdict = consume(`webhook:zapi:${token}`, RATE_LIMIT, RATE_WINDOW_MS);
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

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'corpo_invalido' }, { status: 400 });
  }

  const rows = await comoPublico(() =>
    withoutTenant(async (tx) => {
      return (await tx`
        SELECT * FROM integrations.resolve_webhook_connection(${token}, 'zapi')
      `) as unknown as { connection_id: string; status: string; organization_id: string }[];
    }),
  );

  const conexao = rows[0];
  if (!conexao) {
    logger.warn('webhook.zapi.webhook_desconhecido', {});
    return NextResponse.json({ error: 'webhook_desconhecido' }, { status: 404 });
  }
  if (conexao.status === 'revoked') {
    logger.warn('webhook.zapi.conexao_revogada', { connectionId: conexao.connection_id });
    return NextResponse.json({ error: 'conexao_revogada' }, { status: 410 });
  }

  const resumo = resumirAvisoDoWhatsapp(payload, env().TRIA_SESSION_SECRET);
  try {
    await comoPublico(() =>
      withTenant(conexao.organization_id, async (tx) => {
        await tx`
          SELECT integrations.record_whatsapp_inbound(${conexao.connection_id}, 'zapi', ${conexao.connection_id}, ${tx.json(resumo as never)})
        `;
      }),
    );
  } catch (erro) {
    logger.error('webhook.zapi.gravacao_falhou', { connectionId: conexao.connection_id, erro: String(erro) });
    return NextResponse.json({ error: 'gravacao_falhou' }, { status: 503, headers: { 'Retry-After': '30' } });
  }

  return NextResponse.json({ recebido: true });
}
