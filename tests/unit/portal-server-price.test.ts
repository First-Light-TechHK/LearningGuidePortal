import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const originalCwd = process.cwd();
const originalStorageBackend = process.env.STORAGE_BACKEND;
let isolatedCwd: string;
let store: typeof import("../../services/productStore");

before(async () => {
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-portal-price-"));
  process.chdir(isolatedCwd);
  process.env.STORAGE_BACKEND = "local";
  store = await import("../../services/productStore");
});

after(async () => {
  process.chdir(originalCwd);
  if (originalStorageBackend === undefined) delete process.env.STORAGE_BACKEND;
  else process.env.STORAGE_BACKEND = originalStorageBackend;
  if (isolatedCwd && path.dirname(isolatedCwd) === tmpdir()) {
    await rm(isolatedCwd, { recursive: true, force: true });
  }
});

test("GET-equivalent listPlans amounts come from the store catalogue, not a client field", async () => {
  const plans = await store.listPlans();
  const course = plans.find((plan) => plan.id === "epicureanism-pc-6");
  const everything = plans.find((plan) => plan.id === "everything-pc-6");
  assert.ok(course);
  assert.ok(everything);
  assert.equal(course.amountMinor, 4900);
  assert.equal(everything.amountMinor, 9900);
  assert.equal(course.currency, "usd");
  assert.equal(everything.currency, "usd");
});

test("pricing page reads server listPlans and PricingPlans only formats plan.amountMinor", async () => {
  const page = await readFile(path.join(repoRoot, "app/[locale]/pricing/page.tsx"), "utf8");
  const widget = await readFile(path.join(repoRoot, "components/portal/PricingPlans.tsx"), "utf8");
  assert.match(page, /listPlans\(/);
  assert.match(page, /<PricingPlans/);
  assert.doesNotMatch(page, /amountMinor:\s*\d+/);
  assert.match(widget, /plan\.amountMinor/);
  assert.match(widget, /amountMinor \/ 100/);
  assert.doesNotMatch(widget, /fetch\(["'`]\/api\/purchase\/quote/);
  assert.doesNotMatch(widget, /amountMinor:\s*9900/);
});
