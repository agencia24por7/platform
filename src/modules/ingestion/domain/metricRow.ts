export type MetricRow = {
  readonly externalCampaignId: string;
  readonly campaignName: string | null;
  readonly metricDate: string;
  readonly spend: number;
  readonly impressions: number;
  readonly clicks: number;
  readonly conversions: number;
  readonly revenue: number;
  readonly currency: string;
};

export type IngestOutcome = {
  readonly received: number;
  readonly written: number;
  readonly restated: number;
};

export function isCoherent(row: MetricRow): boolean {
  if (row.clicks > row.impressions) return false;
  if (row.spend > 0 && row.impressions === 0) return false;
  return true;
}
