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
import { enderecoConfiavel } from '@/modules/audit/domain/actor';
import { decodeStateCookie, type StateCookie } from '@/modules/connections/domain/tenantBinding';
import { ORGANIZACAO_INTEIRA, escopoDeCliente } from '@/shared/db/escopo';
import { temRecursoParaVincular, type Platform } from '@/modules/connections/domain/connection';
import type { AuthorizationOutcome } from '@/modules/connections/application/authorizationService';
import { destinoDoErroDeAutorizacao } from '@/modules/connections/domain/erroDeAutorizacao';

export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'tria_oauth_state';
const VERIFIER_COOKIE = 'tria_oauth_verifier';

function motivoDoStateInvalido(
  temCookie: boolean,
  binding: StateCookie | null,
  plataforma: string,
  recebido: string | null,
): string {
  if (!temCookie) return 'sem_cookie';
  if (!binding) return 'cookie_invalido';
  if (!binding.state.startsWith(`${plataforma}.`)) return 'outra_plataforma';
  if (!recebido) return 'sem_state_na_volta';
  return 'state_divergente';
}

function clear(response: NextResponse): NextResponse {
  response.cookies.delete(STATE_COOKIE);
  response.cookies.delete(VERIFIER_COOKIE);
  return response;
}

function backTo(reason: string, origem: string | null, platform: string): NextResponse {
  const seguro = origem && isSafeReturnPath(origem) ? origem : null;
  return clear(
    NextResponse.redirect(new URL(destinoDoErroDeAutorizacao(seguro, reason, platform), env().TRIA_APP_BASE_URL)),
  );
}

function redirectComResultado(
  returnTo: string,
  fallback: string,
  platform: string,
  discovered: number,
  pendentesDeOutraConta = 0,
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
  if (pendentesDeOutraConta > 0) url.searchParams.set('outraConta', String(pendentesDeOutraConta));
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
  if (!itemId) return backTo('convite_invalido', binding.returnTo, platform);

  const destino = isSafeReturnPath(binding.returnTo) ? binding.returnTo : '/convite';

  const pendente = await modules().connectionInvites.stillPending(itemId);
  if (!pendente) {
    logger.warn('convite.oauth.callback.item_nao_pendente', { platform });
    return NextResponse.redirect(new URL(destino, env().TRIA_APP_BASE_URL));
  }

  const requestId = request.headers.get('x-request-id') ?? newRequestId();
  const sourceIp = enderecoConfiavel(request.headers.get('x-forwarded-for'));

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
  const concluido = await modules().connectionInvites.completeItem(itemId, outcome.connectionId);
  if (!concluido) {
    logger.warn('convite.oauth.callback.item_revogado_durante_fluxo', { platform });
    return;
  }

  if (!temRecursoParaVincular(platform)) return;

  const descobertos = await modules().discoveredAccounts.listByConnection(
    outcome.organizationId,
    outcome.connectionId,
  );

  if (descobertos.length !== 1 || descobertos[0]!.state !== 'discovered') return;

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
  if (!falaOauth(platform as Platform)) return backTo('plataforma_desconhecida', null, platform);
  const plataforma = platform as PlataformaOauth;

  const query = request.nextUrl.searchParams;
  const binding = decodeStateCookie(request.cookies.get(STATE_COOKIE)?.value ?? '', env().TRIA_SESSION_SECRET);
  const expectedState = binding?.state ?? '';
  const returnTo = binding?.returnTo ?? '/comecar?passo=contas';
  const origem = binding?.returnTo ?? null;

  if (
    !expectedState ||
    !binding ||
    !expectedState.startsWith(`${plataforma}.`) ||
    !secureCompare(query.get('state') ?? '', expectedState)
  ) {
    logger.warn('oauth.callback.state_mismatch', {
      platform,
      motivo: motivoDoStateInvalido(request.cookies.has(STATE_COOKIE), binding, plataforma, query.get('state')),
    });
    return backTo('estado_invalido', origem, platform);
  }

  if (query.get('error')) {
    logger.info('oauth.callback.denied', { platform, reason: query.get('error') });
    return backTo('autorizacao_negada', origem, platform);
  }

  const code = query.get('code');
  if (!code) return backTo('sem_codigo', origem, platform);

  const credentials = credenciaisDaPlataforma(plataforma);
  if (!credentials.clientId || !credentials.clientSecret) return backTo('app_indisponivel', origem, platform);

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
  if (!sessao) return backTo('sessao_expirada', origem, platform);

  if (!binding.userId || binding.userId !== sessao.user.id) {
    logger.warn('oauth.callback.sessao_trocada', { platform });
    return backTo('sessao_trocada', origem, platform);
  }

  const papelNaOrganizacao = binding.organizationId
    ? (sessao.memberships.find((m) => m.organizationId === binding.organizationId)?.role ?? null)
    : null;

  if (binding.organizationId) {
    const escopo = await escopoDeCliente(binding.organizationId);
    if (escopo !== ORGANIZACAO_INTEIRA) {
      logger.warn('oauth.callback.recusado_recorte', { platform, userId: sessao.user.id });
      return backTo('autorizacao_recusada', origem, platform);
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
    sourceIp: enderecoConfiavel(request.headers.get('x-forwarded-for')),
  });

  if (!outcome.ok) {
    logger.warn('oauth.callback.authorization_failed', { platform, code: outcome.error.code });
    return backTo(
      outcome.error.code === 'forbidden' ? 'autorizacao_recusada' : 'falha_autorizacao',
      origem,
      platform,
    );
  }

  if (outcome.value.organizationCreated) {
    const posse = await modules().identity.joinAsOwner(outcome.value.organizationId, {
      userId: sessao.user.id,
      requestId,
      sourceIp: enderecoConfiavel(request.headers.get('x-forwarded-for')),
    });
    if (!posse.ok) {
      logger.warn('oauth.callback.ownership_failed', { platform, code: posse.error.code });
    }
  }

  return redirectComResultado(
    returnTo,
    '/comecar?passo=contas',
    platform,
    outcome.value.discovered,
    outcome.value.pendentesDeOutraConta,
  );
}
