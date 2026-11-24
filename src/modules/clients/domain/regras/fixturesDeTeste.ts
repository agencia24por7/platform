import type { Decisao } from './decisao.ts';
import type { DefinicaoDeLimite } from './definicaoDeLimite.ts';

export const AGORA = new Date('2026-11-24T12:00:00.000Z');
export const ONTEM = new Date('2026-11-23T12:00:00.000Z');
export const AMANHA = new Date('2026-11-25T12:00:00.000Z');

export function definicao(sobrescrita: Partial<DefinicaoDeLimite> = {}): DefinicaoDeLimite {
  return {
    key: 'investimento.teto_mensal',
    version: 1,
    nome: 'Teto mensal',
    descricao: 'Gasto máximo por mês.',
    categoria: 'investimento',
    medida: 'gasto',
    unidade: 'brl_centavos',
    periodo: 'mes',
    sentido: 'teto',
    faixaMin: '0',
    faixaMax: '100000000',
    escoposAceitos: ['cliente', 'plataforma:google_ads'],
    essencial: true,
    ativo: true,
    ...sobrescrita,
  };
}

let sequencia = 0;

export function decisao(sobrescrita: Partial<Decisao> = {}): Decisao {
  sequencia += 1;
  return {
    id: `d${sequencia}`,
    clienteId: 'c1',
    numero: sequencia,
    categoria: 'investimento',
    natureza: 'limite',
    origem: 'agencia',
    forca: 'dura',
    chave: 'investimento.teto_mensal',
    escopo: 'cliente',
    titulo: 'Teto mensal',
    contexto: null,
    texto: null,
    valor: { unidade: 'brl_centavos', centavos: '1000000', moeda: 'BRL' },
    vigenciaInicio: ONTEM,
    vigenciaFim: null,
    status: 'vigente',
    supersedesId: null,
    decididoPor: 'u1',
    emNomeDe: null,
    evidencia: null,
    semConfirmacaoDoAnunciante: false,
    viaLinkId: null,
    agentId: null,
    agentRunId: null,
    agentSetHash: null,
    chaveDeIdempotencia: null,
    definicaoChave: 'investimento.teto_mensal',
    definicaoVersao: 1,
    revisarEConverterEmLimite: false,
    motivoDaRevogacao: null,
    criadoEm: ONTEM,
    ...sobrescrita,
  };
}

export function regra(sobrescrita: Partial<Decisao> = {}): Decisao {
  return decisao({
    categoria: 'etica_marca',
    natureza: 'regra',
    chave: 'etica.nao_dizer',
    titulo: 'Não prometer cura',
    texto: 'Nunca prometer cura.',
    valor: null,
    definicaoChave: null,
    definicaoVersao: null,
    ...sobrescrita,
  });
}
