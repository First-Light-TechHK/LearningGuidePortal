import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { CourseMediaAsset, LessonContent } from "../../contracts/lesson-content";
import type { ProductUser } from "../../services/productStore";

const cwd = process.cwd();
const oldBackend = process.env.STORAGE_BACKEND;
const oldEnvironment = process.env.APP_ENV;
const oldAdminHosts = process.env.ADMIN_HOSTS;
const adminHost = "admin.media.test";
const learnerHost = "learner.media.test";
const adminCookie = "learning_guide_admin_session";
const learnerCookie = "learning_guide_session";
let directory: string;
let media: typeof import("../../services/courseMedia");
let store: typeof import("../../services/productStore");
let files: typeof import("../../services/fileStore");
let post: typeof import("../../app/api/backoffice/courses/[courseId]/media/route").POST;
let get: typeof import("../../app/api/course-media/[courseId]/[assetId]/route").GET;
let teacher: ProductUser, otherTeacher: ProductUser, student: ProductUser;
let teacherToken: string, teacherLearnerToken: string, otherToken: string, studentToken: string;
const courseId = "media-test-course";
const otherCourseId = "other-media-course";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
const obj = Buffer.from("# Triangle\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n");
const input = (bytes = png, name = "diagram.png", type = "image/png") => ({ bytes, name, type });
const contents = (asset: CourseMediaAsset): LessonContent[] => [{ id: "content-1", title: "Media", type: "text", mode: "interactive", nodes: [{ id: "node-1", title: "Image", type: "image", triggerTime: 0, url: asset.url }] }];

async function editFixture(edit: (data: Awaited<ReturnType<typeof store.ensureProductData>>) => void) {
  const data = await store.ensureProductData();
  edit(data);
  await files.atomicWriteJson(path.join(files.SYSTEM_ROOT, "learning_guide", "product.json"), data);
}

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "lg-course-media-"));
  process.chdir(directory); process.env.STORAGE_BACKEND = "local"; process.env.APP_ENV = "test";
  process.env.ADMIN_HOSTS = adminHost;
  store = await import("../../services/productStore");
  files = await import("../../services/fileStore");
  media = await import("../../services/courseMedia");
  post = (await import("../../app/api/backoffice/courses/[courseId]/media/route")).POST;
  get = (await import("../../app/api/course-media/[courseId]/[assetId]/route")).GET;
  const base = { email: "teacher@media.test", passwordHash: null, nickname: "Teacher", locale: "en-GB" as const, status: "active" as const, emailVerifiedAt: new Date().toISOString(), createdAt: new Date().toISOString() };
  teacher = { ...base, id: "media-teacher", role: "teacher" };
  otherTeacher = { ...base, id: "media-other-teacher", email: "other@media.test", role: "teacher" };
  student = { ...base, id: "media-student", email: "student@media.test", role: "student" };
  await editFixture(data => {
    data.users.push(teacher, otherTeacher, student);
    data.courses.push(...[courseId, otherCourseId].map(id => ({ id, slug: id, title: id, description: "Test", status: "draft" as const, authorIds: [id === courseId ? teacher.id : otherTeacher.id], sections: [{ id: "section", title: "Section", lessons: [{ id: "preview", title: "Preview", body: "", isPublic: true, durationMinutes: 5, contents: [] }, { id: "paid", title: "Paid", body: "", isPublic: false, durationMinutes: 5, contents: [] }] }], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })));
  });
  teacherToken = (await store.createSession(teacher.id)).token;
  teacherLearnerToken = (await store.createSession(teacher.id)).token;
  otherToken = (await store.createSession(otherTeacher.id)).token;
  studentToken = (await store.createSession(student.id)).token;
});

