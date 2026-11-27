import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { isolate } from "../io/harness";
import { resetAdminCatalogueForTests } from "../../services/adminCatalogue";
import { resetAdminCourseMirrorForTests } from "../../services/adminCourseMirror";

const ADMIN_ID = "4d22b6a5-c091-4fc1-90d5-1c16bf2cb1b2";
const SUMMARY = { id: ADMIN_ID, slug: "modeling-life", title: "Modeling life", category: "Science" };
const EPICUREANISM_SUMMARY = { ...SUMMARY, slug: "epicureanism", title: "Admin Epicureanism" };
const DETAIL = {
  ...SUMMARY,
  shortDescription: "See how mathematics models life.",
  whatYouLearn: ["Model real systems."],
  sections: [{ id: "all", title: "Lessons", lessons: [{ id: "lesson-uuid-1", title: "State spaces", durationSeconds: 600, isPublic: true, contents: [] }] }],
};

type FetchState = {
  list: typeof SUMMARY[];
  detail: typeof DETAIL | null;
  fail: boolean;
};

const originalFetch = globalThis.fetch;
const restoreEnv = () => { globalThis.fetch = originalFetch; resetAdminCatalogueForTests(); resetAdminCourseMirrorForTests(); };

function installProjection(state: FetchState) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (state.fail) throw new Error("admin down");
    if (url.includes("/api/portal/v1/courses?limit=")) {
      return new Response(JSON.stringify({ success: true, data: state.list }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (state.detail && url.endsWith(`/api/portal/v1/courses/${ADMIN_ID}`)) {
      return new Response(JSON.stringify({ success: true, data: state.detail }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
}

afterEach(restoreEnv);

test("mirrors Admin's online course, fetches detail on read and degrades without losing it", async () => {
  const { restore } = await isolate("lg-admin-mirror-");
  try {
    process.env.PORTAL_COURSE_SOURCE = "admin";
    process.env.ADMIN_PORTAL_BASE_URL = "https://admin.sandbox.test";
    process.env.ADMIN_PORTAL_API_TOKEN = "service-token";
    process.env.ADMIN_PORTAL_CACHE_TTL_SECONDS = "0";
    resetAdminCourseMirrorForTests();

    const state: FetchState = { list: [SUMMARY], detail: DETAIL, fail: false };
    installProjection(state);

    const store = await import("../../services/productStore");

    const catalogue = await store.listPublishedCourses();
    const mirrored = catalogue.find(course => course.adminCourseId === ADMIN_ID);
    assert.ok(mirrored, "the Admin course appears in the catalogue");
    assert.equal(mirrored!.id, "modeling-life");
    assert.equal(mirrored!.origin, "admin");

    const course = await store.getProductCourse("modeling-life");
    assert.ok(course);
    assert.equal(course!.sections.length, 1, "detail is fetched on the detail read");
    assert.equal(course!.sections[0]!.lessons[0]!.id, "lesson-uuid-1");

    // Admin goes away: the previous mirror must survive.
    state.fail = true;
    const degradedCatalogue = await store.listPublishedCourses();
    assert.ok(degradedCatalogue.some(item => item.adminCourseId === ADMIN_ID), "catalogue keeps the last mirror");
    const degradedCourse = await store.getProductCourse("modeling-life");
    assert.equal(degradedCourse!.sections.length, 1, "detail keeps the last mirror");

    // The course disappears from the projection: archived, not deleted.
    state.fail = false;
    state.list = [];
    const { syncCatalogueIfStale } = await import("../../services/adminCourseMirror");
    await syncCatalogueIfStale(true);
    const afterRemoval = await store.listPublishedCourses();
    assert.equal(afterRemoval.some(item => item.adminCourseId === ADMIN_ID), false, "withdrawn course leaves the catalogue");
    const archived = (await store.readProductData()).courses.find(item => item.adminCourseId === ADMIN_ID);
    assert.equal(archived!.status, "archived", "study records still reference the row");
  } finally {
    await restore();
  }
});

test("switching the source back to store hides mirrored rows", async () => {
  const { restore } = await isolate("lg-admin-mirror-store-");
  try {
    process.env.PORTAL_COURSE_SOURCE = "admin";
    process.env.ADMIN_PORTAL_BASE_URL = "https://admin.sandbox.test";
    process.env.ADMIN_PORTAL_API_TOKEN = "service-token";
    process.env.ADMIN_PORTAL_CACHE_TTL_SECONDS = "0";
    resetAdminCourseMirrorForTests();
    installProjection({ list: [SUMMARY], detail: DETAIL, fail: false });

    const store = await import("../../services/productStore");
    await store.listPublishedCourses();
    assert.ok((await store.listPublishedCourses()).some(course => course.origin === "admin"));

    process.env.PORTAL_COURSE_SOURCE = "store";
    const localOnly = await store.listPublishedCourses();
    assert.equal(localOnly.some(course => course.origin === "admin"), false, "store mode is exactly today's behaviour");
  } finally {
    await restore();
  }
});

test("an archived Admin course shadows a same-slug local copy in the catalogue and detail route", async () => {
  const { restore } = await isolate("lg-admin-mirror-archive-collision-");
  try {
    process.env.PORTAL_COURSE_SOURCE = "admin";
    process.env.ADMIN_PORTAL_BASE_URL = "https://admin.sandbox.test";
    process.env.ADMIN_PORTAL_API_TOKEN = "service-token";
    process.env.ADMIN_PORTAL_CACHE_TTL_SECONDS = "0";
    resetAdminCourseMirrorForTests();

    const state: FetchState = { list: [EPICUREANISM_SUMMARY], detail: null, fail: false };
    installProjection(state);
    const store = await import("../../services/productStore");
    assert.ok((await store.listPublishedCourses()).some(course => course.slug === "epicureanism" && course.origin === "admin"));

    state.list = [];
    const { syncCatalogueIfStale } = await import("../../services/adminCourseMirror");
    await syncCatalogueIfStale(true);

    assert.equal((await store.listPublishedCourses()).some(course => course.slug === "epicureanism"), false,
      "the local published copy must not resurrect an Admin course after Admin withdraws it");
    assert.equal(await store.getProductCourse("epicureanism"), null,
      "the detail route must not fall through to the local same-slug copy");
    assert.equal((await store.getCoursePage("epicureanism")).pageState, "withdrawn",
      "the tombstone should render as withdrawn rather than expose the local copy");
  } finally {
    await restore();
  }
});
