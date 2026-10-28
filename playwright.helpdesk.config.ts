// Local-only Helpdesk learner browser check (tests/e2e/helpdesk-support.spec.ts).
// Kept apart from playwright.e2e.config.ts so the shared e2e run, and every
// spec it already covers, is unchanged. Starts its own DEV server on 3014 (the
// DEV-only local Helpdesk store) and the stub Admin (tests/e2e/helpdesk-admin-stub.mjs).
// All tokens are throwaway local test values (tests/e2e/helpdesk-e2e-env.ts).
import "./scripts/register-tsconfig-paths.cjs";
import { defineConfig } from "playwright/test";
import { HELPDESK_E2E, helpdeskAdminStubUrl, helpdeskE2eServerEnv } from "./tests/e2e/helpdesk-e2e-env";

const port = Number(process.env.E2E_HELPDESK_PORT || 3014);
const baseURL = `http://127.0.0.1:${port}`;

const env = {
  APP_ENV: "DEV",
  PAYMENT_MODE: "demo",
  LOCAL_SOCIAL_LOGIN: "1",
  STORAGE_BACKEND: "local",
  EMAIL_VERIFICATION_REQUIRED: "0",
  SESSION_SECRET: "e2e-session-secret-at-least-32-chars!!",
  APP_VERSION: "e2e",
  // In DEV, localhost / 127.0.0.1 count as BackOffice hosts unless ADMIN_HOSTS
  // says otherwise; learner pages need the learner site (as playwright.studygroup.config.ts).
  ADMIN_HOSTS: "admin.ilovelearningguide.com,admin.sit.ilovelearningguide.com",
  ...helpdeskE2eServerEnv(),
};

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: ["**/helpdesk-support.spec.ts"],
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL,
    browserName: "chromium",
  },
  webServer: [
    {
      command: `npx next dev --hostname 127.0.0.1 -p ${port}`,
      url: `${baseURL}/api/health`,
      reuseExistingServer: true,
      timeout: 180_000,
      env,
    },
    {
      // Stand-in for the BackOffice Helpdesk integration API (Common Questions, suggestions).
      command: `node tests/e2e/helpdesk-admin-stub.mjs ${HELPDESK_E2E.adminPort} ${HELPDESK_E2E.adminToken}`,
      url: `${helpdeskAdminStubUrl()}/__health`,
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
});
