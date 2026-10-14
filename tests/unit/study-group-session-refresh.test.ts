import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import type { PresenceRow, StudyGroupStore } from "../../modules/group-study/domain";
import type { LiveKitRoomGateway, LiveKitWebhookEvent } from "../../modules/group-study/liveKitGateway";
import { parseLiveKitProjects } from "../../modules/group-study/liveKitProjectRegistry";
import { createStudyGroupRepository, type StudyGroupRepository, type WebhookReceiptStatus } from "../../modules/group-study/repository";
import { createStudyGroupService, type StudyGroupDeps, type StudyGroupService } from "../../modules/group-study/service";

// BUG-0108 regression (SIT): refreshing the browser during a Live Session
// used to send the same explicit Leave Session request as the Leave button, so
// the reloading user — being the room's last open presence — completed the
// session before the reload could re-enter it ("已经结束"). The refresh now
// sends an unload-class leave instead: it releases the seat only while others
// remain in the room; the last open seat is held and its age renewed so the
// 120 s grace window plus the provider-verified reconcile (or the signed
// participant_left webhook) own the completion — a live session with nobody in
// it may never hang. An explicit Leave Session keeps its immediate "the final
// participant completes it" contract (PRD BR-026 / BR-027), and a stale
// participant_left that reports on a pre-refresh connection must not close a
// seat a re-entry has re-established.

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

test("a refresh (unload leave) keeps the session live and the user re-enters to continue", async () => {
  const f = await refreshFixture();
  const { session } = await liveRoom(f);

  // pagehide fires: the room disconnects and the unload signal reaches the
  // server. The single user holds the last open seat, so it must be kept —
  // age renewed, nobody completed — for the reload to come back to.
  await f.service.leaveSession({ actorUserId: "host", sessionId: session.id, reason: "unload" });

  const held = await f.service.getSession({ actorUserId: "host", sessionId: session.id });
  assert.equal(held.state, "live");
  assert.equal(held.occupancy, 1);
  const store = await f.repository.read();
  assert.equal(presenceOf(store, session.id, "host")?.leftAt, null);
  assert.equal(presenceOf(store, session.id, "host")?.enteredAt, f.clock());
  assert.equal(store.meetings.find((row) => row.sessionId === session.id)?.endedAt, null);

  // The reload finishes about two seconds later: the same user enters again,
  // the re-entry renews the seat's age, and the session is still live.
  f.advanceSeconds(2);
  const again = await f.service.enterSession({ actorUserId: "host", sessionId: session.id, requestedAt: f.clock() });
  assert.equal(again.occupancy, 1);
  assert.equal(presenceOf(await f.repository.read(), session.id, "host")?.enteredAt, f.clock());
  assert.equal((await f.service.getSession({ actorUserId: "host", sessionId: session.id })).state, "live");

  // An explicit Leave Session still ends the session when nobody remains.
  await f.service.leaveSession({ actorUserId: "host", sessionId: session.id });
  assert.equal((await f.service.getSession({ actorUserId: "host", sessionId: session.id })).state, "completed");
});

test("an unload leave with others in the room releases only that seat and never ends the session", async () => {
  const f = await refreshFixture();
  const { session } = await liveRoom(f, ["host", "member"]);

  await f.service.leaveSession({ actorUserId: "member", sessionId: session.id, reason: "unload" });

  const view = await f.service.getSession({ actorUserId: "host", sessionId: session.id });
  assert.equal(view.state, "live");
  assert.equal(view.occupancy, 1);
  const store = await f.repository.read();
  assert.equal(presenceOf(store, session.id, "member")?.leftAt, f.clock());
  assert.equal(presenceOf(store, session.id, "host")?.leftAt, null);

  // The member's reload re-enters and both continue in the same session.
  f.advanceSeconds(2);
  await f.service.enterSession({ actorUserId: "member", sessionId: session.id, requestedAt: f.clock() });
  assert.equal((await f.service.getSession({ actorUserId: "host", sessionId: session.id })).occupancy, 2);

  // The explicit Leave contract is untouched: the leave that empties the room completes it.
  await f.service.leaveSession({ actorUserId: "member", sessionId: session.id });
  await f.service.leaveSession({ actorUserId: "host", sessionId: session.id });
  assert.equal((await f.service.getSession({ actorUserId: "host", sessionId: session.id })).state, "completed");
});

