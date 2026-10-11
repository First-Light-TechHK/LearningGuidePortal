import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { effectiveSessionState, type StudyGroupStore } from "../../modules/group-study/domain";
import { LiveKitGatewayError } from "../../modules/group-study/liveKitGateway";
import { parseLiveKitProjects } from "../../modules/group-study/liveKitProjectRegistry";
import { createStudyGroupRepository, type StudyGroupRepository } from "../../modules/group-study/repository";
import { createStudyGroupService, type StudyGroupDeps, type StudyGroupService } from "../../modules/group-study/service";
import { decryptTokenLogLine } from "../../modules/group-study/tokenLog";

// State-space / model-based suite for the Study Group Live Session lifecycle.
// Rules are quoted from docs/phase1/study-group/study-group-architecture.md ("State", "Atomic steps")
// and docs/phase1/study-group/decisions.md.

const NOW = "2026-09-19T02:00:00.000Z";
const SECRET = "lk-secret-at-least-32-characters";
const tokenLogKey = Buffer.alloc(32, 7);
const createdDirectories: string[] = [];

afterEach(async () => {
  while (createdDirectories.length) await rm(createdDirectories.pop()!, { recursive: true, force: true });
});

type Fixture = {
  directory: string; repository: StudyGroupRepository; service: StudyGroupService; deps: StudyGroupDeps;
  access: Set<string>; clock: { now: Date }; published: string[];
};

async function makeFixture(extra: Partial<StudyGroupDeps> = {}): Promise<Fixture> {
  const directory = await mkdtemp(path.join(tmpdir(), "lg-study-group-state-space-"));
  createdDirectories.push(directory);
  const access = new Set(["host:course-1", "m1:course-1", "m2:course-1", "m3:course-1"]);
  const clock = { now: new Date(NOW) };
  const published: string[] = [];
  const repository = createStudyGroupRepository(directory);
  const deps: StudyGroupDeps = {
    repository,
    now: () => new Date(clock.now.getTime()),
    hasCourseAccess: async (userId, courseId) => access.has(`${userId}:${courseId}`),
    courseSummary: async (courseId) => courseId === "course-1" ? { id: courseId, title: "German History", slug: "german-history" } : null,
    accessibleCourses: async () => [],
    userProfile: async (userId) => ({ id: userId, displayName: userId, email: `${userId}@example.test`, locale: "en-GB" }),
    notify: async () => undefined,
    listReminders: async () => [],
    sendMail: async () => undefined,
    liveKit: { apiKey: "lk-key", apiSecret: SECRET, url: "wss://livekit.example.test" },
    tokenLogKey,
    courseKnowledge: async () => "The Weimar republic ended in 1933. The constitution of 1919 could not hold the government.",
    publishRoomChat: async ({ text }) => { published.push(text); },
    tutorKeys: () => [{ id: "healthy", secret: "fake-key-healthy" }],
    tutorCall: async ({ text }) => ({ outcome: "ok", latencyMs: 1, body: `Answer: ${text}` }),
    ...extra
  };
  return { directory, repository, service: createStudyGroupService(deps), deps, access, clock, published };
}

async function makeGroup(f: Fixture) {
  const group = await f.service.createGroup({ actorUserId: "host", title: "State space", courseId: "course-1", about: "About the state-space group." });
  for (const member of ["m1", "m2", "m3"]) await f.service.joinGroup({ actorUserId: member, groupId: group.id });
  return group;
}

function schedule(f: Fixture, groupId: string, title: string, startsAt: string, maxParticipants: number, extra: { aiTutorEnabled?: boolean } = {}) {
  return f.service.scheduleSession({ actorUserId: "host", groupId, title, startsAt, durationSeconds: 1800, maxParticipants, ...extra });
}

async function rejectsCode(run: () => Promise<unknown>, code: string) {
  let actual: string | undefined;
  await assert.rejects(run, (error: unknown) => { actual = (error as { code?: string } | null)?.code; return true; });
  assert.equal(actual, code);
}

function openPresences(store: StudyGroupStore, sessionId: string) {
  return store.presences.filter((row) => row.sessionId === sessionId && row.enteredAt && !row.leftAt);
}

