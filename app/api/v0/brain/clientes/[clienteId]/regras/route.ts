import { brainClienteParams, brainSemParametrosQuery } from '@/shared/config/contracts';
import { workerQueryRoute } from '@/shared/http/workerRoute';
import { comEtag, rotaDeLeitura } from '@/modules/brain/interface/rotaDeLeitura';
import { lerRegrasParaAgente } from '@/modules/clients/interface/regrasDoWorker';
import { portaDeRegrasDoWorker } from '@/modules/clients/interface/portaDeRegrasDoWorker';
import { modules } from '@/composition';

export const dynamic = 'force-dynamic';

export const GET = rotaDeLeitura((brutos) =>
  workerQueryRoute(
    brainSemParametrosQuery,
    comEtag(brainClienteParams, brutos, ({ clienteId }) => lerRegrasParaAgente(portaDeRegrasDoWorker(modules().regras), clienteId)),
  ),
);