test("a room emptied by an unload with nobody returning completes through the provider-verified sweep inside the grace", async () => {
  const f = await refreshFixture();
  const { session } = await liveRoom(f);

  await f.service.leaveSession({ actorUserId: "host", sessionId: session.id, reason: "unload" });
  // Nobody comes back: the provider no longer lists the identity.
  f.participants.length = 0;

  // Inside the 120 s grace window the repair path must not race the reload.
  f.advanceSeconds(60);
  const young = await f.service.reconcileLiveKitState();
  assert.deepEqual(young, { abandonedReceipts: 0, sessionsChecked: 1, presencesClosed: 0 });
  assert.equal((await f.service.getSession({ actorUserId: "host", sessionId: session.id })).state, "live");

  // Past the grace window the sweep closes the last seat and completes the
  // session — a live session may never hang with nobody in it.
  f.advanceSeconds(70);
  const sweep = await f.service.reconcileLiveKitState();
  assert.deepEqual(sweep, { abandonedReceipts: 0, sessionsChecked: 1, presencesClosed: 1 });
  assert.equal((await f.service.getSession({ actorUserId: "host", sessionId: session.id })).state, "completed");
  const store = await f.repository.read();
  assert.equal(presenceOf(store, session.id, "host")?.leftAt, f.clock());
  assert.equal(store.meetings.find((row) => row.sessionId === session.id)?.endedAt, f.clock());
});

test("the signed participant_left webhook still closes a gone seat and, when last, completes at the event time", async () => {
  const f = await refreshFixture();
  const { session } = await liveRoom(f, ["host", "member"]);
  const memberLeftAt = new Date(Date.parse(START) + 30_000).toISOString();
  const hostLeftAt = new Date(Date.parse(START) + 90_000).toISOString();

  // A crash (no unload signal) at 30 s: the member's event postdates the seat.
  f.nextEvent({ eventId: "evt-member", eventType: "participant_left", room: session.id, participantIdentity: "member", createdAt: memberLeftAt, projectId: "eu-primary" });
  assert.deepEqual(
    await f.service.handleLiveKitWebhook({ rawBody: JSON.stringify({ id: "evt-member" }), authHeader: "Signature test" }),
    { status: "processed" }
  );
  assert.equal(presenceOf(await f.repository.read(), session.id, "member")?.leftAt, memberLeftAt);
  assert.equal((await f.service.getSession({ actorUserId: "host", sessionId: session.id })).state, "live");

  // The Host's own departure closes the last seat: completed at the event time.
  f.nextEvent({ eventId: "evt-host", eventType: "participant_left", room: session.id, participantIdentity: "host", createdAt: hostLeftAt, projectId: "eu-primary" });
  assert.deepEqual(
    await f.service.handleLiveKitWebhook({ rawBody: JSON.stringify({ id: "evt-host" }), authHeader: "Signature test" }),
    { status: "processed" }
  );
  const store = await f.repository.read();
  assert.equal(presenceOf(store, session.id, "host")?.leftAt, hostLeftAt);
  assert.equal((await f.service.getSession({ actorUserId: "host", sessionId: session.id })).state, "completed");
  assert.equal(store.meetings.find((row) => row.sessionId === session.id)?.endedAt, hostLeftAt);
});

test("a participant_left delivered after a refresh re-entered must not close the re-established seat", async () => {
  const f = await refreshFixture();
  const { session } = await liveRoom(f);

  // pagehide: the unload signal lands; the reload re-enters two seconds later.
  await f.service.leaveSession({ actorUserId: "host", sessionId: session.id, reason: "unload" });
  const unloadedAt = f.clock();
  f.advanceSeconds(2);
  await f.service.enterSession({ actorUserId: "host", sessionId: session.id, requestedAt: f.clock() });

  // The provider's participant_left for the OLD connection arrives late — it
  // postdates the unload but predates the re-entry, so its evidence is about
  // a seat generation that no longer exists: the fresh seat stays open.
  const staleCreatedAt = new Date(Date.parse(unloadedAt) + 1000).toISOString();
  f.nextEvent({ eventId: "evt-stale", eventType: "participant_left", room: session.id, participantIdentity: "host", createdAt: staleCreatedAt, projectId: "eu-primary" });
  assert.deepEqual(
    await f.service.handleLiveKitWebhook({ rawBody: JSON.stringify({ id: "evt-stale" }), authHeader: "Signature test" }),
    { status: "processed" }
  );
  assert.equal(presenceOf(await f.repository.read(), session.id, "host")?.leftAt, null);
  assert.equal((await f.service.getSession({ actorUserId: "host", sessionId: session.id })).state, "live");

  // An event that genuinely postdates the re-entry still closes the seat and,
  // with nobody left, completes the session — the reducing rule stays intact.
  f.advanceSeconds(10);
  const trulyLeftAt = f.clock();
  f.nextEvent({ eventId: "evt-real", eventType: "participant_left", room: session.id, participantIdentity: "host", createdAt: trulyLeftAt, projectId: "eu-primary" });
  assert.deepEqual(
    await f.service.handleLiveKitWebhook({ rawBody: JSON.stringify({ id: "evt-real" }), authHeader: "Signature test" }),
    { status: "processed" }
  );
  const store = await f.repository.read();
  assert.equal(presenceOf(store, session.id, "host")?.leftAt, trulyLeftAt);
  assert.equal((await f.service.getSession({ actorUserId: "host", sessionId: session.id })).state, "completed");
});