async function logLines(directory: string) {
  try {
    const text = await readFile(path.join(directory, "token-issuance.log"), "utf8");
    return text.trim() ? text.trim().split("\n") : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

// Live session whose first token issuance fails at the provider: the failure codes `unavailable`,
// the admitted seat survives, and no line reaches the log.
async function startedSessionWithFailedIssuance(f: Fixture, title: string) {
  const group = await makeGroup(f);
  const soon = await schedule(f, group.id, title, "2026-09-19T02:05:00.000Z", 2);
  await f.service.enterSession({ actorUserId: "host", sessionId: soon.id, requestedAt: NOW });
  await f.service.startSession({ actorUserId: "host", sessionId: soon.id });
  await rejectsCode(() => f.service.issueToken({ actorUserId: "host", sessionId: soon.id }), "unavailable");
  assert.deepEqual(openPresences(await f.repository.read(), soon.id).map((row) => row.userId), ["host"]);
  assert.deepEqual(await logLines(f.directory), []);
  return soon;
}

function createGate() {
  let release!: () => void;
  let started!: () => void;
  const opened = new Promise<void>((resolve) => { release = resolve; });
  const entered = new Promise<void>((resolve) => { started = resolve; });
  let armed = false;
  let used = false;
  return {
    arm: () => { armed = true; },
    entered,
    open: () => release(),
    async wait() {
      if (!armed || used) return;
      used = true;
      started();
      await opened;
    }
  };
}

function gatedRepository(base: StudyGroupRepository, gate: ReturnType<typeof createGate>, point: "read" | "update"): StudyGroupRepository {
  return {
    // Fetch the snapshot before holding on the gate: after the gate opens the racing operation
    // must resolve against the store as it was before the interleaved commits, otherwise a
    // check-then-act or stale-snapshot regression would still read fresh data and pass.
    read: async () => { const result = await base.read(); if (point === "read") await gate.wait(); return result; },
    appendTokenLog: (line) => base.appendTokenLog(line),
    update: async (mutate) => { if (point === "update") await gate.wait(); return base.update(mutate); },
    claimNextTutorRequest: (input) => base.claimNextTutorRequest(input),
    settleTutorRequest: (input) => base.settleTutorRequest(input),
    claimNextOutboxMessage: (input) => base.claimNextOutboxMessage(input),
    markOutboxDelivered: (input) => base.markOutboxDelivered(input),
    markOutboxFailed: (input) => base.markOutboxFailed(input),
    insertWebhookReceipt: (input) => base.insertWebhookReceipt(input),
    markWebhookProcessed: (input) => base.markWebhookProcessed(input)
  };
}

// A second service instance over the same store whose repository stalls one read (or update) on the
// gate, so the test can hold an operation between its checks and its write and interleave a second one.
function racingService(f: Fixture, point: "read" | "update") {
  const gate = createGate();
  return { gate, service: createStudyGroupService({ ...f.deps, repository: gatedRepository(f.repository, gate, point) }) };
}

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

test("entry matrix: state x actor x capacity follows the documented accept and reject rules", async () => {
  const f = await makeFixture();
  const group = await makeGroup(f);
  // Scheduled: "Entry is closed" before T-10; the Host waits too (BR-015, session_not_open).
  const scheduled = await schedule(f, group.id, "Entry matrix", "2026-09-19T02:20:00.000Z", 3);
  assert.equal(scheduled.state, "scheduled");
  await rejectsCode(() => f.service.enterSession({ actorUserId: "m1", sessionId: scheduled.id, requestedAt: NOW }), "session_not_open");
  await rejectsCode(() => f.service.enterSession({ actorUserId: "host", sessionId: scheduled.id, requestedAt: NOW }), "session_not_open");
  // Starting Soon: joined members with Course access enter without a plan (BR-020).
  const soon = await schedule(f, group.id, "Entry soon", "2026-09-19T02:05:00.000Z", 3);
  assert.equal(soon.state, "starting_soon");
  await rejectsCode(() => f.service.enterSession({ actorUserId: "outsider", sessionId: soon.id, requestedAt: NOW }), "course_access_required");
  f.access.add("outsider:course-1");
  await rejectsCode(() => f.service.enterSession({ actorUserId: "outsider", sessionId: soon.id, requestedAt: NOW }), "forbidden");
  // "Enter during Starting Soon shows Waiting for Host Start and counts" (SC-013, BR-033, TC-045).
  assert.equal((await f.service.enterSession({ actorUserId: "m1", sessionId: soon.id, requestedAt: NOW })).occupancy, 1);
  assert.deepEqual((await f.repository.read()).presences.filter((row) => row.sessionId === soon.id).map((row) => row.phase), ["waiting"]);
  // "A duplicate enter for someone already seated does not add a row."
  assert.equal((await f.service.enterSession({ actorUserId: "m1", sessionId: soon.id, requestedAt: "2026-09-19T02:00:09.000Z" })).occupancy, 1);
  assert.equal((await f.repository.read()).presences.filter((row) => row.sessionId === soon.id).length, 1);
  // Capacity: "the seventh person ... gets Session Full and no row"; the Host has no reserved seat.
  await f.service.enterSession({ actorUserId: "m2", sessionId: soon.id, requestedAt: NOW });
  assert.equal((await f.service.enterSession({ actorUserId: "m3", sessionId: soon.id, requestedAt: NOW })).occupancy, 3);
  await rejectsCode(() => f.service.enterSession({ actorUserId: "host", sessionId: soon.id, requestedAt: NOW }), "session_full");
  assert.deepEqual(openPresences(await f.repository.read(), soon.id).map((row) => row.userId), ["m1", "m2", "m3"]);
  // Leave frees exactly one seat for the waiting line.
  await f.service.leaveSession({ actorUserId: "m3", sessionId: soon.id });
  assert.equal((await f.service.enterSession({ actorUserId: "host", sessionId: soon.id, requestedAt: NOW })).occupancy, 3);
});

test("plan to attend never reserves a seat and a planned member stays blocked when full", async () => {
  const f = await makeFixture();
  const group = await makeGroup(f);
  const soon = await schedule(f, group.id, "Plan matrix", "2026-09-19T02:05:00.000Z", 2);
  await f.service.planToAttend({ actorUserId: "m1", sessionId: soon.id });
  const planned = await f.service.getSession({ actorUserId: "m1", sessionId: soon.id });
  assert.equal(planned.occupancy, 0);
  assert.equal(planned.plannedCount, 1);
  assert.equal(planned.viewerPlanned, true);
  await f.service.enterSession({ actorUserId: "m2", sessionId: soon.id, requestedAt: NOW });
  await f.service.enterSession({ actorUserId: "host", sessionId: soon.id, requestedAt: NOW });
  // BR-018/BR-021: "A planned member is still blocked when the Session is full."
  await rejectsCode(() => f.service.enterSession({ actorUserId: "m1", sessionId: soon.id, requestedAt: NOW }), "session_full");
  const stored = await f.repository.read();
  assert.equal(openPresences(stored, soon.id).some((row) => row.userId === "m1"), false);
  assert.equal(stored.intents.filter((row) => row.sessionId === soon.id && !row.cancelledAt).length, 1);
  await f.service.cancelAttendance({ actorUserId: "m1", sessionId: soon.id });
  assert.equal((await f.service.getSession({ actorUserId: "m1", sessionId: soon.id })).plannedCount, 0);
});

test("start matrix: only the Host starts, only from Starting Soon, waiters move live with occupancy preserved", async () => {
  const f = await makeFixture();
  const group = await makeGroup(f);
  const scheduled = await schedule(f, group.id, "Start early", "2026-09-19T02:20:00.000Z", 4);
  await rejectsCode(() => f.service.startSession({ actorUserId: "host", sessionId: scheduled.id }), "session_not_open");
  const soon = await schedule(f, group.id, "Start soon", "2026-09-19T02:05:00.000Z", 4);
  await rejectsCode(() => f.service.startSession({ actorUserId: "m1", sessionId: soon.id }), "forbidden");
  f.access.add("outsider:course-1");
  await rejectsCode(() => f.service.startSession({ actorUserId: "outsider", sessionId: soon.id }), "forbidden");
  await f.service.enterSession({ actorUserId: "m1", sessionId: soon.id, requestedAt: NOW });
  await f.service.enterSession({ actorUserId: "m2", sessionId: soon.id, requestedAt: NOW });
  const waitingRows = (await f.repository.read()).presences.filter((row) => row.sessionId === soon.id).sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(waitingRows.map((row) => row.phase), ["waiting", "waiting"]);
  // BR-034: "Host Start moves waiting people into Live without another join, and the count stays."
  const started = await f.service.startSession({ actorUserId: "host", sessionId: soon.id });
  assert.equal(started.state, "live");
  assert.equal(started.occupancy, 2);
  const after = await f.repository.read();
  const liveRows = after.presences.filter((row) => row.sessionId === soon.id).sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(liveRows.map((row) => [row.id, row.enteredAt, row.phase]), waitingRows.map((row) => [row.id, row.enteredAt, "live"]));
  assert.equal(after.meetings.filter((row) => row.sessionId === soon.id).length, 1);
  assert.equal(after.sessions.find((row) => row.id === soon.id)?.startedAt, NOW);
  // "A second Start does not insert another row."
  assert.equal((await f.service.startSession({ actorUserId: "host", sessionId: soon.id })).state, "live");
  assert.equal((await f.repository.read()).meetings.filter((row) => row.sessionId === soon.id).length, 1);
});

test("leave matrix: a leave before start does not complete; the last leave after start completes once", async () => {
  const f = await makeFixture();
  const group = await makeGroup(f);
  const soon = await schedule(f, group.id, "Leave soon", "2026-09-19T02:05:00.000Z", 4);
  await f.service.enterSession({ actorUserId: "m1", sessionId: soon.id, requestedAt: NOW });
  await f.service.leaveSession({ actorUserId: "m1", sessionId: soon.id });
  const stored = await f.repository.read();
  assert.equal(stored.sessions.find((row) => row.id === soon.id)?.status, "scheduled");
  assert.equal((await f.service.getSession({ actorUserId: "host", sessionId: soon.id })).state, "starting_soon");
  assert.equal(stored.meetings.length, 0);
  await f.service.enterSession({ actorUserId: "host", sessionId: soon.id, requestedAt: NOW });
  await f.service.enterSession({ actorUserId: "m2", sessionId: soon.id, requestedAt: NOW });
  await f.service.startSession({ actorUserId: "host", sessionId: soon.id });
  // Live entry while capacity remains; the earlier row for m1 is reused, not duplicated.
  assert.equal((await f.service.enterSession({ actorUserId: "m1", sessionId: soon.id, requestedAt: NOW })).occupancy, 3);
  assert.deepEqual((await f.repository.read()).presences.filter((row) => row.sessionId === soon.id && row.userId === "m1").map((row) => row.phase), ["live"]);
  // BR-026: "Leave Session exits only that user. The Session stays Live while someone remains."
  await f.service.leaveSession({ actorUserId: "m1", sessionId: soon.id });
  assert.equal((await f.service.getSession({ actorUserId: "m2", sessionId: soon.id })).state, "live");
  await f.service.leaveSession({ actorUserId: "m2", sessionId: soon.id });
  assert.equal((await f.service.getSession({ actorUserId: "host", sessionId: soon.id })).occupancy, 1);
  // SC-012/BR-027: "The final participant leaving completes the Session" and ends the one meeting row.
  await f.service.leaveSession({ actorUserId: "host", sessionId: soon.id });
  const completed = await f.service.getSession({ actorUserId: "host", sessionId: soon.id });
  assert.equal(completed.state, "completed");
  assert.equal(completed.occupancy, 0);
  assert.deepEqual(completed.attendees.map((row) => row.userId).sort(), ["host", "m1", "m2"]);
  const meetings = (await f.repository.read()).meetings.filter((row) => row.sessionId === soon.id);
  assert.equal(meetings.length, 1);
  assert.equal(meetings[0].endedAt, NOW);
});

test("cancel matrix: cancel before start removes and releases; cancel after live is refused", async () => {
  const f = await makeFixture();
  const group = await makeGroup(f);
  const soon = await schedule(f, group.id, "Cancel soon", "2026-09-19T02:05:00.000Z", 4);
  await f.service.enterSession({ actorUserId: "m1", sessionId: soon.id, requestedAt: NOW });
  await rejectsCode(() => f.service.cancelSession({ actorUserId: "m1", sessionId: soon.id }), "forbidden");
  // BR-017: "Cancel removes the record. No Cancelled card." Waiting seats are released.
  await f.service.cancelSession({ actorUserId: "host", sessionId: soon.id });
  const stored = await f.repository.read();
  assert.equal(stored.sessions.find((row) => row.id === soon.id)?.status, "removed");
  assert.equal(stored.presences.find((row) => row.sessionId === soon.id)?.leftAt, NOW);
  await rejectsCode(() => f.service.getSession({ actorUserId: "m1", sessionId: soon.id }), "not_found");
  assert.equal((await f.service.getGroup({ actorUserId: "host", groupId: group.id })).sessions?.some((row) => row.id === soon.id), false);
  const live = await schedule(f, group.id, "Cancel live", "2026-09-19T02:06:00.000Z", 4);
  await f.service.enterSession({ actorUserId: "host", sessionId: live.id, requestedAt: NOW });
  await f.service.startSession({ actorUserId: "host", sessionId: live.id });
  // TC-017: "Edit and cancel unavailable after Live start."
  await rejectsCode(() => f.service.cancelSession({ actorUserId: "host", sessionId: live.id }), "forbidden");
  await rejectsCode(() => f.service.cancelSession({ actorUserId: "host", sessionId: soon.id }), "not_found");
});

test("token matrix: issued only when live and seated; failures surface as unavailable and write no log", async () => {
  const f = await makeFixture();
  const group = await makeGroup(f);
  const soon = await schedule(f, group.id, "Token soon", "2026-09-19T02:05:00.000Z", 4);
  await f.service.enterSession({ actorUserId: "host", sessionId: soon.id, requestedAt: NOW });
  // Waiting is not Live.
  await rejectsCode(() => f.service.issueToken({ actorUserId: "host", sessionId: soon.id }), "session_not_open");
  await f.service.startSession({ actorUserId: "host", sessionId: soon.id });
  // Live but not seated: no token.
  await rejectsCode(() => f.service.issueToken({ actorUserId: "m1", sessionId: soon.id }), "forbidden");
  const issued = await f.service.issueToken({ actorUserId: "host", sessionId: soon.id });
  assert.equal(issued.liveKitUrl, "wss://livekit.example.test");
  const payload = JSON.parse(Buffer.from(issued.token.split(".")[1], "base64url").toString("utf8")) as { sub: string; video: { room: string } };
  assert.deepEqual([payload.sub, payload.video.room], ["host", soon.id]);
  const lines = await logLines(f.directory);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].includes(issued.token) || lines[0].includes(SECRET), false);
  const decoded = decryptTokenLogLine(lines[0], tokenLogKey);
  assert.deepEqual([decoded.userId, decoded.sessionId, decoded.state], ["host", soon.id, "token_issued"]);
  await f.service.leaveSession({ actorUserId: "host", sessionId: soon.id });
  await rejectsCode(() => f.service.issueToken({ actorUserId: "host", sessionId: soon.id }), "session_unavailable");
  // Provider outcome: credential unavailable. The admitted seat stays retryable ("Issuing a token is
  // not a user leave. Keeping the admission row makes both an initial failure and a verified-recovery
  // failure retryable." — issueToken), and recovery then succeeds.
  const liveKit = { apiKey: "", apiSecret: "", url: "" };
  const g = await makeFixture({ liveKit });
  const gSoon = await startedSessionWithFailedIssuance(g, "No credentials");
  Object.assign(liveKit, { apiKey: "lk-key", apiSecret: SECRET, url: "wss://livekit.example.test" });
  assert.equal((await g.service.issueToken({ actorUserId: "host", sessionId: gSoon.id })).liveKitUrl, "wss://livekit.example.test");
  // Provider outcome: gateway error. Normalized to `unavailable`; no raw provider text, no log line.
  const h = await makeFixture({
    liveKitProjects: parseLiveKitProjects(JSON.stringify([{ id: "p1", url: "wss://p1.example.test", state: "active", credentialSecretId: "s/p1" }])),
    liveKitGateway: {
      ensureRoom: async () => undefined,
      issueParticipantToken: async () => { throw new LiveKitGatewayError("unauthorized"); },
      publishTutorMessage: async () => undefined,
      removeParticipant: async () => undefined,
      healthCheck: async ({ project }) => ({ projectId: project.id, status: "healthy", evidence: "provider_api", providerVerified: true, checkedAt: NOW, latencyMs: 0, activeRooms: 0 })
    }
  });
  await startedSessionWithFailedIssuance(h, "Gateway error");
});

