'use server';

import { redirect } from 'next/navigation';
import { escopoDoClienteNaOrganizacao } from '@/../app/clientes/[id]/_escopo';
import { modules } from '@/composition';
import { comAviso, rotaDoCliente } from '@/modules/clients/domain/painel/enderecos';
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
  redirect(comAviso(rotaDoCliente(clienteId, 'contexto'), tipo, mensagem.slice(0, LIMITE_DA_MENSAGEM)));
}

async function executar<T>(
  formData: FormData,
  sucesso: string,
  chamar: (comando: { organizationId: string; clientId: string; papelDeQuemAge: MemberRole }) => Promise<Result<T, Failure>>,
): Promise<never> {
  const escopo = await escopoDoClienteNaOrganizacao(texto(formData, 'clienteId'));
  if (!escopo) redirect('/clientes');
  const resultado = await chamar(escopo.comando);
  if (!resultado.ok) voltar(escopo.cliente.id, 'erro', mensagemDoErro(resultado.error));
  return voltar(escopo.cliente.id, 'feito', sucesso);
}

function mensagemDoErro(falha: Failure): string {
  const detalhes = falha.details ? Object.values(falha.details) : [];
  return detalhes.length > 0 ? detalhes.join(' ') : falha.message;
}

export async function criarSinalDeCulturaAcao(formData: FormData): Promise<void> {
  const dados = {
    tipo: texto(formData, 'tipo'),
    titulo: texto(formData, 'titulo'),
    resumo: texto(formData, 'resumo'),
    fonteNome: texto(formData, 'fonteNome'),
    fonteUrl: texto(formData, 'fonteUrl'),
    plataforma: texto(formData, 'plataforma'),
    observadoEm: texto(formData, 'observadoEm'),
    validoAte: texto(formData, 'validoAte'),
    nota: texto(formData, 'nota'),
  };
  const ator = await atorAtual();
  return executar(formData, 'Sinal de cultura cadastrado.', (comando) => modules().cultura.criar({ ...comando, dados }, ator));
}

export async function arquivarSinalDeCulturaAcao(formData: FormData): Promise<void> {
  const sinalId = texto(formData, 'sinalId');
  const ator = await atorAtual();
  return executar(formData, 'Sinal de cultura arquivado.', (comando) => modules().cultura.arquivar({ ...comando, sinalId }, ator));
}
