import assert from "node:assert/strict";
import { test } from "node:test";
import { accessPath, holdConnection, KEEP_ALIVE_MS, HEADERS_TIMEOUT_MS, logFinishedAccess, shouldLogAccess } from "../../scripts/access-log.cjs";

test("access log keeps the finished status and drops the query string", () => {
  const lines: string[] = [];
  logFinishedAccess({ method: "GET", url: "/en-GB/porta?token=secret" }, { statusCode: 404 }, Date.now() - 12, (line) => lines.push(line));
  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.type, "access");
  assert.equal(entry.method, "GET");
  assert.equal(entry.path, "/en-GB/porta");
  assert.equal(entry.status, 404);
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

test("access log ignores hashed static files", () => {
  const lines: string[] = [];
  logFinishedAccess({ method: "GET", url: "/_next/static/chunks/app.js" }, { statusCode: 200 }, Date.now(), (line) => lines.push(line));
  assert.deepEqual(lines, []);
  assert.equal(shouldLogAccess(accessPath("/api/health")), true);
});