after(async () => {
  process.chdir(cwd);
  if (oldBackend === undefined) delete process.env.STORAGE_BACKEND; else process.env.STORAGE_BACKEND = oldBackend;
  if (oldEnvironment === undefined) delete process.env.APP_ENV; else process.env.APP_ENV = oldEnvironment;
  if (oldAdminHosts === undefined) delete process.env.ADMIN_HOSTS; else process.env.ADMIN_HOSTS = oldAdminHosts;
  await rm(directory, { recursive: true, force: true });
});

function fetchAsset(asset: CourseMediaAsset, token = "", headers: Record<string, string> = {}, id = asset.courseId, method = "GET", transport: { host?: string; cookieName?: string } = {}) {
  const host = transport.host || learnerHost, cookieName = transport.cookieName || learnerCookie;
  return get(new Request(`https://${host}/api/course-media/${id}/${asset.id}`, { method, headers: { host, cookie: `${cookieName}=${token}`, ...headers } }), { params: Promise.resolve({ courseId: id, assetId: asset.id }) });
}

function fetchAdminAsset(asset: CourseMediaAsset, token: string, headers: Record<string, string> = {}, id = asset.courseId, method = "GET") {
  return fetchAsset(asset, token, headers, id, method, { host: adminHost, cookieName: adminCookie });
}

