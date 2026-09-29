import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { accessPath, bindAccess, holdConnection, KEEP_ALIVE_MS, HEADERS_TIMEOUT_MS, logAccess } from "../../scripts/access-log.cjs";

test("access log records every finished request and drops the query string", () => {
  const lines: string[] = [];
  logAccess({ method: "GET", url: "/_next/static/chunks/app.js?token=secret", headers: { host: "sit.ilovelearningguide.com", "user-agent": "Chrome" } }, { statusCode: 200 }, Date.now() - 4, "finish", (line: string) => lines.push(line));
  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.type, "access");
  assert.equal(entry.path, "/_next/static/chunks/app.js");
  assert.equal(entry.status, 200);
  assert.equal(entry.outcome, "finish");
  assert.equal(entry.host, "sit.ilovelearningguide.com");
  assert.equal(entry.ua, "Chrome");
  assert.equal(lines[0].includes("secret"), false);
  assert.equal(accessPath("/en-GB/porta?token=secret"), "/en-GB/porta");
});

test("access log records a connection that closes before the response finishes", () => {
  const lines: string[] = [];
  const res = new EventEmitter() as EventEmitter & { statusCode: number; writableFinished: boolean; on(event: string, listener: () => void): unknown };
  res.statusCode = 200;
  res.writableFinished = false;
  bindAccess({ method: "GET", url: "/zh-CN/portal/courses/epicureanism", headers: { "user-agent": "Mozilla/5.0" } }, res, Date.now() - 30, (line: string) => lines.push(line));
  res.emit("close");
  res.emit("finish");
  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.path, "/zh-CN/portal/courses/epicureanism");
  assert.equal(entry.outcome, "aborted");
});

test("the server holds the client connection longer than App Runner's proxy", () => {
  const server = { headersTimeout: 60000, keepAliveTimeout: 5000, on() { return this; } };
  holdConnection(server);
  assert.equal(server.keepAliveTimeout, KEEP_ALIVE_MS);
  assert.equal(server.headersTimeout, HEADERS_TIMEOUT_MS);
  assert.ok(server.headersTimeout > server.keepAliveTimeout);
});
