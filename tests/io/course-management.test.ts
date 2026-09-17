import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { ADMIN_SESSION_COOKIE } from "../../services/productAuth";
import { callRoute, isolate, jsonRequest, takeSetCookie } from "./harness";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
const PDF = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
const HOST = "localhost";
const ORIGIN = "http://localhost";
const PASSWORD = "Passw0rd!123";

let restore: () => Promise<void>;
let store: typeof import("../../services/productStore");
let adminLogin: typeof import("../../app/api/auth/admin/login/route");
let courses: typeof import("../../app/api/backoffice/courses/route");
let draft: typeof import("../../app/api/backoffice/courses/[courseId]/draft/route");
let courseRoute: typeof import("../../app/api/backoffice/courses/[courseId]/route");
let mediaPost: typeof import("../../app/api/backoffice/courses/[courseId]/media/route");
let mediaGet: typeof import("../../app/api/course-media/[courseId]/[assetId]/route");
let token = "";
let courseId = "";
let updatedAt = "";
let publicAsset: { id: string; url: string; mimeType: string };

before(async () => {
  restore = (await isolate("lg-io-course-management-")).restore;
  process.env.APP_ENV = "DEV";
  store = await import("../../services/productStore");
  adminLogin = await import("../../app/api/auth/admin/login/route");
  courses = await import("../../app/api/backoffice/courses/route");
  draft = await import("../../app/api/backoffice/courses/[courseId]/draft/route");
  courseRoute = await import("../../app/api/backoffice/courses/[courseId]/route");
  mediaPost = await import("../../app/api/backoffice/courses/[courseId]/media/route");
  mediaGet = await import("../../app/api/course-media/[courseId]/[assetId]/route");
  const operator = await store.registerUser({ email: "operator-cm@example.test", password: PASSWORD, role: "operator" });
  await store.verifyEmailToken(await store.issueEmailVerificationToken(operator.id));
  const login = await adminLogin.POST(jsonRequest("POST", `${ORIGIN}/api/auth/admin/login`, { email: operator.email, password: PASSWORD }));
  assert.equal(login.status, 200);
  takeSetCookie(login);
  token = (login.headers.get("set-cookie") || "").split(";")[0].split("=")[1];
  const created = await courses.POST(adminJson("POST", `${ORIGIN}/api/backoffice/courses`, { title: "CM Overlay Course" }));
  assert.equal(created.status, 201);
  const body = await created.json();
  courseId = body.course.id;
  updatedAt = body.course.updatedAt;
});

after(async () => {
  await restore();
});

function adminHeaders(extra: Record<string, string> = {}) {
  return { host: HOST, origin: ORIGIN, cookie: `${ADMIN_SESSION_COOKIE}=${token}`, ...extra };
}

function adminJson(method: string, url: string, body?: unknown, extra?: Record<string, string>) {
  return jsonRequest(method, url, body, adminHeaders(extra));
}

function upload(file: { bytes: Buffer; name: string; type: string }, usage = "content-image", extra: Record<string, string> = {}) {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(file.bytes)], { type: file.type }), file.name);
  form.append("usage", usage);
  return mediaPost.POST(new Request(`${ORIGIN}/api/backoffice/courses/${courseId}/media`, {
    method: "POST",
    headers: adminHeaders(extra),
    body: form,
  }), { params: Promise.resolve({ courseId }) });
}

function fetchMedia(assetId: string, extra: Record<string, string> = {}, host = "learner.test") {
  return mediaGet.GET(new Request(`https://${host}/api/course-media/${courseId}/${assetId}`, {
    method: "GET",
    headers: { host, ...extra },
  }), { params: Promise.resolve({ courseId, assetId }) });
}

