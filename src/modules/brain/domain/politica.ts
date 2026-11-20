import { selar, type EntradaDoCatalogo, type EntradaSemSelo } from './entrada.ts';

export type ResultadoDaPolitica = {
  readonly entradas: readonly EntradaDoCatalogo[];
  readonly omitidas: number;
  readonly restritas: number;
};

export const MOTIVO_RESTRITO = 'Uso restrito por política de sensibilidade: o agente vê só os metadados, sem caminho de acesso nem valor.';

function semSelo(entrada: EntradaDoCatalogo): EntradaSemSelo {
  const { hash: _hash, schemaVersion: _versao, ...resto } = entrada;
  return resto;
}

export function metadadosApenas(entrada: EntradaDoCatalogo): EntradaSemSelo {
  return { ...semSelo(entrada), acesso: { tipo: 'restrito', motivo: MOTIVO_RESTRITO }, valorResumido: null };
}

export function aplicarPoliticaDeUso(entradas: readonly EntradaDoCatalogo[]): ResultadoDaPolitica {
  const visiveis = entradas.filter((entrada) => entrada.sensibilidade.usoPorAgente !== 'negado');
  const urnsVisiveis = new Set(visiveis.map((entrada) => entrada.urn));
  let restritas = 0;
  const resultado = visiveis.map((entrada) => {
    const restrita = entrada.sensibilidade.usoPorAgente === 'restrito';
    if (restrita) restritas += 1;
    const base = restrita ? metadadosApenas(entrada) : semSelo(entrada);
    const relacoes = base.relacoes.filter((relacao) => urnsVisiveis.has(relacao.urn));
    if (!restrita && relacoes.length === base.relacoes.length) return entrada;
    return selar({ ...base, relacoes });
  });
  return { entradas: resultado, omitidas: entradas.length - visiveis.length, restritas };
}
