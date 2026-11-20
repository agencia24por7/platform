import { MAPA_DE_FONTES } from '@/modules/coleta/domain/mapaDeFontes';
import { TABELAS_POR_PLATAFORMA } from '@/modules/coleta/infrastructure/tabelas';
import type { TabelasDaPlataforma } from '@/modules/coleta/infrastructure/tabelas/tipos';
import { PARA_QUE_SERVE, ROTULO_DA_PLATAFORMA, type Platform } from '@/modules/connections/domain/connection';

export type TipoDeTabela = 'fato' | 'scd2' | 'snapshot';

export type TabelaDoRegistro = {
  readonly nome: string;
  readonly tipo: TipoDeTabela;
  readonly plataformas: readonly string[];
  readonly chave: readonly string[];
  readonly tipos: Readonly<Record<string, string>>;
};

export type ConectorPossivel = {
  readonly plataforma: string;
  readonly rotulo: string;
  readonly paraQueServe: string;
  readonly coletavel: boolean;
  readonly motivoForaDoV1: string | null;
  readonly atrasoDias: number;
  readonly snapshot: boolean;
};

function nomeDaTabela(cfg: TabelasDaPlataforma[string]): string {
  if (cfg.tipo === 'fato') return cfg.fato;
  if (cfg.tipo === 'scd2') return cfg.dimensao;
  return cfg.tabela;
}

export function tabelasDoRegistro(
  registro: Readonly<Record<string, TabelasDaPlataforma | undefined>> = TABELAS_POR_PLATAFORMA,
): readonly TabelaDoRegistro[] {
  const porNome = new Map<string, { -readonly [K in keyof TabelaDoRegistro]: TabelaDoRegistro[K] }>();
  for (const [plataforma, tabelas] of Object.entries(registro)) {
    for (const cfg of Object.values(tabelas ?? {})) {
      const nome = nomeDaTabela(cfg);
      const existente = porNome.get(nome);
      if (existente) {
        existente.plataformas = [...new Set([...existente.plataformas, plataforma])].sort();
        continue;
      }
      porNome.set(nome, { nome, tipo: cfg.tipo, plataformas: [plataforma], chave: cfg.chave, tipos: cfg.tipos });
    }
  }
  return [...porNome.values()].sort((a, b) => a.nome.localeCompare(b.nome));
}

export const TABELAS_DO_REGISTRO: readonly TabelaDoRegistro[] = tabelasDoRegistro();

const PLATAFORMAS_POR_TABELA: ReadonlyMap<string, readonly string[]> = new Map(TABELAS_DO_REGISTRO.map((t) => [t.nome, t.plataformas]));

export function plataformasDaTabela(tabela: string): readonly string[] {
  return PLATAFORMAS_POR_TABELA.get(tabela) ?? [];
}

const SNAPSHOT = 'snapshot';

export const CONECTORES_POSSIVEIS: readonly ConectorPossivel[] = (Object.keys(MAPA_DE_FONTES) as Platform[])
  .map((plataforma) => {
    const fonte = MAPA_DE_FONTES[plataforma];
    return {
      plataforma,
      rotulo: ROTULO_DA_PLATAFORMA[plataforma],
      paraQueServe: PARA_QUE_SERVE[plataforma],
      coletavel: fonte.ativaNoV1,
      motivoForaDoV1: fonte.motivoForaDoV1,
      atrasoDias: fonte.atrasoDias,
      snapshot: fonte.grao === SNAPSHOT,
    };
  })
  .sort((a, b) => a.plataforma.localeCompare(b.plataforma));

export function conectorDe(plataforma: string): ConectorPossivel | null {
  return CONECTORES_POSSIVEIS.find((c) => c.plataforma === plataforma) ?? null;
}

export function rotuloDaPlataforma(plataforma: string): string {
  return conectorDe(plataforma)?.rotulo ?? plataforma;
}
