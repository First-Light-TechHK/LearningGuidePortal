import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { defaultPortalContent, sourceCopyFingerprint } from "../../lib/portalContent";

const cwd = process.cwd();
const env = { STORAGE_BACKEND: process.env.STORAGE_BACKEND, ADMIN_HOSTS: process.env.ADMIN_HOSTS, BACKOFFICE_OPERATOR_EMAIL: process.env.BACKOFFICE_OPERATOR_EMAIL, OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY };
const host = "localhost:3097", learnerHost = "127.0.0.1:3097", origin = `http://${host}`;
let directory: string;
let store: typeof import("../../services/productStore");
let cms: typeof import("../../app/api/backoffice/portal/route");
let upload: typeof import("../../app/api/backoffice/portal/media/route");
let translate: typeof import("../../app/api/backoffice/portal/translate/route");
let media: typeof import("../../services/portalMedia");
const tokens: Record<string, string> = {};
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "lg-portal-cms-admin-"));
  process.chdir(directory);
  Object.assign(process.env, { STORAGE_BACKEND: "local", ADMIN_HOSTS: "localhost", BACKOFFICE_OPERATOR_EMAIL: "operator@cms-admin.test" });
  delete process.env.OPENROUTER_API_KEY;
  store = await import("../../services/productStore");
  cms = await import("../../app/api/backoffice/portal/route");
  upload = await import("../../app/api/backoffice/portal/media/route");
  translate = await import("../../app/api/backoffice/portal/translate/route");
  media = await import("../../services/portalMedia");
  const users: Record<string, string> = {};
  for (const name of ["operator", "teacher", "student", "pending"]) {
    const user = await store.registerUser({ email: `${name}@cms-admin.test`, password: "password1", role: name === "operator" ? "operator" : "student" });
    if (name !== "pending") await store.verifyEmailToken(await store.issueEmailVerificationToken(user.id));
    users[name] = user.id;
    tokens[name] = (await store.createSession(user.id)).token;
  }
  const course = await store.createCourseForOperator({ title: "CMS teacher ownership" }, users.operator);
  await store.assignCourseOwner(users.operator, course.id, { email: "teacher@cms-admin.test", expectedUpdatedAt: course.updatedAt });
});

after(async () => {
  process.chdir(cwd);
  for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  if (directory) await rm(directory, { recursive: true, force: true });
});

function request(method: string, body?: BodyInit, options: { name?: string; host?: string; cookie?: string; origin?: string; pathname?: string; headers?: Record<string, string> } = {}) {
  const hostname = options.host || host;
  return new Request(`http://${hostname}${options.pathname || "/api/backoffice/portal"}`, {
    method,
    headers: { host: hostname, origin: options.origin ?? `http://${hostname}`, cookie: `${options.cookie || "learning_guide_admin_session"}=${tokens[options.name ?? "operator"] || ""}`, ...options.headers },
    ...(body === undefined ? {} : { body })
  });
}

function privateResponse(response: Response, status: number) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("vary"), "Cookie");
}

test("CMS reads and writes require operator admin cookies on the admin host", async () => {
  const before = await store.getPortalContent();
  const library = await media.listPortalMedia();
  for (const options of [{ name: "" }, { name: "teacher" }, { name: "student" }, { name: "pending" }, { cookie: "learning_guide_session" }, { host: learnerHost }]) {
    privateResponse(await cms.GET(request("GET", undefined, options)), 403);
    privateResponse(await upload.GET(request("GET", undefined, options)), 403);
    privateResponse(await cms.PUT(request("PUT", "malformed", options)), 403);
    privateResponse(await upload.POST(request("POST", "malformed", options)), 403);
    privateResponse(await translate.POST(request("POST", "malformed", options)), 403);
  }
  assert.deepEqual(await store.getPortalContent(), before);
  assert.deepEqual(await media.listPortalMedia(), library);
  privateResponse(await cms.GET(request("GET")), 200);
  privateResponse(await upload.GET(request("GET")), 200);
});

