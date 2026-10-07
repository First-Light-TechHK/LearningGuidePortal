CREATE TABLE IF NOT EXISTS wechat_login_tickets (
  ticket_hash CHAR(64) PRIMARY KEY,
  target_env TEXT NOT NULL CHECK (target_env IN ('DEV', 'SIT', 'UAT')),
  nonce TEXT NOT NULL,
  profile JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS wechat_login_tickets_expires_at_idx ON wechat_login_tickets (expires_at);
