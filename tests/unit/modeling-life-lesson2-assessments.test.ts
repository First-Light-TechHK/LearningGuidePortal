import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { applyOrmMigrations, applyOrmMigrationsWithPlan, assertMigrationRegistry, createMemoryOrm } from "../../services/dataMigrations";
import type { ProductCourse } from "../../services/productStore";
import { modelingLifeCourse } from "../../db/data-migrations/008_upgrade_modeling_life";
import * as migration from "../../db/data-migrations/015_add_modeling_life_lesson2_assessments";

const ctx = { store: "memory" as const, dryRun: true, now: "2026-10-26T12:00:00.000Z" };
const lessonId = "modeling-life-lesson-2";
const lesson2 = (course: ProductCourse) => course.sections.flatMap(section => section.lessons).find(lesson => lesson.id === lessonId)!;

test("Lesson 02 definitions preserve all eight source rows and the Application question/answer paragraphs", () => {
  const supplied = migration.modelingLifeLesson2Assessments();
  assert.equal(supplied.knowledge.length, 8);
  assert.deepEqual(supplied.knowledge.map(question => question.id), Array.from({ length: 8 }, (_, index) => `modeling-life-l2-knowledge-${index + 1}`));
  assert.equal(supplied.application!.id, "modeling-life-l2-application-1");
  assert.equal(supplied.application!.paragraphs.length, 6);
  assert.equal(supplied.application!.reference.length, 11);
  // Independently calculated from the workbook's C2:D9 and B2:C2 cell text.
  const canonical = { knowledge: supplied.knowledge.map(question => [question.prompt, question.referenceAnswer]), application: [supplied.application!.paragraphs.join("\n\n"), supplied.application!.reference.join("\n\n")] };
  assert.equal(createHash("sha256").update(JSON.stringify(canonical)).digest("hex"), "7eadc4e9dcda8d851e7cc61892d71c39474fd85b727c16f5bce65b27d12b2c1c");
  supplied.knowledge[0].prompt = "A caller's edit";
  assert.equal(migration.modelingLifeLesson2Assessments().knowledge[0].prompt, "What is a pitchfork bifurcation?");
});

test("registered ORM migration changes only Lesson 02 assessment definitions and is independently idempotent", async () => {
  assertMigrationRegistry();
  const course = modelingLifeCourse("2026-10-23T00:00:00.000Z");
  lesson2(course).title = "Operator's Lesson 02 title";
  const before = structuredClone(course);
  const orm = createMemoryOrm({ tables: { courses: [course, { ...structuredClone(course), id: "other-course", slug: "other-course" }],
    users: [{ id: "keep-user" }], orders: [{ id: "keep-order" }], subscriptions: [{ id: "keep-subscription" }], entitlements: [{ id: "keep-entitlement" }],
    sessions: [{ id: "keep-session" }], studyRecords: [{ id: "keep-study" }], studyEvents: [{ id: "keep-event" }], lesson_assessments: [{ id: "keep-answers" }],
  } });
  const protectedTables = ["users", "orders", "subscriptions", "entitlements", "sessions", "studyRecords", "studyEvents", "lesson_assessments"];
  const snapshots = protectedTables.map(table => [table, orm.snapshot(table)]);
  const otherCourse = structuredClone(orm.table<ProductCourse>("courses").findById("other-course"));
  const { report, plan } = await applyOrmMigrationsWithPlan(orm, [migration], ctx);
  assert.deepEqual(migration.touches, ["courses"]);
  assert.deepEqual(report.applied, [migration.id]);
  assert.deepEqual(report.changes.map(change => [change.action, change.kind, change.id]), [["update", "lesson", lessonId]]);
  assert.equal(plan.productTouched, true);
  assert.equal(report.objects, 0);
  const saved = orm.table<ProductCourse>("courses").findById(course.id)!;
  assert.deepEqual(lesson2(saved).assessments, migration.modelingLifeLesson2Assessments());
  const unrelated = structuredClone(saved); unrelated.updatedAt = before.updatedAt; lesson2(unrelated).assessments = lesson2(before).assessments;
  assert.deepEqual(unrelated, before, "all other course, media, Lesson 1, preview and resource fields are retained");
  assert.deepEqual(orm.table<ProductCourse>("courses").findById("other-course"), otherCourse);
  for (const [table, snapshot] of snapshots) assert.equal(orm.snapshot(table), snapshot);
  const recorded = orm.snapshot("courses");
  assert.equal(migration.apply(orm, ctx)[0].reason, "assessments-exist");
  assert.equal(orm.snapshot("courses"), recorded);
  assert.deepEqual((await applyOrmMigrations(orm, [migration], ctx)).applied, []);
});

test("partial backfills preserve operator questions and missing targets never recreate course content", () => {
  for (const configured of ["knowledge", "application", "both"] as const) {
    const course = modelingLifeCourse(ctx.now), lesson = lesson2(course), original = migration.modelingLifeLesson2Assessments();
    if (configured !== "application") lesson.assessments!.knowledge = [{ ...original.knowledge[0], prompt: "Operator question" }];
    if (configured !== "knowledge") lesson.assessments!.application = { ...original.application!, paragraphs: ["Operator application"] };
    const existing = structuredClone(lesson.assessments!);
    const orm = createMemoryOrm({ tables: { courses: [course] } });
    const changes = migration.apply(orm, ctx), saved = lesson2(orm.table<ProductCourse>("courses").findById(course.id)!).assessments!;
    assert.deepEqual(saved.knowledge, configured !== "application" ? existing.knowledge : original.knowledge);
    assert.deepEqual(saved.application, configured !== "knowledge" ? existing.application : original.application);
    assert.equal(changes[0].action, configured === "both" ? "skip" : "update");
  }
  assert.equal(migration.apply(createMemoryOrm(), ctx)[0].reason, "missing");
  const missingLesson = modelingLifeCourse(ctx.now); missingLesson.sections[0].lessons = missingLesson.sections[0].lessons.slice(0, 1);
  assert.equal(migration.apply(createMemoryOrm({ tables: { courses: [missingLesson] } }), ctx)[0].reason, "missing");
  const wrongIdentity = { ...modelingLifeCourse(ctx.now), slug: "other" };
  assert.throws(() => migration.apply(createMemoryOrm({ tables: { courses: [wrongIdentity] } }), ctx), /identity conflict/);
  const duplicate = modelingLifeCourse(ctx.now); duplicate.sections[0].lessons.push(structuredClone(lesson2(duplicate)));
  assert.throws(() => migration.apply(createMemoryOrm({ tables: { courses: [duplicate] } }), ctx), /ambiguous/);
});
