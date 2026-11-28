import { validarAjuste } from '../comite/ajuste.ts';
import { conferirAjusteContraOJuiz } from '../comite/juiz.ts';
import { CHAVE_DO_COMITE_OBRIGATORIO, COMITES } from '../comite/comites.ts';
import { aprovar, reprovar, type ContextoDoGate, type ResultadoDaChecagem } from './resultado.ts';

export const CHAVE_COMITE_COMPLETO = 'comite_completo';

export function checarComiteCompleto(contexto: ContextoDoGate): ResultadoDaChecagem {
  const { pareceres, ajuste } = contexto;
  if (contexto.comiteDaMesmaExecucao === false) {
    return reprovar(CHAVE_COMITE_COMPLETO, 'Os pareceres ou ajustes da cadeia são de outra execução.', ['comite']);
  }
  if (pareceres === undefined) return reprovar(CHAVE_COMITE_COMPLETO, 'Pareceres do Comitê ausentes no contexto.', ['comite']);

  const quemOpinou = new Set(pareceres.map((p) => p.persona));
  const convocados = new Set([...(contexto.comitesConvocados ?? COMITES.map((comite) => comite.chave)), CHAVE_DO_COMITE_OBRIGATORIO]);
  const semParecer = [...convocados].filter((chave) => !quemOpinou.has(chave)).map((chave) => `comite/${chave} (sem parecer)`);
  if (semParecer.length > 0) {
    return reprovar(CHAVE_COMITE_COMPLETO, `${semParecer.length} comitê(s) convocado(s) sem parecer.`, semParecer);
  }

  const exigeAjuste = pareceres.some((p) => p.veredito !== 'aprova');
  if (!exigeAjuste) return aprovar(CHAVE_COMITE_COMPLETO, 'Todos os comitês convocados aprovaram.');
  if (ajuste === undefined) {
    return reprovar(CHAVE_COMITE_COMPLETO, 'Há parecer que pede ajuste ou reprova e o ajuste está ausente.', ['comite/ajuste']);
  }

  const validacao = validarAjuste(pareceres, ajuste);
  if (!validacao.ok) {
    const problemas = validacao.error.map((erro) => `comite/${erro.persona}/${erro.pontoId} (${erro.codigo})`);
    return reprovar(CHAVE_COMITE_COMPLETO, `${problemas.length} problema(s) na resposta do ajuste aos pareceres.`, problemas);
  }
  const contraOJuiz = conferirAjusteContraOJuiz(pareceres, ajuste, contexto.vereditosDoJuiz).map((erro) => `comite/${erro.persona}/${erro.pontoId} (${erro.codigo})`);
  if (contraOJuiz.length > 0) {
    return reprovar(CHAVE_COMITE_COMPLETO, `${contraOJuiz.length} ponto(s) em desacordo com o veredito do juiz.`, contraOJuiz);
  }
  return aprovar(CHAVE_COMITE_COMPLETO, 'Comitê completo, todo ponto respondido e todo aceito pelo juiz aplicado.');
}
