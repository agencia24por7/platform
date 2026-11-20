import { agora, type ConfiguracaoFato } from '@/modules/coleta/infrastructure/tabelas/tipos';
import {
  chaveDoRecorte,
  colunasDoRecorte,
  linhaDoRecorte,
  tiposDoRecorte,
  type RecorteDeFato,
} from '@/modules/coleta/domain/fatosDiarios';

export function configuracaoDoRecorte(recorte: RecorteDeFato): ConfiguracaoFato {
  return {
    tipo: 'fato',
    staging: recorte.staging,
    fato: recorte.fato,
    chave: chaveDoRecorte(recorte),
    colunas: colunasDoRecorte(recorte),
    tipos: tiposDoRecorte(recorte),
    mapear: (linha, ctx) =>
      linhaDoRecorte(recorte, linha, {
        organizationId: ctx.organizationId,
        fonteId: ctx.externalId,
        execucaoId: ctx.execucaoId,
        inseridoEm: agora(),
      }),
  };
}

export function configuracoesDosRecortes(recortes: readonly RecorteDeFato[]): Record<string, ConfiguracaoFato> {
  return Object.fromEntries(recortes.map((recorte) => [recorte.tabela, configuracaoDoRecorte(recorte)]));
}
