import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import type { PresenceRow, StudyGroupStore } from "../../modules/group-study/domain";
import type { LiveKitRoomGateway, LiveKitWebhookEvent } from "../../modules/group-study/liveKitGateway";
import { parseLiveKitProjects } from "../../modules/group-study/liveKitProjectRegistry";
import { createStudyGroupRepository, type StudyGroupRepository, type WebhookReceiptStatus } from "../../modules/group-study/repository";
import { EMPTY_LIVE_GRACE_MS, SEAT_LEASE_MS } from "../../modules/group-study/presence";
import { createStudyGroupService, type StudyGroupDeps, type StudyGroupService } from "../../modules/group-study/service";

// BUG-0108 regression (SIT) and the QA 2026-10-19 seat redesign: refreshing
// the browser during a Live Session used to send a Leave request, so a
// reloading last person completed the session before the reload could come
// back ("已经结束"). Later fixes layered an unload-class leave, a provider sweep
// and participant_left webhooks on top, and those four sources disagreed: a
// last person who closed the tab or lost the network kept the room live and
// the seat held (QA 一 / N1-N3). A seat is now a server lease (presence.ts):
// entering grants it, the room's heartbeat renews it, an explicit Leave
// releases it, and a seat nobody renews lapses one lease later. A live session
// with no seat for the grace period ends, dated to when it emptied. The unload
// beacon and provider webhooks no longer touch seats at all.

const START = "2026-10-14T10:00:00.000Z";
const tokenLogKey = Buffer.alloc(32, 7);
const createdDirectories: string[] = [];

afterEach(async () => {
  while (createdDirectories.length) await rm(createdDirectories.pop()!, { recursive: true, force: true });
});

const PROJECTS_JSON = JSON.stringify([
  { id: "eu-primary", url: "wss://eu-primary.livekit.cloud", state: "active", weight: 1, credentialSecretId: "lg/livekit/eu-primary" }
]);

type MutableReceipt = { receiptId: string; status: WebhookReceiptStatus; failureClass: string | null };

type RefreshFixture = {
  service: StudyGroupService;
  repository: StudyGroupRepository;
  directory: string;
  clock: () => string;
  advanceSeconds: (seconds: number) => void;
  /** The provider's current room membership served to sweep B (listParticipants). */
  participants: string[];
  /** The next signed event the stub gateway verifies for handleLiveKitWebhook. */
  nextEvent: (event: LiveKitWebhookEvent | null) => void;
  receipts: Map<string, MutableReceipt>;
};

