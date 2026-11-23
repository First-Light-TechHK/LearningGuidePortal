import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { verifiedUser } from "./helpers/my-learning";

/**
 * Notification P0 operator surface (design §3): template list/edit and test
 * sends. Red-first coverage for NTF-BO-013..021 and NTF-LOG-006.
 */

const originalCwd = process.cwd();
const originalStorageBackend = process.env.STORAGE_BACKEND;
const originalToken = process.env.NOTIFICATIONS_SERVICE_TOKEN;
const origin = "http://localhost:3014";
const TOKEN = "test-notifications-service-token";
let isolatedCwd: string;
let store: typeof import("../../services/productStore");
let templatesRoute: typeof import("../../app/api/integration/notifications/templates/route");
let templateRoute: typeof import("../../app/api/integration/notifications/templates/[id]/route");
let testRoute: typeof import("../../app/api/integration/notifications/templates/[id]/test/route");
let service: typeof import("../../services/notifications/service");

before(async () => {
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-notification-ops-templates-"));
  process.chdir(isolatedCwd);
  process.env.STORAGE_BACKEND = "local";
  process.env.NOTIFICATIONS_SERVICE_TOKEN = TOKEN;
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  store = await import("../../services/productStore");
  templatesRoute = await import("../../app/api/integration/notifications/templates/route");
  templateRoute = await import("../../app/api/integration/notifications/templates/[id]/route");
  testRoute = await import("../../app/api/integration/notifications/templates/[id]/test/route");
  service = await import("../../services/notifications/service");
  await store.ensureProductData();
});

after(async () => {
  process.chdir(originalCwd);
  if (originalStorageBackend === undefined) delete process.env.STORAGE_BACKEND;
  else process.env.STORAGE_BACKEND = originalStorageBackend;
  if (originalToken === undefined) delete process.env.NOTIFICATIONS_SERVICE_TOKEN;
  else process.env.NOTIFICATIONS_SERVICE_TOKEN = originalToken;
  if (isolatedCwd && path.dirname(isolatedCwd) === tmpdir()) await rm(isolatedCwd, { recursive: true, force: true });
});

function request(url: string, token?: string, body?: unknown, method = "POST") {
  return new Request(`${origin}${url}`, {
    method,
    headers: { ...(token ? { "x-notifications-token": token } : {}), "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function templateById(id: string) {
  const data = await store.ensureProductData();
  return (data.notificationTemplates || []).find((item) => item.id === id)!;
}

test("template write routes reject a missing or wrong service token", async () => {
  const put = await templatesRoute.PUT(request("/api/integration/notifications/templates", undefined, { id: "SUB_SUCCESS", operator: "admin" }, "PUT"));
  assert.equal(put.status, 401);
  const one = await templateRoute.PUT(request("/api/integration/notifications/templates/SUB_SUCCESS", "wrong", { operator: "admin" }, "PUT"), params("SUB_SUCCESS"));
  assert.equal(one.status, 401);
  const testSend = await testRoute.POST(request("/api/integration/notifications/templates/SUB_SUCCESS/test", undefined, {}), params("SUB_SUCCESS"));
  assert.equal(testSend.status, 401);
});

test("PUT templates/:id saves copy, records operator audit and bumps updatedAt", async () => {
  const before = await templateById("SUB_RENEWAL_REMINDER");
  assert.equal(before.updatedAt, null);
  const response = await templateRoute.PUT(request("/api/integration/notifications/templates/SUB_RENEWAL_REMINDER", TOKEN, {
    operator: "ops@example.test",
    expectedUpdatedAt: null,
    en: { ...before.en, title: "Your plan renews soon" },
    zh: { ...before.zh, title: "你的订阅即将续费" },
  }, "PUT"), params("SUB_RENEWAL_REMINDER"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.template.en.title, "Your plan renews soon");
  assert.ok(body.template.updatedAt);
  assert.equal(body.template.updatedBy, "ops@example.test");
  const stored = await templateById("SUB_RENEWAL_REMINDER");
  assert.equal(stored.en.title, "Your plan renews soon");
  assert.equal(stored.metadata?.lastOperator, "ops@example.test");
  assert.equal(stored.audit?.at(-1)?.action, "template_saved");
  assert.equal(stored.audit?.at(-1)?.operator, "ops@example.test");
});

test("PUT collection route accepts the template id in the body", async () => {
  const before = await templateById("SUB_EXPIRED");
  const response = await templatesRoute.PUT(request("/api/integration/notifications/templates", TOKEN, {
    id: "SUB_EXPIRED",
    operator: "ops@example.test",
    expectedUpdatedAt: before.updatedAt,
    en: { ...before.en, message: before.en.message },
  }, "PUT"));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).template.id, "SUB_EXPIRED");
});

test("PUT templates enforces the PRD field limits", async () => {
  const before = await templateById("SUB_SUCCESS");
  const response = await templateRoute.PUT(request("/api/integration/notifications/templates/SUB_SUCCESS", TOKEN, {
    operator: "ops@example.test",
    expectedUpdatedAt: before.updatedAt,
    en: { ...before.en, title: "x".repeat(61) },
  }, "PUT"), params("SUB_SUCCESS"));
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.code, "validation_failed");
  assert.ok(body.issues.some((issue: { code: string; field: string }) => issue.code === "too_long" && issue.field === "title"));

  const emailBefore = await templateById("SUB_RENEWAL_REMINDER");
  const emailResponse = await templateRoute.PUT(request("/api/integration/notifications/templates/SUB_RENEWAL_REMINDER", TOKEN, {
    operator: "ops@example.test",
    expectedUpdatedAt: emailBefore.updatedAt,
    en: { ...emailBefore.en, emailBody: "x".repeat(2001) },
  }, "PUT"), params("SUB_RENEWAL_REMINDER"));
  assert.equal(emailResponse.status, 400);
  const emailBody = await emailResponse.json();
  assert.ok(emailBody.issues.some((issue: { code: string; field: string }) => issue.code === "too_long" && issue.field === "emailBody"));
});

test("PUT templates rejects unknown variables and names the right one", async () => {
  const before = await templateById("SUB_RENEWAL_FAILED");
  const response = await templateRoute.PUT(request("/api/integration/notifications/templates/SUB_RENEWAL_FAILED", TOKEN, {
    operator: "ops@example.test",
    expectedUpdatedAt: before.updatedAt,
    en: { ...before.en, message: "We could not charge {{amount_due}}." },
  }, "PUT"), params("SUB_RENEWAL_FAILED"));
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.code, "validation_failed");
  const issue = body.issues.find((item: { variable?: string }) => item.variable === "amount_due");
  assert.ok(issue);
  assert.equal(issue.suggestion, "renewal_amount");
  assert.match(issue.message, /renewal_amount/);
});

