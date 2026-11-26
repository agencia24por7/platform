import { entradasDeRegraLegalObrigatoria } from '../pacote.ts';
import { citacoesDoPlano } from '../referencias.ts';
import { aprovar, reprovar, type ContextoDoGate, type ResultadoDaChecagem } from './resultado.ts';

export const CHAVE_REGRA_LEGAL_PRESENTE = 'regra_legal_presente';

export function checarRegraLegalPresente(contexto: ContextoDoGate): ResultadoDaChecagem {
  const citadasEmRiscos = new Set(
    citacoesDoPlano(contexto.plano)
      .filter((citacao) => citacao.secao === 'riscos_e_regras')
      .map((citacao) => citacao.urn),
  );
  const faltando = entradasDeRegraLegalObrigatoria(contexto.pacote)
    .filter((entrada) => !citadasEmRiscos.has(entrada.urn))
    .map((entrada) => `riscos_e_regras (falta ${entrada.urn})`);
  if (faltando.length === 0) return aprovar(CHAVE_REGRA_LEGAL_PRESENTE, 'Toda regra legal obrigatória está citada em riscos e regras.');
  return reprovar(CHAVE_REGRA_LEGAL_PRESENTE, `${faltando.length} regra(s) legal(is) obrigatória(s) sem citação.`, faltando);
}
