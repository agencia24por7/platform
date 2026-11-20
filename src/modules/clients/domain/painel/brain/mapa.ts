import { AGRUPAMENTOS, agrupamentoDe, type Agrupamento, type BrainDoCliente, type Frescor } from './tipos.ts';

export const LARGURA_DO_MAPA = 1000;
export const ALTURA_DO_MAPA = 640;
export const MAX_NOS_POR_GRUPO = 14;

const CENTRO = { x: LARGURA_DO_MAPA / 2, y: ALTURA_DO_MAPA / 2 };
const POSICAO_DO_GRUPO: Record<Agrupamento, { readonly x: number; readonly y: number; readonly angulo: number }> = {
  conexoes: { x: 220, y: 160, angulo: (-3 * Math.PI) / 4 },
  dados: { x: 780, y: 160, angulo: -Math.PI / 4 },
  contexto: { x: 220, y: 480, angulo: (3 * Math.PI) / 4 },
  arquivos: { x: 780, y: 480, angulo: Math.PI / 4 },
};

export type NoDoMapa = {
  readonly urn: string;
  readonly titulo: string;
  readonly x: number;
  readonly y: number;
  readonly raio: number;
  readonly frescor: Frescor;
  readonly cobertura: number;
};

export type LacunaNoMapa = { readonly rotulo: string; readonly href: string; readonly x: number; readonly y: number };

export type GrupoDoMapa = {
  readonly agrupamento: Agrupamento;
  readonly x: number;
  readonly y: number;
  readonly rotuloX: number;
  readonly rotuloY: number;
  readonly nos: readonly NoDoMapa[];
  readonly lacunas: readonly LacunaNoMapa[];
  readonly ocultos: number;
  readonly total: number;
};

export type Mapa = { readonly centro: { readonly x: number; readonly y: number }; readonly grupos: readonly GrupoDoMapa[] };

const ABERTURA = (4 * Math.PI) / 3;

function arredondar(n: number): number {
  return Math.round(n * 10) / 10;
}

function posicoes(quantidade: number, centro: { x: number; y: number; angulo: number }): { x: number; y: number }[] {
  const lista: { x: number; y: number }[] = [];
  const porAnel = [6, 10, 14];
  let restante = quantidade;
  let anel = 0;
  while (restante > 0 && anel < porAnel.length) {
    const nesteAnel = Math.min(restante, porAnel[anel]!);
    const raio = 62 + anel * 46;
    for (let i = 0; i < nesteAnel; i++) {
      const angulo = centro.angulo - ABERTURA / 2 + ((i + 0.5) / nesteAnel) * ABERTURA + (anel % 2) * (ABERTURA / nesteAnel / 2);
      lista.push({ x: arredondar(centro.x + raio * Math.cos(angulo)), y: arredondar(centro.y + raio * Math.sin(angulo)) });
    }
    restante -= nesteAnel;
    anel += 1;
  }
  return lista;
}

function cobertura(entrada: BrainDoCliente['entradas'][number]): number {
  if (entrada.cobertura.diasComDado !== null) return Math.min(entrada.cobertura.diasComDado / 90, 1);
  return Math.min(Math.max(entrada.qualidade.completude, 0), 1);
}

export function montarMapa(brain: Pick<BrainDoCliente, 'entradas' | 'lacunas'>): Mapa {
  const grupos = AGRUPAMENTOS.map((agrupamento): GrupoDoMapa => {
    const posicao = POSICAO_DO_GRUPO[agrupamento];
    const doGrupo = brain.entradas.filter((e) => agrupamentoDe(e.tipo) === agrupamento);
    const visiveis = doGrupo.slice(0, MAX_NOS_POR_GRUPO);
    const lacunasDoGrupo = brain.lacunas.filter((l) => l.agrupamento === agrupamento).slice(0, 4);
    const lugares = posicoes(visiveis.length + lacunasDoGrupo.length, posicao);
    return {
      agrupamento,
      x: posicao.x,
      y: posicao.y,
      rotuloX: arredondar(posicao.x + (CENTRO.x - posicao.x) * 0.3),
      rotuloY: arredondar(posicao.y + (CENTRO.y - posicao.y) * 0.3 + 5),
      total: doGrupo.length,
      ocultos: doGrupo.length - visiveis.length,
      nos: visiveis.map((entrada, i) => {
        const c = cobertura(entrada);
        return {
          urn: entrada.urn,
          titulo: entrada.titulo,
          x: lugares[i]!.x,
          y: lugares[i]!.y,
          raio: arredondar(7 + c * 9),
          frescor: entrada.frescor.status,
          cobertura: Math.round(c * 100),
        };
      }),
      lacunas: lacunasDoGrupo.map((lacuna, i) => ({ ...lacuna, ...lugares[visiveis.length + i]! })),
    };
  });
  return { centro: CENTRO, grupos };
}
