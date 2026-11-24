export type MarcaDoContexto = 'fato' | 'hipotese' | 'desejo';
export type RevisaoDoContexto = 'confirmado' | 'sugerido';

export type OpcaoDoCampo = { readonly valor: string; readonly rotulo: string };

export type CampoDoContexto = {
  readonly key: string;
  readonly rotulo: string;
  readonly ajuda: string | null;
  readonly nivel: 'essencial' | 'aprofundar';
  readonly tipo: string;
  readonly visivelAoCliente: boolean;
  readonly contaNaCompletude: boolean;
  readonly opcoes?: readonly OpcaoDoCampo[];
  readonly unidade?: string | null;
  readonly item?: readonly CampoDoContexto[];
  readonly minimo?: number;
  readonly campoTitulo?: string;
  readonly arquivoBrain?: string;
  readonly avisoDeDadoPessoal?: string | null;
};

export type SecaoDoContexto = {
  readonly key: string;
  readonly titulo: string;
  readonly descricao: string;
  readonly campos: readonly CampoDoContexto[];
};

export type MarcacaoDoContexto = {
  readonly epistemico: MarcaDoContexto;
  readonly fonte: string;
  readonly revisao: RevisaoDoContexto;
  readonly compartilhavel: boolean;
};

export type ValorDoContexto = MarcacaoDoContexto & {
  readonly secao: string;
  readonly fieldKey: string;
  readonly valor: unknown;
  readonly versao: number;
  readonly atualizadoEm: Date;
};

export type ItemDoContexto = MarcacaoDoContexto & {
  readonly id: string;
  readonly secao: string;
  readonly listKey: string;
  readonly dados: Readonly<Record<string, unknown>>;
  readonly versao: number;
  readonly atualizadoEm: Date;
};

export type ArquivoDoContexto = {
  readonly id: string;
  readonly secao: string;
  readonly fieldKey: string;
  readonly caminho: string;
  readonly nome: string;
  readonly mime: string;
  readonly tamanhoBytes: number;
  readonly sha256: string;
  readonly fonte: string;
  readonly compartilhavel: boolean;
  readonly criadoEm: Date;
};

export type CompletudeDaSecaoDoContexto = {
  readonly secao: string;
  readonly percentual: number;
  readonly preenchidos: number;
  readonly total: number;
  readonly essenciaisPreenchidos: number;
  readonly essenciaisTotal: number;
  readonly essenciaisCompletos: boolean;
};

export type EstadoDoExportDoContexto = {
  readonly exportadoEm: Date | null;
  readonly hash: string | null;
  readonly pendente: boolean;
  readonly ultimoErro: string | null;
};

export type ContextoParaCatalogo = {
  readonly catalogoVersao: number;
  readonly catalogo: readonly SecaoDoContexto[];
  readonly campos: Readonly<Record<string, ValorDoContexto>>;
  readonly listas: Readonly<Record<string, readonly ItemDoContexto[]>>;
  readonly arquivos: readonly ArquivoDoContexto[];
  readonly completude: {
    readonly geral: number;
    readonly essenciaisCompletos: boolean;
    readonly secoes: readonly CompletudeDaSecaoDoContexto[];
  };
  readonly brain: EstadoDoExportDoContexto;
};

export type EscopoDoContexto = { readonly organizationId: string; readonly clientId: string };

export type CarregadorDeContexto = {
  readonly disponivel: boolean;
  carregar(escopo: EscopoDoContexto): Promise<ContextoParaCatalogo | null>;
};

export const CARREGADOR_DE_CONTEXTO_INDISPONIVEL: CarregadorDeContexto = {
  disponivel: false,
  carregar: () => Promise.resolve(null),
};

export function restringirAoCatalogo(contexto: ContextoParaCatalogo): ContextoParaCatalogo {
  const chavesDaSecao = new Map(contexto.catalogo.map((secao) => [secao.key, new Set(secao.campos.map((campo) => campo.key))]));
  const listas = new Set(contexto.catalogo.flatMap((secao) => secao.campos.filter((c) => c.tipo === 'lista').map((c) => c.key)));
  const conhecido = (secao: string, chave: string): boolean => chavesDaSecao.get(secao)?.has(chave) === true;
  return {
    ...contexto,
    campos: Object.fromEntries(Object.entries(contexto.campos).filter(([chave, valor]) => chave === valor.fieldKey && conhecido(valor.secao, chave))),
    listas: Object.fromEntries(Object.entries(contexto.listas).filter(([chave]) => listas.has(chave))),
    arquivos: contexto.arquivos.filter((arquivo) => conhecido(arquivo.secao, arquivo.fieldKey)),
  };
}

export function prefixoDoExportDoContexto(organizationId: string, clientId: string): string {
  return `orgs/${organizationId}/clientes/${clientId}/contexto/brain/`;
}
