import { venceu } from './datas.ts';
import type { PapelDaEvidencia } from './plano.ts';

export const TIPOS_DE_ENTRADA_QUE_SAO_LIMITE_OU_REGRA: readonly string[] = ['limite', 'regra', 'decisao'];

export type ReferenciaComHash = {
  readonly urn: string;
  readonly hash: string;
  readonly papel: PapelDaEvidencia;
};

export type EntradaDoCatalogoAtual = {
  readonly hash: string;
  readonly tipo: string;
  readonly validoAte?: string;
};

export type NivelDeImpacto = 'nenhum' | 'informativo' | 'material';

export type MotivoDeImpacto =
  | 'entrada_removida'
  | 'hash_mudou'
  | 'evidencia_vencida'
  | 'limite_ou_regra_mudou'
  | 'limite_ou_regra_novo'
  | 'entrada_nova_relevante';

export type ItemDeImpacto = {
  readonly urn: string;
  readonly motivo: MotivoDeImpacto;
  readonly impacto: 'material' | 'informativo';
  readonly tipo: string | null;
};

export type EntradaDeImpacto = {
  readonly referencias: readonly ReferenciaComHash[];
  readonly catalogoAtual: ReadonlyMap<string, EntradaDoCatalogoAtual>;
  readonly lidasNaCriacao: ReadonlyMap<string, string>;
  readonly tiposRelevantes: ReadonlySet<string>;
  readonly hoje: string;
};

export type AvaliacaoDeImpacto = {
  readonly impacto: NivelDeImpacto;
  readonly itens: readonly ItemDeImpacto[];
};

const ehLimiteOuRegra = (tipo: string) => TIPOS_DE_ENTRADA_QUE_SAO_LIMITE_OU_REGRA.includes(tipo);

function itensDasCitadas(entrada: EntradaDeImpacto): ItemDeImpacto[] {
  const itens: ItemDeImpacto[] = [];
  const vistas = new Set<string>();
  for (const referencia of entrada.referencias) {
    const chave = `${referencia.urn}|${referencia.hash}`;
    if (vistas.has(chave)) continue;
    vistas.add(chave);
    const atual = entrada.catalogoAtual.get(referencia.urn);
    if (atual === undefined) {
      itens.push({ urn: referencia.urn, motivo: 'entrada_removida', impacto: 'material', tipo: null });
      continue;
    }
    if (atual.hash !== referencia.hash) {
      const motivo = ehLimiteOuRegra(atual.tipo) ? 'limite_ou_regra_mudou' : 'hash_mudou';
      itens.push({ urn: referencia.urn, motivo, impacto: 'material', tipo: atual.tipo });
    }
    if (venceu(atual.validoAte, entrada.hoje)) {
      itens.push({ urn: referencia.urn, motivo: 'evidencia_vencida', impacto: 'material', tipo: atual.tipo });
    }
  }
  return itens;
}

function itensDasNaoCitadas(entrada: EntradaDeImpacto): ItemDeImpacto[] {
  const citadas = new Set(entrada.referencias.map((r) => r.urn));
  const itens: ItemDeImpacto[] = [];
  for (const [urn, atual] of entrada.catalogoAtual) {
    if (citadas.has(urn)) continue;
    const hashLido = entrada.lidasNaCriacao.get(urn);
    if (ehLimiteOuRegra(atual.tipo)) {
      if (hashLido === undefined) itens.push({ urn, motivo: 'limite_ou_regra_novo', impacto: 'material', tipo: atual.tipo });
      else if (hashLido !== atual.hash) itens.push({ urn, motivo: 'limite_ou_regra_mudou', impacto: 'material', tipo: atual.tipo });
      continue;
    }
    if (hashLido === undefined && entrada.tiposRelevantes.has(atual.tipo)) {
      itens.push({ urn, motivo: 'entrada_nova_relevante', impacto: 'informativo', tipo: atual.tipo });
    }
  }
  return itens;
}

function ordenar(itens: ItemDeImpacto[]): ItemDeImpacto[] {
  const peso = (item: ItemDeImpacto) => (item.impacto === 'material' ? 0 : 1);
  return itens.sort((a, b) => peso(a) - peso(b) || a.urn.localeCompare(b.urn) || a.motivo.localeCompare(b.motivo));
}

export function avaliarImpacto(entrada: EntradaDeImpacto): AvaliacaoDeImpacto {
  const itens = ordenar([...itensDasCitadas(entrada), ...itensDasNaoCitadas(entrada)]);
  if (itens.some((item) => item.impacto === 'material')) return { impacto: 'material', itens };
  if (itens.length > 0) return { impacto: 'informativo', itens };
  return { impacto: 'nenhum', itens };
}
