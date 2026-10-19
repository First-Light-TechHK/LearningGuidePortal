import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("assessment migration matches bootstrap, preserves isolation and declares optimistic/idempotent keys", async () => {
  const migration = await readFile("db/migrations/015_lesson_assessments.sql", "utf8"), bootstrap = await readFile("services/persistence/db.ts", "utf8");
  const table = /CREATE TABLE IF NOT EXISTS lesson_assessments \([\s\S]*?\);/;
  const normalise = (value: string) => value.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();
  assert.equal(normalise(migration.match(table)![0]), normalise(bootstrap.match(table)![0]));
  assert.match(migration, /PRIMARY KEY \(user_id, course_id, lesson_id, kind\)/);
  assert.match(migration, /last_event_id UUID NOT NULL UNIQUE/);
  assert.match(migration, /version INTEGER NOT NULL CHECK \(version > 0\)/);
  assert.match(bootstrap, /to_regclass\('lesson_assessments'\) IS NOT NULL/);
});
