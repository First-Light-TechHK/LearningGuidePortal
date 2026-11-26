import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { isolate } from "../io/harness";
import { resetAdminCatalogueForTests } from "../../services/adminCatalogue";
import { resetAdminCourseMirrorForTests } from "../../services/adminCourseMirror";
import { AdminMediaError, proxyAdminCourseMedia } from "../../services/adminCourseMedia";

const ADMIN_ID = "4d22b6a5-c091-4fc1-90d5-1c16bf2cb1b2";
const DETAIL = {
  id: ADMIN_ID,
  slug: "modeling-life",
  title: "Modeling life",
  category: "Science",
  sections: [
    {
      id: "all",
      title: "Lessons",
      lessons: [
        {
          id: "public-lesson",
          title: "Public",
          durationSeconds: 600,
          isPublic: true,
          contents: [
            { id: "c1", type: "video", mode: "lecture", url: `/api/portal/v1/media/${ADMIN_ID}/assets/asset-public`, nodes: [
              { id: "n1", title: "n1", type: "image", url: `/api/portal/v1/media/${ADMIN_ID}/assets/asset-node`, triggerTime: 0 },
            ] },
          ],
        },
        {
          id: "private-lesson",
          title: "Private",
          durationSeconds: 600,
          isPublic: false,
          contents: [
            { id: "c2", type: "video", mode: "lecture", url: `/api/portal/v1/media/${ADMIN_ID}/assets/asset-private`, nodes: [] },
          ],
        },
      ],
    },
  ],
};

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; resetAdminCatalogueForTests(); resetAdminCourseMirrorForTests(); });

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

async function seedMirror() {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/portal/v1/media/")) throw new Error("media must not be fetched while seeding");
    if (url.includes("/api/portal/v1/courses?limit=")) return json({ success: true, data: [DETAIL] });
    if (url.endsWith(`/api/portal/v1/courses/${ADMIN_ID}`)) return json({ success: true, data: DETAIL });
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  const store = await import("../../services/productStore");
  await store.listPublishedCourses();
  await store.getProductCourse("modeling-life");
  return store;
}

function mediaFetch(handler: (url: string, init?: RequestInit) => Response) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.includes("/api/portal/v1/media/")) throw new Error(`unexpected fetch ${url}`);
    return handler(url, init);
  }) as typeof fetch;
}

async function withAdminEnv(run: () => Promise<void>) {
  const { restore } = await isolate("lg-admin-media-");
  try {
    process.env.PORTAL_COURSE_SOURCE = "admin";
    process.env.ADMIN_PORTAL_BASE_URL = "https://admin.sandbox.test";
    process.env.ADMIN_PORTAL_API_TOKEN = "service-token";
    process.env.ADMIN_PORTAL_CACHE_TTL_SECONDS = "0";
    resetAdminCourseMirrorForTests();
    await run();
  } finally {
    await restore();
  }
}

test("cover is public and streams from Admin", async () => {
  await withAdminEnv(async () => {
    await seedMirror();
    let seenKey: string | null = null;
    mediaFetch((url, init) => {
      assert.match(url, new RegExp(`/api/portal/v1/media/${ADMIN_ID}/cover$`));
      seenKey = (init?.headers as Record<string, string>)["X-API-Key"] ?? null;
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/png", "content-length": "3" } });
    });

    const request = new Request(`https://portal.test/api/admin-course-media/${ADMIN_ID}/cover`);
    const response = await proxyAdminCourseMedia(request, null, "cover", ADMIN_ID);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(seenKey, "service-token", "the service token stays server-side");
  });
});

test("a public-lesson asset is readable without purchase; a private asset is refused", async () => {
  await withAdminEnv(async () => {
    await seedMirror();
    mediaFetch(() => new Response(new Uint8Array([9]), { status: 200, headers: { "content-type": "video/mp4" } }));

    const publicRequest = new Request(`https://portal.test/api/admin-course-media/${ADMIN_ID}/assets/asset-public`);
    const publicResponse = await proxyAdminCourseMedia(publicRequest, null, "asset", ADMIN_ID, "asset-public");
    assert.equal(publicResponse.status, 200);

    const nodeRequest = new Request(`https://portal.test/api/admin-course-media/${ADMIN_ID}/assets/asset-node`);
    assert.equal((await proxyAdminCourseMedia(nodeRequest, null, "asset", ADMIN_ID, "asset-node")).status, 200, "nodes of the preview lesson are public too");

    const privateRequest = new Request(`https://portal.test/api/admin-course-media/${ADMIN_ID}/assets/asset-private`);
    await assert.rejects(
      proxyAdminCourseMedia(privateRequest, null, "asset", ADMIN_ID, "asset-private"),
      error => error instanceof AdminMediaError && error.status === 403,
    );
  });
});

test("Range and 404/401 are passed through or classified", async () => {
  await withAdminEnv(async () => {
    await seedMirror();

    let forwardedRange: string | null = null;
    mediaFetch((_url, init) => {
      forwardedRange = (init?.headers as Record<string, string>).Range ?? null;
      return new Response(new Uint8Array([5]), { status: 206, headers: { "content-range": "bytes 0-0/100", "accept-ranges": "bytes", "content-type": "video/mp4" } });
    });
    const rangeRequest = new Request(`https://portal.test/api/admin-course-media/${ADMIN_ID}/assets/asset-public`, { headers: { range: "bytes=0-0" } });
    const ranged = await proxyAdminCourseMedia(rangeRequest, null, "asset", ADMIN_ID, "asset-public");
    assert.equal(ranged.status, 206);
    assert.equal(ranged.headers.get("content-range"), "bytes 0-0/100");
    assert.equal(forwardedRange, "bytes=0-0", "the Range header is forwarded to Admin");

    mediaFetch(() => new Response("{}", { status: 404 }));
    await assert.rejects(
      proxyAdminCourseMedia(new Request("https://portal.test/x"), null, "cover", ADMIN_ID),
      error => error instanceof AdminMediaError && error.status === 404,
    );

    mediaFetch(() => new Response("{}", { status: 401 }));
    await assert.rejects(
      proxyAdminCourseMedia(new Request("https://portal.test/x"), null, "cover", ADMIN_ID),
      error => error instanceof AdminMediaError && error.status === 502,
    );
  });
});

test("the proxy is disabled when the projection switch is off", async () => {
  await withAdminEnv(async () => {
    process.env.PORTAL_COURSE_SOURCE = "store";
    await assert.rejects(
      proxyAdminCourseMedia(new Request("https://portal.test/x"), null, "cover", ADMIN_ID),
      error => error instanceof AdminMediaError && error.status === 404,
    );
  });
});