test("interleaving enter+enter: overlapping grants keep occupancy within the cap and the late grant sees the fresh store", async () => {
  const f = await makeFixture();
  const { gate, service: racing } = racingService(f, "read");
  const group = await makeGroup(f);
  const soon = await schedule(f, group.id, "Race enter", "2026-09-19T02:05:00.000Z", 2);
  gate.arm();
  const delayed = racing.enterSession({ actorUserId: "m1", sessionId: soon.id, requestedAt: NOW });
  await gate.entered;
  // The two other grants complete while m1 sits between its access read and its write.
  await f.service.enterSession({ actorUserId: "m2", sessionId: soon.id, requestedAt: NOW });
  await f.service.enterSession({ actorUserId: "m3", sessionId: soon.id, requestedAt: NOW });
  gate.open();
  // "The repository grants one presence if occupancy is still under the Session maximum."
  await rejectsCode(() => delayed, "session_full");
  assert.deepEqual(openPresences(await f.repository.read(), soon.id).map((row) => row.userId), ["m2", "m3"]);
});

test("interleaving enter+start: an entrant admitted during the start is moved live and occupancy is preserved", async () => {
  const f = await makeFixture();
  const { gate, service: racing } = racingService(f, "read");
  const group = await makeGroup(f);
  const soon = await schedule(f, group.id, "Race start", "2026-09-19T02:05:00.000Z", 4);
  await f.service.enterSession({ actorUserId: "host", sessionId: soon.id, requestedAt: NOW });
  await f.service.enterSession({ actorUserId: "m1", sessionId: soon.id, requestedAt: NOW });
  gate.arm();
  const delayedStart = racing.startSession({ actorUserId: "host", sessionId: soon.id });
  await gate.entered;
  assert.equal((await f.service.enterSession({ actorUserId: "m2", sessionId: soon.id, requestedAt: NOW })).occupancy, 3);
  gate.open();
  const view = await delayedStart;
  assert.equal(view.state, "live");
  assert.equal(view.occupancy, 3);
  const store = await f.repository.read();
  assert.deepEqual(store.presences.filter((row) => row.sessionId === soon.id).map((row) => row.phase), ["live", "live", "live"]);
  assert.equal(store.meetings.filter((row) => row.sessionId === soon.id).length, 1);
});

