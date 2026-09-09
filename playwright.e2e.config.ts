import "./scripts/register-tsconfig-paths.cjs";
import { defineConfig } from "playwright/test";

const ci = Boolean(process.env.CI);
const port = ci ? 8080 : Number(process.env.E2E_PORT || 3012);
const baseURL = `http://127.0.0.1:${port}`;
const sessionSecret = "e2e-session-secret-at-least-32-chars!!";

const localEnv = {
  APP_ENV: "DEV",
  PAYMENT_MODE: "demo",
  LOCAL_SOCIAL_LOGIN: "1",
  STORAGE_BACKEND: "local",
  EMAIL_VERIFICATION_REQUIRED: "0",
  SESSION_SECRET: sessionSecret,
  APP_VERSION: "e2e",
};

const ciEnv = {
  NODE_ENV: "production",
  APP_ENV: "PROD",
  PAYMENT_MODE: "stripe",
  LOCAL_SOCIAL_LOGIN: "0",
  STORAGE_BACKEND: "local",
  SESSION_SECRET: sessionSecret,
  APP_VERSION: "e2e",
  HOSTNAME: "127.0.0.1",
  PORT: String(port),
  NEXT_PUBLIC_APP_URL: "https://e2e.local.test",
};

const chromium = { use: { browserName: "chromium" as const } };

export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL,
    browserName: "chromium",
  },
  webServer: {
    command: ci
      ? `npm run start -- -p ${port}`
      : `npx next dev --hostname 127.0.0.1 -p ${port}`,
    url: ci ? `${baseURL}/en-GB/portal` : `${baseURL}/api/health`,
    reuseExistingServer: !ci,
    timeout: 180_000,
    env: ci ? ciEnv : localEnv,
  },
  projects: [
    {
      name: "e2e-cloud",
      ...chromium,
      testMatch: [
        "**/E2E-B1-visitor-auth.spec.ts",
        "**/E2E-B1-negative.spec.ts",
        "**/PAY-stripe.skip.spec.ts",
      ],
    },
    ...(!ci
      ? [
          {
            name: "e2e-local-demo",
            ...chromium,
            testMatch: ["**/E2E-B1-purchase-learn.spec.ts"],
          },
        ]
      : []),
  ],
});
