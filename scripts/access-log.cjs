"use strict";

function accessPath(url) {
  const path = String(url || "/").split("?")[0].split("#")[0];
  return path.startsWith("/") ? path : "/";
}

function headerValue(req, name) {
  const value = req && req.headers && req.headers[name];
  const text = Array.isArray(value) ? value[0] : value;
  return String(text || "").slice(0, 180);
}

function accessLogLine({ method, host, path, status, durationMs, outcome, ua }) {
  return JSON.stringify({ type: "access", method, host, path, status, durationMs, outcome, ua });
}

function logAccess(req, res, started, outcome, write = (line) => process.stdout.write(line)) {
  write(`${accessLogLine({
    method: (req && req.method) || "GET",
    host: headerValue(req, "host"),
    path: accessPath(req && req.url),
    status: res && typeof res.statusCode === "number" ? res.statusCode : null,
    durationMs: Date.now() - started,
    outcome,
    ua: headerValue(req, "user-agent")
  })}\n`);
}

function bindAccess(req, res, started, write) {
  let logged = false;
  const emit = (outcome) => {
    if (logged) return;
    logged = true;
    try { logAccess(req, res, started, outcome, write); } catch { /* An access line must not affect the response. */ }
  };
  res.on("finish", () => emit("finish"));
  res.on("close", () => emit(res.writableFinished ? "finish" : "aborted"));
}

const KEEP_ALIVE_MS = 121000;
const HEADERS_TIMEOUT_MS = 122000;

function holdConnection(server) {
  server.headersTimeout = HEADERS_TIMEOUT_MS;
  server.keepAliveTimeout = KEEP_ALIVE_MS;
  server.on("request", (req, res) => bindAccess(req, res, Date.now()));
}

function patchCreateServer(mod) {
  if (!mod || typeof mod.createServer !== "function" || mod.createServer.accessLog) return;
  const original = mod.createServer;
  function createServer(...args) {
    const server = original.apply(this, args);
    holdConnection(server);
    return server;
  }
  createServer.accessLog = true;
  mod.createServer = createServer;
}

function installAccessLog() {
  patchCreateServer(require("http"));
  patchCreateServer(require("https"));
}

module.exports = { accessPath, accessLogLine, logAccess, bindAccess, holdConnection, KEEP_ALIVE_MS, HEADERS_TIMEOUT_MS, installAccessLog };