test("interleaving start+leave: a leave that commits during an in-flight Host start is honored", async () => {
  const f = await makeFixture();
  const { gate, service: racing } = racingService(f, "update");
  const group = await makeGroup(f);
  const soon = await schedule(f, group.id, "Start leave", "2026-09-19T02:05:00.000Z", 4);
  await f.service.enterSession({ actorUserId: "host", sessionId: soon.id, requestedAt: NOW });
  await f.service.enterSession({ actorUserId: "m1", sessionId: soon.id, requestedAt: NOW });
  gate.arm();
  const delayedStart = racing.startSession({ actorUserId: "host", sessionId: soon.id });
  await gate.entered;
  await f.service.leaveSession({ actorUserId: "m1", sessionId: soon.id });
  gate.open();
  const view = await delayedStart;
  assert.equal(view.state, "live");
  assert.equal(view.occupancy, 1);
  const store = await f.repository.read();
  const m1Row = store.presences.find((row) => row.sessionId === soon.id && row.userId === "m1");
  assert.equal(m1Row?.leftAt, NOW);
  assert.equal(m1Row?.phase, "waiting");
  assert.deepEqual(openPresences(store, soon.id).map((row) => row.userId), ["host"]);
  assert.equal(store.meetings.filter((row) => row.sessionId === soon.id).length, 1);
});

