import { openRunBody } from '@/shared/config/contracts';
import { workerRoute } from '@/shared/http/workerRoute';
import { modules } from '@/composition';

export const dynamic = 'force-dynamic';

export const POST = workerRoute(openRunBody, (input, context) => modules().ingestion.openRun(input, context), 201);
