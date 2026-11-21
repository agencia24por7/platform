'use server';

import { redirect } from 'next/navigation';
import { modules } from '@/composition';
import { comAviso, rotaDoCliente } from '@/modules/clients/domain/painel/enderecos';
import { text, toActionState } from '@/shared/http/actions';
import { atorAtual } from '@/shared/http/ator';
import { requireContext } from '@/shared/http/currentOrganization';
import type { Failure } from '@/shared/result/failure';
import type { Result } from '@/shared/result/result';

function concluir(clientId: string, resultado: Result<unknown, Failure>, sucesso: string, secao: 'fontes' | null = 'fontes'): never {
  const destino = rotaDoCliente(clientId, 'conexoes', secao ? { secao } : {});
  if (!resultado.ok) redirect(comAviso(destino, 'erro', toActionState(resultado.error).error ?? 'Não foi possível concluir.'));
  redirect(comAviso(destino, 'feito', sucesso));
}

export async function mudarSituacao(formData: FormData): Promise<void> {
  const ctx = await requireContext();
  const clientId = text(formData, 'clientId');
  const resultado = await modules().clients.mudarSituacao(
    { organizationId: ctx.organization.id, papelDeQuemAge: ctx.role, clientId, situacao: text(formData, 'situacao') },
    await atorAtual(),
  );
  concluir(clientId, resultado, 'Situação atualizada.', null);
}

export async function moverConta(formData: FormData): Promise<void> {
  const ctx = await requireContext();
  const origem = text(formData, 'clientId');
  const resultado = await modules().connections.reassignAccount(
    {
      organizationId: ctx.organization.id,
      papelDeQuemAge: ctx.role,
      accountId: text(formData, 'accountId'),
      clientId: text(formData, 'destinoId'),
    },
    await atorAtual(),
  );
  concluir(origem, resultado, 'Conta movida. O histórico foi junto.');
}

export async function alternarColeta(formData: FormData): Promise<void> {
  const ctx = await requireContext();
  const origem = text(formData, 'clientId');
  const resultado = await modules().connections.setAccountSync(
    {
      organizationId: ctx.organization.id,
      papelDeQuemAge: ctx.role,
      accountId: text(formData, 'accountId'),
      enabled: text(formData, 'ligar') === 'sim',
    },
    await atorAtual(),
  );
  concluir(origem, resultado, 'Coleta atualizada.');
}

export async function desvincularContaDeAnuncio(formData: FormData): Promise<void> {
  const ctx = await requireContext();
  const origem = text(formData, 'clientId');
  const resultado = await modules().connections.unlinkAccount(
    { organizationId: ctx.organization.id, papelDeQuemAge: ctx.role, accountId: text(formData, 'accountId') },
    await atorAtual(),
  );
  concluir(origem, resultado, 'Conta desvinculada. Sai da coleta; o histórico coletado continua no BigQuery.');
}

export async function moverFonte(formData: FormData): Promise<void> {
  const ctx = await requireContext();
  const origem = text(formData, 'clientId');
  const resultado = await modules().recursos.mover(
    {
      organizationId: ctx.organization.id,
      papelDeQuemAge: ctx.role,
      recursoId: text(formData, 'recursoId'),
      clientId: text(formData, 'destinoId'),
    },
    await atorAtual(),
  );
  concluir(origem, resultado, 'Fonte movida. A próxima coleta já grava no novo cliente.');
}

export async function desvincularFonte(formData: FormData): Promise<void> {
  const ctx = await requireContext();
  const origem = text(formData, 'clientId');
  const resultado = await modules().recursos.desvincular(
    { organizationId: ctx.organization.id, papelDeQuemAge: ctx.role, recursoId: text(formData, 'recursoId') },
    await atorAtual(),
  );
  concluir(origem, resultado, 'Fonte desvinculada. Ela sai da coleta e volta para a lista sem dono.');
}
