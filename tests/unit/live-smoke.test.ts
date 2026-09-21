// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import { runLiveSmoke } from "../../scripts/release/liveSmoke.mjs";
import { formatReleaseMessage } from "../../scripts/release/notify.mjs";
import { isRollbackSha } from "../../scripts/release/rollback.mjs";
import { resolveReleaseEnvironment } from "../../scripts/release/environments.mjs";

const sha = "9b3b85cc74f207c62233d7f255961332d3176bad";

function json(status, body, headers = {}) {
  return {
    status,
    body,
    text: JSON.stringify(body),
    headers: { get: (name) => headers[name.toLowerCase()] || null }
  };
}

function html(status, text = "<html><body>Learning Guide</body></html>", extra = {}) {
  return { status, body: null, text, headers: { get: (name) => extra[name.toLowerCase()] || null } };
}

function stub(overrides = {}) {
  return async (path, options = {}) => {
    if (overrides[path]) return overrides[path](options);
    if (path === "/api/health") return json(200, { ok: true, ready: true, environment: "SIT", version: sha, checks: { database: true, paymentMigration: true, storage: true }, missing: [] });
    if (path === "/api/health/config") return json(200, { ready: true, missing: [], storage: "postgresql+s3", payment: { mode: "stripe" } });
    if (path === "/api/portal/courses") return json(200, { ok: true, courses: [{ slug: "epicureanism", status: "published" }] });
    if (path === "/api/portal/courses/epicureanism") return json(200, { ok: true, page: { identity: { title: "Epicureanism" } } });
    if (path === "/api/portal/plans") return json(200, { ok: true, plans: [{ id: "everything-pc-6" }] });
    if (path === "/api/my-learning") return json(401, { ok: false });
    if (path === "/api/study/events") return json(401, { ok: false });
    if (path === "/api/auth/check-email") return json(200, { ok: true, data: {} });
    if (path === "/api/auth/register") return json(200, { ok: true, data: { verificationRequired: true } });
    if (path === "/api/auth/login") return json(401, { ok: false });
    if (path === "/api/auth/resend-verification") return json(200, { ok: true, data: { accepted: true } });
    if (path === "/api/auth/password-reset/request") return json(200, { ok: true, accepted: true, retryAfter: 60 });
    if (path.startsWith("/api/auth/google")) return html(307, "", { location: "https://accounts.google.com/o/oauth2/v2/auth" });
    if (path.startsWith("/api/auth/wechat")) return html(307, "", { location: "https://open.weixin.qq.com/connect/qrconnect" });
    if (path === "/en-GB/backoffice") return html(404, "not found");
    return html(200);
  };
}

test("live smoke accepts a healthy SIT origin, registers, and does not pay", async () => {
  const seen = [];
  const result = await runLiveSmoke({
    origin: "https://sit.example.test",
    appEnv: "SIT",
    sha,
    requireDependencyChecks: true,
    requireVersionMatch: true,
    testEmail: "tester@example.test"
  }, async (path, options = {}) => {
    seen.push(`${options.method || "GET"} ${path}`);
    return stub()(path, options);
  });
  assert.equal(result.ok, true, result.failures.join("; "));
  assert.deepEqual(result.catalogue, ["epicureanism"]);
  assert.equal(seen.some((item) => item.includes("POST /api/auth/register")), true);
  assert.equal(seen.some((item) => item.includes("/api/payment")), false);
});

test("live smoke fails SIT when LIVE_TEST_EMAIL is missing", async () => {
  const result = await runLiveSmoke({
    origin: "https://sit.example.test",
    appEnv: "SIT",
    sha,
    requireDependencyChecks: true,
    requireVersionMatch: true
  }, stub());
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((item) => item.startsWith("registration:")));
});

test("live smoke fails when registration leaks an SES IAM error", async () => {
  const result = await runLiveSmoke({
    origin: "https://sit.example.test",
    appEnv: "SIT",
    sha,
    requireDependencyChecks: true,
    requireVersionMatch: true,
    testEmail: "tester@example.test"
  }, async (path, options = {}) => {
    if (path === "/api/auth/register") {
      return json(400, {
        ok: false,
        code: "REGISTRATION_FAILED",
        message: "User: arn:aws:sts::851987565851:assumed-role/learning-guide-sit-runtime/ is not authorized to perform: ses:SendEmail"
      });
    }
    return stub()(path, options);
  });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((item) => item.includes("IAM") || item.includes("leaked")));
});

test("live smoke fails when health is not ready", async () => {
  const result = await runLiveSmoke({
    origin: "https://sit.example.test",
    appEnv: "SIT",
    sha,
    requireDependencyChecks: true,
    requireVersionMatch: true
  }, async (path, options = {}) => {
    if (path === "/api/health") return json(503, { ok: true, ready: false, environment: "SIT", version: sha, missing: ["SESSION_SECRET"] });
    return stub()(path, options);
  });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((item) => item.startsWith("health:")));
});

test("live smoke fails when Google stays on the product origin", async () => {
  const result = await runLiveSmoke({
    origin: "https://sit.example.test",
    appEnv: "SIT",
    sha,
    requireDependencyChecks: true,
    requireVersionMatch: true
  }, async (path, options = {}) => {
    if (path.startsWith("/api/auth/google")) return html(200, "local login");
    return stub()(path, options);
  });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((item) => item.startsWith("google.redirect:")));
});

test("notify message never includes secret values", () => {
  const message = formatReleaseMessage({
    environment: "SIT",
    sha,
    previousSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    status: "failed",
    origin: "https://sit.ilovelearningguide.com",
    failures: ["health: HTTP 503 ready=false"]
  });
  assert.match(message, /SIT release failed/);
  assert.doesNotMatch(message, /sk_live_|sk_test_|whsec_|BEGIN /);
});

test("rollback requires a full git SHA", () => {
  assert.equal(isRollbackSha(sha), true);
  assert.equal(isRollbackSha("local"), false);
  assert.equal(isRollbackSha("9b3b85c"), false);
});

test("UAT and PPE stay unprovisioned until ARNs exist", () => {
  assert.equal(resolveReleaseEnvironment("UAT").provisioned, false);
  assert.equal(resolveReleaseEnvironment("PPE").provisioned, false);
  assert.equal(resolveReleaseEnvironment("DEV").provisioned, true);
});
