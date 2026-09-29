import assert from "node:assert/strict";
import { test } from "node:test";
import { previewLessonOutline } from "../../lib/previewLessonPresentation";
import type { ProductCourse } from "../../services/productStore";

const course = {
  id: "course-fixture", sections: [{ id: "section", title: "Section", lessons: [
    { id: "public", title: "Preview", isPublic: true, body: "Public body", contents: [{ html: "Public content" }] },
    { id: "private", title: "Private lesson", isPublic: true, body: "Private body", contents: [{ url: "private-video" }] },
  ] }],
} as ProductCourse;

test("preview outline never serialises private content, even for entitled viewers", () => {
  for (const entitled of [false, true]) {
    const outline = previewLessonOutline(course, "en-GB", entitled);
    assert.equal(outline[0].number, "01");
    assert.equal(outline[1].number, "02");
    assert.deepEqual(Object.keys(outline[1]).sort(), ["href", "id", "number", "title"]);
    assert(!JSON.stringify(outline).includes("private-video"));
    assert(!JSON.stringify(outline).includes("Private body"));
  }
});

test("only the first lesson is previewable; entitled routes preserve locale", () => {
  assert.equal(previewLessonOutline(course, "en-GB", false)[1].href, null);
  assert.equal(previewLessonOutline(course, "zh-CN", true)[1].href, "/zh-CN/account/learn/course-fixture?lessonId=private");
  assert.equal(previewLessonOutline(course, "zh-CN", false)[0].href, "/zh-CN/portal/courses/course-fixture/public-lesson?lessonId=public");
});
