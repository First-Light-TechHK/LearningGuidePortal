// Regression lock for the Sandbox course-only partition (takeover review F1):
// the Sandbox Portal must receive course browsing/login/payment/storage/session
// configuration only — never AI Tutor, Helpdesk, Study Group/LiveKit, or
// catalogue-pull integration variables, and never copies of them from UAT.
// Importing the provisioner must not touch AWS: every AWS/Stripe action lives in
// runProvisioner(), which the main guard never calls from the test runner.
import test from "node:test";
import assert from "node:assert/strict";
import { credentialCopyKeysFor, deployVariablesFor, keyDisabledFor, tiers } from "../../scripts/provision-uat.mjs";

const NOT_WRITTEN = [
  "OPENROUTER_API_KEY",
  "OPENROUTER_SITE_URL",
  "OPENROUTER_APP_NAME",
  "OPENROUTER_MODEL",
  "KS_TUTOR_BASE_URL",
  "KS_TUTOR_API_KEY",
  "KS_TUTOR_TIMEOUT_MS",
  "ADMIN_HELPDESK_BASE_URL",
  "ADMIN_HELPDESK_TOKEN",
  "PORTAL_HELPDESK_TOKEN",
  "PORTAL_STUDENTS_TOKEN",
  "LIVEKIT_PROJECTS_JSON",
  "LIVEKIT_PROJECTS_SECRET_ID",
  "LIVEKIT_LOCAL_CREDENTIALS_JSON",
  "STUDY_GROUP_TOKEN_LOG_KEY",
  "PORTAL_INTEGRATION_TOKEN"
];

const COURSE_CHAIN_KEYS = [
  "ADMIN_HOSTS",
  "ADMIN_PORTAL_BASE_URL",
  "ADMIN_PORTAL_API_TOKEN",
  "NEXT_PUBLIC_APP_URL",
  "DATABASE_URL",
  "SESSION_SECRET",
  "STRIPE_PRICE_EVERYTHING_YEAR",
  "GOOGLE_CLIENT_ID",
  "WECHAT_APP_ID",
  "SMTP_HOST",
  "SMTP_PASS",
  "DATA_S3_BUCKET"
];

test("sandbox tier writes only course-chain variables and the Admin catalogue token", () => {
  const sandbox = tiers.sandbox;
  // The Admin token is the course catalogue projection credential (Admin AUTH_TOKEN
  // pairing, provisioning request §3.3), not an AI/Helpdesk credential.
  assert.deepEqual(sandbox.sharedSecrets, {
    ADMIN_PORTAL_API_TOKEN: "learning-guide/admin/sandbox/admin_api_key"
  });
  assert.deepEqual(Object.keys(sandbox.deployVariables).sort(), ["ADMIN_HOSTS", "ADMIN_PORTAL_BASE_URL"]);
  for (const key of NOT_WRITTEN) {
    assert.equal(key in sandbox.deployVariables, false, `deploy variable ${key} must not be written`);
    assert.equal(key in sandbox.sharedSecrets, false, `shared secret ${key} must not be written`);
    assert.equal(keyDisabledFor(sandbox, key), true, `${key} must be disabled for Sandbox`);
  }
  for (const key of COURSE_CHAIN_KEYS) {
    assert.equal(keyDisabledFor(sandbox, key), false, `${key} belongs to the course chain and must stay allowed`);
  }
});

test("source UAT variables are filtered before they can reach the Sandbox", () => {
  const source = {
    APP_ENV: "UAT",
    APP_VERSION: "abc123",
    NEXT_PUBLIC_APP_URL: "https://uat.ilovelearningguide.com",
    OPENROUTER_API_KEY: "copy-me-not",
    OPENROUTER_SITE_URL: "https://uat.ilovelearningguide.com",
    OPENROUTER_MODEL: "openrouter/auto",
    KS_TUTOR_BASE_URL: "https://admin.uat.ilovelearningguide.com",
    KS_TUTOR_TIMEOUT_MS: "60000",
    ADMIN_HELPDESK_BASE_URL: "https://admin.uat.ilovelearningguide.com",
    PORTAL_HELPDESK_TOKEN: "copy-me-not",
    PORTAL_INTEGRATION_TOKEN: "copy-me-not",
    LIVEKIT_PROJECTS_JSON: "[]",
    STUDY_GROUP_TOKEN_LOG_KEY: "copy-me-not",
    ADMIN_PORTAL_BASE_URL: "https://admin.sandbox.ilovelearningguide.com",
    ADMIN_HOSTS: "admin.sandbox.ilovelearningguide.com",
    GOOGLE_CLIENT_ID: "google-client-id",
    SMTP_HOST: "smtp.example.test",
    STRIPE_PRICE_EVERYTHING_YEAR: "price_everything_year",
    SESSION_SECRET: "secret-value",
    DATABASE_URL: "postgresql://user:pass@host/db"
  };
  const sandbox = deployVariablesFor(tiers.sandbox, source);
  assert.deepEqual(Object.keys(sandbox).sort(), [
    "ADMIN_HOSTS",
    "ADMIN_PORTAL_BASE_URL",
    "GOOGLE_CLIENT_ID",
    "SMTP_HOST",
    "STRIPE_PRICE_EVERYTHING_YEAR"
  ]);
  assert.equal(sandbox.ADMIN_PORTAL_BASE_URL, "https://admin.sandbox.ilovelearningguide.com");
});

test("source credential copies are course-chain only for Sandbox and unchanged for UAT", () => {
  assert.deepEqual(credentialCopyKeysFor(tiers.sandbox), [
    "GOOGLE_CLIENT_SECRET",
    "WECHAT_APP_ID",
    "WECHAT_APP_SECRET",
    "STRIPE_SECRET_KEY",
    "SMTP_PASS",
    "DOCUMENTS_AWS_ACCESS_KEY_ID",
    "DOCUMENTS_AWS_SECRET_ACCESS_KEY"
  ]);
  // UAT must keep creating its own OpenRouter secret on a fresh provision.
  assert.ok(credentialCopyKeysFor(tiers.uat).includes("OPENROUTER_API_KEY"));
  assert.equal(credentialCopyKeysFor(tiers.uat).length, 8);
});

test("UAT keeps mirroring the source template (no behaviour change)", () => {
  const copied = deployVariablesFor(tiers.uat, {
    OPENROUTER_MODEL: "openrouter/auto",
    GOOGLE_CLIENT_ID: "google-client-id",
    SESSION_SECRET: "secret-value"
  });
  assert.deepEqual(copied, { OPENROUTER_MODEL: "openrouter/auto", GOOGLE_CLIENT_ID: "google-client-id" });
  // UAT still sets its own OpenRouter site header through its tier variables.
  assert.equal(tiers.uat.deployVariables.OPENROUTER_SITE_URL, "https://uat.ilovelearningguide.com");
  assert.equal(tiers.uat.disabledKeyPattern, undefined);
});
