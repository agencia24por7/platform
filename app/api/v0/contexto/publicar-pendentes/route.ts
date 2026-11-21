import { workerRoute } from '@/shared/http/workerRoute';
import { publicarBrainsPendentesBody } from '@/shared/config/contracts';
import { ok } from '@/shared/result/result';
import { modules } from '@/composition';

export const dynamic = 'force-dynamic';

export const POST = workerRoute(publicarBrainsPendentesBody, async (input) => {
  const publicacao = await modules().contexto.publicarPendentes(input.limite);
  const varredura = await modules().contexto.varrerArquivos();
  return ok({ ...publicacao, varredura });
});
