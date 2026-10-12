import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

test("first course entry skips the chooser for single-mode courses in both locales", async () => {
  const state = { user: null as null | { id: string }, savedMode: null as string | null, pageState: "available", lessons: [] as unknown[] };
  (globalThis as unknown as { modePageState: unknown }).modePageState = state;
  const bundle = await build({
    entryPoints: ["app/[locale]/portal/courses/[slug]/page.tsx"], bundle: true, write: false,
    platform: "node", format: "cjs", jsx: "automatic", external: ["react/jsx-runtime"], loader: { ".css": "empty" },
    plugins: [{ name: "page-dependencies", setup(builder) {
      builder.onResolve({ filter: /^(next\/(image|link)|@\/components\/portal\/|@\/services\/)/ }, args => ({ path: args.path, namespace: "mock" }));
      builder.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents:
        args.path.endsWith(".css") ? "export default {}"
        : args.path.endsWith("productStore") ? `
          export async function getProductCourse(){return {id:'course',sections:[{lessons:globalThis.modePageState.lessons}]}};
          export async function getCourseLearningMode(){return globalThis.modePageState.savedMode};
          export async function listPlans(){return []};
          export async function getCoursePage(){return {pageState:globalThis.modePageState.pageState,identity:{title:'Course',track:'Art',lessonCount:1,totalMinutes:1},syllabus:[],cta:'start_preview',accessState:'none'}};
        ` : args.path.endsWith("productAuth") ? "export async function currentProductUser(){return globalThis.modePageState.user}"
        : args.path.endsWith("/s3") ? "export async function signCourseMediaUrl(){return ''}"
        : args.path.startsWith("next/") ? "export default 'mock-ui'"
        : `export const ${args.path.split("/").pop()}='${args.path.endsWith("CourseLearningModeDialog") ? "mode-dialog" : "mock-ui"}';`
      }));
    }}],
  });
  await mkdir("test-results/course-learning-mode", { recursive: true });
  const filename = path.resolve("test-results/course-learning-mode/page.cjs");
  await writeFile(filename, bundle.outputFiles[0].text);
  const page = createRequire(import.meta.url)(filename).default;
  function hasChooser(node: unknown): boolean {
    if (!node || typeof node !== "object") return false;
    if (Array.isArray(node)) return node.some(hasChooser);
    const element = node as { type?: unknown; props?: { children?: unknown } };
    return element.type === "mode-dialog" || hasChooser(element.props?.children);
  }
  for (const locale of ["en-GB", "zh-CN"]) for (const user of [null, { id: "learner" }]) {
    state.user = user; state.savedMode = null; state.pageState = "available";
    const render = () => page({ params: Promise.resolve({ locale, slug: "course" }), searchParams: Promise.resolve({ learningMode: "text" }) });
    for (const lessons of [
      [{ contents: [{ type: "video" }, { type: "text", active: false }] }],
      [{ contents: [{ type: "pdf" }] }], [{ body: "Legacy reading" }], [],
    ]) { state.lessons = lessons; assert.equal(hasChooser(await render()), false); }
    state.lessons = [{ contents: [{ type: "video" }] }, { contents: [{ type: "text" }] }];
    assert.equal(hasChooser(await render()), true);
    if (user) { state.savedMode = "video"; assert.equal(hasChooser(await render()), false); state.savedMode = null; }
    state.pageState = "withdrawn"; assert.equal(hasChooser(await render()), false);
  }
});
