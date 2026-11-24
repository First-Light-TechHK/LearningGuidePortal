import { test } from "node:test";
import assert from "node:assert/strict";
import { subscriptionPrices } from "../../contracts/payment";
import {
  emailVerificationRequired,
  isManagedEnvironment,
  publicAppOrigin,
  runtimeConfiguration,
  secureAuthCookie
} from "../../services/runtimeConfig";

/**
 * Sandbox（PRD v2.0 §3.1）是与 UAT 同码的独立部署，不是本地开发环境。
 * 它必须按 managed 环境对待：否则 APP_ENV=SANDBOX 时 /api/health 不做 DB/S3
 * 依赖检查、不强制 HTTPS/会话密钥，Stripe 测试密钥也无人校验，健康检查可以
 * “假绿”。本文件锁定这三类语义。
 */
const controlledKeys = [
  "APP_ENV",
  "NEXT_PUBLIC_APP_URL",
  "LOCAL_SOCIAL_LOGIN",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "WECHAT_APP_ID",
  "WECHAT_APP_SECRET",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_SANDBOX",
  "DATABASE_URL",
  "DATA_S3_BUCKET",
  "STORAGE_BACKEND",
  "SMTP_HOST",
  "SMTP_USER",
  "SMTP_PASS",
  "OPENROUTER_API_KEY",
  "SESSION_SECRET",
  "PAYMENT_MODE",
  "EMAIL_VERIFICATION_REQUIRED",
  "SES_FROM_EMAIL",
  ...subscriptionPrices.map((price) => price.env)
];

function withEnvironment(values: Record<string, string>, run: () => void) {
  const previous = { ...process.env };
  try {
    for (const key of controlledKeys) delete process.env[key];
    Object.assign(process.env, values);
    run();
  } finally {
    process.env = previous;
  }
}

function sandboxConfiguration(): Record<string, string> {
  return {
    APP_ENV: "SANDBOX",
    NEXT_PUBLIC_APP_URL: "https://sandbox.ilovelearningguide.com",
    LOCAL_SOCIAL_LOGIN: "0",
    SESSION_SECRET: "s".repeat(48),
    DATABASE_URL: "postgresql://lg_sandbox_app:test@database.internal:5432/learning_guide_sandbox",
    DATA_S3_BUCKET: "learning-guide-sandbox-851987565851",
    STORAGE_BACKEND: "postgresql",
    PAYMENT_MODE: "stripe",
    STRIPE_SANDBOX: "1",
    STRIPE_SECRET_KEY: "sk_test_example",
    STRIPE_WEBHOOK_SECRET: "whsec_example",
    GOOGLE_CLIENT_ID: "google-client-id",
    GOOGLE_CLIENT_SECRET: "google-client-secret",
    WECHAT_APP_ID: "wechat-app-id",
    WECHAT_APP_SECRET: "wechat-app-secret",
    EMAIL_VERIFICATION_REQUIRED: "1",
    SMTP_HOST: "smtp.example.test",
    SMTP_USER: "sender@example.test",
    SMTP_PASS: "test-only",
    ...Object.fromEntries(subscriptionPrices.map((price) => [price.env, `price_${price.id}`]))
  };
}

