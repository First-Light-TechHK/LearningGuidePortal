import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { purchaseCourse, verifiedUser } from "./helpers/my-learning";

// N4: a notification hook that throws must never undo or fail a payment step.

const originalCwd = process.cwd();
const originalStorageBackend = process.env.STORAGE_BACKEND;
let isolatedCwd: string;
let store: typeof import("../../services/productStore");

before(async () => {
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-notification-payment-isolation-"));
  process.chdir(isolatedCwd);
  process.env.STORAGE_BACKEND = "local";
  store = await import("../../services/productStore");
});

after(async () => {
  process.chdir(originalCwd);
  if (originalStorageBackend === undefined) delete process.env.STORAGE_BACKEND;
  else process.env.STORAGE_BACKEND = originalStorageBackend;
  if (isolatedCwd && path.dirname(isolatedCwd) === tmpdir()) await rm(isolatedCwd, { recursive: true, force: true });
});

test("a notification that cannot render does not stop a purchase from being fulfilled", async () => {
  const user = await verifiedUser(store, "payment-isolation@example.test");
  await store.editProductData((data) => {
    // A broken stored template: rendering its link throws a TypeError.
    const template = data.notificationTemplates!.find((item) => item.id === "SUB_SUCCESS")!;
    (template as { buttonLink: unknown }).buttonLink = null;
  });
  const errors: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { errors.push(args.map(String).join(" ")); };
  try {
    await purchaseCourse(store, user.id);
  } finally {
    console.error = original;
  }
  const data = await store.ensureProductData();
  assert.ok(data.orders.some((order) => order.userId === user.id && order.status === "paid"), "the order is paid");
  assert.ok(data.subscriptions.some((item) => item.userId === user.id && item.source === "purchase"), "the subscription exists");
  assert.ok(data.entitlements.some((item) => item.userId === user.id && item.state === "active"), "the entitlement exists");
  assert.equal(data.notifications.filter((item) => item.userId === user.id && item.templateId === "SUB_SUCCESS").length, 0, "no subscription notification row was written");
  assert.equal(errors.length, 1);
  assert.match(errors[0], /notifications\.hook_failed/);
  assert.equal(JSON.parse(errors[0]).error, "TypeError", "the log line names the error type (P-04)");
  assert.ok(!errors[0].includes(user.id) && !errors[0].includes("@"), "the log line carries no user data");
});
