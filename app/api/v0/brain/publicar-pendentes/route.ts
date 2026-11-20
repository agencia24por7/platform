import { brainPublicarPendentesBody } from '@/shared/config/contracts';
import { workerRoute } from '@/shared/http/workerRoute';
import { modules } from '@/composition';

export const dynamic = 'force-dynamic';

export const POST = workerRoute(brainPublicarPendentesBody, (input, context) => modules().brain.publicarPendentes(context, input.limite));
