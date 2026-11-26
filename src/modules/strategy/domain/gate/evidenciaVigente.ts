import { venceu } from '../datas.ts';
import { indicePorUrn } from '../pacote.ts';
import { citacoesDoPlano } from '../referencias.ts';
import { aprovar, reprovar, type ContextoDoGate, type ResultadoDaChecagem } from './resultado.ts';

export const CHAVE_EVIDENCIA_VIGENTE = 'evidencia_vigente';

export function checarEvidenciaVigente(contexto: ContextoDoGate): ResultadoDaChecagem {
  const indice = indicePorUrn(contexto.pacote);
  const vencidas = citacoesDoPlano(contexto.plano)
    .filter((citacao) => venceu(indice.get(citacao.urn)?.evidencia?.validoAte, contexto.hoje))
    .map((citacao) => `${citacao.trecho} (${citacao.urn})`);
  if (vencidas.length === 0) return aprovar(CHAVE_EVIDENCIA_VIGENTE, 'Nenhuma evidência citada está vencida.');
  return reprovar(CHAVE_EVIDENCIA_VIGENTE, `${vencidas.length} citação(ões) de evidência vencida em ${contexto.hoje}.`, vencidas);
}
