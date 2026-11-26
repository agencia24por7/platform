import { validarAjuste } from '../comite/ajuste.ts';
import { PERSONAS } from '../comite/personas.ts';
import { aprovar, reprovar, type ContextoDoGate, type ResultadoDaChecagem } from './resultado.ts';

export const CHAVE_COMITE_COMPLETO = 'comite_completo';

export function checarComiteCompleto(contexto: ContextoDoGate): ResultadoDaChecagem {
  const { pareceres, ajuste } = contexto;
  if (contexto.comiteDaMesmaExecucao === false) {
    return reprovar(CHAVE_COMITE_COMPLETO, 'Os pareceres ou ajustes da cadeia são de outra execução.', ['comite']);
  }
  if (pareceres === undefined) return reprovar(CHAVE_COMITE_COMPLETO, 'Pareceres do Comitê ausentes no contexto.', ['comite']);

  const quemOpinou = new Set(pareceres.map((p) => p.persona));
  const semParecer = PERSONAS.filter((persona) => !quemOpinou.has(persona.chave)).map((persona) => `comite/${persona.chave} (sem parecer)`);
  if (semParecer.length > 0) {
    return reprovar(CHAVE_COMITE_COMPLETO, `${semParecer.length} persona(s) sem parecer.`, semParecer);
  }

  const exigeAjuste = pareceres.some((p) => p.veredito !== 'aprova');
  if (!exigeAjuste) return aprovar(CHAVE_COMITE_COMPLETO, 'Todas as personas aprovaram.');
  if (ajuste === undefined) {
    return reprovar(CHAVE_COMITE_COMPLETO, 'Há parecer que pede ajuste ou reprova e o ajuste está ausente.', ['comite/ajuste']);
  }

  const validacao = validarAjuste(pareceres, ajuste);
  if (validacao.ok) return aprovar(CHAVE_COMITE_COMPLETO, 'Comitê completo e todo ponto respondido.');
  const problemas = validacao.error.map((erro) => `comite/${erro.persona}/${erro.pontoId} (${erro.codigo})`);
  return reprovar(CHAVE_COMITE_COMPLETO, `${problemas.length} problema(s) na resposta do ajuste aos pareceres.`, problemas);
}
