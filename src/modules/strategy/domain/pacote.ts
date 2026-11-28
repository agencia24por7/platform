import { codigosDoPacote } from './codigosCurtos.ts';
import { z } from 'zod';
import { PADRAO_DO_TIPO, lerUrn } from '../../brain/domain/urn.ts';
import { esquemaData } from './datas.ts';

export const NOTAS_DE_EVIDENCIA = ['A', 'B', 'C', 'D'] as const;
export type NotaDeEvidencia = (typeof NOTAS_DE_EVIDENCIA)[number];

export const CATEGORIAS_DE_EVIDENCIA = ['lente', 'pratica', 'regra_legal', 'benchmark'] as const;
export type CategoriaDeEvidencia = (typeof CATEGORIAS_DE_EVIDENCIA)[number];

export const MAXIMO_DE_ENTRADAS_NO_PACOTE = 2000;
export const MAXIMO_DE_ENTRADAS_LIDAS_DO_BRAIN = 600;
export const MAXIMO_DE_BYTES_DO_PACOTE_LIDO = 300_000;

export const esquemaEvidenciaDaEntrada = z.strictObject({
  nota: z.enum(NOTAS_DE_EVIDENCIA),
  validoAte: esquemaData.optional(),
  jurisdicao: z.string().min(1).max(40).optional(),
  verificadoEm: esquemaData.optional(),
  obrigatoria: z.boolean().optional(),
  categoria: z.enum(CATEGORIAS_DE_EVIDENCIA),
});
export type EvidenciaDaEntrada = z.infer<typeof esquemaEvidenciaDaEntrada>;

export const TIPO_DA_ENTRADA_DE_PRODUTO = 'contexto_produto';

export const esquemaEntradaDoPacote = z.strictObject({
  foco: z.literal(true).optional(),
  ref: z.string().regex(/^e[1-9][0-9]{0,4}$/).optional(),
  urn: z.string().max(320).refine((valor) => lerUrn(valor) !== null, 'URN inválida.'),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  tipo: z.string().regex(PADRAO_DO_TIPO),
  titulo: z.string().min(1).max(160),
  resumo: z.string().max(600),
  somenteMetadados: z.boolean(),
  evidencia: esquemaEvidenciaDaEntrada.optional(),
});
export type EntradaDoPacote = z.infer<typeof esquemaEntradaDoPacote>;

export const MAXIMO_DE_ITENS_DO_CATALOGO = 2_000;

export const esquemaItemDoCatalogo = z.strictObject({
  ref: z.string().regex(/^e[1-9][0-9]{0,4}$/).optional(),
  urn: z.string().max(320),
  tipo: z.string().regex(PADRAO_DO_TIPO),
  titulo: z.string().min(1).max(80),
  nota: z.enum(NOTAS_DE_EVIDENCIA).optional(),
  validoAte: esquemaData.optional(),
  incluida: z.boolean(),
});
export type ItemDoCatalogo = z.infer<typeof esquemaItemDoCatalogo>;

export const esquemaPacoteDeLeitura = z.strictObject({
  organizacaoId: z.string().uuid(),
  clienteId: z.string().uuid(),
  lidoEm: z.string().datetime({ offset: true }),
  entradas: z.array(esquemaEntradaDoPacote).max(MAXIMO_DE_ENTRADAS_NO_PACOTE),
  catalogo: z.array(esquemaItemDoCatalogo).max(MAXIMO_DE_ITENS_DO_CATALOGO).optional(),
  omitidasPorTamanho: z.number().int().min(0).optional(),
  descartadasPorFormato: z.number().int().min(0).optional(),
});
export type PacoteDeLeitura = z.infer<typeof esquemaPacoteDeLeitura>;

export type IndicePorUrn = ReadonlyMap<string, EntradaDoPacote>;

export function indicePorUrn(pacote: PacoteDeLeitura): IndicePorUrn {
  return new Map(pacote.entradas.map((entrada) => [entrada.urn, entrada]));
}

