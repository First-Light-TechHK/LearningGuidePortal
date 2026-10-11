import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { LiveKitGatewayError, type LiveKitRoomGateway, type LiveKitWebhookEvent } from "../../modules/group-study/liveKitGateway";
import { createStudyGroupRepository, StudyGroupStoreUnsupportedError, type StudyGroupRepository, type WebhookReceiptStatus } from "../../modules/group-study/repository";
import { createStudyGroupService, StudyGroupWebhookError, type StudyGroupDeps, type StudyGroupService } from "../../modules/group-study/service";

// Slice-2 service contract (production-persistence-slice2-design.md §3): the
// webhook path verifies, records the receipt first, maps the event through a
// conditional idempotent action, and only then marks the receipt. Receipts are
// a database guarantee, so the fixture wraps the file store with an in-memory
// receipt table the way the PostgreSQL adapter will store them.

const NOW = "2026-09-19T02:00:00.000Z";
const CLOSED_AT = "2026-09-19T02:06:00.000Z";
const tokenLogKey = Buffer.alloc(32, 7);
const createdDirectories: string[] = [];

afterEach(async () => {
  while (createdDirectories.length) await rm(createdDirectories.pop()!, { recursive: true, force: true });
});

type MutableReceipt = { receiptId: string; status: WebhookReceiptStatus; failureClass: string | null };

type WebhookFixture = {
  directory: string;
  service: StudyGroupService;
  repository: StudyGroupRepository;
  receipts: Map<string, MutableReceipt>;
  hooks: { insertError: Error | null; updateError: Error | null };
  calls: {
    updates: number;
    insertAttempts: number;
    marks: Array<{ receiptId: string; result: "processed" | "ignored" | "failed"; failureClass?: string }>;
  };
  access: Set<string>;
};

function stubGateway(verifyWebhook?: (input: { rawBody: string; authHeader: string | null }) => Promise<LiveKitWebhookEvent>): LiveKitRoomGateway {
  const gateway: LiveKitRoomGateway = {
    ensureRoom: async () => undefined,
    issueParticipantToken: async () => ({ token: "stub-token", expiresAt: NOW, url: "wss://livekit.example.test" }),
    publishTutorMessage: async () => undefined,
    removeParticipant: async () => undefined,
    healthCheck: async ({ project }) => ({ projectId: project.id, status: "healthy", evidence: "provider_api", providerVerified: true, checkedAt: NOW, latencyMs: 0 })
  };
  if (verifyWebhook) gateway.verifyWebhook = verifyWebhook;
  return gateway;
}

