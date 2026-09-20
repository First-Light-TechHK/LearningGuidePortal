import assert from "node:assert/strict";
import { test } from "node:test";
import { applyDataMigrations, applyOrmMigrations, assertMigrationRegistry, createMemoryOrm, shouldPersistDataMigrationsOnBoot, validateDataMigrations } from "../../services/dataMigrations";
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
  apply(orm) {
    const settings = orm.doc<{ name: string }>("paymentSettings");
    if (settings.get()?.name === "Learning Guide Stripe") {
      return [{ action: "skip", kind: "paymentSettings", id: "paymentSettings", reason: "current" }];
    }
    settings.patch({ name: "Learning Guide Stripe" });
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

test("data migrations reject undeclared extra-table writes", async () => {
  const leak: DataMigration = {
    id: "003_leak_wiki",
    description: "Must fail.",
    touches: ["courses"],
    apply(orm) {
      orm.table("wiki_pages").insert({ id: "leaked" });
      return [{ action: "update", kind: "wiki_pages", id: "leaked" }];
    },
  };
  await assert.rejects(() => applyDataMigrations(data(), [leak]), /non-product table without declaring touches: \["other"\]/);
});

test("data migrations reject undeclared user or order writes", async () => {
  const leak: DataMigration = {
    id: "003_leak_users",
    description: "Must fail.",
    touches: ["courses"],
    apply(orm) {
      orm.table("users").insert({ id: "user-leaked" });
      return [{ action: "update", kind: "users", id: "user-leaked" }];
    },
  };
  await assert.rejects(() => applyDataMigrations(data(), [leak]), /changed users without declaring touches/);
});

test("ORM migrations run in memory without a database and are not limited to product.json", async () => {
  const orm = createMemoryOrm();
  const wiki: DataMigration = {
    id: "004_add_wiki_page",
    description: "Seed a wiki page through the ORM.",
    touches: ["other", "files"],
    apply(store) {
      const pages = store.table<{ id: string; title: string }>("wiki_pages");
      if (pages.findById("public-policy")) return [{ action: "skip", kind: "wiki_pages", id: "public-policy", reason: "exists" }];
      pages.insert({ id: "public-policy", title: "Public policy" });
      store.files.writeText("courses/economics/knowledge/public-policy/wiki/page.md", "# Public policy\n");
      return [{ action: "add", kind: "wiki_pages", id: "public-policy" }];
    },
  };
  const first = await applyOrmMigrations(orm, [wiki], { store: "memory" });
  const second = await applyOrmMigrations(orm, [wiki], { store: "memory" });
  assert.deepEqual(first.applied, ["004_add_wiki_page"]);
  assert.equal(orm.table<{ id: string; title: string }>("wiki_pages").findById("public-policy")?.title, "Public policy");
  assert.match(orm.files.readText("courses/economics/knowledge/public-policy/wiki/page.md") || "", /Public policy/);
  assert.deepEqual(second.applied, []);
  assert.equal(process.env.DATABASE_URL || "", "");
});

test("aggregate persist keeps extra ORM tables and files without a database", async () => {
  const current = data();
  const wiki: DataMigration = {
    id: "005_persist_wiki",
    description: "Persist non-product rows on the live aggregate.",
    touches: ["other", "files"],
    apply(store) {
      const pages = store.table<{ id: string; title: string }>("wiki_pages");
      if (pages.findById("public-policy")) return [{ action: "skip", kind: "wiki_pages", id: "public-policy", reason: "exists" }];
      pages.insert({ id: "public-policy", title: "Public policy" });
      store.files.writeText("wiki/public-policy.md", "# Public policy\n");
      return [{ action: "add", kind: "wiki_pages", id: "public-policy" }];
    },
  };
  await applyDataMigrations(current, [wiki]);
  const extras = (current as ProductData & { ormExtras?: { tables: Record<string, Array<{ id: string }>>; files: Record<string, string> } }).ormExtras;
  assert.equal(extras?.tables.wiki_pages?.[0]?.id, "public-policy");
  assert.match(extras?.files["wiki/public-policy.md"] || "", /Public policy/);
  const replay = structuredClone(current);
  delete replay.dataMigrations;
  delete replay.catalogueMigrations;
  const second = await applyDataMigrations(replay, [wiki]);
  const replayExtras = (replay as ProductData & { ormExtras?: { tables: Record<string, Array<{ id: string }>> } }).ormExtras;
  assert.equal(replayExtras?.tables.wiki_pages.length, 1);
  assert.equal(second.changes.some((change) => change.action === "skip"), true);
  assert.deepEqual(second.applied, []);
  assert.equal(process.env.DATABASE_URL || "", "");
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
