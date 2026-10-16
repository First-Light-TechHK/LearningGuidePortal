import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

test("contact migration and runtime bootstrap share the same additive DDL and freshness probe",async()=>{
  const migration=await readFile("db/migrations/014_contact_requests.sql","utf8"),bootstrap=await readFile("services/persistence/db.ts","utf8");
  const normalise=(s:string)=>s.replace(/--[^\n]*/g,"").replace(/\s+/g," ").trim();
  const table=/CREATE TABLE IF NOT EXISTS contact_requests \([\s\S]*?\);/;
  assert.equal(normalise(bootstrap.match(table)![0]),normalise(migration.match(table)![0]));
  assert.match(migration,/client_event_id UUID NOT NULL UNIQUE/);
  assert.match(bootstrap,/to_regclass\('contact_requests'\) IS NOT NULL/);
  assert.ok(bootstrap.includes(migration.match(/CREATE INDEX IF NOT EXISTS[^;]+;/)![0]));
});
