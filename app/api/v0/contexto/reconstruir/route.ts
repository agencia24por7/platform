import { workerRoute } from '@/shared/http/workerRoute';
import { reconstruirBrainBody } from '@/shared/config/contracts';
import { modules } from '@/composition';
import type { AlvoDaReconstrucao } from '@/modules/clients/application/contextoService';

export const dynamic = 'force-dynamic';

function alvoDe(input: { organizationId?: string | undefined; clientId?: string | undefined; todos?: true | undefined }): AlvoDaReconstrucao {
  if (input.todos || !input.organizationId) return { tipo: 'todos' };
  if (input.clientId) return { tipo: 'cliente', organizationId: input.organizationId, clientId: input.clientId };
  return { tipo: 'organizacao', organizationId: input.organizationId };
}

export const POST = workerRoute(reconstruirBrainBody, (input) => modules().contexto.reconstruirBrains(alvoDe(input)));
