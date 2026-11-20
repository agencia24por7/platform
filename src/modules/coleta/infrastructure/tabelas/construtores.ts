import { aplicar, chaveUnica, type LinhaDaFonte } from '@/modules/coleta/domain/valoresSeguros';
import { agora, type ConfiguracaoFato, type ConfiguracaoScd2, type ContextoGravacao, type TiposDasColunas } from '@/modules/coleta/infrastructure/tabelas/tipos';

type Convertida = Readonly<Record<string, unknown>>;

type Base<T extends Convertida> = {
  readonly colunaDaFonte: string;
  readonly chaveLocal: readonly (keyof T & string)[];
  readonly converter: (linha: LinhaDaFonte) => T | null;
  readonly tipos: TiposDasColunas;
};

const chaveDe = <T extends Convertida>(chaveLocal: readonly (keyof T & string)[]) => (item: T): string =>
  JSON.stringify(chaveLocal.map((coluna) => item[coluna]));

const preparar = <T extends Convertida>(base: Base<T>) => (linhas: readonly LinhaDaFonte[]): readonly LinhaDaFonte[] =>
  chaveUnica(aplicar(linhas, base.converter), chaveDe(base.chaveLocal)) as readonly LinhaDaFonte[];

const tiposCompletos = (base: { readonly colunaDaFonte: string; readonly tipos: TiposDasColunas }): TiposDasColunas => ({
  organization_id: 'STRING',
  [base.colunaDaFonte]: 'STRING',
  ...base.tipos,
});

const identidade = (ctx: ContextoGravacao, colunaDaFonte: string): Record<string, unknown> => ({
  organization_id: ctx.organizationId,
  [colunaDaFonte]: ctx.externalId,
});

export function dimensaoScd2<T extends Convertida>(
  base: Base<T> & { readonly staging: string; readonly dimensao: string; readonly atributos: readonly string[] },
): ConfiguracaoScd2 {
  return {
    tipo: 'scd2',
    staging: base.staging,
    dimensao: base.dimensao,
    chave: ['organization_id', base.colunaDaFonte, ...base.chaveLocal],
    atributos: base.atributos,
    tipos: tiposCompletos(base),
    preparar: preparar(base),
    mapear: (linha, ctx) => ({ ...identidade(ctx, base.colunaDaFonte), ...linha }),
  };
}

export function fatoDeLinhas<T extends Convertida>(
  base: Base<T> & { readonly staging: string; readonly fato: string; readonly metricas: readonly string[] },
): ConfiguracaoFato {
  const chave = ['organization_id', base.colunaDaFonte, ...base.chaveLocal];
  return {
    tipo: 'fato',
    staging: base.staging,
    fato: base.fato,
    chave,
    colunas: [...chave, ...base.metricas, 'execucao_id', 'inserido_em'],
    tipos: { ...tiposCompletos(base), execucao_id: 'STRING', inserido_em: 'TIMESTAMP' },
    preparar: preparar(base),
    mapear: (linha, ctx) => ({ ...identidade(ctx, base.colunaDaFonte), ...linha, execucao_id: ctx.execucaoId, inserido_em: agora() }),
  };
}
