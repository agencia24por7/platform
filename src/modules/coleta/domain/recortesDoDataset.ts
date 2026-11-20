import { booleano, contagem, dataIso, texto, type LinhaDaFonte } from './valoresSeguros.ts';

export const TabelaPixel = {
  Dataset: 'dim_dataset',
  Recortes: 'recortes',
} as const;

export const Recorte = {
  Dispositivo: 'dispositivo',
  SistemaOperacional: 'sistema_operacional',
  NavegadorDoVisitante: 'navegador_do_visitante',
  Host: 'host',
  ChaveDeCorrespondencia: 'chave_de_correspondencia',
  ResultadoDoProcessamento: 'resultado_do_processamento',
} as const;
export type Recorte = (typeof Recorte)[keyof typeof Recorte];

export const AGREGACAO_DO_RECORTE: Readonly<Record<Recorte, string>> = {
  dispositivo: 'device_type',
  sistema_operacional: 'device_os',
  navegador_do_visitante: 'browser_type',
  host: 'host',
  chave_de_correspondencia: 'match_keys',
  resultado_do_processamento: 'event_processing_results',
};

const RECORTES: readonly string[] = Object.values(Recorte);
const HOST = /^[a-z0-9]([a-z0-9.-]{0,198}[a-z0-9])?$/;
const VALOR_ENUMERADO = /^[A-Za-z0-9_ .+-]{1,60}$/;
const ENUMERACAO_LONGA = /^[A-Z_]{1,60}$/;

export type RecorteDoDia = {
  readonly data_dia: string;
  readonly recorte: Recorte;
  readonly valor: string;
  readonly quantidade: number;
};

export type DatasetMeta = {
  readonly nome: string | null;
  readonly indisponivel: boolean | null;
  readonly correspondencia_automatica: boolean | null;
  readonly cookie_primeira_parte: string | null;
  readonly uso_de_dados: string | null;
};

const hostDe = (valor: string): string => (valor.toLowerCase().split('://').pop() ?? '').split(/[/?#:]/)[0] ?? '';

export function valorDoRecorte(recorte: string, valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const limpo = valor.trim();
  if (recorte === Recorte.Host) {
    const host = hostDe(limpo);
    return HOST.test(host) ? host : null;
  }
  return VALOR_ENUMERADO.test(limpo) ? limpo : null;
}

export function recorteDaLinha(linha: LinhaDaFonte): RecorteDoDia | null {
  const dataDia = dataIso(linha.dataDia);
  const recorte = typeof linha.recorte === 'string' && RECORTES.includes(linha.recorte) ? (linha.recorte as Recorte) : null;
  const valor = recorte ? valorDoRecorte(recorte, linha.valor) : null;
  const quantidade = contagem(linha.quantidade);
  if (!dataDia || !recorte || !valor || quantidade === null) return null;
  return { data_dia: dataDia, recorte, valor, quantidade };
}

const enumeracaoLonga = (valor: unknown): string | null => (typeof valor === 'string' && ENUMERACAO_LONGA.test(valor) ? valor : null);

export function datasetDaLinha(linha: LinhaDaFonte): DatasetMeta | null {
  const dataset: DatasetMeta = {
    nome: texto(linha.nome),
    indisponivel: booleano(linha.indisponivel),
    correspondencia_automatica: booleano(linha.correspondenciaAutomatica),
    cookie_primeira_parte: enumeracaoLonga(linha.cookiePrimeiraParte),
    uso_de_dados: enumeracaoLonga(linha.usoDeDados),
  };
  return Object.values(dataset).some((valor) => valor !== null) ? dataset : null;
}
