import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { montarSnapshotDoCliente } from '@/../app/clientes/[id]/_brain/fonte';
import { modules } from '@/composition';
import { deveRegistrarLeitura, registrarLeituraDeCliente } from '@/modules/clients/application/registrarLeituraDeCliente';
import { canAdminister, canOperate, type MemberRole } from '@/modules/identity/domain/user';
import { idValido } from '@/modules/clients/domain/painel/enderecos';
import { ROTULO_DA_PLATAFORMA, precisaReautorizar } from '@/modules/connections/domain/connection';
import { acoesComConexoesDoCliente, prontidaoDoCliente, type ProntidaoDoCliente } from '@/modules/clients/domain/painel/prontidao';
import { requireContext } from '@/shared/http/currentOrganization';
import { CABECALHO_DO_REQUEST_ID, resolverRequestId } from '@/shared/http/requestId';

export const carregarPainel = cache(async (id: string) => {
  const ctx = await requireContext();
  if (!idValido(id)) notFound();
  if (ctx.clientIds !== null && !ctx.clientIds.includes(id)) notFound();
  const encontrado = await modules().clients.byId(ctx.organization.id, id);
  if (!encontrado.ok) notFound();
  if (deveRegistrarLeitura(ctx.session.user.id, encontrado.value.id)) {
    await registrarLeituraDeCliente(modules().audit, {
      organizationId: ctx.organization.id,
      userId: ctx.session.user.id,
      clientId: encontrado.value.id,
      requestId: resolverRequestId((await headers()).get(CABECALHO_DO_REQUEST_ID)),
    });
  }
  return {
    ctx,
    cliente: encontrado.value,
    podeEditar: canOperate(ctx.role),
    podeAdministrar: canAdminister(ctx.role),
    organizacaoInteira: ctx.clientIds === null,
  };
});

export const carregarContexto = cache(async (organizationId: string, clientId: string, papelDeQuemLe: MemberRole) => {
  try {
    const resultado = await modules().contexto.carregar({ organizationId, clientId, papelDeQuemLe });
    return resultado.ok ? resultado.value : null;
  } catch (erro) {
    console.error(JSON.stringify({ evento: 'cliente.contexto_indisponivel', clientId, erro: erro instanceof Error ? erro.name : 'erro' }));
    return null;
  }
});

export const carregarVersaoDaLogo = cache(async (organizationId: string, clientId: string, papelDeQuemLe: MemberRole): Promise<string | null> => {
  try {
    return await modules().contexto.versaoDaLogo({ organizationId, clientId, papelDeQuemLe });
  } catch (erro) {
    console.error(JSON.stringify({ evento: 'cliente.logo_indisponivel', clientId, erro: erro instanceof Error ? erro.name : 'erro' }));
    return null;
  }
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

export const carregarProntidao = cache(async (organizationId: string, clientId: string, papelDeQuemLe: MemberRole): Promise<ProntidaoDoCliente | null> => {
  try {
    const [montado, conexoes, [contas, fontes]] = await Promise.all([
      montarSnapshotDoCliente(organizationId, clientId, papelDeQuemLe),
      carregarConexoes(organizationId),
      carregarContas(organizationId, clientId),
    ]);
    if (!montado.ok) return null;
    const fontesPorConexao = new Map<string, number>();
    for (const conta of contas) if (conta.status !== 'unlinked') fontesPorConexao.set(conta.connectionId, (fontesPorConexao.get(conta.connectionId) ?? 0) + 1);
    for (const fonte of fontes) fontesPorConexao.set(fonte.connectionId, (fontesPorConexao.get(fonte.connectionId) ?? 0) + 1);
    const doCliente = conexoes
      .filter((c) => fontesPorConexao.has(c.id))
      .map((c) => ({
        id: c.id,
        platform: c.platform,
        rotulo: ROTULO_DA_PLATAFORMA[c.platform],
        precisaReautorizar: c.status !== 'revoked' && precisaReautorizar(c),
        fontesDoCliente: fontesPorConexao.get(c.id) ?? 0,
      }));
    const diagnostico = { ...montado.value.diagnostico, acoes: acoesComConexoesDoCliente(montado.value.diagnostico.acoes, doCliente) };
    return prontidaoDoCliente({ capacidades: montado.value.capacidades, diagnostico });
  } catch (erro) {
    console.error(JSON.stringify({ evento: 'cliente.prontidao_indisponivel', clientId, erro: erro instanceof Error ? erro.message.slice(0, 300) : 'erro' }));
    return null;
  }
});
