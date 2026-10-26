import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { applyOrmMigrationsWithPlan, createMemoryOrm } from "../../services/dataMigrations";
import type { ProductEntitlement, ProductPlan, ProductSubscription, ProductUser } from "../../services/productStore";
import * as migration from "../../db/data-migrations/014_shorten_dev_science_subscription";
import type { DataMigrationContext } from "../../db/data-migrations/types";

const email = "expiry-check@example.test";
const digest = createHash("sha256").update(email).digest("hex");
const originalEnd = "2027-04-26T04:30:00.000Z";
const ctx: DataMigrationContext = { store: "sql", dryRun: false, now: "2026-10-26T05:00:00.000Z" };

function fixture() {
  const user: ProductUser = { id: "buyer", email, passwordHash: null, nickname: "Expiry Test", locale: "en-GB", role: "student", status: "active", emailVerifiedAt: ctx.now, createdAt: ctx.now };
  const plan: ProductPlan = { id: "science-pc-6", name: "Science", courseId: "*", scope: "category", scopeId: "Science", device: "pc", termMonths: 6, amountMinor: 4900, currency: "usd" };
  const subscription: ProductSubscription = { id: "subscription-target", userId: user.id, planId: plan.id, courseId: "*", state: "active", source: "purchase", validFrom: "2026-10-26T04:30:00.000Z", validTo: originalEnd, cancelAtPeriodEnd: false, scope: "category", scopeId: "Science", device: "pc", stripeSubscriptionId: "sub_test", stripeCustomerId: "cus_test" };
  const entitlement: ProductEntitlement = { id: "entitlement-target", userId: user.id, courseId: "*", state: "active", source: "purchase", validTo: originalEnd, scope: "category", scopeId: "Science", device: "pc" };
  const order = { id: "paid-order", amountMinor: 4900, servicePeriodEnd: originalEnd };
  return createMemoryOrm({ tables: {
    users: [user, { ...user, id: "other", email: "other@example.test" }],
    plans: [plan], subscriptions: [subscription, { ...subscription, id: "other-subscription", userId: "other" }],
    entitlements: [entitlement, { ...entitlement, id: "other-entitlement", userId: "other" }],
    orders: [order],
    sessions: [{ id: "session-keep" }], studyRecords: [{ id: "history-keep" }],
  } });
}

