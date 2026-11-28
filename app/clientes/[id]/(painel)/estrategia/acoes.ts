'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { escopoDoClienteNaOrganizacao } from '@/../app/clientes/[id]/_escopo';
import { modules } from '@/composition';
import { comAviso } from '@/modules/clients/domain/painel/enderecos';
import {
  camposBrutosDasEntradas,
  lerEdicaoPorCampos,
  lerIdDoCampo,
  lerIntencaoDoFormulario,
  lerPedidoDeMudanca,
  lerPedidoDePrevia,
  trocarSecao,
  type CamposBrutos,
} from '@/modules/strategy/interface/formulariosDaEstrategia';
import { errosPorCampo, formularioDeNovoPlano, previaNaTela, type FormularioDeNovoPlano, type PreviaNaTela } from '@/modules/strategy/interface/formularioDeNovoPlano';
import { aplicarCampos, errosPorCampoDaSecao, gruposEditaveis } from '@/modules/strategy/interface/camposEditaveisDaSecao';
import { CATALOGOS_DISPONIVEIS } from '@/modules/strategy/domain/index';
import { valorDaEdicao } from '@/modules/strategy/interface/edicaoDeSugestao';
import { rotaDaListaDePlanos, rotaDoPlano } from '@/modules/strategy/interface/rotasDaEstrategia';
import type { MemberRole } from '@/modules/identity/domain/user';
import { atorAtual } from '@/shared/http/ator';
import type { Failure } from '@/shared/result/failure';
import type { Result } from '@/shared/result/result';

export type EstadoDoFormulario = {
  readonly erro?: string;
  readonly campos?: Readonly<Record<string, string>>;
  readonly valores?: Readonly<Record<string, string | undefined>>;
  readonly formulario?: FormularioDeNovoPlano;
  readonly previa?: PreviaNaTela;
};

const NAO_ENCONTRADO: EstadoDoFormulario = { erro: 'Cliente não encontrado.' };
const LIMITE_DA_MENSAGEM = 400;

function camposDo(formData: FormData): CamposBrutos {
  return camposBrutosDasEntradas(formData.entries());
}

function textoDaFalha(falha: Failure): string {
  const detalhes = falha.code === 'validation' && falha.details ? Object.entries(falha.details).filter(([chave]) => chave !== 'codigo').map(([, valor]) => valor).join(' ') : '';
  return `${falha.message}${detalhes ? ` ${detalhes}` : ''}`.slice(0, LIMITE_DA_MENSAGEM);
}

function emEstado(falha: Failure, valores: CamposBrutos): EstadoDoFormulario {
  return falha.details ? { erro: falha.message, campos: falha.details, valores } : { erro: falha.message, valores };
}

function destinoDaTela(clienteId: string, planoId: string | null): string {
  return planoId ? rotaDoPlano(clienteId, planoId) : rotaDaListaDePlanos(clienteId);
}

function concluir(clienteId: string, planoId: string | null, mensagem: string): never {
  redirect(comAviso(destinoDaTela(clienteId, planoId), 'feito', mensagem));
}

function falhar(clienteId: string, planoId: string | null, mensagem: string): never {
  redirect(comAviso(destinoDaTela(clienteId, planoId), 'erro', mensagem));
}

type ComandoDaAcao = { readonly organizationId: string; readonly papelDeQuemAge: MemberRole };

async function planoDoCliente(comando: ComandoDaAcao, clientId: string, planoId: string): Promise<boolean> {
  return (await modules().strategy.service.clienteDoPlano(comando, planoId)) === clientId;
}

async function versaoDoCliente(comando: ComandoDaAcao, clientId: string, versaoId: string): Promise<boolean> {
  return (await modules().strategy.service.clienteDaVersao(comando, versaoId)) === clientId;
}

async function execucaoDoCliente(comando: ComandoDaAcao, clientId: string, execucaoId: string): Promise<boolean> {
  return (await modules().strategy.service.clienteDaExecucao(comando, execucaoId)) === clientId;
}

const PLANO_MUDOU: EstadoDoFormulario = { erro: 'O plano mudou enquanto você editava. Recarregue a página.' };

async function resolver<T>(clienteId: string, planoId: string, resultado: Result<T, Failure>, mensagem: string, valores: CamposBrutos): Promise<EstadoDoFormulario> {
  if (!resultado.ok) return emEstado(resultado.error, valores);
  return concluir(clienteId, planoId, mensagem);
}

