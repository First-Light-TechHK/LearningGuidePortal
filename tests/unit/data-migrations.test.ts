import assert from "node:assert/strict";
import { test } from "node:test";
import { applyDataMigrations, assertMigrationRegistry, shouldPersistDataMigrationsOnBoot, validateDataMigrations } from "../../services/dataMigrations";
import { dataMigrations } from "../../db/data-migrations";
import type { DataMigration } from "../../db/data-migrations/types";
import type { ProductData, ProductUser } from "../../services/productStore";

function user(): ProductUser {
  return {
    id: "user-keep",
    email: "keep@example.test",
    passwordHash: "x",
    nickname: "Keep",
    locale: "en-GB",
    role: "student",
    status: "active",
    emailVerifiedAt: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function data(): ProductData {
  return {
    version: 1,
    users: [user()],
    sessions: [],
    courses: [],
    plans: [],
    quotes: [],
    orders: [],
    subscriptions: [],
    entitlements: [],
    studyRecords: [],
    studyEvents: [],
    conversations: [],
    notifications: [],
    stripeEvents: [],
    verificationTokens: [],
    passwordResetTokens: [],
    emailBindingTokens: [],
    paymentSettings: { provider: "stripe", name: "Stripe", publishableKey: "", returnUrl: "/", defaultCurrency: "usd", paymentNotifications: false, updatedAt: null },
    orderActivities: [],
    accounts: [],
  };
}

const backfillSettings: DataMigration = {
  id: "002_backfill_payment_name",
  description: "Example non-course data migration.",
  touches: ["paymentSettings"],
  apply(current) {
    if (current.paymentSettings.name === "Learning Guide Stripe") {
      return [{ action: "skip", kind: "paymentSettings", id: "paymentSettings", reason: "current" }];
    }
    current.paymentSettings.name = "Learning Guide Stripe";
    return [{ action: "update", kind: "paymentSettings", id: "paymentSettings" }];
  },
};

test("data migrations can update non-course fields and leave users in place", async () => {
  const current = data();
  const report = await applyDataMigrations(current, [backfillSettings]);
  assert.deepEqual(report.applied, ["002_backfill_payment_name"]);
  assert.equal(current.paymentSettings.name, "Learning Guide Stripe");
  assert.deepEqual(current.users.map((item) => item.id), ["user-keep"]);
  assert.deepEqual(current.dataMigrations, ["002_backfill_payment_name"]);
});

test("data migrations record both dataMigrations and legacy catalogueMigrations ids", async () => {
  const current = data();
  await applyDataMigrations(current, [backfillSettings]);
  await applyDataMigrations(current, [backfillSettings]);
  assert.deepEqual(current.dataMigrations, ["002_backfill_payment_name"]);
  assert.equal(current.catalogueMigrations?.includes("002_backfill_payment_name"), true);
});

test("data migrations reject undeclared user or order writes", async () => {
  const leak: DataMigration = {
    id: "003_leak_users",
    description: "Must fail.",
    touches: ["courses"],
    apply(current) {
      current.users.push({ ...current.users[0], id: "user-leaked", email: "leaked@example.test" });
      return [{ action: "update", kind: "users", id: "user-leaked" }];
    },
  };
  await assert.rejects(() => applyDataMigrations(data(), [leak]), /changed users without declaring touches/);
});

test("data migrations require a numbered id and touches", () => {
  assert.throws(() => validateDataMigrations([{ id: "stoicism", description: "bad", touches: ["courses"], apply: () => [] }]), /Invalid data migration id/);
  assert.throws(() => validateDataMigrations([
    { id: "002_a", description: "one", touches: ["courses"], apply: () => [] },
    { id: "002_a", description: "two", touches: ["courses"], apply: () => [] },
  ]), /Duplicate data migration id/);
});

test("registered numbered files match db/data-migrations/index.ts", () => {
  assertMigrationRegistry(dataMigrations);
});

test("boot persist is DEV and SIT only, never main/PROD", () => {
  assert.equal(shouldPersistDataMigrationsOnBoot({ APP_ENV: "DEV" }), true);
  assert.equal(shouldPersistDataMigrationsOnBoot({ APP_ENV: "SIT" }), true);
  assert.equal(shouldPersistDataMigrationsOnBoot({ APP_ENV: "PROD" }), false);
  assert.equal(shouldPersistDataMigrationsOnBoot({ APP_ENV: "UAT" }), false);
  assert.equal(shouldPersistDataMigrationsOnBoot({}), false);
});
