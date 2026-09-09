-- Apply before enabling Stripe on a PostgreSQL-backed deployment.
-- The aggregate remains in app_files; unique provider identities commit with it.
CREATE TABLE IF NOT EXISTS product_payment_keys (
  kind TEXT NOT NULL CHECK (kind IN ('event', 'quote', 'checkout', 'invoice')),
  external_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  PRIMARY KEY (kind, external_id)
);
