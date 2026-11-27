import { indicePorUrn, NOTAS_DE_EVIDENCIA, type EntradaDoPacote } from '../pacote.ts';
import { aprovar, reprovar, type ContextoDoGate, type ResultadoDaChecagem } from './resultado.ts';

export const CHAVE_SUGESTOES_DE_LACUNAS = 'sugestoes_de_lacunas';

export function checarSugestoesDeLacunas(contexto: ContextoDoGate): ResultadoDaChecagem {
  const indice = indicePorUrn(contexto.pacote);
  const reprovadas: string[] = [];
  let comValor = 0;
  for (const lacuna of contexto.plano.lacunas.itens) {
    const sugestao = lacuna.sugestao;
    if (sugestao === undefined || sugestao.valor === null) continue;
    comValor += 1;
    const local = `lacunas/${lacuna.id}`;
    const entradas = sugestao.evidencias
      .filter((e) => e.papel !== 'contra')
      .map((e) => indice.get(e.urn))
      .filter((e): e is EntradaDoPacote => e !== undefined);
    if (sugestao.origem !== 'evidencia' || entradas.length === 0) {
      reprovadas.push(`${local} (valor sugerido sem origem no pacote)`);
      continue;
    }
    if (entradas.every((e) => e.somenteMetadados)) {
      reprovadas.push(`${local} (valor sugerido apoiado só em metadados)`);
      continue;
    }
    const notas = entradas.flatMap((e) => (e.evidencia === undefined ? [] : [NOTAS_DE_EVIDENCIA.indexOf(e.evidencia.nota)]));
    if (notas.length === entradas.length && Math.min(...notas) === NOTAS_DE_EVIDENCIA.indexOf('D')) {
      reprovadas.push(`${local} (valor sugerido só com nota D)`);
    }
  }
  if (reprovadas.length > 0) {
    return reprovar(CHAVE_SUGESTOES_DE_LACUNAS, `${reprovadas.length} sugestão(ões) de lacuna sem origem confiável.`, reprovadas);
  }
  return aprovar(CHAVE_SUGESTOES_DE_LACUNAS, comValor === 0 ? 'Nenhuma lacuna traz valor sugerido.' : 'Todo valor sugerido tem origem em evidência do pacote.');
}
