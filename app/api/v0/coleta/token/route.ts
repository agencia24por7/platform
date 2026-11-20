import type { NextRequest } from 'next/server';
import { tokenDeAcessoBody } from '@/shared/config/contracts';
import { workerRoute } from '@/shared/http/workerRoute';
import { modules } from '@/composition';

export const dynamic = 'force-dynamic';

const emitir = workerRoute(tokenDeAcessoBody, (input, context) => modules().tokens.acesso.emitir(input, context), 200, {
  maxBodyBytes: 1024,
});

export async function POST(request: NextRequest) {
  const resposta = await emitir(request);
  resposta.headers.set('Cache-Control', 'no-store');
  resposta.headers.set('Pragma', 'no-cache');
  return resposta;
}