type EscopoDaAcao = NonNullable<Awaited<ReturnType<typeof escopoDoClienteNaOrganizacao>>>;

async function estadoDoFormulario(escopo: EscopoDaAcao, valores: CamposBrutos, extra: Omit<EstadoDoFormulario, 'formulario' | 'valores'>): Promise<EstadoDoFormulario> {
  const modelo = await modules().strategy.service.modeloDeCriacao(escopo.comando, { clienteId: escopo.cliente.id });
  return { ...extra, valores, ...(modelo.ok ? { formulario: formularioDeNovoPlano(modelo.value, valores, escopo.cliente.id) } : {}) };
}

function erroDoNovoPlano(falha: Failure): Pick<EstadoDoFormulario, 'erro' | 'campos'> {
  const campos = errosPorCampo(falha.details);
  return Object.keys(campos).length > 0 ? { erro: falha.message, campos } : { erro: falha.message };
}

async function previaDoNovoPlano(escopo: EscopoDaAcao, campos: CamposBrutos): Promise<EstadoDoFormulario> {
  const pedido = lerPedidoDePrevia(campos);
  if (!pedido.ok) return estadoDoFormulario(escopo, campos, { campos: pedido.error });
  const previa = await modules().strategy.service.previaDeUtm(escopo.comando, { clienteId: escopo.cliente.id, ...pedido.value, plataformas: [...pedido.value.plataformas] });
  if (!previa.ok) return estadoDoFormulario(escopo, campos, erroDoNovoPlano(previa.error));
  return estadoDoFormulario(escopo, campos, { previa: previaNaTela(previa.value) });
}

const CHAVE_VALIDA = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function novoPlanoAcao(_anterior: EstadoDoFormulario, formData: FormData): Promise<EstadoDoFormulario> {
  const campos = camposDo(formData);
  const escopo = await escopoDoClienteNaOrganizacao(campos['clienteId']);
  if (!escopo) return NAO_ENCONTRADO;
  if (campos['acao'] === 'previa') return previaDoNovoPlano(escopo, campos);
  const entrada = lerIntencaoDoFormulario(campos);
  if (!entrada.ok) return estadoDoFormulario(escopo, campos, { erro: 'Corrija os campos indicados.', campos: entrada.error });
  const resultado = await modules().strategy.service.pedirPlano(
    escopo.comando,
    {
      clienteId: escopo.cliente.id,
      tipoDePlano: entrada.value.tipoDePlano,
      plataformas: [...entrada.value.plataformas],
      landingPageId: entrada.value.landingPageId,
      foco: entrada.value.foco.tipo === 'marca' ? { tipo: 'marca' } : { tipo: 'produtos', produtos: [...entrada.value.foco.produtos] },
      intencao: entrada.value.intencao,
      ...(CHAVE_VALIDA.test(campos['chaveDeIdempotencia'] ?? '') ? { chaveDeIdempotencia: campos['chaveDeIdempotencia'] } : {}),
    },
    await atorAtual(),
  );
  if (!resultado.ok) return estadoDoFormulario(escopo, campos, erroDoNovoPlano(resultado.error));
  return concluir(escopo.cliente.id, resultado.value.plano.id, 'Plano pedido. O agente está trabalhando; isso leva alguns minutos.');
}

export async function pedirMudancaAcao(_anterior: EstadoDoFormulario, formData: FormData): Promise<EstadoDoFormulario> {
  const campos = camposDo(formData);
  const escopo = await escopoDoClienteNaOrganizacao(campos['clienteId']);
  if (!escopo) return NAO_ENCONTRADO;
  const entrada = lerPedidoDeMudanca(campos);
  if (!entrada.ok) return { erro: 'Corrija os campos indicados.', campos: entrada.error, valores: campos };
  const comando = { organizationId: escopo.comando.organizationId, papelDeQuemAge: escopo.comando.papelDeQuemAge };
  if (!(await planoDoCliente(comando, escopo.cliente.id, entrada.value.planoId))) return { erro: 'Plano não encontrado.', valores: campos };
  const vista = await modules().strategy.service.versaoVistaDoPlano(comando, { clienteId: escopo.cliente.id, planoId: entrada.value.planoId });
  if (vista?.id !== entrada.value.versaoId) return { ...PLANO_MUDOU, valores: campos };
  const { versaoId: _versaoId, ...pedido } = entrada.value;
  const resultado = await modules().strategy.service.pedirMudanca(comando, pedido, await atorAtual());
  return resolver(escopo.cliente.id, entrada.value.planoId, resultado, 'Mudança pedida. O agente está ajustando o plano.', campos);
}

