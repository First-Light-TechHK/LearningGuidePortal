import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SESSION_COOKIE } from "../../services/productAuth";
import { STUDY_GROUP_TUTOR_SYSTEM_PROMPT } from "../../modules/group-study/tutorPrompt";

const cwd = process.cwd();
const env = { ...process.env };
let directory = "";
let token = "";
let strangerToken = "";
type Route = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;
let postGroup: Route;
let getGroups: Route;
let postJoin: Route;
let postSession: Route;
let postEnter: Route;
let postToken: Route;
let patchSession: Route;
let postStart: Route;
let postTutor: Route;
let memberToken = "";
let otherMemberToken = "";
let filledTokens: string[] = [];

function call(handler: (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>, url: string, body?: unknown, cookie?: string, params?: Record<string, string>, method = body === undefined ? "GET" : "POST") {
  return handler(new Request(url, {
    method,
    headers: { "content-type": "application/json", cookie: cookie ? `${SESSION_COOKIE}=${cookie}` : "" },
    body: body === undefined ? undefined : JSON.stringify(body)
  }), { params: Promise.resolve(params || {}) });
}

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "lg-study-group-api-"));
  process.chdir(directory);
  process.env.APP_ENV = "DEV";
  process.env.STORAGE_BACKEND = "local";
  process.env.SESSION_SECRET = "test-session-secret-with-at-least-32-characters";
  process.env.LIVEKIT_API_KEY = "lk-key";
  process.env.LIVEKIT_API_SECRET = "lk-secret-at-least-32-characters";
  process.env.LIVEKIT_URL = "wss://livekit.example.test";
  process.env.STUDY_GROUP_TOKEN_LOG_KEY = Buffer.alloc(32, 9).toString("base64");
  const store = await import("../../services/productStore");
  const files = await import("../../services/fileStore");
  const data = await store.ensureProductData();
  const now = new Date().toISOString();
  const later = new Date(Date.now() + 86_400_000).toISOString();
  data.users.push(
    { id: "api-host", email: "host@example.test", passwordHash: null, nickname: "Anna", locale: "en-GB", status: "active", emailVerifiedAt: now, createdAt: now, role: "student" },
    { id: "api-stranger", email: "stranger@example.test", passwordHash: null, nickname: "Sam", locale: "en-GB", status: "active", emailVerifiedAt: now, createdAt: now, role: "student" },
    { id: "api-m1", email: "m1@example.test", passwordHash: null, nickname: "Mia", locale: "en-GB", status: "active", emailVerifiedAt: now, createdAt: now, role: "student" },
    { id: "api-m2", email: "m2@example.test", passwordHash: null, nickname: "Noah", locale: "en-GB", status: "active", emailVerifiedAt: now, createdAt: now, role: "student" },
    { id: "api-m3", email: "m3@example.test", passwordHash: null, nickname: "Ada", locale: "en-GB", status: "active", emailVerifiedAt: now, createdAt: now, role: "student" },
    { id: "api-m4", email: "m4@example.test", passwordHash: null, nickname: "Ben", locale: "en-GB", status: "active", emailVerifiedAt: now, createdAt: now, role: "student" },
    { id: "api-m5", email: "m5@example.test", passwordHash: null, nickname: "Cleo", locale: "en-GB", status: "active", emailVerifiedAt: now, createdAt: now, role: "student" },
    { id: "api-m6", email: "m6@example.test", passwordHash: null, nickname: "Dan", locale: "en-GB", status: "active", emailVerifiedAt: now, createdAt: now, role: "student" }
  );
  data.courses.push({ id: "api-course", slug: "german-history", title: "German History", description: "Course", status: "published", sections: [], createdAt: now, updatedAt: now });
  data.entitlements.push(
    { id: "api-access", userId: "api-host", courseId: "api-course", state: "active", source: "purchase", validTo: later, scope: "course", scopeId: "api-course", device: "pc" },
    { id: "api-access-m1", userId: "api-m1", courseId: "api-course", state: "active", source: "purchase", validTo: later, scope: "course", scopeId: "api-course", device: "pc" },
    { id: "api-access-m2", userId: "api-m2", courseId: "api-course", state: "active", source: "purchase", validTo: later, scope: "course", scopeId: "api-course", device: "pc" },
    { id: "api-access-m3", userId: "api-m3", courseId: "api-course", state: "active", source: "purchase", validTo: later, scope: "course", scopeId: "api-course", device: "pc" },
    { id: "api-access-m4", userId: "api-m4", courseId: "api-course", state: "active", source: "purchase", validTo: later, scope: "course", scopeId: "api-course", device: "pc" },
    { id: "api-access-m5", userId: "api-m5", courseId: "api-course", state: "active", source: "purchase", validTo: later, scope: "course", scopeId: "api-course", device: "pc" },
    { id: "api-access-m6", userId: "api-m6", courseId: "api-course", state: "active", source: "purchase", validTo: later, scope: "course", scopeId: "api-course", device: "pc" }
  );
  await files.atomicWriteJson(path.join(files.systemRoot(), "learning_guide", "product.json"), data);
  token = (await store.createSession("api-host")).token;
  strangerToken = (await store.createSession("api-stranger")).token;
  memberToken = (await store.createSession("api-m1")).token;
  otherMemberToken = (await store.createSession("api-m2")).token;
  filledTokens = [];
  for (const id of ["api-m1", "api-m2", "api-m3", "api-m4", "api-m5", "api-m6"]) filledTokens.push((await store.createSession(id)).token);
  postGroup = (await import("../../app/api/study-groups/route")).POST as unknown as Route;
  getGroups = (await import("../../app/api/study-groups/route")).GET as unknown as Route;
  postJoin = (await import("../../app/api/study-groups/[groupId]/join/route")).POST as unknown as Route;
  postSession = (await import("../../app/api/study-groups/[groupId]/sessions/route")).POST as unknown as Route;
  postEnter = (await import("../../app/api/study-groups/sessions/[sessionId]/enter/route")).POST as unknown as Route;
  postToken = (await import("../../app/api/study-groups/sessions/[sessionId]/token/route")).POST as unknown as Route;
  patchSession = (await import("../../app/api/study-groups/sessions/[sessionId]/route")).PATCH as unknown as Route;
  postStart = (await import("../../app/api/study-groups/sessions/[sessionId]/start/route")).POST as unknown as Route;
  postTutor = (await import("../../app/api/study-groups/sessions/[sessionId]/tutor/route")).POST as unknown as Route;
});

