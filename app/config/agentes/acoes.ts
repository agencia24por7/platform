'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { modules } from '@/composition';
import { atorAtual } from '@/shared/http/ator';
import { list, text } from '@/shared/http/actions';
import { requireContext } from '@/shared/http/currentOrganization';

export type EstadoDaCredencial = {
  readonly erro?: string;
  readonly criada?: { readonly nome: string; readonly segredo: string; readonly venceEm: string };
};

async function quemAdministra() {
  const ctx = await requireContext();
  if (ctx.clientIds !== null) redirect('/clientes');
  return { organizationId: ctx.organization.id, papelDeQuemAge: ctx.role };
}

export async function criarCredencial(_anterior: EstadoDaCredencial, formData: FormData): Promise<EstadoDaCredencial> {
  const quem = await quemAdministra();
  const clienteIds = text(formData, 'alcance') === 'clientes' ? list(formData, 'clienteIds') : null;
  const resultado = await modules().ia.credenciais.criar(
    quem,
    {
      nome: text(formData, 'nome'),
      clienteIds,
      ferramentas: list(formData, 'ferramentas'),
      validadeEmDias: Number(text(formData, 'validadeEmDias')),
    },
    await atorAtual(),
  );
  if (!resultado.ok) return { erro: resultado.error.message };
  revalidatePath('/config/agentes');
  return {
    criada: {
      nome: resultado.value.credencial.nome,
      segredo: resultado.value.segredo,
      venceEm: resultado.value.credencial.venceEm.toISOString(),
    },
  };
}

export async function revogarCredencial(formData: FormData): Promise<void> {
  const quem = await quemAdministra();
  const resultado = await modules().ia.credenciais.revogar(quem, text(formData, 'credencialId'), await atorAtual());
  const destino = resultado.ok ? 'feito=Credencial revogada.' : `erro=${encodeURIComponent(resultado.error.message)}`;
  redirect(`/config/agentes?${destino}`);
}
