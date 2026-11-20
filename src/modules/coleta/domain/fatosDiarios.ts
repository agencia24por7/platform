export const VALOR_AUSENTE = '(not set)';
export const TAMANHO_MAXIMO_DA_DIMENSAO = 2048;

export type TipoDeMetrica = 'INT64' | 'NUMERIC';

export type RecorteDeFato = {
  readonly tabela: string;
  readonly fato: string;
  readonly staging: string;
  readonly colunaDaFonte: string;
  readonly dimensoes: readonly string[];
  readonly metricas: Readonly<Record<string, TipoDeMetrica>>;
};

export type ContextoDaLinhaDeFato = {
  readonly organizationId: string;
  readonly fonteId: string;
  readonly execucaoId: string;
  readonly inseridoEm: string;
};

export function recorteDeFato(
  tabela: string,
  prefixo: string,
  colunaDaFonte: string,
  dimensoes: readonly string[],
  metricas: Readonly<Record<string, TipoDeMetrica>>,
): RecorteDeFato {
  return { tabela, fato: `fato_${prefixo}`, staging: `stg_${prefixo}`, colunaDaFonte, dimensoes, metricas };
}

export function chaveDoRecorte(recorte: RecorteDeFato): readonly string[] {
  return ['organization_id', recorte.colunaDaFonte, 'data_dia', ...recorte.dimensoes];
}

export function colunasDoRecorte(recorte: RecorteDeFato): readonly string[] {
  return [...chaveDoRecorte(recorte), ...Object.keys(recorte.metricas), 'execucao_id', 'inserido_em'];
}

export function tiposDoRecorte(recorte: RecorteDeFato): Readonly<Record<string, string>> {
  const chave = Object.fromEntries(
    chaveDoRecorte(recorte).map((coluna) => [coluna, coluna === 'data_dia' ? 'DATE' : 'STRING']),
  );
  return { ...chave, ...recorte.metricas, execucao_id: 'STRING', inserido_em: 'TIMESTAMP' };
}

export function textoDaDimensao(valor: unknown): string {
  if (valor === null || valor === undefined) return VALOR_AUSENTE;
  const texto = String(valor);
  return texto === '' ? VALOR_AUSENTE : texto.slice(0, TAMANHO_MAXIMO_DA_DIMENSAO);
}

export function numeroDaMetrica(valor: unknown, tipo: TipoDeMetrica): number {
  const numero = Number(valor ?? 0);
  if (!Number.isFinite(numero)) return 0;
  return tipo === 'INT64' ? Math.round(numero) : Math.round(numero * 1e6) / 1e6;
}

export function linhaDoRecorte(
  recorte: RecorteDeFato,
  linha: Readonly<Record<string, unknown>>,
  contexto: ContextoDaLinhaDeFato,
): Record<string, unknown> {
  const dimensoes = Object.fromEntries(recorte.dimensoes.map((coluna) => [coluna, textoDaDimensao(linha[coluna])]));
  const metricas = Object.fromEntries(
    Object.entries(recorte.metricas).map(([coluna, tipo]) => [coluna, numeroDaMetrica(linha[coluna], tipo)]),
  );
  return {
    organization_id: contexto.organizationId,
    [recorte.colunaDaFonte]: contexto.fonteId,
    data_dia: linha.metricDate,
    ...dimensoes,
    ...metricas,
    execucao_id: contexto.execucaoId,
    inserido_em: contexto.inseridoEm,
  };
}
