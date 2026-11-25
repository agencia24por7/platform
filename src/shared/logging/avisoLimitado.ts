import { criarJanelaLimitada } from '../security/janelaLimitada.ts';

export type OpcoesDoAvisoLimitado = {
  readonly janelaMs: number;
  readonly emitir: (contexto: { readonly suprimidos: number }) => void;
  readonly agora?: () => number;
};

export type AvisoLimitado = () => void;

const CHAVE_UNICA = 'aviso';

export function criarAvisoLimitado(opcoes: OpcoesDoAvisoLimitado): AvisoLimitado {
  const janela = criarJanelaLimitada({
    limite: 1,
    janelaMs: opcoes.janelaMs,
    maxChaves: 1,
    ...(opcoes.agora ? { agora: opcoes.agora } : {}),
  });
  let suprimidos = 0;

  return () => {
    if (!janela.permitir(CHAVE_UNICA)) {
      suprimidos += 1;
      return;
    }
    const contexto = { suprimidos };
    suprimidos = 0;
    opcoes.emitir(contexto);
  };
}
