import type { CompletudeDaSecao } from '../contexto/completude.ts';
import { barrasDaSecao, type BarrasDaSecao } from './resumo.ts';

export const PASSO_DO_DESTINO = 'destino';

export type EstadoDoPasso = BarrasDaSecao['estado'];

export type PassoDoMapa = {
  readonly chave: string;
  readonly marca: string;
  readonly titulo: string;
  readonly estado: EstadoDoPasso;
  readonly concluido: boolean;
};

export type ProgressoDoDestino = { readonly percentual: number; readonly completo: boolean; readonly resumo: string };

export type ResumoDoMapa = {
  readonly passos: readonly PassoDoMapa[];
  readonly geral: number;
  readonly concluidos: number;
};

function estadoDoDestino(progresso: ProgressoDoDestino): EstadoDoPasso {
  if (progresso.completo) return 'completa';
  return progresso.percentual > 0 ? 'comecada' : 'vazia';
}

export function resumoDoMapa(
  secoes: readonly { readonly key: string; readonly letra: string; readonly titulo: string }[],
  completude: { readonly geral: number; readonly secoes: readonly CompletudeDaSecao[] },
  destino: ProgressoDoDestino | null,
): ResumoDoMapa {
  const passos: PassoDoMapa[] = secoes.map((secao) => {
    const c = completude.secoes.find((x) => x.secao === secao.key);
    const estado = c ? barrasDaSecao(c).estado : 'vazia';
    const concluido = estado === 'completa' || estado === 'essencial_ok';
    return { chave: secao.key, marca: concluido ? '✓' : secao.letra, titulo: secao.titulo, estado, concluido };
  });
  if (destino) {
    const estado = estadoDoDestino(destino);
    passos.push({ chave: PASSO_DO_DESTINO, marca: destino.completo ? '✓' : '→', titulo: 'Destino', estado, concluido: destino.completo });
  }
  return { passos, geral: completude.geral, concluidos: passos.filter((passo) => passo.concluido).length };
}

export function vizinhosDoPasso(passos: readonly PassoDoMapa[], chave: string): { readonly anterior: PassoDoMapa | null; readonly proximo: PassoDoMapa | null } {
  const indice = passos.findIndex((passo) => passo.chave === chave);
  return { anterior: indice > 0 ? passos[indice - 1]! : null, proximo: indice >= 0 && indice < passos.length - 1 ? passos[indice + 1]! : null };
}