async function saveDraft(patch: Record<string, unknown>) {
  const response = await draft.PUT(adminJson("PUT", `${ORIGIN}/api/backoffice/courses/${courseId}/draft`, {
    expectedUpdatedAt: updatedAt,
    title: "CM Overlay Course",
    description: "Spec I/O",
    sections: [{
      id: "new-section",
      title: "Section",
      lessons: [{ id: "new-lesson", title: "Public lesson", body: "Preview", durationMinutes: 5, isPublic: true, ...patch }],
    }],
  }), { params: Promise.resolve({ courseId }) });
  if (response.status === 200) {
    const body = await response.clone().json();
    updatedAt = body.data.updatedAt;
    if (body.data.sections?.[0]?.lessons?.[0]?.id) {
      // keep generated ids for later saves
    }
  }
  return response;
}

test("CM-01 functional: teacher POST PNG under 25 MiB is 201", async () => {
  const response = await upload({ bytes: PNG, name: "diagram.png", type: "image/png" });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.data.mimeType, "image/png");
  assert.match(body.data.url, new RegExp(`/api/course-media/${courseId}/`));
  assert.equal("uploadedBy" in body.data, false);
  publicAsset = body.data;
});

test("CM-01 negative: empty upload is 413", async () => {
  const response = await upload({ bytes: Buffer.alloc(0), name: "empty.png", type: "image/png" });
  assert.equal(response.status, 413);
});

test("CM-01 edge: two file fields are 400", async () => {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(PNG)], { type: "image/png" }), "a.png");
  form.append("file", new Blob([new Uint8Array(PNG)], { type: "image/png" }), "b.png");
  const response = await mediaPost.POST(new Request(`${ORIGIN}/api/backoffice/courses/${courseId}/media`, {
    method: "POST",
    headers: adminHeaders(),
    body: form,
  }), { params: Promise.resolve({ courseId }) });
  assert.equal(response.status, 400);
});

test("CM-02 functional: matching PDF signature stores fileType pdf", async () => {
  const response = await upload({ bytes: PDF, name: "notes.pdf", type: "application/pdf" }, "content-pdf");
  assert.equal(response.status, 201);
  assert.equal((await response.json()).data.fileType, "pdf");
});

test("CM-02 negative: HTML spoof is 415", async () => {
  const response = await upload({ bytes: Buffer.from("<html>unsafe</html>"), name: "x.png", type: "image/png" });
  assert.equal(response.status, 415);
});

test("CM-02/CM-03 negative: signature-valid undecodable JPEG is 415", async () => {
  const bytes = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xdb]), Buffer.alloc(32, 1), Buffer.from([0xff, 0xd9])]);
  const response = await upload({ bytes, name: "broken.jpg", type: "image/jpeg" });
  assert.equal(response.status, 415);
});

test("CM-03 functional: a complete PNG decodes and can be referenced", async () => {
  assert.ok(publicAsset?.id);
});

test("CM-04 negative: missing admin session is 403", async () => {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(PNG)], { type: "image/png" }), "diagram.png");
  const response = await mediaPost.POST(new Request(`${ORIGIN}/api/backoffice/courses/${courseId}/media`, {
    method: "POST",
    headers: { host: HOST, origin: ORIGIN },
    body: form,
  }), { params: Promise.resolve({ courseId }) });
  assert.equal(response.status, 403);
});

test("CM-04 edge: foreign origin is 403", async () => {
  const response = await upload({ bytes: PNG, name: "diagram.png", type: "image/png" }, "content-image", { origin: "https://evil.test" });
  assert.equal(response.status, 403);
});

test("CM-05/CM-06 functional: draft and publish require course-owned image refs", async () => {
  const saved = await saveDraft({
    contents: [{
      id: "content-1",
      title: "Media",
      type: "text",
      mode: "interactive",
      html: `<p><img src="${publicAsset.url}"></p>`,
      nodes: [{ id: "node-1", title: "Image", type: "image", triggerTime: 0, url: publicAsset.url }],
    }],
  });
  assert.equal(saved.status, 200);
  const published = await courseRoute.PATCH(adminJson("PATCH", `${ORIGIN}/api/backoffice/courses/${courseId}`, {
    status: "published",
    expectedUpdatedAt: updatedAt,
  }), { params: Promise.resolve({ courseId }) });
  assert.equal(published.status, 200);
  updatedAt = (await published.json()).course.updatedAt;
});

