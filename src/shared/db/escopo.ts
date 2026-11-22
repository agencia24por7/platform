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

export async function escopoDoUsuario(userId: string, organizationId: string): Promise<string> {
  const linhas = (await sql()`
    SELECT core.sessao_alcanca_organizacao(${organizationId}::uuid, ${userId}::uuid) AS alcanca,
           core.client_scope_of(${userId}::uuid, ${organizationId}::uuid) AS escopo
  `) as unknown as { alcanca: boolean; escopo: string[] | null }[];

  const linha = linhas[0];
  if (!linha?.alcanca) {
    throw new Error('Sessão sem vínculo vivo com esta organização. O contexto de tenant não abre.');
  }

  const escopo = linha.escopo;
  return escopo && escopo.length > 0 ? escopo.join(',') : ORGANIZACAO_INTEIRA;
}

async function resolver(organizationId: string): Promise<string> {
  const userId = await usuarioDaSessao();
  if (!userId) return ORGANIZACAO_INTEIRA;
  return escopoDoUsuario(userId, organizationId);
}

export const escopoDeCliente = cache(resolver);
