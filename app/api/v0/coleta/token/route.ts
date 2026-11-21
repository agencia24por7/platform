import type { NextRequest } from 'next/server';
import { tokenDeAcessoBody } from '@/shared/config/contracts';
import { workerRoute } from '@/shared/http/workerRoute';
import { problem } from '@/shared/http/problem';
import { veioDeFora } from '@/shared/http/origemInterna';
import { failure } from '@/shared/result/failure';
import { newRequestId } from '@/shared/security/tokens';
import { logger } from '@/shared/logging/logger';
import { modules } from '@/composition';

export const dynamic = 'force-dynamic';

const emitir = workerRoute(tokenDeAcessoBody, (input, context) => modules().tokens.acesso.emitir(input, context), 200, {
  maxBodyBytes: 1024,
});

export async function POST(request: NextRequest) {
  if (veioDeFora(request.headers)) {
    logger.warn('tokens.acesso.recusado_de_fora', {});
    return problem(failure('not_found', 'Rota inexistente.'), request.headers.get('x-request-id') ?? newRequestId());
  }
  const resposta = await emitir(request);
  resposta.headers.set('Cache-Control', 'no-store');
  resposta.headers.set('Pragma', 'no-cache');
  return resposta;
}
