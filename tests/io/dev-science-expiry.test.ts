import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { stop } from "esbuild";
import { isolate, setCookie, clearCookies, SESSION_COOKIE } from "./harness";
import { verifiedUser, readProductData, writeProductData } from "../unit/helpers/my-learning";
import { applyOrmMigrations, ormFromProductData } from "../../services/dataMigrations";
import type { DataMigrationContext } from "../../db/data-migrations/types";
import type { MigrationOrm } from "../../services/migrationOrm";
import * as migration from "../../db/data-migrations/014_shorten_dev_science_subscription";

test("shortened Science purchase expires at Shanghai midnight and paid renewal restores real API access", async t => {
  const { restore } = await isolate("lg-science-expiry-");
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-26T04:30:00Z") });
  try {
    process.env.DATA_S3_PREFIX = "learning-guide/dev";
    const store = await import("../../services/productStore");
    const user = await verifiedUser(store, "science-expiry@example.test");
    const { quote } = await store.createQuote(user.id, "science-pc-6");
    const purchased = await store.completeDemoCheckout(user.id, quote.id);
    const session = await store.createSession(user.id);
    const data = await readProductData();
    const subscription = data.subscriptions.find((row: { id: string }) => row.id === purchased.subscription.id);
    subscription.stripeSubscriptionId = "sub_expiry_fixture";
    // Exercise pending boot application over synthetic rows, without a DB/provider.
    for (const key of ["dataMigrations", "catalogueMigrations"] as const) data[key] = data[key]?.filter((id: string) => id !== migration.id);
    const targetHash = createHash("sha256").update(user.email!).digest("hex");
    const testMigration = { ...migration, apply: (orm: MigrationOrm, ctx: DataMigrationContext) => migration.applyForAccount(orm, ctx, targetHash) };
    await applyOrmMigrations(ormFromProductData(data), [testMigration], { store: "sql" }, data);
    await writeProductData(data);

    const course = (await store.listPublishedCourses()).find(row => row.category === "Science")!;
    assert.ok(course);
    const route = await import("../../app/api/entitlements/check/route");
    const request = () => new Request(`http://localhost/api/entitlements/check?courseId=${course.id}`);
    assert.equal((await route.GET(request())).status, 401);
    setCookie(SESSION_COOKIE, session.token);
    t.mock.timers.setTime(Date.parse(migration.validTo) - 1);
    assert.equal((await (await route.GET(request())).json()).entitlement.allowed, true);
    assert.equal((await store.checkEntitlement(user.id, course.id)).validTo, migration.validTo);
    t.mock.timers.setTime(Date.parse(migration.validTo));
    assert.equal((await (await route.GET(request())).json()).entitlement.allowed, false);
    assert.equal((await store.checkEntitlement(user.id, course.id)).allowed, false);
    await store.getLearningOverview(user.id);
    const expired = await readProductData();
    assert.equal(expired.subscriptions.find((row: { id: string }) => row.id === subscription.id).state, "expired");

    const event = { id: "evt_expiry_renewal", type: "invoice.paid", action: "invoice" as const,
      subscriptionId: "sub_expiry_fixture", invoiceId: "in_expiry_renewal", amountMinor: 4900,
      currency: "usd", periodStart: migration.validTo, periodEnd: "2027-04-26T16:00:00.000Z",
      status: "paid", subscriptionStatus: "active", billingReason: "subscription_cycle" };
    await store.applyVerifiedStripeEvent(event);
    assert.equal((await (await route.GET(request())).json()).entitlement.allowed, true);
    assert.equal((await store.checkEntitlement(user.id, course.id)).validTo, event.periodEnd);
    assert.equal((await store.applyVerifiedStripeEvent(event)).duplicate, true);
    const renewed = await readProductData();
    const replay = await applyOrmMigrations(ormFromProductData(renewed), [testMigration], { store: "sql" }, renewed);
    assert.deepEqual(replay.skipped, [migration.id]);
    assert.equal(renewed.subscriptions.find((row: { id: string }) => row.id === subscription.id).validTo, event.periodEnd);
    clearCookies();
  } finally {
    t.mock.timers.reset();
    await stop();
    await restore();
  }
});
