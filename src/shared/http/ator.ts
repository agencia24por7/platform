import { headers } from 'next/headers';
import type { Ator } from '@/modules/audit/domain/actor';
import { primeiroEndereco } from '@/modules/audit/domain/actor';
import { requestId } from '@/shared/http/actions';
import { currentUser } from '@/shared/http/currentUser';

export async function atorAtual(): Promise<Ator> {
  const [sessao, cabecalhos] = await Promise.all([currentUser(), headers()]);

  return {
    userId: sessao?.user.id ?? null,
    requestId: requestId(),
    sourceIp: primeiroEndereco(cabecalhos.get('x-forwarded-for')),
  };
}
