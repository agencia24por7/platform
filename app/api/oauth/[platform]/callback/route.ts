import { NextResponse, type NextRequest } from 'next/server';
import { modules } from '@/composition';
import { currentUser } from '@/shared/http/currentUser';
import { env } from '@/shared/config/env';
import { logger } from '@/shared/logging/logger';
import { newRequestId, secureCompare } from '@/shared/security/tokens';
import {
  falaOauth,
  isSafeReturnPath,
  sameOrigin,
  type PlataformaOauth,
} from '@/modules/connections/domain/oauth';
import { credenciaisDaPlataforma } from '@/modules/connections/application/credenciaisOauth';
import { decodeStateCookie, type StateCookie } from '@/modules/connections/domain/tenantBinding';
import { ORGANIZACAO_INTEIRA, escopoDeCliente } from '@/shared/db/escopo';
import { temRecursoParaVincular, type Platform } from '@/modules/connections/domain/connection';
import type { AuthorizationOutcome } from '@/modules/connections/application/authorizationService';

export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'tria_oauth_state';
const VERIFIER_COOKIE = 'tria_oauth_verifier';

function clear(response: NextResponse): NextResponse {
  response.cookies.delete(STATE_COOKIE);
  response.cookies.delete(VERIFIER_COOKIE);
  return response;
}

function backTo(_request: NextRequest, reason: string): NextResponse {
  return clear(
    NextResponse.redirect(
      new URL(`/comecar?passo=conectar&erro=${reason}`, env().TRIA_APP_BASE_URL),
    ),
  );
}

function redirectComResultado(
  returnTo: string,
  fallback: string,
  platform: string,
  discovered: number,
): NextResponse {
  const base = env().TRIA_APP_BASE_URL;
  const destination = isSafeReturnPath(returnTo) ? returnTo : fallback;
  const url = new URL(destination, base);

  if (!sameOrigin(url, base)) {
    logger.warn('oauth.callback.redirect_blocked', { platform });
    return clear(NextResponse.redirect(new URL(fallback, base)));
  }

  url.searchParams.set('autorizado', platform);
  url.searchParams.set('descobertas', String(discovered));
  return clear(NextResponse.redirect(url));
}

async function completarViaConvite(input: {
  readonly request: NextRequest;
  readonly platform: string;
  readonly plataforma: PlataformaOauth;
  readonly binding: StateCookie;
  readonly code: string;
  readonly clientId: string;
  readonly clientSecret: string;
}): Promise<NextResponse> {
  const { request, platform, plataforma, binding, code, clientId, clientSecret } = input;
  const itemId = binding.inviteItemId;
  if (!itemId) return backTo(request, 'convite_invalido');

  const destino = isSafeReturnPath(binding.returnTo) ? binding.returnTo : '/convite';

  const pendente = await modules().connectionInvites.stillPending(itemId);
  if (!pendente) {
    logger.warn('convite.oauth.callback.item_nao_pendente', { platform });
    return NextResponse.redirect(new URL(destino, env().TRIA_APP_BASE_URL));
  }

  const requestId = request.headers.get('x-request-id') ?? newRequestId();
  const sourceIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;

  const outcome = await modules().authorization.complete({
    organizationId: pendente.organizationId,
    autorizadoPor: { via: 'invite', inviteItemId: itemId },
    actorId: itemId,
    platform: plataforma,
    code,
    codeVerifier: request.cookies.get(VERIFIER_COOKIE)?.value ?? null,
    redirectUri: new URL(`/api/oauth/${platform}/callback`, env().TRIA_APP_BASE_URL).toString(),
    clientId,
    clientSecret,
    requestId,
    sourceIp,
  });

  if (!outcome.ok) {
    logger.warn('convite.oauth.callback.authorization_failed', { platform, code: outcome.error.code });
    return clear(
      NextResponse.redirect(
        new URL(
          `${destino}?erro=${outcome.error.code === 'forbidden' ? 'autorizacao_recusada' : 'falha_autorizacao'}`,
          env().TRIA_APP_BASE_URL,
        ),
      ),
    );
  }

  await concluirItemDoConvite(itemId, plataforma, outcome.value, pendente.clientId);

  return redirectComResultado(binding.returnTo, destino, platform, outcome.value.discovered);
}

