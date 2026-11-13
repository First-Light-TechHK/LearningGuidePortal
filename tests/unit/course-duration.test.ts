import assert from "node:assert/strict";
import { test } from "node:test";
import { totalCourseMinutes } from "../../lib/courseDuration";
import { courseIdentityFrom } from "../../lib/coursePage";

const lessons = [
  { id: "one", title: "One", isPublic: true, durationMinutes: 25, videoDurationSeconds: 1469 },
  { id: "two", title: "Two", isPublic: false, durationMinutes: 27, videoDurationSeconds: 1584 },
];

test("course identity and catalogue duration round the video total once", () => {
  assert.equal(totalCourseMinutes(lessons), 51);
  const course = { title: "Modeling life", status: "published", sections: lessons.map(lesson => ({ lessons: [lesson] })) };
  assert.equal(courseIdentityFrom(course).totalMinutes, 51);
  assert.equal(totalCourseMinutes([{ durationMinutes: 2, videoDurationSeconds: 60 }]), 1);
  assert.equal(totalCourseMinutes([{ durationMinutes: 2, videoDurationSeconds: 0 }]), 0);
});

test("incomplete or invalid video metadata falls back to all configured lesson minutes", () => {
  for (const videoDurationSeconds of [undefined, null, NaN, Infinity, -1]) {
    const incomplete = [lessons[0], { ...lessons[1], videoDurationSeconds }];
    assert.equal(totalCourseMinutes(incomplete), 52);
    assert.equal(courseIdentityFrom({ title: "Course", status: "published", sections: [{ lessons: incomplete }] }).totalMinutes, 52);
  }
  assert.equal(totalCourseMinutes([]), 0);
  assert.equal(totalCourseMinutes([{}]), 0);
});
