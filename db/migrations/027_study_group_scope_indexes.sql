-- Study Group scoped reads (backend review 2026-11-03, H2): the service no
-- longer loads the whole Study Group store for a request about one session,
-- one group or one user's seats (repositories/studyGroupRepository.ts
-- scopeClauses). Every per-session table is already indexed by session_id
-- (unique keys, the claim index, the seated index) except the outbox, and the
-- "seats of a user" scope needs the user's open presences. Additive and
-- repeatable; mirrored in services/persistence/db.ts (bootstrap and probe);
-- pinned by tests/unit/study-group-migration-parity.test.ts. 012-026 are not
-- edited. Rollback: drop the two indexes; the queries still run.
CREATE INDEX IF NOT EXISTS study_group_outbox_session_idx
  ON study_group_outbox (session_id);
CREATE INDEX IF NOT EXISTS study_group_presences_open_user_idx
  ON study_group_presences (user_id) WHERE left_at IS NULL;
