import { workerRoute } from '@/shared/http/workerRoute';
import { varrerArquivosBody } from '@/shared/config/contracts';
import { ok } from '@/shared/result/result';
import { modules } from '@/composition';

export const dynamic = 'force-dynamic';

export const POST = workerRoute(varrerArquivosBody, async (input) =>
  ok(await modules().contexto.varrerArquivos({ limite: input.limite, completa: input.completa })),
);
