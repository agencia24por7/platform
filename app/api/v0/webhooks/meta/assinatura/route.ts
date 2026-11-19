import { z } from 'zod';
import { assinaturaDaMetaValida } from '@/modules/connections/domain/whatsappWebhook';
import { env } from '@/shared/config/env';
import { logger } from '@/shared/logging/logger';
import { workerRoute } from '@/shared/http/workerRoute';
import { failure } from '@/shared/result/failure';
import { err, ok } from '@/shared/result/result';

export const dynamic = 'force-dynamic';

const schema = z.object({
  corpo: z.string().min(1).max(500_000),
  assinatura: z.string().max(200).default(''),
});

export const POST = workerRoute(schema, async (input) => {
  const segredo = env().META_APP_SECRET;
  if (!segredo) {
    logger.error('webhook.meta.assinatura.sem_segredo');
    return err(failure('unavailable', 'META_APP_SECRET não configurado.'));
  }

  const valida = assinaturaDaMetaValida(input.corpo, input.assinatura || null, segredo);
  if (!valida) logger.warn('webhook.meta.assinatura.invalida');
  return ok({ valida });
});
