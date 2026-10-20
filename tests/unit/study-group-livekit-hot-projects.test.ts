import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { StudyGroupError } from "../../modules/group-study/domain";
import { LiveKitGatewayError, type LiveKitRoomGateway } from "../../modules/group-study/liveKitGateway";
import { createLiveKitHealthService } from "../../modules/group-study/liveKitHealth";
import { createHotLiveKitProjectRegistry, type LiveKitProjectListRejection } from "../../modules/group-study/liveKitProjectRegistry";
import { createStudyGroupRepository } from "../../modules/group-study/repository";
import { createStudyGroupService } from "../../modules/group-study/service";

// Owner requirement 2026-10-20: the LiveKit project list is hot. With
// LIVEKIT_PROJECTS_SECRET_ID the list is read from that secret at run time
// (one-minute cache, one shared read): a project added there becomes
// assignable without a redeploy, a project that leaves it keeps serving the
// rooms already on it (as draining) while new rooms go only to listed active
// projects, and a failed or invalid read keeps the last good list. Fake
// secret reader and an injected clock; no AWS, no network.

const START = Date.parse("2026-10-20T10:00:00.000Z");

/** A Secrets Manager stand-in: one value per secret id, a read counter and a failure switch. */
function fakeSecrets(initial: Record<string, string>) {
  const values = new Map(Object.entries(initial));
  const state = { reads: 0, failing: false };
  return {
    state,
    set: (secretId: string, value: string) => { values.set(secretId, value); },
    reader: {
      async getSecretValue(secretId: string) {
        state.reads += 1;
        await Promise.resolve();
        if (state.failing) throw new Error("Secrets Manager is unavailable");
        return values.get(secretId);
      }
    }
  };
}

const LIST_SECRET = "lg/livekit/projects";

function listEntry(id: string, overrides: Record<string, unknown> = {}) {
  return { id, url: `wss://${id}.livekit.cloud`, state: "active", weight: 1, credentialSecretId: `lg/livekit/${id}`, ...overrides };
}

function hotList(initial: unknown[] | string | null, cacheTtlMs = 60_000) {
  let nowMs = START;
  const secrets = fakeSecrets(initial === null ? {} : { [LIST_SECRET]: typeof initial === "string" ? initial : JSON.stringify(initial) });
  const rejections: LiveKitProjectListRejection[] = [];
  const registry = createHotLiveKitProjectRegistry({
    read: () => secrets.reader.getSecretValue(LIST_SECRET),
    now: () => nowMs,
    cacheTtlMs,
    onRejected: (reason) => rejections.push(reason)
  });
  return {
    registry,
    secrets,
    rejections,
    write: (list: unknown[] | string) => secrets.set(LIST_SECRET, typeof list === "string" ? list : JSON.stringify(list)),
    advanceSeconds: (seconds: number) => { nowMs += seconds * 1000; },
    nowMs: () => nowMs
  };
}

/** A provider stand-in that records the rooms it creates and answers healthy. */
function healthyGateway(now: () => number, rooms: string[] = []): LiveKitRoomGateway {
  return {
    ensureRoom: async ({ project, room }) => { rooms.push(`${room}@${project.id}`); },
    issueParticipantToken: async ({ project }) => ({ token: `token-${project.id}`, expiresAt: new Date(now() + 600_000).toISOString(), url: project.url }),
    publishTutorMessage: async () => undefined,
    removeParticipant: async () => undefined,
    healthCheck: async ({ project }) => ({ projectId: project.id, status: "healthy", evidence: "provider_api", providerVerified: true, checkedAt: new Date(now()).toISOString(), latencyMs: 0 })
  };
}

const sessionIds = Array.from({ length: 40 }, (_, index) => `session-${index}`);

