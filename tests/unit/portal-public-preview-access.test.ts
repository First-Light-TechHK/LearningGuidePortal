import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const root = process.cwd();
const page = (relative: string) => readFileSync(path.join(root, relative), "utf8");

test("CM-07 published course and public-lesson pages do not bounce tourists to sign-in (4e4d4c3-3)", () => {
  const course = page("app/[locale]/portal/courses/[slug]/page.tsx");
  const lesson = page("app/[locale]/portal/courses/[slug]/public-lesson/page.tsx");
  assert.doesNotMatch(course, /if\s*\(\s*!user\s*\)\s*redirect/);
  assert.doesNotMatch(lesson, /if\s*\(\s*!user\s*\)\s*redirect/);
  assert.doesNotMatch(lesson, /textStopLabel:\s*"<Exh 3>"/);
});

test("paid learning room still requires a session", () => {
  const learn = page("app/[locale]/account/learn/[courseId]/page.tsx");
  assert.match(learn, /if\s*\(\s*!user\s*\)\s*redirect/);
});
