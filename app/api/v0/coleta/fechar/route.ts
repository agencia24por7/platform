import { fecharColetaBody } from '@/shared/config/contracts';
import { workerRoute } from '@/shared/http/workerRoute';
import { modules } from '@/composition';

export const dynamic = 'force-dynamic';

export const POST = workerRoute(fecharColetaBody, (input, context) => modules().coleta.fechar(input, context));