test("a project added to the list secret becomes assignable within the cache window", async () => {
  const f = hotList([listEntry("alpha")]);
  await f.registry.refresh();
  assert.deepEqual(new Set(sessionIds.map((sessionId) => f.registry.selectForNewSession({ sessionId }).id)), new Set(["alpha"]));

  f.write([listEntry("alpha"), listEntry("beta", { weight: 3 })]);
  f.advanceSeconds(30);
  await f.registry.refresh();
  assert.deepEqual(f.registry.diagnostics().map((item) => item.id), ["alpha"]);

  f.advanceSeconds(31);
  await f.registry.refresh();
  assert.deepEqual(f.registry.diagnostics().map((item) => item.id), ["alpha", "beta"]);
  assert.deepEqual(new Set(sessionIds.map((sessionId) => f.registry.selectForNewSession({ sessionId }).id)), new Set(["alpha", "beta"]));
  assert.equal(f.registry.getAssigned("beta").url, "wss://beta.livekit.cloud");
  assert.equal(f.secrets.state.reads, 2);
});

test("a project removed from the list keeps serving its assigned sessions as draining and gets no new rooms", async () => {
  const f = hotList([listEntry("alpha"), listEntry("beta"), listEntry("gamma", { state: "disabled" })]);
  await f.registry.refresh();
  f.write([listEntry("alpha")]);
  f.advanceSeconds(61);
  await f.registry.refresh();

  const kept = f.registry.getAssigned("beta");
  assert.equal(kept.state, "draining");
  assert.equal(kept.url, "wss://beta.livekit.cloud");
  assert.equal(kept.credentialSecretId, "lg/livekit/beta");
  // Its rooms' webhooks still verify (all() feeds the issuer lookup); the
  // health check and new rooms follow the list only.
  assert.deepEqual(f.registry.all().map((item) => item.id), ["alpha", "beta"]);
  assert.deepEqual(f.registry.diagnostics().map((item) => item.id), ["alpha"]);
  assert.equal(sessionIds.every((sessionId) => f.registry.selectForNewSession({ sessionId }).id === "alpha"), true);
  assert.throws(() => f.registry.selectForNewSession({ sessionId: "session-x", excludeProjectIds: new Set(["alpha"]) }));
  // A project that was disabled stays unavailable when it leaves the list.
  assert.throws(() => f.registry.getAssigned("gamma"));

  // Put back, it is an ordinary listed project again.
  f.write([listEntry("alpha"), listEntry("beta")]);
  f.advanceSeconds(61);
  await f.registry.refresh();
  assert.equal(f.registry.getAssigned("beta").state, "active");
  assert.deepEqual(f.registry.all().map((item) => item.id), ["alpha", "beta"]);
});

test("a failed or invalid list read keeps the last good list and is retried after the window", async () => {
  const f = hotList([listEntry("alpha", { url: "wss://alpha-one.livekit.cloud" })]);
  await Promise.all([f.registry.refresh(), f.registry.refresh(), f.registry.refresh()]);
  assert.equal(f.secrets.state.reads, 1);

  f.secrets.state.failing = true;
  f.advanceSeconds(61);
  await f.registry.refresh();
  assert.equal(f.registry.getAssigned("alpha").url, "wss://alpha-one.livekit.cloud");
  await f.registry.refresh();
  assert.equal(f.secrets.state.reads, 2);

  f.secrets.state.failing = false;
  for (const invalid of ["not-json", "[]", JSON.stringify([listEntry("alpha", { state: "draining" })]), JSON.stringify([listEntry("alpha", { url: "https://alpha.livekit.cloud" })])]) {
    f.write(invalid);
    f.advanceSeconds(61);
    await f.registry.refresh();
    assert.equal(f.registry.selectForNewSession({ sessionId: "session-1" }).url, "wss://alpha-one.livekit.cloud");
  }
  assert.deepEqual(f.rejections, ["unreadable", "invalid", "invalid", "invalid", "invalid"]);

  // The next good read is followed: here the project moved to another url.
  f.write([listEntry("alpha", { url: "wss://alpha-two.livekit.cloud" })]);
  f.advanceSeconds(61);
  await f.registry.refresh();
  assert.equal(f.registry.getAssigned("alpha").url, "wss://alpha-two.livekit.cloud");
});