async function webhookFixture(options: { gateway?: LiveKitRoomGateway } = {}): Promise<WebhookFixture> {
  const directory = await mkdtemp(path.join(tmpdir(), "lg-study-group-webhook-"));
  createdDirectories.push(directory);
  const base = createStudyGroupRepository(directory);
  const receipts = new Map<string, MutableReceipt>();
  const hooks: WebhookFixture["hooks"] = { insertError: null, updateError: null };
  const calls: WebhookFixture["calls"] = { updates: 0, insertAttempts: 0, marks: [] };
  const access = new Set(["host:course-1", "member:course-1"]);
  const repository: StudyGroupRepository = {
    read: () => base.read(),
    appendTokenLog: (line) => base.appendTokenLog(line),
    update: (mutate) => {
      calls.updates += 1;
      if (hooks.updateError) return Promise.reject(hooks.updateError);
      return base.update(mutate);
    },
    claimNextTutorRequest: (input) => base.claimNextTutorRequest(input),
    settleTutorRequest: (input) => base.settleTutorRequest(input),
    claimNextOutboxMessage: (input) => base.claimNextOutboxMessage(input),
    markOutboxDelivered: (input) => base.markOutboxDelivered(input),
    markOutboxFailed: (input) => base.markOutboxFailed(input),
    insertWebhookReceipt: async (input) => {
      calls.insertAttempts += 1;
      if (hooks.insertError) throw hooks.insertError;
      if (receipts.has(input.receiptId)) return false;
      receipts.set(input.receiptId, { receiptId: input.receiptId, status: "received", failureClass: null });
      return true;
    },
    getWebhookReceipt: async (receiptId) => {
      const row = receipts.get(receiptId);
      return row ? { ...row } : null;
    },
    markWebhookProcessed: async (input) => {
      calls.marks.push({
        receiptId: input.receiptId,
        result: input.result,
        ...(input.failureClass === undefined ? {} : { failureClass: input.failureClass })
      });
      const row = receipts.get(input.receiptId);
      if (row) {
        row.status = input.result;
        row.failureClass = input.failureClass ?? null;
      }
    },
    abandonStaleWebhookReceipts: (input) => base.abandonStaleWebhookReceipts(input),
    listLiveSessionsWithOpenPresences: (limit) => base.listLiveSessionsWithOpenPresences(limit),
    studyGroupOperationalMetrics: () => base.studyGroupOperationalMetrics()
  };
  const deps: StudyGroupDeps = {
    repository,
    now: () => new Date(NOW),
    hasCourseAccess: async (userId, courseId) => access.has(`${userId}:${courseId}`),
    courseSummary: async (courseId) => courseId === "course-1" ? { id: courseId, title: "German History", slug: "german-history" } : null,
    accessibleCourses: async () => [],
    userProfile: async (userId) => ({ id: userId, displayName: userId, email: `${userId}@example.test`, locale: "en-GB" }),
    notify: async () => undefined,
    listReminders: async () => [],
    sendMail: async () => undefined,
    liveKit: { apiKey: "lk-key", apiSecret: "lk-secret-at-least-32-characters", url: "wss://livekit.example.test" },
    liveKitGateway: options.gateway ?? stubGateway(async () => { throw new Error("no webhook verify configured"); }),
    tokenLogKey
  };
  return { directory, service: createStudyGroupService(deps), repository, receipts, hooks, calls, access };
}

// A scheduled Live Session with two open presences; `startsAt` sits inside the
// starting-soon window so `enterSession` seats both users without a provider.
async function seededRoom(f: WebhookFixture) {
  const group = await f.service.createGroup({ actorUserId: "host", title: "Webhook group", courseId: "course-1", about: "About the webhook group." });
  await f.service.joinGroup({ actorUserId: "member", groupId: group.id });
  const session = await f.service.scheduleSession({
    actorUserId: "host",
    groupId: group.id,
    title: "Webhook session",
    startsAt: "2026-09-19T02:05:00.000Z",
    durationSeconds: 1800,
    maxParticipants: 4
  });
  await f.service.enterSession({ actorUserId: "host", sessionId: session.id, requestedAt: NOW });
  await f.service.enterSession({ actorUserId: "member", sessionId: session.id, requestedAt: NOW });
  return { group, session };
}

function webhookEvent(room: string | null, overrides: Partial<LiveKitWebhookEvent> = {}): LiveKitWebhookEvent {
  return {
    eventId: "evt-1",
    eventType: "participant_left",
    room,
    participantIdentity: "member",
    createdAt: CLOSED_AT,
    projectId: "eu-primary",
    ...overrides
  };
}

function presenceOf(store: { presences: Array<{ sessionId: string; userId: string; leftAt: string | null }> }, sessionId: string, userId: string) {
  return store.presences.find((row) => row.sessionId === sessionId && row.userId === userId);
}

