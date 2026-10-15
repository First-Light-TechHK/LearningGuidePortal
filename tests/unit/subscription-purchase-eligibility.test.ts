import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PaymentError } from "../../contracts/payment";
import { paymentFailure } from "../../services/paymentHttp";
import { writeProductData, verifiedUser } from "./helpers/my-learning";

const cwd = process.cwd(), environment = { ...process.env };
let directory: string;
let store: typeof import("../../services/productStore");
before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "lg-purchase-eligibility-"));
  process.chdir(directory);
  Object.assign(process.env, { STORAGE_BACKEND: "local", APP_ENV: "DEV", PAYMENT_MODE: "demo" });
  store = await import("../../services/productStore");
});
after(async () => {
  process.chdir(cwd); process.env = environment;
  if (directory && path.dirname(directory) === tmpdir()) await rm(directory, { recursive: true, force: true });
});
const duplicate = (error: unknown) => error instanceof PaymentError && error.code === "already_subscribed";
async function buy(userId: string, planId: string) {
  const { quote } = await store.createQuote(userId, planId);
  return store.completeDemoCheckout(userId, quote.id);
}

test("same course blocks both terms, different course is purchasable, stale orders fail and paid retries are idempotent", async () => {
  const data = await store.ensureProductData();
  const base = data.plans.find(plan => plan.id === "epicureanism-pc-6")!;
  data.plans.push({ ...base, id: "other-pc-12", courseId: "other", scopeId: "other", termMonths: 12 });
  await writeProductData(data);
  const stale = await store.createQuote("course-buyer", "epicureanism-pc-12");
  const pending = await store.createPendingDemoOrder("course-buyer", stale.quote.id);
  const paid = await buy("course-buyer", base.id);
  await assert.rejects(() => store.createPendingDemoTrialOrder("course-buyer", base.id), duplicate);
  await assert.rejects(() => store.activateTrial("course-buyer", "epicureanism"), duplicate);
  const before = await store.ensureProductData();
  for (const term of [6, 12]) await assert.rejects(() => store.createQuote("course-buyer", `epicureanism-pc-${term}`), duplicate);
  await assert.rejects(() => store.createPendingDemoOrder("course-buyer", stale.quote.id), duplicate);
  await assert.rejects(() => store.completeDemoOrder("course-buyer", pending.order.id), duplicate);
  await assert.rejects(() => store.createPendingStripeOrder("course-buyer", stale.quote.id), duplicate);
  assert.equal((await store.completeDemoOrder("course-buyer", paid.order.id)).order.id, paid.order.id);
  const after = await store.ensureProductData();
  assert.equal(after.subscriptions.length, before.subscriptions.length);
  assert.equal(after.orders.find(order => order.id === pending.order.id)?.status, "pending");
  const plans = await store.listPlansForPurchase("course-buyer");
  assert.ok(plans.filter(plan => plan.courseId === "epicureanism").every(plan => plan.alreadySubscribed));
  assert.equal(plans.find(plan => plan.id === "other-pc-12")?.alreadySubscribed, false);
  await buy("course-buyer", "other-pc-12");
  assert.ok((await store.listPlansForPurchase("course-buyer")).find(plan => plan.id === "other-pc-12")?.alreadySubscribed);
  assert.ok((await store.listPlansForPurchase()).every(plan => !plan.alreadySubscribed));
});

test("two owned categories are blocked across terms while third category and explicit upgrade stay available", async () => {
  await buy("category-buyer", "european-humanities-pc-6");
  await buy("category-buyer", "science-pc-12");
  const plans = await store.listPlansForPurchase("category-buyer");
  for (const category of ["european-humanities", "science"]) {
    for (const term of [6, 12]) {
      assert.equal(plans.find(plan => plan.id === `${category}-pc-${term}`)?.alreadySubscribed, true);
      await assert.rejects(() => store.createQuote("category-buyer", `${category}-pc-${term}`), duplicate);
    }
  }
  await assert.rejects(() => store.createQuote("category-buyer", "epicureanism-pc-12"), duplicate);
  await store.createQuote("category-buyer", "chinese-humanities-pc-12");
  const data = await store.ensureProductData();
  const source = data.subscriptions.find(item => item.userId === "category-buyer" && item.scopeId === "European Humanities")!;
  assert.equal((await store.createUpgradeQuote("category-buyer", source.id)).quote.kind, "upgrade");
});

