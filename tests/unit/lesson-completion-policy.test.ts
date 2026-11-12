import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { COURSE_ID, PREVIEW_LP, verifiedUser, purchaseCourse } from "./helpers/my-learning";

test("Lesson completion survives review without accumulating Course progress", async () => {
  const cwd = process.cwd(), backend = process.env.STORAGE_BACKEND;
  process.chdir(await mkdtemp(path.join(tmpdir(), "lesson-policy-")));
  process.env.STORAGE_BACKEND = "local";
  try {
    const store = await import("../../services/productStore");
    const user = await verifiedUser(store, "lesson-policy@example.test");
    const event = { userId: user.id, courseId: COURSE_ID, lessonId: PREVIEW_LP, seconds: 0 };
    await assert.rejects(store.recordStudyEvent({ ...event, event: "complete", clientEventId: "denied" }));
    await purchaseCourse(store, user.id);
    const saved = await store.recordStudyEvent({ ...event, event: "complete", clientEventId: "done" });
    assert.equal(saved?.progress, 0);
    assert.equal(saved?.completedAt, null);
    assert.equal(saved?.highestProgress, undefined);
    await store.recordStudyEvent({ ...event, event: "open", clientEventId: "review" });
    await store.recordStudyEvent({ ...event, event: "complete", clientEventId: "done" });
    const course = (await store.getLearningOverview(user.id)).courses.find(item => item.courseId === COURSE_ID)!;
    assert.deepEqual(course.completedLessonIds, [PREVIEW_LP]);
    assert.equal(course.progress, 0);
    assert.equal(course.completedAt, null);
    await assert.rejects(store.recordStudyEvent({ ...event, event: "complete", clientEventId: "preview" }, "preview"));
  } finally {
    process.chdir(cwd);
    if (backend === undefined) delete process.env.STORAGE_BACKEND; else process.env.STORAGE_BACKEND = backend;
  }
});