async function concluirItemDoConvite(
  itemId: string,
  platform: Platform,
  outcome: AuthorizationOutcome,
  clientId: string,
): Promise<void> {
  await modules().connectionInvites.completeItem(itemId, outcome.connectionId);

  if (!temRecursoParaVincular(platform)) return;

  const descobertos = await modules().discoveredAccounts.listByConnection(
    outcome.organizationId,
    outcome.connectionId,
  );

  if (descobertos.length !== 1) return;

  await modules().discoveredAccounts.markLinkedToClient(
    outcome.organizationId,
    descobertos[0]!.id,
    clientId,
  );
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ platform: string }> },
): Promise<NextResponse> {
  const { platform } = await context.params;
  if (!falaOauth(platform as Platform)) return backTo(request, 'plataforma_desconhecida');
  const plataforma = platform as PlataformaOauth;

  const query = request.nextUrl.searchParams;
  const binding = decodeStateCookie(request.cookies.get(STATE_COOKIE)?.value ?? '', env().TRIA_SESSION_SECRET);
  const expectedState = binding?.state ?? '';
  const returnTo = binding?.returnTo ?? '/comecar?passo=contas';

  if (
    !expectedState ||
    !binding ||
    !expectedState.startsWith(`${plataforma}.`) ||
    !secureCompare(query.get('state') ?? '', expectedState)
  ) {
    logger.warn('oauth.callback.state_mismatch', { platform });
    return backTo(request, 'estado_invalido');
  }

  if (query.get('error')) {
    logger.info('oauth.callback.denied', { platform, reason: query.get('error') });
    return backTo(request, 'autorizacao_negada');
  }

  const code = query.get('code');
  if (!code) return backTo(request, 'sem_codigo');

  const credentials = credenciaisDaPlataforma(plataforma);
  if (!credentials.clientId || !credentials.clientSecret) return backTo(request, 'app_indisponivel');

  if (binding.inviteItemId) {
    return completarViaConvite({
      request,
      platform,
      plataforma,
      binding,
      code,
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
    });
  }

  const sessao = await currentUser();
  if (!sessao) return backTo(request, 'sessao_expirada');

  if (!binding.userId || binding.userId !== sessao.user.id) {
    logger.warn('oauth.callback.sessao_trocada', { platform });
    return backTo(request, 'sessao_trocada');
  }

  const papelNaOrganizacao = binding.organizationId
    ? (sessao.memberships.find((m) => m.organizationId === binding.organizationId)?.role ?? null)
    : null;

  if (binding.organizationId) {
    const escopo = await escopoDeCliente(binding.organizationId);
    if (escopo !== ORGANIZACAO_INTEIRA) {
      logger.warn('oauth.callback.recusado_recorte', { platform, userId: sessao.user.id });
      return backTo(request, 'autorizacao_recusada');
    }
  }

  const requestId = request.headers.get('x-request-id') ?? newRequestId();

  const outcome = await modules().authorization.complete({
    organizationId: binding.organizationId,
    autorizadoPor: { via: 'staff', papel: papelNaOrganizacao },
    actorId: sessao.user.id,
    platform: plataforma,
    code,
    codeVerifier: request.cookies.get(VERIFIER_COOKIE)?.value ?? null,
    redirectUri: new URL(`/api/oauth/${platform}/callback`, env().TRIA_APP_BASE_URL).toString(),
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    requestId,
    sourceIp: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
  });

  if (!outcome.ok) {
    logger.warn('oauth.callback.authorization_failed', { platform, code: outcome.error.code });
    return backTo(
      request,
      outcome.error.code === 'forbidden' ? 'autorizacao_recusada' : 'falha_autorizacao',
    );
  }

  if (outcome.value.organizationCreated) {
    const posse = await modules().identity.joinAsOwner(outcome.value.organizationId, {
      userId: sessao.user.id,
      requestId,
      sourceIp: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    });
    if (!posse.ok) {
      logger.warn('oauth.callback.ownership_failed', { platform, code: posse.error.code });
    }
  }

  return redirectComResultado(returnTo, '/comecar?passo=contas', platform, outcome.value.discovered);
}
