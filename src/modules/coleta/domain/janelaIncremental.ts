import type { Platform } from '@/modules/connections/domain/connection';
import type { Janela } from './coleta.ts';
import { Grao, fonteDe } from './mapaDeFontes.ts';

export const JANELA_MAXIMA_DIAS = 28;
export const FUSO_DA_ROTINA = 'America/Sao_Paulo';
export const FUSO_DAS_COTAS_DIARIAS = 'America/Los_Angeles';

export type HistoricoDeColeta = {
  readonly ultimaJanelaSucesso: string | null;
  readonly ultimaJanelaParcialRepetida: string | null;
  readonly ultimaIncrementalEm: Date | null;
  readonly ultimoLimiteDiarioEm: Date | null;
};

export const HISTORICO_VAZIO: HistoricoDeColeta = {
  ultimaJanelaSucesso: null,
  ultimaJanelaParcialRepetida: null,
  ultimaIncrementalEm: null,
  ultimoLimiteDiarioEm: null,
};

export type PlanoIncremental = {
  readonly janela: Janela;
  readonly marcaDagua: string | null;
  readonly comDimensoes: boolean;
  readonly emDia: boolean;
  readonly pausadaPorCota: boolean;
  readonly diasAtrasada: number;
};

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

function aconteceuHoje(instante: Date | null, agora: Date, fuso: string): boolean {
  return instante !== null && diaEm(instante, fuso) === diaEm(agora, fuso);
}

export function planejarColetaIncremental(platform: Platform, historico: HistoricoDeColeta, agora: Date = new Date()): PlanoIncremental {
  const fonte = fonteDe(platform);
  const hoje = diaEm(agora, FUSO_DA_ROTINA);
  const jaRodouHoje = aconteceuHoje(historico.ultimaIncrementalEm, agora, FUSO_DA_ROTINA);
  const pausadaPorCota = aconteceuHoje(historico.ultimoLimiteDiarioEm, agora, FUSO_DAS_COTAS_DIARIAS);
  const marca = marcaDagua(historico);

  if (ehSnapshot(platform)) {
    const ontem = somarDias(hoje, -1);
    return { janela: { start: ontem, end: ontem }, marcaDagua: marca, comDimensoes: true, emDia: jaRodouHoje, pausadaPorCota, diasAtrasada: jaRodouHoje ? 0 : 1 };
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
    diasAtrasada,
  };
}
