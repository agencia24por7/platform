import { criarAvisoLimitado } from '../logging/avisoLimitado.ts';

export type DadosDoLimiteDoWorker = {
  readonly requestId: string;
  readonly path: string;
  readonly callerFingerprint: string;
  readonly retryAfterSeconds: number;
};

export type OpcoesDoAvisoDoLimiteDoWorker = {
  readonly janelaMs: number;
  readonly escrever: (evento: string, campos: Record<string, unknown>) => void;
  readonly agora?: () => number;
};

export function criarAvisoDoLimiteDoWorker(opcoes: OpcoesDoAvisoDoLimiteDoWorker): (dados: DadosDoLimiteDoWorker) => void {
  let ultimo: DadosDoLimiteDoWorker | null = null;
  const avisar = criarAvisoLimitado({
    janelaMs: opcoes.janelaMs,
    ...(opcoes.agora ? { agora: opcoes.agora } : {}),
    emitir: ({ suprimidos }) => {
      if (ultimo) opcoes.escrever('worker.limite_excedido', { ...ultimo, suprimidos });
    },
  });
  return (dados) => {
    ultimo = dados;
    avisar();
  };
}
