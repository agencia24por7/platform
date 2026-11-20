import { z } from 'zod';

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use o formato AAAA-MM-DD');

export const uuid = z.string().uuid('identificador inválido');

export const platform = z.enum(['meta', 'google']);

export const syncWindow = z.object({ start: isoDate, end: isoDate });

export const queueQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  rewindowDays: z.coerce.number().int().min(1).max(90).default(28),
});

export const openRunBody = z.object({
  adAccountId: uuid,
  workflow: z.string().min(2).max(120),
  triggerSource: z.string().min(2).max(40),
  idempotencyKey: z.string().min(8).max(160),
  window: syncWindow,
  apiVersion: z.string().max(24).nullable().default(null),
  n8nExecutionId: z.string().max(64).nullable().default(null),
});

export const metricRowBody = z.object({
  externalCampaignId: z.string().min(1).max(64),
  campaignName: z.string().max(200).nullable().default(null),
  metricDate: isoDate,
  spend: z.coerce.number().min(0).max(100_000_000),
  impressions: z.coerce.number().int().min(0),
  clicks: z.coerce.number().int().min(0),
  conversions: z.coerce.number().min(0),
  revenue: z.coerce.number().min(0).max(100_000_000),
  currency: z.string().length(3).default('BRL'),
});

export const ingestBody = z.object({
  runId: uuid,
  rows: z.array(metricRowBody).max(5000),
});

export const closeRunBody = z.object({
  runId: uuid,
  status: z.enum(['success', 'partial', 'failed']),
  requestCount: z.coerce.number().int().min(0).max(100_000).default(0),
  apiVersion: z.string().max(24).nullable().default(null),
  errorCode: z.string().max(80).nullable().default(null),
  errorMessage: z.string().max(1000).nullable().default(null),
});

export const fontesColetaQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  modo: z.enum(['amostra', 'incremental', 'completa']).default('incremental'),
});

export const janela = z.object({ start: isoDate, end: isoDate });

export const abrirColetaBody = z.object({
  fonteTipo: z.enum(['ad_account', 'connection_account']),
  fonteId: uuid,
  mode: z.enum(['amostra', 'incremental', 'completa']),
  window: janela,
  idempotencyKey: z.string().min(8).max(160),
  n8nExecutionId: z.string().max(64).nullable().default(null),
});

export const faltanteBody = z.object({
  fonte: z.string().min(1).max(120),
  causa: z.enum(['sem_credencial', 'reauth_pending', 'api_recusou', 'sem_dados_no_periodo', 'coleta_incompleta', 'fora_do_v1', 'falha_coletor', 'limite_de_uso', 'sem_acesso']),
  detalhe: z.string().max(500).nullable().default(null),
});

export const achadoDeParidadeBody = z.object({
  fonte: z.string().min(1).max(120),
  tipo: z.enum(['rotulo_divergente', 'campo_ausente', 'dimensao_nova', 'escopo_ausente', 'escopo_excedente']),
  esperado: z.string().min(1).max(500),
  observado: z.string().max(500).nullable().default(null),
});

export const avisoDeQualidadeBody = z.object({
  fonte: z.string().min(1).max(120),
  tipo: z.enum(['versao_da_api', 'uso_de_cota', 'limiar_de_privacidade', 'linhas_agrupadas', 'alcance_omitido', 'receita_indisponivel', 'parcial_aceita', 'nivel_de_acesso']),
  detalhe: z.string().max(500).nullable().default(null),
});

export const qualidadeResumoBody = z.object({
  fontesEsperadas: z.coerce.number().int().min(0),
  fontesColetadas: z.coerce.number().int().min(0),
  faltantes: z.array(faltanteBody).max(500),
  paridade: z.array(achadoDeParidadeBody).max(500),
  avisos: z.array(avisoDeQualidadeBody).max(50).default([]),
  volumetria: z.object({
    linhas: z.coerce.number().int().min(0),
    bytes: z.coerce.number().int().min(0),
    requests: z.coerce.number().int().min(0),
    duracaoMs: z.coerce.number().int().min(0),
  }),
});

export const alertaDeFalhaBody = z.object({
  workflowId: z.string().max(64).nullable().default(null),
  workflowNome: z.string().min(1).max(500),
  no: z.string().max(500).nullable().default(null),
  mensagem: z.string().max(5000).default(''),
});

export const GRAVAR_COLETA_MAX_LINHAS = 10_000;
export const GRAVAR_COLETA_MAX_BYTES = 12_000_000;

export const gravarColetaBody = z.object({
  coletaId: uuid,
  linhas: z.array(z.record(z.string(), z.unknown())).max(GRAVAR_COLETA_MAX_LINHAS),
});

export const fecharColetaBody = z.object({
  coletaId: uuid,
  status: z.enum(['success', 'partial', 'failed']),
  requestCount: z.coerce.number().int().min(0).max(100_000).default(0),
  rowsReceived: z.coerce.number().int().min(0).default(0),
  rowsWritten: z.coerce.number().int().min(0).default(0),
  qualidadeResumo: qualidadeResumoBody.nullable().default(null),
  errorCode: z.string().max(80).nullable().default(null),
  errorMessage: z.string().max(1000).nullable().default(null),
  pausa: z.object({
    motivo: z.enum(['cota_diaria', 'limite_temporario']),
    minutos: z.coerce.number().int().min(0).max(1440).nullable().default(null),
  }).nullable().default(null),
});

export const publicarBrainsPendentesBody = z
  .object({ limite: z.number().int().min(1).max(200).default(20) })
  .strict();

export const reconstruirBrainBody = z
  .object({
    organizationId: uuid.optional(),
    clientId: uuid.optional(),
    todos: z.literal(true).optional(),
  })
  .strict()
  .refine((corpo) => (corpo.todos ? !corpo.organizationId && !corpo.clientId : Boolean(corpo.organizationId)), {
    message: 'informe organizationId (e opcionalmente clientId) ou todos: true',
  });

export const tokenDeAcessoBody = z.union([
  z.object({ coletaId: uuid }).strict(),
  z.object({ tarefaId: uuid }).strict(),
]);

export const renovacaoProativaBody = z.object({
  limite: z.coerce.number().int().min(1).max(200).default(50),
}).strict();
