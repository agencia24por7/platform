import { workerRoute } from '@/shared/http/workerRoute';
import { publicarBrainsPendentesBody } from '@/shared/config/contracts';
import { ok } from '@/shared/result/result';
import { modules } from '@/composition';

export const dynamic = 'force-dynamic';

export const POST = workerRoute(publicarBrainsPendentesBody, async (input) =>
  ok(await modules().contexto.publicarPendentes(input.limite)),
);
