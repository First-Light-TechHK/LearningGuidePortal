import assert from "node:assert/strict";
import { test } from "node:test";
import { applyCatalogueMigrations, exportCatalogueSlice } from "../../services/catalogueMigrations";
import type { ProductCourse, ProductData, ProductUser } from "../../services/productStore";

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

function course(id: string, title = id): ProductCourse {
  return {
    id,
    slug: id,
    title,
    description: `${title} description`,
    category: "European Humanities",
    thumbnailPath: null,
    status: "published",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    sections: [{ id: `${id}-s`, title: "One", lessons: [{ id: `${id}-l`, title: "Public", durationMinutes: 10, isPublic: true, body: "Body" }] }],
  };
}

function data(courses: ProductCourse[]): ProductData {
  return {
    version: 1,
    users: [user()],
    sessions: [{ id: "s1", tokenHash: "hash", userId: "user-keep", expiresAt: "2099-01-01T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z" }],
    courses,
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

test("catalogue migrations add a missing published sibling course and leave users alone", async () => {
  const current = data([course("epicureanism", "Epicureanism")]);
  const report = await applyCatalogueMigrations(current);
  assert.equal(report.applied.includes("001_add_stoicism"), true);
  assert.equal(current.courses.some((item) => item.id === "stoicism" && item.status === "published"), true);
  assert.equal(current.courses.some((item) => item.id === "epicureanism"), true);
  assert.deepEqual(current.users.map((item) => item.id), ["user-keep"]);
  assert.equal(current.sessions.length, 1);
  assert.equal(current.orders.length, 0);
});

test("catalogue migrations are idempotent and do not overwrite an existing course", async () => {
  const current = data([course("epicureanism"), course("stoicism", "Operator Stoicism")]);
  const first = await applyCatalogueMigrations(current);
  const second = await applyCatalogueMigrations(current);
  assert.equal(current.courses.filter((item) => item.id === "stoicism").length, 1);
  assert.equal(current.courses.find((item) => item.id === "stoicism")?.title, "Operator Stoicism");
  assert.equal(first.changes.some((item) => item.id === "stoicism" && item.action === "skip"), true);
  assert.deepEqual(second.applied, []);
});

test("catalogue export is courses and portal content only", () => {
  const current = data([course("epicureanism")]);
  current.portalContent = { banners: { "en-GB": [], "zh-CN": [] }, categories: [], countries: [], supportUrl: "https://example.test" };
  const pack = exportCatalogueSlice(current);
  assert.deepEqual(Object.keys(pack).sort(), ["catalogueMigrations", "courses", "portalContent", "version"]);
  assert.equal("users" in pack, false);
  assert.equal("orders" in pack, false);
  assert.equal(pack.courses[0].id, "epicureanism");
});
