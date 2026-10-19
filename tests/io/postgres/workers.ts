// Worker process entry for tests/io/postgres (design §4.1: "two workers").
// The parent harness spawns this file once per role with a shared barrier
// directory; every worker builds its own repository and pool, so the database
// arbitrates. The operation result is printed as one LG_IO_RESULT line.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createPostgresStudyGroupRepository } from "../../../repositories/studyGroupRepository";
import type { StudyGroupRepository } from "../../../modules/group-study/repository";
import { createStudyGroupService } from "../../../modules/group-study/service";
import { LiveKitGatewayError, type LiveKitRoomGateway, type LiveKitWebhookEvent } from "../../../modules/group-study/liveKitGateway";
import { parseLiveKitProjects } from "../../../modules/group-study/liveKitProjectRegistry";
import { getPool, ensureSchema } from "../../../services/persistence/db";
import { STUDY_GROUP_TABLES } from "./harness";

const MODE = process.env.LG_IO_MODE || "";
const ROLE = process.env.LG_IO_ROLE || "A";
const BARRIER_DIR = process.env.LG_IO_BARRIER_DIR || "";
const TEST_NOW = "2026-10-11T02:00:00.000Z";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForGo() {
  mkdirSync(BARRIER_DIR, { recursive: true });
  writeFileSync(path.join(BARRIER_DIR, `${ROLE}.ready`), `${process.pid}\n`);
  const started = Date.now();
  while (!existsSync(path.join(BARRIER_DIR, "go"))) {
    if (Date.now() - started > 20_000) throw new Error("barrier timeout");
    await sleep(5);
  }
}

// ---- Service-level proof fixtures (Phase C slice C, design §4.1) ---------
// Each process builds a real service over its own PostgreSQL repository and
// counts its own provider, gateway, and notification calls, so the parent
// test can require exactly-once totals across processes.

type ReconcileParticipants = { present: string[]; failRoom?: string };

function buildServiceFixture(webhookEvent?: LiveKitWebhookEvent, reconcileParticipants?: ReconcileParticipants) {
  const stats = {
    tutorCalls: 0,
    published: [] as string[],
    notifications: 0,
    mails: 0,
    ensureRoomCalls: [] as string[],
    incidents: [] as Array<{ sessionId: string; projectId: string | null; code: string; source: string }>
  };
  const projects = parseLiveKitProjects(JSON.stringify([
    { id: "p-eu", url: "wss://p-eu.example.test", state: "active", credentialSecretId: "secret/p-eu" },
    { id: "p-us", url: "wss://p-us.example.test", state: "active", credentialSecretId: "secret/p-us" }
  ]));
  const ensureFails = process.env.LG_IO_ENSURE_FAIL === "1";
  const gateway: LiveKitRoomGateway = {
    ensureRoom: async ({ project }) => {
      stats.ensureRoomCalls.push(project.id);
      if (ensureFails) throw new LiveKitGatewayError("unreachable");
    },
    issueParticipantToken: async ({ project }) => ({ token: `token-${project.id}`, expiresAt: TEST_NOW, url: "wss://p-eu.example.test" }),
    publishTutorMessage: async ({ text }) => { stats.published.push(text); },
    removeParticipant: async () => undefined,
    healthCheck: async ({ project }) => ({ projectId: project.id, status: "healthy", evidence: "provider_api", providerVerified: true, checkedAt: TEST_NOW, latencyMs: 0, activeRooms: 0 })
  };
  // The service-webhook mode resolves verifyWebhook straight from the
  // environment: the gateway signature check itself is unit-covered
  // (tests/unit/study-group-webhook-service.test.ts); this mode is the
  // database-semantics proof of the typed outcome.
  if (webhookEvent) gateway.verifyWebhook = async () => webhookEvent;
  // The reconcile-reader option (service-reconcile mode): sweep B reads
  // participants only when the mode attaches the provider read. Without the
  // option there is no listParticipants member at all, which the service
  // treats as a missing capability (sweep B skipped, never guessed) — the
  // same shape as production without a provider read.
  if (reconcileParticipants) {
    gateway.listParticipants = async ({ room }) => {
      if (reconcileParticipants.failRoom && room === reconcileParticipants.failRoom) {
        throw new LiveKitGatewayError("rate_limited");
      }
      return reconcileParticipants.present.map((identity) => ({ identity }));
    };
  }
  return { stats, projects, gateway };
}

