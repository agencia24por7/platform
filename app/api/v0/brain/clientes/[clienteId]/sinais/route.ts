import type { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { modules } from '@/composition';
import { brainClienteParams } from '@/shared/config/contracts';
import { workerRoute } from '@/shared/http/workerRoute';

export const dynamic = 'force-dynamic';

const LIMITE_DO_CORPO_DE_SINAIS_EM_BYTES = 262_144;

export async function POST(request: NextRequest, contexto: { params: Promise<Record<string, string | string[]>> }): Promise<NextResponse> {
  const bruto = (await contexto.params)['clienteId'];
  const clienteId = brainClienteParams.safeParse({ clienteId: Array.isArray(bruto) ? bruto.join('/') : bruto });
  return workerRoute(
    z.unknown(),
    (lote, worker) => modules().cultura.ingerirDoColetor(clienteId.success ? clienteId.data.clienteId : null, lote, worker),
    200,
    { maxBodyBytes: LIMITE_DO_CORPO_DE_SINAIS_EM_BYTES },
  )(request);
}
