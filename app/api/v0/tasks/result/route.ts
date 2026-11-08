import { z } from 'zod';
import { modules } from '@/composition';
import { workerRoute } from '@/shared/http/workerRoute';
import { failure } from '@/shared/result/failure';
import { err, ok } from '@/shared/result/result';

export const dynamic = 'force-dynamic';

const schema = z.object({
  taskId: z.string().uuid(),
  sucesso: z.boolean(),
  outcome: z.string().max(500).default(''),
});

export const POST = workerRoute(schema, async (input) => {
  const status = await modules().tasks.report(input.taskId, input.sucesso, input.outcome);
  if (!status) return err(failure('not_found', 'Tarefa não encontrada.'));

  return ok({ taskId: input.taskId, status });
});
