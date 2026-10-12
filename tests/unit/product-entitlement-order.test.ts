import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { COURSE_ID, writeProductData } from "./helpers/my-learning";

// Break: D1 — the Study Group "Related Course" dropdown drops courses the portal
// presents as owned. liveEntitlement (services/productStore.ts) takes the FIRST
// covering entitlement row with state "active"; when that row's validTo is past
// (unswept) it flips the row in memory, returns null, and never looks at a later
// covering active row that is still valid — so checkEntitlement refuses access on
// a fresh read even though any sweep-persisting portal visit then grants it.

const DAY = 86_400_000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

const originalCwd = process.cwd();
const originalStorageBackend = process.env.STORAGE_BACKEND;
let isolatedCwd: string;
let store: typeof import("../../services/productStore");

before(async () => {
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-product-entitlement-order-"));
  process.chdir(isolatedCwd);
  process.env.STORAGE_BACKEND = "local";
  store = await import("../../services/productStore");
});

after(async () => {
  process.chdir(originalCwd);
  if (originalStorageBackend === undefined) delete process.env.STORAGE_BACKEND;
  else process.env.STORAGE_BACKEND = originalStorageBackend;
  if (isolatedCwd && path.dirname(isolatedCwd) === tmpdir()) {
    await rm(isolatedCwd, { recursive: true, force: true });
  }
});

test("checkEntitlement grants access when any covering active unexpired entitlement exists, regardless of row order", async () => {
  const now = new Date().toISOString();
  const futureValidTo = iso(170 * DAY);
  const data = await store.ensureProductData();
  data.users.push(
    { id: "u-past-first", email: "u-past-first@example.test", passwordHash: null, nickname: "Past First", locale: "en-GB", role: "student", status: "active", emailVerifiedAt: now, createdAt: now },
    { id: "u-valid-first", email: "u-valid-first@example.test", passwordHash: null, nickname: "Valid First", locale: "en-GB", role: "student", status: "active", emailVerifiedAt: now, createdAt: now },
  );
  // The only difference between the two users is array order of their two
  // covering active rows: [past validTo, future validTo] vs [future, past].
  // Both rows have state "active" (the past one is expired but unswept).
  data.entitlements.push(
    { id: "e-past-first-old", userId: "u-past-first", courseId: COURSE_ID, state: "active", source: "purchase", validTo: iso(-DAY), scope: "course", scopeId: COURSE_ID, device: "pc" },
    { id: "e-past-first-new", userId: "u-past-first", courseId: "*", state: "active", source: "purchase", validTo: futureValidTo, scope: "everything", scopeId: "*", device: "pc" },
    { id: "e-valid-first-new", userId: "u-valid-first", courseId: "*", state: "active", source: "purchase", validTo: futureValidTo, scope: "everything", scopeId: "*", device: "pc" },
    { id: "e-valid-first-old", userId: "u-valid-first", courseId: COURSE_ID, state: "active", source: "purchase", validTo: iso(-DAY), scope: "course", scopeId: COURSE_ID, device: "pc" },
  );
  await writeProductData(data);

  // Control — [valid, past] order: the first covering active row is unexpired.
  const control = await store.checkEntitlement("u-valid-first", COURSE_ID);
  assert.equal(control.allowed, true, "control: an unexpired first covering row already grants access");
  assert.equal(control.validTo, futureValidTo);

  // D1 — [past, valid] order: rows ordered [expired-but-state-active, valid].
  // Desired: the later covering active unexpired row still grants access; the
  // current code stops at the first row, flips it in memory and returns null.
  const check = await store.checkEntitlement("u-past-first", COURSE_ID);
  assert.equal(check.allowed, true, "D1: access must be granted whenever any covering active unexpired entitlement exists, regardless of row order");
  assert.equal(check.validTo, futureValidTo);
});
