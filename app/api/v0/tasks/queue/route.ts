import { z } from 'zod';
import { modules } from '@/composition';
import { workerQueryRoute } from '@/shared/http/workerRoute';
import { ok } from '@/shared/result/result';
import { logger } from '@/shared/logging/logger';

export const dynamic = 'force-dynamic';

const TIPOS_DE_TAREFA = ['mcc_invite', 'mcc_accept', 'bm_partner_request'] as const;

const schema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  kinds: z
    .string()
    .optional()
    .transform((valor) => (valor ? valor.split(',').map((tipo) => tipo.trim()).filter(Boolean) : null))
    .pipe(z.array(z.enum(TIPOS_DE_TAREFA)).min(1).nullable()),
});

export const GET = workerQueryRoute(schema, async (input) => {
  const tarefas = await modules().tasks.claim(input.limit, input.kinds);
  const esperando = await modules().tasks.esperandoReautorizacao();
  if (esperando > 0) logger.info('tarefas.esperando_reautorizacao', { total: esperando });
  return ok({ tasks: tarefas, esperandoReautorizacao: esperando });
});
