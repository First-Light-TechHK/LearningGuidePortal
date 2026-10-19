import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { LiveKitGatewayError, type LiveKitRoomGateway, type LiveKitWebhookEvent } from "../../modules/group-study/liveKitGateway";
import { createStudyGroupRepository, StudyGroupStoreUnsupportedError, type StudyGroupRepository, type WebhookReceiptStatus } from "../../modules/group-study/repository";
import { createStudyGroupService, StudyGroupWebhookError, webhookRejectionLogLine, type StudyGroupDeps, type StudyGroupService } from "../../modules/group-study/service";

// Slice-2 service contract (production-persistence-slice2-design.md §3): the
// webhook path verifies, records the receipt first, and only then marks the
// receipt. Since the QA 2026-10-19 seat redesign no provider event acts on the
// store: seats are the server's own lease (presence.ts), so every verified
// event is recorded and marked ignored. Receipts are a database guarantee, so
// the fixture wraps the file store with an in-memory receipt table the way the
// PostgreSQL adapter stores them.

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
    listSessionsWithPendingTutorWork: (input) => base.listSessionsWithPendingTutorWork(input),
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
    tokenLogKey: () => tokenLogKey,
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

test("participant_left is recorded and marked ignored without touching any seat", async () => {
  let next: LiveKitWebhookEvent | null = null;
  const f = await webhookFixture({ gateway: stubGateway(async () => next!) });
  const { session } = await seededRoom(f);
  const before = JSON.stringify(await f.repository.read());
  f.calls.updates = 0;
  next = webhookEvent(session.id, { eventId: "evt-close" });

  const outcome = await f.service.handleLiveKitWebhook({
    rawBody: JSON.stringify({ id: "evt-close", event: "participant_left" }),
    authHeader: "Bearer signed-token"
  });

  assert.deepEqual(outcome, { status: "ignored" });
  assert.equal(JSON.stringify(await f.repository.read()), before);
  assert.equal(f.calls.updates, 0);
  assert.equal(f.calls.insertAttempts, 1);
  assert.deepEqual([...f.receipts.values()], [{ receiptId: "evt-close", status: "ignored", failureClass: null }]);
  assert.deepEqual(f.calls.marks, [{ receiptId: "evt-close", result: "ignored" }]);
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

test("a retry of a received or abandoned receipt resumes and marks it once", async () => {
  let next: LiveKitWebhookEvent | null = null;
  const f = await webhookFixture({ gateway: stubGateway(async () => next!) });
  const { session } = await seededRoom(f);
  f.receipts.set("evt-resume", { receiptId: "evt-resume", status: "received", failureClass: null });
  f.receipts.set("evt-abandoned", { receiptId: "evt-abandoned", status: "failed", failureClass: "abandoned" });
  f.calls.updates = 0;

  for (const eventId of ["evt-resume", "evt-abandoned"]) {
    next = webhookEvent(session.id, { eventId });
    assert.deepEqual(await f.service.handleLiveKitWebhook({ rawBody: JSON.stringify({ id: eventId }), authHeader: "Bearer signed-token" }), { status: "ignored" });
    assert.equal(f.receipts.get(eventId)?.status, "ignored");
  }
  assert.equal(presenceOf(await f.repository.read(), session.id, "member")?.leftAt, null);
  assert.equal(f.calls.updates, 0);
  assert.deepEqual(f.calls.marks, [{ receiptId: "evt-resume", result: "ignored" }, { receiptId: "evt-abandoned", result: "ignored" }]);
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

test("a store that cannot be written still settles the receipt: the webhook never writes seats or sessions", async () => {
  let next: LiveKitWebhookEvent | null = null;
  const f = await webhookFixture({ gateway: stubGateway(async () => next!) });
  const { session } = await seededRoom(f);
  next = webhookEvent(session.id, { eventId: "evt-broken" });
  f.hooks.updateError = new Error("write failed");

  assert.deepEqual(
    await f.service.handleLiveKitWebhook({ rawBody: JSON.stringify({ id: "evt-broken" }), authHeader: "Bearer signed-token" }),
    { status: "ignored" }
  );
  assert.deepEqual(f.calls.marks, [{ receiptId: "evt-broken", result: "ignored" }]);
  assert.equal(presenceOf(await f.repository.read(), session.id, "member")?.leftAt, null);
});

test("the webhook flow cannot change memberships, roles, seats, sessions, or token state", async () => {
  let next: LiveKitWebhookEvent | null = null;
  const f = await webhookFixture({ gateway: stubGateway(async () => next!) });
  const { session } = await seededRoom(f);
  await f.service.startSession({ actorUserId: "host", sessionId: session.id });
  const before = await f.repository.read();
  const tokenLogBefore = await tokenLog(f.directory);

  // Both departures, the Host's last: the live session is not ended by the
  // provider's word. It ends when its seats lapse (presence.ts) or on Leave.
  for (const [eventId, identity] of [["evt-member-left", "member"], ["evt-host-left", "host"]] as const) {
    next = webhookEvent(session.id, { eventId, participantIdentity: identity });
    assert.deepEqual(
      await f.service.handleLiveKitWebhook({ rawBody: JSON.stringify({ id: eventId }), authHeader: "Bearer signed-token" }),
      { status: "ignored" }
    );
  }
  const after = await f.repository.read();
  assert.deepEqual(after, before);
  assert.equal(after.sessions.find((row) => row.id === session.id)?.status, "live");
  assert.equal(await tokenLog(f.directory), tokenLogBefore);
});

// Signature-rejection observability (flood-safe): the service counts only
// invalid/missing signatures in-process (per-instance), and the runtime's
// 5-minute metrics timer drains the counter into ONE redacted line per
// non-empty cadence — never one line per rejection.

test("each unverified signature increments the per-instance counter, and consuming resets it", async () => {
  const f = await webhookFixture({ gateway: stubGateway(async () => { throw new LiveKitGatewayError("unverified"); }) });

  await assert.rejects(
    () => f.service.handleLiveKitWebhook({ rawBody: JSON.stringify({ id: "evt-bad-1" }), authHeader: null }),
    (error: unknown) => error instanceof StudyGroupWebhookError && error.code === "invalid_signature"
  );
  await assert.rejects(
    () => f.service.handleLiveKitWebhook({ rawBody: JSON.stringify({ id: "evt-bad-2" }), authHeader: "Bearer wrong" }),
    (error: unknown) => error instanceof StudyGroupWebhookError && error.code === "invalid_signature"
  );

  assert.equal(f.service.consumeWebhookRejectionCount?.(), 2);
  // Consuming resets: a second read sees only rejections recorded since.
  assert.equal(f.service.consumeWebhookRejectionCount?.(), 0);
});

test("the drain fires exactly one redacted line only when the count is above zero, and resets", async () => {
  const signatureSentinel = "super-secret-signature-value";
  const f = await webhookFixture({ gateway: stubGateway(async () => { throw new LiveKitGatewayError("unverified"); }) });

  // A silent cadence: nothing rejected means no line at all.
  assert.equal(webhookRejectionLogLine(f.service), null);

  for (const id of ["evt-a", "evt-b"]) {
    await assert.rejects(
      () => f.service.handleLiveKitWebhook({
        rawBody: JSON.stringify({ id, echo: signatureSentinel }),
        authHeader: `Bearer ${signatureSentinel}`
      }),
      (error: unknown) => error instanceof StudyGroupWebhookError && error.code === "invalid_signature"
    );
  }

  const line = webhookRejectionLogLine(f.service);
  assert.equal(line, '{"type":"study_group.webhook_rejected","reason":"invalid_signature","count":2}');
  // Redacted: the line echoes neither the header nor the raw body.
  assert.equal(line?.includes(signatureSentinel), false);
  // Emit-and-reset: the drained line leaves nothing behind for the next tick.
  assert.equal(webhookRejectionLogLine(f.service), null);
  assert.equal(f.service.consumeWebhookRejectionCount?.(), 0);
});

test("the drain treats a stand-in service without the counter as zero", () => {
  assert.equal(webhookRejectionLogLine({}), null);
  assert.equal(webhookRejectionLogLine({ consumeWebhookRejectionCount: () => 0 }), null);
  assert.equal(
    webhookRejectionLogLine({ consumeWebhookRejectionCount: () => 5 }),
    '{"type":"study_group.webhook_rejected","reason":"invalid_signature","count":5}'
  );
});

test("webhook_unavailable failures and malformed bodies never count as signature rejections", async () => {
  // Provider failure other than unverified.
  const provider = await webhookFixture({ gateway: stubGateway(async () => { throw new LiveKitGatewayError("credential_unavailable"); }) });
  await assert.rejects(
    () => provider.service.handleLiveKitWebhook({ rawBody: JSON.stringify({ id: "evt-1" }), authHeader: "Bearer signed-token" }),
    (error: unknown) => error instanceof StudyGroupWebhookError && error.code === "webhook_unavailable"
  );
  // Unexpected provider error.
  const exploded = await webhookFixture({ gateway: stubGateway(async () => { throw new Error("provider exploded"); }) });
  await assert.rejects(
    () => exploded.service.handleLiveKitWebhook({ rawBody: JSON.stringify({ id: "evt-1" }), authHeader: "Bearer signed-token" }),
    (error: unknown) => error instanceof StudyGroupWebhookError && error.code === "webhook_unavailable"
  );
  // Gateway without webhook verification at all.
  const unconfigured = await webhookFixture({ gateway: stubGateway() });
  await assert.rejects(
    () => unconfigured.service.handleLiveKitWebhook({ rawBody: JSON.stringify({ id: "evt-1" }), authHeader: "Bearer signed-token" }),
    (error: unknown) => error instanceof StudyGroupWebhookError && error.code === "webhook_unavailable"
  );
  // Store that refuses the receipt (typed), reached only after a VERIFIED signature.
  const store = await webhookFixture({ gateway: stubGateway(async () => webhookEvent("s-unused", { eventId: "evt-store" })) });
  store.hooks.insertError = new StudyGroupStoreUnsupportedError("insertWebhookReceipt");
  await assert.rejects(
    () => store.service.handleLiveKitWebhook({ rawBody: JSON.stringify({ id: "evt-store" }), authHeader: "Bearer signed-token" }),
    (error: unknown) => error instanceof StudyGroupWebhookError && error.code === "webhook_unavailable"
  );
  // A verified signature over a malformed body fails in parsing, not signing.
  const malformed = await webhookFixture({ gateway: stubGateway(async () => webhookEvent("s-1", { eventId: "evt-malformed" })) });
  await assert.rejects(
    () => malformed.service.handleLiveKitWebhook({ rawBody: "{not-json", authHeader: "Bearer signed-token" }),
    (error: unknown) => error instanceof SyntaxError
  );

  for (const f of [provider, exploded, unconfigured, store, malformed]) {
    assert.equal(f.service.consumeWebhookRejectionCount?.(), 0);
    assert.equal(webhookRejectionLogLine(f.service), null);
  }
});
