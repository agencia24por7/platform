import { workerRoute } from '@/shared/http/workerRoute';
import { expurgarArmazenamentoBody } from '@/shared/config/contracts';
import { modules } from '@/composition';

export const dynamic = 'force-dynamic';

export const POST = workerRoute(expurgarArmazenamentoBody, (input, context) =>
  modules().contexto.expurgarArmazenamento(
    { organizationId: input.organizationId.toLowerCase(), clientId: input.clientId.toLowerCase() },
    input.modo,
    context,
  ),
);
