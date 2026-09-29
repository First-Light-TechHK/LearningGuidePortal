import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "node:test";
import { CourseLearningOutcomes } from "../../components/portal/CourseLearningOutcomes";
import { ShellViewer } from "../../components/ShellViewer";
import { getMessages } from "../../lib/i18n/messages";
import { courseLearningOutcomes, courseOutcomes } from "../../lib/courseDetailPresentation";
import { shellViewerFromUser } from "../../lib/shellViewer";
import en from "../../messages/en-GB.json";
import zh from "../../messages/zh-CN.json";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCIENCE_EN = "Model real biological systems";
const SCIENCE_ZH = "用数学建模真实的生物系统";

function read(relativePath: string) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function buttonOpenTags(source: string) {
  return source.match(/<button\b[^>]*>/g) || [];
}

test("Epicureanism does not render the shared science outcomes", () => {
  const epicureanism = { id: "epicureanism", slug: "epicureanism", title: "Epicureanism" };
  const outcomes = courseLearningOutcomes(epicureanism);
  assert.deepEqual(outcomes, []);
  for (const locale of [en, zh]) {
    const html = renderToStaticMarkup(createElement(CourseLearningOutcomes, {
      title: locale.courseDetailDesign.outcomesTitle,
      outcomes,
    }));
    assert.equal(html, "");
    assert.equal(html.includes(SCIENCE_EN), false);
    assert.equal(html.includes(SCIENCE_ZH), false);
  }
  assert.equal(en.courseDetailDesign.outcomes.join("\n").includes(SCIENCE_EN), true);
  assert.equal(zh.courseDetailDesign.outcomes.join("\n").includes(SCIENCE_ZH), true);

  const stored = courseLearningOutcomes(
    { outcomes: ["  Distinguish kinetic from katastematic pleasure  ", ""] },
    { outcomes: [SCIENCE_EN] },
  );
  const storedHtml = renderToStaticMarkup(createElement(CourseLearningOutcomes, {
    title: en.courseDetailDesign.outcomesTitle,
    outcomes: stored,
  }));
  assert.match(storedHtml, /Distinguish kinetic from katastematic pleasure/);
  assert.equal(storedHtml.includes(SCIENCE_EN), false);

  const fromCatalogue = courseLearningOutcomes(
    epicureanism,
    { outcomes: ["Friendship is a stable good"] },
    { outcomes: [SCIENCE_EN, SCIENCE_ZH] },
  );
  assert.deepEqual(fromCatalogue, []);
  assert.deepEqual(fromCatalogue, courseOutcomes(epicureanism));
  const catalogueHtml = renderToStaticMarkup(createElement(CourseLearningOutcomes, {
    title: zh.courseDetailDesign.outcomesTitle,
    outcomes: fromCatalogue,
  }));
  assert.equal(catalogueHtml, "");
  assert.equal(catalogueHtml.includes("Friendship is a stable good"), false);
  assert.equal(catalogueHtml.includes(SCIENCE_EN), false);
  assert.equal(catalogueHtml.includes(SCIENCE_ZH), false);

  const page = read("app/[locale]/portal/courses/[slug]/page.tsx");
  assert.doesNotMatch(page, /detail\.outcomes(?!Title)/);
  assert.match(page, /courseLearningOutcomes\(course\)/);
  assert.doesNotMatch(page, /catalogueEntriesForCourse/);
  assert.match(page, /<CourseLearningOutcomes/);
});

test("zh-CN header and public lesson use Chinese chrome", () => {
  const messages = getMessages("zh-CN");
  const english = getMessages("en-GB");
  assert.equal(english.portal.myLearning, "My Learning");
  assert.equal(english.portal.publicFirstLesson, "Public First Lesson");
  assert.notEqual(messages.portal.myLearning, "My Learning");
  assert.notEqual(messages.portal.publicFirstLesson, "Public First Lesson");
  assert.equal(messages.portal.myLearning, "我的学习");
  assert.equal(messages.portal.publicFirstLesson, "公开首课");
  assert.equal(messages.learning.title, "我的学习");

  const headerSource = read("components/portal/PortalHeader.tsx");
  assert.match(headerSource, /\{copy\.myLearning\}/);
  const header = renderToStaticMarkup(createElement("a", {
    className: "portal-header-link",
    href: "/zh-CN/account/my-learning",
  }, messages.portal.myLearning));
  assert.match(header, /我的学习/);
  assert.equal(header.includes("My Learning"), false);

  const lesson = read("app/[locale]/portal/courses/[slug]/public-lesson/page.tsx");
  assert.match(lesson, /\{copy\.publicFirstLesson\}/);
  const eyebrow = renderToStaticMarkup(createElement("p", { className: "portal-eyebrow" }, messages.portal.publicFirstLesson));
  assert.match(eyebrow, /公开首课/);
  assert.equal(eyebrow.includes("Public First Lesson"), false);
  assert.equal(eyebrow.includes("PUBLIC FIRST LESSON"), false);
});

test("the shell shows the signed-in user and has no dead notification button", () => {
  const source = read("components/AppShell.tsx");
  assert.equal(source.includes("Prof. Gordon"), false);
  assert.equal(source.includes("Subject Expert"), false);
  assert.equal(source.includes('aria-label="Notifications"'), false);
  assert.match(source, /<ShellViewer/);
  const buttons = buttonOpenTags(source);
  assert.ok(buttons.length > 0);
  for (const tag of buttons) assert.match(tag, /\bonClick=/);

  const fixture = shellViewerFromUser({ nickname: " Ada Operator ", role: "operator" });
  assert.deepEqual(fixture, { name: "Ada Operator", role: "operator" });
  assert.equal(shellViewerFromUser({ nickname: "   ", role: "operator" }), null);
  assert.equal(shellViewerFromUser(null), null);

  const html = renderToStaticMarkup(createElement(ShellViewer, { viewer: fixture }));
  assert.match(html, /Ada Operator/);
  assert.match(html, /operator/);
  assert.equal(html.includes("Prof. Gordon"), false);
  assert.equal(html.includes("Subject Expert"), false);
  assert.equal(html.includes("<button"), false);
  assert.equal(html.includes("Notifications"), false);

  const empty = renderToStaticMarkup(createElement(ShellViewer, { viewer: null }));
  assert.equal(empty, "");
  assert.equal(source.includes("Prof. Gordon"), false);
});
