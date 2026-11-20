import { GRAVAR_COLETA_MAX_BYTES, gravarColetaBody } from '@/shared/config/contracts';
import { workerRoute } from '@/shared/http/workerRoute';
import { modules } from '@/composition';

export const dynamic = 'force-dynamic';

export const POST = workerRoute(gravarColetaBody, (input, context) => modules().coleta.gravar(input, context), 200, {
  maxBodyBytes: GRAVAR_COLETA_MAX_BYTES,
});
