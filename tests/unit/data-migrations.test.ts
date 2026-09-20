import assert from "node:assert/strict";
import { test } from "node:test";
import { applyDataMigrations } from "../../services/dataMigrations";
import type { ProductData, ProductUser } from "../../services/productStore";
import type { DataMigration } from "../../db/data-migrations/types";

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
  apply(current) {
    if (current.paymentSettings.name === "Learning Guide Stripe") {
      return [{ action: "skip", kind: "paymentSettings", id: "paymentSettings", reason: "current" }];
    }
    current.paymentSettings.name = "Learning Guide Stripe";
    return [{ action: "update", kind: "paymentSettings", id: "paymentSettings" }];
  },
};

test("data migrations can update non-course fields and leave users in place", () => {
  const current = data();
  const report = applyDataMigrations(current, [backfillSettings]);
  assert.deepEqual(report.applied, ["002_backfill_payment_name"]);
  assert.equal(current.paymentSettings.name, "Learning Guide Stripe");
  assert.deepEqual(current.users.map((item) => item.id), ["user-keep"]);
  assert.deepEqual(current.dataMigrations, ["002_backfill_payment_name"]);
});

test("data migrations record both dataMigrations and legacy catalogueMigrations ids", () => {
  const current = data();
  applyDataMigrations(current, [backfillSettings]);
  applyDataMigrations(current, [backfillSettings]);
  assert.deepEqual(current.dataMigrations, ["002_backfill_payment_name"]);
  assert.equal(current.catalogueMigrations?.includes("002_backfill_payment_name"), true);
});
