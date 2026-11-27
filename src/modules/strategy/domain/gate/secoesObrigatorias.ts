import { centavosDe } from '../dinheiro.ts';
import type { Plano, SecaoDoPlano } from '../plano.ts';
import { aprovar, reprovar, type ContextoDoGate, type ResultadoDaChecagem } from './resultado.ts';

export const CHAVE_SECOES_OBRIGATORIAS = 'secoes_obrigatorias';

type Regra = { readonly secao: SecaoDoPlano; readonly preenchida: (plano: Plano) => boolean };

export const SECOES_OBRIGATORIAS: readonly Regra[] = [
  { secao: 'resumo_executivo', preenchida: (p) => p.resumo_executivo.objetivo.trim().length > 0 },
  { secao: 'intencao', preenchida: (p) => p.intencao.objetivo.trim().length > 0 },
  { secao: 'diagnostico', preenchida: (p) => p.diagnostico.situacao.texto.trim().length > 0 },
  { secao: 'publico_alvo', preenchida: (p) => p.publico_alvo.segmentos.length > 0 },
  { secao: 'posicionamento_e_mensagem', preenchida: (p) => p.posicionamento_e_mensagem.promessa.texto.trim().length > 0 },
  { secao: 'estrategia', preenchida: (p) => p.estrategia.politica.texto.trim().length > 0 },
  { secao: 'canais_e_plataformas', preenchida: (p) => p.canais_e_plataformas.canais.length > 0 },
  { secao: 'campanhas', preenchida: (p) => p.campanhas.campanhas.length > 0 },
  { secao: 'orcamento', preenchida: (p) => centavosDe(p.orcamento.total) > 0n },
  { secao: 'metas_e_metricas', preenchida: (p) => p.metas_e_metricas.metas.some((m) => m.nivel === 'negocio') },
  { secao: 'medicao', preenchida: (p) => p.medicao.itens.length > 0 },
  { secao: 'calendario', preenchida: (p) => p.calendario.fases.length > 0 },
  { secao: 'plano_de_midia', preenchida: (p) => p.plano_de_midia.plataformas.some((m) => m.secoes.some((s) => s.campos.length > 0)) },
  { secao: 'riscos_e_regras', preenchida: (p) => p.riscos_e_regras.riscos.length > 0 },
];

export function checarSecoesObrigatorias(contexto: ContextoDoGate): ResultadoDaChecagem {
  const vazias = SECOES_OBRIGATORIAS.filter((regra) => !regra.preenchida(contexto.plano)).map((regra) => regra.secao);
  if (vazias.length === 0) return aprovar(CHAVE_SECOES_OBRIGATORIAS, 'Seções obrigatórias preenchidas.');
  return reprovar(CHAVE_SECOES_OBRIGATORIAS, `${vazias.length} seção(ões) obrigatória(s) vazia(s).`, vazias);
}
