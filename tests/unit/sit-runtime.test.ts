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
