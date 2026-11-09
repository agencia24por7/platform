import { cache } from 'react';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, readSession } from '@/modules/identity/domain/session';
import { env } from '@/shared/config/env';
import { sql } from '@/shared/db/client';

export const ORGANIZACAO_INTEIRA = '*';

async function resolver(organizationId: string): Promise<string> {
  let token: string | undefined;
  try {
    token = (await cookies()).get(SESSION_COOKIE)?.value;
  } catch {
    return ORGANIZACAO_INTEIRA;
  }
  if (!token) return ORGANIZACAO_INTEIRA;

  const sessao = readSession(token, env().TRIA_SESSION_SECRET, Date.now());
  if (!sessao) return ORGANIZACAO_INTEIRA;

  const linhas = (await sql()`
    SELECT core.client_scope_of(${sessao.userId}::uuid, ${organizationId}::uuid) AS escopo
  `) as unknown as { escopo: string[] | null }[];

  const escopo = linhas[0]?.escopo;
  return escopo && escopo.length > 0 ? escopo.join(',') : ORGANIZACAO_INTEIRA;
}

export const escopoDeCliente = cache(resolver);
