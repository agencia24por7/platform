import { agora, type TabelasDaPlataforma } from '@/modules/coleta/infrastructure/tabelas/tipos';
import { dimensaoScd2, fatoDeLinhas } from '@/modules/coleta/infrastructure/tabelas/construtores';
import { TabelaLeadAds, formularioDaLinha, leadsDoDiaDaLinha, paginaDaLinha } from '@/modules/coleta/domain/leadsMeta';
import { dataDoSnapshot } from '@/modules/coleta/domain/negociacoesRd';
import {
  COLUNAS_DO_FATO_FORMULARIOS,
  TIPOS_DO_FATO_FORMULARIOS,
  formulariosUnicos,
  linhaDoFatoFormularios,
  type FormularioMeta,
} from '@/modules/coleta/domain/formulariosMeta';

type FormularioDoDia = FormularioMeta & { readonly dataSnapshot: string };

export const TABELAS_LEADADS: TabelasDaPlataforma = {
  padrao: {
    tipo: 'fato',
    staging: 'stg_meta_formularios',
    fato: 'fato_meta_formularios',
    chave: ['organization_id', 'page_id', 'form_id', 'data_snapshot'],
    colunas: COLUNAS_DO_FATO_FORMULARIOS,
    tipos: TIPOS_DO_FATO_FORMULARIOS,
    preparar: (linhas) => {
      const dataSnapshot = dataDoSnapshot(new Date());
      return formulariosUnicos(linhas).map((formulario) => ({ ...formulario, dataSnapshot }));
    },
    mapear: (linha, ctx) => {
      const formulario = linha as unknown as FormularioDoDia;
      return linhaDoFatoFormularios(formulario, {
        organizationId: ctx.organizationId,
        pageId: ctx.externalId,
        dataSnapshot: formulario.dataSnapshot,
        execucaoId: ctx.execucaoId,
        inseridoEm: agora(),
      });
    },
  },
  [TabelaLeadAds.Pagina]: dimensaoScd2({
    colunaDaFonte: 'page_id', staging: 'stg_dim_meta_pagina', dimensao: 'dim_meta_pagina_scd2', chaveLocal: [],
    atributos: ['nome', 'categoria'], converter: paginaDaLinha, tipos: { nome: 'STRING', categoria: 'STRING' },
  }),
  [TabelaLeadAds.Formulario]: dimensaoScd2({
    colunaDaFonte: 'page_id', staging: 'stg_dim_meta_formulario', dimensao: 'dim_meta_formulario_scd2', chaveLocal: ['form_id'],
    atributos: ['nome', 'status', 'idioma', 'perguntas_total', 'tipos_de_pergunta'], converter: formularioDaLinha,
    tipos: { form_id: 'STRING', nome: 'STRING', status: 'STRING', idioma: 'STRING', perguntas_total: 'INT64', tipos_de_pergunta: 'STRING' },
  }),
  [TabelaLeadAds.LeadsDiarios]: fatoDeLinhas({
    colunaDaFonte: 'page_id', staging: 'stg_meta_leads_diario', fato: 'fato_meta_leads_diario',
    chaveLocal: ['form_id', 'data_dia', 'anuncio_id', 'campanha_id'], metricas: ['leads'], converter: leadsDoDiaDaLinha,
    tipos: { form_id: 'STRING', data_dia: 'DATE', anuncio_id: 'STRING', campanha_id: 'STRING', leads: 'INT64' },
  }),
};
