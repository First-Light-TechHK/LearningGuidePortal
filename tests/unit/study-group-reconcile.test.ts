import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import type { PresenceRow } from "../../modules/group-study/domain";
import { LiveKitGatewayError, type LiveKitRoomGateway } from "../../modules/group-study/liveKitGateway";
import { parseLiveKitProjects, type LiveKitProjectRef, type LiveKitProjectRegistry } from "../../modules/group-study/liveKitProjectRegistry";
import { createStudyGroupRepository, type StudyGroupRepository } from "../../modules/group-study/repository";
import { createStudyGroupService, type StudyGroupDeps, type StudyGroupService } from "../../modules/group-study/service";

// Slice-2 bounded reconciliation (production-persistence-slice2-design.md §4):
// sweep A abandons stale receipts, sweep B closes open presences the provider
// no longer lists — behind a 120 s grace window so a join in flight is never
// raced. The repository is the real file store with the two PostgreSQL-only
// sweep operations stubbed, mirroring the webhook-service fixture style.

const NOW = "2026-09-19T02:00:00.000Z";
const OLD = "2026-09-19T01:30:00.000Z"; // 30 min before NOW: past the grace window
const YOUNG = "2026-09-19T01:59:00.000Z"; // 60 s before NOW: inside the grace window
const tokenLogKey = Buffer.alloc(32, 7);
const createdDirectories: string[] = [];

afterEach(async () => {
  while (createdDirectories.length) await rm(createdDirectories.pop()!, { recursive: true, force: true });
});

const PROJECTS_JSON = JSON.stringify([
  { id: "eu-primary", url: "wss://eu-primary.livekit.cloud", state: "active", weight: 1, credentialSecretId: "lg/livekit/eu-primary" },
  { id: "eu-secondary", url: "wss://eu-secondary.livekit.cloud", state: "active", weight: 1, credentialSecretId: "lg/livekit/eu-secondary" }
]);

type ParticipantRead = { projectId: string; room: string };

type ReconcileFixture = {
  directory: string;
  service: StudyGroupService;
  repository: StudyGroupRepository;
  state: {
    abandonResult: number;
    abandonError: Error | null;
    sessions: Array<{ id: string; liveKitProjectId: string | null }>;
  };
  calls: {
    updates: number;
    abandon: Array<{ olderThanSeconds: number; limit: number }>;
    listLimits: number[];
    providerReads: ParticipantRead[];
  };
  incidents: Array<{ sessionId: string; projectId: string | null; code: string; source: string }>;
};

function stubGateway(listParticipants?: (input: { project: LiveKitProjectRef; room: string }) => Promise<ReadonlyArray<{ identity: string }>>): LiveKitRoomGateway {
  const gateway: LiveKitRoomGateway = {
    ensureRoom: async () => undefined,
    issueParticipantToken: async () => ({ token: "stub-token", expiresAt: NOW, url: "wss://livekit.example.test" }),
    publishTutorMessage: async () => undefined,
    removeParticipant: async () => undefined,
    healthCheck: async ({ project }) => ({ projectId: project.id, status: "healthy", evidence: "provider_api", providerVerified: true, checkedAt: NOW, latencyMs: 0 })
  };
  if (listParticipants) gateway.listParticipants = listParticipants;
  return gateway;
}

