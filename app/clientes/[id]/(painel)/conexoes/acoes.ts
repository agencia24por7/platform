'use server';

import { redirect } from 'next/navigation';
import { clienteNoEscopo } from '@/../app/clientes/[id]/_escopo';
import { modules } from '@/composition';
import { comAviso, rotaDoCliente } from '@/modules/clients/domain/painel/enderecos';
import { text, toActionState } from '@/shared/http/actions';
import { atorAtual } from '@/shared/http/ator';
import { requireContext } from '@/shared/http/currentOrganization';
import { failure, type Failure } from '@/shared/result/failure';
import { err, type Result } from '@/shared/result/result';

type Contexto = Awaited<ReturnType<typeof requireContext>>;

const NAO_ENCONTRADO = failure('not_found', 'Não encontrado neste cliente.');

function concluir(clientId: string, resultado: Result<unknown, Failure>, sucesso: string, secao: 'fontes' | null = 'fontes'): never {
  const destino = rotaDoCliente(clientId, 'conexoes', secao ? { secao } : {});
  if (!resultado.ok) redirect(comAviso(destino, 'erro', toActionState(resultado.error).error ?? 'Não foi possível concluir.'));
  redirect(comAviso(destino, 'feito', sucesso));
}

async function clienteVisivel(ctx: Contexto, clientId: string): Promise<boolean> {
  return (await clienteNoEscopo(ctx, clientId)) !== null;
}

async function contaDoCliente(ctx: Contexto, clientId: string, accountId: string): Promise<boolean> {
  if (!(await clienteVisivel(ctx, clientId))) return false;
  const contas = await modules().connections.listAccountsByClient(ctx.organization.id, clientId);
  return contas.some((c) => c.id === accountId);
}

async function fonteDoCliente(ctx: Contexto, clientId: string, recursoId: string): Promise<boolean> {
  if (!(await clienteVisivel(ctx, clientId))) return false;
  const fontes = await modules().recursos.listarPorCliente(ctx.organization.id, clientId);
  return fontes.some((f) => f.id === recursoId);
}

export async function mudarSituacao(formData: FormData): Promise<void> {
  const ctx = await requireContext();
  const clientId = text(formData, 'clientId');
  if (!(await clienteVisivel(ctx, clientId))) concluir(clientId, err(NAO_ENCONTRADO), '', null);
  const resultado = await modules().clients.mudarSituacao(
    { organizationId: ctx.organization.id, papelDeQuemAge: ctx.role, clientId, situacao: text(formData, 'situacao') },
    await atorAtual(),
  );
  concluir(clientId, resultado, 'Situação atualizada.', null);
}

export async function moverConta(formData: FormData): Promise<void> {
  const ctx = await requireContext();
  const origem = text(formData, 'clientId');
  const accountId = text(formData, 'accountId');
  const destinoId = text(formData, 'destinoId');
  if (!(await contaDoCliente(ctx, origem, accountId)) || !(await clienteVisivel(ctx, destinoId))) concluir(origem, err(NAO_ENCONTRADO), '');
  const resultado = await modules().connections.reassignAccount(
    { organizationId: ctx.organization.id, papelDeQuemAge: ctx.role, accountId, clientId: destinoId },
    await atorAtual(),
  );
  concluir(origem, resultado, 'Conta movida. O histórico foi junto.');
}

export async function alternarColeta(formData: FormData): Promise<void> {
  const ctx = await requireContext();
  const origem = text(formData, 'clientId');
  const accountId = text(formData, 'accountId');
  if (!(await contaDoCliente(ctx, origem, accountId))) concluir(origem, err(NAO_ENCONTRADO), '');
  const resultado = await modules().connections.setAccountSync(
    { organizationId: ctx.organization.id, papelDeQuemAge: ctx.role, accountId, enabled: text(formData, 'ligar') === 'sim' },
    await atorAtual(),
  );
  concluir(origem, resultado, 'Coleta atualizada.');
}

export async function desvincularContaDeAnuncio(formData: FormData): Promise<void> {
  const ctx = await requireContext();
  const origem = text(formData, 'clientId');
  const accountId = text(formData, 'accountId');
  if (!(await contaDoCliente(ctx, origem, accountId))) concluir(origem, err(NAO_ENCONTRADO), '');
  const resultado = await modules().connections.unlinkAccount(
    { organizationId: ctx.organization.id, papelDeQuemAge: ctx.role, accountId },
    await atorAtual(),
  );
  concluir(origem, resultado, 'Conta desvinculada. Sai da coleta; o histórico coletado continua no BigQuery.');
}

export async function moverFonte(formData: FormData): Promise<void> {
  const ctx = await requireContext();
  const origem = text(formData, 'clientId');
  const recursoId = text(formData, 'recursoId');
  const destinoId = text(formData, 'destinoId');
  if (!(await fonteDoCliente(ctx, origem, recursoId)) || !(await clienteVisivel(ctx, destinoId))) concluir(origem, err(NAO_ENCONTRADO), '');
  const resultado = await modules().recursos.mover(
    { organizationId: ctx.organization.id, papelDeQuemAge: ctx.role, recursoId, clientId: destinoId },
    await atorAtual(),
  );
  concluir(origem, resultado, 'Fonte movida. A próxima coleta já grava no novo cliente.');
}

export async function desvincularFonte(formData: FormData): Promise<void> {
  const ctx = await requireContext();
  const origem = text(formData, 'clientId');
  const recursoId = text(formData, 'recursoId');
  if (!(await fonteDoCliente(ctx, origem, recursoId))) concluir(origem, err(NAO_ENCONTRADO), '');
  const resultado = await modules().recursos.desvincular(
    { organizationId: ctx.organization.id, papelDeQuemAge: ctx.role, recursoId },
    await atorAtual(),
  );
  concluir(origem, resultado, 'Fonte desvinculada. Ela sai da coleta e volta para a lista sem dono.');
}
