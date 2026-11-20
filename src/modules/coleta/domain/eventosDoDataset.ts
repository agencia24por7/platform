export const FUSO_DOS_EVENTOS = 'America/Sao_Paulo';

export const OrigemDoEvento = {
  Total: 'total',
  Navegador: 'navegador',
  Servidor: 'servidor',
} as const;
export type OrigemDoEvento = (typeof OrigemDoEvento)[keyof typeof OrigemDoEvento];

const ORIGENS: readonly string[] = Object.values(OrigemDoEvento);

export const FILTRO_DA_ORIGEM: Readonly<Record<OrigemDoEvento, string | null>> = {
  total: null,
  navegador: 'WEB_ONLY',
  servidor: 'SERVER_ONLY',
};

export const CAMPOS_DO_EVENTO = ['dataDia', 'evento', 'origem', 'quantidade'] as const;

export type EventoDoDia = {
  readonly dataDia: string;
  readonly evento: string;
  readonly origem: OrigemDoEvento;
  readonly quantidade: number;
};

export type Janela = { readonly start: string; readonly end: string };

const TAMANHO_MAXIMO_DO_EVENTO = 200;
const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

function deslocamentoDoFuso(instante: Date, fuso: string): number {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: fuso,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instante);
  const valor = (tipo: string) => Number(partes.find((parte) => parte.type === tipo)?.value);
  const comoUtc = Date.UTC(valor('year'), valor('month') - 1, valor('day'), valor('hour'), valor('minute'), valor('second'));
  return comoUtc - Math.floor(instante.getTime() / 1000) * 1000;
}

export function meiaNoiteNoFuso(dia: string, fuso: string = FUSO_DOS_EVENTOS): number {
  const [ano, mes, diaDoMes] = dia.split('-').map(Number) as [number, number, number];
  const ingenuo = Date.UTC(ano, mes - 1, diaDoMes);
  const primeiraTentativa = ingenuo - deslocamentoDoFuso(new Date(ingenuo), fuso);
  return Math.floor((ingenuo - deslocamentoDoFuso(new Date(primeiraTentativa), fuso)) / 1000);
}

export function limitesDaJanela(janela: Janela, fuso: string = FUSO_DOS_EVENTOS): { readonly startTime: number; readonly endTime: number } {
  const [ano, mes, dia] = janela.end.split('-').map(Number) as [number, number, number];
  const diaSeguinte = new Date(Date.UTC(ano, mes - 1, dia + 1)).toISOString().slice(0, 10);
  return { startTime: meiaNoiteNoFuso(janela.start, fuso), endTime: meiaNoiteNoFuso(diaSeguinte, fuso) };
}

export function instanteDoBalde(valor: unknown): Date | null {
  if (typeof valor === 'number' && Number.isFinite(valor)) return new Date(valor * 1000);
  if (typeof valor !== 'string' || !valor) return null;
  if (/^\d+$/.test(valor)) return new Date(Number(valor) * 1000);
  const normalizado = valor.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const data = new Date(normalizado);
  return Number.isNaN(data.getTime()) ? null : data;
}

export function diaNoFuso(instante: Date, fuso: string = FUSO_DOS_EVENTOS): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instante);
}

function nomeDoEvento(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const limpo = valor.trim();
  return limpo ? limpo.slice(0, TAMANHO_MAXIMO_DO_EVENTO) : null;
}

function contagem(valor: unknown): number | null {
  const numero = typeof valor === 'string' && valor.trim() !== '' ? Number(valor) : valor;
  return typeof numero === 'number' && Number.isFinite(numero) && numero >= 0 ? Math.trunc(numero) : null;
}

type Balde = { start_time?: unknown; data?: unknown };

export function agregarPorDia(
  baldes: readonly unknown[],
  origem: OrigemDoEvento,
  janela: Janela | null = null,
  fuso: string = FUSO_DOS_EVENTOS,
): readonly EventoDoDia[] {
  const somas = new Map<string, EventoDoDia>();

  for (const balde of baldes as Balde[]) {
    const instante = instanteDoBalde(balde?.start_time);
    if (!instante || !Array.isArray(balde.data)) continue;
    const dataDia = diaNoFuso(instante, fuso);
    if (janela && (dataDia < janela.start || dataDia > janela.end)) continue;

    for (const item of balde.data as { value?: unknown; count?: unknown }[]) {
      const evento = nomeDoEvento(item?.value);
      const quantidade = contagem(item?.count);
      if (!evento || quantidade === null) continue;
      const chave = `${dataDia}|${evento}`;
      const anterior = somas.get(chave);
      somas.set(chave, { dataDia, evento, origem, quantidade: (anterior?.quantidade ?? 0) + quantidade });
    }
  }

  return [...somas.values()].sort((a, b) => (a.dataDia === b.dataDia ? a.evento.localeCompare(b.evento) : a.dataDia.localeCompare(b.dataDia)));
}

export function eventoDaLinha(bruta: Readonly<Record<string, unknown>>): EventoDoDia | null {
  const dataDia = typeof bruta.dataDia === 'string' && DATA_ISO.test(bruta.dataDia) ? bruta.dataDia : null;
  const evento = nomeDoEvento(bruta.evento);
  const origem = typeof bruta.origem === 'string' && ORIGENS.includes(bruta.origem) ? (bruta.origem as OrigemDoEvento) : null;
  const quantidade = contagem(bruta.quantidade);
  if (!dataDia || !evento || !origem || quantidade === null) return null;
  return { dataDia, evento, origem, quantidade };
}

export function eventosUnicos(linhas: readonly Readonly<Record<string, unknown>>[]): readonly EventoDoDia[] {
  const porChave = new Map<string, EventoDoDia>();
  for (const linha of linhas) {
    const evento = eventoDaLinha(linha);
    if (evento) porChave.set(`${evento.dataDia}|${evento.evento}|${evento.origem}`, evento);
  }
  return [...porChave.values()];
}

export type ContextoDoFatoEventos = {
  readonly organizationId: string;
  readonly clientId: string;
  readonly datasetId: string;
  readonly execucaoId: string;
  readonly inseridoEm: string;
};

export const COLUNAS_DO_FATO_EVENTOS = [
  'organization_id', 'client_id', 'dataset_id', 'data_dia', 'evento', 'origem', 'quantidade', 'execucao_id', 'inserido_em',
] as const;

export const TIPOS_DO_FATO_EVENTOS: Readonly<Record<(typeof COLUNAS_DO_FATO_EVENTOS)[number], string>> = {
  organization_id: 'STRING', client_id: 'STRING', dataset_id: 'STRING', data_dia: 'DATE', evento: 'STRING',
  origem: 'STRING', quantidade: 'INT64', execucao_id: 'STRING', inserido_em: 'TIMESTAMP',
};

export function linhaDoFatoEventos(evento: EventoDoDia, ctx: ContextoDoFatoEventos): Record<(typeof COLUNAS_DO_FATO_EVENTOS)[number], unknown> {
  return {
    organization_id: ctx.organizationId,
    client_id: ctx.clientId,
    dataset_id: ctx.datasetId,
    data_dia: evento.dataDia,
    evento: evento.evento,
    origem: evento.origem,
    quantidade: evento.quantidade,
    execucao_id: ctx.execucaoId,
    inserido_em: ctx.inseridoEm,
  };
}
