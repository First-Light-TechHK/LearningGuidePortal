import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { emptyStore, type OutboxRow, type StudyGroupStore, type TutorRequestRow, type TutorRequestStatus } from "./domain";

export type {
  OutboxKind,
  OutboxRow,
  OutboxStatus,
  TutorRequestRow,
  TutorRequestStatus
} from "./domain";

// The receipt status union mirrors the CHECK on study_group_webhook_receipts
// in db/migrations/012_study_group_persistence.sql.
export type WebhookReceiptStatus = "received" | "processed" | "ignored" | "failed";
export type WebhookReceiptRow = Readonly<{
  receiptId: string;
  status: WebhookReceiptStatus;
  failureClass: string | null;
}>;

// Redacted operational metrics (Phase C slice 3): counts and one age only —
// never identities, session ids, receipt ids, or payload contents. These feed
// the CloudWatch metric filters behind the release-gate alarms
// (release-runbook.md § Study Group / LiveKit release gate).
export type StudyGroupOperationalMetrics = Readonly<{
  tutorQueued: number;
  tutorInFlight: number;
  tutorDeadLetter: number;
  tutorOldestQueuedAgeSeconds: number;
  webhookAbandoned: number;
  webhookFailed: number;
}>;

// The port is extended additively (design §3.1): the durable tutor-queue and
// outbox operations are implemented by the PostgreSQL adapter
// (repositories/studyGroupRepository.ts) and, to keep one service code path,
// trivially by the single-process file adapter below. The webhook-receipt
// operations are used only by the slice-2 route, which never runs on the file
// store, so the file adapter refuses them with a typed error.
export type StudyGroupRepository = {
  read(): Promise<StudyGroupStore>;
  appendTokenLog(line: string): Promise<void>;
  update<T>(mutate: (store: StudyGroupStore) => T | Promise<T>): Promise<T>;

  // durable tutor queue (hazard 2)
  claimNextTutorRequest(input: {
    sessionId: string; leaseOwner: string; leaseSeconds: number; maxAttempts: number;
  }): Promise<TutorRequestRow | null>;
  settleTutorRequest(input: {
    id: string; leaseOwner: string;
    outcome: { status: "answered" | "dead_letter"; terminalReason: string };
    outbox?: { room: string; projectId: string; text: string; messageId: string };
  }): Promise<void>;

  // durable room-message outbox (at-least-once publish, bounded)
  claimNextOutboxMessage(input: { sessionId: string; leaseOwner: string; leaseSeconds: number }): Promise<OutboxRow | null>;
  markOutboxDelivered(input: { id: string; leaseOwner: string }): Promise<void>;
  markOutboxFailed(input: { id: string; leaseOwner: string; failureClass: string; maxAttempts: number; retryDelaySeconds: number }): Promise<void>;

  // webhook receipts (used by the slice-2 route; operations land now)
  insertWebhookReceipt(input: { receiptId: string; eventType: string; sessionId: string | null; payload: unknown }): Promise<boolean>;
  getWebhookReceipt(receiptId: string): Promise<WebhookReceiptRow | null>;
  markWebhookProcessed(input: { receiptId: string; result: "processed" | "ignored" | "failed"; failureClass?: string }): Promise<void>;

  // bounded reconciliation sweeps (slice-2 design §4). Sweep A abandons
  // receipts stuck in `received`; sweep B lists live sessions that still have
  // an open presence. Both are PostgreSQL-only facts about durable dedupe and
  // presence state, so the file adapter refuses them like the receipt ops.
  abandonStaleWebhookReceipts(input: { olderThanSeconds: number; limit: number }): Promise<number>;
  listLiveSessionsWithOpenPresences(limit: number): Promise<ReadonlyArray<{ id: string; liveKitProjectId: string | null }>>;
  // Bounded tutor recovery (global review risk 1): session ids whose durable
  // tutor work has no inbound ask left to wake it — queued items that came due,
  // in-flight leases that expired, and outbox rows that are due or whose send
  // lease expired. The drain itself re-claims through the normal single-flight
  // claim, so a session another instance is actively draining yields nothing.
  listSessionsWithPendingTutorWork(input: { limit: number }): Promise<string[]>;

  // redacted operational metrics (slice-3 design §5.2): one aggregate read of
  // durable facts only. The file adapter refuses it like the receipt ops; the
  // PostgreSQL implementation serves the runtime metrics timer.
  studyGroupOperationalMetrics(): Promise<StudyGroupOperationalMetrics>;
};

export class StudyGroupStoreUnsupportedError extends Error {
  readonly code = "store_unsupported";

  constructor(operation: string) {
    super(`${operation} is not supported in the file Study Group store.`);
    this.name = "StudyGroupStoreUnsupportedError";
  }
}

function withoutMinutes(session: StudyGroupStore["sessions"][number] & { durationMinutes?: number; liveKitProjectId?: string | null }) {
  const { durationMinutes: _minutes, ...rest } = session;
  return { ...rest, liveKitProjectId: rest.liveKitProjectId ?? null };
}

