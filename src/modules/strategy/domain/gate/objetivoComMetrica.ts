import { aprovar, reprovar, type ContextoDoGate, type ResultadoDaChecagem } from './resultado.ts';

export const CHAVE_OBJETIVO_COM_METRICA = 'objetivo_com_metrica';

const vazio = (texto: string | undefined) => texto === undefined || texto.trim().length === 0;

export function checarObjetivoComMetrica(contexto: ContextoDoGate): ResultadoDaChecagem {
  const { plano } = contexto;
  const medidas = new Map(plano.medicao.itens.map((item) => [item.meta_id, item]));
  const falhas: string[] = [];

  for (const meta of plano.metas_e_metricas.metas) {
    const local = `metas_e_metricas/${meta.id}`;
    if (vazio(meta.metrica) || vazio(meta.metrica_de_custo) || vazio(meta.metrica_de_qualidade)) {
      falhas.push(`${local} (sem métrica pareada de custo e qualidade)`);
    }
    const medicao = medidas.get(meta.id);
    if (medicao === undefined || vazio(medicao.como_medir) || vazio(medicao.fonte)) {
      falhas.push(`${local} (sem forma de medir)`);
    }
  }
  for (const campanha of plano.campanhas.campanhas) {
    const local = `campanhas/${campanha.id}`;
    if (vazio(campanha.metrica_de_sucesso)) falhas.push(`${local} (sem métrica de sucesso)`);
    if (!medidas.has(campanha.meta_id)) falhas.push(`${local} (meta sem forma de medir)`);
  }

  if (falhas.length === 0) return aprovar(CHAVE_OBJETIVO_COM_METRICA, 'Todo objetivo tem métrica e forma de medir.');
  return reprovar(CHAVE_OBJETIVO_COM_METRICA, `${falhas.length} objetivo(s) sem métrica ou forma de medir.`, falhas);
}
