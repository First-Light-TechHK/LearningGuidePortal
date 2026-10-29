import assert from "node:assert/strict";
import { test } from "node:test";
import { modelingLifeCourse } from "../../db/data-migrations/008_upgrade_modeling_life";
import * as readings from "../../db/data-migrations/018_add_modeling_life_lesson2_readings";
import * as migration from "../../db/data-migrations/019_add_modeling_life_lesson2_exhibits";
import { applyOrmMigrations, applyOrmMigrationsWithPlan, assertMigrationRegistry, createMemoryOrm } from "../../services/dataMigrations";
import type { ProductCourse } from "../../services/productStore";
import { lessonContentAssetIds, validateLessonContents } from "../../services/lessonContent";
import { buildTextLessonPreview } from "../../services/textLessonPreview";
import { courseExploration } from "../../lib/lessonResources";

const ctx = { store: "memory" as const, dryRun: true, now: "2026-10-29T08:00:00.000Z" };
const anchors = ["T: Well let's work on that a little bit. 2m is of course, by definition, N plus P.", "S: So stability changes as A moves past K then."];
const lesson2 = (course: ProductCourse) => course.sections.flatMap(section => section.lessons).find(lesson => lesson.id === "modeling-life-lesson-2")!;

test("019 reuses the two images at text midpoints and original video times, preserving all unrelated data", async () => {
  assertMigrationRegistry();
  const course = modelingLifeCourse(ctx.now), names = ["users", "orders", "subscriptions", "entitlements", "studyRecords", "studyEvents", "lesson_assessments"];
  const orm = createMemoryOrm({ tables: { courses: [course, { ...structuredClone(course), id: "other", slug: "other" }], ...Object.fromEntries(names.map(name => [name, [{ id: `keep-${name}` }]])) } });
  readings.apply(orm, ctx);
  const before = structuredClone(orm.table<ProductCourse>("courses").findById(course.id)!);
  const snapshots = names.map(name => [name, orm.snapshot(name)]), other = structuredClone(orm.table<ProductCourse>("courses").findById("other"));
  const { report, plan } = await applyOrmMigrationsWithPlan(orm, [migration], ctx);
  assert.deepEqual(report.applied, [migration.id]); assert.deepEqual(migration.touches, ["courses"]);
  assert.equal(plan.productTouched, true); assert.equal(report.objects, 0);
  const saved = orm.table<ProductCourse>("courses").findById(course.id)!, second = lesson2(saved);
  const source = before.sections[0].lessons[0].contents!.find(point => point.type === "video")!.nodes;
  const video = second.contents!.find(point => point.id === "modeling-life-l2-video-1")!;
  assert.deepEqual(video.nodes.map(node => node.triggerTime), [37, 160]);
  for (let index = 0; index < 2; index++) {
    const point = second.contents!.find(point => point.id === `modeling-life-l2-text-${index + 1}`)!;
    const textId = `modeling-life-l2-text-exhibit-${index + 1}`, marker = `<div data-exhibit-card="${textId}"></div>`;
    assert.ok(point.html!.includes(`${marker}<p>${anchors[index]}`));
    const position = point.html!.indexOf(marker) / point.html!.length;
    assert.ok(position > .4 && position < .6, "card is near each section's middle");
    assert.deepEqual(point.nodes, [{ ...source[index], id: textId, triggerTime: 0 }]);
    assert.deepEqual(video.nodes[index], { ...source[index], id: `modeling-life-l2-exhibit-${index + 1}` });
    assert.deepEqual(second.exploration!.exhibits[index], { node: { ...source[index], id: `modeling-life-exhibit-2-${index + 1}` }, lessonNumber: "02", thumbnail: source[index].thumbnail });
  }
  validateLessonContents(second.contents, course.id);
  assert.equal(lessonContentAssetIds(second.contents!, course.id).size, 5, "video, originals and thumbnails remain recognised media");
  const limited = buildTextLessonPreview(second, course.id, false);
  const firstLocked = limited.contents.find(point => point.id === "modeling-life-l2-text-1")!;
  assert.equal(firstLocked.html, undefined); assert.deepEqual(firstLocked.nodes, []);
  const locked = limited.contents.find(point => point.id === "modeling-life-l2-text-2")!;
  assert.equal(locked.html, undefined); assert.deepEqual(locked.nodes, []);
  assert.equal(courseExploration(saved)!.exhibits.length, 4);
  const restored = structuredClone(saved); restored.updatedAt = before.updatedAt; lesson2(restored).exploration!.exhibits = [];
  for (const point of lesson2(restored).contents!) {
    point.nodes = point.nodes.filter(node => !/^modeling-life-l2-(?:text-)?exhibit-[12]$/.test(node.id));
    if (point.html) point.html = point.html.replace(/<div data-exhibit-card="modeling-life-l2-text-exhibit-[12]"><\/div>/g, "");
  }
  assert.deepEqual(restored, before, "text, images, offsets, readings, tests and Lesson 1 remain unchanged");
  for (const [name, snapshot] of snapshots) assert.equal(orm.snapshot(name), snapshot);
  assert.deepEqual(orm.table<ProductCourse>("courses").findById("other"), other);
  const snapshot = orm.snapshot("courses"); assert.equal(migration.apply(orm, ctx)[0].reason, "exhibits-exist"); assert.equal(orm.snapshot("courses"), snapshot);
  assert.deepEqual((await applyOrmMigrations(orm, [migration], ctx)).applied, []);
});

