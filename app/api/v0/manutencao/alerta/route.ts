import { workerRoute } from '@/shared/http/workerRoute';
import { alertaDeFalhaBody } from '@/shared/config/contracts';
import { modules } from '@/composition';

export const dynamic = 'force-dynamic';

export const POST = workerRoute(alertaDeFalhaBody, (input, context) => modules().alertas.registrar(input, context), 200, { maxBodyBytes: 20_000 });
