import { CHAVE_COMITE_COMPLETO, checarComiteCompleto } from './comiteCompleto.ts';
import { CHAVE_EVIDENCIA_VIGENTE, checarEvidenciaVigente } from './evidenciaVigente.ts';
import { CHAVE_LIMITES_DO_CLIENTE, checarLimitesDoCliente } from './limitesDoCliente.ts';
import { CHAVE_META_SEM_NOTA_D, checarMetaSemNotaD } from './metaSemNotaD.ts';
import { CHAVE_NAO_FAREMOS, checarNaoFaremos } from './naoFaremos.ts';
import { CHAVE_NAO_FAREMOS_PRESERVADO, checarNaoFaremosPreservado } from './naoFaremosPreservado.ts';
import { CHAVE_OBJETIVO_COM_METRICA, checarObjetivoComMetrica } from './objetivoComMetrica.ts';
import { CHAVE_ORCAMENTO_FECHA, checarOrcamentoFecha } from './orcamentoFecha.ts';
import { CHAVE_REGRA_LEGAL_PRESENTE, checarRegraLegalPresente } from './regraLegalPresente.ts';
import type { Checagem } from './resultado.ts';
import { CHAVE_SECOES_OBRIGATORIAS, checarSecoesObrigatorias } from './secoesObrigatorias.ts';
import { CHAVE_URNS_NO_PACOTE, checarUrnsNoPacote } from './urnsNoPacote.ts';

export const CHECAGENS_EM_CODIGO: readonly Checagem[] = [
  { chave: CHAVE_URNS_NO_PACOTE, executar: checarUrnsNoPacote },
  { chave: CHAVE_EVIDENCIA_VIGENTE, executar: checarEvidenciaVigente },
  { chave: CHAVE_META_SEM_NOTA_D, executar: checarMetaSemNotaD },
  { chave: CHAVE_LIMITES_DO_CLIENTE, executar: checarLimitesDoCliente },
  { chave: CHAVE_NAO_FAREMOS, executar: checarNaoFaremos },
  { chave: CHAVE_NAO_FAREMOS_PRESERVADO, executar: checarNaoFaremosPreservado },
  { chave: CHAVE_REGRA_LEGAL_PRESENTE, executar: checarRegraLegalPresente },
  { chave: CHAVE_SECOES_OBRIGATORIAS, executar: checarSecoesObrigatorias },
  { chave: CHAVE_ORCAMENTO_FECHA, executar: checarOrcamentoFecha },
  { chave: CHAVE_OBJETIVO_COM_METRICA, executar: checarObjetivoComMetrica },
  { chave: CHAVE_COMITE_COMPLETO, executar: checarComiteCompleto },
];
