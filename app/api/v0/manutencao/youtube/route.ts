import { z } from 'zod';
import { workerRoute } from '@/shared/http/workerRoute';
import { modules } from '@/composition';

export const dynamic = 'force-dynamic';

export const POST = workerRoute(z.object({}).strict(), (_input, context) =>
  modules().expurgoDeFontes.aplicarConformidadeDoYoutube(context),
);