async function tokenLog(directory: string) {
  try {
    return await readFile(path.join(directory, "token-issuance.log"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

test("participant_left closes the identity's open presence at the event time and marks the receipt processed", async () => {
  let next: LiveKitWebhookEvent | null = null;
  const f = await webhookFixture({ gateway: stubGateway(async () => next!) });
  const { session } = await seededRoom(f);
  f.calls.updates = 0;
  next = webhookEvent(session.id, { eventId: "evt-close" });

  const outcome = await f.service.handleLiveKitWebhook({
    rawBody: JSON.stringify({ id: "evt-close", event: "participant_left" }),
    authHeader: "Bearer signed-token"
  });

  assert.deepEqual(outcome, { status: "processed" });
  const store = await f.repository.read();
  assert.equal(presenceOf(store, session.id, "member")?.leftAt, CLOSED_AT);
  assert.equal(presenceOf(store, session.id, "host")?.leftAt, null);
  assert.equal(f.calls.updates, 1);
  assert.equal(f.calls.insertAttempts, 1);
  assert.deepEqual([...f.receipts.values()], [{ receiptId: "evt-close", status: "processed", failureClass: null }]);
  assert.deepEqual(f.calls.marks, [{ receiptId: "evt-close", result: "processed" }]);
});

test("a participant_left with no open presence is processed without further mutation", async () => {
  let next: LiveKitWebhookEvent | null = null;
  const f = await webhookFixture({ gateway: stubGateway(async () => next!) });
  const { session } = await seededRoom(f);
  next = webhookEvent(session.id, { eventId: "evt-first" });
  await f.service.handleLiveKitWebhook({ rawBody: JSON.stringify({ id: "evt-first" }), authHeader: "Bearer signed-token" });

  next = webhookEvent(session.id, { eventId: "evt-again", createdAt: "2026-09-19T02:07:00.000Z" });
  const outcome = await f.service.handleLiveKitWebhook({ rawBody: JSON.stringify({ id: "evt-again" }), authHeader: "Bearer signed-token" });

  assert.deepEqual(outcome, { status: "processed" });
  const store = await f.repository.read();
  assert.equal(presenceOf(store, session.id, "member")?.leftAt, CLOSED_AT);
  assert.equal(f.receipts.get("evt-again")?.status, "processed");
});

test("participant_left for an unknown room is ignored and marked ignored", async () => {
  let next: LiveKitWebhookEvent | null = null;
  const f = await webhookFixture({ gateway: stubGateway(async () => next!) });
  await seededRoom(f);
  next = webhookEvent("s-unknown", { eventId: "evt-unknown" });

  const outcome = await f.service.handleLiveKitWebhook({ rawBody: JSON.stringify({ id: "evt-unknown" }), authHeader: "Bearer signed-token" });

  assert.deepEqual(outcome, { status: "ignored" });
  assert.equal(f.receipts.get("evt-unknown")?.status, "ignored");
  assert.deepEqual(f.calls.marks, [{ receiptId: "evt-unknown", result: "ignored" }]);
});

test("an unmapped event type never mutates the store and is marked ignored", async () => {
  let next: LiveKitWebhookEvent | null = null;
  const f = await webhookFixture({ gateway: stubGateway(async () => next!) });
  const { session } = await seededRoom(f);
  const before = JSON.stringify(await f.repository.read());
  f.calls.updates = 0;
  next = webhookEvent(session.id, { eventId: "evt-started", eventType: "room_started", participantIdentity: null, createdAt: null });

  const outcome = await f.service.handleLiveKitWebhook({ rawBody: JSON.stringify({ id: "evt-started" }), authHeader: "Bearer signed-token" });

  assert.deepEqual(outcome, { status: "ignored" });
  assert.equal(f.calls.updates, 0);
  assert.equal(JSON.stringify(await f.repository.read()), before);
  assert.equal(f.receipts.get("evt-started")?.status, "ignored");
  assert.deepEqual(f.calls.marks, [{ receiptId: "evt-started", result: "ignored" }]);
});

test("a duplicate of a finished receipt returns duplicate with no side effects", async () => {
  let next: LiveKitWebhookEvent | null = null;
  const f = await webhookFixture({ gateway: stubGateway(async () => next!) });
  const { session } = await seededRoom(f);
  f.receipts.set("evt-processed", { receiptId: "evt-processed", status: "processed", failureClass: null });
  f.receipts.set("evt-failed", { receiptId: "evt-failed", status: "failed", failureClass: "unknown_event" });
  const before = JSON.stringify(await f.repository.read());
  f.calls.updates = 0;

  next = webhookEvent(session.id, { eventId: "evt-processed" });
  assert.deepEqual(
    await f.service.handleLiveKitWebhook({ rawBody: JSON.stringify({ id: "evt-processed" }), authHeader: "Bearer signed-token" }),
    { status: "duplicate" }
  );
  next = webhookEvent(session.id, { eventId: "evt-failed" });
  assert.deepEqual(
    await f.service.handleLiveKitWebhook({ rawBody: JSON.stringify({ id: "evt-failed" }), authHeader: "Bearer signed-token" }),
    { status: "duplicate" }
  );

  assert.equal(f.calls.updates, 0);
  assert.deepEqual(f.calls.marks, []);
  assert.equal(JSON.stringify(await f.repository.read()), before);
  assert.equal(f.receipts.get("evt-processed")?.status, "processed");
  assert.equal(f.receipts.get("evt-failed")?.status, "failed");
  assert.equal(f.receipts.get("evt-failed")?.failureClass, "unknown_event");
});

test("a retry of a received receipt resumes the close exactly once and marks processed", async () => {
  let next: LiveKitWebhookEvent | null = null;
  const f = await webhookFixture({ gateway: stubGateway(async () => next!) });
  const { session } = await seededRoom(f);
  f.receipts.set("evt-resume", { receiptId: "evt-resume", status: "received", failureClass: null });
  f.calls.updates = 0;
  next = webhookEvent(session.id, { eventId: "evt-resume" });

  const outcome = await f.service.handleLiveKitWebhook({ rawBody: JSON.stringify({ id: "evt-resume" }), authHeader: "Bearer signed-token" });

  assert.deepEqual(outcome, { status: "processed" });
  const store = await f.repository.read();
  assert.equal(presenceOf(store, session.id, "member")?.leftAt, CLOSED_AT);
  assert.equal(presenceOf(store, session.id, "host")?.leftAt, null);
  assert.equal(f.calls.updates, 1);
  assert.equal(f.calls.insertAttempts, 1);
  assert.equal(f.receipts.get("evt-resume")?.status, "processed");
  assert.deepEqual(f.calls.marks, [{ receiptId: "evt-resume", result: "processed" }]);
});

test("a retry after an abandoned receipt resumes processing and marks processed", async () => {
  let next: LiveKitWebhookEvent | null = null;
  const f = await webhookFixture({ gateway: stubGateway(async () => next!) });
  const { session } = await seededRoom(f);
  f.receipts.set("evt-abandoned", { receiptId: "evt-abandoned", status: "failed", failureClass: "abandoned" });
  next = webhookEvent(session.id, { eventId: "evt-abandoned" });

  const outcome = await f.service.handleLiveKitWebhook({ rawBody: JSON.stringify({ id: "evt-abandoned" }), authHeader: "Bearer signed-token" });

  assert.deepEqual(outcome, { status: "processed" });
  assert.equal(presenceOf(await f.repository.read(), session.id, "member")?.leftAt, CLOSED_AT);
  assert.equal(f.receipts.get("evt-abandoned")?.status, "processed");
  assert.deepEqual(f.calls.marks, [{ receiptId: "evt-abandoned", result: "processed" }]);
});

test("a gateway without verifyWebhook fails the delivery as webhook_unavailable", async () => {
  const f = await webhookFixture({ gateway: stubGateway() });

  await assert.rejects(
    () => f.service.handleLiveKitWebhook({ rawBody: JSON.stringify({ id: "evt-1" }), authHeader: "Bearer signed-token" }),
    (error: unknown) => error instanceof StudyGroupWebhookError && error.code === "webhook_unavailable" && error.name === "StudyGroupWebhookError"
  );
  assert.equal(f.calls.insertAttempts, 0);
  assert.equal(f.calls.marks.length, 0);
});

test("a failed provider verification maps to the typed error and accepts nothing", async () => {
  let failure: Error = new LiveKitGatewayError("unverified");
  const f = await webhookFixture({ gateway: stubGateway(async () => { throw failure; }) });

  const rejectsWithCode = async (code: "invalid_signature" | "webhook_unavailable") => {
    await assert.rejects(
      () => f.service.handleLiveKitWebhook({ rawBody: JSON.stringify({ id: "evt-1" }), authHeader: null }),
      (error: unknown) => error instanceof StudyGroupWebhookError && error.code === code
    );
  };
  await rejectsWithCode("invalid_signature");
  failure = new LiveKitGatewayError("credential_unavailable");
  await rejectsWithCode("webhook_unavailable");
  failure = new Error("provider exploded");
  await rejectsWithCode("webhook_unavailable");

  assert.equal(f.calls.insertAttempts, 0);
  assert.equal(f.receipts.size, 0);
});

test("a store that cannot record receipts fails the delivery as webhook_unavailable", async () => {
  let next: LiveKitWebhookEvent | null = null;
  const f = await webhookFixture({ gateway: stubGateway(async () => next!) });
  const { session } = await seededRoom(f);
  next = webhookEvent(session.id, { eventId: "evt-file-store" });

  f.hooks.insertError = new StudyGroupStoreUnsupportedError("insertWebhookReceipt");
  await assert.rejects(
    () => f.service.handleLiveKitWebhook({ rawBody: JSON.stringify({ id: "evt-file-store" }), authHeader: "Bearer signed-token" }),
    (error: unknown) => error instanceof StudyGroupWebhookError && error.code === "webhook_unavailable"
  );
  assert.deepEqual(f.calls.marks, []);

  // Only the typed store-refusal class maps to webhook_unavailable; any other
  // store error propagates unchanged (the route maps it to 500).
  f.hooks.insertError = new Error("connection reset");
  await assert.rejects(
    () => f.service.handleLiveKitWebhook({ rawBody: JSON.stringify({ id: "evt-file-store" }), authHeader: "Bearer signed-token" }),
    (error: unknown) => error instanceof Error && !(error instanceof StudyGroupWebhookError) && error.message === "connection reset"
  );
});

test("a processing failure propagates with the receipt left received and never marks", async () => {
  let next: LiveKitWebhookEvent | null = null;
  const f = await webhookFixture({ gateway: stubGateway(async () => next!) });
  const { session } = await seededRoom(f);
  next = webhookEvent(session.id, { eventId: "evt-broken" });
  f.hooks.updateError = new Error("write failed");

  await assert.rejects(
    () => f.service.handleLiveKitWebhook({ rawBody: JSON.stringify({ id: "evt-broken" }), authHeader: "Bearer signed-token" }),
    (error: unknown) => error instanceof Error && error.message === "write failed"
  );

  assert.deepEqual(f.calls.marks, []);
  assert.equal(f.receipts.get("evt-broken")?.status, "received");
  assert.equal(presenceOf(await f.repository.read(), session.id, "member")?.leftAt, null);
});

test("the webhook flow cannot change memberships, roles, sessions, or token state", async () => {
  let next: LiveKitWebhookEvent | null = null;
  const f = await webhookFixture({ gateway: stubGateway(async () => next!) });
  const { group, session } = await seededRoom(f);
  const before = await f.repository.read();
  const tokenLogBefore = await tokenLog(f.directory);
  next = webhookEvent(session.id, { eventId: "evt-grant" });

  const outcome = await f.service.handleLiveKitWebhook({ rawBody: JSON.stringify({ id: "evt-grant" }), authHeader: "Bearer signed-token" });

  assert.deepEqual(outcome, { status: "processed" });
  const after = await f.repository.read();
  assert.deepEqual(after.memberships, before.memberships);
  assert.deepEqual(after.sessions, before.sessions);
  assert.deepEqual(after.meetings, before.meetings);
  assert.deepEqual(after.groups, before.groups);
  assert.equal(after.memberships.find((row) => row.groupId === group.id && row.userId === "member")?.role, "member");
  assert.equal(await tokenLog(f.directory), tokenLogBefore);
});
