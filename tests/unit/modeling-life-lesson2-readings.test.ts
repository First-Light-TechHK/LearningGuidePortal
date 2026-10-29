import assert from "node:assert/strict";
import { test } from "node:test";
import { modelingLifeCourse } from "../../db/data-migrations/008_upgrade_modeling_life";
import * as migration from "../../db/data-migrations/018_add_modeling_life_lesson2_readings";
import { applyOrmMigrations, applyOrmMigrationsWithPlan, assertMigrationRegistry, createMemoryOrm } from "../../services/dataMigrations";
import type { ProductCourse } from "../../services/productStore";
import { courseExploration } from "../../lib/lessonResources";

const ctx = { store: "memory" as const, dryRun: true, now: "2026-10-29T05:00:00.000Z" };
const lesson2 = (course: ProductCourse) => course.sections.flatMap(section => section.lessons).find(lesson => lesson.id === "modeling-life-lesson-2")!;

test("018 copies three Lesson 1 readings to Lesson 2 with consecutive equal-length ranges and preserves all unrelated data", async () => {
  assertMigrationRegistry();
  const course = modelingLifeCourse(ctx.now), before = structuredClone(course);
  const protectedNames = ["users", "orders", "subscriptions", "entitlements", "studyRecords", "studyEvents", "lesson_assessments"];
  const orm = createMemoryOrm({ tables: { courses: [course, { ...structuredClone(course), id: "other-course", slug: "other-course" }],
    ...Object.fromEntries(protectedNames.map(name => [name, [{ id: `keep-${name}` }]])) } });
  const protectedSnapshots = protectedNames.map(name => [name, orm.snapshot(name)]);
  const other = structuredClone(orm.table<ProductCourse>("courses").findById("other-course"));
  const { report, plan } = await applyOrmMigrationsWithPlan(orm, [migration], ctx);
  assert.deepEqual(report.applied, [migration.id]);
  assert.equal(plan.productTouched, true);
  assert.equal(report.objects, 0);
  assert.deepEqual(migration.touches, ["courses"]);
  const saved = orm.table<ProductCourse>("courses").findById(course.id)!;
  const readings = lesson2(saved).exploration!.readings;
  assert.deepEqual(readings.map(reading => reading.title), [
    "Garfinkel, Shevtsov, Guo: Modeling Life, pp 24 – 31.",
    "MIT Open Courseware, Feeedback and Control Systems, State Space: Linear Systems, lectures 14-18.",
    "Wikipedia, State Space Representation.",
  ]);
  for (let index = 0; index < 3; index++) {
    assert.deepEqual(readings[index], { ...before.sections[0].lessons[0].exploration!.readings[index], id: `modeling-life-l2-reading-${index + 1}`, lessonNumber: "02", title: readings[index].title });
  }
  const restored = structuredClone(saved); restored.updatedAt = before.updatedAt; lesson2(restored).exploration = lesson2(before).exploration;
  assert.deepEqual(restored, before);
  assert.deepEqual(orm.table<ProductCourse>("courses").findById("other-course"), other);
  for (const [name, snapshot] of protectedSnapshots) assert.equal(orm.snapshot(name), snapshot);
  const display = courseExploration(saved)!;
  assert.equal(display.readings.length, 6);
  assert.equal(new Set(display.readings.map(reading => reading.id)).size, 6);
  assert.deepEqual(display.readings.map(reading => reading.lessonNumber), ["01", "01", "01", "02", "02", "02"]);
  assert.equal(display.exhibits.length, 2);
  const snapshot = orm.snapshot("courses");
  assert.equal(migration.apply(orm, ctx)[0].reason, "readings-exist");
  assert.equal(orm.snapshot("courses"), snapshot);
  assert.deepEqual((await applyOrmMigrations(orm, [migration], ctx)).applied, []);
});

test("018 preserves authored Lesson 2 readings and exhibits and never recreates missing targets", () => {
  assert.equal(migration.apply(createMemoryOrm(), ctx)[0].reason, "missing");
  const missing = modelingLifeCourse(ctx.now); missing.sections[0].lessons.pop();
  assert.equal(migration.apply(createMemoryOrm({ tables: { courses: [missing] } }), ctx)[0].reason, "missing");
  const course = modelingLifeCourse(ctx.now), second = lesson2(course);
  second.exploration!.readings = [{ ...course.sections[0].lessons[0].exploration!.readings[0], id: "operator-reading", lessonNumber: "02", title: "Operator's reading" }];
  const orm = createMemoryOrm({ tables: { courses: [course] } }), snapshot = orm.snapshot("courses");
  assert.equal(migration.apply(orm, ctx)[0].reason, "readings-exist");
  assert.equal(orm.snapshot("courses"), snapshot);
  second.exploration!.readings = [];
  second.exploration!.exhibits = structuredClone(course.sections[0].lessons[0].exploration!.exhibits);
  const withExhibits = createMemoryOrm({ tables: { courses: [course] } });
  migration.apply(withExhibits, ctx);
  assert.deepEqual(lesson2(withExhibits.table<ProductCourse>("courses").findById(course.id)!).exploration!.exhibits, second.exploration!.exhibits);
});

test("018 refuses conflicting identities or changed source ranges before writing", () => {
  for (const conflict of ["slug", "target", "source", "reading", "pages", "lectures"] as const) {
    const course = modelingLifeCourse(ctx.now), first = course.sections[0].lessons[0];
    if (conflict === "slug") course.slug = "other";
    if (conflict === "target") course.sections[0].lessons.push(structuredClone(lesson2(course)));
    if (conflict === "source") course.sections[0].lessons.push(structuredClone(first));
    if (conflict === "reading") first.exploration!.readings.pop();
    if (conflict === "pages") first.exploration!.readings[0].title = "Edited page range";
    if (conflict === "lectures") first.exploration!.readings[1].title = "Edited lecture range";
    const orm = createMemoryOrm({ tables: { courses: [course] } }), snapshot = orm.snapshot("courses");
    assert.throws(() => migration.apply(orm, ctx), /conflict|ambiguous|source.*changed/);
    assert.equal(orm.snapshot("courses"), snapshot);
  }
});
