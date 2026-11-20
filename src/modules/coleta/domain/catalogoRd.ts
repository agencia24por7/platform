import { diaNoFuso } from './eventosDoDataset.ts';
import { booleano, dataIso, enumeracao, identificador, inteiro, instante, numero, texto, type LinhaDaFonte } from './valoresSeguros.ts';

export const TabelaRd = {
  Funil: 'dim_funil',
  Etapa: 'dim_etapa',
  Fonte: 'dim_fonte',
  Campanha: 'dim_campanha',
  Produto: 'dim_produto',
  Usuario: 'dim_usuario',
  ProdutoDaNegociacao: 'negociacao_produtos',
  EtapaDaNegociacao: 'negociacao_etapas',
  TarefaPorDia: 'tarefas_diarias',
} as const;

export const TIPOS_DE_TAREFA = ['call', 'email', 'meeting', 'task', 'lunch', 'visit', 'whatsapp'] as const;

export const StatusDaTarefa = { Concluida: 'concluida', Pendente: 'pendente' } as const;

export type FunilRd = { readonly funil_id: string; readonly nome: string | null };
export type EtapaRd = { readonly etapa_id: string; readonly funil_id: string | null; readonly nome: string | null; readonly ordem: number | null };
export type FonteRd = { readonly fonte_id: string; readonly nome: string | null };
export type CampanhaRd = { readonly campanha_id: string; readonly nome: string | null };
export type ProdutoRd = { readonly produto_id: string; readonly nome: string | null; readonly preco: number | null; readonly ativo: boolean | null };
export type UsuarioRd = { readonly usuario_id: string; readonly ativo: boolean | null };
export type ProdutoDaNegociacaoRd = {
  readonly deal_id: string;
  readonly deal_produto_id: string;
  readonly produto_id: string | null;
  readonly quantidade: number | null;
  readonly preco: number | null;
  readonly desconto: number | null;
  readonly total: number | null;
  readonly data_snapshot: string;
};
export type EtapaDaNegociacaoRd = {
  readonly deal_id: string;
  readonly etapa_id: string;
  readonly entrou_em: string;
  readonly data_dia: string;
};
export type TarefaPorDiaRd = {
  readonly data_dia: string;
  readonly tipo: string;
  readonly status: string;
  readonly quantidade: number;
};

export function funilDaLinha(linha: LinhaDaFonte): FunilRd | null {
  const funilId = identificador(linha.funilId);
  return funilId ? { funil_id: funilId, nome: texto(linha.nome) } : null;
}

export function etapaDaLinha(linha: LinhaDaFonte): EtapaRd | null {
  const etapaId = identificador(linha.etapaId);
  if (!etapaId) return null;
  return { etapa_id: etapaId, funil_id: identificador(linha.funilId), nome: texto(linha.nome), ordem: inteiro(linha.ordem) };
}

export function fonteDaLinha(linha: LinhaDaFonte): FonteRd | null {
  const fonteId = identificador(linha.fonteId);
  return fonteId ? { fonte_id: fonteId, nome: texto(linha.nome) } : null;
}

export function campanhaDaLinha(linha: LinhaDaFonte): CampanhaRd | null {
  const campanhaId = identificador(linha.campanhaId);
  return campanhaId ? { campanha_id: campanhaId, nome: texto(linha.nome) } : null;
}

export function produtoDaLinha(linha: LinhaDaFonte): ProdutoRd | null {
  const produtoId = identificador(linha.produtoId);
  if (!produtoId) return null;
  return { produto_id: produtoId, nome: texto(linha.nome), preco: numero(linha.preco), ativo: booleano(linha.ativo) };
}

export function usuarioDaLinha(linha: LinhaDaFonte): UsuarioRd | null {
  const usuarioId = identificador(linha.usuarioId);
  return usuarioId ? { usuario_id: usuarioId, ativo: booleano(linha.ativo) } : null;
}

export function produtoDaNegociacaoDaLinha(dataSnapshot: string): (linha: LinhaDaFonte) => ProdutoDaNegociacaoRd | null {
  return (linha) => {
    const dealId = identificador(linha.dealId);
    const dealProdutoId = identificador(linha.dealProdutoId);
    if (!dealId || !dealProdutoId) return null;
    return {
      deal_id: dealId,
      deal_produto_id: dealProdutoId,
      produto_id: identificador(linha.produtoId),
      quantidade: numero(linha.quantidade),
      preco: numero(linha.preco),
      desconto: numero(linha.desconto),
      total: numero(linha.total),
      data_snapshot: dataSnapshot,
    };
  };
}

export function etapaDaNegociacaoDaLinha(linha: LinhaDaFonte): EtapaDaNegociacaoRd | null {
  const dealId = identificador(linha.dealId);
  const etapaId = identificador(linha.etapaId);
  const entrouEm = instante(linha.entrouEm);
  if (!dealId || !etapaId || !entrouEm) return null;
  return { deal_id: dealId, etapa_id: etapaId, entrou_em: entrouEm, data_dia: diaNoFuso(new Date(entrouEm)) };
}

export function tarefaPorDiaDaLinha(linha: LinhaDaFonte): TarefaPorDiaRd | null {
  const dataDia = dataIso(linha.dataDia);
  const tipo = enumeracao(linha.tipo);
  const status = linha.status === StatusDaTarefa.Concluida || linha.status === StatusDaTarefa.Pendente ? linha.status : null;
  const quantidade = inteiro(linha.quantidade);
  if (!dataDia || !tipo || !status || quantidade === null || quantidade < 0) return null;
  return { data_dia: dataDia, tipo, status, quantidade };
}
