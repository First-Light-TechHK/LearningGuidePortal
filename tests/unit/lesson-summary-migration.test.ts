import assert from "node:assert/strict";
import { test } from "node:test";
import { applyOrmMigrations, createMemoryOrm } from "../../services/dataMigrations";
import type { ProductCourse } from "../../services/productStore";
import * as horace from "../../db/data-migrations/003_add_quintus_horatius_flaccus";
import * as summaries from "../../db/data-migrations/005_backfill_lesson_summaries";

test("summary migration only fills confirmed metadata and is independently idempotent", async () => {
  const orm = createMemoryOrm();
  await applyOrmMigrations(orm, [horace], { store: "memory" });
  const before = structuredClone(orm.table<ProductCourse>("courses").all());
  await applyOrmMigrations(orm, [summaries], { store: "memory" });
  const saved = orm.table<ProductCourse>("courses").findById("quintus-horatius-flaccus")!;
  assert.equal(saved.sections[0].lessons[0].summary, "The legendary life of Horace from soldier to poet laureate");
  assert.equal(saved.sections[1].lessons[0].summary, undefined);
  assert.equal(saved.sections[0].lessons[0].body, before[0].sections[0].lessons[0].body);
  assert.deepEqual(saved.sections[1], before[0].sections[1]);
  assert.equal(summaries.apply(orm, { now: "2026-10-10T00:00:00.000Z", store: "memory", dryRun: false })[0].action, "skip");
  assert.deepEqual(orm.table("users").all(), []);
  assert.deepEqual(orm.table("orders").all(), []);
});

test("summary migration preserves author text and safely skips missing targets", async () => {
  const orm = createMemoryOrm();
  const ctx = { now: "2026-10-10T00:00:00.000Z", store: "memory" as const, dryRun: false };
  assert.equal(summaries.apply(orm, ctx)[0].reason, "missing");
  await applyOrmMigrations(orm, [horace], { store: "memory" });
  const courses = orm.table<ProductCourse>("courses");
  const course = courses.findById("quintus-horatius-flaccus")!;
  course.sections[0].lessons[0].summary = "Author introduction";
  courses.update(course.id, { sections: course.sections });
  assert.equal(summaries.apply(orm, ctx)[0].reason, "summary-exists");
  assert.equal(courses.findById(course.id)!.sections[0].lessons[0].summary, "Author introduction");
});
