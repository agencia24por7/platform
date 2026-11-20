import { brainEntradaParams, brainSemParametrosQuery } from '@/shared/config/contracts';
import { workerQueryRoute } from '@/shared/http/workerRoute';
import { comEtag, rotaDeLeitura } from '@/modules/brain/interface/rotaDeLeitura';
import { modules } from '@/composition';

export const dynamic = 'force-dynamic';

export const GET = rotaDeLeitura((brutos) =>
  workerQueryRoute(
    brainSemParametrosQuery,
    comEtag(brainEntradaParams, brutos, ({ clienteId, urn }, _query, worker) => modules().brain.entrada(clienteId, urn, worker)),
  ),
);
