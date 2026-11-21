import { brainMedirCoberturaBody } from '@/shared/config/contracts';
import { workerRoute } from '@/shared/http/workerRoute';
import { modules } from '@/composition';

export const dynamic = 'force-dynamic';

export const POST = workerRoute(brainMedirCoberturaBody, (input, context) => modules().brain.medirCobertura(context, input.limite));
