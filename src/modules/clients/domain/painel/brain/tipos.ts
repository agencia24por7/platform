export const FRESCORES = ['fresco', 'atrasado', 'parado', 'desconhecido'] as const;
export type Frescor = (typeof FRESCORES)[number];

export const TIPOS_DE_ENTRADA = [
  'conexao',
  'fonte',
  'tabela_de_dados',
  'contexto_secao',
  'contexto_lista',
  'arquivo',
  'capacidade',
] as const;
export type TipoDeEntrada = (typeof TIPOS_DE_ENTRADA)[number];

export const AGRUPAMENTOS = ['conexoes', 'dados', 'contexto', 'arquivos'] as const;
export type Agrupamento = (typeof AGRUPAMENTOS)[number];

export const NIVEIS_DE_SENSIBILIDADE = ['publico', 'negocio', 'pessoal_possivel', 'restrito'] as const;
export type NivelDeSensibilidade = (typeof NIVEIS_DE_SENSIBILIDADE)[number];

export const USOS_POR_AGENTE = ['permitido', 'restrito', 'negado'] as const;
export type UsoPorAgente = (typeof USOS_POR_AGENTE)[number];

export type ColunaDoEsquema = { readonly nome: string; readonly tipo: string; readonly descricao: string };

export type Relacao = { readonly urn: string; readonly tipo: string };

export type EntradaDoBrain = {
  readonly urn: string;
  readonly tipo: TipoDeEntrada;
  readonly titulo: string;
  readonly descricao: string;
  readonly provedor: string | null;
  readonly esquema: readonly ColunaDoEsquema[];
  readonly grao: string | null;
  readonly cobertura: {
    readonly desde: string | null;
    readonly ate: string | null;
    readonly linhas: number | null;
    readonly diasComDado: number | null;
    readonly ultimos90Dias: readonly boolean[] | null;
  };
  readonly frescor: { readonly status: Frescor; readonly ultimaAtualizacao: string | null };
  readonly qualidade: { readonly completude: number; readonly avisos: readonly string[] };
  readonly acesso: { readonly via: 'bigquery' | 'contexto' | 'arquivo' | 'status' | 'derivado' | 'restrito' | 'externo'; readonly receita: string };
  readonly sensibilidade: {
    readonly nivel: NivelDeSensibilidade;
    readonly piiPossivel: boolean;
    readonly usoPorAgente: UsoPorAgente;
  };
  readonly tags: readonly string[];
  readonly relacoes: readonly Relacao[];
};

export type EstadoDaCapacidade = 'disponivel' | 'parcial' | 'indisponivel';

export type Capacidade = {
  readonly id: string;
  readonly pergunta: string;
  readonly estado: EstadoDaCapacidade;
  readonly evidencias: readonly string[];
  readonly falta: readonly string[];
  readonly acao: { readonly rotulo: string; readonly href: string } | null;
};

export type ProximaAcao = {
  readonly id: string;
  readonly titulo: string;
  readonly porque: string;
  readonly impacto: 1 | 2 | 3;
  readonly href: string;
  readonly rotulo: string;
};

export type Lacuna = { readonly agrupamento: Agrupamento; readonly rotulo: string; readonly href: string };

export type PulsoDoBrain = {
  readonly saude: number;
  readonly cobertura: number;
  readonly frescor: number;
  readonly completudeDoContexto: number;
};

export type BrainDoCliente = {
  readonly origem: 'exemplo' | 'real';
  readonly versao: string;
  readonly hash: string;
  readonly atualizadoEm: string;
  readonly pulso: PulsoDoBrain;
  readonly entradas: readonly EntradaDoBrain[];
  readonly capacidades: readonly Capacidade[];
  readonly acoes: readonly ProximaAcao[];
  readonly lacunas: readonly Lacuna[];
  readonly catalogoMd: string;
};

export const ROTULO_DO_FRESCOR: Record<Frescor, string> = {
  fresco: 'Em dia',
  atrasado: 'Atrasado',
  parado: 'Parado',
  desconhecido: 'Sem leitura',
};

export const ROTULO_DO_AGRUPAMENTO: Record<Agrupamento, string> = {
  conexoes: 'Conexões',
  dados: 'Dados',
  contexto: 'Contexto',
  arquivos: 'Arquivos',
};

export const ROTULO_DO_TIPO: Record<TipoDeEntrada, string> = {
  conexao: 'Conexão',
  fonte: 'Fonte',
  tabela_de_dados: 'Tabela',
  contexto_secao: 'Seção do contexto',
  contexto_lista: 'Lista do contexto',
  arquivo: 'Arquivo',
  capacidade: 'Capacidade',
};

export const ROTULO_DA_SENSIBILIDADE: Record<NivelDeSensibilidade, string> = {
  publico: 'Público',
  negocio: 'Negócio',
  pessoal_possivel: 'Pode ter dado pessoal',
  restrito: 'Restrito',
};

export function agrupamentoDe(tipo: TipoDeEntrada): Agrupamento | null {
  switch (tipo) {
    case 'conexao':
      return 'conexoes';
    case 'fonte':
    case 'tabela_de_dados':
      return 'dados';
    case 'contexto_secao':
    case 'contexto_lista':
      return 'contexto';
    case 'arquivo':
      return 'arquivos';
    case 'capacidade':
      return null;
  }
}
