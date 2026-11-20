import { booleano, contagem, texto, type LinhaDaFonte } from './valoresSeguros.ts';

export const TabelaGtm = {
  Conteiner: 'dim_conteiner',
  Workspace: 'dim_workspace',
  Versao: 'dim_versao',
  Tag: 'dim_tag',
  Acionador: 'dim_acionador',
  Variavel: 'dim_variavel',
} as const;

const ID_DO_GTM = /^[0-9]{1,20}$/;
const TIPO_DO_GTM = /^[A-Za-z0-9_]{1,60}$/;
const CONTEXTO_DE_USO = /^[a-z_]{1,30}$/;

export type ConteinerGtm = {
  readonly nome: string | null;
  readonly conta_gtm_id: string | null;
  readonly conteiner_gtm_id: string | null;
  readonly contexto_de_uso: string | null;
  readonly dominios: string | null;
};
export type WorkspaceGtm = { readonly workspace_id: string; readonly nome: string | null };
export type VersaoGtm = {
  readonly versao_id: string;
  readonly nome: string | null;
  readonly total_tags: number | null;
  readonly total_acionadores: number | null;
  readonly total_variaveis: number | null;
};
export type TagGtm = {
  readonly tag_id: string;
  readonly nome: string | null;
  readonly tipo: string | null;
  readonly acionadores_disparo: string | null;
  readonly acionadores_bloqueio: string | null;
  readonly pausada: boolean | null;
};
export type AcionadorGtm = { readonly acionador_id: string; readonly nome: string | null; readonly tipo: string | null };
export type VariavelGtm = { readonly variavel_id: string; readonly nome: string | null; readonly tipo: string | null };

const idDoGtm = (valor: unknown): string | null => (typeof valor === 'string' && ID_DO_GTM.test(valor) ? valor : null);
const tipoDoGtm = (valor: unknown): string | null => (typeof valor === 'string' && TIPO_DO_GTM.test(valor) ? valor : null);

const listaDeIds = (valor: unknown): string | null => {
  if (typeof valor !== 'string') return null;
  const ids = valor.split(',').filter((id) => ID_DO_GTM.test(id));
  return [...new Set(ids)].sort().join(',');
};

const listaDeTextos = (valor: unknown, aceita: RegExp): string | null => {
  if (typeof valor !== 'string') return null;
  const itens = valor.split(',').map((item) => item.trim()).filter((item) => aceita.test(item));
  return [...new Set(itens)].sort().join(',');
};

const DOMINIO = /^[A-Za-z0-9.-]{1,200}$/;

export function conteinerDaLinha(linha: LinhaDaFonte): ConteinerGtm | null {
  const conteiner: ConteinerGtm = {
    nome: texto(linha.nome),
    conta_gtm_id: idDoGtm(linha.contaGtmId),
    conteiner_gtm_id: idDoGtm(linha.conteinerGtmId),
    contexto_de_uso: listaDeTextos(linha.contextoDeUso, CONTEXTO_DE_USO),
    dominios: listaDeTextos(linha.dominios, DOMINIO),
  };
  return Object.values(conteiner).some((valor) => valor !== null) ? conteiner : null;
}

export function workspaceDaLinha(linha: LinhaDaFonte): WorkspaceGtm | null {
  const workspaceId = idDoGtm(linha.workspaceId);
  return workspaceId ? { workspace_id: workspaceId, nome: texto(linha.nome) } : null;
}

export function versaoDaLinha(linha: LinhaDaFonte): VersaoGtm | null {
  const versaoId = idDoGtm(linha.versaoId);
  if (!versaoId) return null;
  return {
    versao_id: versaoId,
    nome: texto(linha.nome),
    total_tags: contagem(linha.totalTags),
    total_acionadores: contagem(linha.totalAcionadores),
    total_variaveis: contagem(linha.totalVariaveis),
  };
}

export function tagDaLinha(linha: LinhaDaFonte): TagGtm | null {
  const tagId = idDoGtm(linha.tagId);
  if (!tagId) return null;
  return {
    tag_id: tagId,
    nome: texto(linha.nome),
    tipo: tipoDoGtm(linha.tipo),
    acionadores_disparo: listaDeIds(linha.acionadoresDisparo),
    acionadores_bloqueio: listaDeIds(linha.acionadoresBloqueio),
    pausada: booleano(linha.pausada),
  };
}

export function acionadorDaLinha(linha: LinhaDaFonte): AcionadorGtm | null {
  const acionadorId = idDoGtm(linha.acionadorId);
  return acionadorId ? { acionador_id: acionadorId, nome: texto(linha.nome), tipo: tipoDoGtm(linha.tipo) } : null;
}

export function variavelDaLinha(linha: LinhaDaFonte): VariavelGtm | null {
  const variavelId = idDoGtm(linha.variavelId);
  return variavelId ? { variavel_id: variavelId, nome: texto(linha.nome), tipo: tipoDoGtm(linha.tipo) } : null;
}