export function entradaDoPacote(pacote: PacoteDeLeitura, urn: string): EntradaDoPacote | undefined {
  return pacote.entradas.find((entrada) => entrada.urn === urn);
}

export function hashesDoPacote(pacote: PacoteDeLeitura): ReadonlyMap<string, string> {
  return new Map(pacote.entradas.map((entrada) => [entrada.urn, entrada.hash]));
}

export function entradasDeRegraLegalObrigatoria(pacote: PacoteDeLeitura): EntradaDoPacote[] {
  return pacote.entradas.filter(
    (entrada) => entrada.evidencia?.categoria === 'regra_legal' && entrada.evidencia.obrigatoria === true,
  );
}

export const MAXIMO_DE_BYTES_DO_PACOTE_POR_CHAMADA = {
  redigir: 120_000,
  regras: 40_000,
  citadas: 30_000,
  comite: 40_000,
  gate: 40_000,
} as const;

export const MAXIMO_DE_BYTES_DO_CATALOGO = 40_000;

export type OpcoesDoPacoteParaEntrada = {
  readonly primeiras?: ReadonlySet<string>;
  readonly somenteUrns?: ReadonlySet<string>;
  readonly comCatalogo?: boolean;
};

export function pacoteParaEntrada(pacote: PacoteDeLeitura, maximoDeBytes: number, opcoes: OpcoesDoPacoteParaEntrada = {}): PacoteDeLeitura {
  const primeiras = opcoes.primeiras ?? new Set<string>();
  const permitidas = opcoes.somenteUrns === undefined ? pacote.entradas : pacote.entradas.filter((e) => e.foco === true || opcoes.somenteUrns!.has(e.urn));
  const doFoco = permitidas.filter((e) => e.foco === true);
  const demais = permitidas.filter((e) => e.foco !== true);
  const ordenadas = [...doFoco, ...demais.filter((e) => primeiras.has(e.urn)), ...demais.filter((e) => !primeiras.has(e.urn))];
  const mantidas: EntradaDoPacote[] = [];
  let bytes = 0;
  for (const entrada of ordenadas) {
    const tamanho = new TextEncoder().encode(JSON.stringify(entrada)).length;
    if (bytes + tamanho > maximoDeBytes) continue;
    mantidas.push(entrada);
    bytes += tamanho;
  }
  const urnsMantidas = new Set(mantidas.map((entrada) => entrada.urn));
  const { codigoDaUrn } = codigosDoPacote(pacote);
  const { catalogo, ...semCatalogo } = pacote;
  return {
    ...semCatalogo,
    entradas: mantidas.map((entrada) => {
      const ref = codigoDaUrn.get(entrada.urn);
      return ref === undefined ? entrada : { ref, ...entrada };
    }),
    ...(catalogo === undefined || opcoes.comCatalogo === false ? {} : { catalogo: catalogoDentroDoLimite(catalogo, urnsMantidas, codigoDaUrn) }),
    omitidasPorTamanho: (pacote.omitidasPorTamanho ?? 0) + (pacote.entradas.length - mantidas.length),
  };
}

function catalogoDentroDoLimite(catalogo: readonly ItemDoCatalogo[], urnsMantidas: ReadonlySet<string>, codigoDaUrn: ReadonlyMap<string, string>): ItemDoCatalogo[] {
  const itens: ItemDoCatalogo[] = [];
  let bytes = 0;
  for (const item of catalogo) {
    const ref = codigoDaUrn.get(item.urn);
    const marcado = { ...(ref === undefined ? {} : { ref }), ...item, incluida: urnsMantidas.has(item.urn) };
    const tamanho = new TextEncoder().encode(JSON.stringify(marcado)).length;
    if (bytes + tamanho > MAXIMO_DE_BYTES_DO_CATALOGO) break;
    itens.push(marcado);
    bytes += tamanho;
  }
  return itens;
}