test("interleaving leave+leave: the session completes exactly on the leave that empties the live room", async () => {
  const f = await makeFixture();
  const { gate, service: racing } = racingService(f, "update");
  const group = await makeGroup(f);
  const soon = await schedule(f, group.id, "Leave leave", "2026-09-19T02:05:00.000Z", 4);
  await f.service.enterSession({ actorUserId: "host", sessionId: soon.id, requestedAt: NOW });
  await f.service.enterSession({ actorUserId: "m1", sessionId: soon.id, requestedAt: NOW });
  await f.service.startSession({ actorUserId: "host", sessionId: soon.id });
  gate.arm();
  const delayedLeave = racing.leaveSession({ actorUserId: "host", sessionId: soon.id });
  await gate.entered;
  await f.service.leaveSession({ actorUserId: "m1", sessionId: soon.id });
  assert.equal((await f.service.getSession({ actorUserId: "m1", sessionId: soon.id })).state, "live");
  gate.open();
  await delayedLeave;
  const store = await f.repository.read();
  assert.equal(store.sessions.find((row) => row.id === soon.id)?.status, "completed");
  assert.equal(store.sessions.find((row) => row.id === soon.id)?.completedAt, NOW);
  const meetings = store.meetings.filter((row) => row.sessionId === soon.id);
  assert.equal(meetings.length, 1);
  assert.equal(meetings[0].endedAt, NOW);
  assert.equal(openPresences(store, soon.id).length, 0);
});