test("all CMS mutations reject missing or cross-origin requests before parsing", async () => {
  for (const suppliedOrigin of ["", "null", "https://evil.test", `http://${learnerHost}`, origin + "/path"]) {
    const options = { origin: suppliedOrigin };
    privateResponse(await cms.PUT(request("PUT", "malformed", options)), 403);
    privateResponse(await upload.POST(request("POST", "malformed", options)), 403);
    privateResponse(await translate.POST(request("POST", "malformed", options)), 403);
  }
});

test("operator can persist bilingual CMS copy and translate-once without another login or external request", async () => {
  const content = structuredClone(defaultPortalContent);
  content.banners["en-GB"][0].title = "CMS admin-boundary heading";
  const saved = await cms.PUT(request("PUT", JSON.stringify(content)));
  privateResponse(saved, 200);
  assert.equal((await store.getPortalContent()).banners["en-GB"][0].title, content.banners["en-GB"][0].title);
  const current = { ...content, translation: { source: "en-GB" as const, hash: sourceCopyFingerprint(content, "en-GB") } };
  const response = await translate.POST(request("POST", JSON.stringify({ source: "en-GB", content: current }), { pathname: "/api/backoffice/portal/translate" }));
  privateResponse(response, 200);
  assert.equal((await response.json()).skipped, true);
  privateResponse(await translate.POST(request("POST", JSON.stringify({ source: "en-GB", content }))), 503);
  privateResponse(await translate.POST(request("POST", JSON.stringify({ source: "unknown", content }))), 400);
});

test("operator uploads are private to list but portal images remain public on both hosts", async () => {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(PNG)], { type: "image/png" }), "cms-banner.png");
  const response = await upload.POST(request("POST", form, { pathname: "/api/backoffice/portal/media" }));
  privateResponse(response, 201);
  const { asset } = await response.json();
  const reader = await import("../../app/api/portal-media/[assetId]/route");
  const { adminHostDecision } = await import("../../services/adminHost");
  for (const hostname of [host, learnerHost]) {
    const publicRequest = request("GET", undefined, { name: "", host: hostname, pathname: asset.url });
    assert.deepEqual(adminHostDecision(publicRequest), { allow: true });
    const read = await reader.GET(publicRequest, { params: Promise.resolve({ assetId: asset.id }) });
    assert.equal(read.status, 200);
    assert.equal(read.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await read.arrayBuffer()), PNG);
  }
  const duplicate = new FormData();
  duplicate.append("file", new Blob([PNG]), "one.png"); duplicate.append("file", new Blob([PNG]), "two.png");
  privateResponse(await upload.POST(request("POST", duplicate)), 400);
});

test("CMS bounds JSON and multipart bytes before parsing, including undeclared streams", async () => {
  privateResponse(await cms.PUT(request("PUT", "{}", { headers: { "content-length": "2000001" } })), 413);
  privateResponse(await translate.POST(request("POST", "{}", { headers: { "content-length": "2000001" } })), 413);
  privateResponse(await upload.POST(request("POST", "unused", { headers: { "content-type": "multipart/form-data; boundary=abc", "content-length": String(media.PORTAL_MEDIA_MAX_BYTES + 65537) } })), 413);
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel() { cancelled = true; } });
  const streamed = new Request(origin + "/api/backoffice/portal/media", { method: "POST", headers: { host, origin, cookie: `learning_guide_admin_session=${tokens.operator}`, "content-type": "multipart/form-data; boundary=abc" }, body: stream, duplex: "half" } as RequestInit);
  privateResponse(await upload.POST(streamed), 413);
  assert.equal(cancelled, true);
  privateResponse(await cms.PUT(request("PUT", "[]")), 400);
  privateResponse(await translate.POST(request("POST", "{bad")), 400);
});
