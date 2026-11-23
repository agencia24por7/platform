import { cache } from 'react';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, readSession } from '@/modules/identity/domain/session';
import { env } from '@/shared/config/env';
import { emChamadaDoWorker, emChamadaPublica, sql } from '@/shared/db/client';

export const ORGANIZACAO_INTEIRA = '*';
export const SEM_SESSAO = '';
export const SEM_CLIENTES = 'nenhum';

async function lerUsuario(): Promise<string> {
  let token: string | undefined;
  try {
    token = (await cookies()).get(SESSION_COOKIE)?.value;
  } catch {
    return SEM_SESSAO;
  }
  if (!token) return SEM_SESSAO;

  const sessao = readSession(token, env().TRIA_SESSION_SECRET, Date.now());
  if (!sessao) return SEM_SESSAO;

  const linhas = (await sql()`
    SELECT core.sessao_valida(${sessao.userId}::uuid, ${new Date(sessao.issuedAt)}::timestamptz) AS valida
  `) as unknown as { valida: boolean }[];
  return linhas[0]?.valida === true ? sessao.userId : SEM_SESSAO;
}

export const usuarioDaSessao = cache(lerUsuario);

export async function usuarioDoContexto(): Promise<string> {
  if (emChamadaDoWorker() || emChamadaPublica()) return SEM_SESSAO;
  return usuarioDaSessao();
}

export async function escopoDoUsuario(userId: string, organizationId: string): Promise<string> {
  const linhas = (await sql().begin(async (tx) => {
    await tx`SELECT set_config('app.user_id', ${userId}, true)`;
    return tx`
      SELECT core.sessao_alcanca_organizacao(${organizationId}::uuid, ${userId}::uuid) AS alcanca,
             core.client_scope_of(${userId}::uuid, ${organizationId}::uuid) AS escopo
    `;
  })) as unknown as { alcanca: boolean; escopo: string[] | null }[];

  const linha = linhas[0];
  if (!linha?.alcanca) {
    throw new Error('Sessão sem vínculo vivo com esta organização. O contexto de tenant não abre.');
  }

  const escopo = linha.escopo;
  if (escopo === null) return ORGANIZACAO_INTEIRA;
  return escopo.length === 0 ? SEM_CLIENTES : escopo.join(',');
}

export type OrigemDoEscopo = 'usuario' | 'organizacao_inteira' | 'recusar';

export function origemDoEscopo(userId: string, chamadaDoWorker: boolean, chamadaPublica: boolean): OrigemDoEscopo {
  if (chamadaDoWorker || chamadaPublica) return 'organizacao_inteira';
  return userId ? 'usuario' : 'recusar';
}

async function resolver(organizationId: string): Promise<string> {
  const userId = await usuarioDoContexto();
  const origem = origemDoEscopo(userId, emChamadaDoWorker(), emChamadaPublica());
  if (origem === 'usuario') return escopoDoUsuario(userId, organizationId);
  if (origem === 'organizacao_inteira') return ORGANIZACAO_INTEIRA;
  throw new Error('Contexto de tenant sem sessão, sem chamada do worker e sem entrada pública declarada.');
}

const resolverPorOrigem = cache((organizationId: string, _origem: string) => resolver(organizationId));

export function escopoDeCliente(organizationId: string): Promise<string> {
  return resolverPorOrigem(organizationId, `${emChamadaDoWorker()}:${emChamadaPublica()}`);
}
