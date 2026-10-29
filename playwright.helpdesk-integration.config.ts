// Local-only cross-app Helpdesk check (tests/e2e/helpdesk-integration.spec.ts).
// It starts nothing: the Portal dev server, the BackOffice server and its Vite
// client must already be running and wired together (docs/phase1/helpdesk-tickets.md §14).
import "./scripts/register-tsconfig-paths.cjs";
import { defineConfig } from "playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: ["**/helpdesk-integration.spec.ts"],
  workers: 1,
  timeout: 240_000,
  use: {
    baseURL: process.env.HELPDESK_INT_PORTAL_URL || "http://127.0.0.1:3012",
    browserName: "chromium"
  }
});
