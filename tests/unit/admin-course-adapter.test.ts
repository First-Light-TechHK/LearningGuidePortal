import assert from "node:assert/strict";
import { test } from "node:test";
import {
  adminAssetProxyUrl,
  mapAdminCategory,
  toProductCourseDetail,
  toProductCourseSummary,
} from "../../lib/adminCourseAdapter";
import type { AdminCourseDetail } from "../../contracts/admin-portal-catalogue";

const NOW = "2026-11-25T00:00:00.000Z";

const detail: AdminCourseDetail = {
  id: "4d22b6a5-c091-4fc1-90d5-1c16bf2cb1b2",
  slug: "modeling-life",
  code: "C001",
  title: "Modeling life",
  subtitle: null,
  shortDescription: "See how mathematics models life.",
  description: "Long description",
  category: "Science",
  coverUrl: "/api/portal/v1/media/4d22b6a5-c091-4fc1-90d5-1c16bf2cb1b2/cover",
  whatYouLearn: ["Model real systems.", "Understand feedback"],
  provides: [{ type: "video", title: "Video & text dual-mode learning" }, "ignored-non-object", { title: 42 }],
  sections: [{
    id: "all",
    title: "Lessons",
    lessons: [{
      id: "lesson-uuid-1",
      title: "State spaces",
      summary: "A system is a collection of states.",
      durationSeconds: 1469,
      isPublic: true,
      contents: [
        { id: "L001-video", type: "video", mode: "lecture", url: "/api/portal/v1/media/4d22b6a5-c091-4fc1-90d5-1c16bf2cb1b2/assets/asset-video", nodes: [
          { id: "E0101", title: "E0101", type: "image", url: "/api/portal/v1/media/4d22b6a5-c091-4fc1-90d5-1c16bf2cb1b2/assets/asset-image", triggerTime: 12 },
        ] },
        { id: "L001-text", type: "text", mode: "lecture", html: "<p>Body</p>", nodes: [] },
      ],
    }],
  }],
};

test("a list summary becomes a published, read-only ProductCourse keyed by slug", () => {
  const course = toProductCourseSummary(detail, NOW);
  assert.equal(course.id, "modeling-life", "Portal URL/entitlement key stays the slug");
  assert.equal(course.slug, "modeling-life");
  assert.equal(course.adminCourseId, detail.id);
  assert.equal(course.origin, "admin");
  assert.equal(course.status, "published");
  assert.equal(course.cover, `/api/admin-course-media/${detail.id}/cover`);
  assert.equal(course.category, "Science");
  assert.equal(course.sections.length, 0, "sections arrive with the detail fetch");
  assert.equal(course.createdAt, NOW);
});

test("a detail becomes a full syllabus with proxied media and no protected body", () => {
  const course = toProductCourseDetail(detail, NOW);
  assert.deepEqual(course.outcomes, ["Model real systems.", "Understand feedback"]);
  assert.deepEqual(course.features, ["Video & text dual-mode learning"], "non-object / non-string provides are dropped");

  const lesson = course.sections[0]!.lessons[0]!;
  assert.equal(lesson.id, "lesson-uuid-1");
  assert.equal(lesson.title, "State spaces");
  assert.equal(lesson.body, "");
  assert.equal(lesson.durationMinutes, 25, "1469s rounds up to 25 minutes");
  assert.equal(lesson.videoDurationSeconds, 1469);
  assert.equal(lesson.isPublic, true);

  const video = lesson.contents!.find(content => content.type === "video")!;
  assert.equal(video.url, `/api/admin-course-media/${detail.id}/assets/asset-video`);
  assert.equal(video.nodes[0]!.url, `/api/admin-course-media/${detail.id}/assets/asset-image`);
  assert.equal(video.nodes[0]!.triggerTime, 12);

  const text = lesson.contents!.find(content => content.type === "text")!;
  assert.equal(text.html, "<p>Body</p>");
});

test("unknown categories fall back to European Humanities", () => {
  assert.equal(mapAdminCategory("Science"), "Science");
  assert.equal(mapAdminCategory("science"), "Science", "case differences still match");
  assert.equal(mapAdminCategory("Philosophy"), "European Humanities");
  assert.equal(mapAdminCategory(null), "European Humanities");
});

test("tolerates missing or non-array optional fields", () => {
  const sparse = toProductCourseDetail({ id: "uuid-9", slug: "sparse" }, NOW);
  assert.deepEqual(sparse.outcomes, []);
  assert.deepEqual(sparse.features, []);
  assert.deepEqual(sparse.sections, []);
  assert.equal(sparse.title, "sparse");
  assert.equal(sparse.category, "European Humanities");
});

test("the media URL rewrite trusts only the last path segment", () => {
  assert.equal(
    adminAssetProxyUrl("course-uuid", "/api/portal/v1/media/course-uuid/assets/asset-1?x=1"),
    "/api/admin-course-media/course-uuid/assets/asset-1",
  );
  assert.equal(adminAssetProxyUrl("course-uuid", "/api/portal/v1/media/course-uuid/cover"), undefined);
  assert.equal(adminAssetProxyUrl("course-uuid", ""), undefined);
});