test("PUT templates blocks a partly translated Chinese copy (NTF-BO-013)", async () => {
  const before = await templateById("SUB_SUCCESS");
  const response = await templateRoute.PUT(request("/api/integration/notifications/templates/SUB_SUCCESS", TOKEN, {
    operator: "ops@example.test",
    expectedUpdatedAt: before.updatedAt,
    zh: { title: "订阅成功" },
  }, "PUT"), params("SUB_SUCCESS"));
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.ok(body.issues.some((issue: { code: string }) => issue.code === "zh_incomplete" || issue.code === "missing_required"));
});

test("PUT templates refuses to switch off a locked subscription notification", async () => {
  const before = await templateById("SUB_SUCCESS");
  const response = await templateRoute.PUT(request("/api/integration/notifications/templates/SUB_SUCCESS", TOKEN, {
    operator: "ops@example.test",
    expectedUpdatedAt: before.updatedAt,
    enabled: false,
  }, "PUT"), params("SUB_SUCCESS"));
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.code, "locked");
});

test("PUT templates toggles an optional notification and records the before/after audit", async () => {
  const before = await templateById("COURSE_NEW_LAUNCH");
  assert.equal(before.enabled, true);
  const response = await templateRoute.PUT(request("/api/integration/notifications/templates/COURSE_NEW_LAUNCH", TOKEN, {
    operator: "ops@example.test",
    expectedUpdatedAt: before.updatedAt,
    enabled: false,
  }, "PUT"), params("COURSE_NEW_LAUNCH"));
  assert.equal(response.status, 200);
  const stored = await templateById("COURSE_NEW_LAUNCH");
  assert.equal(stored.enabled, false);
  const audit = stored.audit?.at(-1);
  assert.equal(audit?.action, "template_toggled");
  assert.deepEqual(audit?.before, { enabled: true });
  assert.deepEqual(audit?.after, { enabled: false });
});

test("PUT templates returns 409 for a stale expectedUpdatedAt and never silently overwrites", async () => {
  const before = await templateById("SUB_AUTORENEW_CANCELLED");
  const first = await templateRoute.PUT(request("/api/integration/notifications/templates/SUB_AUTORENEW_CANCELLED", TOKEN, {
    operator: "ops-one@example.test",
    expectedUpdatedAt: before.updatedAt,
    en: { ...before.en, title: "Auto-renewal off" },
  }, "PUT"), params("SUB_AUTORENEW_CANCELLED"));
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  const stale = await templateRoute.PUT(request("/api/integration/notifications/templates/SUB_AUTORENEW_CANCELLED", TOKEN, {
    operator: "ops-two@example.test",
    expectedUpdatedAt: before.updatedAt,
    en: { ...before.en, title: "Something else" },
  }, "PUT"), params("SUB_AUTORENEW_CANCELLED"));
  assert.equal(stale.status, 409);
  const staleBody = await stale.json();
  assert.equal(staleBody.code, "conflict");
  assert.equal(staleBody.current.en.title, "Auto-renewal off");
  assert.equal((await templateById("SUB_AUTORENEW_CANCELLED")).en.title, "Auto-renewal off");
  const fresh = await templateRoute.PUT(request("/api/integration/notifications/templates/SUB_AUTORENEW_CANCELLED", TOKEN, {
    operator: "ops-two@example.test",
    expectedUpdatedAt: firstBody.template.updatedAt,
    en: { ...before.en, title: "Something else" },
  }, "PUT"), params("SUB_AUTORENEW_CANCELLED"));
  assert.equal(fresh.status, 200);
});

