import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

// Break: treating APP_ENV=PRODUCTION (or NODE_ENV=production with that
// APP_ENV) as non-production would leave local social stubs and resetUrl on
// (AUTH-03 / API-AUTH-002).

const originalAppEnv = process.env.APP_ENV;
const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  if (originalAppEnv === undefined) delete process.env.APP_ENV;
  else process.env.APP_ENV = originalAppEnv;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
});

async function loadConfig() {
  return import("../../services/runtimeConfig.ts");
}

test("AUTH-03: APP_ENV=PRODUCTION is a production environment", async () => {
  process.env.NODE_ENV = "production";
  process.env.APP_ENV = "PRODUCTION";
  const { isProductionEnvironment, appEnvironment } = await loadConfig();
  assert.equal(appEnvironment(), "PRODUCTION");
  assert.equal(isProductionEnvironment(), true);
});

test("AUTH-03: APP_ENV=PROD remains production", async () => {
  process.env.APP_ENV = "PROD";
  const { isProductionEnvironment } = await loadConfig();
  assert.equal(isProductionEnvironment(), true);
});

test("AUTH-03: APP_ENV=DEV is not production", async () => {
  process.env.APP_ENV = "DEV";
  const { isProductionEnvironment } = await loadConfig();
  assert.equal(isProductionEnvironment(), false);
});
