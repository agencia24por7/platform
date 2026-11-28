import type { MemberRole } from '../../identity/domain/user.ts';
import type { PainelDoPlano } from '../application/estrategiaService.ts';
import type { Plano } from '../application/portas.ts';
import { podeExecutar } from '../domain/papeis.ts';
import { esquemaIntencao, type Intencao } from '../domain/plano.ts';
import { textoDoFocoCompleto } from './focoNaTela.ts';
import { periodoBr, reais } from './formatosDoPlano.ts';
import type { CamposBrutos } from './formulariosDaEstrategia.ts';
import { rotaDaListaDePlanos } from './rotasDaEstrategia.ts';
import { ROTULO_DA_OUSADIA, ROTULO_DA_PLATAFORMA_DO_PLANO } from './rotulosDoPlano.ts';

export const PARAMETRO_DO_PLANO_DE_ORIGEM = 'de';
export const TITULO_DO_PEDIDO = 'O que foi pedido';
export const ROTULO_DE_EDITAR_O_PEDIDO = 'Editar e pedir de novo';
export const NOTA_DE_EDITAR_O_PEDIDO = 'Editar abre o formulário já preenchido e cria um plano novo. Este continua na lista até você apagar.';

export type ItemDoPedido = { readonly rotulo: string; readonly valor: string };

export type PedidoNaTela = {
  readonly titulo: string;
  readonly itens: readonly ItemDoPedido[];
  readonly editar: { readonly rotulo: string; readonly href: string; readonly nota: string } | null;
};

export function intencaoDoPedido(painel: Pick<PainelDoPlano, 'execucaoAtiva' | 'ultimaExecucao'>): Intencao | null {
  const execucao = painel.execucaoAtiva ?? painel.ultimaExecucao;
  if (!execucao || execucao.tipo !== 'criar') return null;
  const lida = esquemaIntencao.safeParse(execucao.pedido);
  return lida.success ? lida.data : null;
}

function semPrefixoDeMoeda(valor: string): string {
  return valor.replace(/^R\$\s*/, '');
}

function itensDoPedido(plano: Plano, intencao: Intencao): ItemDoPedido[] {
  const foco = textoDoFocoCompleto(plano.foco ?? intencao.foco);
  const plataformas = intencao.plataformas.map((plataforma) => ROTULO_DA_PLATAFORMA_DO_PLANO[plataforma] ?? plataforma).join(', ');
  const itens: (ItemDoPedido | null)[] = [
    { rotulo: 'Objetivo', valor: intencao.objetivo },
    foco ? { rotulo: 'Foco do plano', valor: foco } : null,
    { rotulo: 'Plataformas', valor: plataformas },
    { rotulo: 'Landing page', valor: intencao.destino.url },
    { rotulo: 'Horizonte', valor: periodoBr(intencao.horizonte) },
    { rotulo: 'Verba do período', valor: reais(intencao.verba) },
    { rotulo: 'Retorno esperado', valor: intencao.retorno_esperado.descricao },
    { rotulo: 'Ousadia', valor: ROTULO_DA_OUSADIA[intencao.ousadia] ?? intencao.ousadia },
  ];
  return itens.filter((item): item is ItemDoPedido => item !== null);
}

export function pedidoNaTela(entrada: { readonly painel: PainelDoPlano; readonly papel: MemberRole; readonly clienteId: string }): PedidoNaTela | null {
  const { painel, papel, clienteId } = entrada;
  const intencao = intencaoDoPedido(painel);
  if (!intencao) return null;
  const podeEditar = painel.execucaoAtiva === null && podeExecutar('criar', { tipo: 'pessoa', papel });
  return {
    titulo: TITULO_DO_PEDIDO,
    itens: itensDoPedido(painel.plano, intencao),
    editar: podeEditar
      ? { rotulo: ROTULO_DE_EDITAR_O_PEDIDO, href: rotaDaListaDePlanos(clienteId, { novo: '1', [PARAMETRO_DO_PLANO_DE_ORIGEM]: painel.plano.id }), nota: NOTA_DE_EDITAR_O_PEDIDO }
      : null,
  };
}

export function valoresDoPlanoDeOrigem(painel: Pick<PainelDoPlano, 'plano' | 'execucaoAtiva' | 'ultimaExecucao'> | null): CamposBrutos {
  const intencao = painel ? intencaoDoPedido(painel) : null;
  return painel && intencao ? camposDoPedido(painel.plano, intencao) : {};
}

export function camposDoPedido(plano: Pick<Plano, 'tipo' | 'landingPageId' | 'foco'>, intencao: Intencao): CamposBrutos {
  const foco = plano.foco ?? intencao.foco ?? null;
  return {
    tipoDePlano: plano.tipo,
    plataformas: intencao.plataformas.join(','),
    landingPageId: plano.landingPageId ?? intencao.destino.landingPageId,
    ...(foco?.tipo === 'marca' ? { focoMarca: '1' } : {}),
    ...(foco?.tipo === 'produtos' ? { produtos: foco.produtos.map((produto) => produto.urn).join(',') } : {}),
    objetivo: intencao.objetivo,
    inicio: intencao.horizonte.inicio,
    fim: intencao.horizonte.fim,
    ousadia: intencao.ousadia,
    retorno: intencao.retorno_esperado.descricao,
    verba: semPrefixoDeMoeda(reais(intencao.verba)),
    modoDaVerba: 'periodo',
  };
}
