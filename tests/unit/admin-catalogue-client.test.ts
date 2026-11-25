import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  AdminCatalogueError,
  adminCatalogueConfig,
  getCourse,
  listCourses,
  resetAdminCatalogueForTests,
} from "../../services/adminCatalogue";

const controlledKeys = ["PORTAL_COURSE_SOURCE", "ADMIN_PORTAL_BASE_URL", "ADMIN_PORTAL_API_TOKEN", "ADMIN_PORTAL_TIMEOUT_MS"] as const;
const saved = Object.fromEntries(controlledKeys.map(key => [key, process.env[key]]));
const originalFetch = globalThis.fetch;

function enableProjection() {
  process.env.PORTAL_COURSE_SOURCE = "admin";
  process.env.ADMIN_PORTAL_BASE_URL = "https://admin.sandbox.test/";
  process.env.ADMIN_PORTAL_API_TOKEN = "service-token";
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function isKind(error: unknown, kind: AdminCatalogueError["kind"]) {
  return error instanceof AdminCatalogueError && error.kind === kind;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetAdminCatalogueForTests();
  for (const key of controlledKeys) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

test("the projection is off by default and when the address or token is missing", () => {
  delete process.env.PORTAL_COURSE_SOURCE;
  delete process.env.ADMIN_PORTAL_BASE_URL;
  delete process.env.ADMIN_PORTAL_API_TOKEN;
  const defaults = adminCatalogueConfig();
  assert.equal(defaults.mode, "store");
  assert.equal(defaults.configured, false);

  process.env.PORTAL_COURSE_SOURCE = "admin";
  process.env.ADMIN_PORTAL_BASE_URL = "https://admin.sandbox.test";
  process.env.ADMIN_PORTAL_API_TOKEN = "token";
  assert.equal(adminCatalogueConfig().mode, "admin");

  delete process.env.ADMIN_PORTAL_API_TOKEN;
  assert.equal(adminCatalogueConfig().mode, "store", "a missing token must not silently stay on admin");
});

test("listCourses authenticates with X-API-Key and returns the projection rows", async () => {
  enableProjection();
  let seenUrl = "";
  let seenHeaders: Record<string, string> = {};
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seenUrl = String(input);
    seenHeaders = (init?.headers as Record<string, string>) || {};
    return jsonResponse({ success: true, data: [{ id: "uuid-1", slug: "modeling-life", title: "Modeling life" }] });
  }) as typeof fetch;

  const rows = await listCourses();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.id, "uuid-1");
  assert.match(seenUrl, /^https:\/\/admin\.sandbox\.test\/api\/portal\/v1\/courses\?limit=200$/);
  assert.equal(seenHeaders["X-API-Key"], "service-token");
  assert.equal(seenHeaders.Accept, "application/json");
});

test("401 is classified as unauthorized and cools down instead of retrying every request", async () => {
  enableProjection();
  globalThis.fetch = (async () => new Response("{}", { status: 401 })) as typeof fetch;
  await assert.rejects(listCourses(), error => isKind(error, "unauthorized"));

  let calls = 0;
  globalThis.fetch = (async () => { calls += 1; return jsonResponse({ success: true, data: [] }); }) as typeof fetch;
  await assert.rejects(listCourses(), error => isKind(error, "unauthorized"));
  assert.equal(calls, 0, "the cooldown must short-circuit before the network");
});

test("timeouts, network failures and HTTP errors are distinguished", async () => {
  enableProjection();
  globalThis.fetch = (async () => { const error = new Error("aborted"); error.name = "AbortError"; throw error; }) as typeof fetch;
  await assert.rejects(listCourses(), error => isKind(error, "timeout"));

  globalThis.fetch = (async () => { throw new Error("boom"); }) as typeof fetch;
  await assert.rejects(getCourse("uuid-1"), error => isKind(error, "network"));

  globalThis.fetch = (async () => new Response("{}", { status: 500 })) as typeof fetch;
  await assert.rejects(listCourses(), error => isKind(error, "http"));
});

test("an invalid JSON body, unsuccessful envelope or malformed detail is rejected", async () => {
  enableProjection();

  globalThis.fetch = (async () => new Response("not json", { status: 200 })) as typeof fetch;
  await assert.rejects(listCourses(), error => isKind(error, "invalid"));

  globalThis.fetch = (async () => jsonResponse({ success: false, error: { code: "X" } })) as typeof fetch;
  await assert.rejects(listCourses(), error => isKind(error, "invalid"));

  globalThis.fetch = (async () => jsonResponse({ success: true, data: { slug: "no-id" } })) as typeof fetch;
  await assert.rejects(getCourse("uuid-1"), error => isKind(error, "invalid"));
});
