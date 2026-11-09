import { cache } from 'react';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, readSession } from '@/modules/identity/domain/session';
import { env } from '@/shared/config/env';
import { sql } from '@/shared/db/client';

export const ORGANIZACAO_INTEIRA = '*';
export const SEM_SESSAO = '';

async function lerUsuario(): Promise<string> {
  let token: string | undefined;
  try {
    token = (await cookies()).get(SESSION_COOKIE)?.value;
  } catch {
    return SEM_SESSAO;
  }
  if (!token) return SEM_SESSAO;

  return readSession(token, env().TRIA_SESSION_SECRET, Date.now())?.userId ?? SEM_SESSAO;
}

export const usuarioDaSessao = cache(lerUsuario);

async function resolver(organizationId: string): Promise<string> {
  const userId = await usuarioDaSessao();
  if (!userId) return ORGANIZACAO_INTEIRA;

  const linhas = (await sql()`
    SELECT core.client_scope_of(${userId}::uuid, ${organizationId}::uuid) AS escopo
  `) as unknown as { escopo: string[] | null }[];

  const escopo = linhas[0]?.escopo;
  return escopo && escopo.length > 0 ? escopo.join(',') : ORGANIZACAO_INTEIRA;
}

export const escopoDeCliente = cache(resolver);