test("019 fills partial copies while preserving later author edits and unrelated exhibits", () => {
  const course = modelingLifeCourse(ctx.now), second = lesson2(course), source = course.sections[0].lessons[0].contents!.find(point => point.type === "video")!.nodes;
  second.contents![0].nodes.push({ ...source[0], id: "modeling-life-l2-text-exhibit-1", title: "Edited title", triggerTime: 0 });
  second.exploration!.exhibits.push({ node: { ...source[0], id: "operator-exhibit" }, lessonNumber: "02", thumbnail: source[0].thumbnail! });
  const orm = createMemoryOrm({ tables: { courses: [course] } }); migration.apply(orm, ctx);
  const saved = orm.table<ProductCourse>("courses").findById(course.id)!, point = lesson2(saved).contents![0];
  assert.equal(point.nodes[0].title, "Edited title"); assert.equal(lesson2(saved).exploration!.exhibits.length, 3);
  point.html = point.html!.replace(anchors[0], "Operator edited paragraph");
  orm.table<ProductCourse>("courses").update(saved.id, { sections: saved.sections });
  const snapshot = orm.snapshot("courses"); assert.equal(migration.apply(orm, ctx)[0].reason, "exhibits-exist"); assert.equal(orm.snapshot("courses"), snapshot);
});

test("019 skips missing targets and rejects source, marker and paragraph conflicts without partial writes", () => {
  assert.equal(migration.apply(createMemoryOrm(), ctx)[0].reason, "missing");
  const missing = modelingLifeCourse(ctx.now); missing.sections[0].lessons.pop();
  assert.equal(migration.apply(createMemoryOrm({ tables: { courses: [missing] } }), ctx)[0].reason, "missing");
  for (const conflict of ["slug", "lesson", "source", "point", "anchor", "orphan", "foreign", "exploration"] as const) {
    const course = modelingLifeCourse(ctx.now), second = lesson2(course);
    if (conflict === "slug") course.slug = "other";
    if (conflict === "lesson") course.sections[0].lessons.push(structuredClone(second));
    if (conflict === "source") course.sections[0].lessons[0].contents!.find(point => point.type === "video")!.nodes = [];
    if (conflict === "point") second.contents![1].type = "video";
    if (conflict === "anchor") second.contents![1].html = second.contents![1].html!.replace(anchors[1], "Changed midpoint");
    if (conflict === "orphan") second.contents![1].html += '<div data-exhibit-card="modeling-life-l2-text-exhibit-2"></div>';
    if (conflict === "foreign") second.contents![1].nodes.push({ id: "modeling-life-l2-text-exhibit-1", type: "image", title: "Foreign", triggerTime: 0 });
    if (conflict === "exploration") second.exploration!.exhibits.push({ node: { id: "modeling-life-exhibit-2-2", type: "image", title: "Foreign", triggerTime: 0 }, lessonNumber: "01", thumbnail: "" });
    const orm = createMemoryOrm({ tables: { courses: [course] } }), snapshot = orm.snapshot("courses");
    assert.throws(() => migration.apply(orm, ctx), /conflict|ambiguous|invalid/); assert.equal(orm.snapshot("courses"), snapshot);
  }
});