test("PUT templates requires an operator and a known template id", async () => {
  const missingOperator = await templateRoute.PUT(request("/api/integration/notifications/templates/SUB_SUCCESS", TOKEN, {
    en: { title: "No operator" },
  }, "PUT"), params("SUB_SUCCESS"));
  assert.equal(missingOperator.status, 400);
  const unknown = await templateRoute.PUT(request("/api/integration/notifications/templates/NOT_A_TEMPLATE", TOKEN, {
    operator: "ops@example.test",
  }, "PUT"), params("NOT_A_TEMPLATE"));
  assert.equal(unknown.status, 404);
});

test("test send creates a [TEST] in-app message for the matching learner and is excluded from learner stats", async () => {
  const user = await verifiedUser(store, "ops-test-learner@example.test");
  const response = await testRoute.POST(request("/api/integration/notifications/templates/SUB_SUCCESS/test", TOKEN, {
    channel: "in_app",
    language: "en",
    operatorEmail: user.email,
    operator: "ops@example.test",
  }), params("SUB_SUCCESS"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.notificationId.length > 0, true);
  const data = await store.ensureProductData();
  const notification = data.notifications.find((item) => item.id === body.notificationId)!;
  assert.match(notification.title, /^\[TEST\] /);
  assert.equal(notification.isTest, true);
  assert.equal(notification.userId, user.id);
  const log = (data.notificationLog || []).find((item) => item.notificationId === notification.id)!;
  assert.equal(log.isTest, true);
  assert.equal(log.status, "delivered");
  const inbox = await service.listLearnerNotifications(user.id, { filter: "all" });
  // REV-07: the recipient sees the test message, but it is read and never counted.
  assert.equal(inbox.items.length, 1);
  assert.equal(inbox.items[0].isTest, true);
  assert.equal(inbox.items[0].unread, false);
  assert.equal(inbox.unreadCount, 0);
});

test("test send accepts unsaved copy and a language, and errors for a missing learner account", async () => {
  const user = await verifiedUser(store, "ops-test-unsaved@example.test");
  const response = await testRoute.POST(request("/api/integration/notifications/templates/SUB_RENEWAL_FAILED/test", TOKEN, {
    channel: "in_app",
    language: "en",
    operatorEmail: user.email,
    operator: "ops@example.test",
    copy: { en: { title: "Unsaved title", message: "Unsaved body for {{plan_name}}." } },
  }), params("SUB_RENEWAL_FAILED"));
  assert.equal(response.status, 200);
  const testBody = await response.json();
  const data = await store.ensureProductData();
  const notification = data.notifications.find((item) => item.id === testBody.notificationId)!;
  assert.match(notification.title, /^\[TEST\] Unsaved title$/);
  assert.match(notification.body, /Everything/);

  const missing = await testRoute.POST(request("/api/integration/notifications/templates/SUB_SUCCESS/test", TOKEN, {
    channel: "in_app", language: "en", operatorEmail: "nobody@example.test", operator: "ops@example.test",
  }), params("SUB_SUCCESS"));
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).code, "no_learner");
});

test("test send rejects an email channel on an in-app-only template and reports unconfigured mail", async () => {
  const inAppOnly = await testRoute.POST(request("/api/integration/notifications/templates/SUB_SUCCESS/test", TOKEN, {
    channel: "email", language: "en", operatorEmail: "ops@example.test", operator: "ops@example.test",
  }), params("SUB_SUCCESS"));
  assert.equal(inAppOnly.status, 400);
  assert.equal((await inAppOnly.json()).code, "invalid_channel");

  const emailTemplate = await testRoute.POST(request("/api/integration/notifications/templates/SUB_RENEWAL_REMINDER/test", TOKEN, {
    channel: "email", language: "en", operatorEmail: "ops@example.test", operator: "ops@example.test",
  }), params("SUB_RENEWAL_REMINDER"));
  assert.equal(emailTemplate.status, 503);
  const body = await emailTemplate.json();
  assert.equal(body.code, "email_not_configured");
  const data = await store.ensureProductData();
  assert.ok((data.notificationLog || []).some((item) => item.templateId === "SUB_RENEWAL_REMINDER" && item.channel === "email" && item.isTest && item.status === "failed"));
});