async function reconcileFixture(options: {
  listParticipants?: (input: { project: LiveKitProjectRef; room: string }) => Promise<ReadonlyArray<{ identity: string }>>;
  registry?: LiveKitProjectRegistry;
} = {}): Promise<ReconcileFixture> {
  const directory = await mkdtemp(path.join(tmpdir(), "lg-study-group-reconcile-"));
  createdDirectories.push(directory);
  const base = createStudyGroupRepository(directory);
  const state: ReconcileFixture["state"] = { abandonResult: 0, abandonError: null, sessions: [] };
  const calls: ReconcileFixture["calls"] = { updates: 0, abandon: [], listLimits: [], providerReads: [] };
  const incidents: ReconcileFixture["incidents"] = [];
  const repository: StudyGroupRepository = {
    read: () => base.read(),
    appendTokenLog: (line) => base.appendTokenLog(line),
    update: (mutate) => {
      calls.updates += 1;
      return base.update(mutate);
    },
    claimNextTutorRequest: (input) => base.claimNextTutorRequest(input),
    settleTutorRequest: (input) => base.settleTutorRequest(input),
    claimNextOutboxMessage: (input) => base.claimNextOutboxMessage(input),
    markOutboxDelivered: (input) => base.markOutboxDelivered(input),
    markOutboxFailed: (input) => base.markOutboxFailed(input),
    insertWebhookReceipt: (input) => base.insertWebhookReceipt(input),
    getWebhookReceipt: (receiptId) => base.getWebhookReceipt(receiptId),
    markWebhookProcessed: (input) => base.markWebhookProcessed(input),
    abandonStaleWebhookReceipts: async (input) => {
      calls.abandon.push(input);
      if (state.abandonError) throw state.abandonError;
      return state.abandonResult;
    },
    listLiveSessionsWithOpenPresences: async (limit) => {
      calls.listLimits.push(limit);
      return [...state.sessions];
    },
    studyGroupOperationalMetrics: () => base.studyGroupOperationalMetrics()
  };
  const listed = options.listParticipants;
  const gateway = stubGateway(listed ? async (input) => {
    calls.providerReads.push({ projectId: input.project.id, room: input.room });
    return listed(input);
  } : undefined);
  const deps: StudyGroupDeps = {
    repository,
    now: () => new Date(NOW),
    hasCourseAccess: async () => true,
    courseSummary: async (courseId) => ({ id: courseId, title: "German History", slug: "german-history" }),
    accessibleCourses: async () => [],
    userProfile: async (userId) => ({ id: userId, displayName: userId, email: `${userId}@example.test`, locale: "en-GB" }),
    notify: async () => undefined,
    listReminders: async () => [],
    sendMail: async () => undefined,
    liveKit: { apiKey: "lk-key", apiSecret: "lk-secret-at-least-32-characters", url: "wss://livekit.example.test" },
    liveKitGateway: gateway,
    liveKitProjects: options.registry ?? parseLiveKitProjects(PROJECTS_JSON),
    liveKitIncidentReporter: (incident) => { incidents.push({ ...incident }); },
    tokenLogKey
  };
  return { directory, service: createStudyGroupService(deps), repository, state, calls, incidents };
}

function presence(overrides: Partial<PresenceRow> & { sessionId: string; userId: string }): PresenceRow {
  return {
    id: `presence-${overrides.sessionId}-${overrides.userId}`,
    requestedAt: `${OLD}#00000001`,
    enteredAt: null,
    leftAt: null,
    phase: "live",
    ...overrides
  };
}

// Seeds two live sessions (s-1 on eu-primary, s-2 on eu-secondary) plus the
// given presence rows directly into the file store, then resets the update
// counter so the assertions observe reconciliation traffic only.
async function seedStore(f: ReconcileFixture, presences: PresenceRow[]) {
  await f.repository.update((store) => {
    store.groups.push({ id: "g-1", title: "Reconcile group", courseId: "course-1", about: "About the reconcile group.", hostUserId: "u-1", status: "active", createdAt: NOW, updatedAt: NOW });
    for (const [id, project] of [["s-1", "eu-primary"], ["s-2", "eu-secondary"]] as const) {
      store.sessions.push({
        id,
        groupId: "g-1",
        title: `Reconcile session ${id}`,
        relatedLessonId: null,
        startsAt: NOW,
        durationSeconds: 1800,
        maxParticipants: 6,
        focus: null,
        aiTutorEnabled: true,
        liveKitProjectId: project,
        status: "live",
        startedAt: NOW,
        completedAt: null,
        createdAt: NOW,
        updatedAt: NOW
      });
    }
    store.meetings.push({ id: "m-1", sessionId: "s-1", startedAt: NOW, endedAt: null });
    store.presences.push(...presences);
  });
  f.calls.updates = 0;
}

