import { err, ok, type Result } from '../../../shared/result/result.ts';
import type { PacoteDeLeitura } from './pacote.ts';
import { lerUrn } from '../../brain/domain/urn.ts';
import { TIPOS_DE_ENTRADA_QUE_SAO_LIMITE_OU_REGRA } from './impacto.ts';
import { SECOES_DO_PLANO, type PapelDaEvidencia, type Plano, type SecaoDoPlano } from './plano.ts';

export type Referencia = { readonly urn: string; readonly papel: PapelDaEvidencia };

export type Citacao = Referencia & { readonly secao: SecaoDoPlano; readonly trecho: string };

export const PAPEL_NO_BANCO: Readonly<Record<PapelDaEvidencia, 'evidencia_favor' | 'evidencia_contra' | 'premissa'>> = {
  favor: 'evidencia_favor',
  contra: 'evidencia_contra',
  premissa: 'premissa',
};

export type Escopo = { readonly organizacaoId: string; readonly clienteId: string };

export type ErroDeReferencia = {
  readonly urn: string;
  readonly codigo: 'urn_invalida' | 'organizacao_diferente' | 'cliente_diferente';
  readonly mensagem: string;
};

function ehRegistro(valor: unknown): valor is Record<string, unknown> {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor);
}

function citacoesDe(valor: unknown, secao: SecaoDoPlano, idAtual: string | null, saida: Citacao[]): void {
  if (Array.isArray(valor)) {
    for (const item of valor) citacoesDe(item, secao, idAtual, saida);
    return;
  }
  if (!ehRegistro(valor)) return;
  const id = typeof valor.id === 'string' ? valor.id : typeof valor.campo === 'string' ? valor.campo : idAtual;
  const trecho = id === null ? secao : `${secao}/${id}`;
  for (const [chave, filho] of Object.entries(valor)) {
    if (chave === 'evidencias' && Array.isArray(filho)) {
      for (const evidencia of filho as readonly Referencia[]) {
        saida.push({ urn: evidencia.urn, papel: evidencia.papel, secao, trecho });
      }
      continue;
    }
    citacoesDe(filho, secao, id, saida);
  }
}

export function citacoesDoPlano(plano: Plano): Citacao[] {
  const saida: Citacao[] = [];
  for (const secao of SECOES_DO_PLANO) citacoesDe(plano[secao], secao, null, saida);
  return saida;
}

export function listarReferencias(plano: Plano): Referencia[] {
  const unicas = new Map<string, Referencia>();
  for (const { urn, papel } of citacoesDoPlano(plano)) unicas.set(`${urn}|${papel}`, { urn, papel });
  return [...unicas.values()].sort((a, b) => a.urn.localeCompare(b.urn) || a.papel.localeCompare(b.papel));
}

function erroDaReferencia(urn: string, escopo: Escopo): ErroDeReferencia | null {
  const partes = lerUrn(urn);
  if (partes === null) return { urn, codigo: 'urn_invalida', mensagem: 'URN fora do formato do Brain.' };
  if (partes.organizationId !==escopo.organizacaoId) {
    return { urn, codigo: 'organizacao_diferente', mensagem: 'URN de outra organização.' };
  }
  if (partes.clienteId !== escopo.clienteId) {
    return { urn, codigo: 'cliente_diferente', mensagem: 'URN de outro cliente.' };
  }
  return null;
}

export function referenciasDoPlano(plano: Plano, escopo: Escopo): Result<Referencia[], ErroDeReferencia[]> {
  const referencias = listarReferencias(plano);
  const erros = [...new Set(referencias.map((r) => r.urn))]
    .map((urn) => erroDaReferencia(urn, escopo))
    .filter((erro): erro is ErroDeReferencia => erro !== null);
  return erros.length > 0 ? err(erros) : ok(referencias);
}

export function secoesQueCitam(plano: Plano, urn: string): SecaoDoPlano[] {
  const secoes = new Set(citacoesDoPlano(plano).filter((c) => c.urn === urn).map((c) => c.secao));
  return SECOES_DO_PLANO.filter((secao) => secoes.has(secao));
}

export const TIPOS_DE_REGRA_NO_PACOTE: readonly string[] = TIPOS_DE_ENTRADA_QUE_SAO_LIMITE_OU_REGRA;

export type ReferenciaComHashDoPacote = Referencia & { readonly hash: string };

export function referenciasImplicitasDoPacote(pacote: PacoteDeLeitura): ReferenciaComHashDoPacote[] {
  return pacote.entradas
    .filter((entrada) => TIPOS_DE_REGRA_NO_PACOTE.includes(entrada.tipo))
    .map((entrada) => ({ urn: entrada.urn, hash: entrada.hash, papel: 'premissa' as const }));
}

export function combinarReferencias(
  citadas: readonly ReferenciaComHashDoPacote[],
  implicitas: readonly ReferenciaComHashDoPacote[],
): ReferenciaComHashDoPacote[] {
  const unicas = new Map<string, ReferenciaComHashDoPacote>();
  for (const ref of [...citadas, ...implicitas]) {
    const chave = `${ref.urn}|${ref.papel}`;
    if (!unicas.has(chave)) unicas.set(chave, ref);
  }
  return [...unicas.values()].sort((a, b) => a.urn.localeCompare(b.urn) || a.papel.localeCompare(b.papel));
}

export function urnsDeRegraOuLimite(pacote: PacoteDeLeitura): Set<string> {
  return new Set(
    pacote.entradas
      .filter((entrada) => TIPOS_DE_REGRA_NO_PACOTE.includes(entrada.tipo) || entrada.evidencia?.categoria === 'regra_legal')
      .map((entrada) => entrada.urn),
  );
}

export function urnsCitadasNasSecoes(valor: unknown, urns: Set<string> = new Set(), profundidade = 0): Set<string> {
  if (profundidade > 24) return urns;
  if (Array.isArray(valor)) {
    for (const item of valor) urnsCitadasNasSecoes(item, urns, profundidade + 1);
  } else if (valor !== null && typeof valor === 'object') {
    for (const [chave, filho] of Object.entries(valor)) {
      if (chave === 'urn' && typeof filho === 'string') urns.add(filho);
      else urnsCitadasNasSecoes(filho, urns, profundidade + 1);
    }
  }
  return urns;
}