test("Everything blocks covered plans; expiry, cancelled renewal, grace and user isolation use server state", async () => {
  await buy("everything-buyer", "everything-pc-6");
  const plans = await store.listPlansForPurchase("everything-buyer");
  assert.ok(plans.filter(plan => plan.device === "pc").every(plan => plan.alreadySubscribed));
  await assert.rejects(() => store.createQuote("everything-buyer", "science-pc-12"), duplicate);
  await store.createQuote("unrelated-buyer", "science-pc-12");
  const data = await store.ensureProductData();
  const owned = data.subscriptions.find(item => item.userId === "everything-buyer")!;
  owned.state = "cancel_at_period_end";
  await writeProductData(data);
  await assert.rejects(() => store.createQuote("everything-buyer", "everything-pc-12"), duplicate);
  owned.state = "grace"; owned.validTo = new Date(Date.now() - 1000).toISOString();
  owned.graceEndsAt = new Date(Date.now() + 60_000).toISOString();
  await writeProductData(data);
  await assert.rejects(() => store.createQuote("everything-buyer", "everything-pc-12"), duplicate);
  owned.state = "expired";
  await writeProductData(data);
  await store.createQuote("everything-buyer", "everything-pc-12");
  assert.ok((await store.listPlansForPurchase("everything-buyer")).every(plan => !plan.alreadySubscribed));
});

test("Mobile Everything blocks every Category term and stale checkout", async () => {
  const userId = "mobile-everything-buyer";
  const stale = await store.createQuote(userId, "science-pc-12");
  await buy(userId, "everything-mobile-6");
  const categories = (await store.listPlansForPurchase(userId)).filter(plan => plan.scope === "category");
  assert.ok(categories.length > 0);
  for (const plan of categories) {
    assert.equal(plan.alreadySubscribed, true);
    await assert.rejects(() => store.createQuote(userId, plan.id), duplicate);
  }
  await assert.rejects(() => store.createPendingDemoOrder(userId, stale.quote.id), duplicate);
  await assert.rejects(() => store.createPendingStripeOrder(userId, stale.quote.id), duplicate);
});

test("plans API returns session-specific Everything coverage without public caching", async () => {
  const user = await verifiedUser(store, "everything-api@example.test", "API Student");
  await buy(user.id, "everything-mobile-6");
  const { token } = await store.createSession(user.id);
  const { GET } = await import("../../app/api/portal/plans/route");
  const response = await GET(new Request("http://localhost/api/portal/plans", { headers: { cookie: `learning_guide_session=${token}` } }));
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(response.headers.get("Vary"), "Cookie");
  const body = await response.json();
  const categories = body.plans.filter((plan: { scope: string }) => plan.scope === "category");
  assert.ok(categories.length > 0);
  assert.ok(categories.every((plan: { alreadySubscribed: boolean }) => plan.alreadySubscribed));
  const anonymous = await (await GET(new Request("http://localhost/api/portal/plans"))).json();
  assert.ok(anonymous.plans.every((plan: { alreadySubscribed: boolean }) => !plan.alreadySubscribed));
});

test("duplicate purchase API error is a localised client failure", async () => {
  for (const locale of ["en-GB", "zh-CN"] as const) {
    const response = paymentFailure(new PaymentError("already_subscribed"), locale);
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.code, "already_subscribed");
    assert.ok(body.message.includes(locale === "en-GB" ? "active subscription" : "有效订阅"));
  }
});