function normalise(value: Partial<StudyGroupStore> | null): StudyGroupStore {
  const base = emptyStore();
  if (!value) return base;
  return {
    groups: value.groups ?? [],
    memberships: value.memberships ?? [],
    sessions: (value.sessions ?? []).map((session) => withoutMinutes(session)),
    intents: value.intents ?? [],
    presences: value.presences ?? [],
    meetings: value.meetings ?? [],
    reminders: value.reminders ?? [],
    tutorRequests: value.tutorRequests ?? [],
    outbox: value.outbox ?? []
  };
}

function tutorStatus(row: TutorRequestRow): TutorRequestStatus {
  if (row.status) return row.status;
  if (row.answeredAt) return "answered";
  return row.inFlight ? "in_flight" : "queued";
}

function dueAt(value: string | null | undefined, nowMs: number) {
  return !value || Date.parse(value) <= nowMs;
}

export function createStudyGroupRepository(directory: string): StudyGroupRepository {
  const file = path.join(directory, "study-group.json");
  let chain: Promise<unknown> = Promise.resolve();

  async function read(): Promise<StudyGroupStore> {
    try {
      return normalise(JSON.parse(await readFile(file, "utf8")) as StudyGroupStore);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyStore();
      throw error;
    }
  }

  async function write(store: StudyGroupStore) {
    await mkdir(directory, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(store)}\n`, "utf8");
    await rename(tmp, file);
  }

  async function appendTokenLog(line: string) {
    await mkdir(directory, { recursive: true });
    const logFile = path.join(directory, "token-issuance.log");
    let previous = "";
    try {
      previous = await readFile(logFile, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await writeFile(logFile, `${previous}${line}\n`, "utf8");
  }

  function update<T>(mutate: (store: StudyGroupStore) => T | Promise<T>) {
    const run = chain.then(async () => {
      const store = await read();
      const result = await mutate(store);
      await write(store);
      return result;
    });
    chain = run.then(() => undefined, () => undefined);
    return run;
  }

  // The durable operations below are single-process equivalents of the
  // PostgreSQL adapter's statements (design §3.1/§4.3). Leases, attempts and
  // dead letters behave the same; cross-process single-flight does not exist
  // on the file store (dev-only stopgap, FIX-PROPOSAL §3).
  async function claimNextTutorRequest(input: {
    sessionId: string; leaseOwner: string; leaseSeconds: number; maxAttempts: number;
  }): Promise<TutorRequestRow | null> {
    for (;;) {
      const claimed = await update((store) => {
        const now = Date.now();
        const rows = store.tutorRequests.filter((item) => item.sessionId === input.sessionId);
        const active = rows.find((item) => tutorStatus(item) === "in_flight" && item.leaseExpiresAt && Date.parse(item.leaseExpiresAt) > now);
        if (active) return null;
        const candidate = rows
          .filter((item) => {
            const status = tutorStatus(item);
            if (status !== "queued" && status !== "in_flight") return false;
            if (!dueAt(item.nextAttemptAt, now)) return false;
            // An in-flight row with no lease (legacy pre-marked rows) is reclaimable.
            if (status === "in_flight" && item.leaseExpiresAt && Date.parse(item.leaseExpiresAt) > now) return false;
            return true;
          })
          .sort((left, right) => left.receivedAt.localeCompare(right.receivedAt) || (left.seq ?? 0) - (right.seq ?? 0))[0];
        if (!candidate) return null;
        candidate.status = "in_flight";
        candidate.inFlight = true;
        candidate.leaseOwner = input.leaseOwner;
        candidate.leaseExpiresAt = new Date(now + input.leaseSeconds * 1000).toISOString();
        candidate.nextAttemptAt = null;
        candidate.attempts = (candidate.attempts ?? 0) + 1;
        return { ...candidate };
      });
      if (!claimed) return null;
      if ((claimed.attempts ?? 0) > input.maxAttempts) {
        // The candidate was an expired lease whose attempts had already
        // reached maxAttempts: dead-letter it and re-run the bounded claim so
        // a poisoned item cannot stall later questions (design §3.2).
        await update((store) => {
          const row = store.tutorRequests.find((item) => item.id === claimed.id);
          if (row && row.leaseOwner === input.leaseOwner && tutorStatus(row) === "in_flight") {
            row.status = "dead_letter";
            row.inFlight = false;
            row.terminalReason = "attempts_exhausted";
            row.leaseOwner = null;
            row.leaseExpiresAt = null;
            row.nextAttemptAt = null;
          }
        });
        continue;
      }
      return claimed;
    }
  }

  async function settleTutorRequest(input: {
    id: string; leaseOwner: string;
    outcome: { status: "answered" | "dead_letter"; terminalReason: string };
    outbox?: { room: string; projectId: string; text: string; messageId: string };
  }) {
    await update((store) => {
      const row = store.tutorRequests.find((item) => item.id === input.id);
      if (!row || tutorStatus(row) !== "in_flight" || row.leaseOwner !== input.leaseOwner) return;
      row.status = input.outcome.status;
      row.inFlight = false;
      row.terminalReason = input.outcome.terminalReason;
      row.leaseOwner = null;
      row.leaseExpiresAt = null;
      row.nextAttemptAt = null;
      if (input.outcome.status === "answered") row.answeredAt = new Date().toISOString();
      if (!input.outbox) return;
      row.outboxMessageId = input.outbox.messageId;
      if (store.outbox.some((item) => item.dedupeKey === row.id)) return;
      store.outbox.push({
        id: randomUUID(),
        kind: "room_message",
        dedupeKey: row.id,
        sessionId: row.sessionId,
        payload: { ...input.outbox },
        status: "queued",
        attempts: 0,
        leaseOwner: null,
        leaseExpiresAt: null,
        nextAttemptAt: null,
        failureClass: null,
        createdAt: new Date().toISOString(),
        deliveredAt: null
      });
    });
  }

  async function claimNextOutboxMessage(input: { sessionId: string; leaseOwner: string; leaseSeconds: number }): Promise<OutboxRow | null> {
    return update((store) => {
      const now = Date.now();
      const candidate = store.outbox
        .filter((item) => {
          if (item.sessionId !== input.sessionId) return false;
          if (item.status === "queued" || item.status === "failed") return dueAt(item.nextAttemptAt, now);
          if (item.status !== "sending") return false;
          return !item.leaseExpiresAt || Date.parse(item.leaseExpiresAt) <= now;
        })
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
      if (!candidate) return null;
      candidate.status = "sending";
      candidate.attempts += 1;
      candidate.leaseOwner = input.leaseOwner;
      candidate.leaseExpiresAt = new Date(now + input.leaseSeconds * 1000).toISOString();
      candidate.nextAttemptAt = null;
      return { ...candidate };
    });
  }

  async function markOutboxDelivered(input: { id: string; leaseOwner: string }) {
    await update((store) => {
      const row = store.outbox.find((item) => item.id === input.id);
      if (!row || row.status !== "sending" || row.leaseOwner !== input.leaseOwner) return;
      row.status = "delivered";
      row.deliveredAt = new Date().toISOString();
      row.leaseOwner = null;
      row.leaseExpiresAt = null;
    });
  }

  async function markOutboxFailed(input: { id: string; leaseOwner: string; failureClass: string; maxAttempts: number; retryDelaySeconds: number }) {
    await update((store) => {
      const row = store.outbox.find((item) => item.id === input.id);
      if (!row || row.status !== "sending" || row.leaseOwner !== input.leaseOwner) return;
      row.failureClass = input.failureClass;
      row.leaseOwner = null;
      row.leaseExpiresAt = null;
      if (row.attempts >= input.maxAttempts) {
        row.status = "dead";
        row.nextAttemptAt = null;
        return;
      }
      row.status = "failed";
      row.nextAttemptAt = new Date(Date.now() + input.retryDelaySeconds * 1000).toISOString();
    });
  }

  async function listSessionsWithPendingTutorWork(input: { limit: number }): Promise<string[]> {
    const store = await read();
    const now = Date.now();
    const pending = new Set<string>();
    for (const row of store.tutorRequests) {
      const status = tutorStatus(row);
      if (status === "queued" && dueAt(row.nextAttemptAt, now)) pending.add(row.sessionId);
      if (status === "in_flight" && (!row.leaseExpiresAt || Date.parse(row.leaseExpiresAt) <= now)) pending.add(row.sessionId);
    }
    for (const row of store.outbox) {
      if ((row.status === "queued" || row.status === "failed") && dueAt(row.nextAttemptAt, now)) pending.add(row.sessionId);
      if (row.status === "sending" && (!row.leaseExpiresAt || Date.parse(row.leaseExpiresAt) <= now)) pending.add(row.sessionId);
    }
    return [...pending].sort().slice(0, input.limit);
  }

  return {
    read,
    appendTokenLog,
    update,
    claimNextTutorRequest,
    settleTutorRequest,
    claimNextOutboxMessage,
    markOutboxDelivered,
    markOutboxFailed,
    listSessionsWithPendingTutorWork,
    insertWebhookReceipt() {
      throw new StudyGroupStoreUnsupportedError("insertWebhookReceipt");
    },
    getWebhookReceipt() {
      throw new StudyGroupStoreUnsupportedError("getWebhookReceipt");
    },
    markWebhookProcessed() {
      throw new StudyGroupStoreUnsupportedError("markWebhookProcessed");
    },
    abandonStaleWebhookReceipts() {
      throw new StudyGroupStoreUnsupportedError("abandonStaleWebhookReceipts");
    },
    listLiveSessionsWithOpenPresences() {
      throw new StudyGroupStoreUnsupportedError("listLiveSessionsWithOpenPresences");
    },
    studyGroupOperationalMetrics() {
      throw new StudyGroupStoreUnsupportedError("studyGroupOperationalMetrics");
    }
  };
}
