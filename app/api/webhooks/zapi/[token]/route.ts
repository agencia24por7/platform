import { createHash } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { resumirAvisoDoWhatsapp } from '@/modules/connections/domain/whatsappWebhook';
import { env } from '@/shared/config/env';
import { comoPublico } from '@/shared/db/client';
import { withTenant, withoutTenant } from '@/shared/db/tenant';
import { logger } from '@/shared/logging/logger';
import { criarAvisoLimitado } from '@/shared/logging/avisoLimitado';
import type { RateLimitVerdict } from '@/shared/security/rateLimit';
import { vigiarConsulta } from '@/shared/security/tentativasInvalidas';
import { enderecoDoCliente } from '@/shared/http/enderecoDoCliente';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 500_000;
const LIMITE_POR_TOKEN = 60;
const CONSULTAS_DE_TOKEN_DESCONHECIDO_POR_IP = 600;
const RATE_WINDOW_MS = 60_000;

const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;

const avisarWebhookDesconhecido = criarAvisoLimitado({
  janelaMs: RATE_WINDOW_MS,
  emitir: (contexto) => logger.warn('webhook.zapi.webhook_desconhecido', contexto),
});

function limiteExcedido(verdict: RateLimitVerdict): NextResponse {
  return NextResponse.json(
    { error: 'limite_excedido' },
    { status: 429, headers: { 'Retry-After': String(verdict.retryAfterSeconds) } },
  );
}

function impressaoDoToken(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 32);
}

type ConexaoDoWebhook = { connection_id: string; status: string; organization_id: string };

async function conexaoPeloToken(token: string): Promise<ConexaoDoWebhook | null> {
  const rows = await comoPublico(() =>
    withoutTenant(async (tx) => {
      return (await tx`
        SELECT * FROM integrations.resolve_webhook_connection(${token}, 'zapi')
      `) as unknown as ConexaoDoWebhook[];
    }),
  );
  return rows[0] ?? null;
}

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

  const sourceIp = enderecoDoCliente(request.headers) ?? 'desconhecido';
  const impressao = impressaoDoToken(token);
  const consulta = vigiarConsulta({
    janelaMs: RATE_WINDOW_MS,
    desconhecidas: { dominio: 'ip', chave: `webhook:zapi:desconhecidos:${sourceIp}`, limite: CONSULTAS_DE_TOKEN_DESCONHECIDO_POR_IP },
    porCredencial: { dominio: 'webhook', chave: `zapi:token:${impressao}`, limite: LIMITE_POR_TOKEN },
    validada: { chave: `zapi:${impressao}` },
    recusada: { chave: `zapi:${impressao}` },
  });

  const resolucao = await consulta.resolver(() => conexaoPeloToken(token));
  if (resolucao.tipo === 'barrada') return limiteExcedido(resolucao.veredito);
  if (resolucao.tipo === 'invalida') {
    avisarWebhookDesconhecido();
    return NextResponse.json({ error: 'webhook_desconhecido' }, { status: 404 });
  }
  const conexao = resolucao.valor;

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
