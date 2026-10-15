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
      builder.onResolve({ filter: /^(next\/(image|link|navigation)|@\/components\/portal\/|@\/services\/)/ }, args => ({ path: args.path, namespace: "mock" }));
      builder.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents:
        args.path.endsWith(".css") ? "export default {}"
        : args.path.endsWith("productStore") ? `
          export async function getProductCourse(){return {id:'course',sections:[{lessons:globalThis.modePageState.lessons}]}};
          export async function getCourseLearningMode(){return globalThis.modePageState.savedMode};
          export async function listPlans(){return []};
          export async function getCoursePage(){return {pageState:globalThis.modePageState.pageState,identity:{title:'Course',track:'Art',lessonCount:1,totalMinutes:1},syllabus:[{lessonId:'lesson',title:'Lesson',openable:true,access:'previewable'}],cta:'start_preview',accessState:'none'}};
        ` : args.path.endsWith("productAuth") ? "export async function currentProductUser(){return globalThis.modePageState.user}"
        : args.path.endsWith("/s3") ? "export async function signCourseMediaUrl(){return ''}"
        : args.path === "next/navigation" ? "export function redirect(url){throw new Error('redirect:'+url)}"
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
  function assertPlainLessonTitles(node: any): void {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(assertPlainLessonTitles); return; }
    if (node.type === "h3" && Array.isArray(node.props.children) && node.props.children[0]?.type === "span") {
      assert.equal(typeof node.props.children[1],"string","syllabus lesson title must not be a navigation link");
    }
    assertPlainLessonTitles(node.props?.children);
  }
  for (const locale of ["en-GB", "zh-CN"]) for (const user of [null, { id: "learner" }]) {
    state.user = user; state.savedMode = null; state.pageState = "available";
    const render = (lessonEntry?: string) => page({ params: Promise.resolve({ locale, slug: "course" }), searchParams: Promise.resolve({ lessonEntry }) });
    for (const lessons of [
      [{ contents: [{ type: "video" }, { type: "text", active: false }] }],
      [{ contents: [{ type: "pdf" }] }], [{ body: "Legacy reading" }], [],
    ]) { state.lessons = lessons; assert.equal(hasChooser(await render()), false); }
    state.lessons = [{ contents: [{ type: "video" }] }, { contents: [{ type: "text" }] }];
    assert.equal(hasChooser(await render()), false);
    assertPlainLessonTitles(await render());
    assert.equal(hasChooser(await render("invalid")), false);
    if (user) {
      assert.equal(hasChooser(await render("lesson")), true);
      state.savedMode = "video";
      await assert.rejects(()=>render("lesson"), /redirect:.*public-lesson.*lessonId=lesson/);
      assert.equal(hasChooser(await render()), false); state.savedMode = null;
    } else {
      await assert.rejects(()=>render("lesson"), error=> {
        const url=new URL((error as Error).message.replace("redirect:",""),"https://example.test");
        assert.equal(url.pathname,`/${locale}/portal/sign-in`);
        assert.equal(url.searchParams.get("returnTo"),`/${locale}/portal/courses/course?lessonEntry=lesson`);
        return true;
      });
    }
    state.pageState = "withdrawn"; assert.equal(hasChooser(await render()), false);
  }
});
