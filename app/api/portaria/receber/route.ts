import { type NextRequest, NextResponse, after } from 'next/server';
import { enderecoConfiavel } from '@/modules/audit/domain/actor';
import { createAuditRepository } from '@/modules/audit/infrastructure/auditRepository';
import { auditarPortaria, type ResultadoDaPortaria } from '@/modules/identity/application/auditarPortaria';
import { createHandoffRepository } from '@/modules/identity/infrastructure/handoffRepository';
import { abrirSessaoNaAutomacao } from '@/modules/identity/infrastructure/n8nSession';
import { isSafeReturnPath } from '@/modules/connections/domain/oauth';
import {
  HANDOFF_COOKIE,
  SEM_AUTOMACAO_COOKIE,
  SEM_AUTOMACAO_SEGUNDOS,
  PORTARIA_SESSAO_SEGUNDOS,
  issuePortariaSession,
  readHandoff,
} from '@/modules/identity/domain/handoff';
import { env } from '@/shared/config/env';
import { podeEntrarNaAutomacao } from '@/../app/api/portaria/_acesso';
import { CABECALHO_DO_REQUEST_ID, resolverRequestId } from '@/shared/http/requestId';
import { logger } from '@/shared/logging/logger';

function agendarAuditoria(request: NextRequest, resultado: ResultadoDaPortaria, userId: string): void {
  const requestId = resolverRequestId(request.headers.get(CABECALHO_DO_REQUEST_ID));
  const sourceIp = enderecoConfiavel(request.headers.get('x-forwarded-for'));
  after(() => auditarPortaria(createAuditRepository(), { resultado, userId, requestId, sourceIp }));
}

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const configuration = env();
  const automacao = configuration.N8N_PUBLIC_URL;

  if (!automacao) {
    return NextResponse.redirect(new URL('/automacoes?erro=n8n_sem_endereco', configuration.TRIA_APP_BASE_URL));
  }

  const token = request.nextUrl.searchParams.get('t') ?? '';
  const passagem = readHandoff(token, configuration.TRIA_SESSION_SECRET, Date.now());

  if (!passagem) {
    logger.warn('portaria.recusada', { motivo: 'assinatura' });
    return NextResponse.redirect(new URL('/entrar?erro=estado', configuration.TRIA_APP_BASE_URL));
  }

  if (!(await podeEntrarNaAutomacao(passagem.userId))) {
    logger.warn('portaria.recusada', { motivo: 'nao_operador', userId: passagem.userId });
    return NextResponse.redirect(new URL('/clientes?erro=n8n_sem_permissao', configuration.TRIA_APP_BASE_URL));
  }

  if (!(await createHandoffRepository().consume(passagem.jti, passagem.expiresAt))) {
    logger.warn('portaria.recusada', { motivo: 'reuso', userId: passagem.userId });
    agendarAuditoria(request, 'reuso', passagem.userId);
    return NextResponse.redirect(new URL('/entrar?erro=estado', configuration.TRIA_APP_BASE_URL));
  }

  const pedido = request.nextUrl.searchParams.get('de') ?? '/';
  const destino = new URL(isSafeReturnPath(pedido) ? pedido : '/', automacao);

  const response = NextResponse.redirect(destino);
  response.cookies.set(
    HANDOFF_COOKIE,
    issuePortariaSession(passagem.userId, configuration.TRIA_SESSION_SECRET, Date.now()),
    {
      httpOnly: true,
      sameSite: 'lax',
      secure: configuration.NODE_ENV === 'production',
      path: '/',
      maxAge: PORTARIA_SESSAO_SEGUNDOS,
    },
  );

  const automacaoAberta = await abrirSessaoNaAutomacao();

  if (automacaoAberta.tipo === 'aberta') {
    for (const cookie of automacaoAberta.cookies) response.headers.append('set-cookie', cookie);
  } else {
    response.cookies.set(SEM_AUTOMACAO_COOKIE, '1', {
      httpOnly: true,
      sameSite: 'lax',
      secure: configuration.NODE_ENV === 'production',
      path: '/',
      maxAge: SEM_AUTOMACAO_SEGUNDOS,
    });
  }

  agendarAuditoria(request, automacaoAberta.tipo === 'aberta' ? 'aberta' : 'indisponivel', passagem.userId);
  logger.info('portaria.aceita', { userId: passagem.userId, automacao: automacaoAberta.tipo });
  return response;
}
