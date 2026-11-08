BEGIN;

ALTER TABLE metrics.metrics_daily        ENABLE ROW LEVEL SECURITY;
ALTER TABLE metrics.metrics_restatements ENABLE ROW LEVEL SECURITY;

CREATE POLICY metrics_daily_tenant ON metrics.metrics_daily FOR ALL TO tria_app
  USING (EXISTS (
    SELECT 1 FROM integrations.ad_accounts a
    WHERE a.id = ad_account_id AND a.organization_id = core.current_organization()))
  WITH CHECK (EXISTS (
    SELECT 1 FROM integrations.ad_accounts a
    WHERE a.id = ad_account_id AND a.organization_id = core.current_organization()));

CREATE POLICY metrics_restatements_tenant ON metrics.metrics_restatements FOR ALL TO tria_app
  USING (EXISTS (
    SELECT 1 FROM integrations.ad_accounts a
    WHERE a.id = ad_account_id AND a.organization_id = core.current_organization()))
  WITH CHECK (EXISTS (
    SELECT 1 FROM integrations.ad_accounts a
    WHERE a.id = ad_account_id AND a.organization_id = core.current_organization()));

COMMIT;
