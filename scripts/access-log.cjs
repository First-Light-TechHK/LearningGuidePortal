"use strict";

function accessPath(url) {
  const path = String(url || "/").split("?")[0].split("#")[0];
  return path.startsWith("/") ? path : "/";
}

function shouldLogAccess(path) {
  return path !== "/_next/static" && !path.startsWith("/_next/static/") && path !== "/_next/image" && !path.startsWith("/_next/image/");
}

function accessLogLine({ method, path, status, durationMs }) {
  return JSON.stringify({ type: "access", method, path, status, durationMs });
}

function logFinishedAccess(req, res, started, write = (line) => process.stdout.write(line)) {
  const path = accessPath(req && req.url);
  if (!shouldLogAccess(path)) return;
  write(`${accessLogLine({ method: (req && req.method) || "GET", path, status: res && res.statusCode, durationMs: Date.now() - started })}\n`);
}

const KEEP_ALIVE_MS = 121000;
const HEADERS_TIMEOUT_MS = 122000;

function holdConnection(server) {
  server.headersTimeout = HEADERS_TIMEOUT_MS;
  server.keepAliveTimeout = KEEP_ALIVE_MS;
  server.on("request", (req, res) => {
    const started = Date.now();
    res.on("finish", () => {
      try { logFinishedAccess(req, res, started); } catch { /* An access line must not affect the response. */ }
    });
  });
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

module.exports = { accessPath, shouldLogAccess, accessLogLine, logFinishedAccess, holdConnection, KEEP_ALIVE_MS, HEADERS_TIMEOUT_MS, installAccessLog };
