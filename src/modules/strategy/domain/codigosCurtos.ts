import { z } from 'zod';
import type { PacoteDeLeitura } from './pacote.ts';

export const PADRAO_DO_CODIGO_CURTO = /^e[1-9][0-9]{0,4}$/;

const CHAVES_COM_URN = new Set(['urn']);
const CHAVES_COM_LISTA_DE_URN = new Set(['fontes']);
const PROFUNDIDADE_MAXIMA = 24;

export type CodigosDoPacote = {
  readonly urnDoCodigo: ReadonlyMap<string, string>;
  readonly codigoDaUrn: ReadonlyMap<string, string>;
};

export function codigosDoPacote(pacote: Pick<PacoteDeLeitura, 'entradas' | 'catalogo'>): CodigosDoPacote {
  const ordem: string[] = [];
  const vistas = new Set<string>();
  for (const urn of [...(pacote.catalogo ?? []).map((item) => item.urn), ...pacote.entradas.map((entrada) => entrada.urn)]) {
    if (vistas.has(urn)) continue;
    vistas.add(urn);
    ordem.push(urn);
  }
  const urnDoCodigo = new Map<string, string>();
  const codigoDaUrn = new Map<string, string>();
  ordem.forEach((urn, indice) => {
    const codigo = `e${indice + 1}`;
    urnDoCodigo.set(codigo, urn);
    codigoDaUrn.set(urn, codigo);
  });
  return { urnDoCodigo, codigoDaUrn };
}

function trocar(valor: unknown, troca: (texto: string) => string, profundidade: number): unknown {
  if (profundidade > PROFUNDIDADE_MAXIMA) return valor;
  if (Array.isArray(valor)) return valor.map((item) => trocar(item, troca, profundidade + 1));
  if (valor === null || typeof valor !== 'object') return valor;
  const saida: Record<string, unknown> = {};
  for (const [chave, conteudo] of Object.entries(valor)) {
    if (CHAVES_COM_URN.has(chave) && typeof conteudo === 'string') saida[chave] = troca(conteudo);
    else if (CHAVES_COM_LISTA_DE_URN.has(chave) && Array.isArray(conteudo)) saida[chave] = conteudo.map((item) => (typeof item === 'string' ? troca(item) : item));
    else saida[chave] = trocar(conteudo, troca, profundidade + 1);
  }
  return saida;
}

export function traduzirCodigosParaUrn(valor: unknown, codigos: CodigosDoPacote): unknown {
  return trocar(valor, (texto) => (PADRAO_DO_CODIGO_CURTO.test(texto) ? (codigos.urnDoCodigo.get(texto) ?? texto) : texto), 0);
}

export function abreviarUrnsParaCodigos(valor: unknown, codigos: CodigosDoPacote): unknown {
  return trocar(valor, (texto) => codigos.codigoDaUrn.get(texto) ?? texto, 0);
}

export function esquemaQueAceitaCodigos<T>(esquema: z.ZodType<T>, codigos: CodigosDoPacote): z.ZodType<T> {
  return z.preprocess((valor) => traduzirCodigosParaUrn(valor, codigos), esquema) as unknown as z.ZodType<T>;
}
