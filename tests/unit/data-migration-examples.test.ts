import assert from "node:assert/strict";
import { test } from "node:test";
import { applyOrmMigrations, createMemoryOrm } from "../../services/dataMigrations";
import { stoicismCourse } from "../../db/data-migrations/001_add_stoicism";
import type { ProductAccount, ProductCourse, ProductSession, ProductToken, ProductUser } from "../../services/productStore";
import * as addCourse from "../../db/data-migrations/examples/add-published-course";
import * as addLesson from "../../db/data-migrations/examples/add-lesson-to-course";
import * as patchPortal from "../../db/data-migrations/examples/patch-portal-banner-if-empty";
import * as addWiki from "../../db/data-migrations/examples/add-wiki-page";
import * as backfillSettings from "../../db/data-migrations/examples/backfill-payment-settings";
import * as promoteUser from "../../db/data-migrations/examples/promote-user-role";
import * as seedOperator from "../../db/data-migrations/examples/seed-dev-operator";
import * as bindSocial from "../../db/data-migrations/examples/bind-social-account";
import * as verifyEmail from "../../db/data-migrations/examples/verify-user-email";
import * as forceLogout from "../../db/data-migrations/examples/force-logout-user";
import * as expireTokens from "../../db/data-migrations/examples/expire-stale-reset-tokens";
import * as addQuintusHoratiusFlaccus from "../../db/data-migrations/003_add_quintus_horatius_flaccus";

function qaTeacher(overrides: Partial<ProductUser> = {}): ProductUser {
  return {
    id: "user-qa-teacher",
    email: "qa.teacher@example.test",
    passwordHash: null,
    nickname: "QA Teacher",
    locale: "en-GB",
    role: "student",
    status: "pending",
    emailVerifiedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

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

test("003 adds Quintus Horatius Flaccus once", async () => {
  const orm = createMemoryOrm();
  const first = await applyOrmMigrations(orm, [addQuintusHoratiusFlaccus], { store: "memory" });
  const second = await applyOrmMigrations(orm, [addQuintusHoratiusFlaccus], { store: "memory" });
  const course = orm.table<ProductCourse>("courses").findById("quintus-horatius-flaccus");
  assert.equal(course?.title, "Quintus Horatius Flaccus");
  assert.equal(course?.sections.length, 2);
  assert.deepEqual(first.applied, [addQuintusHoratiusFlaccus.id]);
  assert.deepEqual(second.applied, []);
  assert.equal(orm.table<ProductUser>("users").all().length, 0);
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

test("example G promotes one existing email and skips when already teacher", async () => {
  const orm = createMemoryOrm({ tables: { users: [qaTeacher()] } });
  const first = await applyOrmMigrations(orm, [promoteUser], { store: "memory" });
  const second = await applyOrmMigrations(orm, [promoteUser], { store: "memory" });
  assert.deepEqual(first.applied, [promoteUser.id]);
  assert.equal(orm.table<ProductUser>("users").findById("user-qa-teacher")?.role, "teacher");
  assert.deepEqual(second.applied, []);
});

test("example H seeds a DEV operator with Google and no password", async () => {
  const orm = createMemoryOrm();
  const first = await applyOrmMigrations(orm, [seedOperator], { store: "memory" });
  const second = await applyOrmMigrations(orm, [seedOperator], { store: "memory" });
  const user = orm.table<ProductUser>("users").findById("user-dev-operator");
  const account = orm.table<ProductAccount>("accounts").findById("account-dev-operator-google");
  assert.deepEqual(first.applied, [seedOperator.id]);
  assert.equal(user?.role, "operator");
  assert.equal(user?.passwordHash, null);
  assert.equal(account?.provider, "google");
  assert.deepEqual(second.applied, []);
});

test("example I binds WeChat to an existing user and does not create a second user", async () => {
  const orm = createMemoryOrm({ tables: { users: [qaTeacher({ status: "active", emailVerifiedAt: "2026-01-01T00:00:00.000Z" })] } });
  const first = await applyOrmMigrations(orm, [bindSocial], { store: "memory" });
  const second = await applyOrmMigrations(orm, [bindSocial], { store: "memory" });
  assert.deepEqual(first.applied, [bindSocial.id]);
  assert.equal(orm.table("users").all().length, 1);
  assert.equal(orm.table<ProductAccount>("accounts").findById("account-qa-teacher-wechat")?.userId, "user-qa-teacher");
  assert.deepEqual(second.applied, []);
});

test("example J verifies a pending email", async () => {
  const orm = createMemoryOrm({ tables: { users: [qaTeacher()] } });
  const first = await applyOrmMigrations(orm, [verifyEmail], { store: "memory" });
  const user = orm.table<ProductUser>("users").findById("user-qa-teacher");
  assert.deepEqual(first.applied, [verifyEmail.id]);
  assert.equal(user?.status, "active");
  assert.ok(user?.emailVerifiedAt);
});

test("example K expires live sessions for one user", async () => {
  const liveSession: ProductSession = { id: "session-live", tokenHash: "hash", userId: "user-qa-teacher", expiresAt: "2099-01-01T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z" };
  const orm = createMemoryOrm({
    tables: {
      users: [qaTeacher({ status: "active", emailVerifiedAt: "2026-01-01T00:00:00.000Z" })],
      sessions: [liveSession],
    },
  });
  const first = await applyOrmMigrations(orm, [forceLogout], { store: "memory" });
  const session = orm.table<ProductSession>("sessions").findById("session-live");
  assert.deepEqual(first.applied, [forceLogout.id]);
  assert.ok(session);
  assert.notEqual(session.expiresAt, "2099-01-01T00:00:00.000Z");
});

test("example L marks leftover password-reset tokens used", async () => {
  const leftover: ProductToken = { id: "reset-1", userId: "user-qa-teacher", tokenHash: "hash", expiresAt: "2099-01-01T00:00:00.000Z", usedAt: null, createdAt: "2026-01-01T00:00:00.000Z" };
  const orm = createMemoryOrm({
    tables: {
      passwordResetTokens: [leftover],
    },
  });
  const first = await applyOrmMigrations(orm, [expireTokens], { store: "memory" });
  const token = orm.table<ProductToken>("passwordResetTokens").findById("reset-1");
  assert.deepEqual(first.applied, [expireTokens.id]);
  assert.ok(token?.usedAt);
});