async function refreshFixture(): Promise<RefreshFixture> {
  const directory = await mkdtemp(path.join(tmpdir(), "lg-study-group-refresh-"));
  createdDirectories.push(directory);
  const base = createStudyGroupRepository(directory);
  let nowMs = Date.parse(START);
  const receipts = new Map<string, MutableReceipt>();
  let next: LiveKitWebhookEvent | null = null;
  const participants: string[] = [];
  const access = new Set(["host:course-1", "member:course-1"]);

  const repository: StudyGroupRepository = {
    read: () => base.read(),
    appendTokenLog: (line) => base.appendTokenLog(line),
    update: (mutate) => base.update(mutate),
    claimNextTutorRequest: (input) => base.claimNextTutorRequest(input),
    settleTutorRequest: (input) => base.settleTutorRequest(input),
    claimNextOutboxMessage: (input) => base.claimNextOutboxMessage(input),
    markOutboxDelivered: (input) => base.markOutboxDelivered(input),
    markOutboxFailed: (input) => base.markOutboxFailed(input),
    insertWebhookReceipt: async (input) => {
      if (receipts.has(input.receiptId)) return false;
      receipts.set(input.receiptId, { receiptId: input.receiptId, status: "received", failureClass: null });
      return true;
    },
    getWebhookReceipt: async (receiptId) => {
      const row = receipts.get(receiptId);
      return row ? { ...row } : null;
    },
    markWebhookProcessed: async (input) => {
      const row = receipts.get(input.receiptId);
      if (row) {
        row.status = input.result;
        row.failureClass = input.failureClass ?? null;
      }
    },
    abandonStaleWebhookReceipts: async () => 0,
    // The PostgreSQL sweep query, mirrored over the file store: live sessions
    // that still hold at least one open presence.
    listLiveSessionsWithOpenPresences: async (limit) => {
      const store = await base.read();
      return store.sessions
        .filter((session) => session.status === "live" && store.presences.some((presence) => presence.sessionId === session.id && presence.enteredAt && !presence.leftAt))
        .slice(0, limit)
        .map((session) => ({ id: session.id, liveKitProjectId: session.liveKitProjectId ?? null }));
    },
    listSessionsWithPendingTutorWork: (input) => base.listSessionsWithPendingTutorWork(input),
    studyGroupOperationalMetrics: () => base.studyGroupOperationalMetrics()
  };

  const gateway: LiveKitRoomGateway = {
    ensureRoom: async () => undefined,
    issueParticipantToken: async () => ({ token: "stub-token", expiresAt: START, url: "wss://livekit.example.test" }),
    publishTutorMessage: async () => undefined,
    removeParticipant: async () => undefined,
    healthCheck: async ({ project }) => ({ projectId: project.id, status: "healthy", evidence: "provider_api", providerVerified: true, checkedAt: START, latencyMs: 0 }),
    verifyWebhook: async () => {
      if (!next) throw new Error("no webhook event configured");
      return next;
    },
    listParticipants: async () => participants.map((identity) => ({ identity }))
  };

  const deps: StudyGroupDeps = {
    repository,
    now: () => new Date(nowMs),
    hasCourseAccess: async (userId, courseId) => access.has(`${userId}:${courseId}`),
    courseSummary: async (courseId) => courseId === "course-1" ? { id: courseId, title: "German History", slug: "german-history" } : null,
    accessibleCourses: async () => [],
    userProfile: async (userId) => ({ id: userId, displayName: userId, email: `${userId}@example.test`, locale: "en-GB" }),
    notify: async () => undefined,
    listReminders: async () => [],
    sendMail: async () => undefined,
    liveKit: { apiKey: "lk-key", apiSecret: "lk-secret-at-least-32-characters", url: "wss://livekit.example.test" },
    liveKitProjects: parseLiveKitProjects(PROJECTS_JSON),
    liveKitGateway: gateway,
    tokenLogKey: () => tokenLogKey
  };

  return {
    service: createStudyGroupService(deps),
    repository,
    directory,
    clock: () => new Date(nowMs).toISOString(),
    advanceSeconds: (seconds) => { nowMs += seconds * 1000; },
    participants,
    nextEvent: (event) => { next = event; },
    receipts
  };
}

function presenceOf(store: StudyGroupStore, sessionId: string, userId: string): PresenceRow | undefined {
  return store.presences.find((row) => row.sessionId === sessionId && row.userId === userId);
}

/** A live session with the given users seated (the Host among them), started by the Host. */
async function liveRoom(f: RefreshFixture, seat: string[] = ["host"]) {
  const group = await f.service.createGroup({ actorUserId: "host", title: "Refresh group", courseId: "course-1", about: "About the refresh group." });
  await f.service.joinGroup({ actorUserId: "member", groupId: group.id });
  const session = await f.service.scheduleSession({
    actorUserId: "host",
    groupId: group.id,
    title: "Refresh session",
    startsAt: new Date(Date.parse(START) + 5 * 60_000).toISOString(),
    durationSeconds: 1800,
    maxParticipants: 4
  });
  for (const userId of seat) {
    await f.service.enterSession({ actorUserId: userId, sessionId: session.id, requestedAt: f.clock() });
  }
  await f.service.startSession({ actorUserId: "host", sessionId: session.id });
  // The provider's view: everyone seated is connected until a test says otherwise.
  f.participants.splice(0, f.participants.length, ...seat);
  return { group, session };
}

