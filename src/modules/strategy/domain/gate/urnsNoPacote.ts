import { citacoesDoPlano } from '../referencias.ts';
import { indicePorUrn } from '../pacote.ts';
import type { SecaoDoPlano } from '../plano.ts';
import { aprovar, reprovar, type ContextoDoGate, type ResultadoDaChecagem } from './resultado.ts';

export const CHAVE_URNS_NO_PACOTE = 'urns_no_pacote';

export const SECOES_COM_NUMERO: readonly SecaoDoPlano[] = ['resumo_executivo', 'diagnostico', 'metas_e_metricas'];

export function checarUrnsNoPacote(contexto: ContextoDoGate): ResultadoDaChecagem {
  const indice = indicePorUrn(contexto.pacote);
  const ausentes: string[] = [];
  const soMetadados: string[] = [];
  for (const citacao of citacoesDoPlano(contexto.plano)) {
    const entrada = indice.get(citacao.urn);
    const local = `${citacao.trecho} (${citacao.urn})`;
    if (entrada === undefined) ausentes.push(local);
    else if (entrada.somenteMetadados && SECOES_COM_NUMERO.includes(citacao.secao)) soMetadados.push(local);
  }
  if (ausentes.length === 0 && soMetadados.length === 0) {
    return aprovar(CHAVE_URNS_NO_PACOTE, 'Toda citação existe no pacote e nenhuma usa só metadados como evidência de número.');
  }
  const partes = [
    ausentes.length > 0 ? `${ausentes.length} citação(ões) fora do pacote` : null,
    soMetadados.length > 0 ? `${soMetadados.length} citação(ões) de número apoiada(s) só em metadados` : null,
  ].filter((parte): parte is string => parte !== null);
  return reprovar(CHAVE_URNS_NO_PACOTE, partes.join('; ') + '.', [...ausentes, ...soMetadados]);
}
