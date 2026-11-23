import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { verifiedUser, purchaseCourse } from "./helpers/my-learning";

// PRD Notification §9 replaces ML-FR-019's placeholder: My Learning now exposes
// the Notification Center inbox and read/unread state.

const originalCwd = process.cwd();
const originalStorageBackend = process.env.STORAGE_BACKEND;
let isolatedCwd: string;
let store: typeof import("../../services/productStore");
let notifications: typeof import("../../services/notifications/service");

before(async () => {
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-ml-fr-019-"));
  process.chdir(isolatedCwd);
  process.env.STORAGE_BACKEND = "local";
  store = await import("../../services/productStore");
  notifications = await import("../../services/notifications/service");
});

after(async () => {
  process.chdir(originalCwd);
  if (originalStorageBackend === undefined) delete process.env.STORAGE_BACKEND;
  else process.env.STORAGE_BACKEND = originalStorageBackend;
  if (isolatedCwd && path.dirname(isolatedCwd) === tmpdir()) await rm(isolatedCwd, { recursive: true, force: true });
});

test("ML-FR-019 replacement: a purchase creates a subscription notification in the learner inbox", async () => {
  const user = await verifiedUser(store, "ml-fr-019-inbox@example.test");
  await store.editProductData((data) => { data.notifications = data.notifications.filter((item) => item.userId !== user.id); });
  await purchaseCourse(store, user.id);

  const inbox = await notifications.listLearnerNotifications(user.id, { filter: "all" });
  const subscription = inbox.items.find((item) => item.templateId === "SUB_SUCCESS");
  assert.ok(subscription);
  assert.equal(subscription.category, "subscription");
  assert.equal(inbox.unreadCount, 1);

  await notifications.setNotificationRead(user.id, subscription.id, true);
  const unread = await notifications.listLearnerNotifications(user.id, { filter: "unread" });
  assert.equal(unread.unreadCount, 0);
  assert.equal(unread.items.length, 0);
});
