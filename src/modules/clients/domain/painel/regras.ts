import { canAdminister, canOperate, type MemberRole } from '../../../identity/domain/user.ts';
import type { Vocabulario } from '../../../organizations/domain/vocabulario.ts';
import {
  CATEGORIAS,
  FORCAS,
  NATUREZAS,
  ORIGENS,
  STATUS,
  ehDecimalTexto,
  valorDecimal,
  valorEmCentavos,
  type Categoria,
  type Decisao,
  type Forca,
  type Natureza,
  type Origem,
  type Periodo,
  type Sentido,
  type Status,
  type Unidade,
  type Valor,
} from '../regras/index.ts';
import type { EstadoDoBloco } from './prontidao.ts';

export const ROTULO_DA_CATEGORIA: Readonly<Record<Categoria, string>> = {
  investimento: 'Limites de investimento',
  eficiencia: 'Custo e retorno',
  publico: 'Regras de perfil e público',
  etica_marca: 'Ética e marca',
  segmento: 'Restrições do segmento',
  governanca: 'Aprovação e alçada',
  processo: 'Decisões do processo',
};

export const ROTULO_DA_NATUREZA: Readonly<Record<Natureza, string>> = {
  limite: 'Limite',
  regra: 'Regra',
  decisao: 'Decisão',
};

export const ROTULO_DA_FORCA: Readonly<Record<Forca, string>> = {
  dura: 'Bloqueia',
  orientacao: 'Orienta',
};

export const EXPLICACAO_DA_FORCA: Readonly<Record<Forca, string>> = {
  dura: 'Bloqueia: nenhuma ação pode passar por cima.',
  orientacao: 'Orienta: pesa na decisão, mas não bloqueia.',
};

export const ROTULO_DO_STATUS: Readonly<Record<Status, string>> = {
  proposta: 'Proposta',
  vigente: 'Vigente',
  superada: 'Superada',
  revogada: 'Revogada',
  rejeitada: 'Rejeitada',
};

export const ROTULO_DO_PERIODO: Readonly<Record<Periodo, string>> = {
  mes: 'por mês',
  dia: 'por dia',
  total: 'no total',
};

export const ROTULO_DO_SENTIDO: Readonly<Record<Sentido, string>> = {
  teto: 'Teto',
  piso: 'Piso',
};

export const ROTULO_DA_UNIDADE: Readonly<Record<Unidade, string>> = {
  brl_centavos: 'Reais (R$)',
  razao: 'Razão (vezes)',
  percentual: 'Percentual (%)',
};

export const SECOES_DE_REGRAS = ['hoje', 'linha', 'propostas', 'revisar', 'registrar', 'alterar', 'historico'] as const;
export type SecaoDeRegras = (typeof SECOES_DE_REGRAS)[number];

export function secaoDeRegras(bruto: string | null | undefined): SecaoDeRegras {
  return (SECOES_DE_REGRAS as readonly string[]).includes(bruto ?? '') ? (bruto as SecaoDeRegras) : 'hoje';
}

export const PLATAFORMAS_DE_ESCOPO: Readonly<Record<string, string>> = { google: 'Google Ads', meta: 'Meta Ads' };

export function escopoDaPlataforma(chave: string): string {
  return `plataforma:${chave}`;
}

export function rotuloDoEscopo(escopo: string): string {
  if (escopo === 'cliente') return 'Cliente inteiro';
  const chave = escopo.replace(/^plataforma:/, '');
  return PLATAFORMAS_DE_ESCOPO[chave] ?? chave;
}

export function rotuloDaOrigem(origem: Origem, vocabulario: Pick<Vocabulario, 'origemCliente' | 'origemEquipe'>): string {
  if (origem === 'cliente') return vocabulario.origemCliente;
  if (origem === 'agencia') return vocabulario.origemEquipe;
  return 'Agente';
}

