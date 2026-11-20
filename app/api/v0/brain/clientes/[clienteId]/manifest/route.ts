import { brainClienteParams, brainSemParametrosQuery } from '@/shared/config/contracts';
import { workerQueryRoute } from '@/shared/http/workerRoute';
import { comEtag, rotaDeLeitura } from '@/modules/brain/interface/rotaDeLeitura';
import { modules } from '@/composition';

export const dynamic = 'force-dynamic';

export const GET = rotaDeLeitura((brutos) =>
  workerQueryRoute(
    brainSemParametrosQuery,
    comEtag(brainClienteParams, brutos, ({ clienteId }, _query, worker) => modules().brain.manifest(clienteId, worker)),
  ),
);
