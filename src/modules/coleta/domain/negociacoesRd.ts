export const Situacao = {
  Aberta: 'aberta',
  Ganha: 'ganha',
  Perdida: 'perdida',
  Pausada: 'pausada',
} as const;
export type Situacao = (typeof Situacao)[keyof typeof Situacao];

export const CAMPOS_DA_NEGOCIACAO = [
  'dealId',
  'pipelineId',
  'pipelineName',
  'stageId',
  'stageName',
  'stageOrder',
  'win',
  'hold',
  'amountTotal',
  'amountMonthly',
  'amountUnique',
  'createdAt',
  'updatedAt',
  'closedAt',
  'dealSourceName',
  'campaignName',
] as const;

export type NegociacaoRd = {
  readonly dealId: string;
  readonly pipelineId: string | null;
  readonly pipelineName: string | null;
  readonly stageId: string | null;
  readonly stageName: string | null;
  readonly stageOrder: number | null;
  readonly situacao: Situacao;
  readonly amountTotal: number | null;
  readonly amountMonthly: number | null;
  readonly amountUnique: number | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
  readonly closedAt: string | null;
  readonly dealSourceName: string | null;
  readonly campaignName: string | null;
};

export const FUSO_DO_SNAPSHOT = 'America/Sao_Paulo';

const TAMANHO_MAXIMO_DE_ROTULO = 200;

function texto(valor: unknown): string | null {
  if (typeof valor !== 'string' && typeof valor !== 'number') return null;
  const limpo = String(valor).trim();
  return limpo ? limpo.slice(0, TAMANHO_MAXIMO_DE_ROTULO) : null;
}

function identificador(valor: unknown): string | null {
  const id = texto(valor);
  return id && /^[A-Za-z0-9_-]+$/.test(id) ? id : null;
}

function numero(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === '') return null;
  const convertido = Number(valor);
  return Number.isFinite(convertido) ? convertido : null;
}

function inteiro(valor: unknown): number | null {
  const convertido = numero(valor);
  return convertido === null ? null : Math.trunc(convertido);
}

function instante(valor: unknown): string | null {
  if (typeof valor !== 'string' || !valor) return null;
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? null : data.toISOString();
}

function booleanoOuNulo(valor: unknown): boolean | null {
  return typeof valor === 'boolean' ? valor : null;
}

export function situacaoDa(win: boolean | null, hold: boolean | null): Situacao {
  if (win === true) return Situacao.Ganha;
  if (win === false) return Situacao.Perdida;
  if (hold === true) return Situacao.Pausada;
  return Situacao.Aberta;
}

export function negociacaoDaLinha(bruta: Readonly<Record<string, unknown>>): NegociacaoRd | null {
  const dealId = identificador(bruta.dealId);
  if (!dealId) return null;

  return {
    dealId,
    pipelineId: identificador(bruta.pipelineId),
    pipelineName: texto(bruta.pipelineName),
    stageId: identificador(bruta.stageId),
    stageName: texto(bruta.stageName),
    stageOrder: inteiro(bruta.stageOrder),
    situacao: situacaoDa(booleanoOuNulo(bruta.win), booleanoOuNulo(bruta.hold)),
    amountTotal: numero(bruta.amountTotal),
    amountMonthly: numero(bruta.amountMonthly),
    amountUnique: numero(bruta.amountUnique),
    createdAt: instante(bruta.createdAt),
    updatedAt: instante(bruta.updatedAt),
    closedAt: instante(bruta.closedAt),
    dealSourceName: texto(bruta.dealSourceName),
    campaignName: texto(bruta.campaignName),
  };
}

const maisRecente = (a: NegociacaoRd, b: NegociacaoRd): NegociacaoRd => ((b.updatedAt ?? '') > (a.updatedAt ?? '') ? b : a);

export function negociacoesUnicas(linhas: readonly Readonly<Record<string, unknown>>[]): readonly NegociacaoRd[] {
  const porId = new Map<string, NegociacaoRd>();
  for (const linha of linhas) {
    const negociacao = negociacaoDaLinha(linha);
    if (!negociacao) continue;
    const anterior = porId.get(negociacao.dealId);
    porId.set(negociacao.dealId, anterior ? maisRecente(anterior, negociacao) : negociacao);
  }
  return [...porId.values()];
}

export function dataDoSnapshot(agora: Date, fuso: string = FUSO_DO_SNAPSHOT): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);
}

export type ContextoDoFatoRd = {
  readonly organizationId: string;
  readonly clientId: string;
  readonly dataSnapshot: string;
  readonly moeda: string;
  readonly execucaoId: string;
  readonly inseridoEm: string;
};

export const COLUNAS_DO_FATO_RD = [
  'organization_id', 'client_id', 'deal_id', 'data_snapshot', 'pipeline_id', 'pipeline_nome', 'etapa_id',
  'etapa_nome', 'etapa_ordem', 'situacao', 'valor_total', 'valor_mensal', 'valor_unico', 'moeda', 'criada_em',
  'atualizada_em', 'fechada_em', 'fonte_nome', 'campanha_nome', 'execucao_id', 'inserido_em',
] as const;

export function linhaDoFatoRd(negociacao: NegociacaoRd, ctx: ContextoDoFatoRd): Record<(typeof COLUNAS_DO_FATO_RD)[number], unknown> {
  return {
    organization_id: ctx.organizationId,
    client_id: ctx.clientId,
    deal_id: negociacao.dealId,
    data_snapshot: ctx.dataSnapshot,
    pipeline_id: negociacao.pipelineId,
    pipeline_nome: negociacao.pipelineName,
    etapa_id: negociacao.stageId,
    etapa_nome: negociacao.stageName,
    etapa_ordem: negociacao.stageOrder,
    situacao: negociacao.situacao,
    valor_total: negociacao.amountTotal,
    valor_mensal: negociacao.amountMonthly,
    valor_unico: negociacao.amountUnique,
    moeda: ctx.moeda,
    criada_em: negociacao.createdAt,
    atualizada_em: negociacao.updatedAt,
    fechada_em: negociacao.closedAt,
    fonte_nome: negociacao.dealSourceName,
    campanha_nome: negociacao.campaignName,
    execucao_id: ctx.execucaoId,
    inserido_em: ctx.inseridoEm,
  };
}
