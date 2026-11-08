import { queueQuery } from '@/shared/config/contracts';
import { workerQueryRoute } from '@/shared/http/workerRoute';
import { ok } from '@/shared/result/result';
import { modules } from '@/composition';

export const dynamic = 'force-dynamic';

export const GET = workerQueryRoute(queueQuery, async (input, context) => {
  const entries = await modules().ingestion.queue(input.limit, input.rewindowDays, context);
  return ok({ count: entries.length, accounts: entries });
});
