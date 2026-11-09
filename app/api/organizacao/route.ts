import { type NextRequest, NextResponse } from 'next/server';
import {
  ORGANIZACAO_COOKIE,
  ORGANIZACAO_MAX_AGE_SECONDS,
} from '@/modules/identity/domain/organizacaoAtiva';
import { isSafeReturnPath } from '@/modules/connections/domain/oauth';
import { env } from '@/shared/config/env';
import { logger } from '@/shared/logging/logger';
import { modules } from '@/composition';
import { atorAtual } from '@/shared/http/ator';
import { currentUser } from '@/shared/http/currentUser';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const base = env().TRIA_APP_BASE_URL;
  const sessao = await currentUser();
  if (!sessao) return NextResponse.redirect(new URL('/entrar', base), { status: 303 });

  const form = await request.formData();
  const pedida = String(form.get('organizationId') ?? '');
  const voltarPara = String(form.get('voltarPara') ?? '/');
  const destino = isSafeReturnPath(voltarPara) ? voltarPara : '/';

  const vinculo = sessao.memberships.find((item) => item.organizationId === pedida);
  if (!vinculo) {
    logger.warn('organizacao.troca.negada', { userId: sessao.user.id });
    return NextResponse.redirect(new URL(destino, base), { status: 303 });
  }

  const ator = await atorAtual();
  await modules().audit.record({
    organizationId: vinculo.organizationId,
    actorType: 'user',
    actorId: sessao.user.id,
    action: 'identity.organization_switched',
    targetType: 'organization',
    targetId: vinculo.organizationId,
    requestId: ator.requestId,
    sourceIp: ator.sourceIp,
    metadata: { email: sessao.user.email, role: vinculo.role },
  });

  const response = NextResponse.redirect(new URL(destino, base), { status: 303 });
  response.cookies.set(ORGANIZACAO_COOKIE, vinculo.organizationId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env().NODE_ENV === 'production',
    path: '/',
    maxAge: ORGANIZACAO_MAX_AGE_SECONDS,
  });

  logger.info('organizacao.troca', { userId: sessao.user.id, organizationId: vinculo.organizationId });
  return response;
}
