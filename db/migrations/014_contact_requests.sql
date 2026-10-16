-- Additive and repeatable. Roll back application code first; retain this table
-- for support history. Drop only after an approved export/retention decision.
CREATE TABLE IF NOT EXISTS contact_requests (
  id UUID PRIMARY KEY,
  client_event_id UUID NOT NULL UNIQUE,
  payload_hash CHAR(64) NOT NULL,
  user_id TEXT,
  first_name TEXT NOT NULL CHECK (char_length(first_name) BETWEEN 1 AND 50),
  last_name TEXT NOT NULL CHECK (char_length(last_name) BETWEEN 1 AND 50),
  email TEXT NOT NULL CHECK (char_length(email) BETWEEN 1 AND 254),
  phone TEXT NOT NULL DEFAULT '' CHECK (char_length(phone) <= 40),
  subject TEXT NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 200),
  message TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 5000),
  consent BOOLEAN NOT NULL CHECK (consent = TRUE),
  locale TEXT NOT NULL CHECK (locale IN ('en-GB', 'zh-CN')),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS contact_requests_status_created_idx ON contact_requests (status, created_at DESC);