test("interleaving enqueue+enqueue: one clientEventId stores exactly one item", async () => {
  const f = await makeFixture();
  const group = await makeGroup(f);
  const soon = await schedule(f, group.id, "Duplicate ask", "2026-09-19T02:05:00.000Z", 4, { aiTutorEnabled: true });
  await f.service.enterSession({ actorUserId: "host", sessionId: soon.id, requestedAt: NOW });
  await f.service.startSession({ actorUserId: "host", sessionId: soon.id });
  const [first, second] = await Promise.all([
    f.service.enqueueTutor({ actorUserId: "host", sessionId: soon.id, text: "What ended in 1933?", clientEventId: "evt-shared" }),
    f.service.enqueueTutor({ actorUserId: "host", sessionId: soon.id, text: "What ended in 1933? replay", clientEventId: "evt-shared" })
  ]);
  // "enqueue is idempotent per clientEventId"; "the same client event id returns the original tutor item."
  assert.equal(first.id, second.id);
  const items = (await f.repository.read()).tutorRequests.filter((row) => row.sessionId === soon.id);
  assert.deepEqual(items.map((row) => row.text), ["What ended in 1933?"]);
  // Another user may reuse the same client id for their own item.
  await f.service.enterSession({ actorUserId: "m1", sessionId: soon.id, requestedAt: NOW });
  const other = await f.service.enqueueTutor({ actorUserId: "m1", sessionId: soon.id, text: "What ended in 1933? mine", clientEventId: "evt-shared" });
  assert.notEqual(other.id, first.id);
  assert.equal((await f.repository.read()).tutorRequests.filter((row) => row.sessionId === soon.id).length, 2);
});