test("SANDBOX is managed: HTTPS, session and verification checks cannot be skipped", () => {
  withEnvironment({ APP_ENV: "SANDBOX", EMAIL_VERIFICATION_REQUIRED: "0" }, () => {
    assert.equal(isManagedEnvironment(), true);
    const configuration = runtimeConfiguration();
    assert.equal(configuration.managed, true);
    // Managed is not the same thing as the production flag: Sandbox still reports false.
    assert.equal(configuration.production, false);

    // EMAIL_VERIFICATION_REQUIRED=0 must not switch verification off on a real deployment.
    assert.equal(emailVerificationRequired(), true);

    // Loopback HTTP must still receive a secure cookie outside DEV.
    assert.equal(secureAuthCookie(new Request("http://localhost:8080/portal/sign-in")), true);

    // Server redirects must not fall back to the request host when the public URL is missing.
    assert.throws(
      () => publicAppOrigin(new Request("https://attacker.invalid/portal")),
      /NEXT_PUBLIC_APP_URL is required/
    );

    const missing = configuration.missing;
    for (const item of [
      "NEXT_PUBLIC_APP_URL",
      "LOCAL_SOCIAL_LOGIN=0",
      "SESSION_SECRET (at least 32 characters)",
      "DATABASE_URL + DATA_S3_BUCKET (and STORAGE_BACKEND must not be local)",
      "PAYMENT_MODE=stripe",
      "GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET",
      "WECHAT_APP_ID + WECHAT_APP_SECRET",
      "SMTP_HOST + SMTP_USER + SMTP_PASS"
    ]) {
      assert.ok(missing.includes(item), `missing ${JSON.stringify(item)} in ${JSON.stringify(missing)}`);
    }

    // Sandbox open-all (owner 2026-11-24): AI config is allowed but optional. A
    // missing OpenRouter key degrades the AI Tutor; it must not gate readiness,
    // because /api/health is App Runner's health check and ops installs keys later.
    assert.equal(missing.includes("OPENROUTER_API_KEY"), false, JSON.stringify(missing));
  });
});

test("SANDBOX refuses non-test Stripe configuration (no false green)", () => {
  withEnvironment({ APP_ENV: "SANDBOX", PAYMENT_MODE: "stripe", STRIPE_SECRET_KEY: "sk_live_real" }, () => {
    const missing = runtimeConfiguration().missing;
    assert.ok(missing.includes("Stripe sandbox test credentials"), JSON.stringify(missing));
  });

  withEnvironment({ APP_ENV: "SANDBOX", STRIPE_SANDBOX: "1" }, () => {
    const missing = runtimeConfiguration().missing;
    assert.ok(
      missing.includes("Stripe sandbox test credentials"),
      "a missing secret key cannot pass as a Stripe test key"
    );
  });

  withEnvironment({ APP_ENV: "SANDBOX", STRIPE_SANDBOX: "1", STRIPE_SECRET_KEY: "sk_test_example" }, () => {
    const missing = runtimeConfiguration().missing;
    assert.equal(missing.includes("Stripe sandbox test credentials"), false, JSON.stringify(missing));
  });
});

test("a fully configured SANDBOX reports ready with every managed requirement present", () => {
  withEnvironment(sandboxConfiguration(), () => {
    const configuration = runtimeConfiguration();
    assert.deepEqual(configuration.missing, []);
    assert.equal(configuration.ready, true);
    assert.equal(configuration.environment, "SANDBOX");
    assert.equal(configuration.managed, true);
    assert.equal(configuration.storage, "postgresql+s3");
    assert.equal(configuration.payment.configured, true);
    // Ready without OpenRouter: AI/Helpdesk config is optional in Sandbox, so the
    // AI Tutor is reported as absent (degraded), not as a readiness failure.
    assert.equal(configuration.aiTutor, "missing");
    assert.equal(runtimeConfiguration().missing.includes("OPENROUTER_API_KEY"), false);
  });
});

test("SANDBOX uses the AI Tutor configuration when it is provided, like SIT/UAT", () => {
  withEnvironment({ ...sandboxConfiguration(), OPENROUTER_API_KEY: "sk-or-test-only" }, () => {
    const configuration = runtimeConfiguration();
    assert.equal(configuration.aiTutor, "configured");
    assert.equal(configuration.ready, true);
    assert.equal(configuration.missing.includes("OPENROUTER_API_KEY"), false);
  });
});

test("other managed environments still require OpenRouter", () => {
  withEnvironment({ APP_ENV: "UAT" }, () => {
    const configuration = runtimeConfiguration();
    assert.equal(configuration.managed, true);
    assert.ok(
      configuration.missing.includes("OPENROUTER_API_KEY"),
      "Sandbox's optional AI config must not waive the requirement for UAT/SIT/PROD"
    );
  });
});
