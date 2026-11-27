import assert from "node:assert/strict";
import { test } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CatalogueCourseCard } from "../../components/portal/CatalogueCourseCard";
import { toProductCourseSummary } from "../../lib/adminCourseAdapter";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

test("a mirrored catalogue card uses list-summary lesson count and duration before detail is fetched", () => {
  const course = toProductCourseSummary({
    id: "admin-course-1",
    slug: "european-civilisation",
    title: "European Civilisation 1648 - 1945",
    category: "European Humanities",
    lessonCount: 24,
    totalDurationSeconds: 72_000,
  }, "2026-11-25T00:00:00.000Z");

  const markup = renderToStaticMarkup(createElement(CatalogueCourseCard, {
    course,
    category: "European Humanities",
    locale: "en-GB",
  }));

  assert.match(markup, /24 lessons · 20h 0m/);
});
