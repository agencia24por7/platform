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
