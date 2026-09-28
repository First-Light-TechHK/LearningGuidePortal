"use strict";

function accessPath(url) {
  const path = String(url || "/").split("?")[0].split("#")[0];
  return path.startsWith("/") ? path : "/";
}

function shouldLogAccess(path) {
  return path !== "/_next/static" && !path.startsWith("/_next/static/") && path !== "/_next/image" && !path.startsWith("/_next/image/");
}

function accessLogLine({ method, path, status, durationMs, outcome, error }) {
  const entry = { type: "access", method, path, status, durationMs, outcome };
  if (error) entry.error = error;
  return JSON.stringify(entry);
}

function logAccess(req, res, started, outcome, error, write = (line) => process.stdout.write(line)) {
  const path = accessPath(req && req.url);
  if (!shouldLogAccess(path)) return;
  write(`${accessLogLine({ method: (req && req.method) || "GET", path, status: (res && res.statusCode) || 0, durationMs: Date.now() - started, outcome, error })}\n`);
}

function logFinishedAccess(req, res, started, write) {
  logAccess(req, res, started, "finish", null, write);
}

function logClosedAccess(req, res, started, error, write) {
  logAccess(req, res, started, "closed", error, write);
}

function observeRequest(req, res, started = Date.now(), write) {
  let finished = false;
  let errorCode = null;
  const note = (error) => {
    const code = error && error.code;
    if (typeof code === "string" && code.length < 40) errorCode = code;
  };
  req.on("error", note);
  res.on("error", note);
  res.on("finish", () => {
    finished = true;
    try { logFinishedAccess(req, res, started, write); } catch { /* An access line must not affect the response. */ }
  });
  res.on("close", () => {
    if (finished) return;
    try { logClosedAccess(req, res, started, errorCode, write); } catch { /* An access line must not affect the response. */ }
  });
}

const KEEP_ALIVE_MS = 121000;
const HEADERS_TIMEOUT_MS = 122000;

function holdConnection(server) {
  server.headersTimeout = HEADERS_TIMEOUT_MS;
  server.keepAliveTimeout = KEEP_ALIVE_MS;
  server.on("request", (req, res) => observeRequest(req, res));
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

module.exports = { accessPath, shouldLogAccess, accessLogLine, logFinishedAccess, logClosedAccess, observeRequest, holdConnection, KEEP_ALIVE_MS, HEADERS_TIMEOUT_MS, installAccessLog };
