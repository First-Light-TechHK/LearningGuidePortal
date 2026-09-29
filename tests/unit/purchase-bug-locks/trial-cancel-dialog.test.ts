import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { isolateProductStore, repoRoot, verifiedUser } from "./helpers";

// These locks stay outside tests/unit/*.test.ts so test:ci / Verify does not run them.
// They assert the correct product rule and fail while the trial-cancel dialog still lies.

const root = repoRoot();
let isolated: Awaited<ReturnType<typeof isolateProductStore>>;

before(async () => {
  isolated = await isolateProductStore();
});

after(async () => {
  await isolated.restore();
});

function readJson(name: string) {
  return JSON.parse(readFileSync(path.join(root, "messages", name), "utf8")) as {
    learning: { cancelDescription: string };
  };
}

test("BUG: trial cancel dialog says current access remains until the end of the period", () => {
  const source = readFileSync(path.join(root, "components/portal/SubscriptionManager.tsx"), "utf8");
  assert.match(source, /cancelTarget\.source === "trial" \? copy\.cancelDescription/);
  const lies = [
    ["en-GB learning.cancelDescription", readJson("en-GB.json").learning.cancelDescription],
    ["zh-CN learning.cancelDescription", readJson("zh-CN.json").learning.cancelDescription],
  ].filter(([, text]) => /remains available until the end of (this|the) period|access remains until the end|不会立即受到影响|当前周期内的访问权限不会立即/i.test(text));
  assert.deepEqual(lies, [], "trial cancel copy must not say access remains until the end of the period; cancelSubscription expires the trial immediately");
});

test("BUG: cancelling a course-scoped plan labels it Category", () => {
  const source = readFileSync(path.join(root, "components/portal/SubscriptionManager.tsx"), "utf8");
  const start = source.indexOf('className="cancel-plan-name"');
  assert.ok(start >= 0, "cancel dialog scope line is missing");
  const strong = source.slice(start, start + 500).match(/<strong>\{([\s\S]*?)\}<\/strong>/);
  assert.ok(strong, "cancel dialog scope label is missing");
  const label = new Function("cancelTarget", `return (${strong[1]});`) as (cancelTarget: { scope: string; plan?: { name: string } }) => string;
  const courseLabel = label({ scope: "course", plan: { name: "Epicureanism · PC · 6 months" } });
  assert.notEqual(courseLabel, "Category", `a course-scoped plan is labeled ${JSON.stringify(courseLabel)}; only a category plan may be labeled Category`);
});

test("cancelling a demo trial removes course access immediately", async () => {
  const { store } = isolated;
  const user = await verifiedUser(store, "trial-cancel-lock@example.test");
  const pending = await store.createPendingDemoTrialOrder(user.id, "epicureanism-pc-6");
  await store.completeDemoTrialOrder(user.id, pending.order.id);
  const beforeAccess = await store.checkEntitlement(user.id, "epicureanism");
  assert.equal(beforeAccess.allowed, true);
  assert.equal(beforeAccess.source, "trial");
  const trial = (await store.ensureProductData()).subscriptions.find((item) => item.userId === user.id && item.source === "trial" && item.planId === "epicureanism-pc-6");
  assert.ok(trial);
  await store.cancelSubscription(user.id, trial.id);
  const afterAccess = await store.checkEntitlement(user.id, "epicureanism");
  assert.equal(afterAccess.allowed, false);
  assert.equal(afterAccess.source, null);
});
