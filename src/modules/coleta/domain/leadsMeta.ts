import { contagem, dataIso, inteiro, texto, type LinhaDaFonte } from './valoresSeguros.ts';

export const TabelaLeadAds = {
  Pagina: 'dim_pagina',
  Formulario: 'dim_formulario',
  LeadsDiarios: 'leads_diarios',
} as const;

export const SEM_ANUNCIO = 'sem_anuncio';
export const SEM_CAMPANHA = 'sem_campanha';

const ID_DO_FACEBOOK = /^\d{5,25}$/;
const TIPO_DE_PERGUNTA = /^[A-Z_]{1,40}$/;
const IDIOMA = /^[A-Za-z]{2,3}(_[A-Za-z0-9]{2,4})?$/;

export type PaginaMeta = { readonly nome: string | null; readonly categoria: string | null };

export type FormularioDaPagina = {
  readonly form_id: string;
  readonly nome: string | null;
  readonly status: string | null;
  readonly idioma: string | null;
  readonly perguntas_total: number | null;
  readonly tipos_de_pergunta: string | null;
};

export type LeadsDoDia = {
  readonly form_id: string;
  readonly data_dia: string;
  readonly anuncio_id: string;
  readonly campanha_id: string;
  readonly leads: number;
};

const idDoFacebook = (valor: unknown): string | null => (typeof valor === 'string' && ID_DO_FACEBOOK.test(valor) ? valor : null);

const tiposDePergunta = (valor: unknown): string | null => {
  if (typeof valor !== 'string') return null;
  const tipos = valor.split(',').filter((tipo) => TIPO_DE_PERGUNTA.test(tipo));
  return [...new Set(tipos)].sort().join(',');
};

export function paginaDaLinha(linha: LinhaDaFonte): PaginaMeta | null {
  const pagina = { nome: texto(linha.nome), categoria: texto(linha.categoria) };
  return pagina.nome || pagina.categoria ? pagina : null;
}

export function formularioDaLinha(linha: LinhaDaFonte): FormularioDaPagina | null {
  const formId = idDoFacebook(linha.formId);
  if (!formId) return null;
  return {
    form_id: formId,
    nome: texto(linha.nome),
    status: typeof linha.status === 'string' && TIPO_DE_PERGUNTA.test(linha.status) ? linha.status : null,
    idioma: typeof linha.idioma === 'string' && IDIOMA.test(linha.idioma) ? linha.idioma : null,
    perguntas_total: contagem(inteiro(linha.perguntasTotal)),
    tipos_de_pergunta: tiposDePergunta(linha.tiposDePergunta),
  };
}

export function leadsDoDiaDaLinha(linha: LinhaDaFonte): LeadsDoDia | null {
  const formId = idDoFacebook(linha.formId);
  const dataDia = dataIso(linha.dataDia);
  const leads = contagem(linha.leads);
  if (!formId || !dataDia || leads === null) return null;
  return {
    form_id: formId,
    data_dia: dataDia,
    anuncio_id: idDoFacebook(linha.anuncioId) ?? SEM_ANUNCIO,
    campanha_id: idDoFacebook(linha.campanhaId) ?? SEM_CAMPANHA,
    leads,
  };
}
