import { ingestBody } from '@/shared/config/contracts';
import { workerRoute } from '@/shared/http/workerRoute';
import { modules } from '@/composition';

export const dynamic = 'force-dynamic';

export const POST = workerRoute(ingestBody, (input, context) =>
  modules().ingestion.ingest(input.runId, input.rows, context),
);
