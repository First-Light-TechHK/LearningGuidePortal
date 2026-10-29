import { test } from "node:test";
import assert from "node:assert/strict";
import { localResetPreviewAllowed, emailVerificationRequired, runtimeConfiguration, publicAppOrigin } from "../../services/runtimeConfig";

test("SIT requires genuine providers and never exposes password-reset links", () => {
  const previous = { ...process.env };
  try {
    process.env.APP_ENV = "SIT";
    process.env.STORAGE_BACKEND = "local";
    process.env.EMAIL_VERIFICATION_REQUIRED = "0";
    process.env.LOCAL_SOCIAL_LOGIN = "1";
    process.env.PAYMENT_MODE = "demo";
    process.env.NEXT_PUBLIC_APP_URL = "https://sit.ilovelearningguide.com";
    assert.equal(localResetPreviewAllowed(new Request("http://localhost/reset")), false);
    assert.equal(emailVerificationRequired(), true);
    assert.equal(runtimeConfiguration().ready, false);
    assert.equal(publicAppOrigin(new Request("https://attacker.invalid/reset")), "https://sit.ilovelearningguide.com");
  } finally { process.env = previous; }
});

test("reset preview is confined to explicit local DEV over loopback HTTP", () => {
  const previous = { ...process.env };
  try {
    process.env.APP_ENV = "DEV";
    process.env.STORAGE_BACKEND = "local";
    assert.equal(localResetPreviewAllowed(new Request("http://127.0.0.1/reset")), true);
    assert.equal(localResetPreviewAllowed(new Request("https://www.ilovelearningguide.com/reset")), false);
    process.env.STORAGE_BACKEND = "postgresql";
    assert.equal(localResetPreviewAllowed(new Request("http://localhost/reset")), false);
  } finally { process.env = previous; }
});

/**
 * 2026-10-28：邮件投递只走 SMTP（services/emailService.ts），但健康检查曾把
 * 未被使用的 SES_FROM_EMAIL 当作"邮件已配置"，于是在没有 SMTP 凭据时依然
 * 报 authentication.email=configured、ready=true，实际每封信都发不出去。
 */
test("health only reports email configured when the SMTP transport has credentials", () => {
  const previous = { ...process.env };
  try {
    process.env.APP_ENV = "SIT";
    process.env.NEXT_PUBLIC_APP_URL = "https://sit.ilovelearningguide.com";
    process.env.EMAIL_VERIFICATION_REQUIRED = "1";
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;

    // A dead SES sender must not satisfy the mail readiness check.
    process.env.SES_FROM_EMAIL = "noreply@ilovelearningguide.com";
    const withoutSmtp = runtimeConfiguration();
    assert.equal(withoutSmtp.authentication.email, "missing");
    assert.ok(withoutSmtp.missing.some((item) => item.includes("SMTP_HOST")));

    // The real transport configuration is what satisfies it.
    process.env.SMTP_HOST = "smtp.163.com";
    process.env.SMTP_USER = "sender@example.test";
    process.env.SMTP_PASS = "test-only";
    const withSmtp = runtimeConfiguration();
    assert.equal(withSmtp.authentication.email, "configured");
    assert.equal(withSmtp.missing.some((item) => item.includes("SMTP_HOST")), false);

    // A partial SMTP trio is still incomplete.
    delete process.env.SMTP_PASS;
    assert.equal(runtimeConfiguration().authentication.email, "missing");
  } finally { process.env = previous; }
});
