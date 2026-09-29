import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownAnswer } from "../../components/MarkdownAnswer";
import { courseLessonCardDescription } from "../../lib/courseDetailPresentation";
import { sanitiseRichHtml } from "../../services/lessonContent";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("exhibit markers keep data-instance-content after lesson HTML sanitise", () => {
  // Persistence sanitiser. LessonContentPlayer reads this attribute after sanitiseLessonHtml, which deletes it the same way.
  const marker = '<span class="instance-node" data-instance-type="4" data-instance-content="/Quintus Horatius Flaccus/Exh/Exh (1).jpg">Exh 1</span>';
  const safe = sanitiseRichHtml(marker, "horace-course");
  assert.match(safe, /data-instance-content="\/Quintus Horatius Flaccus\/Exh\/Exh \(1\)\.jpg"/);
});

test("MarkdownAnswer does not nest a figure inside a paragraph", () => {
  const html = renderToStaticMarkup(createElement(MarkdownAnswer, {
    content: "See the plate ![Horace exhibit](/portal/exh.jpg) before the next sentence.",
  }));
  assert.doesNotMatch(html, /<p(?:\s[^>]*)?>[\s\S]*<figure[\s\S]*<\/figure>[\s\S]*<\/p>/);
});

function trialLimitModalSource() {
  const source = readFileSync(path.join(root, "components/portal/LessonContentPlayer.tsx"), "utf8");
  const start = source.indexOf("function TrialLimitModal");
  const end = source.indexOf("function TextContentPlayer");
  if (start < 0 || end < start) throw new Error("TrialLimitModal source not found");
  return source.slice(start, end);
}

function stringField(block: string, field: string) {
  const match = block.match(new RegExp(String.raw`\b${field}\s*:\s*(['"])([\s\S]*?)\1`));
  return match?.[2];
}

function visibleZhCnTrial(modal: string) {
  const branch = modal.match(/locale\s*===\s*['"]zh-CN['"]\s*\?\s*(\{[\s\S]*?\})\s*:/);
  if (branch) {
    return {
      title: stringField(branch[1], "heroTitle") ?? stringField(branch[1], "title") ?? "",
      cta: stringField(branch[1], "cta") ?? "",
    };
  }
  if (/lessonMessages\(\s*locale\s*\)/.test(modal)) {
    const zh = JSON.parse(readFileSync(path.join(root, "messages/lesson-authoring-zh-CN.json"), "utf8")) as Record<string, string>;
    const nested = modal.match(/lessonMessages\(\s*locale\s*\)\.(\w+)/);
    const bag = nested && zh[nested[1]] && typeof zh[nested[1]] === "object"
      ? zh[nested[1]] as unknown as Record<string, string>
      : zh;
    return { title: String(bag.heroTitle || bag.title || ""), cta: String(bag.cta || "") };
  }
  const copy = modal.match(/const copy = (\{[\s\S]*?\});/);
  const block = copy?.[1] ?? "";
  return {
    title: stringField(block, "heroTitle") ?? "",
    cta: stringField(block, "cta") ?? "",
  };
}

test("zh-CN preview-limit dialog does not show the English Ready for learning sentence", () => {
  const visible = visibleZhCnTrial(trialLimitModalSource());
  assert.doesNotMatch(visible.cta, /Ready for learning/i);
  assert.doesNotMatch(visible.title, /Enjoying the course so far/i);
  assert.match(visible.title, /\p{Script=Han}/u);
  assert.match(visible.cta, /\p{Script=Han}/u);
});

test("lesson card description is not the section title repeated for every lesson", () => {
  const section = { title: "Foundations" };
  const lessons = [
    { title: "Pleasure and the Good Life" },
    { title: "Why Death Is Nothing to Us" },
  ];
  const descriptions = lessons.map((lesson) => courseLessonCardDescription(section, lesson));
  for (const description of descriptions) assert.notEqual(description, section.title);
  assert.notEqual(descriptions[0], descriptions[1]);
});

test("a stored european-humanities categoryId stays publishable when the teaching catalogue is empty", async () => {
  const cwd = process.cwd();
  const previous = {
    STORAGE_BACKEND: process.env.STORAGE_BACKEND,
    APP_ENV: process.env.APP_ENV,
    ADMIN_HOSTS: process.env.ADMIN_HOSTS,
  };
  const directory = await mkdtemp(path.join(tmpdir(), "lg-content-catalogue-"));
  try {
    process.chdir(directory);
    Object.assign(process.env, { STORAGE_BACKEND: "local", APP_ENV: "DEV", ADMIN_HOSTS: "localhost" });
    const store = await import("../../services/productStore");
    const files = await import("../../services/fileStore");
    const detail = await import("../../app/api/backoffice/courses/[courseId]/route");
    const operator = await store.registerUser({ email: "operator@content-locks.test", password: "password1", role: "operator" });
    await store.verifyEmailToken(await store.issueEmailVerificationToken(operator.id));
    const token = (await store.createSession(operator.id)).token;
    const productPath = path.join(directory, "data/knowledge_system/learning_guide/product.json");
    const seeded = JSON.parse(await readFile(productPath, "utf8"));
    const horace = seeded.courses.find((item: { id: string }) => item.id === "quintus-horatius-flaccus");
    assert.equal(horace.categoryId, "european-humanities");
    seeded.catalogue = [];
    await files.atomicWriteJson(productPath, seeded);
    const current = (await store.ensureProductData()).courses.find((item) => item.id === horace.id)!;
    assert.deepEqual(await store.getCourseCatalogue(operator.id), []);
    const drafted = await store.setCourseStatus(current.id, "draft", operator.id, current.updatedAt);
    assert.equal(drafted.status, "draft");
    assert.equal(drafted.categoryId, "european-humanities");
    const origin = "http://localhost:3016";
    const response = await detail.PATCH(new Request(`${origin}/api/backoffice/courses/${drafted.id}`, {
      method: "PATCH",
      headers: {
        host: "localhost:3016",
        origin,
        "content-type": "application/json",
        cookie: `learning_guide_admin_session=${token}`,
      },
      body: JSON.stringify({ status: "published", expectedUpdatedAt: drafted.updatedAt }),
    }), { params: Promise.resolve({ courseId: drafted.id }) });
    assert.equal(response.status, 200, await response.clone().text());
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.course.status, "published");
    assert.equal(body.course.categoryId, "european-humanities");
  } finally {
    process.chdir(cwd);
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
