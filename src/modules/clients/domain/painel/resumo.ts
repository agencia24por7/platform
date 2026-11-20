import type { CompletudeDaSecao } from '../contexto/completude.ts';

export type BarrasDaSecao = {
  readonly secao: string;
  readonly percentual: number;
  readonly essencial: { readonly feitos: number; readonly total: number; readonly percentual: number };
  readonly aprofundar: { readonly feitos: number; readonly total: number; readonly percentual: number };
  readonly estado: 'vazia' | 'comecada' | 'essencial_ok' | 'completa';
};

function pct(feitos: number, total: number): number {
  return total === 0 ? 100 : Math.round((feitos / total) * 100);
}

export function barrasDaSecao(c: CompletudeDaSecao): BarrasDaSecao {
  const aprofundarTotal = Math.max(c.total - c.essenciaisTotal, 0);
  const aprofundarFeitos = Math.max(c.preenchidos - c.essenciaisPreenchidos, 0);
  const estado =
    c.preenchidos === 0 ? 'vazia' : c.preenchidos >= c.total ? 'completa' : c.essenciaisCompletos ? 'essencial_ok' : 'comecada';
  return {
    secao: c.secao,
    percentual: c.percentual,
    essencial: { feitos: c.essenciaisPreenchidos, total: c.essenciaisTotal, percentual: pct(c.essenciaisPreenchidos, c.essenciaisTotal) },
    aprofundar: { feitos: aprofundarFeitos, total: aprofundarTotal, percentual: pct(aprofundarFeitos, aprofundarTotal) },
    estado,
  };
}

export type ResumoDaCompletude = {
  readonly geral: number;
  readonly secoesCompletas: number;
  readonly secoesComEssencialOk: number;
  readonly secoesVazias: number;
  readonly essenciaisFeitos: number;
  readonly essenciaisTotal: number;
  readonly faixa: 'inicio' | 'avancando' | 'bom' | 'excelente';
};

export function resumirCompletude(geral: number, secoes: readonly CompletudeDaSecao[]): ResumoDaCompletude {
  const barras = secoes.map(barrasDaSecao);
  return {
    geral,
    secoesCompletas: barras.filter((b) => b.estado === 'completa').length,
    secoesComEssencialOk: barras.filter((b) => b.estado === 'essencial_ok' || b.estado === 'completa').length,
    secoesVazias: barras.filter((b) => b.estado === 'vazia').length,
    essenciaisFeitos: secoes.reduce((s, c) => s + c.essenciaisPreenchidos, 0),
    essenciaisTotal: secoes.reduce((s, c) => s + c.essenciaisTotal, 0),
    faixa: geral >= 85 ? 'excelente' : geral >= 60 ? 'bom' : geral >= 25 ? 'avancando' : 'inicio',
  };
}

export type SaudeDosDados = {
  readonly frescas: number;
  readonly atrasadas: number;
  readonly paradas: number;
  readonly nunca: number;
  readonly pausadas: number;
  readonly total: number;
};

const HORA = 3_600_000;

export function saudeDosDados(
  contas: readonly { readonly lastSyncAt: Date | null; readonly syncEnabled: boolean }[],
  agora: Date,
): SaudeDosDados {
  let frescas = 0;
  let atrasadas = 0;
  let paradas = 0;
  let nunca = 0;
  let pausadas = 0;
  for (const conta of contas) {
    if (!conta.syncEnabled) {
      pausadas += 1;
      continue;
    }
    if (!conta.lastSyncAt) {
      nunca += 1;
      continue;
    }
    const horas = (agora.getTime() - conta.lastSyncAt.getTime()) / HORA;
    if (horas <= 36) frescas += 1;
    else if (horas <= 24 * 7) atrasadas += 1;
    else paradas += 1;
  }
  return { frescas, atrasadas, paradas, nunca, pausadas, total: contas.length };
}

export function tempoRelativo(data: Date | null, agora: Date): string {
  if (!data) return 'nunca';
  const segundos = Math.round((agora.getTime() - data.getTime()) / 1000);
  if (segundos < 0) {
    const dias = Math.ceil(-segundos / 86_400);
    return dias <= 1 ? 'em menos de 1 dia' : `em ${dias} dias`;
  }
  if (segundos < 60) return 'agora';
  const minutos = Math.floor(segundos / 60);
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${horas} h`;
  const dias = Math.floor(horas / 24);
  if (dias < 30) return dias === 1 ? 'há 1 dia' : `há ${dias} dias`;
  const meses = Math.floor(dias / 30);
  return meses === 1 ? 'há 1 mês' : `há ${meses} meses`;
}
