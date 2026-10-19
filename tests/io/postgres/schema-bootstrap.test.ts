// Schema-bootstrap concurrency proof (audit F-5 fix review): every worker
// process that touches the database runs ensureSchema once per process, so a
// cold start of several instances — or the io:pg worker races — used to run
// several DDL batches concurrently. Since the F-5 ALTER widened the batch's
// locks, those batches could deadlock with each other and with live business
// transactions. Two workers now bootstrap from an empty start behind the
// bootstrap advisory lock (the loser skips through the in-lock probe) and the
// schema comes out complete, built once, without any deadlock.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { getPool } from "../../../services/persistence/db";
import { STUDY_GROUP_TABLES, closePool, requireDatabaseUrl, rows, runWorkers, workerResult } from "./harness";

before(async () => {
  requireDatabaseUrl();
});

after(async () => {
  await closePool();
});

test("two workers bootstrapping an empty schema concurrently complete without deadlock and build it once", async () => {
  // Empty start: drop every Study Group table so both workers must run the
  // real bootstrap path — the freshness probe cannot fast-skip.
  await getPool().query(`DROP TABLE IF EXISTS ${STUDY_GROUP_TABLES.join(", ")} CASCADE`);

  const outcomes = await runWorkers([{ mode: "ensure-schema" }, { mode: "ensure-schema" }], { timeoutMs: 60_000 });
  for (const outcome of outcomes) {
    assert.equal(outcome.exitCode, 0, `worker ${outcome.role} must not fail (deadlock/timeout): ${outcome.stderr}`);
    const result = workerResult<{ ready: boolean; studyGroupTables: number; presenceColumn: boolean }>(outcome);
    assert.equal(result.ready, true, `worker ${outcome.role} reports the schema ready`);
    assert.equal(result.studyGroupTables, STUDY_GROUP_TABLES.length);
    assert.equal(result.presenceColumn, true);
  }

  // The resulting schema is complete: every table plus the newest column.
  const tables = await rows<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = ANY (current_schemas(false)) AND table_name = ANY($1)",
    [STUDY_GROUP_TABLES]
  );
  assert.equal(tables.length, STUDY_GROUP_TABLES.length);
  const columns = await rows<{ column_name: string }>(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = ANY (current_schemas(false)) AND table_name = 'study_group_presences' AND column_name = ANY($1) ORDER BY column_name",
    [["last_seen_at", "livekit_participant_sid"]]
  );
  assert.deepEqual(columns.map((row) => row.column_name), ["last_seen_at", "livekit_participant_sid"]);
});
