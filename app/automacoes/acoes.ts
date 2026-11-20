'use server';

import { redirect } from 'next/navigation';
import { modules } from '@/composition';
import { canAdminister } from '@/modules/identity/domain/user';
import { requireContext } from '@/shared/http/currentOrganization';

export async function resolverAlertasDaPlataforma(): Promise<void> {
  const contexto = await requireContext();
  if (!canAdminister(contexto.role)) redirect('/automacoes');
  await modules().alertas.resolverAbertos();
  redirect('/automacoes');
}
