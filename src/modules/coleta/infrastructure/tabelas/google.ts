import type { TabelasDaPlataforma } from '@/modules/coleta/infrastructure/tabelas/tipos';
import { fatoAdsDiario } from '@/modules/coleta/infrastructure/tabelas/adsDiario';

export const TABELAS_GOOGLE: TabelasDaPlataforma = {
  padrao: fatoAdsDiario('google'),
};
