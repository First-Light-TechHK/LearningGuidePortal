import { defineConfig } from "playwright/test";
export default defineConfig({ testDir: "./tests/integration", testMatch: "stripe-payment.spec.ts", workers: 1 });
