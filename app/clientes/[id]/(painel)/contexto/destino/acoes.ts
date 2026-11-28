'use server';

import { redirect } from 'next/navigation';
import { escopoDoClienteNaOrganizacao } from '@/../app/clientes/[id]/_escopo';
import { modules } from '@/composition';
import { ANCORA_DO_MAPA, comAviso, rotaDoCliente } from '@/modules/clients/domain/painel/enderecos';
import type { MemberRole } from '@/modules/identity/domain/user';
import { atorAtual } from '@/shared/http/ator';
import type { Failure } from '@/shared/result/failure';
import type { Result } from '@/shared/result/result';

const LIMITE_DA_MENSAGEM = 300;

function texto(formData: FormData, campo: string): string {
  const valor = formData.get(campo);
  return typeof valor === 'string' ? valor : '';
}

function voltar(clienteId: string, tipo: 'feito' | 'erro', mensagem: string): never {
  redirect(`${comAviso(rotaDoCliente(clienteId, 'contexto', { secao: 'destino' }), tipo, mensagem.slice(0, LIMITE_DA_MENSAGEM))}#${ANCORA_DO_MAPA}`);
}

async function executar<T>(formData: FormData, sucesso: string, chamar: (comando: { organizationId: string; clientId: string; papelDeQuemAge: MemberRole }) => Promise<Result<T, Failure>>): Promise<never> {
  const escopo = await escopoDoClienteNaOrganizacao(texto(formData, 'clienteId'));
  if (!escopo) redirect('/clientes');
  const resultado = await chamar(escopo.comando);
  if (!resultado.ok) voltar(escopo.cliente.id, 'erro', resultado.error.message);
  return voltar(escopo.cliente.id, 'feito', sucesso);
}

export async function gravarWhatsappAcao(formData: FormData): Promise<void> {
  const whatsapp = texto(formData, 'whatsapp');
  const ator = await atorAtual();
  return executar(formData, 'WhatsApp salvo.', (comando) => modules().destino.gravarWhatsapp({ ...comando, whatsapp }, ator));
}

export async function criarLandingPageAcao(formData: FormData): Promise<void> {
  const url = texto(formData, 'url');
  const rotulo = texto(formData, 'rotulo');
  const ator = await atorAtual();
  return executar(formData, 'Landing page cadastrada.', (comando) => modules().destino.criarLandingPage({ ...comando, url, rotulo }, ator));
}

export async function arquivarLandingPageAcao(formData: FormData): Promise<void> {
  const landingPageId = texto(formData, 'landingPageId');
  const ator = await atorAtual();
  return executar(formData, 'Landing page arquivada.', (comando) => modules().destino.arquivarLandingPage({ ...comando, landingPageId }, ator));
}
