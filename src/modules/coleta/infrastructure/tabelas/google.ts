import type { TabelasDaPlataforma } from '@/modules/coleta/infrastructure/tabelas/tipos';
import { fatoAdsDiario } from '@/modules/coleta/infrastructure/tabelas/adsDiario';
import {
  ESPECIFICACAO_DIMENSOES, ESPECIFICACAO_FATOS, montarDimensao, montarFato,
} from '@/modules/coleta/infrastructure/tabelas/googleEspecificacao';

export const TABELAS_GOOGLE: TabelasDaPlataforma = {
  padrao: fatoAdsDiario('google'),
  ...Object.fromEntries(ESPECIFICACAO_FATOS.map((espec) => [espec.tabela, montarFato(espec)])),
  ...Object.fromEntries(ESPECIFICACAO_DIMENSOES.map((espec) => [espec.tabela, montarDimensao(espec)])),
};
