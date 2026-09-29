import "./scripts/register-tsconfig-paths.cjs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { defineConfig } from "playwright/test";

// Browser lock for the sign-up mail state machine. Not part of test:ci or Verify.
// One server per invocation: AUTH_MAIL_E2E_MODE=discard (default) or fail.
// ADMIN_HOSTS is localhost so 127.0.0.1 stays on the portal host, not backoffice.
const mode = process.env.AUTH_MAIL_E2E_MODE === "fail" ? "fail" : "discard";
const port = Number(process.env.AUTH_MAIL_E2E_PORT || (mode === "fail" ? 3032 : 3031));
const baseURL = `http://127.0.0.1:${port}`;
const repo = process.cwd();
const dataDir = mkdtempSync(path.join(tmpdir(), `lg-auth-mail-${mode}-`));
const node = process.execPath;
// Keep the build one directory under the project so server chunks can resolve
// node_modules. A path outside the repo breaks those requires. The directory is gitignored.
const distDir = `.next-auth-mail-${mode}`;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/register-legal-transition.spec.ts",
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL,
    browserName: "chromium",
  },
  webServer: {
    command: `"${node}" "${path.join(repo, "node_modules/next/dist/bin/next")}" dev "${repo}" --hostname 127.0.0.1 -p ${port}`,
    cwd: dataDir,
    // /api/health stays 503 until SMTP or SES is set. Discard and fail are
    // delivery modes, not a transport, so readiness is the portal sign-up page.
    url: `${baseURL}/en-GB/portal/sign-up`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      ...process.env,
      APP_ENV: "DEV",
      PAYMENT_MODE: "demo",
      LOCAL_SOCIAL_LOGIN: "0",
      STORAGE_BACKEND: "local",
      EMAIL_VERIFICATION_REQUIRED: "1",
      EMAIL_DELIVERY: mode,
      ADMIN_HOSTS: "localhost",
      SESSION_SECRET: "e2e-session-secret-at-least-32-chars!!",
      APP_VERSION: "e2e-auth-mail",
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      NEXT_PUBLIC_APP_URL: baseURL,
      NEXT_DIST_DIR: distDir,
      NODE_OPTIONS: "--max-old-space-size=1536",
      SES_FROM_EMAIL: "",
      SMTP_HOST: "",
      SMTP_USER: "",
      SMTP_PASS: "",
      SMTP_FROM: "",
    },
  },
});
