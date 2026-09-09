import "./scripts/register-tsconfig-paths.cjs";
import { defineConfig } from "playwright/test";

// fileStore captures cwd on import. Separate projects give each suite its own
// worker/module cache and temporary product store.
// @/ must resolve from the product root even after tests chdir.
export default defineConfig({
  testDir: "./tests/integration",
  workers: 1,
  projects: [
    { name: "email-google", testMatch: "email-verification.spec.ts" },
    { name: "wechat", testMatch: "wechat-login.spec.ts" },
    { name: "ks-01-unauth", testMatch: "KS-01-unauth-api.spec.ts" },
  ],
});
