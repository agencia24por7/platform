import type { Platform } from '@/modules/connections/domain/connection';
import type { Janela } from './coleta.ts';
import { Grao, fonteDe } from './mapaDeFontes.ts';

export const JANELA_MAXIMA_DIAS = 28;
export const FUSO_DA_ROTINA = 'America/Sao_Paulo';
export const FUSO_DAS_COTAS_DIARIAS = 'America/Los_Angeles';
export const OCUPADA_POR_HORAS = 3;
export const ESPERA_MAXIMA_APOS_FALHAS_HORAS = 24;
const HORA_MS = 3_600_000;

export type HistoricoDeColeta = {
  readonly ultimaJanelaSucesso: string | null;
  readonly ultimaJanelaParcialRepetida: string | null;
  readonly ultimaIncrementalEm: Date | null;
  readonly pausaAte?: Date | null;
  readonly pausaDaPlataformaAte?: Date | null;
  readonly emExecucaoDesde?: Date | null;
  readonly ultimaTentativaEm?: Date | null;
  readonly falhasConsecutivas?: number;
};

export const HISTORICO_VAZIO: HistoricoDeColeta = {
  ultimaJanelaSucesso: null,
  ultimaJanelaParcialRepetida: null,
  ultimaIncrementalEm: null,
  pausaAte: null,
  pausaDaPlataformaAte: null,
  emExecucaoDesde: null,
  ultimaTentativaEm: null,
  falhasConsecutivas: 0,
};

export type PlanoIncremental = {
  readonly janela: Janela;
  readonly marcaDagua: string | null;
  readonly comDimensoes: boolean;
  readonly emDia: boolean;
  readonly pausadaPorCota: boolean;
  readonly ocupada: boolean;
  readonly emEspera: boolean;
  readonly marcaPorParcial: boolean;
  readonly diasAtrasada: number;
};

export function esperaAposFalhasHoras(falhasConsecutivas: number): number {
  if (falhasConsecutivas < 2) return 0;
  return Math.min(6 * 2 ** (falhasConsecutivas - 2), ESPERA_MAXIMA_APOS_FALHAS_HORAS);
}

export function podeRodar(plano: PlanoIncremental): boolean {
  return !plano.emDia && !plano.pausadaPorCota && !plano.ocupada && !plano.emEspera;
}

const DIA_MS = 86_400_000;

export function diaEm(instante: Date, fuso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instante);
}

export function somarDias(dia: string, dias: number): string {
  return new Date(Date.parse(`${dia}T00:00:00Z`) + dias * DIA_MS).toISOString().slice(0, 10);
}

export function diasEntre(inicio: string, fim: string): number {
  return Math.round((Date.parse(`${fim}T00:00:00Z`) - Date.parse(`${inicio}T00:00:00Z`)) / DIA_MS);
}

const maisRecente = (a: string | null, b: string | null): string | null => {
  if (a === null) return b;
  if (b === null) return a;
  return a > b ? a : b;
};

const maisAntigo = (a: string, b: string): string => (a < b ? a : b);

export function marcaDagua(historico: HistoricoDeColeta): string | null {
  return maisRecente(historico.ultimaJanelaSucesso, historico.ultimaJanelaParcialRepetida);
}

export function ehSnapshot(platform: Platform): boolean {
  const fonte = fonteDe(platform);
  return fonte.grao === Grao.Snapshot && fonte.lookbackDias === 0;
}

function estados(historico: HistoricoDeColeta, agora: Date) {
  const emExecucaoDesde = historico.emExecucaoDesde ?? null;
  const ultimaTentativaEm = historico.ultimaTentativaEm ?? null;
  const espera = esperaAposFalhasHoras(historico.falhasConsecutivas ?? 0) * HORA_MS;
  const marca = marcaDagua(historico);
  return {
    ocupada: emExecucaoDesde !== null && agora.getTime() - emExecucaoDesde.getTime() < OCUPADA_POR_HORAS * HORA_MS,
    emEspera: espera > 0 && ultimaTentativaEm !== null && agora.getTime() - ultimaTentativaEm.getTime() < espera,
    marcaPorParcial: marca !== null && marca === historico.ultimaJanelaParcialRepetida && marca !== historico.ultimaJanelaSucesso,
  };
}

function aconteceuHoje(instante: Date | null, agora: Date, fuso: string): boolean {
  return instante !== null && diaEm(instante, fuso) === diaEm(agora, fuso);
}

