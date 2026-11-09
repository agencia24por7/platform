import { withTenant } from '@/shared/db/tenant';
import type { IngestOutcome, MetricRow } from '@/modules/ingestion/domain/metricRow';

const TRACKED_FIELDS = ['spend', 'impressions', 'clicks', 'conversions', 'revenue'] as const;

type ExistingRow = {
  external_campaign_id: string;
  metric_date: Date;
  spend: string;
  impressions: string;
  clicks: string;
  conversions: string;
  revenue: string;
};

export type MetricsRepository = {
  upsert(
    organizationId: string,
    adAccountId: string,
    runId: string,
    apiVersion: string | null,
    rows: readonly MetricRow[],
  ): Promise<IngestOutcome>;
};

export function createMetricsRepository(): MetricsRepository {
  return {
    async upsert(organizationId, adAccountId, runId, apiVersion, rows) {
      if (rows.length === 0) return { received: 0, written: 0, restated: 0 };

      return withTenant(organizationId, async (tx) => {
        const dates = Array.from(new Set(rows.map((row) => row.metricDate)));
        const campaigns = Array.from(new Set(rows.map((row) => row.externalCampaignId)));

        const existing = (await tx`
          SELECT external_campaign_id, metric_date, spend, impressions, clicks, conversions, revenue
          FROM metrics.metrics_daily
          WHERE ad_account_id = ${adAccountId}
            AND metric_date = ANY(${dates}::date[])
            AND external_campaign_id = ANY(${campaigns}::text[])`) as unknown as ExistingRow[];

        const previous = new Map(
          existing.map((row) => [
            `${row.external_campaign_id}|${row.metric_date.toISOString().slice(0, 10)}`,
            row,
          ]),
        );

        const payload = rows.map((row) => ({
          ad_account_id: adAccountId,
          external_campaign_id: row.externalCampaignId,
          metric_date: row.metricDate,
          campaign_name: row.campaignName,
          spend: row.spend,
          impressions: row.impressions,
          clicks: row.clicks,
          conversions: row.conversions,
          revenue: row.revenue,
          currency: row.currency,
          source_api_version: apiVersion,
          last_sync_run_id: runId,
        }));

        await tx`
          INSERT INTO metrics.metrics_daily ${tx(payload)}
          ON CONFLICT (ad_account_id, external_campaign_id, metric_date) DO UPDATE SET
            campaign_name = EXCLUDED.campaign_name,
            spend = EXCLUDED.spend,
            impressions = EXCLUDED.impressions,
            clicks = EXCLUDED.clicks,
            conversions = EXCLUDED.conversions,
            revenue = EXCLUDED.revenue,
            currency = EXCLUDED.currency,
            source_api_version = EXCLUDED.source_api_version,
            last_ingested_at = now(),
            last_sync_run_id = EXCLUDED.last_sync_run_id`;

        const changes = rows.flatMap((row) => {
          const before = previous.get(`${row.externalCampaignId}|${row.metricDate}`);
          if (!before) return [];

          return TRACKED_FIELDS.flatMap((field) => {
            const previousValue = Number(before[field]);
            const newValue = Number(row[field]);
            if (previousValue === newValue) return [];

            return [
              {
                ad_account_id: adAccountId,
                external_campaign_id: row.externalCampaignId,
                metric_date: row.metricDate,
                field,
                previous_value: previousValue,
                new_value: newValue,
                sync_run_id: runId,
              },
            ];
          });
        });

        if (changes.length > 0) {
          await tx`INSERT INTO metrics.metrics_restatements ${tx(changes)}`;
        }

        const restated = changes.length;

        return { received: rows.length, written: rows.length, restated };
      });
    },
  };
}
