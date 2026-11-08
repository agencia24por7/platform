BEGIN;

CREATE TABLE core.handoff_consumed (
  jti         uuid PRIMARY KEY,
  consumed_at timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);

COMMENT ON TABLE core.handoff_consumed IS
  'Passagens já trocadas por cookie. Existir aqui significa gasta: a mesma passagem nunca vale duas vezes.';

CREATE INDEX handoff_consumed_expiry ON core.handoff_consumed (expires_at);

GRANT SELECT, INSERT, DELETE ON core.handoff_consumed TO tria_app;

ALTER TABLE core.handoff_consumed ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.handoff_consumed FORCE ROW LEVEL SECURITY;

CREATE POLICY handoff_consumed_app ON core.handoff_consumed FOR ALL TO tria_app
  USING (true)
  WITH CHECK (true);

COMMIT;
