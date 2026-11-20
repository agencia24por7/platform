export type LinhaBruta = Record<string, unknown>;

export type TiposDasColunas = Readonly<Record<string, string>>;

export type ContextoGravacao = {
  readonly organizationId: string;
  readonly clientId: string;
  readonly externalId: string;
  readonly currency: string;
  readonly execucaoId: string;
};

type Mapeamento = {
  readonly mapear: (linha: LinhaBruta, ctx: ContextoGravacao) => Record<string, unknown>;
  readonly preparar?: (linhas: readonly LinhaBruta[]) => readonly LinhaBruta[];
};

export type ConfiguracaoFato = Mapeamento & {
  readonly tipo: 'fato';
  readonly staging: string;
  readonly fato: string;
  readonly chave: readonly string[];
  readonly colunas: readonly string[];
  readonly tipos: TiposDasColunas;
};

export type ConfiguracaoScd2 = Mapeamento & {
  readonly tipo: 'scd2';
  readonly staging: string;
  readonly dimensao: string;
  readonly chave: readonly string[];
  readonly atributos: readonly string[];
  readonly tipos: TiposDasColunas;
  readonly renovaCarregadoEm?: true;
};

export type ConfiguracaoSnapshot = Mapeamento & {
  readonly tipo: 'snapshot';
  readonly tabela: string;
  readonly chave: readonly string[];
  readonly colunaMomento: string;
  readonly tipos: TiposDasColunas;
};

export type ConfiguracaoTabela = ConfiguracaoFato | ConfiguracaoScd2 | ConfiguracaoSnapshot;

export type TabelasDaPlataforma = Readonly<Record<string, ConfiguracaoTabela>>;

export const TABELA_PADRAO = 'padrao';

export const agora = (): string => new Date().toISOString();
