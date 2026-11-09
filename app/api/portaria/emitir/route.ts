import { type NextRequest, NextResponse } from 'next/server';
import { issueHandoff } from '@/modules/identity/domain/handoff';
import { isSafeReturnPath } from '@/modules/connections/domain/oauth';
import { canAdminister } from '@/modules/identity/domain/user';
import { env } from '@/shared/config/env';
import { logger } from '@/shared/logging/logger';
import { currentUser } from '@/shared/http/currentUser';
import { activeContext } from '@/shared/http/currentOrganization';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const configuration = env();
  const base = configuration.TRIA_APP_BASE_URL;
  const automacao = configuration.N8N_PUBLIC_URL;

  if (!automacao) {
    logger.warn('portaria.sem_endereco', {});
    return NextResponse.redirect(new URL('/automacoes?erro=n8n_sem_endereco', base));
  }

  const pedido = request.nextUrl.searchParams.get('de') ?? '/';
  const de = isSafeReturnPath(pedido) ? pedido : '/';

  const sessao = await currentUser();
  if (!sessao) {
    const entrada = new URL('/entrar', base);
    entrada.searchParams.set('returnTo', '/automacoes');
    return NextResponse.redirect(entrada);
  }

  const contexto = await activeContext();
  if (!contexto) {
    return NextResponse.redirect(new URL('/organizacoes/nova', base));
  }

  if (contexto.clientIds !== null) {
    logger.warn('portaria.recusada_recorte', { userId: sessao.user.id });
    return NextResponse.redirect(new URL('/clientes', base));
  }

  if (!canAdminister(contexto.role)) {
    logger.warn('portaria.papel_insuficiente', { userId: sessao.user.id, papel: contexto.role });
    return NextResponse.redirect(new URL('/automacoes?erro=n8n_sem_permissao', base));
  }

  const destino = new URL('/api/portaria/receber', automacao);
  destino.searchParams.set('t', issueHandoff(sessao.user.id, configuration.TRIA_SESSION_SECRET, Date.now()));
  destino.searchParams.set('de', de);

  logger.info('portaria.emitida', { userId: sessao.user.id });
  return NextResponse.redirect(destino);
}
