import assert from "node:assert/strict";
import { test } from "node:test";
import { modelingLifeCourse } from "../../db/data-migrations/008_upgrade_modeling_life";
import * as migration from "../../db/data-migrations/017_fix_modeling_life_video_starts";
import { applyOrmMigrations, createMemoryOrm } from "../../services/dataMigrations";
import type { ProductCourse } from "../../services/productStore";

const ctx = { store:"memory" as const, dryRun:true, now:"2026-10-26T12:00:00.000Z" };

test("017 starts both imported Lessons at zero and preserves later points, resources and learner history", async () => {
  const course=modelingLifeCourse(ctx.now), before=structuredClone(course);
  const orm=createMemoryOrm({tables:{courses:[course],studyRecords:[{id:"saved-progress"}],lesson_assessments:[{id:"saved-answers"}],entitlements:[{id:"keep-access"}]}});
  const protectedTables=["studyRecords","lesson_assessments","entitlements"].map(name=>[name,orm.snapshot(name)]);
  assert.deepEqual((await applyOrmMigrations(orm,[migration],ctx)).applied,[migration.id]);
  const saved=orm.table<ProductCourse>("courses").findById(course.id)!;
  assert.deepEqual(saved.sections[0].lessons.map(lesson=>lesson.contents!.filter(point=>point.type==="video").map(point=>point.startSeconds)),[[0,412,587,1026,1175],[0,1204]]);
  const restored=structuredClone(saved);restored.updatedAt=before.updatedAt;
  for(const lesson of restored.sections[0].lessons)lesson.contents!.find(point=>point.type==="video")!.startSeconds=10;
  assert.deepEqual(restored,before);
  for(const [name,snapshot] of protectedTables)assert.equal(orm.snapshot(name),snapshot);
  const snapshot=orm.snapshot("courses");assert.equal(migration.apply(orm,ctx)[0].reason,"no-imported-offsets");assert.equal(orm.snapshot("courses"),snapshot);
  assert.deepEqual((await applyOrmMigrations(orm,[migration],ctx)).applied,[]);
});

test("017 preserves operator offsets and fails without partial writes on conflicting identities", () => {
  const course=modelingLifeCourse(ctx.now);course.sections[0].lessons[1].contents!.find(point=>point.type==="video")!.startSeconds=42;
  const orm=createMemoryOrm({tables:{courses:[course]}});assert.equal(migration.apply(orm,ctx).length,1);
  assert.equal(orm.table<ProductCourse>("courses").findById(course.id)!.sections[0].lessons[1].contents!.find(point=>point.type==="video")!.startSeconds,42);
  assert.equal(migration.apply(createMemoryOrm(),ctx)[0].reason,"missing");
  const duplicate=modelingLifeCourse(ctx.now);duplicate.sections[0].lessons.push(structuredClone(duplicate.sections[0].lessons[1]));
  const conflicted=createMemoryOrm({tables:{courses:[duplicate]}}),snapshot=conflicted.snapshot("courses");
  assert.throws(()=>migration.apply(conflicted,ctx),/ambiguous/);assert.equal(conflicted.snapshot("courses"),snapshot);
});
