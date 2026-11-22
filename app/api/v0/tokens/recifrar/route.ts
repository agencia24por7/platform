import type { NextRequest } from 'next/server';
import { recifragemDeTokensBody } from '@/shared/config/contracts';
import { workerRoute } from '@/shared/http/workerRoute';
import { problem } from '@/shared/http/problem';
import { veioDeFora } from '@/shared/http/origemInterna';
import { failure } from '@/shared/result/failure';
import { newRequestId } from '@/shared/security/tokens';
import { modules } from '@/composition';

export const dynamic = 'force-dynamic';

const recifrar = workerRoute(recifragemDeTokensBody, (input, context) => modules().tokens.acesso.recifrarProativo(input, context));

export async function POST(request: NextRequest) {
  if (veioDeFora(request.headers)) {
    return problem(failure('not_found', 'Rota inexistente.'), request.headers.get('x-request-id') ?? newRequestId());
  }
  return recifrar(request);
}
