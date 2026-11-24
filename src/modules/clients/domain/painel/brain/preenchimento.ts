import type { EntradaDoBrain } from './tipos.ts';

export function entradaPreenchida(entrada: EntradaDoBrain): boolean {
  switch (entrada.tipo) {
    case 'conexao':
    case 'fonte':
    case 'arquivo':
      return true;
    case 'tabela_de_dados':
      return (entrada.cobertura.linhas ?? 0) > 0 || (entrada.cobertura.diasComDado ?? 0) > 0;
    case 'contexto_secao':
    case 'contexto_lista':
      return entrada.qualidade.completude > 0;
    case 'capacidade':
      return false;
  }
}

export function separarPorPreenchimento(entradas: readonly EntradaDoBrain[]): {
  readonly preenchidas: readonly EntradaDoBrain[];
  readonly vazias: readonly EntradaDoBrain[];
} {
  const preenchidas: EntradaDoBrain[] = [];
  const vazias: EntradaDoBrain[] = [];
  for (const entrada of entradas) (entradaPreenchida(entrada) ? preenchidas : vazias).push(entrada);
  return { preenchidas, vazias };
}
