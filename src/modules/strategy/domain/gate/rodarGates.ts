import { CHECAGENS_EM_CODIGO } from './registro.ts';
import { montarResultado, type Checagem, type ContextoDoGate, type ResultadoDaChecagem } from './resultado.ts';

export type VereditoDosGates = {
  readonly resultado: 'aprovado' | 'reprovado';
  readonly checagens: readonly ResultadoDaChecagem[];
  readonly pendencias: readonly string[];
};

const RESULTADOS_VALIDOS: readonly string[] = ['aprovado', 'reprovado', 'nao_rodou'];

function executarComSeguranca(checagem: Checagem, contexto: ContextoDoGate): ResultadoDaChecagem {
  try {
    const resultado = checagem.executar(contexto);
    if (!RESULTADOS_VALIDOS.includes(resultado.resultado)) {
      return montarResultado(checagem.chave, 'nao_rodou', 'Checagem devolveu resultado fora do contrato.');
    }
    return { ...resultado, chave: checagem.chave };
  } catch (erro) {
    const nome = erro instanceof Error ? erro.name : 'Erro';
    return montarResultado(checagem.chave, 'nao_rodou', `Checagem lançou exceção (${nome}); não foi possível rodar.`);
  }
}

export function rodarGates(contexto: ContextoDoGate, checagens: readonly Checagem[] = CHECAGENS_EM_CODIGO): VereditoDosGates {
  const resultados = checagens.map((checagem) => executarComSeguranca(checagem, contexto));
  const pendencias = resultados.filter((r) => r.resultado !== 'aprovado').map((r) => `${r.chave}: ${r.motivo}`);
  const aprovado = resultados.length > 0 && pendencias.length === 0;
  return { resultado: aprovado ? 'aprovado' : 'reprovado', checagens: resultados, pendencias };
}

export function payloadDoGate(veredito: VereditoDosGates): { resultado: 'aprovado' | 'reprovado'; checagens: ResultadoDaChecagem[] } {
  return { resultado: veredito.resultado, checagens: [...veredito.checagens] };
}
