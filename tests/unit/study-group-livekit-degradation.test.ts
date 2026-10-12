import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SESSION_COOKIE } from "../../services/productAuth";

// Zero-config contract: an environment where the platform has not issued the
// LiveKit project list or the token log key yet must still serve every data
// operation. Only live-room operations answer with the typed unavailable
// state. Construction must never throw — that failure mode blanked the whole
// Study Group page on DEV before the configuration existed.

const cwd = process.cwd();
const env = { ...process.env };
let directory = "";
let token = "";
type Route = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;
let getGroups: Route;
let postGroup: Route;
let postSession: Route;
let postEnter: Route;
let postStart: Route;
let postToken: Route;
let studyGroupLiveKitHealth: () => Promise<{ ready: boolean; attentionRequired: boolean; projects: ReadonlyArray<unknown> }>;

function call(handler: Route, url: string, body?: unknown, cookie?: string, params?: Record<string, string>, method = body === undefined ? "GET" : "POST") {
  return handler(new Request(url, {
    method,
    headers: { "content-type": "application/json", cookie: cookie ? `${SESSION_COOKIE}=${cookie}` : "" },
    body: body === undefined ? undefined : JSON.stringify(body)
  }), { params: Promise.resolve(params || {}) });
}

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "lg-study-group-degradation-"));
  process.chdir(directory);
  process.env.APP_ENV = "DEV";
  process.env.STORAGE_BACKEND = "local";
  process.env.SESSION_SECRET = "test-session-secret-with-at-least-32-characters";
  delete process.env.LIVEKIT_PROJECTS_JSON;
  delete process.env.STUDY_GROUP_TOKEN_LOG_KEY;
  delete process.env.LIVEKIT_FAKE_GATEWAY;
  delete process.env.LIVEKIT_LOCAL_CREDENTIALS_JSON;
  delete process.env.STUDY_GROUP_STORE;
  delete process.env.DATABASE_URL;
  const store = await import("../../services/productStore");
  const files = await import("../../services/fileStore");
  const data = await store.ensureProductData();
  const now = new Date().toISOString();
  const later = new Date(Date.now() + 86_400_000).toISOString();
  data.users.push({ id: "deg-host", email: "deg-host@example.test", passwordHash: null, nickname: "Anna", locale: "en-GB", status: "active", emailVerifiedAt: now, createdAt: now, role: "student" });
  data.courses.push({ id: "deg-course", slug: "german-history", title: "German History", description: "Course", status: "published", sections: [], createdAt: now, updatedAt: now });
  data.entitlements.push({ id: "deg-access", userId: "deg-host", courseId: "deg-course", state: "active", source: "purchase", validTo: later, scope: "course", scopeId: "deg-course", device: "pc" });
  await files.atomicWriteJson(path.join(files.systemRoot(), "learning_guide", "product.json"), data);
  token = (await store.createSession("deg-host")).token;
  getGroups = (await import("../../app/api/study-groups/route")).GET as unknown as Route;
  postGroup = (await import("../../app/api/study-groups/route")).POST as unknown as Route;
  postSession = (await import("../../app/api/study-groups/[groupId]/sessions/route")).POST as unknown as Route;
  postEnter = (await import("../../app/api/study-groups/sessions/[sessionId]/enter/route")).POST as unknown as Route;
  postStart = (await import("../../app/api/study-groups/sessions/[sessionId]/start/route")).POST as unknown as Route;
  postToken = (await import("../../app/api/study-groups/sessions/[sessionId]/token/route")).POST as unknown as Route;
  studyGroupLiveKitHealth = (await import("../../modules/group-study/runtime")).studyGroupLiveKitHealth;
});

after(async () => {
  process.chdir(cwd);
  process.env = env;
  await rm(directory, { recursive: true, force: true });
});

test("with no LiveKit configuration the data surface works and token issuance answers typed unavailability", async () => {
  const discover = await call(getGroups, "http://localhost/api/study-groups?view=discover", undefined, token);
  assert.equal(discover.status, 200);
  assert.equal((await discover.json()).ok, true);

  const created = await call(postGroup, "http://localhost/api/study-groups", { title: "Zero config", courseId: "deg-course", about: "Data operations need no LiveKit configuration." }, token);
  assert.equal(created.status, 200);
  const groupId = (await created.json()).data.id as string;

  const scheduled = await call(postSession, `http://localhost/api/study-groups/${groupId}/sessions`, {
    title: "Room",
    startsAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    durationSeconds: 1800,
    maxParticipants: 2
  }, token, { groupId });
  assert.equal(scheduled.status, 200);
  const sessionId = (await scheduled.json()).data.id as string;

  const entered = await call(postEnter, `http://localhost/api/study-groups/sessions/${sessionId}/enter`, {}, token, { sessionId });
  assert.equal(entered.status, 200);

  const started = await call(postStart, `http://localhost/api/study-groups/sessions/${sessionId}/start`, {}, token, { sessionId });
  assert.equal(started.status, 200);
  assert.equal((await started.json()).data.state, "live");

  const issued = await call(postToken, `http://localhost/api/study-groups/sessions/${sessionId}/token`, {}, token, { sessionId });
  assert.equal(issued.status, 503);
  const issuedBody = await issued.json();
  assert.equal(issuedBody.ok, false);
  assert.equal(issuedBody.code, "unavailable");

  // Unconfigured health is not ready and reports no projects — never a
  // vacuous "all zero projects are healthy".
  const health = await studyGroupLiveKitHealth();
  assert.equal(health.ready, false);
  assert.equal(health.attentionRequired, false);
  assert.deepEqual(health.projects, []);
});
