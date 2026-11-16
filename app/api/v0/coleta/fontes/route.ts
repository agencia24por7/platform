import { fontesColetaQuery } from '@/shared/config/contracts';
import { workerQueryRoute } from '@/shared/http/workerRoute';
import { ok } from '@/shared/result/result';
import { modules } from '@/composition';

export const dynamic = 'force-dynamic';

export const GET = workerQueryRoute(fontesColetaQuery, async (input, context) => {
  const fontes = await modules().coleta.fontes(input.limit, input.modo, context);
  return ok({ count: fontes.length, fontes });
});
