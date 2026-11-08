import { z } from 'zod';
import { modules } from '@/composition';
import { workerQueryRoute } from '@/shared/http/workerRoute';
import { ok } from '@/shared/result/result';

export const dynamic = 'force-dynamic';

const schema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(10) });

export const GET = workerQueryRoute(schema, async (input) => {
  const tarefas = await modules().tasks.claim(input.limit);
  return ok({ tasks: tarefas });
});
