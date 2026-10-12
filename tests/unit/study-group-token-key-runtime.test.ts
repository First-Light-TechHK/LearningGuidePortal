import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SESSION_COOKIE } from "../../services/productAuth";

// Runtime-level pin for the token-log-key invariant: with a fully configured
// LiveKit provider but NO issued key, issuance must answer typed unavailability
// and must not write an audit line. The provider is configured on purpose —
// otherwise the typed 503 could come from the LiveKit fallback branch and a
// broken key resolver would stay invisible. Setting the key afterwards must
// work without a restart, because the resolver reads it lazily at issuance.

const cwd = process.cwd();
const env = { ...process.env };
let directory = "";
let token = "";
type Route = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;
let postGroup: Route;
let postSession: Route;
let postEnter: Route;
let postStart: Route;
let postToken: Route;

function call(handler: Route, url: string, body?: unknown, cookie?: string, params?: Record<string, string>, method = body === undefined ? "GET" : "POST") {
  return handler(new Request(url, {
    method,
    headers: { "content-type": "application/json", cookie: cookie ? `${SESSION_COOKIE}=${cookie}` : "" },
    body: body === undefined ? undefined : JSON.stringify(body)
  }), { params: Promise.resolve(params || {}) });
}

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "lg-study-group-token-key-"));
  process.chdir(directory);
  process.env.APP_ENV = "DEV";
  process.env.STORAGE_BACKEND = "local";
  process.env.SESSION_SECRET = "test-session-secret-with-at-least-32-characters";
  process.env.LIVEKIT_PROJECTS_JSON = JSON.stringify([{
    id: "local-test",
    url: "wss://livekit.example.test",
    state: "active",
    credentialSecretId: "local-test"
  }]);
  process.env.LIVEKIT_LOCAL_CREDENTIALS_JSON = JSON.stringify({
    "local-test": { apiKey: "lk-key", apiSecret: "lk-secret-at-least-32-characters" }
  });
  process.env.LIVEKIT_FAKE_GATEWAY = "1";
  delete process.env.STUDY_GROUP_TOKEN_LOG_KEY;
  delete process.env.STUDY_GROUP_STORE;
  delete process.env.DATABASE_URL;
  const store = await import("../../services/productStore");
  const files = await import("../../services/fileStore");
  const data = await store.ensureProductData();
  const now = new Date().toISOString();
  const later = new Date(Date.now() + 86_400_000).toISOString();
  data.users.push({ id: "key-host", email: "key-host@example.test", passwordHash: null, nickname: "Anna", locale: "en-GB", status: "active", emailVerifiedAt: now, createdAt: now, role: "student" });
  data.courses.push({ id: "key-course", slug: "german-history", title: "German History", description: "Course", status: "published", sections: [], createdAt: now, updatedAt: now });
  data.entitlements.push({ id: "key-access", userId: "key-host", courseId: "key-course", state: "active", source: "purchase", validTo: later, scope: "course", scopeId: "key-course", device: "pc" });
  await files.atomicWriteJson(path.join(files.systemRoot(), "learning_guide", "product.json"), data);
  token = (await store.createSession("key-host")).token;
  postGroup = (await import("../../app/api/study-groups/route")).POST as unknown as Route;
  postSession = (await import("../../app/api/study-groups/[groupId]/sessions/route")).POST as unknown as Route;
  postEnter = (await import("../../app/api/study-groups/sessions/[sessionId]/enter/route")).POST as unknown as Route;
  postStart = (await import("../../app/api/study-groups/sessions/[sessionId]/start/route")).POST as unknown as Route;
  postToken = (await import("../../app/api/study-groups/sessions/[sessionId]/token/route")).POST as unknown as Route;
});

after(async () => {
  process.chdir(cwd);
  process.env = env;
  await rm(directory, { recursive: true, force: true });
});

test("an unissued token log key blocks issuance even when LiveKit is configured, and a late key works without a restart", async () => {
  const created = await call(postGroup, "http://localhost/api/study-groups", { title: "Key path", courseId: "key-course", about: "The provider is configured; only the log key is missing." }, token);
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

  // Provider configured + key missing: the ONLY source of this 503 is the key
  // check (the LiveKit fallback branch cannot produce it here).
  const blocked = await call(postToken, `http://localhost/api/study-groups/sessions/${sessionId}/token`, {}, token, { sessionId });
  assert.equal(blocked.status, 503);
  assert.equal((await blocked.json()).code, "unavailable");
  await assert.rejects(() => readFile(path.join(directory, "data", "knowledge_system", "learning_guide", "study-group", "token-issuance.log"), "utf8"), { code: "ENOENT" });

  // The platform issues the key: the lazy resolver must pick it up with no restart.
  process.env.STUDY_GROUP_TOKEN_LOG_KEY = Buffer.alloc(32, 5).toString("base64");
  const issued = await call(postToken, `http://localhost/api/study-groups/sessions/${sessionId}/token`, {}, token, { sessionId });
  assert.equal(issued.status, 200);
  const issuedBody = (await issued.json()).data as { token: string; liveKitUrl: string };
  assert.equal(issuedBody.liveKitUrl, "wss://livekit.example.test");
  assert.equal(issuedBody.token.split(".").length, 3);

  const log = await readFile(path.join(directory, "data", "knowledge_system", "learning_guide", "study-group", "token-issuance.log"), "utf8");
  assert.equal(log.trim().split("\n").length >= 1, true);
  assert.equal(log.includes(issuedBody.token), false);
  assert.equal(log.includes("lk-secret-at-least-32-characters"), false);
});