export type MotivoDaPausa = 'cota_diaria' | 'limite_temporario';
export type EscopoDaPausa = 'fonte' | 'plataforma';
export type PausaPedida = { readonly motivo: MotivoDaPausa; readonly minutos: number | null };
export type PausaCalculada = { readonly ate: Date; readonly motivo: MotivoDaPausa; readonly escopo: EscopoDaPausa };

const PLATAFORMAS_COM_COTA_COMPARTILHADA: readonly Platform[] = ['google', 'youtube'];
const PAUSA_TEMPORARIA_MAXIMA_MINUTOS = 6 * 60;

export function proximaMeiaNoiteEm(agora: Date, fuso: string): Date {
  const amanha = somarDias(diaEm(agora, fuso), 1);
  const meioDiaUtc = Date.parse(`${amanha}T12:00:00Z`);
  const hora = Number(new Intl.DateTimeFormat('en-US', { timeZone: fuso, hour: '2-digit', hourCycle: 'h23' }).format(new Date(meioDiaUtc)));
  const minuto = Number(new Intl.DateTimeFormat('en-US', { timeZone: fuso, minute: '2-digit' }).format(new Date(meioDiaUtc)));
  return new Date(meioDiaUtc - (hora * 60 + minuto) * 60_000);
}

export function calcularPausa(platform: Platform, pedida: PausaPedida | null, agora: Date = new Date()): PausaCalculada | null {
  if (!pedida) return null;
  if (pedida.motivo === 'cota_diaria') {
    return {
      ate: proximaMeiaNoiteEm(agora, FUSO_DAS_COTAS_DIARIAS),
      motivo: 'cota_diaria',
      escopo: PLATAFORMAS_COM_COTA_COMPARTILHADA.includes(platform) ? 'plataforma' : 'fonte',
    };
  }
  const minutos = Math.min(Math.max(pedida.minutos ?? 0, 0), PAUSA_TEMPORARIA_MAXIMA_MINUTOS);
  if (minutos === 0) return null;
  return { ate: new Date(agora.getTime() + minutos * 60_000), motivo: 'limite_temporario', escopo: 'fonte' };
}

export function ordemDeColeta(
  a: { readonly plano: PlanoIncremental; readonly ultimaTentativaEm: Date | null },
  b: { readonly plano: PlanoIncremental; readonly ultimaTentativaEm: Date | null },
): number {
  if (b.plano.diasAtrasada !== a.plano.diasAtrasada) return b.plano.diasAtrasada - a.plano.diasAtrasada;
  return (a.ultimaTentativaEm?.getTime() ?? 0) - (b.ultimaTentativaEm?.getTime() ?? 0);
}

export function planejarColetaIncremental(platform: Platform, historico: HistoricoDeColeta, agora: Date = new Date()): PlanoIncremental {
  const fonte = fonteDe(platform);
  const hoje = diaEm(agora, FUSO_DA_ROTINA);
  const jaRodouHoje = aconteceuHoje(historico.ultimaIncrementalEm, agora, FUSO_DA_ROTINA);
  const pausadaPorCota = [historico.pausaAte, historico.pausaDaPlataformaAte].some((ate) => ate instanceof Date && ate.getTime() > agora.getTime());
  const marca = marcaDagua(historico);

  if (ehSnapshot(platform)) {
    const ontem = somarDias(hoje, -1);
    return { janela: { start: ontem, end: ontem }, marcaDagua: marca, comDimensoes: true, emDia: jaRodouHoje, pausadaPorCota, ...estados(historico, agora), diasAtrasada: jaRodouHoje ? 0 : 1 };
  }

  const alvo = somarDias(hoje, -Math.max(fonte.atrasoDias, 1));
  const inicioMinimo = somarDias(alvo, -(fonte.historicoMaximoDias - 1));
  const inicioDesejado = marca === null
    ? somarDias(alvo, -(fonte.janelaInicialDias - 1))
    : somarDias(maisAntigo(marca, alvo), -(fonte.lookbackDias - 1));
  const start = inicioDesejado < inicioMinimo ? inicioMinimo : inicioDesejado;
  const end = maisAntigo(alvo, somarDias(start, JANELA_MAXIMA_DIAS - 1));
  const diasAtrasada = marca === null ? diasEntre(inicioMinimo, alvo) : Math.max(diasEntre(marca, alvo), 0);

  return {
    janela: { start, end },
    marcaDagua: marca,
    comDimensoes: !jaRodouHoje,
    emDia: marca !== null && marca >= alvo && jaRodouHoje,
    pausadaPorCota,
    ...estados(historico, agora),
    diasAtrasada,
  };
}