test("sweep B closes only provider-absent presences past the grace window", async () => {
  const f = await reconcileFixture({ listParticipants: async () => [{ identity: "u-1" }] });
  f.state.abandonResult = 4;
  f.state.sessions = [{ id: "s-1", liveKitProjectId: "eu-primary" }];
  await seedStore(f, [
    presence({ sessionId: "s-1", userId: "u-1", enteredAt: OLD, phase: "live" }), // present at the provider: kept
    presence({ sessionId: "s-1", userId: "u-2", enteredAt: OLD, phase: "live" }), // absent + old: closed
    presence({ sessionId: "s-1", userId: "u-3", enteredAt: YOUNG, phase: "live" }), // absent but inside the grace window: kept
    presence({ sessionId: "s-1", userId: "u-3b", requestedAt: `${OLD}#00000001`, phase: "waiting" }), // waiting, absent, old: closed
    presence({ sessionId: "s-1", userId: "u-4", requestedAt: `${YOUNG}#00000001`, phase: "waiting" }), // waiting, absent, young: kept
    presence({ sessionId: "s-2", userId: "u-5", enteredAt: OLD, phase: "live" }), // unlisted session: never touched
    presence({ sessionId: "s-1", userId: "u-6", enteredAt: OLD, leftAt: "2026-09-19T01:45:00.000Z", phase: "live" }) // already closed: never touched
  ]);
  const before = await f.repository.read();

  const result = await f.service.reconcileLiveKitState();

  assert.deepEqual(result, { abandonedReceipts: 4, sessionsChecked: 1, presencesClosed: 2 });
  assert.deepEqual(f.calls.abandon, [{ olderThanSeconds: 300, limit: 50 }]);
  assert.deepEqual(f.calls.listLimits, [5]);
  assert.deepEqual(f.calls.providerReads, [{ projectId: "eu-primary", room: "s-1" }]);
  assert.equal(f.calls.updates, 1);
  const after = await f.repository.read();
  const expected = before.presences.map((row) =>
    row.userId === "u-2" || row.userId === "u-3b" ? { ...row, leftAt: NOW } : { ...row });
  assert.deepEqual(after.presences, expected);
  // Only presence rows of the listed session may change at all.
  assert.deepEqual(after.groups, before.groups);
  assert.deepEqual(after.sessions, before.sessions);
  assert.deepEqual(after.meetings, before.meetings);
  assert.deepEqual(after.memberships, before.memberships);
  assert.deepEqual(after.tutorRequests, before.tutorRequests);
  assert.deepEqual(f.incidents, []);
});

test("a provider failure on one session reports a redacted incident and the next session still reconciles", async () => {
  const f = await reconcileFixture({
    listParticipants: async ({ room }) => {
      if (room === "s-1") throw new LiveKitGatewayError("rate_limited");
      return [{ identity: "u-9" }];
    }
  });
  f.state.abandonResult = 1;
  f.state.sessions = [
    { id: "s-1", liveKitProjectId: "eu-primary" },
    { id: "s-2", liveKitProjectId: "eu-secondary" }
  ];
  await seedStore(f, [
    presence({ sessionId: "s-1", userId: "u-7", enteredAt: OLD, phase: "live" }),
    presence({ sessionId: "s-2", userId: "u-8", enteredAt: OLD, phase: "live" }),
    presence({ sessionId: "s-2", userId: "u-9", enteredAt: OLD, phase: "live" })
  ]);

  const result = await f.service.reconcileLiveKitState();

  assert.deepEqual(result, { abandonedReceipts: 1, sessionsChecked: 2, presencesClosed: 1 });
  assert.deepEqual(f.calls.listLimits, [5]);
  assert.deepEqual(f.calls.providerReads, [
    { projectId: "eu-primary", room: "s-1" },
    { projectId: "eu-secondary", room: "s-2" }
  ]);
  const after = await f.repository.read();
  assert.equal(after.presences.find((row) => row.userId === "u-7")?.leftAt, null); // failed read: untouched
  assert.equal(after.presences.find((row) => row.userId === "u-8")?.leftAt, NOW); // second session repaired
  assert.equal(after.presences.find((row) => row.userId === "u-9")?.leftAt, null); // still present at the provider
  assert.equal(f.calls.updates, 1);
  // The incident line is exactly the typed, redacted shape: no identities, no
  // tokens, no provider payload.
  assert.deepEqual(f.incidents, [{ sessionId: "s-1", projectId: "eu-primary", code: "provider_rate_limited", source: "gateway" }]);
  const raw = JSON.stringify(f.incidents);
  assert.equal(["u-7", "u-8", "u-9"].some((identity) => raw.includes(identity)), false);
  assert.equal(raw.toLowerCase().includes("token"), false);
});

