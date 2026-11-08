import { closeRunBody } from '@/shared/config/contracts';
import { workerRoute } from '@/shared/http/workerRoute';
import { modules } from '@/composition';

export const dynamic = 'force-dynamic';

export const POST = workerRoute(closeRunBody, (input, context) => modules().ingestion.closeRun(input, context));
