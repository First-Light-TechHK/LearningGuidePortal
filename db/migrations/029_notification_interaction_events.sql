-- Independent append-only learner interaction events, isolated from product snapshot writes.
CREATE TABLE IF NOT EXISTS notification_interaction_events (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL,
 event TEXT NOT NULL,
 notification_id TEXT,
 template_id TEXT,
 broadcast_id TEXT,
 category TEXT,
 language TEXT,
 channel TEXT NOT NULL DEFAULT 'in_app',
 is_test BOOLEAN NOT NULL DEFAULT false,
 filter TEXT,
 occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE notification_interaction_events ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS orm_sessions_token_hash_idx ON orm_rows ((payload->>'tokenHash')) WHERE table_name = 'sessions';
CREATE INDEX IF NOT EXISTS notification_interaction_user_time_idx ON notification_interaction_events (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS notification_interaction_time_idx ON notification_interaction_events (occurred_at);
