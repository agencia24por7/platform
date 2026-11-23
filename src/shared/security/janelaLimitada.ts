export type OpcoesDaJanela = {
  readonly limite: number;
  readonly janelaMs: number;
  readonly maxChaves: number;
  readonly agora?: () => number;
  readonly aoLotar?: () => void;
};

export type JanelaLimitada = { permitir(chave: string): boolean };

type Contagem = { total: number; venceEm: number };

export function criarJanelaLimitada(opcoes: OpcoesDaJanela): JanelaLimitada {
  const agora = opcoes.agora ?? Date.now;
  const contagens = new Map<string, Contagem>();
  let ultimoAviso = Number.NEGATIVE_INFINITY;

  function recolherVencidas(instante: number): void {
    for (const [chave, contagem] of contagens) {
      if (contagem.venceEm <= instante) contagens.delete(chave);
    }
  }

  function avisarLotacao(instante: number): void {
    if (instante - ultimoAviso < opcoes.janelaMs) return;
    ultimoAviso = instante;
    opcoes.aoLotar?.();
  }

  return {
    permitir(chave) {
      const instante = agora();
      const atual = contagens.get(chave);
      if (atual && atual.venceEm > instante) {
        if (atual.total >= opcoes.limite) return false;
        atual.total += 1;
        return true;
      }
      if (!atual && contagens.size >= opcoes.maxChaves) {
        recolherVencidas(instante);
        if (contagens.size >= opcoes.maxChaves) {
          avisarLotacao(instante);
          return true;
        }
      }
      contagens.set(chave, { total: 1, venceEm: instante + opcoes.janelaMs });
      return true;
    },
  };
}
