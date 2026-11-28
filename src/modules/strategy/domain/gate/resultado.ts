import type { Medida } from '../../../clients/domain/regras/medida.ts';
import type { Valor } from '../../../clients/domain/regras/valor.ts';
import type { Ajuste } from '../comite/ajuste.ts';
import type { VereditoDoJuiz } from '../comite/juiz.ts';
import type { Parecer } from '../comite/parecer.ts';
import type { CatalogoDeCampos } from '../catalogo/tipos.ts';
import type { PacoteDeLeitura } from '../pacote.ts';
import type { Plano } from '../plano.ts';

export type VereditoDoLimite = 'ok' | 'bloqueia' | 'sem_regra';

export type ContextoDoGate = {
  readonly plano: Plano;
  readonly pacote: PacoteDeLeitura;
  readonly catalogosDeCampos?: readonly CatalogoDeCampos[];
  readonly hoje: string;
  readonly pareceres?: readonly Parecer[];
  readonly ajuste?: Ajuste;
  readonly vereditosDoJuiz?: readonly VereditoDoJuiz[];
  readonly comiteDaMesmaExecucao?: boolean;
  readonly comitesConvocados?: readonly string[];
  readonly medidasComLimite: readonly Medida[];
  readonly planosBase?: readonly Plano[];
  readonly exigePlanoBase?: boolean;
  readonly avaliarLimite: (medida: Medida, valor: Valor) => VereditoDoLimite;
};

export type ResultadoDeUmaChecagem = 'aprovado' | 'reprovado' | 'nao_rodou';

export type ResultadoDaChecagem = {
  readonly chave: string;
  readonly resultado: ResultadoDeUmaChecagem;
  readonly motivo: string;
  readonly onde: string[];
};

export type Checagem = {
  readonly chave: string;
  readonly executar: (contexto: ContextoDoGate) => ResultadoDaChecagem;
};

export const MAXIMO_DE_LOCAIS = 40;
export const MAXIMO_DO_MOTIVO = 300;

export function resumirLocais(locais: readonly string[]): string[] {
  const unicos = [...new Set(locais)].sort();
  if (unicos.length <= MAXIMO_DE_LOCAIS) return unicos;
  const excedente = unicos.length - (MAXIMO_DE_LOCAIS - 1);
  return [...unicos.slice(0, MAXIMO_DE_LOCAIS - 1), `+${excedente} outros`];
}

export function resumirMotivo(motivo: string): string {
  return motivo.length <= MAXIMO_DO_MOTIVO ? motivo : `${motivo.slice(0, MAXIMO_DO_MOTIVO - 1)}…`;
}

export function montarResultado(
  chave: string,
  resultado: ResultadoDeUmaChecagem,
  motivo: string,
  onde: readonly string[] = [],
): ResultadoDaChecagem {
  return { chave, resultado, motivo: resumirMotivo(motivo), onde: resumirLocais(onde) };
}

export function aprovar(chave: string, motivo: string, onde: readonly string[] = []): ResultadoDaChecagem {
  return montarResultado(chave, 'aprovado', motivo, onde);
}

export function reprovar(chave: string, motivo: string, onde: readonly string[]): ResultadoDaChecagem {
  return montarResultado(chave, 'reprovado', motivo, onde);
}
