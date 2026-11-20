import { brainCatalogoQuery, brainClienteParams } from '@/shared/config/contracts';
import { workerQueryRoute } from '@/shared/http/workerRoute';
import { comEtag, rotaDeLeitura } from '@/modules/brain/interface/rotaDeLeitura';
import { modules } from '@/composition';

export const dynamic = 'force-dynamic';

export const GET = rotaDeLeitura((brutos) =>
  workerQueryRoute(
    brainCatalogoQuery,
    comEtag(brainClienteParams, brutos, ({ clienteId }, query, worker) =>
      modules().brain.catalogo(clienteId, { ...query, cursor: query.cursor ?? null }, worker),
    ),
  ),
);
