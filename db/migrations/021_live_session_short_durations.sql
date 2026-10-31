-- Owner 2026-10-29: a Host schedules a Live Session for 10, 20, 30 or 40
-- minutes (was 30/45/60/90). The stored set keeps 45/60/90 so Sessions
-- scheduled before the change stay valid; the service only offers the new
-- four (modules/group-study/domain.ts SESSION_DURATION_SECONDS).
--
-- The constraint created by 012 is the column CHECK PostgreSQL names
-- live_sessions_duration_seconds_check. It is replaced by a named wider one.
-- Every existing row already satisfies the wider set, so ADD validates
-- without rewriting data. The ensureSchema bootstrap in
-- services/persistence/db.ts applies the same idempotent swap on boot, so
-- this file is for environments that apply migrations manually.
--
-- Rollback: roll the application back first (it would otherwise keep writing
-- 600/1200/2400), then
--   ALTER TABLE live_sessions DROP CONSTRAINT IF EXISTS live_sessions_duration_seconds_v2_check;
--   ALTER TABLE live_sessions ADD CONSTRAINT live_sessions_duration_seconds_check CHECK (duration_seconds IN (1800, 2700, 3600, 5400));
-- (the ADD fails while any 10/20/40-minute Session is stored).
ALTER TABLE live_sessions DROP CONSTRAINT IF EXISTS live_sessions_duration_seconds_check;
ALTER TABLE live_sessions DROP CONSTRAINT IF EXISTS live_sessions_duration_seconds_v2_check;
ALTER TABLE live_sessions ADD CONSTRAINT live_sessions_duration_seconds_v2_check
  CHECK (duration_seconds IN (600, 1200, 1800, 2400, 2700, 3600, 5400));