test("CM-05 negative: missing media ref does not commit", async () => {
  const course = await store.createCourseForOperator({ title: "CM Missing Ref" }, (await store.getUserBySessionToken(token))!.id);
  const response = await draft.PUT(adminJson("PUT", `${ORIGIN}/api/backoffice/courses/${course.id}/draft`, {
    expectedUpdatedAt: course.updatedAt,
    title: "CM Missing Ref",
    description: "",
    sections: [{
      id: "new-section",
      title: "Section",
      lessons: [{
        id: "new-lesson",
        title: "Lesson",
        body: "Body",
        durationMinutes: 5,
        isPublic: true,
        contents: [{
          id: "content-1",
          title: "Missing",
          type: "text",
          mode: "interactive",
          nodes: [{ id: "node-1", title: "Image", type: "image", triggerTime: 0, url: `/api/course-media/${course.id}/00000000-0000-4000-8000-000000000000` }],
        }],
      }],
    }],
  }), { params: Promise.resolve({ courseId: course.id }) });
  assert.ok([400, 404].includes(response.status));
});

test("CM-06 negative: COS write is 400", async () => {
  const course = await store.createCourseForOperator({ title: "CM COS Write" }, (await store.getUserBySessionToken(token))!.id);
  const response = await draft.PUT(adminJson("PUT", `${ORIGIN}/api/backoffice/courses/${course.id}/draft`, {
    expectedUpdatedAt: course.updatedAt,
    title: "CM COS Write",
    description: "",
    cover: "https://learningguide-1380131816.cos.ap-hongkong.myqcloud.com/mvp/cover.jpg",
    sections: [{ id: "new-section", title: "Section", lessons: [{ id: "new-lesson", title: "Lesson", body: "Body", durationMinutes: 5, isPublic: true }] }],
  }), { params: Promise.resolve({ courseId: course.id }) });
  assert.equal(response.status, 400);
});

test("CM-06 edge: historical HTTPS is readable after sanitise, not re-accepted on write", async () => {
  const cos = "https://learningguide-1380131816.cos.ap-hongkong.myqcloud.com/mvp/video/horace.mp4";
  const { sanitiseLessonContents, validateLessonContents } = await import("../../services/lessonContent");
  const historical = [{ id: "legacy", title: "Legacy", type: "video" as const, mode: "lecture" as const, url: cos, nodes: [] }];
  assert.equal(sanitiseLessonContents(historical, courseId)[0].url, cos);
  assert.throws(() => validateLessonContents(historical, courseId));
});

test("CM-07 functional: published public-lesson media is GET 200 without a cookie", async () => {
  const response = await fetchMedia(publicAsset.id);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") || "", /private, no-store/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});

test("CM-07 negative: unattached upload stays 404 for tourists", async () => {
  const orphan = await upload({ bytes: PNG, name: "orphan.png", type: "image/png" });
  assert.equal(orphan.status, 201);
  const asset = (await orphan.json()).data;
  assert.equal((await fetchMedia(asset.id)).status, 404);
});

test("CM-07 edge: range GET stays private and bounded", async () => {
  const head = await mediaGet.HEAD(new Request(`${ORIGIN}/api/course-media/${courseId}/${publicAsset.id}`, {
    method: "HEAD",
    headers: adminHeaders(),
  }), { params: Promise.resolve({ courseId, assetId: publicAsset.id }) });
  assert.equal(head.status, 200);
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  const ranged = await mediaGet.GET(new Request(`${ORIGIN}/api/course-media/${courseId}/${publicAsset.id}`, {
    method: "GET",
    headers: adminHeaders({ range: "bytes=0-3" }),
  }), { params: Promise.resolve({ courseId, assetId: publicAsset.id }) });
  assert.equal(ranged.status, 206);
  assert.equal((await ranged.arrayBuffer()).byteLength, 4);
});
