import { agora, type TabelasDaPlataforma } from '@/modules/coleta/infrastructure/tabelas/tipos';
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
};
