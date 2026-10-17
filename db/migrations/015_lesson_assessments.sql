-- User-owned assessment participation, independent of Study/Entitlement.
CREATE TABLE IF NOT EXISTS lesson_assessments (
  user_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('knowledge', 'application')),
  version INTEGER NOT NULL CHECK (version > 0),
  last_event_id UUID NOT NULL UNIQUE,
  payload_hash CHAR(64) NOT NULL,
  record JSONB NOT NULL,
  PRIMARY KEY (user_id, course_id, lesson_id, kind)
);