test("a gateway without listParticipants skips sweep B with zero checks, closes, and provider calls", async () => {
  const f = await reconcileFixture();
  f.state.abandonResult = 5;
  f.state.sessions = [{ id: "s-1", liveKitProjectId: "eu-primary" }];
  await seedStore(f, [presence({ sessionId: "s-1", userId: "u-2", enteredAt: OLD, phase: "live" })]);
  const before = await f.repository.read();

  const result = await f.service.reconcileLiveKitState();

  assert.deepEqual(result, { abandonedReceipts: 5, sessionsChecked: 0, presencesClosed: 0 });
  assert.deepEqual(f.calls.abandon, [{ olderThanSeconds: 300, limit: 50 }]);
  assert.deepEqual(f.calls.listLimits, []);
  assert.deepEqual(f.calls.providerReads, []);
  assert.equal(f.calls.updates, 0);
  assert.deepEqual((await f.repository.read()).presences, before.presences);
  assert.deepEqual(f.incidents, []);
});

test("a session whose project cannot be resolved is skipped with a redacted incident and no check counted", async () => {
  const f = await reconcileFixture({ listParticipants: async () => [{ identity: "u-2" }] });
  f.state.abandonResult = 2;
  f.state.sessions = [
    { id: "s-1", liveKitProjectId: "eu-gone" }, // dangling assignment: getAssigned throws
    { id: "s-2", liveKitProjectId: null }
  ];
  await seedStore(f, [presence({ sessionId: "s-1", userId: "u-2", enteredAt: OLD, phase: "live" })]);
  const before = await f.repository.read();

  const result = await f.service.reconcileLiveKitState();

  assert.deepEqual(result, { abandonedReceipts: 2, sessionsChecked: 0, presencesClosed: 0 });
  assert.deepEqual(f.calls.providerReads, []);
  assert.equal(f.calls.updates, 0);
  assert.deepEqual(f.incidents, [
    { sessionId: "s-1", projectId: "eu-gone", code: "provider_credentials_invalid", source: "gateway" },
    { sessionId: "s-2", projectId: null, code: "provider_credentials_invalid", source: "gateway" }
  ]);
  assert.deepEqual((await f.repository.read()).presences, before.presences);
});

test("a sweep A failure propagates and sweep B never runs", async () => {
  const f = await reconcileFixture({ listParticipants: async () => [] });
  f.state.abandonError = new Error("receipt sweep failed");
  f.state.sessions = [{ id: "s-1", liveKitProjectId: "eu-primary" }];

  await assert.rejects(
    () => f.service.reconcileLiveKitState(),
    (error: unknown) => error instanceof Error && error.message === "receipt sweep failed"
  );
  assert.deepEqual(f.calls.listLimits, []);
  assert.deepEqual(f.calls.providerReads, []);
  assert.equal(f.calls.updates, 0);
});
