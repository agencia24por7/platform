import { criarAvisoLimitado } from '../logging/avisoLimitado.ts';

export type DadosDoWorkerNaoAutorizado = {
  readonly requestId: string;
  readonly path: string;
};

export type OpcoesDoAvisoDeWorkerNaoAutorizado = {
  readonly janelaMs: number;
  readonly escrever: (evento: string, campos: Record<string, unknown>) => void;
  readonly agora?: () => number;
};

export function criarAvisoDeWorkerNaoAutorizado(opcoes: OpcoesDoAvisoDeWorkerNaoAutorizado): (dados: DadosDoWorkerNaoAutorizado) => void {
  let ultimo: DadosDoWorkerNaoAutorizado | null = null;
  const avisar = criarAvisoLimitado({
    janelaMs: opcoes.janelaMs,
    ...(opcoes.agora ? { agora: opcoes.agora } : {}),
    emitir: ({ suprimidos }) => {
      if (ultimo) opcoes.escrever('worker.unauthorized', { requestId: ultimo.requestId, path: ultimo.path, suprimidos });
    },
  });
  return (dados) => {
    ultimo = dados;
    avisar();
  };
}
