import { notFound } from 'next/navigation';
import { cache } from 'react';
import { montarSnapshotDoCliente } from '@/../app/clientes/[id]/_brain/fonte';
import { modules } from '@/composition';
import { canAdminister, canOperate } from '@/modules/identity/domain/user';
import { idValido } from '@/modules/clients/domain/painel/enderecos';
import { ROTULO_DA_PLATAFORMA, precisaReautorizar } from '@/modules/connections/domain/connection';
import { acoesComConexoesAoVivo, prontidaoDoCliente, type ProntidaoDoCliente } from '@/modules/clients/domain/painel/prontidao';
import { requireContext } from '@/shared/http/currentOrganization';

export const carregarPainel = cache(async (id: string) => {
  const ctx = await requireContext();
  if (!idValido(id)) notFound();
  if (ctx.clientIds !== null && !ctx.clientIds.includes(id)) notFound();
  const encontrado = await modules().clients.byId(ctx.organization.id, id);
  if (!encontrado.ok) notFound();
  return {
    ctx,
    cliente: encontrado.value,
    podeEditar: canOperate(ctx.role),
    podeAdministrar: canAdminister(ctx.role),
    organizacaoInteira: ctx.clientIds === null,
  };
});

export const carregarContexto = cache(async (organizationId: string, clientId: string) => {
  const resultado = await modules().contexto.carregar({ organizationId, clientId });
  return resultado.ok ? resultado.value : null;
});

export const carregarContas = cache(async (organizationId: string, clientId: string) =>
  Promise.all([
    modules().connections.listAccountsByClient(organizationId, clientId),
    modules().recursos.listarPorCliente(organizationId, clientId),
  ]),
);

export type Aviso = { readonly erro?: string; readonly feito?: string };

export function primeiro(valor: string | readonly string[] | undefined): string | undefined {
  return Array.isArray(valor) ? (valor[0] as string | undefined) : (valor as string | undefined);
}

export const carregarConexoes = cache(async (organizationId: string) => modules().connections.listConnections(organizationId));

export const carregarProntidao = cache(async (organizationId: string, clientId: string): Promise<ProntidaoDoCliente | null> => {
  try {
    const [montado, conexoes] = await Promise.all([montarSnapshotDoCliente(organizationId, clientId), carregarConexoes(organizationId)]);
    if (!montado.ok) return null;
    const aoVivo = conexoes.map((c) => ({
      platform: c.platform,
      rotulo: ROTULO_DA_PLATAFORMA[c.platform],
      precisaReautorizar: precisaReautorizar(c) || c.status === 'revoked',
    }));
    const diagnostico = { ...montado.value.diagnostico, acoes: acoesComConexoesAoVivo(montado.value.diagnostico.acoes, aoVivo) };
    return prontidaoDoCliente({ capacidades: montado.value.capacidades, diagnostico });
  } catch (erro) {
    console.error(JSON.stringify({ evento: 'cliente.prontidao_indisponivel', clientId, erro: erro instanceof Error ? erro.message.slice(0, 300) : 'erro' }));
    return null;
  }
});