beforeEach(async () => {
  await rm(path.join(directory, "data", "knowledge_system", "learning_guide", "study-group"), { recursive: true, force: true });
});

after(async () => {
  process.chdir(cwd);
  process.env = env;
  await rm(directory, { recursive: true, force: true });
});

test("study group API requires a session, hides sessions until join, and does not store the LiveKit token", async () => {
  const anonymous = await call(postGroup, "http://localhost/api/study-groups", { title: "Group", courseId: "api-course", about: "About" });
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).code, "unauthenticated");

  const missing = await call(postGroup, "http://localhost/api/study-groups", { title: "", courseId: "api-course", about: "About" }, token);
  assert.equal(missing.status, 400);

  const denied = await call(postGroup, "http://localhost/api/study-groups", { title: "Nope", courseId: "api-course", about: "About" }, strangerToken);
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).code, "course_access_required");

  const created = await call(postGroup, "http://localhost/api/study-groups", { title: "Weimar", courseId: "api-course", about: "About the group." }, token);
  assert.equal(created.status, 200);
  const createdBody = await created.json();
  assert.equal(createdBody.ok, true);
  assert.equal(createdBody.data.role, "host");
  const groupId = createdBody.data.id as string;

  const discovered = await call(getGroups, "http://localhost/api/study-groups?view=discover", undefined, strangerToken);
  assert.equal(discovered.status, 200);
  assert.equal((await discovered.json()).data.some((item: { id: string }) => item.id === groupId), true);

  const joined = await call(postJoin, `http://localhost/api/study-groups/${groupId}/join`, {}, strangerToken, { groupId });
  assert.equal(joined.status, 403);

  const startsAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const scheduled = await call(postSession, `http://localhost/api/study-groups/${groupId}/sessions`, {
    title: "Session",
    startsAt,
    durationSeconds: 1800,
    maxParticipants: 2
  }, token, { groupId });
  assert.equal(scheduled.status, 200);
  const sessionId = (await scheduled.json()).data.id as string;
  const entered = await call(postEnter, `http://localhost/api/study-groups/sessions/${sessionId}/enter`, {}, token, { sessionId });
  assert.equal(entered.status, 200);
  const issued = await call(postToken, `http://localhost/api/study-groups/sessions/${sessionId}/token`, {}, token, { sessionId });
  assert.equal(issued.status, 200);
  const issuedBody = await issued.json();
  const storeFile = await readFile(path.join(directory, "data", "knowledge_system", "learning_guide", "study-group", "study-group.json"), "utf8");
  assert.equal(storeFile.includes(issuedBody.data.token), false);
  assert.equal(storeFile.includes("lk-secret-at-least-32-characters"), false);
  const wrong = await call(postToken, "http://localhost/api/study-groups/sessions/missing/token", {}, token, { sessionId: "missing" });
  assert.equal(wrong.status, 404);

  const startsLater = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
  const title = "12345678901234567890";
  const accepted = await call(postSession, `http://localhost/api/study-groups/${groupId}/sessions`, {
    title,
    startsAt: startsLater,
    durationSeconds: 2700,
    maxParticipants: 4
  }, token, { groupId });
  assert.equal(accepted.status, 200);
  const acceptedBody = await accepted.json();
  assert.equal(acceptedBody.data.title, title);
  assert.equal(acceptedBody.data.durationSeconds, 2700);
  assert.equal(acceptedBody.data.durationMinutes, undefined);
  const storedSeconds = await readFile(path.join(directory, "data", "knowledge_system", "learning_guide", "study-group", "study-group.json"), "utf8");
  assert.equal(storedSeconds.includes("durationMinutes"), false);
  assert.equal(storedSeconds.includes("\"durationSeconds\":2700"), true);
  const tooLong = await call(postSession, `http://localhost/api/study-groups/${groupId}/sessions`, {
    title: `${title}x`,
    startsAt: startsLater,
    durationSeconds: 2700,
    maxParticipants: 4
  }, token, { groupId });
  assert.equal(tooLong.status, 400);
  assert.equal((await tooLong.json()).code, "validation");
  const missingDuration = await call(postSession, `http://localhost/api/study-groups/${groupId}/sessions`, {
    title: "No duration",
    startsAt: startsLater,
    maxParticipants: 4
  }, token, { groupId });
  assert.equal(missingDuration.status, 400);
  assert.equal((await missingDuration.json()).code, "validation");
  const minutesOnly = await call(postSession, `http://localhost/api/study-groups/${groupId}/sessions`, {
    title: "Minutes",
    startsAt: startsLater,
    durationMinutes: 90,
    maxParticipants: 4
  }, token, { groupId });
  assert.equal(minutesOnly.status, 400);
  assert.equal((await minutesOnly.json()).code, "validation");
  const bareMinute = await call(postSession, `http://localhost/api/study-groups/${groupId}/sessions`, {
    title: "Bare",
    startsAt: startsLater,
    durationSeconds: 30,
    maxParticipants: 4
  }, token, { groupId });
  assert.equal(bareMinute.status, 400);
  assert.equal((await bareMinute.json()).code, "validation");
  for (const durationSeconds of [45, 60, 90, 25, 1]) {
    const rejected = await call(postSession, `http://localhost/api/study-groups/${groupId}/sessions`, {
      title: "Other",
      startsAt: startsLater,
      durationSeconds,
      maxParticipants: 4
    }, token, { groupId });
    assert.equal(rejected.status, 400);
  }
});