function serviceFor(
  repository: StudyGroupRepository,
  webhookEvent?: LiveKitWebhookEvent,
  reconcileParticipants?: ReconcileParticipants,
  now: () => Date = () => new Date(TEST_NOW)
) {
  const { stats, projects, gateway } = buildServiceFixture(webhookEvent, reconcileParticipants);
  const service = createStudyGroupService({
    repository,
    now,
    hasCourseAccess: async () => true,
    courseSummary: async (courseId) => ({ id: courseId, title: "German History", slug: "german-history" }),
    accessibleCourses: async () => [],
    userProfile: async (userId) => ({ id: userId, displayName: userId, email: `${userId}@example.test`, locale: "en-GB" }),
    notify: async () => { stats.notifications += 1; },
    listReminders: async () => [],
    sendMail: async () => { stats.mails += 1; },
    liveKit: { apiKey: "", apiSecret: "", url: "" },
    liveKitProjects: projects,
    liveKitGateway: gateway,
    liveKitIncidentReporter: (incident) => { stats.incidents.push(incident); },
    tokenLogKey: () => Buffer.alloc(32, 7),
    courseKnowledge: async () => "The Weimar republic ended in 1933.",
    publishRoomChat: async ({ text }) => { stats.published.push(text); },
    tutorKeys: () => [{ id: "healthy", secret: "fake-key-healthy" }],
    tutorCall: async () => {
      stats.tutorCalls += 1;
      return { outcome: "ok" as const, latencyMs: 1, body: "The republic ended in 1933." };
    }
  });
  return { service, stats };
}

