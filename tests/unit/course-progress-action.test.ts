import assert from "node:assert/strict";
import { test } from "node:test";
import { highestProgressLesson } from "../../services/courseProgressAction";
import { knowledgePositionAtProgress } from "../../lib/knowledgeProgress";
import type { ProductCourse, ProductStudyEvent, ProductStudyRecord } from "../../services/productStore";

const course = { id: "course", sections: [{ lessons: [
  { id: "one", contents: [{ id: "t1", type: "text" }, ...Array.from({ length: 6 }, (_, index) => ({ id: `v${index + 1}`, type: "video" }))] },
  { id: "two", contents: [{ id: "v7", type: "video" }, ...Array.from({ length: 6 }, (_, index) => ({ id: `t${index + 2}`, type: "text" }))] },
] }] } as ProductCourse;
const record = { userId: "user", courseId: "course", progress: 86, completedAt: null, currentLessonId: "one", currentMode: "video" } as ProductStudyRecord;
const event = (lessonId: string, contentId: string): ProductStudyEvent => ({ userId: "user", courseId: "course", learningMode: "text", lessonId, contentId, event: "open" } as ProductStudyEvent);

test("highest-progress provenance wins over a review cursor or different mode with unequal point distributions", () => {
  const highestProgress = { progress: 86, mode: "text" as const, lessonId: "two", contentId: "t6" };
  assert.equal(highestProgressLesson(course, { ...record, highestProgress }, []), "two");
  assert.equal(highestProgressLesson(course, { ...record, highestProgress, currentMode: "text" }, []), "two");
  assert.equal(highestProgressLesson(course, { ...record, progress: 100 }, []), "two");
  assert.equal(highestProgressLesson(course, { ...record, progress: 0 }, []), "one");
});

test("old records recover the highest location from owned valid events without accepting a higher percentage", () => {
  const history = [event("two", "t6"), event("one", "t1"), { ...event("two", "t7"), userId: "other" }, event("two", "t7")];
  assert.equal(highestProgressLesson(course, record, history), "two");
  assert.equal(highestProgressLesson(course, record, [...history].reverse()), "two");
  assert.equal(highestProgressLesson(course, record, [event("one", "not-active")]), "two", "missing provenance uses the stored maximum over Lessons, never the cursor");
  assert.equal(highestProgressLesson(course, { ...record, currentMode: "text" }, []), "two");
});

test("removed point metadata uses the maximum's known mode and the existing rounding rule", () => {
  assert.deepEqual(knowledgePositionAtProgress(course, "text", 86), { lessonId: "two", contentId: "t6" });
  assert.deepEqual(knowledgePositionAtProgress(course, "video", 86), { lessonId: "one", contentId: "v6" });
  assert.equal(highestProgressLesson(course, { ...record, highestProgress: { progress: 86, mode: "text", lessonId: "two", contentId: "removed" } }, []), "two");
  const legacy = { id: "course", sections: [{ lessons: [{ id: "first" }, { id: "middle" }, { id: "last" }] }] } as ProductCourse;
  assert.equal(highestProgressLesson(legacy, { ...record, progress: 67 }, []), "middle", "rounded 2/3 progress must not advance Start to Lesson 3");
});
