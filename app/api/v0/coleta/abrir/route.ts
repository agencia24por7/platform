import { abrirColetaBody } from '@/shared/config/contracts';
import { workerRoute } from '@/shared/http/workerRoute';
import { modules } from '@/composition';

export const dynamic = 'force-dynamic';

export const POST = workerRoute(abrirColetaBody, (input, context) => modules().coleta.abrir(input, context), 201);