test("DEV Science expiry migration is scoped, atomic and safe on deployment retry", async t => {
  const oldEnv = { APP_ENV: process.env.APP_ENV, DATA_S3_PREFIX: process.env.DATA_S3_PREFIX };
  Object.assign(process.env, { APP_ENV: "DEV", DATA_S3_PREFIX: "learning-guide/dev" });
  try {
    await t.test("updates only the paired dates; ledger preserves later renewal", async () => {
      const orm = fixture();
      const keep = ["users", "plans", "orders", "sessions", "studyRecords"].map(name => [name, orm.snapshot(name)]);
      const testMigration = { ...migration, apply: (target: typeof orm, context: DataMigrationContext) => migration.applyForAccount(target, context, digest) };
      const { report, plan } = await applyOrmMigrationsWithPlan(orm, [testMigration], ctx);
      assert.deepEqual(report.applied, [migration.id]);
      assert.equal(report.changes.filter(change => change.action === "update").length, 2);
      assert.equal(plan.productTouched, true);
      assert.equal(report.objects, 0);
      const subscription = orm.table<ProductSubscription>("subscriptions").findById("subscription-target")!;
      const entitlement = orm.table<ProductEntitlement>("entitlements").findById("entitlement-target")!;
      assert.equal(subscription.validTo, migration.validTo);
      assert.equal(entitlement.validTo, migration.validTo);
      assert.equal(subscription.state, "active");
      assert.equal(subscription.validFrom, "2026-10-26T04:30:00.000Z");
      assert.equal(subscription.stripeSubscriptionId, "sub_test");
      assert.equal(orm.table<ProductSubscription>("subscriptions").findById("other-subscription")!.validTo, originalEnd);
      assert.equal(orm.table<ProductEntitlement>("entitlements").findById("other-entitlement")!.validTo, originalEnd);
      for (const [name, before] of keep) assert.equal(orm.snapshot(name), before);
      assert.equal(migration.applyForAccount(orm, ctx, digest)[0].reason, "already-shortened");
      orm.table<ProductSubscription>("subscriptions").update(subscription.id, { validTo: originalEnd });
      orm.table<ProductEntitlement>("entitlements").update(entitlement.id, { validTo: originalEnd });
      const retry = await applyOrmMigrationsWithPlan(orm, [testMigration], ctx);
      assert.deepEqual(retry.report.skipped, [migration.id]);
      assert.equal(orm.table<ProductSubscription>("subscriptions").findById(subscription.id)!.validTo, originalEnd);
    });

    await t.test("non-DEV environments, wrong prefixes and local reads skip", () => {
      const orm = fixture(), before = orm.snapshot("subscriptions");
      for (const environment of ["SIT", "UAT", "PPE", "PROD", ""]) {
        process.env.APP_ENV = environment;
        assert.equal(migration.apply(orm, ctx)[0].reason, "dev-sql-only");
      }
      process.env.APP_ENV = "DEV";
      process.env.DATA_S3_PREFIX = "learning-guide/sit";
      assert.equal(migration.apply(orm, ctx)[0].reason, "dev-sql-only");
      process.env.DATA_S3_PREFIX = "learning-guide/dev";
      for (const store of ["memory", "aggregate"] as const) assert.equal(migration.apply(orm, { ...ctx, store })[0].reason, "dev-sql-only");
      assert.equal(orm.snapshot("subscriptions"), before);
    });

    await t.test("missing or ambiguous identity/entitlement fails before any write", () => {
      for (const fault of ["account", "subscription", "duplicate", "entitlement", "duplicate-entitlement", "revoked", "changed-period", "trial", "annual", "different-day", "different-category", "grace"] as const) {
        const orm = fixture();
        if (fault === "account") orm.table<ProductUser>("users").update("buyer", { email: "different@example.test" });
        if (fault === "subscription") orm.table<ProductSubscription>("subscriptions").update("subscription-target", { userId: "other" });
        if (fault === "duplicate") orm.table<ProductSubscription>("subscriptions").insert({ ...orm.table<ProductSubscription>("subscriptions").findById("subscription-target")!, id: "duplicate" });
        if (fault === "entitlement") orm.table<ProductEntitlement>("entitlements").update("entitlement-target", { validTo: "2027-01-01T00:00:00Z" });
        if (fault === "duplicate-entitlement") orm.table<ProductEntitlement>("entitlements").insert({ ...orm.table<ProductEntitlement>("entitlements").findById("entitlement-target")!, id: "duplicate" });
        if (fault === "revoked") orm.table<ProductEntitlement>("entitlements").update("entitlement-target", { state: "revoked" });
        if (fault === "changed-period") orm.table<ProductSubscription>("subscriptions").update("subscription-target", { validTo: "2027-10-26T04:30:00Z" });
        if (fault === "trial") orm.table<ProductSubscription>("subscriptions").update("subscription-target", { source: "trial" });
        if (fault === "annual") orm.table<ProductPlan>("plans").update("science-pc-6", { termMonths: 12 });
        if (fault === "different-day") orm.table<ProductSubscription>("subscriptions").update("subscription-target", { validFrom: "2026-10-26T16:00:00Z" });
        if (fault === "different-category") orm.table<ProductSubscription>("subscriptions").update("subscription-target", { scopeId: "European Humanities" });
        if (fault === "grace") orm.table<ProductSubscription>("subscriptions").update("subscription-target", { state: "grace", graceEndsAt: originalEnd });
        const before = [orm.snapshot("subscriptions"), orm.snapshot("entitlements")];
        assert.throws(() => migration.applyForAccount(orm, ctx, digest), new RegExp(migration.id), fault);
        assert.deepEqual([orm.snapshot("subscriptions"), orm.snapshot("entitlements")], before, fault);
      }
      assert.throws(() => migration.apply(fixture(), ctx), /target DEV account/);
    });

    await t.test("normalised email and Shanghai day boundaries are supported", () => {
      const orm = fixture();
      orm.table<ProductUser>("users").update("buyer", { email: ` ${email.toUpperCase()} ` });
      orm.table<ProductSubscription>("subscriptions").update("subscription-target", { validFrom: "2026-10-25T16:00:00Z" });
      assert.equal(migration.applyForAccount(orm, ctx, digest).length, 2);
    });
  } finally {
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
