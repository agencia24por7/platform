import { indicePorUrn, NOTAS_DE_EVIDENCIA, type EntradaDoPacote, type NotaDeEvidencia } from '../pacote.ts';
import { aprovar, reprovar, type ContextoDoGate, type ResultadoDaChecagem } from './resultado.ts';

export const CHAVE_META_SEM_NOTA_D = 'meta_sem_nota_d';

const POSICAO_DA_NOTA = (nota: NotaDeEvidencia) => NOTAS_DE_EVIDENCIA.indexOf(nota);

export function checarMetaSemNotaD(contexto: ContextoDoGate): ResultadoDaChecagem {
  const indice = indicePorUrn(contexto.pacote);
  const reprovadas: string[] = [];
  const hipoteses: string[] = [];
  for (const meta of contexto.plano.metas_e_metricas.metas) {
    const local = `metas_e_metricas/${meta.id}`;
    const sustentos = meta.evidencias.filter((e) => e.papel !== 'contra');
    if (sustentos.length === 0) {
      if (meta.hipotese) hipoteses.push(`${local} (hipótese sem evidência)`);
      else reprovadas.push(`${local} (sem evidência a favor)`);
      continue;
    }
    const entradas = sustentos.map((e) => indice.get(e.urn)).filter((e): e is EntradaDoPacote => e !== undefined);
    const notas = entradas.flatMap((e) => (e.evidencia === undefined ? [] : [e.evidencia.nota]));
    const todasTemNota = entradas.length > 0 && notas.length === entradas.length;
    if (!todasTemNota) continue;
    const melhor = notas.reduce((a, b) => (POSICAO_DA_NOTA(a) <= POSICAO_DA_NOTA(b) ? a : b));
    if (melhor === 'D') {
      reprovadas.push(`${local} (só nota D)`);
      continue;
    }
    const declarada = meta.nota_da_evidencia;
    if (declarada !== undefined && POSICAO_DA_NOTA(declarada) < POSICAO_DA_NOTA(melhor)) {
      reprovadas.push(`${local} (nota declarada ${declarada} acima da real ${melhor})`);
    }
  }
  if (reprovadas.length > 0) {
    return reprovar(CHAVE_META_SEM_NOTA_D, `${reprovadas.length} meta(s) sem sustentação suficiente.`, reprovadas);
  }
  return aprovar(CHAVE_META_SEM_NOTA_D, 'Nenhuma meta depende só de nota D.', hipoteses);
}
