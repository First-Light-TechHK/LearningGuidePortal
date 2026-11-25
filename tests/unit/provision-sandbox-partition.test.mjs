// Regression lock for Sandbox open-all (owner 2026-11-24): Sandbox is no longer a
// course-only partition. AI Tutor, Helpdesk, Study Group/LiveKit and catalogue-pull
// variables are allowed through exactly like SIT/UAT; a value the source does not
// provide is skipped (the feature degrades) and no key is ever fabricated. The
// exception is environment-specific *_BASE_URL values: Sandbox pins them to its own
// origins and never inherits UAT/SIT addresses. Importing the provisioner must not
// touch AWS: every AWS/Stripe action lives in runProvisioner(), which the main guard
// never calls from the test runner.
import test from "node:test";
import assert from "node:assert/strict";
import { credentialCopyKeysFor, deployVariablesFor, keyDisabledFor, tiers } from "../../scripts/provision-uat.mjs";

const NOW_ALLOWED = [
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

test("sandbox tier no longer disables AI/Helpdesk keys and keeps only its own isolation", () => {
  const sandbox = tiers.sandbox;
  // No disabled-key pattern: the old course-only partition is gone.
  assert.equal(sandbox.disabledKeyPattern, undefined);
  // The Admin token is the course catalogue projection credential (Admin AUTH_TOKEN
  // pairing, provisioning request §3.3), and KS_TUTOR_API_KEY reuses the same Admin
  // Sandbox secret for the learner runtime (/api/user/** X-API-Key == AUTH_TOKEN).
  assert.deepEqual(sandbox.sharedSecrets, {
    ADMIN_PORTAL_API_TOKEN: "learning-guide/admin/sandbox/admin_api_key",
    KS_TUTOR_API_KEY: "learning-guide/admin/sandbox/admin_api_key"
  });
  // Sandbox serves its own Admin host, advertises its own origin to OpenRouter and
  // pins every environment-specific base URL to a Sandbox origin. OPENROUTER_SITE_URL
  // is a header, not a key: it cannot enable AI.
  assert.deepEqual(Object.keys(sandbox.deployVariables).sort(), [
    "ADMIN_HELPDESK_BASE_URL",
    "ADMIN_HOSTS",
    "ADMIN_PORTAL_BASE_URL",
    "KS_TUTOR_BASE_URL",
    "OPENROUTER_SITE_URL",
    "PORTAL_COURSE_SOURCE",
    "PORTAL_HELPDESK_BASE_URL",
    "PORTAL_NOTIFICATIONS_BASE_URL",
    "PORTAL_STUDENTS_BASE_URL"
  ]);
  // Only Sandbox consumes Admin's read-only course projection; every other tier
  // stays on the local `store` default.
  assert.equal(sandbox.deployVariables.PORTAL_COURSE_SOURCE, "admin");
  assert.equal(sandbox.deployVariables.OPENROUTER_SITE_URL, "https://sandbox.ilovelearningguide.com");
  for (const key of ["ADMIN_PORTAL_BASE_URL", "KS_TUTOR_BASE_URL", "ADMIN_HELPDESK_BASE_URL"]) {
    assert.equal(sandbox.deployVariables[key], "https://admin.sandbox.ilovelearningguide.com", `${key} must point at the Sandbox Admin`);
  }
  for (const key of ["PORTAL_HELPDESK_BASE_URL", "PORTAL_STUDENTS_BASE_URL", "PORTAL_NOTIFICATIONS_BASE_URL"]) {
    assert.equal(sandbox.deployVariables[key], "https://sandbox.ilovelearningguide.com", `${key} must point at the Sandbox Portal`);
  }
  for (const key of NOW_ALLOWED) {
    assert.equal(keyDisabledFor(sandbox, key), false, `${key} must not be disabled for Sandbox`);
  }
  for (const key of COURSE_CHAIN_KEYS) {
    assert.equal(keyDisabledFor(sandbox, key), false, `${key} belongs to the course chain and must stay allowed`);
  }
});

test("source UAT AI/Helpdesk variables reach the Sandbox; base URLs never inherit UAT", () => {
  const source = {
    APP_ENV: "UAT",
    APP_VERSION: "abc123",
    NEXT_PUBLIC_APP_URL: "https://uat.ilovelearningguide.com",
    OPENROUTER_API_KEY: "copy-me-not",
    OPENROUTER_SITE_URL: "https://uat.ilovelearningguide.com",
    OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
    OPENROUTER_MODEL: "openrouter/auto",
    KS_TUTOR_BASE_URL: "https://admin.uat.ilovelearningguide.com",
    KS_TUTOR_TIMEOUT_MS: "60000",
    ADMIN_HELPDESK_BASE_URL: "https://admin.uat.ilovelearningguide.com",
    PORTAL_HELPDESK_BASE_URL: "https://uat.ilovelearningguide.com",
    PORTAL_STUDENTS_BASE_URL: "https://uat.ilovelearningguide.com",
    PORTAL_NOTIFICATIONS_BASE_URL: "https://uat.ilovelearningguide.com",
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
  const copied = deployVariablesFor(tiers.sandbox, source);
  // Non-secret AI/Helpdesk/Study Group variables are copied like UAT/SIT. The one
  // exception is every environment-specific *_BASE_URL: the Sandbox tier owns those,
  // so none of the UAT addresses above may survive the copy.
  assert.deepEqual(Object.keys(copied).sort(), [
    "ADMIN_HOSTS",
    "GOOGLE_CLIENT_ID",
    "KS_TUTOR_TIMEOUT_MS",
    "LIVEKIT_PROJECTS_JSON",
    "OPENROUTER_MODEL",
    "SMTP_HOST",
    "STRIPE_PRICE_EVERYTHING_YEAR"
  ]);
  // Mirror runProvisioner's final merge: the tier table supplies Sandbox addresses.
  const sandbox = { ...copied, ...tiers.sandbox.deployVariables };
  assert.equal(sandbox.KS_TUTOR_BASE_URL, "https://admin.sandbox.ilovelearningguide.com");
  assert.equal(sandbox.ADMIN_HELPDESK_BASE_URL, "https://admin.sandbox.ilovelearningguide.com");
  assert.equal(sandbox.ADMIN_PORTAL_BASE_URL, "https://admin.sandbox.ilovelearningguide.com");
  assert.equal(sandbox.PORTAL_HELPDESK_BASE_URL, "https://sandbox.ilovelearningguide.com");
  assert.equal(sandbox.PORTAL_STUDENTS_BASE_URL, "https://sandbox.ilovelearningguide.com");
  assert.equal(sandbox.PORTAL_NOTIFICATIONS_BASE_URL, "https://sandbox.ilovelearningguide.com");
  // Portal does not read OPENROUTER_BASE_URL (the client hardcodes the API URL), and
  // the value is environment-independent; dropping it proves no *_BASE_URL is inherited.
  assert.equal(sandbox.OPENROUTER_BASE_URL, undefined);
  for (const [key, value] of Object.entries(sandbox)) {
    if (key.endsWith("_BASE_URL")) {
      assert.match(value, /^https:\/\/(admin\.)?sandbox\.ilovelearningguide\.com$/, `${key} must stay on a Sandbox host`);
    }
  }
  assert.equal(JSON.stringify(sandbox).includes("uat.ilovelearningguide.com"), false, "no UAT address may reach Sandbox");
  // Secret/fixed values never travel as plain deployment variables. (OPENROUTER_SITE_URL
  // appears in the final map only because the Sandbox tier sets its own header.)
  assert.equal(sandbox.OPENROUTER_SITE_URL, "https://sandbox.ilovelearningguide.com");
  for (const key of ["OPENROUTER_API_KEY", "OPENROUTER_SITE_URL", "PORTAL_HELPDESK_TOKEN", "PORTAL_INTEGRATION_TOKEN", "STUDY_GROUP_TOKEN_LOG_KEY", "SESSION_SECRET", "DATABASE_URL"]) {
    assert.equal(key in copied, false, `${key} must not be copied from the source as a plain variable`);
  }
});

test("source credential copies include the AI key for Sandbox and are unchanged for UAT", () => {
  const expected = [
    "GOOGLE_CLIENT_SECRET",
    "WECHAT_APP_ID",
    "WECHAT_APP_SECRET",
    "OPENROUTER_API_KEY",
    "STRIPE_SECRET_KEY",
    "SMTP_PASS",
    "DOCUMENTS_AWS_ACCESS_KEY_ID",
    "DOCUMENTS_AWS_SECRET_ACCESS_KEY"
  ];
  // Sandbox now copies the same credential set as UAT, including the OpenRouter key
  // (reused from learning-guide/sandbox/* when pre-created, otherwise copied from the
  // source; if absent the key is skipped and the AI Tutor degrades).
  assert.deepEqual(credentialCopyKeysFor(tiers.sandbox), expected);
  assert.deepEqual(credentialCopyKeysFor(tiers.uat), expected);
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
