import assert from "node:assert/strict";
import { test } from "node:test";
import { accessPath, holdConnection, KEEP_ALIVE_MS, HEADERS_TIMEOUT_MS, logFinishedAccess, observeRequest, shouldLogAccess } from "../../scripts/access-log.cjs";

test("access log keeps the finished status and drops the query string", () => {
  const lines: string[] = [];
  logFinishedAccess({ method: "GET", url: "/en-GB/porta?token=secret" }, { statusCode: 404 }, Date.now() - 12, (line: string) => lines.push(line));
  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.type, "access");
  assert.equal(entry.method, "GET");
  assert.equal(entry.path, "/en-GB/porta");
  assert.equal(entry.status, 404);
  assert.equal(entry.outcome, "finish");
  assert.equal(typeof entry.durationMs, "number");
  assert.equal(lines[0].includes("secret"), false);
  assert.equal(lines[0].includes("token"), false);
});

test("the server holds the client connection longer than App Runner's proxy", () => {
  const server = { headersTimeout: 60000, keepAliveTimeout: 5000, on() { return this; } };
  holdConnection(server);
  assert.equal(server.keepAliveTimeout, KEEP_ALIVE_MS);
  assert.equal(server.headersTimeout, HEADERS_TIMEOUT_MS);
  assert.ok(server.headersTimeout > server.keepAliveTimeout);
});

test("a connection that closes before a response records the reset", () => {
  const lines: string[] = [];
  const handlers: Record<string, (error?: { code?: string }) => void> = {};
  const req = { method: "POST", url: "/api/auth/login?token=secret", on(event: string, listener: (error?: { code?: string }) => void) { handlers[`req:${event}`] = listener; return this; } };
  const res = { statusCode: 0, on(event: string, listener: (error?: { code?: string }) => void) { handlers[`res:${event}`] = listener; return this; } };
  observeRequest(req, res, Date.now() - 40, (line: string) => lines.push(line));
  handlers["res:error"]({ code: "ECONNRESET" });
  handlers["res:close"]();
  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.outcome, "closed");
  assert.equal(entry.error, "ECONNRESET");
  assert.equal(entry.method, "POST");
  assert.equal(entry.path, "/api/auth/login");
  assert.equal(entry.status, 0);
  assert.equal(lines[0].includes("secret"), false);
});

test("access log ignores hashed static files", () => {
  const lines: string[] = [];
  logFinishedAccess({ method: "GET", url: "/_next/static/chunks/app.js" }, { statusCode: 200 }, Date.now(), (line: string) => lines.push(line));
  assert.deepEqual(lines, []);
  assert.equal(shouldLogAccess(accessPath("/api/health")), true);
});
