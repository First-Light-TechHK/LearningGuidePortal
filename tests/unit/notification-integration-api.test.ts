import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { verifiedUser } from "./helpers/my-learning";

const originalCwd = process.cwd();
const originalStorageBackend = process.env.STORAGE_BACKEND;
const originalToken = process.env.NOTIFICATIONS_SERVICE_TOKEN;
const origin = "http://localhost:3014";
const TOKEN = "test-notifications-service-token";
let isolatedCwd: string;
let store: typeof import("../../services/productStore");
let events: typeof import("../../app/api/integration/notifications/events/route").POST;
let templates: typeof import("../../app/api/integration/notifications/templates/route").GET;
let audiences: typeof import("../../app/api/integration/notifications/audiences/route").GET;

before(async () => {
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-notification-integration-"));
  process.chdir(isolatedCwd);
  process.env.STORAGE_BACKEND = "local";
  process.env.NOTIFICATIONS_SERVICE_TOKEN = TOKEN;
  store = await import("../../services/productStore");
  events = (await import("../../app/api/integration/notifications/events/route")).POST;
  templates = (await import("../../app/api/integration/notifications/templates/route")).GET;
  audiences = (await import("../../app/api/integration/notifications/audiences/route")).GET;
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

test("integration routes reject a missing or wrong service token with 401", async () => {
  assert.equal((await events(request("/api/integration/notifications/events", undefined, {}))).status, 401);
  assert.equal((await events(request("/api/integration/notifications/events", "wrong", {}))).status, 401);
  assert.equal((await templates(request("/api/integration/notifications/templates", undefined, undefined, "GET"))).status, 401);
  assert.equal((await audiences(request("/api/integration/notifications/audiences", undefined, undefined, "GET"))).status, 401);
});

test("GET integration templates and audiences expose read-only catalogue data", async () => {
  const catalogue = await templates(request("/api/integration/notifications/templates", TOKEN, undefined, "GET"));
  assert.equal(catalogue.status, 200);
  const body = await catalogue.json();
  assert.equal(body.templates.length, 13);
  assert.equal(body.templates.find((item: { id: string }) => item.id === "SUB_SUCCESS").locked, true);
  const counts = await audiences(request("/api/integration/notifications/audiences", TOKEN, undefined, "GET"));
  assert.equal(counts.status, 200);
  assert.equal(typeof (await counts.json()).all, "number");
});

test("POST events creates one notification for the addressed learner and rejects bad input", async () => {
  const user = await verifiedUser(store, "integration-event@example.test");
  const created = await events(request("/api/integration/notifications/events", TOKEN, {
    eventType: "COURSE_NEW_LAUNCH", eventKey: "course:renaissance:v1", email: user.email,
    params: { course_title: "The Renaissance in Florence", category_name: "Art & Humanities", course_link: "/courses/renaissance" },
  }));
  assert.equal(created.status, 200);
  const body = await created.json();
  assert.equal(body.ok, true);
  assert.equal(body.created, true);
  const data = await store.ensureProductData();
  const row = data.notifications.find((item) => item.userId === user.id && item.eventKey === "course:renaissance:v1");
  assert.ok(row);
  assert.equal(row.templateId, "COURSE_NEW_LAUNCH");
  const duplicate = await events(request("/api/integration/notifications/events", TOKEN, {
    eventType: "COURSE_NEW_LAUNCH", eventKey: "course:renaissance:v1", email: user.email,
    params: { course_title: "The Renaissance in Florence", category_name: "Art & Humanities", course_link: "/courses/renaissance" },
  }));
  assert.equal((await duplicate.json()).created, false);
  assert.equal((await events(request("/api/integration/notifications/events", TOKEN, { eventType: "HELPDESK_TICKET_REPLIED" }))).status, 400);
  assert.equal((await events(request("/api/integration/notifications/events", TOKEN, { eventType: "NOT_A_TEMPLATE", eventKey: "x", email: user.email }))).status, 400);
  assert.equal((await events(request("/api/integration/notifications/events", TOKEN, { eventType: "HELPDESK_TICKET_REPLIED", eventKey: "x", email: "missing@example.test", params: { ticket_subject: "Hi" } }))).status, 404);
});
