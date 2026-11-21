import type { Epistemico, Fonte, Revisao, SecaoKey } from './catalogo.ts';

export type Marcacao = {
  readonly epistemico: Epistemico;
  readonly fonte: Fonte;
  readonly revisao: Revisao;
  readonly compartilhavel: boolean;
};

export type EntradaDeCampo = Marcacao & {
  readonly secao: SecaoKey;
  readonly fieldKey: string;
  readonly valor: unknown;
  readonly versao: number;
  readonly atualizadoEm: Date;
  readonly atualizadoPor: string | null;
  readonly viaLink: boolean;
};

export type DadosDoItem = Readonly<Record<string, unknown>>;

export type ItemDeLista = Marcacao & {
  readonly id: string;
  readonly secao: SecaoKey;
  readonly listKey: string;
  readonly posicao: number;
  readonly dados: DadosDoItem;
  readonly versao: number;
  readonly atualizadoEm: Date;
  readonly viaLink: boolean;
};

export type ArquivoDeContexto = {
  readonly id: string;
  readonly secao: SecaoKey;
  readonly fieldKey: string;
  readonly itemId: string | null;
  readonly caminho: string;
  readonly nome: string;
  readonly mime: string;
  readonly tamanhoBytes: number;
  readonly sha256: string;
  readonly fonte: Fonte;
  readonly compartilhavel: boolean;
  readonly criadoEm: Date;
};

export type ContextoBruto = {
  readonly campos: readonly EntradaDeCampo[];
  readonly itens: readonly ItemDeLista[];
  readonly arquivos: readonly ArquivoDeContexto[];
};

export function ehVisivelAoCliente(marcacao: Marcacao): boolean {
  if (!marcacao.compartilhavel) return false;
  if (marcacao.fonte === 'cliente') return true;
  return marcacao.revisao === 'confirmado' && marcacao.epistemico !== 'hipotese';
}

export function entraNoBrain(marcacao: Marcacao): boolean {
  return marcacao.revisao === 'confirmado';
}
