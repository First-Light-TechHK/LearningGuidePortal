import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

test("course details wait for an explicit Lesson entry before showing the chooser in both locales", async () => {
  const state = { user: null as null | { id: string }, savedMode: null as string | null, entitled: false, pageState: "available", lessons: [] as unknown[] };
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
          export async function getLessonBookmarks(){return {bookmarks:{},versions:{}}};export async function getCourseLearningMode(){return globalThis.modePageState.savedMode};
          export async function listPlans(){return []};
          export async function getCoursePage(){const entitled=globalThis.modePageState.entitled;return {pageState:globalThis.modePageState.pageState,identity:{title:'Course',track:'Art',lessonCount:1,totalMinutes:1},syllabus:[{lessonId:'lesson',title:'Lesson',openable:true,access:entitled?'entitled':'previewable'}],cta:entitled?'continue_learning':'start_preview',accessState:entitled?'active':'none',actionLessonId:'lesson'}};
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
  function curriculumAction(node: any): any {
    if (!node || typeof node !== "object") return null;
    if (Array.isArray(node)) return node.map(curriculumAction).find(Boolean);
    if (node.props?.actionLessonId) return node;
    return curriculumAction(node.props?.children);
  }
  function assertPlainLessonTitles(node: any): void {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(assertPlainLessonTitles); return; }
    if (node.type === "h3" && Array.isArray(node.props.children) && node.props.children[0]?.type === "span") {
      const title = node.props.children[1];
      assert.equal(title.type, "span", "syllabus lesson title must remain plain text");
      assert.equal(title.props.children, "Lesson");
      assert.equal(title.props.title, "Lesson");
      assert.equal(title.props.href, undefined, "syllabus lesson title must not be a navigation link");
    }
    assertPlainLessonTitles(node.props?.children);
  }
  for (const locale of ["en-GB", "zh-CN"]) for (const user of [null, { id: "learner" }]) for (const entitled of user ? [false, true] : [false]) {
    state.user = user; state.savedMode = null; state.entitled = entitled; state.pageState = "available";
    const destination = entitled ? "account/learn/course" : "portal/courses/course/public-lesson";
    const render = (lessonEntry?: string) => page({ params: Promise.resolve({ locale, slug: "course" }), searchParams: Promise.resolve({ lessonEntry }) });
    for (const lessons of [
      [{ contents: [{ type: "video" }, { type: "text", active: false }] }],
      [{ contents: [{ type: "pdf" }] }], [{ body: "Legacy reading" }], [],
    ]) {
      state.lessons = lessons;
      assert.equal(hasChooser(await render()), false);
      if (user) await assert.rejects(() => render("lesson"), { message: `redirect:/${locale}/${destination}?lessonId=lesson` });
    }
    state.lessons = [{ contents: [{ type: "video" }] }, { contents: [{ type: "text" }] }];
    assert.equal(hasChooser(await render()), false, "opening details must not prompt, including after subscription");
    const detail = await render();
    assertPlainLessonTitles(detail);
    const action = curriculumAction(detail);
    assert.ok(action);
    assert.equal(action.props.href, user
      ? `/${locale}/portal/courses/course?lessonEntry=lesson`
      : `/${locale}/portal/sign-in?returnTo=${encodeURIComponent(`/${locale}/portal/courses/course`)}`);
    assert.equal(hasChooser(await render("invalid")), false);
    if (user) {
      assert.equal(hasChooser(await render("lesson")), true);
      state.savedMode = "video";
      await assert.rejects(()=>render("lesson"), { message: `redirect:/${locale}/${destination}?lessonId=lesson` });
      assert.equal(hasChooser(await render()), false); state.savedMode = null;
    } else {
      await assert.rejects(()=>render("lesson"), error=> {
        const url=new URL((error as Error).message.replace("redirect:",""),"https://example.test");
        assert.equal(url.pathname,`/${locale}/portal/sign-in`);
        assert.equal(url.searchParams.get("returnTo"),`/${locale}/portal/courses/course`);
        return true;
      });
    }
    state.pageState = "withdrawn"; assert.equal(hasChooser(await render()), false);
  }
});