test("validates raster/PDF/audio/OBJ formats and refuses extension, MIME and signature spoofing", () => {
  assert.equal(media.validateCourseMediaFile(input()).fileType, "image");
  assert.equal(media.validateCourseMediaFile(input(obj, "mesh.obj", "")).fileType, "model3d");
  assert.equal(media.validateCourseMediaFile(input(Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n"), "document.pdf", "application/pdf")).fileType, "pdf");
  assert.equal(media.validateCourseMediaFile(input(Buffer.from([0xff, 0xfb, 0x90, 0x64, 0, 0]), "sound.mp3", "audio/mpeg")).fileType, "audio");
  for (const file of [input(Buffer.from("<script>alert(1)</script>")), input(png, "file.svg", "image/svg+xml"), input(png, "file.png", "text/html"), input(png, "../file.png"), input(png, "file.exe"), input(Buffer.from("%PDF-"), "fake.pdf", "application/pdf"), input(Buffer.from("ID3"), "fake.mp3", "audio/mpeg"), input(Buffer.concat([obj, Buffer.from("mtllib https://evil.test/a.mtl\n")]), "mesh.obj", "text/plain"), input(Buffer.from("v 0 0 0\nf 1 2 3\n"), "mesh.obj", "text/plain")]) {
    assert.throws(() => media.validateCourseMediaFile(file), media.CourseMediaError);
  }
  assert.throws(() => media.validateCourseMediaFile(input(Buffer.alloc(media.COURSE_MEDIA_MAX_BYTES + 1))), { status: 413 });
});

test("GLB validation requires a self-contained binary v2 container", () => {
  const makeGlb = (uri?: string) => {
    const json = JSON.stringify({ asset: { version: "2.0" }, meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3" }], bufferViews: [{ buffer: 0, byteLength: 36 }], buffers: [{ byteLength: 36, ...(uri ? { uri } : {}) }] });
    const text = Buffer.from(json.padEnd(Math.ceil(json.length / 4) * 4, " "));
    const binary = Buffer.alloc(36);
    const header = Buffer.alloc(20); header.write("glTF"); header.writeUInt32LE(2, 4); header.writeUInt32LE(28 + text.length + binary.length, 8); header.writeUInt32LE(text.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
    const chunk = Buffer.alloc(8); chunk.writeUInt32LE(binary.length); chunk.writeUInt32LE(0x004e4942, 4);
    return Buffer.concat([header, text, chunk, binary]);
  };
  assert.equal(media.validateCourseMediaFile(input(makeGlb(), "model.glb", "model/gltf-binary")).fileType, "model3d");
  assert.throws(() => media.validateCourseMediaFile(input(makeGlb("https://evil.test/texture"), "model.glb", "model/gltf-binary")), media.CourseMediaError);
  const broken = makeGlb(); broken.writeUInt32LE(0, 8);
  assert.throws(() => media.validateCourseMediaFile(input(broken, "model.glb", "model/gltf-binary")), media.CourseMediaError);
});

test("upload route checks admin host/cookie, teacher ownership, origin and stores one private asset", async () => {
  const invoke = (token: string, origin = `https://${adminHost}`, file = input(), host = adminHost, cookieName = adminCookie) => {
    const form = new FormData(); form.append("file", new Blob([new Uint8Array(file.bytes)], { type: file.type }), file.name); form.append("usage", "content-image");
    return post(new Request(`https://${host}/api/backoffice/courses/${courseId}/media`, { method: "POST", headers: { host, origin, cookie: `${cookieName}=${token}` }, body: form }), { params: Promise.resolve({ courseId }) });
  };
  assert.equal((await invoke("")).status, 403);
  assert.equal((await invoke(studentToken)).status, 403);
  assert.equal((await invoke(otherToken)).status, 403);
  assert.equal((await invoke(teacherToken, "https://evil.test")).status, 403);
  assert.equal((await invoke(teacherToken, "")).status, 403);
  assert.equal((await invoke(teacherToken, `https://${adminHost}`, input(Buffer.from("<html>unsafe</html>")))).status, 415);
  assert.equal((await invoke(teacherLearnerToken, `https://${adminHost}`, input(), adminHost, learnerCookie)).status, 403);
  assert.equal((await invoke(teacherLearnerToken, `https://${learnerHost}`, input(), learnerHost, learnerCookie)).status, 403);
  assert.equal((await invoke(teacherToken, `https://${learnerHost}`, input(), learnerHost, adminCookie)).status, 403);
  const response = await invoke(teacherToken);
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.ok, true);
  assert.equal(result.data.mimeType, "image/png");
  assert.match(result.data.url, /^\/api\/course-media\/media-test-course\//);
  assert.equal("uploadedBy" in result.data, false);
  const retrieved = await fetchAdminAsset(result.data, teacherToken);
  assert.equal(retrieved.status, 200);
  assert.deepEqual(Buffer.from(await retrieved.arrayBuffer()), png);
  assert.equal((await fetchAsset(result.data)).status, 404);
  assert.equal((await fetchAdminAsset(result.data, otherToken)).status, 404);
  assert.equal((await fetchAdminAsset(result.data, otherToken, {}, otherCourseId)).status, 404);
});

test("public preview allows only referenced assets of a published course; paid access never exposes unattached uploads", async () => {
  const preview = await media.uploadCourseMedia(teacher, courseId, input());
  const paid = await media.uploadCourseMedia(teacher, courseId, input());
  const orphan = await media.uploadCourseMedia(teacher, courseId, input());
  await editFixture(data => {
    const course = data.courses.find(course => course.id === courseId)!;
    course.sections[0].lessons[0].contents = contents(preview);
    course.sections[0].lessons[1].contents = contents(paid);
  });
  assert.equal((await fetchAsset(preview)).status, 404);
  await editFixture(data => { data.courses.find(course => course.id === courseId)!.status = "published"; });
  assert.equal((await fetchAsset(preview)).status, 200);
  assert.equal((await fetchAsset(preview, studentToken)).status, 200);
  assert.equal((await fetchAsset(paid, studentToken)).status, 404);
  await editFixture(data => {
    data.entitlements.push({ id: "media-access", userId: student.id, courseId, scope: "course", scopeId: courseId, device: "pc", source: "purchase", state: "active", validTo: new Date(Date.now() + 3600_000).toISOString() });
  });
  assert.equal((await fetchAsset(paid, studentToken)).status, 200);
  assert.equal((await fetchAsset(orphan, studentToken)).status, 404);
  assert.equal((await fetchAsset(orphan)).status, 404);
  await editFixture(data => { data.entitlements.find(item => item.id === "media-access")!.validTo = new Date(0).toISOString(); });
  assert.equal((await fetchAsset(paid, studentToken)).status, 404);
  await editFixture(data => { data.courses.find(course => course.id === courseId)!.status = "draft"; });
  assert.equal((await fetchAsset(preview)).status, 404);
});

test("public HTML references are parsed after sanitisation, not substring-matched", async () => {
  const asset = await media.uploadCourseMedia(teacher, courseId, input());
  const update = (html: string) => editFixture(data => {
    const course = data.courses.find(course => course.id === courseId)!;
    course.status = "published";
    course.sections[0].lessons[0].contents = [{ id: "html", title: "HTML", type: "text", mode: "lecture", html, nodes: [] }];
  });
  await update(`<script>let url = '${asset.url}'</script><!-- <img src="${asset.url}"> --><p>${asset.url}</p>`);
  assert.equal((await fetchAsset(asset)).status, 404);
  await update(`<img src="${asset.url}" onerror="alert(1)">`);
  assert.equal((await fetchAsset(asset)).status, 200);
  await update(`<img src="${asset.url.replace(courseId, otherCourseId)}">`);
  assert.equal((await fetchAsset(asset)).status, 404);
});

test("asset integrity checks reject missing, cross-course and mismatched structured media", async () => {
  const asset = await media.uploadCourseMedia(teacher, courseId, input());
  await media.assertLessonMediaReferences(courseId, contents(asset));
  const missing = { ...asset, url: `/api/course-media/${courseId}/00000000-0000-4000-8000-000000000000` };
  await assert.rejects(media.assertLessonMediaReferences(courseId, contents(missing)), { status: 404 });
  await assert.rejects(media.assertLessonMediaReferences(otherCourseId, contents(asset)));
  const wrong = contents(asset); wrong[0].nodes[0].type = "audio";
  await assert.rejects(media.assertLessonMediaReferences(courseId, wrong), { status: 400 });
  const audio = await media.uploadCourseMedia(teacher, courseId, input(Buffer.from([0xff, 0xfb, 0x90, 0x64, 0, 0]), "audio.mp3", "audio/mpeg"));
  await assert.rejects(media.assertLessonMediaReferences(courseId, [{ id: "html", title: "HTML", type: "text", mode: "lecture", html: `<img src="${audio.url}">`, nodes: [] }]), { status: 400 });
});

test("published course cover is public only when its canonical thumbnail reference points to an image", async () => {
  const asset = await media.uploadCourseMedia(teacher, courseId, input(), "course-cover");
  const setCover = (url: string, status: "draft" | "published") => editFixture(data => {
    const course = data.courses.find(course => course.id === courseId)!;
    course.thumbnailPath = url; course.status = status;
  });
  await setCover(asset.url, "draft");
  assert.equal((await fetchAsset(asset)).status, 404);
  await setCover(asset.url, "published");
  assert.equal((await fetchAsset(asset)).status, 200);
  const replacement = await media.uploadCourseMedia(teacher, courseId, input(), "course-cover");
  await editFixture(data => { data.courses.find(course => course.id === courseId)!.cover = replacement.url; });
  assert.equal((await fetchAsset(replacement)).status, 200);
  assert.equal((await fetchAsset(asset)).status, 404);
  await media.assertCourseMediaReferences((await store.getProductCourse(courseId))!);
  await editFixture(data => { data.courses.find(course => course.id === courseId)!.cover = null; });
  await setCover(asset.url.replace(courseId, otherCourseId), "published");
  assert.equal((await fetchAsset(asset)).status, 404);
  await assert.rejects(media.assertCourseMediaReferences((await store.getProductCourse(courseId))!), { status: 400 });
  const audio = await media.uploadCourseMedia(teacher, courseId, input(Buffer.from([0xff, 0xfb, 0x90, 0x64, 0, 0]), "cover.mp3", "audio/mpeg"));
  await setCover(audio.url, "published");
  assert.equal((await fetchAsset(audio)).status, 404);
});

test("inactive content never grants learner media access, even with a live entitlement", async () => {
  const asset = await media.uploadCourseMedia(teacher, courseId, input());
  const hidden = contents(asset); hidden[0].active = false;
  await editFixture(data => {
    const course = data.courses.find(course => course.id === courseId)!;
    course.status = "published"; course.thumbnailPath = null;
    course.sections[0].lessons[0].contents = hidden;
    data.entitlements.find(item => item.id === "media-access")!.validTo = new Date(Date.now() + 3600_000).toISOString();
  });
  assert.equal((await fetchAsset(asset)).status, 404);
  assert.equal((await fetchAsset(asset, studentToken)).status, 404);
  await editFixture(data => {
    const content = data.courses.find(course => course.id === courseId)!.sections[0].lessons[0].contents![0];
    content.active = true; content.nodes[0].active = false;
  });
  assert.equal((await fetchAsset(asset)).status, 404);
  assert.equal((await fetchAdminAsset(asset, teacherToken)).status, 200);
});

test("explicit test environment permits local storage but managed production fails closed", async () => {
  const environment: Record<string, string | undefined> = process.env;
  const originalNodeEnv = process.env.NODE_ENV;
  try {
    environment.NODE_ENV = "production";
    process.env.APP_ENV = "test";
    assert.ok((await media.uploadCourseMedia(teacher, courseId, input())).id);
    process.env.APP_ENV = "PROD";
    await assert.rejects(media.uploadCourseMedia(teacher, courseId, input()), { status: 503 });
  } finally {
    process.env.APP_ENV = "test";
    if (originalNodeEnv === undefined) delete environment.NODE_ENV; else environment.NODE_ENV = originalNodeEnv;
  }
});

test("media GET and HEAD use private responses with bounded RFC byte ranges", async () => {
  const asset = await media.uploadCourseMedia(teacher, courseId, input(Buffer.from([0xff, 0xfb, 0x90, 0x64, 1, 2, 3, 4]), "sound.mp3", "audio/mpeg"));
  const response = await fetchAdminAsset(asset, teacherToken, { range: "bytes=2-5" });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-range"), "bytes 2-5/8");
  assert.equal(response.headers.get("content-length"), "4");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("content-security-policy")!, /sandbox/);
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [0x90, 0x64, 1, 2]);
  assert.equal((await fetchAdminAsset(asset, teacherToken, { range: "bytes=-3" })).headers.get("content-range"), "bytes 5-7/8");
  assert.equal((await fetchAdminAsset(asset, teacherToken, { range: "bytes=7-" })).headers.get("content-length"), "1");
  assert.equal((await fetchAdminAsset(asset, teacherToken, { range: "bytes=0-999" })).headers.get("content-length"), "8");
  for (const range of ["bytes=99-100", "bytes=2-1", "bytes=-0", "bytes=0-1,4-5", "items=0-1", "bytes=99999999999999999999-"]) {
    const response = await fetchAdminAsset(asset, teacherToken, { range });
    assert.equal(response.status, 416);
    assert.equal(response.headers.get("content-range"), "bytes */8");
  }
  assert.equal((await fetchAdminAsset(asset, teacherToken, { range: "bytes=0-1", "if-range": '"old-etag"' })).status, 200);
  const head = await fetchAdminAsset(asset, teacherToken, {}, courseId, "HEAD");
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), "8");
  assert.equal((await head.arrayBuffer()).byteLength, 0);
});

test("teacher learner cookie cannot bypass publication or entitlement through admin preview", async () => {
  const id = "media-transport-course";
  await editFixture(data => {
    data.courses.push({ id, slug: id, title: "Transport regression", description: "Test", status: "draft", authorIds: [teacher.id], sections: [{ id: "transport-section", title: "Section", lessons: [
      { id: "transport-preview", title: "Preview", body: "", isPublic: true, durationMinutes: 5, contents: [] },
      { id: "transport-paid", title: "Paid", body: "", isPublic: false, durationMinutes: 5, contents: [] },
    ] }], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  });
  const preview = await media.uploadCourseMedia(teacher, id, input());
  const paid = await media.uploadCourseMedia(teacher, id, input());
  const orphan = await media.uploadCourseMedia(teacher, id, input());
  await editFixture(data => {
    const course = data.courses.find(course => course.id === id)!;
    course.sections[0].lessons[0].contents = contents(preview);
    course.sections[0].lessons[1].contents = contents(paid);
  });
  const draft = (await store.getProductCourse(id))!;
  assert.equal(await media.canReadCourseMedia(teacher, draft, orphan.id), false);
  assert.equal(await media.canReadCourseMedia(teacher, draft, orphan.id, true), true);
  for (const asset of [preview, paid, orphan]) {
    assert.equal((await fetchAdminAsset(asset, teacherToken)).status, 200);
    assert.equal((await fetchAsset(asset, teacherLearnerToken)).status, 404);
    assert.equal((await fetchAsset(asset, teacherLearnerToken, {}, id, "GET", { host: adminHost })).status, 404);
    assert.equal((await fetchAsset(asset, teacherToken, {}, id, "GET", { cookieName: adminCookie })).status, 404);
  }
  assert.equal((await fetchAsset(orphan, teacherLearnerToken, { range: "bytes=0-3" })).status, 404);
  assert.equal((await fetchAsset(orphan, teacherLearnerToken, {}, id, "HEAD")).status, 404);
  const bothCookies = `${adminCookie}=${teacherToken}; ${learnerCookie}=${teacherLearnerToken}`;
  assert.equal((await fetchAsset(orphan, "", { cookie: bothCookies })).status, 404);
  assert.equal((await fetchAdminAsset(orphan, "", { cookie: bothCookies })).status, 200);
  await editFixture(data => { data.courses.find(course => course.id === id)!.status = "published"; });
  assert.equal((await fetchAsset(preview, teacherLearnerToken)).status, 200);
  assert.equal((await fetchAsset(paid, teacherLearnerToken)).status, 404);
  assert.equal((await fetchAsset(orphan, teacherLearnerToken)).status, 404);
  await editFixture(data => {
    data.entitlements.push({ id: "teacher-media-access", userId: teacher.id, courseId: id, scope: "course", scopeId: id, device: "pc", source: "purchase", state: "active", validTo: new Date(Date.now() + 3600_000).toISOString() });
  });
  assert.equal((await fetchAsset(paid, teacherLearnerToken)).status, 200);
  assert.equal((await fetchAsset(orphan, teacherLearnerToken)).status, 404);
  assert.equal((await fetchAsset(paid, teacherLearnerToken, {}, id, "GET", { host: adminHost })).status, 404);
  await editFixture(data => { data.entitlements.find(item => item.id === "teacher-media-access")!.validTo = new Date(0).toISOString(); });
  assert.equal((await fetchAsset(paid, teacherLearnerToken)).status, 404);
  assert.equal((await fetchAsset(preview, teacherLearnerToken)).status, 200);
  assert.equal((await fetchAdminAsset(orphan, teacherToken)).status, 200);
});

test("multipart streaming enforces the server cap even with no Content-Length and rejects duplicate fields", async () => {
  const length = media.COURSE_MEDIA_MAX_BYTES + 65537;
  let cancelled = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(length)); }, cancel() { cancelled = true; } });
  const request = new Request("http://localhost/upload", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=test" }, body: stream, duplex: "half" } as RequestInit);
  await assert.rejects(media.readCourseMediaUpload(request), { status: 413 });
  assert.equal(cancelled, true);
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(png)], { type: "image/png" }), "a.png");
  form.append("file", new Blob([new Uint8Array(png)], { type: "image/png" }), "b.png");
  await assert.rejects(media.readCourseMediaUpload(new Request("http://localhost/upload", { method: "POST", body: form })), { status: 400 });
  await assert.rejects(media.readCourseMediaUpload(new Request("http://localhost/upload", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=test", "content-length": String(length) }, body: "small" })), { status: 413 });
});
