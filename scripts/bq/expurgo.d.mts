export type EntradaDoManifesto = {
  readonly tabela: string;
  readonly chave: string;
  readonly plataforma: string;
  readonly colunaPlataforma?: string;
  readonly data?: string;
  readonly momento?: string;
  readonly todoPeriodo?: true;
};

export type Destino = { readonly projeto: string; readonly dataset: string };

export type Fonte = { readonly organizationId: string; readonly platform: string; readonly externalId: string };

export type Passo = { readonly nome: string; readonly sql: string };

export type ResultadoDosPassos = {
  readonly ok: boolean;
  readonly falhou: string | null;
  readonly pendentes: readonly string[];
  readonly erro: unknown;
};

export function validarEntrada(entrada: Partial<EntradaDoManifesto> & Record<string, unknown>): boolean;
export function literalBigQuery(valor: string): string;
export function sqlExpurgoPorPosse(fato: EntradaDoManifesto, destino: Destino): string;
export function sqlExpurgoDasSobras(fato: EntradaDoManifesto, destino: Destino, fontes: readonly Fonte[]): string | null;
export function sqlVersoesDoCliente(destino: Destino): string;
export function sqlExpurgoPorClientId(tabela: string, destino: Destino): string;
export function validarFontes(fontes: readonly Fonte[]): readonly Fonte[];
export function passosPorClientId(tabelasComCliente: readonly string[], destino: Destino): readonly Passo[];
export function planoDoExpurgo(entrada: {
  readonly manifesto: readonly EntradaDoManifesto[];
  readonly tabelasComCliente: readonly string[];
  readonly fontes: readonly Fonte[];
  readonly destino: Destino;
}): readonly Passo[];
export function executarPassos(passos: readonly Passo[], executar: (passo: Passo) => void): ResultadoDosPassos;