const LEASE_S = SEAT_LEASE_MS / 1000;
const GRACE_S = EMPTY_LIVE_GRACE_MS / 1000;
const at = (seconds: number) => new Date(Date.parse(START) + seconds * 1000).toISOString();

/** Advances the clock in heartbeat steps, renewing the given users' seats each step. */
async function heartbeatFor(f: RefreshFixture, sessionId: string, users: string[], seconds: number) {
  for (let elapsed = 0; elapsed < seconds; elapsed += 10) {
    f.advanceSeconds(Math.min(10, seconds - elapsed));
    for (const userId of users) await f.service.heartbeat({ actorUserId: userId, sessionId });
  }
}

test("a refresh keeps the seat: the unload signal is a no-op and the reload re-enters the same live session", async () => {
  const f = await refreshFixture();
  const { session } = await liveRoom(f);

  await f.service.leaveSession({ actorUserId: "host", sessionId: session.id, reason: "unload" });
  const held = await f.service.getSession({ actorUserId: "host", sessionId: session.id });
  assert.equal(held.state, "live");
  assert.equal(held.occupancy, 1);
  assert.equal(presenceOf(await f.repository.read(), session.id, "host")?.leftAt, null);

  // The reload finishes two seconds later and enters again: the same seat is
  // renewed, not a second one taken.
  f.advanceSeconds(2);
  const again = await f.service.enterSession({ actorUserId: "host", sessionId: session.id, requestedAt: f.clock() });
  assert.equal(again.occupancy, 1);
  const store = await f.repository.read();
  assert.equal(store.presences.filter((row) => row.sessionId === session.id && row.userId === "host").length, 1);
  assert.equal(presenceOf(store, session.id, "host")?.lastSeenAt, f.clock());

  // An explicit Leave Session still ends the session when nobody remains.
  await f.service.leaveSession({ actorUserId: "host", sessionId: session.id });
  const ended = await f.service.getSession({ actorUserId: "host", sessionId: session.id });
  assert.equal(ended.state, "completed");
  assert.equal((await f.repository.read()).sessions.find((row) => row.id === session.id)?.completedAt, f.clock());
});

test("a closed tab or lost network releases only that seat one lease later while others keep the room", async () => {
  const f = await refreshFixture();
  const { session } = await liveRoom(f, ["host", "member"]);

  // The member's page goes away without any signal; the Host keeps renewing.
  await heartbeatFor(f, session.id, ["host"], LEASE_S + 10);
  const view = await f.service.getSession({ actorUserId: "host", sessionId: session.id });
  assert.equal(view.state, "live");
  assert.equal(view.occupancy, 1);
  // Readers already see the lapse; the next write records it at the lapse time.
  assert.equal(presenceOf(await f.repository.read(), session.id, "member")?.leftAt, at(LEASE_S));

  // The member's own heartbeat after the lapse does not revive the seat: the
  // page has to enter again, which takes a seat through the normal checks.
  assert.deepEqual(await f.service.heartbeat({ actorUserId: "member", sessionId: session.id }), { seated: false, occupancy: 1, state: "live" });
  await f.service.enterSession({ actorUserId: "member", sessionId: session.id, requestedAt: f.clock() });
  assert.equal((await f.service.getSession({ actorUserId: "host", sessionId: session.id })).occupancy, 2);

  await f.service.leaveSession({ actorUserId: "member", sessionId: session.id });
  assert.equal((await f.service.getSession({ actorUserId: "host", sessionId: session.id })).state, "live");
  await f.service.leaveSession({ actorUserId: "host", sessionId: session.id });
  assert.equal((await f.service.getSession({ actorUserId: "host", sessionId: session.id })).state, "completed");
});