export function podeRegistrarOuMexer(papel: MemberRole, natureza: Natureza): boolean {
  if (natureza === 'limite') return canAdminister(papel);
  return canOperate(papel);
}

export function podeEscreverEmRegras(papel: MemberRole): boolean {
  return canOperate(papel);
}

const COM_MILHAR = /^\d{1,3}(\.\d{3})+(,\d{1,2})?$/;
const SIMPLES = /^\d+(,\d{1,2})?$/;
const PONTO_DECIMAL = /^\d+\.\d{1,2}$/;
const DIGITOS_MAXIMOS_DE_CENTAVOS = 15;

export function reaisParaCentavos(bruto: string): string | null {
  const texto = bruto.trim().replace(/^R\$\s*/i, '').replace(/\s+/g, '');
  let normalizado: string;
  if (COM_MILHAR.test(texto)) normalizado = texto.replace(/\./g, '');
  else if (SIMPLES.test(texto)) normalizado = texto;
  else if (PONTO_DECIMAL.test(texto)) normalizado = texto.replace('.', ',');
  else return null;
  const [reais = '0', fracao = ''] = normalizado.split(',');
  const centavos = (reais + fracao.padEnd(2, '0')).replace(/^0+(?=\d)/, '');
  return centavos.length > DIGITOS_MAXIMOS_DE_CENTAVOS ? null : centavos;
}

export function centavosParaCampo(centavos: string): string {
  const completo = BigInt(centavos).toString().padStart(3, '0');
  return `${completo.slice(0, -2)},${completo.slice(-2)}`;
}

export function decimalDoCampo(bruto: string): string | null {
  const texto = bruto.trim().replace(/\s+/g, '').replace(',', '.');
  return ehDecimalTexto(texto) ? texto : null;
}

export function valorDoCampo(unidade: Unidade, bruto: string): Valor | null {
  if (unidade === 'brl_centavos') {
    const centavos = reaisParaCentavos(bruto);
    if (centavos === null) return null;
    const valor = valorEmCentavos(centavos);
    return valor.ok ? valor.value : null;
  }
  const decimal = decimalDoCampo(bruto);
  if (decimal === null) return null;
  const valor = valorDecimal(unidade, decimal);
  return valor.ok ? valor.value : null;
}

export function valorParaCampo(valor: Valor): string {
  if (valor.unidade === 'brl_centavos') return centavosParaCampo(valor.centavos);
  return valor.decimal.replace('.', ',');
}

export function faixaLegivel(
  definicao: { readonly unidade: Unidade; readonly faixaMin: string; readonly faixaMax: string },
  formatar: (valor: Valor) => string,
): string | null {
  const minimo = valorBruto(definicao.unidade, definicao.faixaMin);
  const maximo = valorBruto(definicao.unidade, definicao.faixaMax);
  return minimo && maximo ? `${formatar(minimo)} a ${formatar(maximo)}` : null;
}

function valorBruto(unidade: Unidade, texto: string): Valor | null {
  if (unidade === 'brl_centavos') {
    const valor = valorEmCentavos(texto);
    return valor.ok ? valor.value : null;
  }
  const valor = valorDecimal(unidade, texto);
  return valor.ok ? valor.value : null;
}

const SEM_ACENTO = /[̀-ͯ]/g;

export function chaveDaRegra(categoria: Categoria, titulo: string): string | null {
  const slug = titulo
    .normalize('NFD')
    .replace(SEM_ACENTO, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50)
    .replace(/_+$/g, '');
  return /^[a-z]/.test(slug) ? `${categoria}.${slug}` : slug ? `${categoria}.r_${slug}`.slice(0, 80) : null;
}

export type GrupoDeCategoria = { readonly categoria: Categoria; readonly rotulo: string; readonly decisoes: readonly Decisao[] };

