import { renovacaoProativaBody } from '@/shared/config/contracts';
import { workerRoute } from '@/shared/http/workerRoute';
import { modules } from '@/composition';

export const dynamic = 'force-dynamic';

export const POST = workerRoute(renovacaoProativaBody, (input, context) =>
  modules().tokens.acesso.renovarProativo(input, context),
);
