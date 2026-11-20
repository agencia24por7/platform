const FUSO = 'America/Sao_Paulo';
const DIA_MS = 86_400_000;

export function hojeEmSaoPaulo(agora: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);
}

function paraUtc(data: string): number {
  const [ano, mes, dia] = data.split('-').map(Number) as [number, number, number];
  return Date.UTC(ano, mes - 1, dia);
}

export function somarDias(data: string, dias: number): string {
  return new Date(paraUtc(data) + dias * DIA_MS).toISOString().slice(0, 10);
}

export function diasEntre(de: string, ate: string): number {
  return Math.round((paraUtc(ate) - paraUtc(de)) / DIA_MS) + 1;
}

export function menorData(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a < b ? a : b;
}

export function maiorData(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a > b ? a : b;
}

export function horasDesde(momento: Date, agora: Date): number {
  return (agora.getTime() - momento.getTime()) / 3_600_000;
}
