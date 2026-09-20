import assert from "node:assert/strict";
import { test } from "node:test";
import { applyOrmMigrations, createMemoryOrm } from "../../services/dataMigrations";
import { stoicismCourse } from "../../db/data-migrations/001_add_stoicism";
import type { ProductCourse } from "../../services/productStore";
import * as addCourse from "../../db/data-migrations/examples/add-published-course";
import * as addLesson from "../../db/data-migrations/examples/add-lesson-to-course";
import * as patchPortal from "../../db/data-migrations/examples/patch-portal-banner-if-empty";
import * as addWiki from "../../db/data-migrations/examples/add-wiki-page";
import * as backfillSettings from "../../db/data-migrations/examples/backfill-payment-settings";

test("example A adds a published course once", async () => {
  const orm = createMemoryOrm();
  const first = await applyOrmMigrations(orm, [addCourse], { store: "memory" });
  const second = await applyOrmMigrations(orm, [addCourse], { store: "memory" });
  assert.deepEqual(first.applied, [addCourse.id]);
  const course = orm.table<ProductCourse>("courses").findById("roman-history");
  assert.equal(course?.status, "published");
  assert.equal(course?.sections[0]?.lessons.some((lesson) => lesson.isPublic), true);
  assert.deepEqual(second.applied, []);
  assert.ok(first.sql >= 1);
  assert.equal(process.env.DATABASE_URL || "", "");
});

test("example B adds a lesson on an existing course and then skips", async () => {
  const orm = createMemoryOrm({ tables: { courses: [stoicismCourse("2026-01-01T00:00:00.000Z")] } });
  const first = await applyOrmMigrations(orm, [addLesson], { store: "memory" });
  const second = await applyOrmMigrations(orm, [addLesson], { store: "memory" });
  const course = orm.table<ProductCourse>("courses").findById("stoicism");
  assert.deepEqual(first.applied, [addLesson.id]);
  assert.equal(course?.sections.some((section) => section.lessons.some((lesson) => lesson.id === "daily-impressions-drill")), true);
  assert.deepEqual(second.applied, []);
});

test("example C patches portal support URL only when empty", async () => {
  const empty = createMemoryOrm({
    docs: { portalContent: { supportUrl: "", banners: { "en-GB": [], "zh-CN": [] }, categories: [], countries: [] } },
  });
  const filled = createMemoryOrm({
    docs: { portalContent: { supportUrl: "https://already.example", banners: { "en-GB": [], "zh-CN": [] }, categories: [], countries: [] } },
  });
  const wrote = await applyOrmMigrations(empty, [patchPortal], { store: "memory" });
  const skipped = await applyOrmMigrations(filled, [patchPortal], { store: "memory" });
  assert.deepEqual(wrote.applied, [patchPortal.id]);
  assert.equal(empty.doc<{ supportUrl: string }>("portalContent").get()?.supportUrl, "https://www.ilovelearningguide.com/support");
  assert.deepEqual(skipped.applied, []);
  assert.equal(filled.doc<{ supportUrl: string }>("portalContent").get()?.supportUrl, "https://already.example");
});

test("example D writes an extra table and a markdown file", async () => {
  const orm = createMemoryOrm();
  const first = await applyOrmMigrations(orm, [addWiki], { store: "memory" });
  const second = await applyOrmMigrations(orm, [addWiki], { store: "memory" });
  assert.deepEqual(first.applied, [addWiki.id]);
  assert.equal(orm.table<{ id: string; title: string }>("wiki_pages").findById("public-policy")?.title, "Public policy");
  assert.match(orm.files.readText("courses/economics/knowledge/public-policy/wiki/page.md") || "", /Public policy/);
  assert.deepEqual(second.applied, []);
  assert.ok(first.sql >= 2);
});

test("example E backfills paymentSettings without touching users", async () => {
  const orm = createMemoryOrm({
    tables: { users: [{ id: "user-keep" }] },
    docs: { paymentSettings: { name: "Stripe" } },
  });
  const first = await applyOrmMigrations(orm, [backfillSettings], { store: "memory" });
  assert.deepEqual(first.applied, [backfillSettings.id]);
  assert.equal(orm.doc<{ name: string }>("paymentSettings").get()?.name, "Learning Guide Stripe");
  assert.deepEqual(orm.table("users").all().map((row) => row.id), ["user-keep"]);
});
