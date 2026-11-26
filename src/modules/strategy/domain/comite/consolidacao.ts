import type { Parecer, Veredito } from './parecer.ts';
import { PERSONAS, type Persona } from './personas.ts';

export type PontoReferenciado = { readonly persona: string; readonly pontoId: string };

export type Argumento = {
  readonly trecho: string;
  readonly fontes: readonly string[];
  readonly pontos: readonly PontoReferenciado[];
  readonly personas: readonly string[];
  readonly problemas: readonly string[];
};

export type PendenciaObrigatoria = PontoReferenciado & { readonly trecho: string };

export type Consolidacao = {
  readonly argumentos: readonly Argumento[];
  readonly totalDePontos: number;
  readonly totalDeArgumentos: number;
  readonly vereditos: Readonly<Record<Veredito, number>>;
  readonly pendenciasObrigatorias: readonly PendenciaObrigatoria[];
};

type Acumulador = { trecho: string; fontes: string[]; pontos: PontoReferenciado[]; problemas: string[] };

function chaveDoArgumento(trecho: string, fontes: readonly string[], persona: string, pontoId: string): string {
  if (fontes.length === 0) return `sem_fonte|${persona}|${pontoId}`;
  return `${trecho}|${fontes.join(',')}`;
}

export function consolidarPareceres(pareceres: readonly Parecer[], personas: readonly Persona[] = PERSONAS): Consolidacao {
  const acumulados = new Map<string, Acumulador>();
  const vereditos: Record<Veredito, number> = { aprova: 0, aprova_com_ajuste: 0, reprova: 0 };
  const pendencias: PendenciaObrigatoria[] = [];
  let totalDePontos = 0;

  for (const parecer of pareceres) {
    vereditos[parecer.veredito] += 1;
    const obriga = personas.find((p) => p.chave === parecer.persona)?.reprovacaoObrigaAjuste === true;
    for (const ponto of parecer.pontos) {
      totalDePontos += 1;
      const fontes = [...new Set(ponto.fontes)].sort();
      const chave = chaveDoArgumento(ponto.trecho, fontes, parecer.persona, ponto.id);
      const atual = acumulados.get(chave) ?? { trecho: ponto.trecho, fontes, pontos: [], problemas: [] };
      atual.pontos.push({ persona: parecer.persona, pontoId: ponto.id });
      atual.problemas.push(ponto.problema);
      acumulados.set(chave, atual);
      if (obriga && parecer.veredito === 'reprova') {
        pendencias.push({ persona: parecer.persona, pontoId: ponto.id, trecho: ponto.trecho });
      }
    }
  }

  const argumentos = [...acumulados.values()]
    .map((a): Argumento => ({
      trecho: a.trecho,
      fontes: a.fontes,
      pontos: a.pontos,
      personas: [...new Set(a.pontos.map((p) => p.persona))].sort(),
      problemas: a.problemas,
    }))
    .sort((a, b) => a.trecho.localeCompare(b.trecho) || a.fontes.join(',').localeCompare(b.fontes.join(',')));

  return { argumentos, totalDePontos, totalDeArgumentos: argumentos.length, vereditos, pendenciasObrigatorias: pendencias };
}
