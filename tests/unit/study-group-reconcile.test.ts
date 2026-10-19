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

// Bounded reconciliation: sweep A abandons stale receipts (slice-2 design §4),
// then the seat-lease sweep (QA 2026-10-19 redesign, presence.ts) closes the
// seats whose lease ran out and ends live sessions that have had no seat for
// the grace period. The provider's participant list is never consulted: the
// lease is the single source of truth for seats. The repository is the real
// file store with the PostgreSQL-only sweep operations stubbed, mirroring the
// webhook-service fixture style.

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
    listSessionsWithPendingTutorWork: (input) => base.listSessionsWithPendingTutorWork(input),
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
    tokenLogKey: () => tokenLogKey,
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
        startedAt: OLD,
        completedAt: null,
        createdAt: NOW,
        updatedAt: NOW
      });
    }
    store.meetings.push({ id: "m-1", sessionId: "s-1", startedAt: OLD, endedAt: null });
    store.presences.push(...presences);
  });
  f.calls.updates = 0;
}

const at = (ms: number) => new Date(Date.parse(NOW) + ms).toISOString();

test("the sweep closes lapsed seats at the moment their lease ran out and never asks the provider", async () => {
  const f = await reconcileFixture({ listParticipants: async () => [] });
  f.state.abandonResult = 4;
  await seedStore(f, [
    presence({ sessionId: "s-1", userId: "u-1", enteredAt: OLD, lastSeenAt: at(-5_000) }), // renewed 5 s ago: kept
    presence({ sessionId: "s-1", userId: "u-2", enteredAt: OLD, lastSeenAt: at(-45_000) }), // lapsed 15 s ago: closed then
    presence({ sessionId: "s-1", userId: "u-3", enteredAt: at(-40_000) }), // legacy row, no renewal: lapses 30 s after entry
    presence({ sessionId: "s-1", userId: "u-4", requestedAt: `${YOUNG}#00000001`, phase: "waiting" }), // never entered: untouched
    presence({ sessionId: "s-1", userId: "u-5", enteredAt: OLD, leftAt: "2026-09-19T01:45:00.000Z" }) // already closed: untouched
  ]);
  const before = await f.repository.read();

  const result = await f.service.reconcileLiveKitState();

  assert.deepEqual(result, { abandonedReceipts: 4, sessionsChecked: 1, presencesClosed: 2 });
  assert.deepEqual(f.calls.abandon, [{ olderThanSeconds: 300, limit: 50 }]);
  assert.deepEqual(f.calls.listLimits, []);
  assert.deepEqual(f.calls.providerReads, []);
  assert.equal(f.calls.updates, 1);
  const after = await f.repository.read();
  const closedAt: Record<string, string> = { "u-2": at(-15_000), "u-3": at(-10_000) };
  assert.deepEqual(after.presences, before.presences.map((row) => closedAt[row.userId] ? { ...row, leftAt: closedAt[row.userId] } : { ...row }));
  // s-1 still has a held seat; s-2 has had none since it started at OLD, so
  // it ends dated to its start.
  assert.equal(after.sessions.find((row) => row.id === "s-1")?.status, "live");
  assert.equal(after.sessions.find((row) => row.id === "s-2")?.completedAt, OLD);
  assert.deepEqual(after.groups, before.groups);
  assert.deepEqual(after.memberships, before.memberships);
  assert.deepEqual(after.tutorRequests, before.tutorRequests);
  assert.deepEqual(f.incidents, []);
});

test("a live session empty past the grace ends dated to when it emptied; inside the grace it stays live", async () => {
  const f = await reconcileFixture();
  await seedStore(f, [
    presence({ sessionId: "s-1", userId: "u-1", enteredAt: OLD, lastSeenAt: at(-100_000) }), // lapsed 70 s ago
    presence({ sessionId: "s-2", userId: "u-2", enteredAt: OLD, lastSeenAt: at(-50_000) }) // lapsed 20 s ago: a reload can still return
  ]);

  const result = await f.service.reconcileLiveKitState();

  assert.deepEqual(result, { abandonedReceipts: 0, sessionsChecked: 1, presencesClosed: 2 });
  const after = await f.repository.read();
  const ended = after.sessions.find((row) => row.id === "s-1");
  assert.equal(ended?.status, "completed");
  assert.equal(ended?.completedAt, at(-70_000));
  assert.equal(after.meetings.find((row) => row.id === "m-1")?.endedAt, at(-70_000));
  assert.equal(after.sessions.find((row) => row.id === "s-2")?.status, "live");
});

test("an idle sweep with every seat renewed performs no write", async () => {
  const f = await reconcileFixture();
  await seedStore(f, [
    presence({ sessionId: "s-1", userId: "u-1", enteredAt: OLD, lastSeenAt: at(-1_000) }),
    presence({ sessionId: "s-2", userId: "u-2", enteredAt: OLD, lastSeenAt: at(-1_000) })
  ]);
  const before = await f.repository.read();

  assert.deepEqual(await f.service.reconcileLiveKitState(), { abandonedReceipts: 0, sessionsChecked: 0, presencesClosed: 0 });
  assert.equal(f.calls.updates, 0);
  assert.deepEqual(await f.repository.read(), before);
});

test("a sweep A failure propagates and no seat is touched", async () => {
  const f = await reconcileFixture({ listParticipants: async () => [] });
  f.state.abandonError = new Error("receipt sweep failed");
  await seedStore(f, [presence({ sessionId: "s-1", userId: "u-1", enteredAt: OLD })]);

  await assert.rejects(
    () => f.service.reconcileLiveKitState(),
    (error: unknown) => error instanceof Error && error.message === "receipt sweep failed"
  );
  assert.deepEqual(f.calls.providerReads, []);
  assert.equal(f.calls.updates, 0);
});