export function agruparPorCategoria(decisoes: readonly Decisao[]): readonly GrupoDeCategoria[] {
  return CATEGORIAS.map((categoria) => ({
    categoria,
    rotulo: ROTULO_DA_CATEGORIA[categoria],
    decisoes: decisoes.filter((d) => d.categoria === categoria).sort((a, b) => a.numero - b.numero),
  })).filter((grupo) => grupo.decisoes.length > 0);
}

export type FiltrosDaLinha = {
  readonly categoria: Categoria | null;
  readonly origem: Origem | null;
  readonly status: Status | null;
  readonly cursor: number | null;
};

function dentroDe<T extends string>(opcoes: readonly T[], bruto: string | undefined): T | null {
  return bruto !== undefined && (opcoes as readonly string[]).includes(bruto) ? (bruto as T) : null;
}

export function lerFiltrosDaLinha(busca: Readonly<Record<string, string | undefined>>): FiltrosDaLinha {
  const cursorBruto = busca['cursor'];
  const cursor = cursorBruto !== undefined && /^\d{1,9}$/.test(cursorBruto) ? Number(cursorBruto) : null;
  return {
    categoria: dentroDe(CATEGORIAS, busca['categoria']),
    origem: dentroDe(ORIGENS, busca['origem']),
    status: dentroDe(STATUS, busca['status']),
    cursor: cursor !== null && cursor >= 1 ? cursor : null,
  };
}

export function buscaDaLinha(filtros: Omit<FiltrosDaLinha, 'cursor'>, cursor: number | null): Record<string, string> {
  const busca: Record<string, string> = { secao: 'linha' };
  if (filtros.categoria) busca['categoria'] = filtros.categoria;
  if (filtros.origem) busca['origem'] = filtros.origem;
  if (filtros.status) busca['status'] = filtros.status;
  if (cursor !== null) busca['cursor'] = String(cursor);
  return busca;
}

export function opcaoDeNatureza(bruto: string | undefined): Natureza | null {
  return dentroDe(NATUREZAS, bruto);
}

export function opcaoDeForca(bruto: string | undefined): Forca | null {
  return dentroDe(FORCAS, bruto);
}

export type ContagemDeRegras = {
  readonly essenciaisFaltando: readonly { readonly chave: string; readonly nome: string }[];
  readonly vigentes: number;
  readonly propostasPendentes: number;
  readonly aRevisar: number;
};

export function estadoDoBlocoDeRegras(contagem: ContagemDeRegras): EstadoDoBloco {
  const faltando = contagem.essenciaisFaltando[0];
  if (contagem.vigentes === 0) {
    return { tom: 'vazio', rotulo: 'Vazio', proximoPasso: faltando ? `Definir ${faltando.nome.toLowerCase()}` : null };
  }
  if (faltando) return { tom: 'atencao', rotulo: 'Parcial', proximoPasso: `Definir ${faltando.nome.toLowerCase()}` };
  if (contagem.propostasPendentes > 0) {
    const n = contagem.propostasPendentes;
    return { tom: 'atencao', rotulo: 'Propostas', proximoPasso: `Decidir ${n} ${n === 1 ? 'proposta' : 'propostas'}` };
  }
  if (contagem.aRevisar > 0) {
    const n = contagem.aRevisar;
    return { tom: 'atencao', rotulo: 'Revisar', proximoPasso: `Revisar ${n} ${n === 1 ? 'regra' : 'regras'} com número` };
  }
  return { tom: 'ok', rotulo: 'Completo', proximoPasso: null };
}

const FORMATO_DE_DATA = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo' });

export function dataCurta(data: Date): string {
  return FORMATO_DE_DATA.format(data);
}

const UM_DIA_MS = 24 * 60 * 60 * 1000;

export function fimInclusivo(fimExclusivo: Date): Date {
  return new Date(fimExclusivo.getTime() - UM_DIA_MS);
}

export function dataParaCampo(data: Date | null): string {
  return data ? data.toISOString().slice(0, 10) : '';
}