test("interleaving enqueue+deliver: receipt order holds at one millisecond, one in-flight, and a failed item does not strand the queue", async () => {
  const calls: string[] = [];
  let releaseFirst!: () => void;
  const firstCallGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  let signalFirst!: () => void;
  const firstCallStarted = new Promise<void>((resolve) => { signalFirst = resolve; });
  const f = await makeFixture({
    tutorCall: async ({ text }) => {
      calls.push(text);
      if (calls.length === 1) { signalFirst(); await firstCallGate; }
      if (text.includes("fail")) return { outcome: "failed", latencyMs: 1 };
      return { outcome: "ok", latencyMs: 1, body: `Answer: ${text}` };
    }
  });
  const group = await makeGroup(f);
  const soon = await schedule(f, group.id, "Deliver race", "2026-09-19T02:05:00.000Z", 4, { aiTutorEnabled: true });
  await f.service.enterSession({ actorUserId: "host", sessionId: soon.id, requestedAt: NOW });
  await f.service.enterSession({ actorUserId: "m1", sessionId: soon.id, requestedAt: NOW });
  await f.service.startSession({ actorUserId: "host", sessionId: soon.id });
  await f.service.enqueueTutor({ actorUserId: "host", sessionId: soon.id, text: "What ended in 1933? first", clientEventId: "evt-1" });
  await f.service.enqueueTutor({ actorUserId: "m1", sessionId: soon.id, text: "What ended in 1933? second", clientEventId: "evt-2" });
  // Every item shares one millisecond; rename ids so lexical id order contradicts server receipt order.
  await f.repository.update((store) => {
    const rows = store.tutorRequests.filter((row) => row.sessionId === soon.id);
    rows[0].id = "zz-first";
    rows[1].id = "aa-second";
  });
  const delivery = f.service.deliverTutorAnswer({ sessionId: soon.id });
  await firstCallStarted;
  assert.equal((await f.repository.read()).tutorRequests.filter((row) => row.sessionId === soon.id && row.inFlight).length, 1);
  // A question asked while the first is in flight queues behind, it does not cancel or merge.
  await f.service.enqueueTutor({ actorUserId: "host", sessionId: soon.id, text: "What ended in 1933? fail", clientEventId: "evt-3" });
  assert.equal((await f.repository.read()).tutorRequests.find((row) => row.clientEventId === "evt-3")?.inFlight, false);
  releaseFirst();
  await delivery;
  assert.deepEqual(calls, ["What ended in 1933? first", "What ended in 1933? second", "What ended in 1933? fail"]);
  assert.deepEqual(f.published, ["Answer: What ended in 1933? first", "Answer: What ended in 1933? second"]);
  // Terminal failure settles the item and advances; nothing stays in flight.
  const items = (await f.repository.read()).tutorRequests.filter((row) => row.sessionId === soon.id);
  assert.equal(items.every((row) => row.answeredAt && !row.inFlight), true);
});

const ACCEPTABLE_CODES = new Set(["session_full", "session_not_open", "forbidden", "not_found", "session_unavailable", "course_access_required"]);
const SWEEP_ACTORS = ["host", "m1", "m2", "m3", "outsider"] as const;

async function assertInvariants(f: Fixture, groupId: string, where: string) {
  const store = await f.repository.read();
  const presenceKeys = store.presences.map((row) => `${row.sessionId}:${row.userId}`);
  assert.equal(new Set(presenceKeys).size, presenceKeys.length, `${where}: one presence row per user and session`);
  const itemKeys = store.tutorRequests.map((row) => `${row.sessionId}:${row.userId}:${row.clientEventId}`);
  assert.equal(new Set(itemKeys).size, itemKeys.length, `${where}: one tutor item per clientEventId`);
  for (const session of store.sessions) {
    const open = openPresences(store, session.id);
    assert.ok(open.length <= session.maxParticipants, `${where}: occupancy ${open.length} exceeds maxParticipants ${session.maxParticipants}`);
    const meetings = store.meetings.filter((row) => row.sessionId === session.id);
    assert.ok(meetings.length <= 1, `${where}: more than one meeting row`);
    assert.equal(meetings.length === 1, Boolean(session.startedAt), `${where}: one meeting row exists exactly when the session started`);
    assert.ok(store.tutorRequests.filter((row) => row.sessionId === session.id && row.inFlight).length <= 1, `${where}: at most one in-flight tutor item`);
    if (effectiveSessionState(session, f.clock.now) === "scheduled") assert.equal(open.length, 0, `${where}: entry is closed before T-10`);
    if (session.status === "scheduled") assert.ok(open.every((row) => row.phase === "waiting"), `${where}: waiters stay in the waiting phase`);
    if (session.status === "live") assert.ok(open.every((row) => row.phase === "live"), `${where}: a live session has no waiting presences`);
    if (session.status === "completed" || session.status === "removed") assert.equal(open.length, 0, `${where}: closed sessions hold no open presence`);
  }
  for (const view of (await f.service.getGroup({ actorUserId: "host", groupId })).sessions ?? []) {
    assert.equal(view.occupancy, openPresences(store, view.id).length, `${where}: the session view occupancy must match the store`);
  }
}

