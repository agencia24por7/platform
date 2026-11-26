import { AvancarExecucoesSchema } from '@/modules/strategy/application/estrategiaEntradas';
import { workerRoute } from '@/shared/http/workerRoute';
import { modules } from '@/composition';

export const dynamic = 'force-dynamic';

export const POST = workerRoute(AvancarExecucoesSchema, (input) => modules().strategyDoWorker.processador.avancar(input));
