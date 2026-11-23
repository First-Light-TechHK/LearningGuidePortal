import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Notification P0 internal operations route (design §7): the manual/replay
 * entry point for the schedulers, behind the same service token as the Admin
 * integration API.
 */

const originalCwd = process.cwd();
const originalStorageBackend = process.env.STORAGE_BACKEND;
const originalToken = process.env.NOTIFICATIONS_SERVICE_TOKEN;
const origin = "http://localhost:3014";
const TOKEN = "test-notifications-service-token";
let isolatedCwd: string;
let route: typeof import("../../app/api/internal/notifications/run/route");

before(async () => {
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-notification-internal-"));
  process.chdir(isolatedCwd);
  process.env.STORAGE_BACKEND = "local";
  process.env.NOTIFICATIONS_SERVICE_TOKEN = TOKEN;
  delete process.env.NEXT_PUBLIC_APP_URL;
  delete process.env.SMTP_HOST;
  const store = await import("../../services/productStore");
  await store.ensureProductData();
  route = await import("../../app/api/internal/notifications/run/route");
});

after(async () => {
  process.chdir(originalCwd);
  if (originalStorageBackend === undefined) delete process.env.STORAGE_BACKEND;
  else process.env.STORAGE_BACKEND = originalStorageBackend;
  if (originalToken === undefined) delete process.env.NOTIFICATIONS_SERVICE_TOKEN;
  else process.env.NOTIFICATIONS_SERVICE_TOKEN = originalToken;
  if (isolatedCwd && path.dirname(isolatedCwd) === tmpdir()) await rm(isolatedCwd, { recursive: true, force: true });
});

function post(body?: unknown, token?: string) {
  return route.POST(new Request(`${origin}/api/internal/notifications/run`, {
    method: "POST",
    headers: { ...(token ? { "x-notifications-token": token } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
}

test("internal notification jobs require the service token", async () => {
  assert.equal((await post({ job: "retention" })).status, 401);
  assert.equal((await post({ job: "retention" }, "wrong")).status, 401);
});

test("internal job route validates the job, the instant and the force flag", async () => {
  assert.equal((await post({ job: "nope" }, TOKEN)).status, 400);
  assert.equal((await post({ job: "retention", now: "not-a-date" }, TOKEN)).status, 400);
  assert.equal((await post({ job: "retention", force: "yes" }, TOKEN)).status, 400);
});

test("internal job route runs a named job and reports its summary", async () => {
  const beforeWindow = await post({ job: "renewal-reminder", now: "2026-12-11T01:00:00.000Z" }, TOKEN);
  assert.equal(beforeWindow.status, 200);
  const body = await beforeWindow.json() as { ok: boolean; job: string; result: { ran: boolean; reason?: string } };
  assert.equal(body.ok, true);
  assert.equal(body.job, "renewal-reminder");
  assert.equal(body.result.ran, false);
  assert.equal(body.result.reason, "before_window");

  const retention = await post({ job: "retention", force: true, now: "2026-12-11T02:00:00.000Z" }, TOKEN);
  assert.equal(retention.status, 200);
  assert.equal((await retention.json() as { result: { ran: boolean } }).result.ran, true);
});
