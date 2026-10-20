import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Fail-closed production preflight (Phase C slice 3): the Study Group release
// gate entries. Each case runs `node scripts/preflight-production.mjs` with a
// full dummy environment — never the parent environment — so the case matrix
// is hermetic, and diagnostics must never echo env values: the failing runs
// assert the exact diagnostic payload, which is only rule text.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const script = path.join(repoRoot, "scripts/preflight-production.mjs");

const ACTIVE_PROJECT = { id: "lg-prod", url: "wss://lg-prod.livekit.cloud", state: "active", credentialSecretId: "lg/livekit/prod" };
const TOKEN_LOG_KEY = Buffer.alloc(32, 9).toString("base64");

const baseEnv: Record<string, string> = {
  APP_ENV: "PROD",
  NEXT_PUBLIC_APP_URL: "https://app.example.test",
  DATABASE_URL: "postgres://lg:lg@db.example.test:5432/learningguide",
  DATA_S3_BUCKET: "lg-prod-data",
  STRIPE_SECRET_KEY: "sk_live_preflight_dummy",
  STRIPE_WEBHOOK_SECRET: "whsec_preflight_dummy",
  GOOGLE_CLIENT_ID: "google-client-dummy",
  GOOGLE_CLIENT_SECRET: "google-secret-dummy",
  SESSION_SECRET: "0123456789abcdef0123456789abcdef",
  WECHAT_APP_ID: "wechat-app-dummy",
  WECHAT_APP_SECRET: "wechat-secret-dummy",
  SES_FROM_EMAIL: "no-reply@example.test",
  OPENROUTER_API_KEY: "openrouter-dummy",
  PAYMENT_MODE: "stripe",
  LIVEKIT_PROJECTS_JSON: JSON.stringify([ACTIVE_PROJECT]),
  STUDY_GROUP_TOKEN_LOG_KEY: TOKEN_LOG_KEY
};

function runPreflight(overrides: Record<string, string | undefined> = {}) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { NODE_ENV: "test", PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...baseEnv };
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
    const child = spawn(process.execPath, [script], { cwd: repoRoot, env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("preflight passes with the full dummy production environment", async () => {
  const run = await runPreflight();
  assert.equal(run.code, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), { ok: true, environment: "PROD", paymentMode: "stripe", storage: "postgresql+s3" });
});

test("preflight blocks the file Study Group store case-insensitively", async () => {
  for (const value of ["file", "FILE", " File "]) {
    const run = await runPreflight({ STUDY_GROUP_STORE: value });
    assert.equal(run.code, 1, `STUDY_GROUP_STORE=${value} must fail`);
    // The diagnostic is exactly the rule message — the env value is not echoed.
    assert.deepEqual(JSON.parse(run.stderr), { ok: false, missing: ["STUDY_GROUP_STORE must not be the file store in production"] });
  }
});

test("preflight blocks a token-log key that does not decode to 32 bytes", async () => {
  const short = Buffer.alloc(16, 3).toString("base64");
  const run = await runPreflight({ STUDY_GROUP_TOKEN_LOG_KEY: short });
  assert.equal(run.code, 1);
  assert.deepEqual(JSON.parse(run.stderr), { ok: false, missing: ["STUDY_GROUP_TOKEN_LOG_KEY must be a 32-byte base64 value"] });
});

test("preflight blocks projects JSON without at least one active project", async () => {
  const cases = [
    "[]",
    JSON.stringify([{ ...ACTIVE_PROJECT, state: "draining" }]),
    JSON.stringify([{ ...ACTIVE_PROJECT, state: "disabled" }]),
    "{"
  ];
  for (const value of cases) {
    const run = await runPreflight({ LIVEKIT_PROJECTS_JSON: value });
    assert.equal(run.code, 1, `LIVEKIT_PROJECTS_JSON=${value} must fail`);
    // The diagnostic is exactly the rule message — the JSON is not echoed.
    assert.deepEqual(JSON.parse(run.stderr), { ok: false, missing: ["LIVEKIT_PROJECTS_JSON must be a JSON array with at least one active project"] });
  }
});

test("preflight requires the Study Group env names", async () => {
  const run = await runPreflight({ LIVEKIT_PROJECTS_JSON: undefined, STUDY_GROUP_TOKEN_LOG_KEY: undefined });
  assert.equal(run.code, 1);
  const missing = (JSON.parse(run.stderr) as { missing: string[] }).missing;
  assert.ok(missing.includes("LIVEKIT_PROJECTS_SECRET_ID or LIVEKIT_PROJECTS_JSON"));
  assert.ok(missing.includes("STUDY_GROUP_TOKEN_LOG_KEY"));
});

test("preflight accepts the hot project list secret in place of the JSON", async () => {
  // The secret's content is read and validated by the runtime; an inline JSON
  // left beside it is ignored there, so it is not judged here either.
  for (const json of [undefined, "[]"]) {
    const run = await runPreflight({ LIVEKIT_PROJECTS_SECRET_ID: "lg/livekit/projects", LIVEKIT_PROJECTS_JSON: json });
    assert.equal(run.code, 0, run.stderr);
  }
});

test("preflight passes with a valid Study Group environment and no store override", async () => {
  const run = await runPreflight({
    STUDY_GROUP_STORE: undefined,
    STUDY_GROUP_TOKEN_LOG_KEY: Buffer.alloc(32, 21).toString("base64"),
    LIVEKIT_PROJECTS_JSON: JSON.stringify([{ ...ACTIVE_PROJECT, state: "draining" }, { ...ACTIVE_PROJECT, id: "lg-prod-2" }])
  });
  assert.equal(run.code, 0, run.stderr);
  assert.equal((JSON.parse(run.stdout) as { ok: boolean }).ok, true);
});
