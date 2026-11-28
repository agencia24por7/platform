import { AvancarProducaoSchema } from '@/modules/strategy/application/planoDeProducaoService';
import { workerRoute } from '@/shared/http/workerRoute';
import { modules } from '@/composition';

export const dynamic = 'force-dynamic';

export const POST = workerRoute(AvancarProducaoSchema, (input) => modules().strategyDoWorker.diretorDeProducao.avancar(input));
