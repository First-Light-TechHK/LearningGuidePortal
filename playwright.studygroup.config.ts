import "./scripts/register-tsconfig-paths.cjs";
import { defineConfig } from "playwright/test";

const port = 3013;
const baseURL = `http://127.0.0.1:${port}`;

const sessionSecret = "e2e-session-secret-at-least-32-chars!!";

// Dual mode for the Study Group two-browser E2E:
//   local (default): docker livekit-server + nginx TLS terminator on 7443.
//   cloud (opt-in):  set STUDYGROUP_E2E_LIVEKIT_URL/KEY/SECRET (all three) to a
//   real LiveKit project; the docker/nginx webServers are then skipped and the
//   Next dev server talks to that project via the DEV-only local credential
//   resolver. Cloud values are read from process.env only and never written to
//   disk. Export the three variables (or source a local, git-ignored env file)
//   before running npm run test:e2e:studygroup.
const cloudUrl = process.env.STUDYGROUP_E2E_LIVEKIT_URL?.trim();
const cloudKey = process.env.STUDYGROUP_E2E_LIVEKIT_KEY?.trim();
const cloudSecret = process.env.STUDYGROUP_E2E_LIVEKIT_SECRET?.trim();
const useCloud = Boolean(cloudUrl && cloudKey && cloudSecret);

const livekitProjects = useCloud
  ? [{ id: "e2e-cloud", url: cloudUrl!.replace(/^https:/, "wss:"), state: "active", credentialSecretId: "e2e/cloud" }]
  : [{ id: "local-test", url: "wss://127.0.0.1:7443", state: "active", credentialSecretId: "local/test" }];
const livekitCredentials = useCloud
  ? { "e2e/cloud": { apiKey: cloudKey, apiSecret: cloudSecret } }
  : { "local/test": { apiKey: "devkey", apiSecret: "devsecret-devsecret-devsecret-32" } };

const nextEnv = {
  APP_ENV: "DEV",
  PAYMENT_MODE: "demo",
  LOCAL_SOCIAL_LOGIN: "1",
  STORAGE_BACKEND: "local",
  EMAIL_VERIFICATION_REQUIRED: "0",
  SESSION_SECRET: sessionSecret,
  APP_VERSION: "e2e",
  // In DEV the default admin hosts include localhost/127.0.0.1 (services/adminHost.ts),
  // which 307-redirects every non-backoffice API POST on this origin to
  // /en-GB/backoffice. Pin the admin hosts to the real admin domains so the
  // product APIs are reachable during the E2E.
  ADMIN_HOSTS: "admin.ilovelearningguide.com,admin.sit.ilovelearningguide.com",
  LIVEKIT_PROJECTS_JSON: JSON.stringify(livekitProjects),
  LIVEKIT_LOCAL_CREDENTIALS_JSON: JSON.stringify(livekitCredentials),
  STUDY_GROUP_TOKEN_LOG_KEY: Buffer.alloc(32, 11).toString("base64"),
  STUDY_GROUP_TUTOR_KEYS: JSON.stringify([{ id: "mock", secret: "mock-tutor-secret-0123456789abcdef" }]),
  STUDY_GROUP_TUTOR_URL: "http://127.0.0.1:8788/v1/chat/completions",
  // The room Tutor goes through KnowledgeSystem (services/ksTutorClient.ts);
  // the same local mock serves KS's tutor list and chat stream.
  KS_TUTOR_BASE_URL: "http://127.0.0.1:8788",
  KS_TUTOR_API_KEY: "mock-ks-key",
  // Reminder and notification mail goes to the local sink
  // (scripts/studygroup-smtp-sink.mjs) so the QA regression spec can read it.
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: "2525",
  SMTP_SECURE: "0",
  SMTP_USER: "e2e",
  SMTP_PASS: "e2e",
  SMTP_FROM: "study-groups@example.com",
  ...(useCloud ? {} : { NODE_EXTRA_CA_CERTS: "/tmp/lg-livekit-certs/cert.pem" }),
};

export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  timeout: 240_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL,
    browserName: "chromium",
    // New headless (full Chromium, not the headless shell): getDisplayMedia
    // exists there, which the screen-share leg probes.
    channel: "chromium",
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
    launchOptions: {
      args: [
        "--use-fake-ui-for-media-stream",
        // A fake microphone and camera: the QA regression spec publishes
        // real remote audio (the autoplay check) on machines with no devices.
        "--use-fake-device-for-media-stream",
        "--auto-select-desktop-capture-source=Entire screen",
      ],
    },
  },
  webServer: [
    {
      command: "node scripts/studygroup-tutor-mock.mjs",
      url: "http://127.0.0.1:8788/health",
      reuseExistingServer: true,
      timeout: 15_000,
      stdout: "pipe",
    },
    {
      command: "node scripts/studygroup-smtp-sink.mjs",
      url: "http://127.0.0.1:8789/health",
      reuseExistingServer: true,
      timeout: 15_000,
      stdout: "pipe",
    },
    ...(useCloud
      ? []
      : [
          {
            command: "bash scripts/studygroup-livekit-local.sh",
            url: "https://127.0.0.1:7443/",
            ignoreHTTPSErrors: true,
            reuseExistingServer: true,
            timeout: 60_000,
            gracefulShutdown: { signal: "SIGTERM" as const, timeout: 10_000 },
          },
        ]),
    {
      command: `npx next dev --hostname 127.0.0.1 -p ${port}`,
      url: `${baseURL}/api/health`,
      reuseExistingServer: true,
      timeout: 180_000,
      env: nextEnv,
    },
  ],
  projects: [
    {
      name: "studygroup-local",
      testMatch: ["**/study-group-*.spec.ts"],
    },
  ],
});