function secaoDoConteudo(conteudo: unknown, secao: string): unknown {
  return typeof conteudo === 'object' && conteudo !== null && !Array.isArray(conteudo) ? (conteudo as Record<string, unknown>)[secao] : undefined;
}

export async function editarSecaoAcao(_anterior: EstadoDoFormulario, formData: FormData): Promise<EstadoDoFormulario> {
  const campos = camposDo(formData);
  const escopo = await escopoDoClienteNaOrganizacao(campos['clienteId']);
  if (!escopo) return NAO_ENCONTRADO;
  const entrada = lerEdicaoPorCampos(campos);
  if (!entrada.ok) return { erro: Object.values(entrada.error).join(' ').slice(0, LIMITE_DA_MENSAGEM), campos: entrada.error, valores: campos };
  const comando = { organizationId: escopo.comando.organizationId, papelDeQuemAge: escopo.comando.papelDeQuemAge };
  if (!(await planoDoCliente(comando, escopo.cliente.id, entrada.value.planoId))) return { erro: 'Plano não encontrado.', valores: campos };
  const vista = await modules().strategy.service.versaoVistaDoPlano(comando, { clienteId: escopo.cliente.id, planoId: entrada.value.planoId, comConteudo: true });
  if (!vista) return { erro: 'O plano ainda não tem versão para editar.', valores: campos };
  if (vista.id !== entrada.value.versaoId) return { ...PLANO_MUDOU, valores: campos };
  const secaoAtual = secaoDoConteudo(vista.conteudo, entrada.value.secao);
  const aplicada = aplicarCampos(entrada.value.secao, secaoAtual, entrada.value.pares, CATALOGOS_DISPONIVEIS);
  if (!aplicada.ok) return { erro: 'Corrija os campos indicados.', campos: aplicada.error, valores: campos };
  const conteudo = trocarSecao(vista.conteudo, entrada.value.secao, aplicada.value);
  if (!conteudo) return { erro: 'O plano guardado está num formato que não permite edição.', valores: campos };
  const resultado = await modules().strategy.service.editarManual(comando, { planoId: entrada.value.planoId, conteudo }, await atorAtual());
  if (resultado.ok) return concluir(escopo.cliente.id, entrada.value.planoId, 'Seção editada. O plano será revisado de novo.');
  const porCampo = errosPorCampoDaSecao(entrada.value.secao, resultado.error.details, gruposEditaveis(entrada.value.secao, secaoAtual, CATALOGOS_DISPONIVEIS));
  const soltos = Object.entries(resultado.error.details ?? {}).filter(([chave]) => chave !== 'codigo').map(([, mensagem]) => mensagem);
  const erro = `${resultado.error.message}${Object.keys(porCampo).length === 0 && soltos.length > 0 ? ` ${soltos.join(' ')}` : ''}`.slice(0, LIMITE_DA_MENSAGEM);
  return { erro, campos: porCampo, valores: campos };
}

type CasoDeVersao = 'aplicar' | 'autorizar' | 'rejeitar' | 'revogar' | 'cancelarVersao';

const SUCESSO_POR_CASO: Readonly<Record<CasoDeVersao, string>> = {
  aplicar: 'Plano aplicado: ele aguarda quem autoriza.',
  autorizar: 'Plano autorizado.',
  rejeitar: 'Plano rejeitado.',
  revogar: 'Plano revogado.',
  cancelarVersao: 'Rascunho cancelado.',
};

async function planoDaTela(comando: ComandoDaAcao, clienteId: string, campos: CamposBrutos): Promise<string | null> {
  const lido = lerIdDoCampo(campos, 'planoId');
  if (!lido.ok) return null;
  return (await planoDoCliente(comando, clienteId, lido.value)) ? lido.value : null;
}

