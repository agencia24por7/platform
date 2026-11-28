'use server';

import { redirect } from 'next/navigation';
import { escopoDoClienteNaOrganizacao } from '@/../app/clientes/[id]/_escopo';
import { modules } from '@/composition';
import { comAviso, idValido } from '@/modules/clients/domain/painel/enderecos';
import { rotaDoPlanoDeProducao } from '@/modules/strategy/interface/planoDeProducao';
import { rotaDaListaDePlanos } from '@/modules/strategy/interface/rotasDaEstrategia';
import { atorAtual } from '@/shared/http/ator';

const LIMITE_DA_MENSAGEM = 400;

export async function gerarPlanoDeProducaoAcao(formData: FormData): Promise<void> {
  const clienteId = formData.get('clienteId');
  const planoId = formData.get('planoId');
  const escopo = await escopoDoClienteNaOrganizacao(clienteId);
  if (!escopo) redirect('/clientes');
  if (typeof planoId !== 'string' || !idValido(planoId)) redirect(comAviso(rotaDaListaDePlanos(escopo.cliente.id), 'erro', 'Plano inválido.'));
  const destino = rotaDoPlanoDeProducao(escopo.cliente.id, planoId);
  const comando = { organizationId: escopo.comando.organizationId, papelDeQuemAge: escopo.comando.papelDeQuemAge };
  const resultado = await modules().strategy.producao.pedir(comando, { clienteId: escopo.cliente.id, planoId }, await atorAtual());
  if (!resultado.ok) redirect(comAviso(destino, 'erro', resultado.error.message.slice(0, LIMITE_DA_MENSAGEM)));
  redirect(comAviso(destino, 'feito', 'Plano de produção pedido. O agente está gerando por campanha.'));
}
