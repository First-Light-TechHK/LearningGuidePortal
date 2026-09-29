import "./scripts/register-tsconfig-paths.cjs";
import { defineConfig } from "playwright/test";

const rawPort = 4311;
const renderPort = 4312;

const noAws = {
  APP_ENV: "DEV",
  PAYMENT_MODE: "demo",
  STORAGE_BACKEND: "local",
  EMAIL_VERIFICATION_REQUIRED: "0",
  LOCAL_SOCIAL_LOGIN: "0",
  ADMIN_HOSTS: "admin.example.test",
  SESSION_SECRET: "bug-lock-session-secret-32-characters",
  AWS_EC2_METADATA_DISABLED: "true",
  AWS_SHARED_CREDENTIALS_FILE: "/dev/null",
  AWS_CONFIG_FILE: "/dev/null",
  AWS_ACCESS_KEY_ID: "",
  AWS_SECRET_ACCESS_KEY: "",
  AWS_SESSION_TOKEN: "",
  AWS_PROFILE: "",
  AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: "",
  AWS_WEB_IDENTITY_TOKEN_FILE: "",
  AWS_ROLE_ARN: "",
};

export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  timeout: 120_000,
  webServer: [
    {
      command: `npx next dev --hostname 127.0.0.1 -p ${rawPort}`,
      url: `http://127.0.0.1:${rawPort}/api/health`,
      timeout: 240_000,
      reuseExistingServer: false,
      env: noAws,
    },
    {
      command: "node --import tsx --require ./scripts/register-tsconfig-paths.cjs tests/e2e/helpers/bug-lock-renderable-server.ts",
      url: `http://127.0.0.1:${renderPort}/api/health`,
      timeout: 240_000,
      reuseExistingServer: false,
      env: { ...noAws, BUG_LOCK_PORT: String(renderPort) },
    },
  ],
  projects: [
    {
      name: "raw-local",
      testMatch: "portal-bug-locks-http.spec.ts",
      use: { baseURL: `http://127.0.0.1:${rawPort}`, browserName: "chromium" },
    },
    {
      name: "rendered",
      testMatch: "portal-bug-locks-layout.spec.ts",
      use: { baseURL: `http://127.0.0.1:${renderPort}`, browserName: "chromium" },
    },
  ],
});
