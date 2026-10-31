-- Helpdesk Tickets v1 (docs/phase1/helpdesk-tickets.md).
-- Additive and repeatable. Portal is the single writer. Roll back application
-- code first and retain these tables: they are support history. Drop only
-- after an approved export/retention decision.
-- Per-day counter behind ticket numbers LG-YYMMDD-NNNN (UTC day).
CREATE TABLE IF NOT EXISTS helpdesk_ticket_counters (
  day TEXT PRIMARY KEY CHECK (day ~ '^[0-9]{6}$'),
  last INTEGER NOT NULL CHECK (last > 0)
);
CREATE TABLE IF NOT EXISTS helpdesk_tickets (
  id UUID PRIMARY KEY,
  number TEXT NOT NULL UNIQUE CHECK (number ~ '^LG-[0-9]{6}-[0-9]{4,}$'),
  user_id TEXT NOT NULL,
  user_email TEXT NOT NULL DEFAULT '' CHECK (char_length(user_email) <= 254),
  user_name TEXT NOT NULL DEFAULT '' CHECK (char_length(user_name) <= 120),
  contact_email TEXT NOT NULL CHECK (char_length(contact_email) BETWEEN 3 AND 254),
  locale TEXT NOT NULL CHECK (locale IN ('en-GB', 'zh-CN')),
  category TEXT NOT NULL CHECK (category IN ('technical_support', 'course_content', 'payments_subscriptions', 'other')),
  subject TEXT NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 120),
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'ASSIGNED', 'WAITING_USER', 'PENDING_CONFIRM', 'CLOSED', 'CANCELLED')),
  assignee_id TEXT,
  assignee_name TEXT,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  confirm_due_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  close_reason TEXT CHECK (close_reason IN ('cancelled', 'user_confirmed', 'user_closed', 'auto_confirmed')),
  rating SMALLINT CHECK (rating BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  last_message_at TIMESTAMPTZ NOT NULL,
  last_message_by TEXT NOT NULL CHECK (last_message_by IN ('learner', 'agent', 'system')),
  client_event_id UUID NOT NULL UNIQUE,
  payload_hash CHAR(64) NOT NULL,
  suggestion_id UUID,
  unread_by_agent BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS helpdesk_tickets_user_activity_idx ON helpdesk_tickets (user_id, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS helpdesk_tickets_activity_idx ON helpdesk_tickets (updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS helpdesk_tickets_status_activity_idx ON helpdesk_tickets (status, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS helpdesk_tickets_confirm_due_idx ON helpdesk_tickets (confirm_due_at) WHERE status = 'PENDING_CONFIRM';
CREATE TABLE IF NOT EXISTS helpdesk_ticket_messages (
  id UUID PRIMARY KEY,
  ticket_id UUID NOT NULL REFERENCES helpdesk_tickets(id),
  author_kind TEXT NOT NULL CHECK (author_kind IN ('learner', 'agent', 'system')),
  author_id TEXT,
  author_name TEXT,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
  internal BOOLEAN NOT NULL DEFAULT FALSE,
  attachment_ids UUID[] NOT NULL DEFAULT '{}' CHECK (cardinality(attachment_ids) <= 5),
  client_event_id UUID UNIQUE,
  payload_hash CHAR(64),
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS helpdesk_ticket_messages_ticket_idx ON helpdesk_ticket_messages (ticket_id, created_at, id);
CREATE TABLE IF NOT EXISTS helpdesk_attachments (
  id UUID PRIMARY KEY,
  ticket_id UUID NOT NULL REFERENCES helpdesk_tickets(id),
  message_id UUID NOT NULL REFERENCES helpdesk_ticket_messages(id),
  uploader_kind TEXT NOT NULL CHECK (uploader_kind IN ('learner', 'agent')),
  file_name TEXT NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 255),
  content_type TEXT NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf', 'text/plain', 'text/csv', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')),
  size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
  storage_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS helpdesk_attachments_ticket_idx ON helpdesk_attachments (ticket_id);
-- CloudEvents 1.0 field names. One row per accepted command. client_event_id
-- carries the Idempotency-Key of the command that produced the event.
CREATE TABLE IF NOT EXISTS helpdesk_ticket_events (
  id UUID PRIMARY KEY,
  specversion TEXT NOT NULL DEFAULT '1.0' CHECK (specversion = '1.0'),
  source TEXT NOT NULL DEFAULT '/portal/helpdesk',
  type TEXT NOT NULL CHECK (type LIKE 'com.ilovelearningguide.helpdesk.ticket.%'),
  subject UUID NOT NULL REFERENCES helpdesk_tickets(id),
  time TIMESTAMPTZ NOT NULL,
  datacontenttype TEXT NOT NULL DEFAULT 'application/json',
  data JSONB NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  client_event_id UUID UNIQUE,
  payload_hash CHAR(64),
  UNIQUE (subject, sequence)
);
-- Agent-only labels (Figma addendum §D). At most 10 per ticket, enforced by
-- the service under the ticket's optimistic sequence.
CREATE TABLE IF NOT EXISTS helpdesk_ticket_tags (
  ticket_id UUID NOT NULL REFERENCES helpdesk_tickets(id),
  tag TEXT NOT NULL CHECK (char_length(tag) BETWEEN 1 AND 32),
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (ticket_id, tag)
);
CREATE INDEX IF NOT EXISTS helpdesk_ticket_tags_tag_idx ON helpdesk_ticket_tags (tag);
