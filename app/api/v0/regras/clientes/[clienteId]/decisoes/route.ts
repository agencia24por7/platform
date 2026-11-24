import { workerRoute } from '@/shared/http/workerRoute';
import { EntradaDoAgenteSchema } from '@/modules/clients/application/regrasEntradas';
import {
  LIMITE_DO_CORPO_DE_DECISAO_EM_BYTES,
  registrarDecisaoDoAgente,
} from '@/modules/clients/interface/regrasDoWorker';
import { rotaDeRegistroDoAgente } from '@/modules/clients/interface/rotaDeRegistroDoAgente';
import { portaDeRegrasDoWorker } from '@/modules/clients/interface/portaDeRegrasDoWorker';
import { modules } from '@/composition';

export const dynamic = 'force-dynamic';

export const POST = rotaDeRegistroDoAgente((clienteId) =>
  workerRoute(
    EntradaDoAgenteSchema,
    (entrada, worker) => registrarDecisaoDoAgente(portaDeRegrasDoWorker(modules().regras), clienteId, entrada, worker),
    201,
    { maxBodyBytes: LIMITE_DO_CORPO_DE_DECISAO_EM_BYTES },
  ),
);