async function agirNaVersao(formData: FormData, caso: CasoDeVersao): Promise<void> {
  const campos = camposDo(formData);
  const escopo = await escopoDoClienteNaOrganizacao(campos['clienteId']);
  if (!escopo) redirect('/clientes');
  const planoId = await planoDaTela(escopo.comando, escopo.cliente.id, campos);
  const versaoId = lerIdDoCampo(campos, 'versaoId');
  if (!versaoId.ok) falhar(escopo.cliente.id, planoId, 'Versão inválida.');
  const comando = { organizationId: escopo.comando.organizationId, papelDeQuemAge: escopo.comando.papelDeQuemAge };
  if (!(await versaoDoCliente(comando, escopo.cliente.id, versaoId.value))) falhar(escopo.cliente.id, planoId, 'Versão do plano não encontrada.');
  const resultado = await modules().strategy.service[caso](comando, { versaoId: versaoId.value }, await atorAtual());
  if (!resultado.ok) falhar(escopo.cliente.id, planoId, textoDaFalha(resultado.error));
  concluir(escopo.cliente.id, planoId, SUCESSO_POR_CASO[caso]);
}

export async function aplicarAcao(formData: FormData): Promise<void> {
  return agirNaVersao(formData, 'aplicar');
}

export async function autorizarAcao(formData: FormData): Promise<void> {
  return agirNaVersao(formData, 'autorizar');
}

export async function rejeitarAcao(formData: FormData): Promise<void> {
  return agirNaVersao(formData, 'rejeitar');
}

export async function revogarAcao(formData: FormData): Promise<void> {
  return agirNaVersao(formData, 'revogar');
}

export async function cancelarRascunhoAcao(formData: FormData): Promise<void> {
  return agirNaVersao(formData, 'cancelarVersao');
}

export async function pedirRevisaoAcao(formData: FormData): Promise<void> {
  const campos = camposDo(formData);
  const escopo = await escopoDoClienteNaOrganizacao(campos['clienteId']);
  if (!escopo) redirect('/clientes');
  const planoId = await planoDaTela(escopo.comando, escopo.cliente.id, campos);
  if (planoId === null) falhar(escopo.cliente.id, null, 'Plano não encontrado.');
  const comando = { organizationId: escopo.comando.organizationId, papelDeQuemAge: escopo.comando.papelDeQuemAge };
  const resultado = await modules().strategy.service.pedirRevisao(comando, { planoId }, await atorAtual());
  if (!resultado.ok) falhar(escopo.cliente.id, planoId, textoDaFalha(resultado.error));
  concluir(escopo.cliente.id, planoId, 'Revisão pedida. O agente está atualizando o plano.');
}

export async function cancelarExecucaoAcao(formData: FormData): Promise<void> {
  const campos = camposDo(formData);
  const escopo = await escopoDoClienteNaOrganizacao(campos['clienteId']);
  if (!escopo) redirect('/clientes');
  const planoId = await planoDaTela(escopo.comando, escopo.cliente.id, campos);
  const execucaoId = lerIdDoCampo(campos, 'execucaoId');
  if (!execucaoId.ok) falhar(escopo.cliente.id, planoId, 'Execução inválida.');
  const comando = { organizationId: escopo.comando.organizationId, papelDeQuemAge: escopo.comando.papelDeQuemAge };
  if (!(await execucaoDoCliente(comando, escopo.cliente.id, execucaoId.value))) falhar(escopo.cliente.id, planoId, 'Execução não encontrada.');
  const resultado = await modules().strategy.service.cancelarExecucao(comando, { execucaoId: execucaoId.value }, await atorAtual());
  if (!resultado.ok) falhar(escopo.cliente.id, planoId, textoDaFalha(resultado.error));
  concluir(escopo.cliente.id, planoId, 'Execução cancelada.');
}

export async function apagarPlanoAcao(formData: FormData): Promise<void> {
  const campos = camposDo(formData);
  const escopo = await escopoDoClienteNaOrganizacao(campos['clienteId']);
  if (!escopo) redirect('/clientes');
  const planoId = await planoDaTela(escopo.comando, escopo.cliente.id, campos);
  if (planoId === null) falhar(escopo.cliente.id, null, 'Plano não encontrado.');
  const resultado = await modules().strategy.service.removerPlano(escopo.comando, { clienteId: escopo.cliente.id, planoId }, await atorAtual());
  if (!resultado.ok) falhar(escopo.cliente.id, resultado.error.code === 'not_found' ? null : planoId, textoDaFalha(resultado.error));
  concluir(escopo.cliente.id, null, 'Plano apagado.');
}