test("enter uses server receipt time and edit keeps people when the maximum would drop below them", async () => {
  const created = await call(postGroup, "http://localhost/api/study-groups", { title: "Race", courseId: "api-course", about: "About the race." }, token);
  const groupId = (await created.json()).data.id as string;
  await call(postJoin, `http://localhost/api/study-groups/${groupId}/join`, {}, memberToken, { groupId });
  await call(postJoin, `http://localhost/api/study-groups/${groupId}/join`, {}, otherMemberToken, { groupId });
  const startsAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const scheduled = await call(postSession, `http://localhost/api/study-groups/${groupId}/sessions`, {
    title: "Race session",
    startsAt,
    durationSeconds: 1800,
    maxParticipants: 2
  }, token, { groupId });
  const sessionId = (await scheduled.json()).data.id as string;
  const hostEntered = await call(postEnter, `http://localhost/api/study-groups/sessions/${sessionId}/enter`, {}, token, { sessionId });
  assert.equal(hostEntered.status, 200);
  const earlyClaim = "2000-01-01T00:00:00.000Z";
  const lateClaim = "2099-01-01T00:00:00.000Z";
  const first = call(postEnter, `http://localhost/api/study-groups/sessions/${sessionId}/enter`, { requestedAt: lateClaim }, memberToken, { sessionId });
  const second = call(postEnter, `http://localhost/api/study-groups/sessions/${sessionId}/enter`, { requestedAt: earlyClaim }, otherMemberToken, { sessionId });
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.status, 200);
  assert.equal(secondResult.status, 409);
  const storeFile = await readFile(path.join(directory, "data", "knowledge_system", "learning_guide", "study-group", "study-group.json"), "utf8");
  const store = JSON.parse(storeFile) as { presences: Array<{ sessionId: string; userId: string; requestedAt: string; leftAt: string | null }> };
  const seated = store.presences.filter((item) => item.sessionId === sessionId && !item.leftAt);
  assert.equal(seated.length, 2);
  assert.equal(seated.some((item) => item.userId === "api-m2"), false);
  assert.equal(seated.some((item) => item.requestedAt === earlyClaim || item.requestedAt === lateClaim), false);
  const wide = await call(postSession, `http://localhost/api/study-groups/${groupId}/sessions`, {
    title: "Wide",
    startsAt,
    durationSeconds: 1800,
    maxParticipants: 6
  }, token, { groupId });
  const wideId = (await wide.json()).data.id as string;
  assert.equal((await call(postEnter, `http://localhost/api/study-groups/sessions/${wideId}/enter`, {}, token, { sessionId: wideId })).status, 200);
  assert.equal((await call(postEnter, `http://localhost/api/study-groups/sessions/${wideId}/enter`, {}, memberToken, { sessionId: wideId })).status, 200);
  assert.equal((await call(postEnter, `http://localhost/api/study-groups/sessions/${wideId}/enter`, {}, otherMemberToken, { sessionId: wideId })).status, 200);
  const shrunk = await call(patchSession, `http://localhost/api/study-groups/sessions/${wideId}`, {
    groupId,
    maxParticipants: 2
  }, token, { sessionId: wideId }, "PATCH");
  assert.equal(shrunk.status, 409);
  const after = JSON.parse(await readFile(path.join(directory, "data", "knowledge_system", "learning_guide", "study-group", "study-group.json"), "utf8")) as { presences: Array<{ sessionId: string; leftAt: string | null }>; sessions: Array<{ id: string; maxParticipants: number }> };
  assert.equal(after.presences.filter((item) => item.sessionId === wideId && !item.leftAt).length, 3);
  assert.equal(after.sessions.find((item) => item.id === wideId)?.maxParticipants, 6);
});