async function main(): Promise<Record<string, unknown>> {
  if (!process.env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL is not set for the worker");
  const repository = createPostgresStudyGroupRepository();
  await waitForGo();

  switch (MODE) {
    case "ensure-schema": {
      // Schema-bootstrap worker: a fresh process, so ensureSchema's per-process
      // memo cannot mask the race — several of these running behind one barrier
      // are the cold-start of several instances at once.
      await ensureSchema();
      const tables = await getPool().query<{ table_name: string }>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = ANY (current_schemas(false)) AND table_name = ANY($1)",
        [STUDY_GROUP_TABLES]
      );
      const column = await getPool().query(
        "SELECT 1 FROM information_schema.columns WHERE table_schema = ANY (current_schemas(false)) AND table_name = 'study_group_presences' AND column_name = 'last_seen_at'"
      );
      return { role: ROLE, ready: true, studyGroupTables: tables.rowCount, presenceColumn: column.rowCount === 1 };
    }
    case "claim-tutor": {
      const claimed = await repository.claimNextTutorRequest({
        sessionId: required("LG_IO_SESSION"),
        leaseOwner: `worker-${ROLE}`,
        leaseSeconds: Number(process.env.LG_IO_LEASE_SECONDS || "60"),
        maxAttempts: Number(process.env.LG_IO_MAX_ATTEMPTS || "3")
      });
      return {
        role: ROLE,
        claimed: claimed ? { id: claimed.id, status: claimed.status, attempts: claimed.attempts, leaseOwner: claimed.leaseOwner } : null
      };
    }
    case "seat": {
      const sessionId = required("LG_IO_SESSION");
      const userId = required("LG_IO_USER");
      const outcome = await repository.update((store) => {
        const session = store.sessions.find((item) => item.id === sessionId);
        if (!session) throw new Error("session missing");
        const seated = store.presences.filter((item) => item.sessionId === sessionId && item.enteredAt && !item.leftAt);
        if (seated.length >= session.maxParticipants) return { ok: false as const, code: "session_full" };
        const existing = store.presences.find((item) => item.sessionId === sessionId && item.userId === userId);
        if (existing && !existing.leftAt) return { ok: true as const, occupancy: seated.length };
        if (existing) {
          existing.leftAt = null;
          existing.enteredAt = TEST_NOW;
          existing.phase = "live";
        } else {
          store.presences.push({
            id: randomUUID(),
            sessionId,
            userId,
            requestedAt: `${TEST_NOW}#00000001`,
            enteredAt: TEST_NOW,
            leftAt: null,
            phase: "live"
          });
        }
        return { ok: true as const, occupancy: seated.length + 1 };
      });
      return { role: ROLE, userId, ...outcome };
    }
    case "enqueue-tutor": {
      const sessionId = required("LG_IO_SESSION");
      const userId = required("LG_IO_USER");
      const clientEventId = required("LG_IO_CLIENT_EVENT");
      const text = process.env.LG_IO_TEXT || "Why did the Weimar Republic fail?";
      const outcome = await repository.update((store) => {
        const existing = store.tutorRequests.find((item) => item.sessionId === sessionId && item.userId === userId && item.clientEventId === clientEventId);
        if (existing) return { id: existing.id, text: existing.text, created: false };
        const row = { id: randomUUID(), sessionId, userId, clientEventId, text, receivedAt: TEST_NOW, inFlight: false };
        store.tutorRequests.push(row);
        return { id: row.id, text: row.text, created: true };
      });
      return { role: ROLE, ...outcome };
    }
    case "dispatch-reminders": {
      const sessionId = required("LG_IO_SESSION");
      const audience = required("LG_IO_AUDIENCE").split(",");
      const jobs = await repository.update((store) => {
        const dispatched: string[] = [];
        for (const userId of audience) {
          if (store.reminders.some((item) => item.sessionId === sessionId && item.userId === userId)) continue;
          store.reminders.push({ id: randomUUID(), sessionId, userId, sentAt: TEST_NOW });
          dispatched.push(userId);
        }
        return dispatched;
      });
      return { role: ROLE, jobs };
    }
    case "insert-receipt": {
      const inserted = await repository.insertWebhookReceipt({
        receiptId: required("LG_IO_RECEIPT"),
        eventType: process.env.LG_IO_EVENT_TYPE || "room_finished",
        sessionId: process.env.LG_IO_SESSION || null,
        payload: { source: `worker-${ROLE}` }
      });
      return { role: ROLE, inserted };
    }
    case "assign-project": {
      const sessionId = required("LG_IO_SESSION");
      const candidate = required("LG_IO_CANDIDATE");
      const effective = await repository.update((store) => {
        const row = store.sessions.find((item) => item.id === sessionId);
        if (!row) throw new Error("session missing");
        if (row.liveKitProjectId == null) row.liveKitProjectId = candidate;
        return row.liveKitProjectId;
      });
      return { role: ROLE, candidate, effective, assigned: effective === candidate };
    }
    case "service-enter": {
      const { service } = serviceFor(repository);
      try {
        const entered = await service.enterSession({ actorUserId: required("LG_IO_USER"), sessionId: required("LG_IO_SESSION"), requestedAt: TEST_NOW });
        return { role: ROLE, ok: true, occupancy: entered.occupancy };
      } catch (error) {
        return { role: ROLE, ok: false, code: (error as { code?: string }).code ?? null };
      }
    }
    case "service-drain-tutor": {
      const { service, stats } = serviceFor(repository);
      const delivered = await service.deliverTutorAnswer({ sessionId: required("LG_IO_SESSION") });
      return { role: ROLE, tutorCalls: stats.tutorCalls, published: stats.published, delivered: delivered?.text ?? null };
    }
    case "service-start": {
      const { service, stats } = serviceFor(repository);
      try {
        const view = await service.startSession({ actorUserId: "host", sessionId: required("LG_IO_SESSION") });
        return { role: ROLE, ok: true, state: view.state, ensureRoomCalls: stats.ensureRoomCalls, incidents: stats.incidents };
      } catch (error) {
        return { role: ROLE, ok: false, code: (error as { code?: string }).code ?? null, ensureRoomCalls: stats.ensureRoomCalls, incidents: stats.incidents };
      }
    }
    case "service-reminders": {
      const { service, stats } = serviceFor(repository);
      await service.dispatchDueReminders();
      return { role: ROLE, notifications: stats.notifications, mails: stats.mails };
    }
    case "service-webhook": {
      const eventId = required("LG_IO_EVENT_ID");
      const sessionId = required("LG_IO_SESSION");
      const eventType = process.env.LG_IO_EVENT_TYPE || "participant_left";
      const { service } = serviceFor(repository, {
        eventId,
        eventType,
        room: sessionId,
        participantIdentity: required("LG_IO_IDENTITY"),
        createdAt: required("LG_IO_CREATED_AT"),
        projectId: "io-project"
      });
      const outcome = await service.handleLiveKitWebhook({
        rawBody: JSON.stringify({ event: eventType, id: eventId, room: { name: sessionId } }),
        authHeader: "io-test"
      });
      return { role: ROLE, outcome };
    }
    case "service-reconcile": {
      // The provider reader is attached only when the environment asks for
      // it: LG_IO_PRESENT set (even to the empty string) or LG_IO_FAIL_ROOM
      // set. The seat-lease sweep never reads it (QA 2026-10-19), so the
      // tests attach a failing one to prove that.
      const present = process.env.LG_IO_PRESENT;
      const failRoom = process.env.LG_IO_FAIL_ROOM;
      const reconcileParticipants: ReconcileParticipants | undefined = present !== undefined || failRoom !== undefined
        ? {
            present: (present ?? "").split(",").map((value) => value.trim()).filter(Boolean),
            failRoom: failRoom || undefined
          }
        : undefined;
      // Sweep A ages receipts against SQL NOW() and the lease sweep ages seats
      // against deps.now(), so reconciliation runs on the real clock here:
      // the other service modes pin TEST_NOW for their timetable operations.
      const { service } = serviceFor(repository, undefined, reconcileParticipants, () => new Date());
      const outcome = await service.reconcileLiveKitState();
      return { role: ROLE, ...outcome };
    }
    default:
      throw new Error(`unknown LG_IO_MODE ${MODE}`);
  }
}

main()
  .then(async (result) => {
    console.log(`LG_IO_RESULT ${JSON.stringify(result)}`);
    await getPool().end();
  })
  .catch(async (error) => {
    console.error(error);
    try {
      await getPool().end();
    } catch {
      // The pool may never have connected.
    }
    process.exit(1);
  });