test("seeded sweep: random short operation sequences preserve the invariants after every step", async () => {
  // Invariants can hold vacuously on empty state, so count how many steps actually succeed in
  // each beneficial class: an all-rejecting or non-persisting service must fail the sweep below.
  const liveness = { enterAdmitted: 0, startSucceeded: 0, tokenIssued: 0, tutorEnqueued: 0, tutorPublished: 0 };
  for (let seed = 1; seed <= 80; seed += 1) {
    const random = mulberry32(0x51e9cafe ^ seed);
    const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
    const f = await makeFixture();
    const labels: string[] = [];
    const group = await makeGroup(f);
    const tutorSession = await schedule(f, group.id, "Tutor session", "2026-09-19T02:05:00.000Z", 3, { aiTutorEnabled: true });
    const later = await schedule(f, group.id, "Later session", "2026-09-19T02:25:00.000Z", 2, { aiTutorEnabled: false });
    const sessions = [tutorSession.id, later.id];
    const step = async (label: string, run: () => Promise<unknown>) => {
      labels.push(label);
      try {
        await run();
      } catch (error) {
        const code = (error as { code?: string } | null)?.code;
        if (!code || !ACCEPTABLE_CODES.has(code)) throw error;
      }
      await assertInvariants(f, group.id, `seed=${seed} steps=[${labels.join(" > ")}]`);
    };
    try {
      const steps = 6 + Math.floor(random() * 7);
      for (let index = 0; index < steps; index += 1) {
        const actor = pick(SWEEP_ACTORS);
        const sessionId = pick(sessions);
        const advance = pick([1, 5, 15, 45]);
        const operations: Array<[string, () => Promise<unknown>]> = [
          [`enter(${actor})`, async () => {
            await f.service.enterSession({ actorUserId: actor, sessionId, requestedAt: f.clock.now.toISOString() });
            // Count only a seat the store actually holds, so a non-persisting enter cannot earn credit.
            if (openPresences(await f.repository.read(), sessionId).some((row) => row.userId === actor)) liveness.enterAdmitted += 1;
          }],
          [`plan(${actor})`, () => f.service.planToAttend({ actorUserId: actor, sessionId })],
          [`cancelAttendance(${actor})`, () => f.service.cancelAttendance({ actorUserId: actor, sessionId })],
          [`start(${actor})`, async () => {
            if ((await f.service.startSession({ actorUserId: actor, sessionId })).state === "live") liveness.startSucceeded += 1;
          }],
          [`leave(${actor})`, () => f.service.leaveSession({ actorUserId: actor, sessionId })],
          // "Token issuance only when live and seated": a fulfilled token proves both facts.
          [`token(${actor})`, async () => {
            const issued = await f.service.issueToken({ actorUserId: actor, sessionId });
            const store = await f.repository.read();
            assert.equal(store.sessions.find((row) => row.id === sessionId)?.status, "live");
            assert.equal(openPresences(store, sessionId).some((row) => row.userId === actor), true);
            liveness.tokenIssued += 1;
            return issued;
          }],
          [`enqueue(${actor})`, async () => {
            await f.service.enqueueTutor({ actorUserId: actor, sessionId, text: "What ended in 1933?", clientEventId: `evt-${Math.floor(random() * 3)}` });
            liveness.tutorEnqueued += 1;
          }],
          ["deliver()", async () => {
            const publishCount = f.published.length;
            await f.service.deliverTutorAnswer({ sessionId });
            liveness.tutorPublished += f.published.length - publishCount;
          }],
          [`advance(+${advance}m)`, async () => { f.clock.now = new Date(f.clock.now.getTime() + advance * 60_000); }]
        ];
        const [label, run] = pick(operations);
        await step(label, run);
      }
    } catch (error) {
      throw new Error(`state-space sweep failed: seed=${seed} sequence=[${labels.join(" -> ")}]`, { cause: error });
    }
  }
  // Liveness floors: invariants hold vacuously on an idle store, so an all-rejecting service or a
  // service whose enter resolves without persisting the seat would still pass every check above.
  // tokenIssued, tutorEnqueued and tutorPublished are tracked the same way; with these fixed seeds
  // the random mix never lines those steps up with a live session and a seated actor, so the enter
  // and start floors are the ones that bite (the real sweep scores 43 / 6 / 0 / 0 / 0).
  assert.ok(liveness.enterAdmitted >= 10, `seeded sweep admitted too few entries across 80 seeds: ${JSON.stringify(liveness)}`);
  assert.ok(liveness.startSucceeded >= 2, `seeded sweep started too few sessions across 80 seeds: ${JSON.stringify(liveness)}`);
});