test("AI Tutor enqueue is idempotent and does not issue a token or call a model", async () => {
  const fetches: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    fetches.push(String(input));
    throw new Error("provider");
  }) as typeof fetch;
  try {
    const created = await call(postGroup, "http://localhost/api/study-groups", { title: "Tutor", courseId: "api-course", about: "About the tutor queue." }, token);
    const groupId = (await created.json()).data.id as string;
    const startsAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const scheduled = await call(postSession, `http://localhost/api/study-groups/${groupId}/sessions`, {
      title: "Tutor session",
      startsAt,
      durationSeconds: 1800,
      maxParticipants: 4,
      aiTutorEnabled: true
    }, token, { groupId });
    const sessionId = (await scheduled.json()).data.id as string;
    assert.equal((await call(postEnter, `http://localhost/api/study-groups/sessions/${sessionId}/enter`, {}, token, { sessionId })).status, 200);
    assert.equal((await call(postStart, `http://localhost/api/study-groups/sessions/${sessionId}/start`, {}, token, { sessionId })).status, 200);
    const occupancyBefore = JSON.parse(await readFile(path.join(directory, "data", "knowledge_system", "learning_guide", "study-group", "study-group.json"), "utf8")) as { presences: Array<{ sessionId: string; leftAt: string | null }> };
    const beforeCount = occupancyBefore.presences.filter((item) => item.sessionId === sessionId && !item.leftAt).length;
    const queued = await call(postTutor, `http://localhost/api/study-groups/sessions/${sessionId}/tutor`, {
      text: "Why 1933?",
      clientEventId: "evt-api-1",
      receivedAt: "1999-01-01T00:00:00.000Z"
    }, token, { sessionId });
    assert.equal(queued.status, 200);
    const body = await queued.json();
    assert.equal(body.data.userId, "api-host");
    assert.equal(body.data.sessionId, sessionId);
    assert.equal(body.data.text, "Why 1933?");
    assert.notEqual(body.data.receivedAt, "1999-01-01T00:00:00.000Z");
    const replay = await call(postTutor, `http://localhost/api/study-groups/sessions/${sessionId}/tutor`, {
      text: "Different",
      clientEventId: "evt-api-1"
    }, token, { sessionId });
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).data.id, body.data.id);
    const stored = JSON.parse(await readFile(path.join(directory, "data", "knowledge_system", "learning_guide", "study-group", "study-group.json"), "utf8")) as { tutorRequests: Array<{ clientEventId: string }>; presences: Array<{ sessionId: string; leftAt: string | null }>; chat?: unknown };
    assert.equal(stored.tutorRequests.filter((item) => item.clientEventId === "evt-api-1").length, 1);
    assert.equal(stored.chat, undefined);
    assert.equal(stored.presences.filter((item) => item.sessionId === sessionId && !item.leftAt).length, beforeCount);
    assert.equal(fetches.some((url) => url.includes("openrouter.ai")), false);
    assert.equal(fetches.every((url) => url.includes("livekit.example.test")), true);
    const log = await readFile(path.join(directory, "data", "knowledge_system", "learning_guide", "study-group", "token-issuance.log"), "utf8").catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? "" : Promise.reject(error));
    assert.equal(log.includes(body.data.text), false);
    const secret = "fake-tutor-secret-not-in-response";
    process.env.STUDY_GROUP_TUTOR_KEY_UNUSED = secret;
    const raw = JSON.stringify(body);
    assert.equal(raw.includes(secret), false);
    assert.equal(raw.includes(STUDY_GROUP_TUTOR_SYSTEM_PROMPT), false);
    assert.equal(fetches.join("\n").includes(secret), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("create, join, schedule, and a full session refuses the Host", async () => {
  const created = await call(postGroup, "http://localhost/api/study-groups", { title: "Full room", courseId: "api-course", about: "About the full group." }, token);
  assert.equal(created.status, 200);
  const groupId = (await created.json()).data.id as string;
  for (const cookie of filledTokens) {
    const joined = await call(postJoin, `http://localhost/api/study-groups/${groupId}/join`, {}, cookie, { groupId });
    assert.equal(joined.status, 200);
  }
  const startsAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const scheduled = await call(postSession, `http://localhost/api/study-groups/${groupId}/sessions`, {
    title: "Six seats",
    startsAt,
    durationSeconds: 1800,
    maxParticipants: 6
  }, token, { groupId });
  assert.equal(scheduled.status, 200);
  const scheduledBody = await scheduled.json();
  assert.equal(scheduledBody.data.durationSeconds, 1800);
  assert.equal(scheduledBody.data.durationMinutes, undefined);
  const sessionId = scheduledBody.data.id as string;
  for (const cookie of filledTokens) {
    const entered = await call(postEnter, `http://localhost/api/study-groups/sessions/${sessionId}/enter`, {}, cookie, { sessionId });
    assert.equal(entered.status, 200);
  }
  const host = await call(postEnter, `http://localhost/api/study-groups/sessions/${sessionId}/enter`, {}, token, { sessionId });
  assert.equal(host.status, 409);
  assert.equal((await host.json()).code, "session_full");
  const stored = JSON.parse(await readFile(path.join(directory, "data", "knowledge_system", "learning_guide", "study-group", "study-group.json"), "utf8")) as { sessions: Array<{ id: string; durationSeconds: number }>; presences: Array<{ sessionId: string; userId: string; leftAt: string | null }> };
  assert.equal(stored.sessions.find((item) => item.id === sessionId)?.durationSeconds, 1800);
  assert.equal(JSON.stringify(stored).includes("durationMinutes"), false);
  const seated = stored.presences.filter((item) => item.sessionId === sessionId && !item.leftAt);
  assert.equal(seated.length, 6);
  assert.equal(seated.some((item) => item.userId === "api-host"), false);
});
