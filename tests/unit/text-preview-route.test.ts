import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";

test("public Lesson server props exclude hidden text and media before signing, and only live access receives the complete Lesson", async () => {
  const course = { id: "course", slug: "course", title: "Course", category: "Science", status: "published", sections: [{ lessons: [{ id: "public", title: "Lesson", body: "LEGACY-SECRET", isPublic: true, durationMinutes: 2, contents: [1, 2, 3].map(index => ({ id: `text-${index}`, title: `Point ${index}`, type: "text", mode: "lecture", html: `<p>POINT-${index}-SECRET</p>`, nodes: index === 3 ? [{ id: "hidden-exhibit", title: "Hidden", type: "image", url: "https://media.test/hidden-image.jpg", triggerTime: 0 }] : [] })) }, { id: "private", title: "Private", isPublic: false, body: "PRIVATE-SECRET", contents: [] }] }] };
  const state = { user: { id: "user", nickname: "Learner" } as unknown, allowed: false, course: course as unknown, signed: [] as unknown[] };
  (globalThis as unknown as { textPreviewRoute: unknown }).textPreviewRoute = state;
  const bundle = await build({ entryPoints: ["app/[locale]/portal/courses/[slug]/public-lesson/page.tsx"], bundle: true, write: false, platform: "node", format: "cjs", jsx: "automatic", external: ["react/jsx-runtime"], plugins: [{ name: "route-dependencies", setup(b) {
    b.onResolve({ filter: /next\/navigation|services\/(productStore|productAuth|courseMediaSigning|persistence\/s3)$|components\/portal\/(PreviewLessonView|PortalHeader|CourseThumbnail)$/ }, args => ({ path: args.path, namespace: "mock" }));
    b.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents:
      args.path === "next/navigation" ? "export function redirect(url){throw new Error('redirect:'+url)};export function notFound(){throw new Error('not-found')}"
      : args.path.endsWith("productStore") ? "export async function getProductCourse(){return globalThis.textPreviewRoute.course};export function publicFirstLesson(course){return course.sections[0].lessons[0]};export async function checkEntitlement(){return {allowed:globalThis.textPreviewRoute.allowed}};export async function getCourseLearningMode(){return 'text'};export async function getLearningOverview(){return {courses:[]}};export async function listPublishedCourses(){return []}"
      : args.path.endsWith("productAuth") ? "export async function currentProductUser(){return globalThis.textPreviewRoute.user}"
      : args.path.endsWith("courseMediaSigning") ? "export async function signCourseMediaReferences(value){globalThis.textPreviewRoute.signed.push(value);return value}"
      : args.path.endsWith("/s3") ? "export async function signCourseMediaUrl(url){return url}"
      : args.path.endsWith("CourseThumbnail") ? "export function courseImageFor(){return '/fallback.jpg'}"
      : "export const PreviewLessonView=()=>null;export const PortalHeader=()=>null;" }));
  } }] });
  await mkdir("test-results/text-preview", { recursive: true });
  const filename = path.resolve("test-results/text-preview/route.cjs"); await writeFile(filename, bundle.outputFiles[0].text);
  const route = createRequire(import.meta.url)(filename).default;
  const invoke = (locale = "en-GB", lessonId = "public") => route({ params: Promise.resolve({ locale, slug: "course" }), searchParams: Promise.resolve({ lessonId, viewMode: "text" }) });
  for (const locale of ["en-GB", "zh-CN"]) {
    const props = (await invoke(locale)).props.children[1].props;
    assert.equal(props.entitled, false); assert.equal(props.textPreview.rule, "third-point"); assert.equal(props.nextHref, null);
    assert.ok(!JSON.stringify(props).includes("POINT-3-SECRET")); assert.ok(!JSON.stringify(props).includes("LEGACY-SECRET")); assert.ok(!JSON.stringify(props).includes("hidden-image"));
    assert.ok(!JSON.stringify(state.signed).includes("hidden-image"), "locked media must be removed before issuing signatures");
    state.allowed = true;
    const entitled = (await invoke(locale)).props.children[1].props;
    assert.equal(entitled.textPreview, undefined); assert.equal(entitled.trialGate, undefined); assert.match(JSON.stringify(entitled.lesson), /POINT-3-SECRET/);
    assert.equal(entitled.nextHref, `/${locale}/account/learn/course?lessonId=private`);
    state.allowed = false; state.signed = [];
  }
  state.user = null; await assert.rejects(invoke(), /redirect:.*sign-in/);
  state.user = { id: "user" }; await assert.rejects(invoke("en-GB", "private"), /not-found/);
  state.course = { ...course, status: "draft" }; await assert.rejects(invoke(), /not-found/);
  delete (globalThis as unknown as { textPreviewRoute?: unknown }).textPreviewRoute;
});