test("before any good list read there is no project: selection fails typed and health is not ready", async () => {
  const f = hotList(null);
  await f.registry.refresh();
  const typed = (error: unknown) => error instanceof LiveKitGatewayError && error.code === "credential_unavailable";
  assert.throws(() => f.registry.selectForNewSession({ sessionId: "session-1" }), typed);
  assert.throws(() => f.registry.getAssigned("alpha"), typed);
  assert.deepEqual(f.registry.all(), []);
  const health = createLiveKitHealthService({
    registry: f.registry,
    gateway: healthyGateway(() => f.nowMs()),
    now: () => new Date(f.nowMs())
  });
  const snapshot = await health.check();
  assert.equal(snapshot.ready, false);
  assert.deepEqual(snapshot.projects, []);
  assert.deepEqual(f.rejections, ["invalid"]);
});

const directories: string[] = [];
afterEach(async () => {
  while (directories.length) await rm(directories.pop()!, { recursive: true, force: true });
});

test("the service starts rooms only on listed active projects and keeps a removed project's live room working", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "lg-study-group-hot-livekit-"));
  directories.push(directory);
  const list = hotList(null, 5_000);
  let nowMs = START;
  const advance = (seconds: number) => { nowMs += seconds * 1000; list.advanceSeconds(seconds); };
  const rooms: string[] = [];
  const gateway = healthyGateway(() => nowMs, rooms);
  const service = createStudyGroupService({
    repository: createStudyGroupRepository(directory),
    now: () => new Date(nowMs),
    hasCourseAccess: async () => true,
    courseSummary: async (courseId) => ({ id: courseId, title: "German History", slug: "german-history" }),
    accessibleCourses: async () => [],
    userProfile: async (userId) => ({ id: userId, displayName: userId, email: `${userId}@example.test`, locale: "en-GB" }),
    notify: async () => undefined,
    listReminders: async () => [],
    sendMail: async () => undefined,
    liveKit: { apiKey: "", apiSecret: "", url: "" },
    liveKitProjects: list.registry,
    liveKitGateway: gateway,
    tokenLogKey: () => Buffer.alloc(32, 7)
  });
  const group = await service.createGroup({ actorUserId: "host", title: "Hot group", courseId: "course-1", about: "About the hot group." });
  const schedule = (title: string) => service.scheduleSession({
    actorUserId: "host",
    groupId: group.id,
    title,
    startsAt: new Date(START + 5 * 60_000).toISOString(),
    durationSeconds: 1800,
    maxParticipants: 4
  });
  const first = await schedule("First");
  const second = await schedule("Second");
  await service.enterSession({ actorUserId: "host", sessionId: first.id, requestedAt: new Date(nowMs).toISOString() });

  // No list in the secret yet: a typed unavailable, never a room on a guess.
  await assert.rejects(service.startSession({ actorUserId: "host", sessionId: first.id }), (error: unknown) => error instanceof StudyGroupError && error.code === "unavailable");
  assert.deepEqual(rooms, []);

  list.write([listEntry("alpha")]);
  advance(6);
  await service.enterSession({ actorUserId: "host", sessionId: first.id, requestedAt: new Date(nowMs).toISOString() });
  await service.startSession({ actorUserId: "host", sessionId: first.id });
  assert.equal((await service.issueToken({ actorUserId: "host", sessionId: first.id })).liveKitUrl, "wss://alpha.livekit.cloud");

  // alpha leaves the list for beta while its room is live.
  list.write([listEntry("beta")]);
  advance(6);
  await service.heartbeat({ actorUserId: "host", sessionId: first.id });
  assert.equal((await service.issueToken({ actorUserId: "host", sessionId: first.id })).liveKitUrl, "wss://alpha.livekit.cloud");
  await service.enterSession({ actorUserId: "host", sessionId: second.id, requestedAt: new Date(nowMs).toISOString() });
  await service.startSession({ actorUserId: "host", sessionId: second.id });
  assert.deepEqual(rooms, [`${first.id}@alpha`, `${second.id}@beta`]);
});
