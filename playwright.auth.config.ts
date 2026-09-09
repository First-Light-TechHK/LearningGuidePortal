import { defineConfig } from "playwright/test";

// fileStore captures cwd on import. Separate projects give each suite its own
// worker/module cache and temporary product store.
export default defineConfig({
  testDir: "./tests/integration",
  workers: 1,
  projects: [
    { name: "email-google", testMatch: "email-verification.spec.ts" },
    { name: "wechat", testMatch: "wechat-login.spec.ts" },
  ],
});