export async function corrigirFalhaDoGateAcao(formData: FormData): Promise<void> {
  const campos = camposDo(formData);
  const escopo = await escopoDoClienteNaOrganizacao(campos['clienteId']);
  if (!escopo) redirect('/clientes');
  const planoId = await planoDaTela(escopo.comando, escopo.cliente.id, campos);
  if (planoId === null) falhar(escopo.cliente.id, null, 'Plano não encontrado.');
  const resultado = await modules().strategy.service.corrigirFalhaDoGate(escopo.comando, { clienteId: escopo.cliente.id, planoId }, await atorAtual());
  if (!resultado.ok) falhar(escopo.cliente.id, planoId, textoDaFalha(resultado.error));
  concluir(escopo.cliente.id, planoId, 'Correção pedida. O agente está ajustando o plano.');
}

export async function tentarDeNovoAcao(formData: FormData): Promise<void> {
  const campos = camposDo(formData);
  const escopo = await escopoDoClienteNaOrganizacao(campos['clienteId']);
  if (!escopo) redirect('/clientes');
  const planoId = await planoDaTela(escopo.comando, escopo.cliente.id, campos);
  if (planoId === null) falhar(escopo.cliente.id, null, 'Plano não encontrado.');
  const resultado = await modules().strategy.service.tentarDeNovo(escopo.comando, { clienteId: escopo.cliente.id, planoId }, await atorAtual());
  if (!resultado.ok) falhar(escopo.cliente.id, planoId, textoDaFalha(resultado.error));
  concluir(escopo.cliente.id, planoId, 'Pedido repetido. O agente está trabalhando de novo.');
}

export type EstadoDasSugestoes = { readonly erro?: string; readonly porLacuna?: Readonly<Record<string, string>> };

function textoDasSugestoes(aprovadas: number, falhas: number): string {
  const aprovou = `${aprovadas} ${aprovadas === 1 ? 'sugestão aprovada' : 'sugestões aprovadas'}`;
  return falhas === 0 ? `${aprovou}.` : `${aprovou}; ${falhas} ${falhas === 1 ? 'não pôde ser aprovada' : 'não puderam ser aprovadas'}.`;
}

export async function aprovarSugestoesAcao(_anterior: EstadoDasSugestoes, formData: FormData): Promise<EstadoDasSugestoes> {
  const campos = camposDo(formData);
  const escopo = await escopoDoClienteNaOrganizacao(campos['clienteId']);
  if (!escopo) redirect('/clientes');
  const planoId = await planoDaTela(escopo.comando, escopo.cliente.id, campos);
  if (planoId === null) return falhar(escopo.cliente.id, null, 'Plano não encontrado.');
  const marcadas = formData.getAll('lacunaId').filter((valor): valor is string => typeof valor === 'string');
  if (marcadas.length === 0) return { erro: 'Marque ao menos uma sugestão para aprovar.' };
  const painel = await modules().strategy.service.painelDoPlano(escopo.comando, { clienteId: escopo.cliente.id, planoId });
  const lacunas = painel.ok ? (painel.value.planos[0]?.lacunas ?? []) : [];
  const itens = marcadas.map((lacunaId) => {
    const lacuna = lacunas.find((candidata) => candidata.id === lacunaId);
    const digitado = formData.get(`valor:${lacunaId}`);
    const edicao = lacuna?.valorSugerido && typeof digitado === 'string' ? valorDaEdicao(lacuna.valorSugerido, digitado, lacuna.valorLegivel) : { valor: null };
    return edicao.valor === null ? { lacunaId } : { lacunaId, valor: edicao.valor };
  });
  const resultado = await modules().strategy.service.aprovarSugestoesDeLacunas(escopo.comando, { clienteId: escopo.cliente.id, planoId, itens }, await atorAtual());
  if (!resultado.ok) {
    const porLacuna: Record<string, string> = {};
    for (const [caminho, mensagem] of Object.entries(resultado.error.details ?? {})) {
      const posicao = /^itens\.(\d+)/.exec(caminho)?.[1];
      const lacunaId = posicao === undefined ? undefined : marcadas[Number(posicao)];
      if (lacunaId !== undefined) porLacuna[lacunaId] ??= mensagem;
    }
    return { erro: textoDaFalha(resultado.error), porLacuna };
  }
  const { aprovadas, falhas } = resultado.value;
  const porLacuna: Record<string, string> = {};
  for (const item of resultado.value.itens) if (item.erro) porLacuna[item.lacunaId] = item.erro.mensagem;
  if (falhas === 0) return concluir(escopo.cliente.id, planoId, textoDasSugestoes(aprovadas, falhas));
  revalidatePath(rotaDoPlano(escopo.cliente.id, planoId));
  return { erro: textoDasSugestoes(aprovadas, falhas), porLacuna };
}
