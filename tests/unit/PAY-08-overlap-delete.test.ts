import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Break: grant of overlapping access filter()-deletes the previous active
// entitlement row instead of marking it expired (PAY-08 / E2E-B1-006).

const COURSE_PLAN = "epicureanism-pc-6";
const CATEGORY_PLAN = "european-humanities-pc-6";

const originalCwd = process.cwd();
const originalStorageBackend = process.env.STORAGE_BACKEND;
let isolatedCwd: string;
let store: typeof import("../../services/productStore");

before(async () => {
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-pay-08-"));
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

test("PAY-08: overlapping purchase keeps the previous entitlement row as expired", async () => {
  const user = await store.registerUser({
    email: "pay-08-overlap@example.test",
    password: "password1",
    nickname: "Pay Eight",
  });
  await store.verifyEmailToken(await store.issueEmailVerificationToken(user.id));

  const courseQuote = await store.createQuote(user.id, COURSE_PLAN);
  const coursePending = await store.createPendingDemoOrder(user.id, courseQuote.quote.id);
  await store.completeDemoOrder(user.id, coursePending.order.id);

  const before = await store.ensureProductData();
  const previous = before.entitlements.filter((item) => item.userId === user.id);
  assert.equal(previous.length, 1);
  const previousId = previous[0].id;
  assert.equal(previous[0].state, "active");

  const categoryQuote = await store.createQuote(user.id, CATEGORY_PLAN);
  const categoryPending = await store.createPendingDemoOrder(user.id, categoryQuote.quote.id);
  await store.completeDemoOrder(user.id, categoryPending.order.id);

  const after = await store.ensureProductData();
  const rows = after.entitlements.filter((item) => item.userId === user.id);
  const kept = rows.find((item) => item.id === previousId);
  assert.ok(kept, "previous entitlement row must remain for audit");
  assert.equal(kept.state, "expired");
  assert.equal(rows.filter((item) => item.state === "active").length, 1);
});
