import { defineConfig } from "playwright/test";

const baseURL = process.env.LIVE_ORIGIN;
if (!baseURL) throw new Error("LIVE_ORIGIN is required for playwright.live.config.ts");

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: ["**/live-release.spec.ts"],
  workers: 1,
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL,
    browserName: "chromium",
    extraHTTPHeaders: { "cache-control": "no-cache" }
  }
});
