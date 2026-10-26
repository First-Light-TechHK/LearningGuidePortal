import assert from "node:assert/strict";
import { test } from "node:test";
import { modelingLifeCourse } from "../../db/data-migrations/008_upgrade_modeling_life";
import * as migration from "../../db/data-migrations/016_add_modeling_life_lesson1_text_exhibits";
import { applyOrmMigrations, createMemoryOrm } from "../../services/dataMigrations";
import type { ProductCourse } from "../../services/productStore";
import { buildTextLessonPreview } from "../../services/textLessonPreview";
import { lessonContentAssetIds, validateLessonContents } from "../../services/lessonContent";

const ctx = { store: "memory" as const, dryRun: true, now: "2026-10-26T12:00:00.000Z" };
const anchors = ["Our first example is going to be a single number.", "T: Yes, that is the case. With electricity, the state variable might be voltage."];

test("Lesson 01 backfill places the current video exhibits immediately before the two requested paragraphs without changing authored material", async () => {
  const course = modelingLifeCourse(ctx.now), before = structuredClone(course);
  const orm = createMemoryOrm({ tables: { courses: [course], studyRecords: [{ id: "keep-progress" }], lesson_assessments: [{ id: "keep-answers" }] } });
  const protectedTables = ["studyRecords", "lesson_assessments"].map(name => [name, orm.snapshot(name)]);
  assert.deepEqual((await applyOrmMigrations(orm, [migration], ctx)).applied, [migration.id]);
  const saved = orm.table<ProductCourse>("courses").findById(course.id)!, lesson = saved.sections[0].lessons[0];
  const point = lesson.contents!.find(content => content.id === "modeling-life-l1-text-1")!;
  const video = lesson.contents!.find(content => content.id === "modeling-life-l1-video-1")!;
  for (const [index, anchor] of anchors.entries()) {
    const target = `modeling-life-l1-text-exhibit-${index + 1}`;
    assert.ok(point.html!.includes(`<div data-exhibit-card="${target}"></div><p>${anchor}`));
    assert.deepEqual(point.nodes[index], { ...video.nodes[index], id: target, triggerTime: 0 });
  }
  validateLessonContents(lesson.contents, course.id);
  const preview = buildTextLessonPreview(lesson, course.id, false);
  const visible = preview.contents.find(content => content.id === point.id)!;
  assert.equal(visible.nodes.length, 2, "the configured first point includes both cards in preview");
  assert.equal(lessonContentAssetIds([visible], course.id).size, 4, "both original images and thumbnails are authorised by the visible text point");
  const restored = structuredClone(saved);
  restored.updatedAt = before.updatedAt;
  const restoredPoint = restored.sections[0].lessons[0].contents!.find(content => content.id === point.id)!;
  restoredPoint.html = restoredPoint.html!.replace(/<div data-exhibit-card="modeling-life-l1-text-exhibit-[12]"><\/div>/g, "");
  restoredPoint.nodes = [];
  assert.deepEqual(restored, before, "all original text, embedded images, videos, other lessons and assessment definitions survive unchanged");
  for (const [name, snapshot] of protectedTables) assert.equal(orm.snapshot(name), snapshot);
  const snapshot = orm.snapshot("courses");
  assert.equal(migration.apply(orm, ctx)[0].reason, "text-exhibits-exist");
  assert.equal(orm.snapshot("courses"), snapshot);
  assert.deepEqual((await applyOrmMigrations(orm, [migration], ctx)).applied, []);
});

test("backfill fails before any write on changed anchors or conflicting source identities and skips missing targets", () => {
  for (const change of ["missing-anchor", "duplicate-anchor", "missing-video", "duplicate-lesson", "foreign-node"] as const) {
    const course = modelingLifeCourse(ctx.now), lesson = course.sections[0].lessons[0], point = lesson.contents![0];
    if (change === "missing-anchor") point.html = point.html!.replace(anchors[1], "Edited paragraph");
    if (change === "duplicate-anchor") point.html += `<p>${anchors[1]}</p>`;
    if (change === "missing-video") lesson.contents!.find(content => content.type === "video")!.nodes = [];
    if (change === "duplicate-lesson") course.sections[0].lessons.push(structuredClone(lesson));
    if (change === "foreign-node") lesson.contents![1].nodes.push({ id: "modeling-life-l1-text-exhibit-1", title: "Other", type: "image", triggerTime: 0 });
    const orm = createMemoryOrm({ tables: { courses: [course] } }), snapshot = orm.snapshot("courses");
    assert.throws(() => migration.apply(orm, ctx), /missing|ambiguous|conflict/);
    assert.equal(orm.snapshot("courses"), snapshot);
  }
  assert.equal(migration.apply(createMemoryOrm(), ctx)[0].reason, "missing");
  const course = modelingLifeCourse(ctx.now); course.sections[0].lessons.shift();
  assert.equal(migration.apply(createMemoryOrm({ tables: { courses: [course] } }), ctx)[0].reason, "missing");
});
