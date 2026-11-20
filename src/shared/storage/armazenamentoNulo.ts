import { type ArmazenamentoDeContexto, ArmazenamentoIndisponivelError } from './tipos.ts';

export function criarArmazenamentoNulo(): ArmazenamentoDeContexto {
  const indisponivel = (): Promise<never> => Promise.reject(new ArmazenamentoIndisponivelError());

  return {
    disponivel: false,
    put: indisponivel,
    get: indisponivel,
    list: indisponivel,
    delete: indisponivel,
    deletePrefix: indisponivel,
    saudavel: () => Promise.resolve(false),
  };
}
