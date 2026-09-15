import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  COURSE_AMOUNT_MINOR,
  COURSE_ID,
  SERVER_AMOUNT_MINOR,
  callRoute,
  clearCookies,
  isolate,
  jsonRequest
} from "./harness";

let restore: () => Promise<void>;
let portalCourses: typeof import("../../app/api/portal/courses/route");
let portalCourse: typeof import("../../app/api/portal/courses/[slug]/route");
let entitlements: typeof import("../../app/api/entitlements/check/route");

before(async () => {
  restore = (await isolate("lg-io-portal-")).restore;
  portalCourses = await import("../../app/api/portal/courses/route");
  portalCourse = await import("../../app/api/portal/courses/[slug]/route");
  entitlements = await import("../../app/api/entitlements/check/route");
});

after(async () => {
  await restore();
});

async function getCoursePage(slug: string) {
  const request = jsonRequest("GET", `http://localhost/api/portal/courses/${slug}`);
  return portalCourse.GET(request, { params: Promise.resolve({ slug }) });
}

test("UC-PORTAL-1 functional: GET /api/portal/courses is 200 and lists only published courses", async () => {
  clearCookies();
  const response = await callRoute(portalCourses.GET, jsonRequest("GET", "http://localhost/api/portal/courses"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.ok(Array.isArray(body.courses));
  assert.ok(body.courses.length > 0);
  assert.ok(body.courses.every((course: { status?: string }) => course.status === "published"));
  assert.ok(body.courses.some((course: { slug?: string; id?: string }) => course.slug === COURSE_ID || course.id === COURSE_ID));
  assert.ok(!body.courses.some((course: { slug?: string; id?: string; status?: string }) => (
    course.status === "draft" || course.slug === "unpublished-fabricated" || course.id === "unpublished-fabricated"
  )));
});

test("UC-PORTAL-1 tourist: portal courses are public; GET /api/entitlements/check is still 401", async () => {
  clearCookies();
  const courses = await callRoute(portalCourses.GET, jsonRequest("GET", "http://localhost/api/portal/courses"));
  assert.equal(courses.status, 200);
  const check = await callRoute(
    entitlements.GET,
    jsonRequest("GET", `http://localhost/api/entitlements/check?courseId=${COURSE_ID}`)
  );
  assert.equal(check.status, 401);
});

test("UC-PORTAL-1 negative: an unpublished slug is not presented as a published page", async () => {
  clearCookies();
  const response = await getCoursePage("unpublished-fabricated");
  assert.ok([200, 404].includes(response.status));
  const body = await response.json();
  const page = body.page ?? body;
  assert.notEqual(page.pageState, "available");
  assert.notEqual(page.identity?.title, "unpublished-fabricated");
  if (page.pageState === "failed") {
    assert.equal(page.identity, null);
  }
});

test("UC-PORTAL-1 functional: published course detail identity and syllabus come from the store", async () => {
  clearCookies();
  const response = await getCoursePage(COURSE_ID);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  const page = body.page;
  assert.equal(page.pageState, "available");
  assert.equal(page.identity.title, "Epicureanism");
  assert.equal(page.identity.track, "European Humanities");
  assert.equal(page.accessState, "none");
  const preview = page.syllabus.find((item: { access: string }) => item.access === "previewable");
  const locked = page.syllabus.find((item: { access: string }) => item.access === "locked");
  assert.ok(preview);
  assert.equal(preview.openable, true);
  assert.ok(locked);
  assert.equal(locked.openable, false);
});

test("UC-PORTAL-1 functional: GET /api/portal/plans amounts are server catalogue values", async () => {
  clearCookies();
  const plansApi = await import("../../app/api/portal/plans/route");
  const response = await callRoute(plansApi.GET, jsonRequest("GET", "http://localhost/api/portal/plans"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.ok(Array.isArray(body.plans));
  const course = body.plans.find((plan: { id: string }) => plan.id === "epicureanism-pc-6");
  const everything = body.plans.find((plan: { id: string }) => plan.id === "everything-pc-6");
  assert.ok(course);
  assert.ok(everything);
  assert.equal(course.amountMinor, COURSE_AMOUNT_MINOR);
  assert.equal(everything.amountMinor, SERVER_AMOUNT_MINOR);
  assert.equal(course.currency, "usd");
  assert.equal(typeof course.amountMinor, "number");
});

test("UC-PORTAL-1 edge: locale query does not invent unpublished courses or client prices", async () => {
  clearCookies();
  const plansApi = await import("../../app/api/portal/plans/route");
  const en = await callRoute(portalCourses.GET, jsonRequest("GET", "http://localhost/api/portal/courses?locale=en-GB"));
  const zh = await callRoute(portalCourses.GET, jsonRequest("GET", "http://localhost/api/portal/courses?locale=zh-CN"));
  assert.equal(en.status, 200);
  assert.equal(zh.status, 200);
  const enBody = await en.json();
  const zhBody = await zh.json();
  assert.deepEqual(
    enBody.courses.map((course: { id: string; status: string }) => [course.id, course.status]),
    zhBody.courses.map((course: { id: string; status: string }) => [course.id, course.status])
  );
  assert.ok(enBody.courses.every((course: { status?: string }) => course.status === "published"));

  const priced = await callRoute(
    plansApi.GET,
    jsonRequest("GET", "http://localhost/api/portal/plans?courseId=epicureanism&amountMinor=1")
  );
  const plans = (await priced.json()).plans as Array<{ id: string; amountMinor: number }>;
  assert.ok(plans.every((plan) => plan.amountMinor !== 1));
  assert.ok(plans.some((plan) => plan.id === "epicureanism-pc-6" && plan.amountMinor === COURSE_AMOUNT_MINOR));
});
