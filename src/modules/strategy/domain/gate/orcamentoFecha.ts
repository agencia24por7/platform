import { centavosDe, somaDeCentavos } from '../dinheiro.ts';
import { aprovar, reprovar, type ContextoDoGate, type ResultadoDaChecagem } from './resultado.ts';

export const CHAVE_ORCAMENTO_FECHA = 'orcamento_fecha';

export function checarOrcamentoFecha(contexto: ContextoDoGate): ResultadoDaChecagem {
  const { plano } = contexto;
  const total = centavosDe(plano.orcamento.total);
  const problemas: string[] = [];

  if (somaDeCentavos(plano.campanhas.campanhas.map((c) => c.verba)) !== total) {
    problemas.push('campanhas (soma diferente do total do orçamento)');
  }
  if (plano.orcamento.por_canal.length > 0 && somaDeCentavos(plano.orcamento.por_canal.map((p) => p.valor)) !== total) {
    problemas.push('orcamento (soma por canal diferente do total)');
  }
  if (total > centavosDe(plano.intencao.verba)) problemas.push('orcamento (total acima da verba da intenção)');
  if (centavosDe(plano.orcamento.verba_de_teste) > total) problemas.push('orcamento (verba de teste acima do total)');
  if (centavosDe(plano.resumo_executivo.verba) !== total) problemas.push('resumo_executivo (verba diferente do total)');

  if (problemas.length === 0) return aprovar(CHAVE_ORCAMENTO_FECHA, 'O orçamento fecha com as campanhas e com a verba da intenção.');
  return reprovar(CHAVE_ORCAMENTO_FECHA, `${problemas.length} inconsistência(s) no orçamento.`, problemas);
}
