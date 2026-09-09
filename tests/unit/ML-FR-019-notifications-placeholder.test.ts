import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PREVIEW_LP, openLearningPoint, purchaseCourse, verifiedUser } from "./helpers/my-learning";

// Break: ML-FR-019 is a placeholder. Cancel/purchase may still write store
// notifications for other modules, but My Learning must not expose an inbox,
// unread count, or read/unread API surface.

const originalCwd = process.cwd();
const originalStorageBackend = process.env.STORAGE_BACKEND;
let isolatedCwd: string;
let store: typeof import("../../services/productStore");

before(async () => {
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-ml-fr-019-"));
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

test("ML-FR-019: Overview does not expose purchase/cancel notifications as an inbox", async () => {
  const user = await verifiedUser(store, "ml-fr-019-hidden@example.test");
  await purchaseCourse(store, user.id);
  const before = await store.getLearningOverview(user.id);
  const subscription = before.subscriptions.find((item) => item.source === "purchase");
  assert.ok(subscription);
  await store.cancelSubscription(user.id, subscription.id, { code: "content" });

  const overview = await store.getLearningOverview(user.id);
  assert.equal(overview.notificationsPlaceholder, true);
  assert.deepEqual(overview.notifications, []);
  assert.equal(overview.unreadCount, 0);
});

test("ML-FR-019: placeholder stays empty after a student opens a Learning Point", async () => {
  const user = await verifiedUser(store, "ml-fr-019-study@example.test");
  await purchaseCourse(store, user.id);
  await openLearningPoint(store, user.id, PREVIEW_LP, "notify-open");

  const overview = await store.getLearningOverview(user.id);
  assert.equal(overview.notificationsPlaceholder, true);
  assert.equal(overview.notifications.length, 0);
  assert.equal(overview.unreadCount, 0);
});
