import { env } from '@/shared/config/env';
import { logger } from '@/shared/logging/logger';

const TIMEOUT_MS = 8000;

export type SessaoAutomacao =
  | { readonly tipo: 'aberta'; readonly cookies: readonly string[] }
  | { readonly tipo: 'sem_credencial' }
  | { readonly tipo: 'recusada'; readonly status: number }
  | { readonly tipo: 'indisponivel' };

export async function abrirSessaoNaAutomacao(): Promise<SessaoAutomacao> {
  const config = env();
  const endereco = config.N8N_API_URL;
  const email = config.N8N_OWNER_EMAIL;
  const senha = config.N8N_OWNER_PASSWORD;

  if (!endereco || !email || !senha) return { tipo: 'sem_credencial' };

  try {
    const resposta = await fetch(new URL('/rest/login', endereco).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'browser-id': 'tria-portaria' },
      body: JSON.stringify({ emailOrLdapLoginId: email, password: senha }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!resposta.ok) {
      logger.warn('portaria.n8n.recusou', { status: resposta.status });
      return { tipo: 'recusada', status: resposta.status };
    }

    const cookies = resposta.headers.getSetCookie();
    if (cookies.length === 0) {
      logger.warn('portaria.n8n.sem_cookie', {});
      return { tipo: 'recusada', status: resposta.status };
    }

    return { tipo: 'aberta', cookies };
  } catch (erro) {
    logger.warn('portaria.n8n.indisponivel', {
      motivo: erro instanceof Error ? erro.message : 'desconhecido',
    });
    return { tipo: 'indisponivel' };
  }
}