test("the last person gone without leaving ends the session after the grace, dated to when the room emptied", async () => {
  const f = await refreshFixture();
  const { session } = await liveRoom(f);

  // The seat lapses at the lease end; inside the grace the session waits for
  // a reload to come back, so a sweep there changes nothing but the seat.
  f.advanceSeconds(LEASE_S + GRACE_S - 5);
  assert.deepEqual(await f.service.reconcileLiveKitState(), { abandonedReceipts: 0, sessionsChecked: 0, presencesClosed: 1 });
  assert.equal((await f.service.getSession({ actorUserId: "host", sessionId: session.id })).state, "live");
  assert.equal((await f.service.getSession({ actorUserId: "host", sessionId: session.id })).occupancy, 0);

  f.advanceSeconds(10);
  assert.deepEqual(await f.service.reconcileLiveKitState(), { abandonedReceipts: 0, sessionsChecked: 1, presencesClosed: 0 });
  const store = await f.repository.read();
  const ended = store.sessions.find((row) => row.id === session.id);
  assert.equal(ended?.status, "completed");
  assert.equal(ended?.completedAt, at(LEASE_S));
  assert.equal(presenceOf(store, session.id, "host")?.leftAt, at(LEASE_S));
  assert.equal(store.meetings.find((row) => row.sessionId === session.id)?.endedAt, at(LEASE_S));
});

test("a reload that comes back after the seat lapsed but inside the grace continues the same session", async () => {
  const f = await refreshFixture();
  const { session } = await liveRoom(f);

  f.advanceSeconds(LEASE_S + 20);
  await f.service.sweepPresence();
  const again = await f.service.enterSession({ actorUserId: "host", sessionId: session.id, requestedAt: f.clock() });
  assert.equal(again.occupancy, 1);
  f.advanceSeconds(GRACE_S + 30);
  await f.service.heartbeat({ actorUserId: "host", sessionId: session.id });
  assert.equal((await f.service.getSession({ actorUserId: "host", sessionId: session.id })).state, "live");
});

test("a held seat in Starting Soon lapses too, so it never blocks the room", async () => {
  const f = await refreshFixture();
  const group = await f.service.createGroup({ actorUserId: "host", title: "Waiting group", courseId: "course-1", about: "About the waiting group." });
  await f.service.joinGroup({ actorUserId: "member", groupId: group.id });
  const session = await f.service.scheduleSession({
    actorUserId: "host",
    groupId: group.id,
    title: "Waiting session",
    startsAt: at(5 * 60),
    durationSeconds: 1800,
    maxParticipants: 2
  });
  // The member waits, then closes the tab. With two seats and the Host's seat
  // kept, the member's lapsed seat must not still count once it runs out.
  await f.service.enterSession({ actorUserId: "member", sessionId: session.id, requestedAt: f.clock() });
  assert.equal((await f.service.getSession({ actorUserId: "host", sessionId: session.id })).occupancy, 1);
  f.advanceSeconds(LEASE_S + 1);
  assert.equal((await f.service.getSession({ actorUserId: "host", sessionId: session.id })).occupancy, 0);
  assert.equal((await f.service.getSession({ actorUserId: "host", sessionId: session.id })).state, "starting_soon");
  await f.service.sweepPresence();
  assert.equal(presenceOf(await f.repository.read(), session.id, "member")?.leftAt, at(LEASE_S));
});

test("provider webhooks are recorded but never open or close a seat or end a session", async () => {
  const f = await refreshFixture();
  const { session } = await liveRoom(f, ["host", "member"]);
  const before = await f.repository.read();

  for (const [eventId, eventType, identity] of [["evt-join", "participant_joined", "member"], ["evt-left", "participant_left", "member"], ["evt-host-left", "participant_left", "host"]] as const) {
    f.nextEvent({ eventId, eventType, room: session.id, participantIdentity: identity, participantSid: "PA-1", createdAt: f.clock(), projectId: "eu-primary" });
    assert.deepEqual(
      await f.service.handleLiveKitWebhook({ rawBody: JSON.stringify({ id: eventId }), authHeader: "Signature test" }),
      { status: "ignored" }
    );
    assert.equal(f.receipts.get(eventId)?.status, "ignored");
  }
  const after = await f.repository.read();
  assert.deepEqual(after.presences, before.presences);
  assert.deepEqual(after.sessions, before.sessions);
  assert.equal((await f.service.getSession({ actorUserId: "host", sessionId: session.id })).occupancy, 2);
});
