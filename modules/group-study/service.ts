import { randomUUID } from "node:crypto";
import {
  SESSION_DURATION_SECONDS,
  STARTING_SOON_MS,
  StudyGroupError,
  TOKEN_TTL_SECONDS,
  effectiveSessionState,
  missedUnstarted,
  type AttendanceIntentRow,
  type EffectiveSessionState,
  type GroupRole,
  type LiveSessionRow,
  type StudyGroupRow,
  type StudyGroupStore,
  type TutorReplyTo
} from "./domain";
import { signParticipantToken } from "./liveKitToken";
import { LiveKitGatewayError, type LiveKitRoomGateway, type LiveKitWebhookEvent } from "./liveKitGateway";
import { classifyLiveKitIncident, type LiveKitIncidentCode } from "./liveKitIncident";
import type { LiveKitProjectRegistry } from "./liveKitProjectRegistry";
import { StudyGroupStoreUnsupportedError, type StudyGroupOperationalMetrics, type StudyGroupRepository } from "./repository";
import { abandonedLiveSessions, closeLapsedSeats, completeSession, endLiveSessionIfEmpty, SEAT_LEASE_MS, seatCount, seatHeld, seatLapsed, seatRenewable, sweepSeats } from "./presence";
import { encryptTokenLogLine } from "./tokenLog";
import { createTutorKeyPool, type TutorKeyOutcome } from "./tutorKeyPool";
import { clampTutorReply, parseTutorReply } from "./tutorAnswer";

export type CourseSummary = { id: string; title: string; slug: string };
export type UserProfile = { id: string; displayName: string; email: string | null; locale: "en-GB" | "zh-CN" };

export type StudyGroupDeps = {
  repository: StudyGroupRepository;
  now: () => Date;
  hasCourseAccess: (userId: string, courseId: string) => Promise<boolean>;
  courseSummary: (courseId: string) => Promise<CourseSummary | null>;
  courseLessons?: (courseId: string) => Promise<Array<{ id: string; title: string }>>;
  accessibleCourses: (userId: string) => Promise<CourseSummary[]>;
  userProfile: (userId: string) => Promise<UserProfile | null>;
  notify: (input: { userId: string; title: string; body: string; sessionId?: string }) => Promise<void>;
  listReminders: (userId: string) => Promise<Array<{ body: string; createdAt: string }>>;
  // Withdraws the pending reminder rows a cancelling action invalidates
  // (BUG-0109 storage honesty; the read-side validity filter is the backstop).
  // Scoped to the given Live Sessions, optionally to one user. Optional so
  // existing wiring keeps its shape; the runtime always provides it.
  withdrawReminders?: (input: { sessionIds: string[]; userId?: string }) => Promise<void>;
  sendMail: (input: { to: string; subject: string; text: string; locale: "en-GB" | "zh-CN" }) => Promise<void>;
  liveKit: { apiKey: string; apiSecret: string; url: string };
  liveKitProjects?: LiveKitProjectRegistry;
  liveKitGateway?: LiveKitRoomGateway;
  liveKitIncidentReporter?: (input: { sessionId: string; projectId: string | null; code: LiveKitIncidentCode; source: "client" | "gateway" }) => void;
  // Resolved lazily at issuance only: data operations must work on an
  // environment where the key is not configured yet (managed environments get
  // it injected from Secrets Manager; DEV resolves it on first real issuance).
  tokenLogKey: () => Buffer | null;
  courseKnowledge?: (courseId: string) => Promise<string>;
  publishRoomChat?: (input: { room: string; text: string; projectId: string | null; messageId: string; mode: string; replyTo?: TutorReplyTo }) => Promise<void>;
  tutorKeys?: () => Array<{ id: string; secret: string }>;
  tutorCall?: (input: { secret: string; text: string; context: string }) => Promise<{ outcome: TutorKeyOutcome; latencyMs: number; body?: string }>;
  // One redacted operational line (a fixed type and counts, never an id or
  // a name); the runtime writes it to the log stream.
  operationalLog?: (event: Record<string, unknown>) => void;
  // How long one drain keeps claiming new questions, and how long a second
  // drain waits for a running one (test seams; defaults TUTOR_DRAIN_BUDGET_MS
  // and TUTOR_DRAIN_WAIT_MS). The budget stays below the 60 s claim lease.
  tutorDrainBudgetMs?: number;
  tutorDrainWaitMs?: number;
  // Injectable scheduler for the failing context's own re-drain (test seam):
  // the default is an unref'd setTimeout so a pending retry never keeps the
  // process alive.
  scheduleRetry?: (run: () => void, delayMs: number) => void | ReturnType<typeof setTimeout>;
};

export type GroupView = StudyGroupRow & {
  role: GroupRole | null;
  memberCount: number;
  courseTitle: string;
  courseSlug: string;
  // False when the related Course is no longer published (QA M7): the title
  // and slug are then empty, and Discover leaves the group out.
  courseAvailable: boolean;
  live: boolean;
};

export type StudyGroupWebhookOutcome = Readonly<{ status: "processed" | "ignored" | "duplicate" }>;

// The room AI Tutor question shares the learning-page message cap (4000):
// without it, every extra character of a room question became model input
// (hunt M5). Enforced at enqueue, before anything is stored.
const TUTOR_REQUEST_MAX_LENGTH = 4000;

// AI Tutor fairness (QA 2026-10-19 N5): the room's questions are answered one
// at a time, so one member must not be able to queue dozens of model calls
// ahead of everyone else. Each member may have this many questions waiting
// for an answer, and may ask this many per minute.
export const TUTOR_PENDING_PER_USER = 2;
export const TUTOR_REQUESTS_PER_MINUTE = 5;
// The answer carries a short excerpt of the question it replies to.
const TUTOR_REPLY_QUOTE_MAX = 80;
// One drain claims new questions for at most this long, below the 60 s claim
// lease, then hands the rest to a fresh drain (QA M21): a long queue never
// keeps one drain, and its publishes, running past every lease. A drain that
// finds another one running waits at most TUTOR_DRAIN_WAIT_MS for it; the
// running drain claims whatever was queued meanwhile.
const TUTOR_DRAIN_BUDGET_MS = 45_000;
const TUTOR_DRAIN_WAIT_MS = 60_000;

// The provider reads the sweep and the seat check may make (QA final review
// X-3, X-4): bounded in number and in time, so a slow provider can never hold
// a sweep or an entry for long. A read that fails or times out counts as no
// answer, and the lease rules decide alone, as before.
const PROVIDER_ROOM_CHECKS_PER_SWEEP = 10;
const PROVIDER_ROOM_CHECK_TIMEOUT_MS = 2_000;
// Entries that need the provider's word on one room share a single read for
// this long (QA r3 X-4 follow-up), so a burst of re-entries costs one call.
const PROVIDER_ROOM_READ_REUSE_MS = 3_000;

function withTimeout<T>(promise: Promise<T>, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timed out")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// A provider failure the next try may not hit (QA M12): rate limiting or a
// network failure answers "temporarily unavailable, try again" rather than
// the configuration-class `unavailable`.
function liveKitFailure(error: LiveKitGatewayError, message: string) {
  return error.code === "rate_limited" || error.code === "unreachable"
    ? new StudyGroupError("livekit_temporarily_unavailable", "LiveKit is temporarily unavailable. Try again.")
    : new StudyGroupError("unavailable", message);
}

function tutorRequestPending(row: { status?: string; answeredAt?: string | null; inFlight: boolean }) {
  const status = row.status ?? (row.answeredAt ? "answered" : row.inFlight ? "in_flight" : "queued");
  return status === "queued" || status === "in_flight";
}

// Typed failure of the slice-2 webhook path (design §3 HTTP mapping): the
// route maps invalid_signature to 400 and webhook_unavailable to 503, and
// never leaks provider detail.
export class StudyGroupWebhookError extends Error {
  readonly code: "invalid_signature" | "webhook_unavailable";

  constructor(code: "invalid_signature" | "webhook_unavailable") {
    super("The webhook could not be accepted.");
    this.name = "StudyGroupWebhookError";
    this.code = code;
  }
}

function clean(value: string) {
  return value.trim();
}

function requireText(value: string | undefined, label: string, max: number) {
  const text = clean(value || "");
  if (!text) throw new StudyGroupError("validation", `${label} is required.`);
  if (text.length > max) throw new StudyGroupError("validation", `${label} is too long.`);
  return text;
}

function requiredValue(value: string | undefined, label: string) {
  const text = clean(value || "");
  if (!text) throw new StudyGroupError("validation", `${label} is required.`);
  return text;
}

function activeMembership(store: StudyGroupStore, groupId: string, userId: string | null) {
  return store.memberships.find((item) => item.groupId === groupId && item.userId === userId && !item.leftAt) || null;
}

// Create actions are idempotent over a short window (QA 2026-10-19 N8 and
// BUG-0110): the same request submitted twice — a double click, a retry after
// a slow response, two tabs — returns the row the first one created instead
// of making a second one.
const DUPLICATE_SUBMIT_WINDOW_MS = 10_000;

function sameSubmitWindow(createdAt: string, now: string) {
  return Date.parse(now) - Date.parse(createdAt) < DUPLICATE_SUBMIT_WINDOW_MS;
}

function plannedCount(store: StudyGroupStore, sessionId: string) {
  return store.intents.filter((item) => item.sessionId === sessionId && !item.cancelledAt).length;
}

// The provider's view of one live room: who is connected, and when it was
// asked, so a seat taken after the read is never judged by it.
type RoomRead = { identities: ReadonlySet<string>; readAt: string };

type EntryJob = {
  requestedAt: string;
  seq: number;
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
};

export function createStudyGroupService(deps: StudyGroupDeps) {
  const entryJobs: EntryJob[] = [];
  let entrySeq = 0;
  let draining = false;
  const startingSessions = new Map<string, Promise<unknown>>();
  // Per room: the shared provider read for entries (single flight, reused
  // briefly) and when the sweep last asked about it (oldest asked first).
  const roomReads = new Map<string, { at: number; read: Promise<RoomRead | null> }>();
  const roomCheckedAt = new Map<string, number>();
  const tutorDraining = new Set<string>();
  const tutorPools = new Map<string, ReturnType<typeof createTutorKeyPool>>();
  // One pending re-drain per session: a failed publish schedules its own
  // retry in this process with the same backoff the outbox row already
  // carries. The poll sweep exists only for work stranded by a process that
  // died — a live process never waits on it.
  const pendingTutorRetries = new Map<string, void | ReturnType<typeof setTimeout>>();
  function scheduleTutorRetry(sessionId: string, delayMs: number) {
    if (pendingTutorRetries.has(sessionId)) return;
    const schedule = deps.scheduleRetry ?? ((run: () => void, ms: number) => {
      const timer = setTimeout(run, ms);
      timer.unref();
      return timer;
    });
    pendingTutorRetries.set(sessionId, schedule(() => {
      pendingTutorRetries.delete(sessionId);
      void drainTutorSession(sessionId).catch(() => undefined);
    }, delayMs));
  }
  // Signature-rejection counter: counts are per-instance (each App Runner
  // instance counts only the rejections it saw; multi-instance aggregation is
  // acceptable for the alarm). Only invalid/missing signatures increment it —
  // never provider or store failures — and the runtime metrics timer drains it.
  let webhookRejectionCount = 0;

  function tutorPoolFor(keys: Array<{ id: string; secret: string }>) {
    const keySet = JSON.stringify(keys);
    const existing = tutorPools.get(keySet);
    if (existing) return existing;
    const pool = createTutorKeyPool({
      keys,
      call: async () => ({ outcome: "failed", latencyMs: 0 })
    });
    tutorPools.clear();
    tutorPools.set(keySet, pool);
    return pool;
  }

  // Shared drain body: deliverTutorAnswer is the inbound-ask path and
  // recoverTutorWork the stranded-work path; both run this same durable
  // claim/settle/outbox flow.
  async function drainTutorSession(sessionId: string) {
    // In-process anti-reentrancy only: the file store is single-process, and
    // the observable timing (a second drain waits, then finds nothing to
    // claim) stays as before. Correctness across instances is the durable
    // claim/settle/outbox flow below (design §3.2, hazard 2).
    const waitStarted = Date.now();
    for (;;) {
      if (!tutorDraining.has(sessionId)) {
        tutorDraining.add(sessionId);
        break;
      }
      if (Date.now() - waitStarted >= (deps.tutorDrainWaitMs ?? TUTOR_DRAIN_WAIT_MS)) return null;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const drainStarted = Date.now();
    const leaseOwner = randomUUID();
    let last: { text: string; mode: string } | null = null;
    // Publishes every due outbox row of this session. It runs after each
    // settle, so an answer reaches the room as soon as it exists instead of
    // waiting for the rest of the queue, and once more at the end for rows a
    // failed or dead process left behind.
    const flushOutbox = async () => {
      const publish = deps.publishRoomChat;
      if (!publish) return;
      for (;;) {
        const message = await deps.repository.claimNextOutboxMessage({ sessionId, leaseOwner, leaseSeconds: 60 });
        if (!message) break;
        try {
          // Legacy outbox rows predate the mode field; the client contract
          // reads a missing mode as "course".
          const mode = message.payload.mode || "course";
          await publish({
            room: message.payload.room,
            text: message.payload.text,
            projectId: message.payload.projectId || null,
            messageId: message.payload.messageId,
            mode,
            ...(message.payload.replyTo ? { replyTo: message.payload.replyTo } : {})
          });
          await deps.repository.markOutboxDelivered({ id: message.id, leaseOwner });
          last = { text: message.payload.text, mode };
        } catch (error) {
          // A failed publish never blocks the queue: the request is already
          // settled, and the failing context schedules its own re-drain with
          // the same backoff the durable row carries (the failed row is not
          // due, so the loop simply skips it). The poll sweep is only for
          // work stranded by a process that died.
          const retryDelaySeconds = Math.min(30, 5 * Math.max(1, message.attempts));
          await deps.repository.markOutboxFailed({
            id: message.id,
            leaseOwner,
            failureClass: error instanceof LiveKitGatewayError ? error.code : "publish_failed",
            maxAttempts: 5,
            retryDelaySeconds
          });
          if (message.attempts < 5) scheduleTutorRetry(sessionId, retryDelaySeconds * 1000);
        }
      }
    };
    try {
      for (;;) {
        if (Date.now() - drainStarted >= (deps.tutorDrainBudgetMs ?? TUTOR_DRAIN_BUDGET_MS)) {
          // Out of budget: a fresh drain takes the rest of the queue.
          scheduleTutorRetry(sessionId, 1_000);
          break;
        }
        // Claim before any provider work: at most one in-flight item per
        // session, lease-bounded, receipt-ordered across all instances.
        const item = await deps.repository.claimNextTutorRequest({
          sessionId,
          leaseOwner,
          leaseSeconds: 60,
          maxAttempts: 5
        });
        if (!item) break;
        const snapshot = await deps.repository.read();
        const session = snapshot.sessions.find((entry) => entry.id === sessionId && entry.status !== "removed");
        if (!session) {
          // The room was removed after the question was queued; the item can
          // never be answered, and settling it keeps the store free of strands.
          await deps.repository.settleTutorRequest({ id: item.id, leaseOwner, outcome: { status: "dead_letter", terminalReason: "session_removed" } });
          continue;
        }
        if (session.status !== "live") {
          // The session ended while the question waited: nobody is left in
          // the room to read an answer, so no model call is spent on it.
          await deps.repository.settleTutorRequest({ id: item.id, leaseOwner, outcome: { status: "dead_letter", terminalReason: "session_ended" } });
          continue;
        }
        // A failing profile or knowledge read must not strand the item in
        // flight until its lease runs out, holding the asker's pending slot
        // and the questions behind it (QA r3-ops): the answer goes out without
        // a name, or without course material, instead. A nameless asker is
        // answered with name "" (r3-B3), which the room shows as "a participant".
        const asker = await deps.userProfile(item.userId).catch(() => null);
        const question = item.text.length > TUTOR_REPLY_QUOTE_MAX ? `${item.text.slice(0, TUTOR_REPLY_QUOTE_MAX - 1)}…` : item.text;
        const replyTo: TutorReplyTo = { name: asker?.displayName || "", question };
        // Grounding and the model call run outside every transaction and
        // lock; the claim lease, not the process, guards the window. The whole
        // course material goes to the model verbatim (owner decision): the
        // model itself fuzzy-matches a question against it, across languages,
        // so no server-side retrieval or threshold may short-circuit the call.
        const group = snapshot.groups.find((entry) => entry.id === session.groupId);
        const corpus = group && deps.courseKnowledge ? await deps.courseKnowledge(group.courseId).catch(() => "") : "";
        const context = corpus.trim();
        const keys = deps.tutorKeys?.() ?? [];
        let reply: { text: string; mode: "course" | "general" | "unavailable" } = { text: "", mode: "unavailable" };
        if (deps.tutorCall && keys.length > 0) {
          // A call that throws (rather than reporting a failed outcome) is an
          // unavailable answer like any other failure, never a stranded item.
          const result = await tutorPoolFor(keys).execute(item.text, (secret) => deps.tutorCall!({ secret, text: item.text, context })).catch(() => ({ keyId: "", body: "" }));
          const body = !result.keyId || !result.body || keys.some((key) => result.body?.includes(key.secret)) ? "" : result.body.trim();
          if (body) {
            const parsed = parseTutorReply(body);
            const text = clampTutorReply(parsed.text);
            // Without course material in context, a "course" tag cannot be
            // honoured: the reply must stay general.
            if (text) reply = { text, mode: context ? parsed.mode : "general" };
          }
        }
        // Settle with the outbox row in one transaction; the publish below is
        // at-least-once and retried on a later drain if it fails. Every item
        // settles as answered and produces exactly one room message — an
        // unavailable one (empty text, mode "unavailable") when no usable
        // tutor key or call produced a reply, so the client can show its own
        // "temporarily unavailable" copy instead of nothing.
        await deps.repository.settleTutorRequest({
          id: item.id,
          leaseOwner,
          outcome: { status: "answered", terminalReason: reply.mode === "unavailable" ? "model_failed" : "answered" },
          outbox: { room: session.id, projectId: session.liveKitProjectId ?? "", text: reply.text, messageId: item.id, mode: reply.mode, replyTo }
        });
        if (!deps.publishRoomChat) last = { text: reply.text, mode: reply.mode };
        await flushOutbox();
      }
      await flushOutbox();
      return last;
    } finally {
      tutorDraining.delete(sessionId);
    }
  }

  function emitLiveKitIncident(input: { sessionId: string; projectId: string | null; code: LiveKitIncidentCode; source: "client" | "gateway" }) {
    try {
      deps.liveKitIncidentReporter?.(input);
    } catch {
      // Observability must never turn a recoverable meeting failure into a user failure.
    }
  }

  function enqueueEntry<T>(requestedAt: string, run: () => Promise<T>) {
    return new Promise<T>((resolve, reject) => {
      entryJobs.push({ requestedAt, seq: entrySeq++, run, resolve: (value) => resolve(value as T), reject });
      kickEntryQueue();
    });
  }

  function kickEntryQueue() {
    if (draining) return;
    draining = true;
    void (async () => {
      try {
        while (entryJobs.length) {
          entryJobs.sort((left, right) => left.seq - right.seq);
          const job = entryJobs.shift()!;
          try {
            job.resolve(await job.run());
          } catch (error) {
            job.reject(error);
          }
        }
      } finally {
        draining = false;
        if (entryJobs.length) kickEntryQueue();
      }
    })();
  }

  function groupIsLive(store: StudyGroupStore, groupId: string) {
    return store.sessions.some((session) => session.groupId === groupId && effectiveSessionState(session, deps.now()) === "live");
  }

  // One course lookup per course for a whole list, not one per group: a list
  // of many groups on few courses stays as fast as the store read.
  function courseSummaries() {
    const cache = new Map<string, ReturnType<StudyGroupDeps["courseSummary"]>>();
    return (courseId: string) => {
      let summary = cache.get(courseId);
      if (!summary) {
        summary = deps.courseSummary(courseId);
        cache.set(courseId, summary);
      }
      return summary;
    };
  }

  async function toView(group: StudyGroupRow, store: StudyGroupStore, memberCount: number, role: GroupRole | null, courseSummary = deps.courseSummary): Promise<GroupView> {
    const course = await courseSummary(group.courseId);
    return {
      ...group,
      role,
      memberCount,
      courseTitle: course?.title || "",
      courseSlug: course?.slug || "",
      courseAvailable: Boolean(course),
      live: groupIsLive(store, group.id)
    };
  }

  // The seats a member who is not the Host can still take (QA final review
  // F-2): before the start one seat stays the Host's until the Host holds
  // one (the reservation in seat()), so "5/6" is already full for a member.
  // A session nobody can enter has none: not yet Starting Soon, ended, or a
  // waiting room past its planned end (QA r3 server 4, the B6 rule).
  function seatsOpen(store: StudyGroupStore, session: LiveSessionRow, state: EffectiveSessionState | "removed") {
    if (state === "completed" || state === "removed") return 0;
    const now = deps.now();
    if (!seatRenewable(session, now)) return 0;
    const seats = seatCount(store, session.id, now);
    const hostUserId = store.groups.find((item) => item.id === session.groupId)?.hostUserId;
    const reserved = state !== "live" && !store.presences.some((item) => item.sessionId === session.id && item.userId === hostUserId && seatHeld(item, now)) ? 1 : 0;
    return Math.max(0, session.maxParticipants - seats - reserved);
  }

  async function sessionView(store: StudyGroupStore, session: LiveSessionRow, actorUserId: string) {
    const state = effectiveSessionState(session, deps.now());
    if (state === "removed") throw new StudyGroupError("not_found", "Live Session was not found.");
    // PRD 6.6: View attendees shows the PLANNED attendees for an unstarted
    // Session and actual attendees once the Session is live or completed.
    // Starting Soon is still unstarted; entered waiting users count towards
    // occupancy (BR-033) but do not replace the planned list yet.
    const showActual = state === "live" || state === "completed";
    const people = showActual
      ? store.presences.filter((item) => item.sessionId === session.id && item.enteredAt && (state === "completed" || seatHeld(item, deps.now())))
      : store.intents.filter((item) => item.sessionId === session.id && !item.cancelledAt);
    const attendees = [];
    for (const person of people) {
      const profile = await deps.userProfile(person.userId);
      attendees.push({ userId: person.userId, displayName: profile?.displayName || person.userId });
    }
    return {
      id: session.id,
      groupId: session.groupId,
      title: session.title,
      relatedLessonId: session.relatedLessonId,
      startsAt: session.startsAt,
      durationSeconds: session.durationSeconds,
      maxParticipants: session.maxParticipants,
      focus: session.focus,
      aiTutorEnabled: session.aiTutorEnabled,
      startedAt: session.startedAt,
      state: state as EffectiveSessionState,
      occupancy: seatCount(store, session.id, deps.now()),
      seatsOpen: seatsOpen(store, session, state),
      // The viewer already holds a seat (a reload, a second tab): entering
      // again renews it, so a full session is still open to them (QA r3
      // groups 2).
      viewerSeated: store.presences.some((item) => item.sessionId === session.id && item.userId === actorUserId && seatHeld(item, deps.now())),
      plannedCount: plannedCount(store, session.id),
      viewerPlanned: store.intents.some((item) => item.sessionId === session.id && item.userId === actorUserId && !item.cancelledAt),
      attendees
    };
  }

  function requireOpenSession(store: StudyGroupStore, sessionId: string, actorUserId: string) {
    const session = store.sessions.find((item) => item.id === sessionId);
    if (!session || session.status === "removed") throw new StudyGroupError("not_found", "Live Session was not found.");
    const group = store.groups.find((item) => item.id === session.groupId && item.status === "active");
    if (!group) throw new StudyGroupError("not_found", "Study Group was not found.");
    const membership = activeMembership(store, group.id, actorUserId);
    if (!membership) throw new StudyGroupError("forbidden", "Join the Study Group first.");
    return { session, group, membership };
  }

  // One admission decision, made under the write lock. `inRoom` is the
  // provider's view of the room when the caller has already been sent to ask
  // for it (enterSession); undefined means nobody asked yet, and then a
  // caller who needs it gets `{ roomCheck }` back instead of a refusal.
  async function seat(input: { actorUserId: string; sessionId: string; requestedAt: string }, inRoom?: RoomRead | null): Promise<{ occupancy: number } | { roomCheck: LiveSessionRow }> {
    const snapshot = await deps.repository.read();
    const pending = snapshot.sessions.find((item) => item.id === input.sessionId);
    const allowed = pending ? await deps.hasCourseAccess(input.actorUserId, snapshot.groups.find((item) => item.id === pending.groupId)?.courseId || "") : false;
    if (!pending || !allowed) {
      if (!pending || pending.status === "removed") throw new StudyGroupError("not_found", "Live Session was not found.");
      throw new StudyGroupError("course_access_required", "Valid Course access is required.");
    }
    const outcome = await deps.repository.update<{ occupancy: number } | { notOpen: string } | { roomCheck: LiveSessionRow }>((store) => {
      const now = deps.now();
      const { session, group } = requireOpenSession(store, input.sessionId, input.actorUserId);
      const state = effectiveSessionState(session, now);
      if (state === "completed") throw new StudyGroupError("session_unavailable", "This Live Session has ended.");
      // Seats are leases (presence.ts): write down the lapsed ones first so
      // every count below, and the stored occupancy, is the real one.
      closeLapsedSeats(store, now, session.id);
      const existing = store.presences.find((item) => item.sessionId === session.id && item.userId === input.actorUserId);
      if (!seatRenewable(session, now)) {
        // A session that holds no seat now (moved back out of Starting Soon,
        // or a waiting room past its planned end) releases the caller's seat
        // (committed, then refused outside the write) instead of renewing it
        // (QA final review B6, X-2; r3 server 7c).
        if (existing && seatHeld(existing, now)) existing.leftAt = now.toISOString();
        return { notOpen: state === "scheduled" ? "The Live Session is not open yet." : "This Live Session was not started." };
      }
      let seats = seatCount(store, session.id, now);
      if (existing && seatHeld(existing, now)) {
        // Entering while already seated (a reload, a second tab): the same
        // seat, its lease renewed.
        existing.requestedAt = input.requestedAt;
        existing.lastSeenAt = now.toISOString();
        return { occupancy: seats };
      }
      if (missedUnstarted(session, now, seats)) throw new StudyGroupError("session_not_open", "This Live Session was not started.");
      if (seats >= session.maxParticipants) {
        // A full live room may be full of leases, not of people: a member
        // whose heartbeats failed lost the seat to someone who then could
        // never connect (the provider's room was full), and was refused on
        // coming back while still in the call (QA final review X-4). Only
        // such a member, whose own seat ran out, has the provider asked who
        // is really in the room, and never inside the entry queue (r3 X-4):
        // the caller asks and comes back with the answer.
        if (state === "live" && inRoom === undefined && existing && seatLapsed(existing, now) && providerCanList(session)) return { roomCheck: session };
        // The caller is in the provider's room: the seat goes back to them
        // from the newest holder who is not in it and entered before the
        // read. Anyone else, or any room the provider could not answer for,
        // finds the session full.
        const displaced = state === "live" && inRoom?.identities.has(input.actorUserId)
          ? store.presences
            .filter((item) => item.sessionId === session.id && item.userId !== input.actorUserId && seatHeld(item, now) && !inRoom.identities.has(item.userId) && (item.enteredAt ?? "") <= inRoom.readAt)
            .sort((left, right) => (right.enteredAt ?? "").localeCompare(left.enteredAt ?? ""))[0]
          : undefined;
        if (!displaced) throw new StudyGroupError("session_full", "Session Full.");
        displaced.leftAt = now.toISOString();
        seats -= 1;
      }
      // Before the start the Host's seat is reserved: members waiting may fill
      // every other seat, never the Host's, so the Host can always open their
      // own session (QA 2026-10-19 N7, owner decision).
      const hostSeated = store.presences.some((item) => item.sessionId === session.id && item.userId === group.hostUserId && seatHeld(item, now));
      if (state === "starting_soon" && input.actorUserId !== group.hostUserId && !hostSeated && seats >= session.maxParticipants - 1) {
        throw new StudyGroupError("session_full", "Session Full.");
      }
      const enteredAt = now.toISOString();
      if (existing) {
        existing.leftAt = null;
        existing.requestedAt = input.requestedAt;
        existing.enteredAt = enteredAt;
        existing.lastSeenAt = enteredAt;
        existing.phase = state === "live" ? "live" : "waiting";
        existing.liveKitParticipantSid = null;
      } else {
        store.presences.push({
          id: randomUUID(),
          sessionId: session.id,
          userId: input.actorUserId,
          requestedAt: input.requestedAt,
          enteredAt,
          lastSeenAt: enteredAt,
          leftAt: null,
          phase: state === "live" ? "live" : "waiting",
          liveKitParticipantSid: null
        });
      }
      return { occupancy: seats + 1 };
    });
    if ("notOpen" in outcome) throw new StudyGroupError("session_not_open", outcome.notOpen);
    return outcome;
  }

  // Entry: admissions run one at a time in receipt order (the entry queue),
  // and nothing slow runs inside it. The provider read X-4 needs happens
  // between two turns in the queue, for that caller only.
  async function enterSession(input: { actorUserId: string; sessionId: string; requestedAt: string }) {
    let outcome = await enqueueEntry(input.requestedAt, () => seat(input));
    if ("roomCheck" in outcome) {
      const inRoom = await sharedRoomRead(outcome.roomCheck);
      outcome = await enqueueEntry(input.requestedAt, () => seat(input, inRoom));
    }
    if ("roomCheck" in outcome) throw new StudyGroupError("session_full", "Session Full.");
    return outcome;
  }

  // Design §3.2 "Session project assignment": the durable first-wins
  // assignment is written BEFORE any provider call, so a crashed or racing
  // start can never pick a different project. `credential_unavailable` and
  // `unauthorized` are definitive (no room can exist on that project), so the
  // assignment may CAS-advance to the next candidate; `unreachable`,
  // `rate_limited` and `unverified` are ambiguous, pin the assignment, and
  // surface `unavailable` for a retry against the same project.
  async function provisionProject(current: LiveSessionRow, projects: LiveKitProjectRegistry, gateway: LiveKitRoomGateway) {
    const activeProjectCount = projects.diagnostics().filter((project) => project.state === "active").length;
    const excluded = new Set<string>();
    let pinned: string | null = current.liveKitProjectId;
    for (let attempt = 0; attempt < activeProjectCount; attempt += 1) {
      if (!pinned && excluded.size >= activeProjectCount) break;
      const candidateId = pinned ?? projects.selectForNewSession({ sessionId: current.id, excludeProjectIds: excluded }).id;
      const assigned = await deps.repository.update((store) => {
        const row = store.sessions.find((item) => item.id === current.id);
        if (!row || row.status === "removed") throw new StudyGroupError("not_found", "Live Session was not found.");
        row.liveKitProjectId ??= candidateId;
        return row.liveKitProjectId ?? candidateId;
      });
      try {
        await gateway.ensureRoom({ project: projects.getAssigned(assigned), room: current.id, maxParticipants: current.maxParticipants });
        return assigned;
      } catch (error) {
        if (!(error instanceof LiveKitGatewayError)) throw error;
        emitLiveKitIncident({
          sessionId: current.id,
          projectId: assigned,
          code: classifyLiveKitIncident({ source: "gateway", code: error.code, phase: pinned ? "existing_room" : "new_room" }).code,
          source: "gateway"
        });
        if (error.code !== "credential_unavailable" && error.code !== "unauthorized") {
          // A room may exist on this project. Keep the durable assignment so a
          // retry provisions against the same project.
          throw liveKitFailure(error, "LiveKit cannot create this room right now.");
        }
        await deps.repository.update((store) => {
          const row = store.sessions.find((item) => item.id === current.id);
          if (row && row.liveKitProjectId === assigned) row.liveKitProjectId = null;
        });
        excluded.add(assigned);
        pinned = null;
      }
    }
    throw new StudyGroupError("unavailable", "No LiveKit project can create this room right now.");
  }

  async function dispatchDueReminders(snapshot?: StudyGroupStore) {
    const now = deps.now();
    const dueJobs = (store: StudyGroupStore, record: boolean) => {
      const jobs: Array<{ userId: string; sessionId: string; sessionTitle: string; groupTitle: string; startsAt: string }> = [];
      for (const session of store.sessions) {
        if (session.status !== "scheduled") continue;
        const startsAt = new Date(session.startsAt).getTime();
        if (now.getTime() < startsAt - STARTING_SOON_MS || now.getTime() >= startsAt) continue;
        const group = store.groups.find((item) => item.id === session.groupId && item.status === "active");
        if (!group) continue;
        const audience = new Set<string>([group.hostUserId]);
        for (const intent of store.intents) {
          if (intent.sessionId === session.id && !intent.cancelledAt) audience.add(intent.userId);
        }
        for (const userId of audience) {
          if (!activeMembership(store, group.id, userId)) continue;
          // One reminder per Start Time, not per Session (QA 2026-10-19 N9):
          // a reminder sent before the current reminder window belongs to a
          // Start Time the Host has since moved, so the new time gets its
          // own. The row is reused (one row per user and session, UNIQUE in
          // PostgreSQL), its sentAt moved to this send.
          const existing = store.reminders.find((item) => item.sessionId === session.id && item.userId === userId);
          if (existing && Date.parse(existing.sentAt) >= startsAt - STARTING_SOON_MS) continue;
          if (record) {
            if (existing) existing.sentAt = now.toISOString();
            else store.reminders.push({ id: randomUUID(), sessionId: session.id, userId, sentAt: now.toISOString() });
          }
          jobs.push({ userId, sessionId: session.id, sessionTitle: session.title, groupTitle: group.title, startsAt: session.startsAt });
        }
      }
      return jobs;
    };
    if (dueJobs(snapshot ?? await deps.repository.read(), false).length === 0) return;
    const due = await deps.repository.update((store) => dueJobs(store, true));
    for (const job of due) {
      // One recipient's failure must not cost the rest their reminder, nor
      // fail the page poll that triggered the dispatch (QA M11).
      try {
        const profile = await deps.userProfile(job.userId);
        // The row title is localised at write time and doubles as the reminders
        // view's marker (hunt L1): the en-GB title must stay exactly this
        // string — the view filters on the known per-locale titles — and the
        // zh-CN title is its Chinese counterpart. Both match the email subject.
        // The body names the group and the minutes really left (QA M10-a): a
        // reminder sent again after a reschedule rarely lands at T-10.
        const minutes = Math.max(1, Math.ceil((Date.parse(job.startsAt) - now.getTime()) / 60_000));
        const copy = profile?.locale === "zh-CN"
          ? { title: "直播课提醒", body: `学习小组“${job.groupTitle}”的 ${job.sessionTitle} 将在 ${minutes} 分钟后开始。` }
          : { title: "Live Session reminder", body: `${job.sessionTitle} in the Study Group "${job.groupTitle}" starts in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.` };
        await deps.notify({ userId: job.userId, title: copy.title, body: copy.body, sessionId: job.sessionId });
        if (profile?.email) await deps.sendMail({ to: profile.email, subject: copy.title, text: copy.body, locale: profile.locale });
      } catch {
        // Best-effort per recipient; the reminder row is already written.
      }
    }
  }

  // A moved Start Time (QA 2026-10-19 N9): the reminder for the old time is
  // withdrawn, the session's reminder rows are reset so the dispatch sends a
  // fresh one for the new time, and every member who planned to attend is
  // told. Resetting after the withdrawal matters: a reminder for the new time
  // sent before the withdrawal (or within ten minutes of the old one) would
  // otherwise count as already sent and never come again (final review
  // N9-a, N9-b). Best-effort throughout: the move itself has already been saved.
  async function announceReschedule(session: { id: string; title: string; planned: string[] }) {
    await deps.withdrawReminders?.({ sessionIds: [session.id] })?.catch(() => undefined);
    await deps.repository.update((store) => {
      for (const row of store.reminders) {
        if (row.sessionId === session.id) row.sentAt = new Date(0).toISOString();
      }
    }).catch(() => undefined);
    await dispatchDueReminders().catch(() => undefined);
    for (const userId of session.planned) {
      try {
        const profile = await deps.userProfile(userId);
        const copy = profile?.locale === "zh-CN"
          ? { title: "直播课时间已更改", body: `${session.title} 的开始时间已更改，请到学习小组查看新的时间。` }
          : { title: "Live Session rescheduled", body: `The Start Time of ${session.title} has changed. Open the Study Group to see the new time.` };
        await deps.notify({ userId, title: copy.title, body: copy.body });
        if (profile?.email) await deps.sendMail({ to: profile.email, subject: copy.title, text: copy.body, locale: profile.locale });
      } catch {
        // One recipient's failure never blocks the others.
      }
    }
  }

  // The LiveKit identities in a live session's room, or null when the
  // provider cannot say: no provider-verified reader (the cloud gateway has
  // listParticipants only when verified), no assigned project, or a read that
  // failed or timed out.
  function providerCanList(session: LiveSessionRow) {
    return Boolean(deps.liveKitGateway?.listParticipants && deps.liveKitProjects && session.liveKitProjectId);
  }

  async function providerParticipants(session: LiveSessionRow): Promise<RoomRead | null> {
    const gateway = deps.liveKitGateway;
    if (!gateway?.listParticipants || !deps.liveKitProjects || !session.liveKitProjectId) return null;
    try {
      const readAt = deps.now().toISOString();
      const project = deps.liveKitProjects.getAssigned(session.liveKitProjectId);
      const participants = await withTimeout(gateway.listParticipants({ project, room: session.id }), PROVIDER_ROOM_CHECK_TIMEOUT_MS);
      return { identities: new Set(participants.map((item) => item.identity)), readAt };
    } catch {
      return null;
    }
  }

  // The entries' read of one room: concurrent callers share one provider
  // call, and its answer (or its failure) is reused for a few seconds.
  function sharedRoomRead(session: LiveSessionRow) {
    const nowMs = deps.now().getTime();
    for (const [roomId, entry] of roomReads) {
      if (nowMs - entry.at >= PROVIDER_ROOM_READ_REUSE_MS) roomReads.delete(roomId);
    }
    const reused = roomReads.get(session.id);
    if (reused) return reused.read;
    const read = providerParticipants(session);
    roomReads.set(session.id, { at: nowMs, read });
    return read;
  }

  // Ending an empty live session is destructive and cannot be undone: the
  // room's clients see "completed" and disconnect. When every heartbeat fails
  // at once (a deploy, a stalled store, a WAF rule) the seats lapse while the
  // call goes on, so before ending one the provider is asked whether its room
  // is really empty (QA final review X-3). Only members of the room's Study
  // Group count; anyone else still connected (a member who left the group,
  // with a token that has not expired) is removed, not counted (r3 server 3).
  // At most a few rooms are asked per sweep, the longest-unasked first; a
  // room not asked this time is kept for a later sweep (r3 server 2). Only a
  // room the provider reported empty, or could not answer for, is ended.
  async function roomsStillOccupied(store: StudyGroupStore, now: Date) {
    const kept = new Set<string>();
    if (!deps.liveKitGateway?.listParticipants) return kept;
    const candidates = abandonedLiveSessions(store, now);
    const live = new Set(candidates.map((session) => session.id));
    for (const roomId of roomCheckedAt.keys()) {
      if (!live.has(roomId)) roomCheckedAt.delete(roomId);
    }
    candidates.sort((left, right) => (roomCheckedAt.get(left.id) ?? -Infinity) - (roomCheckedAt.get(right.id) ?? -Infinity) || left.id.localeCompare(right.id));
    const asked = candidates.slice(0, PROVIDER_ROOM_CHECKS_PER_SWEEP);
    const deferred = candidates.slice(PROVIDER_ROOM_CHECKS_PER_SWEEP);
    let occupied = 0;
    await Promise.all(asked.map(async (session) => {
      roomCheckedAt.set(session.id, now.getTime());
      const read = await providerParticipants(session);
      if (!read) return;
      const groupId = session.groupId;
      const strays = [...read.identities].filter((identity) => !activeMembership(store, groupId, identity));
      if (read.identities.size > strays.length) {
        kept.add(session.id);
        occupied += 1;
      }
      await removeFromRoom(session, strays);
    }));
    for (const session of deferred) kept.add(session.id);
    if (occupied > 0) deps.operationalLog?.({ type: "study_group.empty_live_kept", reason: "provider_participants", count: occupied });
    if (deferred.length > 0) deps.operationalLog?.({ type: "study_group.empty_live_kept", reason: "check_deferred", count: deferred.length });
    return kept;
  }

  // Disconnects these identities from a live room. Best effort, bounded per
  // identity: an identity the provider no longer has is simply not found.
  async function removeFromRoom(session: { id: string; liveKitProjectId: string | null }, identities: string[]) {
    const gateway = deps.liveKitGateway;
    const projects = deps.liveKitProjects;
    const projectId = session.liveKitProjectId;
    if (!gateway || !projects || !projectId || identities.length === 0) return;
    await Promise.all(identities.map(async (identity) => {
      try {
        await withTimeout(gateway.removeParticipant({ project: projects.getAssigned(projectId), room: session.id, identity }), PROVIDER_ROOM_CHECK_TIMEOUT_MS);
      } catch {
        // Not in that room, or the provider is unavailable: nothing to undo.
      }
    }));
  }

  // The server sweep (runtime timer and the throttled request path): writes
  // down lapsed seats and ends live sessions nobody has held a seat in for
  // the grace period. Reads first so an idle tick never takes the write lock.
  async function sweepPresence(snapshot?: StudyGroupStore) {
    const now = deps.now();
    const pending = (store: StudyGroupStore) => store.presences.some((item) => item.enteredAt && !item.leftAt && !seatHeld(item, now))
      || store.sessions.some((session) => session.status === "live" && seatCount(store, session.id, now) === 0);
    const store = snapshot ?? await deps.repository.read();
    if (!pending(store)) return { seatsClosed: 0, sessionsEnded: 0 };
    const keepLive = await roomsStillOccupied(store, now);
    return deps.repository.update((current) => sweepSeats(current, deps.now(), keepLive));
  }

  // The portal's view routes call this on every poll. A sweep reads the whole
  // store, so polling must not turn into a per-request scan (hunt L5): at most
  // one sweep per window, never two sweeps in flight, and a request inside
  // the window is skipped without touching the store at all. The unthrottled
  // dispatchDueReminders stays the runtime timer's, the worker's and the
  // tests' entry point, so reminder delivery never depends on this path.
  const REQUEST_DISPATCH_INTERVAL_MS = 30_000;
  let requestDispatchAt = Number.NEGATIVE_INFINITY;
  let requestDispatchRunning = false;
  async function dispatchDueRemindersOnRequest() {
    if (requestDispatchRunning) return;
    const timestamp = deps.now().getTime();
    if (timestamp - requestDispatchAt < REQUEST_DISPATCH_INTERVAL_MS) return;
    requestDispatchRunning = true;
    requestDispatchAt = timestamp;
    try {
      // The poll that reads the lists also keeps seats and live sessions
      // honest on an instance whose timers are not running. Both checks run
      // on one snapshot, so an idle request still costs a single store read.
      const snapshot = await deps.repository.read();
      await sweepPresence(snapshot).catch(() => undefined);
      await dispatchDueReminders(snapshot);
    } finally {
      requestDispatchRunning = false;
    }
  }

  // The group's Live Sessions in a fixed order (QA 2026-10-19 N11): live
  // first, then the ones still to come soonest first, then the ended and the
  // never-started ones latest first.
  function sortSessions<T extends { id: string; state: EffectiveSessionState; startsAt: string; occupancy: number; durationSeconds: number }>(sessions: T[]) {
    const now = deps.now();
    const rank = (session: T) => {
      if (session.state === "live") return 0;
      if (session.state === "completed" || missedUnstarted({ status: "scheduled", startsAt: session.startsAt, durationSeconds: session.durationSeconds }, now, session.occupancy)) return 2;
      return 1;
    };
    return [...sessions].sort((a, b) => {
      const byRank = rank(a) - rank(b);
      if (byRank) return byRank;
      const byTime = rank(a) === 2 ? b.startsAt.localeCompare(a.startsAt) : a.startsAt.localeCompare(b.startsAt);
      return byTime || a.id.localeCompare(b.id);
    });
  }

  return {
    async createGroup(input: { actorUserId: string; title: string; courseId: string; about: string }) {
      const title = requireText(input.title, "Study Group Title", 50);
      const about = requireText(input.about, "About this Study Group", 200);
      const courseId = clean(input.courseId || "");
      if (!courseId) throw new StudyGroupError("validation", "Related Course is required.");
      if (!await deps.hasCourseAccess(input.actorUserId, courseId)) {
        throw new StudyGroupError("course_access_required", "Valid Course access is required.");
      }
      const course = await deps.courseSummary(courseId);
      if (!course) throw new StudyGroupError("validation", "Related Course is required.");
      const now = deps.now().toISOString();
      const group = await deps.repository.update((store) => {
        const duplicate = store.groups.find((item) => item.status === "active" && item.hostUserId === input.actorUserId && item.title === title && item.courseId === courseId && item.about === about && sameSubmitWindow(item.createdAt, now));
        if (duplicate) return duplicate;
        const row: StudyGroupRow = {
          id: randomUUID(),
          title,
          courseId,
          about,
          hostUserId: input.actorUserId,
          status: "active",
          createdAt: now,
          updatedAt: now
        };
        store.groups.push(row);
        store.memberships.push({
          id: randomUUID(),
          groupId: row.id,
          userId: input.actorUserId,
          role: "host",
          joinedAt: now,
          leftAt: null
        });
        return row;
      });
      return toView(group, await deps.repository.read(), 1, "host");
    },

    async listMine(actorUserId: string) {
      const store = await deps.repository.read();
      const views: GroupView[] = [];
      const joinedAt = new Map<string, string>();
      const courseSummary = courseSummaries();
      for (const membership of store.memberships.filter((item) => item.userId === actorUserId && !item.leftAt)) {
        const group = store.groups.find((item) => item.id === membership.groupId && item.status === "active");
        if (!group) continue;
        const memberCount = store.memberships.filter((item) => item.groupId === group.id && !item.leftAt).length;
        joinedAt.set(group.id, membership.joinedAt);
        views.push(await toView(group, store, memberCount, membership.role, courseSummary));
      }
      // BUG-0120 (SIT): the sidebar used to render in membership insertion order (oldest
      // first), so a just-created Study Group appeared at the very bottom of the list.
      // Newest group first, falling back to the newer membership on equal creation stamps.
      views.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || (joinedAt.get(b.id) || "").localeCompare(joinedAt.get(a.id) || ""));
      return views;
    },

    async getGroup(input: { actorUserId: string | null; groupId: string }) {
      const store = await deps.repository.read();
      const group = store.groups.find((item) => item.id === input.groupId && item.status === "active");
      if (!group) throw new StudyGroupError("not_found", "Study Group was not found.");
      const active = store.memberships.filter((item) => item.groupId === group.id && !item.leftAt);
      const mine = active.find((item) => item.userId === input.actorUserId) || null;
      const members = [];
      for (const membership of active) {
        const profile = await deps.userProfile(membership.userId);
        members.push({ userId: membership.userId, displayName: profile?.displayName || membership.userId, role: membership.role });
      }
      const view = await toView(group, store, active.length, mine?.role || null);
      const sessions = mine ? sortSessions(await Promise.all(store.sessions.filter((item) => item.groupId === group.id && item.status !== "removed").map((item) => sessionView(store, item, input.actorUserId || "")))) : null;
      const canJoin = !mine && Boolean(input.actorUserId) && await deps.hasCourseAccess(input.actorUserId || "", group.courseId);
      const lessons = deps.courseLessons ? await deps.courseLessons(group.courseId) : [];
      return { ...view, members, sessions, canJoin, lessons };
    },

    async joinGroup(input: { actorUserId: string; groupId: string }) {
      const store = await deps.repository.read();
      const group = store.groups.find((item) => item.id === input.groupId && item.status === "active");
      if (!group) throw new StudyGroupError("not_found", "Study Group was not found.");
      if (!await deps.hasCourseAccess(input.actorUserId, group.courseId)) {
        throw new StudyGroupError("course_access_required", "Valid Course access is required.");
      }
      const now = deps.now().toISOString();
      const memberCount = await deps.repository.update((current) => {
        const existing = current.memberships.find((item) => item.groupId === input.groupId && item.userId === input.actorUserId);
        if (existing && !existing.leftAt) return current.memberships.filter((item) => item.groupId === input.groupId && !item.leftAt).length;
        if (existing) {
          existing.leftAt = null;
          existing.joinedAt = now;
          existing.role = "member";
        } else {
          current.memberships.push({ id: randomUUID(), groupId: input.groupId, userId: input.actorUserId, role: "member", joinedAt: now, leftAt: null });
        }
        return current.memberships.filter((item) => item.groupId === input.groupId && !item.leftAt).length;
      });
      return { ...(await toView(group, await deps.repository.read(), memberCount, "member")), role: "member" as const, memberCount };
    },

    async leaveGroup(input: { actorUserId: string; groupId: string }) {
      const store = await deps.repository.read();
      const group = store.groups.find((item) => item.id === input.groupId && item.status === "active");
      if (!group) throw new StudyGroupError("not_found", "Study Group was not found.");
      const membership = store.memberships.find((item) => item.groupId === input.groupId && item.userId === input.actorUserId && !item.leftAt);
      if (!membership) throw new StudyGroupError("forbidden", "Join the Study Group first.");
      if (membership.role === "host") throw new StudyGroupError("forbidden", "The Host cancels the Study Group instead of leaving it.");
      const now = deps.now().toISOString();
      const { sessionIds, liveRooms } = await deps.repository.update((current) => {
        const row = current.memberships.find((item) => item.groupId === input.groupId && item.userId === input.actorUserId && !item.leftAt);
        if (row) row.leftAt = now;
        const liveRooms = current.sessions
          .filter((item) => item.groupId === input.groupId && item.status === "live" && item.liveKitProjectId)
          .map((item) => ({ id: item.id, projectId: item.liveKitProjectId! }));
        const sessionIds = new Set(current.sessions.filter((item) => item.groupId === input.groupId && item.status === "scheduled").map((item) => item.id));
        for (const intent of current.intents) {
          if (intent.userId === input.actorUserId && sessionIds.has(intent.sessionId) && !intent.cancelledAt) intent.cancelledAt = now;
        }
        // Leaving the Study Group releases the member's seats like an explicit
        // Leave Session: a live session whose last seat this was ends now.
        const at = new Date(now);
        closeLapsedSeats(current, at);
        for (const presence of current.presences) {
          if (presence.userId !== input.actorUserId || presence.leftAt || !presence.enteredAt) continue;
          const session = current.sessions.find((item) => item.id === presence.sessionId && item.groupId === input.groupId);
          if (!session || session.status === "completed" || session.status === "removed") continue;
          presence.leftAt = now;
          endLiveSessionIfEmpty(current, session, at);
        }
        return { sessionIds: current.sessions.filter((item) => item.groupId === input.groupId).map((item) => item.id), liveRooms };
      });
      // Leaving drops the member's pending Plan-to-Attend reminders (BR-023):
      // withdraw their reminder rows for this group's Sessions only.
      await deps.withdrawReminders?.({ sessionIds, userId: input.actorUserId })?.catch(() => undefined);
      // A member who left the group is out of its live rooms too, including
      // a room open in another tab, which could otherwise go on talking and
      // watching (QA M17). Best effort, bounded per room: the leave is saved,
      // and a member not in the room is simply not found by the provider.
      await Promise.all(liveRooms.map((room) => removeFromRoom({ id: room.id, liveKitProjectId: room.projectId }, [input.actorUserId])));
    },

    async listDiscover(input: { actorUserId: string | null; courseId?: string; query?: string }) {
      const store = await deps.repository.read();
      const joined = new Set(store.memberships.filter((item) => item.userId === input.actorUserId && !item.leftAt).map((item) => item.groupId));
      const needle = clean(input.query || "").toLowerCase();
      const views: GroupView[] = [];
      const courseSummary = courseSummaries();
      for (const group of store.groups) {
        if (group.status !== "active" || joined.has(group.id)) continue;
        if (input.courseId && group.courseId !== input.courseId) continue;
        const course = await courseSummary(group.courseId);
        // A group whose Course is no longer available cannot be joined (QA M7).
        if (!course) continue;
        const haystack = `${group.title} ${group.about} ${course?.title || ""}`.toLowerCase();
        if (needle && !haystack.includes(needle)) continue;
        const memberCount = store.memberships.filter((item) => item.groupId === group.id && !item.leftAt).length;
        views.push(await toView(group, store, memberCount, null, courseSummary));
      }
      // Newest first, like the My list (QA 2026-10-19 N11): the store's row
      // order is not an order (PostgreSQL returns rows in any order).
      views.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
      return views;
    },

    async editGroup(input: { actorUserId: string; groupId: string; title: string; about: string; courseId?: string }) {
      const title = requireText(input.title, "Study Group Title", 50);
      const about = requireText(input.about, "About this Study Group", 200);
      const now = deps.now().toISOString();
      const group = await deps.repository.update((store) => {
        const row = store.groups.find((item) => item.id === input.groupId && item.status === "active");
        if (!row) throw new StudyGroupError("not_found", "Study Group was not found.");
        const membership = activeMembership(store, row.id, input.actorUserId);
        if (membership?.role !== "host") throw new StudyGroupError("forbidden", "Only the Host can edit the Study Group.");
        if (input.courseId && input.courseId !== row.courseId) throw new StudyGroupError("conflict", "Related Course cannot be changed.");
        row.title = title;
        row.about = about;
        row.updatedAt = now;
        return row;
      });
      const store = await deps.repository.read();
      const memberCount = store.memberships.filter((item) => item.groupId === group.id && !item.leftAt).length;
      return toView(group, store, memberCount, "host");
    },

    async cancelGroup(input: { actorUserId: string; groupId: string }) {
      const now = deps.now().toISOString();
      const { title, notified, sessionIds } = await deps.repository.update((store) => {
        const row = store.groups.find((item) => item.id === input.groupId && item.status === "active");
        if (!row) throw new StudyGroupError("not_found", "Study Group was not found.");
        if (activeMembership(store, row.id, input.actorUserId)?.role !== "host") throw new StudyGroupError("forbidden", "Only the Host can cancel the Study Group.");
        row.status = "cancelled";
        row.updatedAt = now;
        for (const session of store.sessions) {
          if (session.groupId !== row.id) continue;
          if (session.status === "scheduled") {
            session.status = "removed";
            session.updatedAt = now;
          }
          if (session.status === "live") {
            completeSession(store, session, now);
            for (const presence of store.presences) {
              if (presence.sessionId === session.id && presence.enteredAt && !presence.leftAt) presence.leftAt = now;
            }
          }
        }
        return {
          title: row.title,
          // PRD: the members are told; the Host who cancelled is not.
          notified: store.memberships.filter((item) => item.groupId === row.id && !item.leftAt && item.userId !== row.hostUserId).map((item) => item.userId),
          sessionIds: store.sessions.filter((item) => item.groupId === row.id).map((item) => item.id)
        };
      });
      // The cancelled group's pending reminders die with it (storage honesty);
      // the members' in-site cancellation notices below are kept. Like every
      // withdrawal, best effort: the cancel is already saved, and a failed
      // withdrawal must neither fail it nor skip the notices (QA M11-a); the
      // reminders view's validity filter hides what is left behind.
      await deps.withdrawReminders?.({ sessionIds })?.catch(() => undefined);
      // Best-effort per member (QA M11): the group is already cancelled, so a
      // failed notice must not report the cancel itself as failed.
      await Promise.all(notified.map(async (userId) => {
        try {
          const profile = await deps.userProfile(userId);
          // Title and body share the recipient's locale (hunt L1): the body was
          // already localised while the title stayed hard-coded English, so a
          // zh-CN member got a mixed-language card.
          const copy = profile?.locale === "zh-CN"
            ? { title: "学习小组已取消", body: `学习小组“${title}”已被取消。` }
            : { title: "Study Group cancelled", body: `The Study Group "${title}" has been cancelled.` };
          await deps.notify({ userId, title: copy.title, body: copy.body });
        } catch {
          // One member's failed notice never blocks the others.
        }
      }));
    },

    async scheduleSession(input: { actorUserId: string; groupId: string; title: string; startsAt: string; durationSeconds: number; maxParticipants: number; relatedLessonId?: string | null; focus?: string | null; aiTutorEnabled?: boolean }) {
      // Owner ruling 2026-10-15 (BUG-0128): Session Title allows 50 characters (the Study
      // Group Title / Session Focus limit), mirrored by SESSION_TITLE_MAX in the client.
      const title = requireText(input.title, "Session Title", 50);
      const startsAt = new Date(input.startsAt);
      if (Number.isNaN(startsAt.getTime())) throw new StudyGroupError("validation", "Start Time is required.");
      if (startsAt.getTime() <= deps.now().getTime()) throw new StudyGroupError("start_in_past", "Start Time must be in the future.");
      if (!SESSION_DURATION_SECONDS.includes(input.durationSeconds as (typeof SESSION_DURATION_SECONDS)[number])) throw new StudyGroupError("validation", "Duration is required.");
      if (!Number.isInteger(input.maxParticipants) || input.maxParticipants < 2 || input.maxParticipants > 6) throw new StudyGroupError("validation", "Maximum Participants must be from 2 to 6.");
      const focus = clean(input.focus || "");
      if (focus.length > 50) throw new StudyGroupError("validation", "Session Focus is too long.");
      const relatedLessonId = clean(input.relatedLessonId || "") || null;
      const aiTutorEnabled = input.aiTutorEnabled !== false;
      const now = deps.now().toISOString();
      const session = await deps.repository.update((store) => {
        const group = store.groups.find((item) => item.id === input.groupId && item.status === "active");
        if (!group) throw new StudyGroupError("not_found", "Study Group was not found.");
        if (activeMembership(store, group.id, input.actorUserId)?.role !== "host") throw new StudyGroupError("forbidden", "Only the Host can schedule a Live Session.");
        // A duplicate is the same request again: every field the Host chose
        // matches, so a second session that differs only in its Focus, lesson
        // or AI Tutor switch is a new session (QA final review F-5).
        const duplicate = store.sessions.find((item) => item.groupId === group.id && item.status === "scheduled" && item.title === title && item.startsAt === startsAt.toISOString() && item.durationSeconds === input.durationSeconds && item.maxParticipants === input.maxParticipants
          && (item.focus || null) === (focus || null) && (item.relatedLessonId || null) === relatedLessonId && item.aiTutorEnabled === aiTutorEnabled && sameSubmitWindow(item.createdAt, now));
        if (duplicate) return duplicate;
        const row: LiveSessionRow = {
          id: randomUUID(),
          groupId: group.id,
          title,
          relatedLessonId,
          startsAt: startsAt.toISOString(),
          durationSeconds: input.durationSeconds,
          maxParticipants: input.maxParticipants,
          focus: focus || null,
          aiTutorEnabled,
          liveKitProjectId: null,
          status: "scheduled",
          startedAt: null,
          completedAt: null,
          createdAt: now,
          updatedAt: now
        };
        store.sessions.push(row);
        return row;
      });
      return sessionView(await deps.repository.read(), session, input.actorUserId);
    },

    async editSession(input: { actorUserId: string; groupId: string; sessionId: string; title?: string; relatedLessonId?: string | null; startsAt?: string; durationSeconds?: number; maxParticipants?: number; focus?: string | null; aiTutorEnabled?: boolean }) {
      if (input.title !== undefined) requireText(input.title, "Session Title", 50);
      if (input.startsAt !== undefined && Number.isNaN(new Date(input.startsAt).getTime())) throw new StudyGroupError("validation", "Start Time is required.");
      if (input.startsAt !== undefined && new Date(input.startsAt).getTime() <= deps.now().getTime()) throw new StudyGroupError("start_in_past", "Start Time must be in the future.");
      if (input.durationSeconds !== undefined && !SESSION_DURATION_SECONDS.includes(input.durationSeconds as (typeof SESSION_DURATION_SECONDS)[number])) throw new StudyGroupError("validation", "Duration is required.");
      if (input.maxParticipants !== undefined && (!Number.isInteger(input.maxParticipants) || input.maxParticipants < 2 || input.maxParticipants > 6)) throw new StudyGroupError("validation", "Maximum Participants must be from 2 to 6.");
      let focus: string | null | undefined;
      if (input.focus !== undefined) {
        focus = clean(input.focus || "");
        if (focus.length > 50) throw new StudyGroupError("validation", "Session Focus is too long.");
        focus = focus || null;
      }
      const now = deps.now().toISOString();
      const session = await deps.repository.update((store) => {
        const current = store.sessions.find((item) => item.id === input.sessionId && item.groupId === input.groupId);
        if (!current || current.status === "removed") throw new StudyGroupError("not_found", "Live Session was not found.");
        if (activeMembership(store, current.groupId, input.actorUserId)?.role !== "host") throw new StudyGroupError("forbidden", "Only the Host can edit a Live Session.");
        if (current.status !== "scheduled") throw new StudyGroupError("forbidden", "Edit Session is available only before the Session starts.");
        // An upcoming Session keeps everything people planned around; only its
        // Start Time can move (BUG-0157). Resending an unchanged value is fine.
        const changesOtherThanTime =
          (input.title !== undefined && requireText(input.title, "Session Title", 50) !== current.title) ||
          (input.relatedLessonId !== undefined && (clean(input.relatedLessonId || "") || null) !== (current.relatedLessonId || null)) ||
          (input.durationSeconds !== undefined && input.durationSeconds !== current.durationSeconds) ||
          (input.maxParticipants !== undefined && input.maxParticipants !== current.maxParticipants) ||
          (focus !== undefined && focus !== (current.focus || null)) ||
          (input.aiTutorEnabled !== undefined && input.aiTutorEnabled !== current.aiTutorEnabled);
        if (changesOtherThanTime) throw new StudyGroupError("session_time_only", "Only the Start Time of an upcoming Live Session can be changed.");
        const previousStartsAt = current.startsAt;
        if (input.startsAt !== undefined) current.startsAt = new Date(input.startsAt).toISOString();
        current.updatedAt = now;
        const group = store.groups.find((item) => item.id === current.groupId);
        const planned = store.intents.filter((item) => item.sessionId === current.id && !item.cancelledAt && item.userId !== group?.hostUserId).map((item) => item.userId);
        return { ...current, moved: current.startsAt !== previousStartsAt, planned };
      });
      if (session.moved) await announceReschedule(session);
      return sessionView(await deps.repository.read(), session, input.actorUserId);
    },

    async cancelSession(input: { actorUserId: string; sessionId: string }) {
      const now = deps.now().toISOString();
      await deps.repository.update((store) => {
        const current = store.sessions.find((item) => item.id === input.sessionId);
        if (!current || current.status === "removed") throw new StudyGroupError("not_found", "Live Session was not found.");
        if (activeMembership(store, current.groupId, input.actorUserId)?.role !== "host") throw new StudyGroupError("forbidden", "Only the Host can cancel a Live Session.");
        if (current.status !== "scheduled") throw new StudyGroupError("forbidden", "Cancel Session is available only before the Session starts.");
        current.status = "removed";
        current.updatedAt = now;
        for (const presence of store.presences) {
          if (presence.sessionId === current.id && presence.enteredAt && !presence.leftAt) presence.leftAt = now;
        }
      });
      // The cancelled Session can start no more, so its pending reminders are
      // withdrawn for every audience member (BUG-0109 storage honesty).
      await deps.withdrawReminders?.({ sessionIds: [input.sessionId] })?.catch(() => undefined);
    },

    async getSession(input: { actorUserId: string; sessionId: string }) {
      const store = await deps.repository.read();
      const session = store.sessions.find((item) => item.id === input.sessionId);
      if (!session || session.status === "removed") throw new StudyGroupError("not_found", "Live Session was not found.");
      const group = store.groups.find((item) => item.id === session.groupId);
      if (!group || !activeMembership(store, group.id, input.actorUserId)) throw new StudyGroupError(group ? "forbidden" : "not_found", group ? "Join the Study Group first." : "Study Group was not found.");
      if (group.status !== "active" && session.status !== "completed") throw new StudyGroupError("not_found", "Study Group was not found.");
      return sessionView(store, session, input.actorUserId);
    },

    async planToAttend(input: { actorUserId: string; sessionId: string }) {
      const now = deps.now().toISOString();
      await deps.repository.update((store) => {
        const { session } = requireOpenSession(store, input.sessionId, input.actorUserId);
        if (session.status !== "scheduled") throw new StudyGroupError("forbidden", "Plan to Attend is only for an unstarted Session.");
        const existing = store.intents.find((item) => item.sessionId === session.id && item.userId === input.actorUserId);
        if (existing && !existing.cancelledAt) return;
        if (existing) {
          existing.cancelledAt = null;
          existing.plannedAt = now;
          return;
        }
        const row: AttendanceIntentRow = { id: randomUUID(), sessionId: session.id, userId: input.actorUserId, plannedAt: now, cancelledAt: null };
        store.intents.push(row);
      });
    },

    async cancelAttendance(input: { actorUserId: string; sessionId: string }) {
      const now = deps.now().toISOString();
      const cancelled = await deps.repository.update((store) => {
        requireOpenSession(store, input.sessionId, input.actorUserId);
        const existing = store.intents.find((item) => item.sessionId === input.sessionId && item.userId === input.actorUserId && !item.cancelledAt);
        if (existing) existing.cancelledAt = now;
        return Boolean(existing);
      });
      // Cancelling attendance removes the member's reminder (BR-019): withdraw
      // the pending row the member's Plan to Attend produced. Only an actual
      // cancellation withdraws — a no-op cancel must not touch a reminder that
      // belongs to another audience reason (e.g. the Host's).
      if (cancelled) await deps.withdrawReminders?.({ sessionIds: [input.sessionId], userId: input.actorUserId })?.catch(() => undefined);
    },

    enterSession,

    startSession(input: { actorUserId: string; sessionId: string }) {
      // Single-flight is scoped to the caller: a shared entry keyed only by
      // session handed a member's rejection to the Host's concurrent start.
      const startKey = `${input.sessionId}:${input.actorUserId}`;
      const alreadyStarting = startingSessions.get(startKey);
      if (alreadyStarting) return alreadyStarting as Promise<ReturnType<typeof sessionView>>;
      const operation = (async () => {
      const pending = await deps.repository.read();
      const pendingSession = pending.sessions.find((item) => item.id === input.sessionId);
      let assignedProjectId: string | null = null;
      if (pendingSession && pendingSession.status !== "live" && deps.liveKitProjects && deps.liveKitGateway) {
        const { session: current, membership } = requireOpenSession(pending, input.sessionId, input.actorUserId);
        if (membership.role !== "host") throw new StudyGroupError("forbidden", "Only the Host can start the Live Session.");
        const state = effectiveSessionState(current, deps.now());
        if (state === "completed") throw new StudyGroupError("session_unavailable", "This Live Session has ended.");
        if (state === "scheduled") throw new StudyGroupError("session_not_open", "Start is available from 10 minutes before the scheduled time.");
        if (missedUnstarted(current, deps.now(), seatCount(pending, current.id, deps.now()))) throw new StudyGroupError("session_not_open", "This Live Session was not started.");
        assignedProjectId = await provisionProject(current, deps.liveKitProjects, deps.liveKitGateway);
      }
      const now = deps.now().toISOString();
      const session = await deps.repository.update((store) => {
        const { session: current, membership } = requireOpenSession(store, input.sessionId, input.actorUserId);
        if (membership.role !== "host") throw new StudyGroupError("forbidden", "Only the Host can start the Live Session.");
        const state = effectiveSessionState(current, deps.now());
        if (state === "completed") throw new StudyGroupError("session_unavailable", "This Live Session has ended.");
        if (state === "scheduled") throw new StudyGroupError("session_not_open", "Start is available from 10 minutes before the scheduled time.");
        closeLapsedSeats(store, deps.now(), current.id);
        if (missedUnstarted(current, deps.now(), seatCount(store, current.id, deps.now()))) throw new StudyGroupError("session_not_open", "This Live Session was not started.");
        // The Host opens the room only with a seat to enter it: starting a
        // session that waiting members have filled would put them in a room
        // the Host cannot join (QA 2026-10-19 N7). The reservation in seat()
        // keeps this from happening; this is the backstop.
        if (current.status !== "live") {
          const hostSeated = store.presences.some((item) => item.sessionId === current.id && item.userId === input.actorUserId && seatHeld(item, deps.now()));
          if (!hostSeated && seatCount(store, current.id, deps.now()) >= current.maxParticipants) throw new StudyGroupError("session_full", "Session Full.");
        }
        if (current.status !== "live") {
          if (assignedProjectId) current.liveKitProjectId = assignedProjectId;
          current.status = "live";
          current.startedAt = now;
          current.updatedAt = now;
          for (const presence of store.presences) {
            if (presence.sessionId === current.id && presence.enteredAt && !presence.leftAt) presence.phase = "live";
          }
          // The Host's reserved seat becomes a held one in this same write:
          // once the session is live the reservation is gone, so a member's
          // Join Now landing between this start and the Host's own entry
          // could otherwise take it (QA 2026-10-19 final review F-1).
          const hostSeat = store.presences.find((item) => item.sessionId === current.id && item.userId === input.actorUserId);
          if (hostSeat && seatHeld(hostSeat, deps.now())) {
            hostSeat.lastSeenAt = now;
          } else if (hostSeat) {
            Object.assign(hostSeat, { enteredAt: now, lastSeenAt: now, leftAt: null, phase: "live", liveKitParticipantSid: null });
          } else {
            store.presences.push({ id: randomUUID(), sessionId: current.id, userId: input.actorUserId, requestedAt: now, enteredAt: now, lastSeenAt: now, leftAt: null, phase: "live", liveKitParticipantSid: null });
          }
          if (!store.meetings.some((item) => item.sessionId === current.id)) {
            store.meetings.push({ id: randomUUID(), sessionId: current.id, startedAt: now, endedAt: null });
          }
        }
        return current;
      });
      return sessionView(await deps.repository.read(), session, input.actorUserId);
      })().finally(() => { startingSessions.delete(startKey); });
      startingSessions.set(startKey, operation);
      return operation;
    },

    async leaveSession(input: { actorUserId: string; sessionId: string; reason?: "unload" }) {
      // An unload signal (sent by clients built before the seat lease) is not
      // a Leave: the seat simply stops being renewed and lapses one lease
      // later, which is exactly what a refresh, a closed tab or a lost
      // network must do. Only an explicit Leave releases the seat now.
      if (input.reason === "unload") return;
      await deps.repository.update((store) => {
        const now = deps.now();
        const { session } = requireOpenSession(store, input.sessionId, input.actorUserId);
        closeLapsedSeats(store, now, session.id);
        const presence = store.presences.find((item) => item.sessionId === session.id && item.userId === input.actorUserId && !item.leftAt);
        if (presence) presence.leftAt = now.toISOString();
        endLiveSessionIfEmpty(store, session, now);
      });
    },

    // The seat holder's heartbeat: renews the lease of the caller's own seat.
    // `seated: false` tells the client its seat is gone (lapsed while the
    // device slept or was offline, or released elsewhere) and it must enter
    // again, which re-runs every admission rule.
    async heartbeat(input: { actorUserId: string; sessionId: string }) {
      // The common case, a seat still held, is one row write: no store load
      // and no diff (QA 2026-10-19 final review B3). Anything else (the seat
      // lapsed, the session moved on, no such membership) takes the full path
      // below, which validates and answers why.
      const now = deps.now();
      const renewed = await deps.repository.renewSeat({
        sessionId: input.sessionId,
        userId: input.actorUserId,
        at: now.toISOString(),
        heldSince: new Date(now.getTime() - SEAT_LEASE_MS).toISOString(),
        startsBy: new Date(now.getTime() + STARTING_SOON_MS).toISOString()
      });
      if (renewed) return { seated: true };
      return deps.repository.update((store) => {
        const now = deps.now();
        const { session } = requireOpenSession(store, input.sessionId, input.actorUserId);
        closeLapsedSeats(store, now, session.id);
        const presence = store.presences.find((item) => item.sessionId === session.id && item.userId === input.actorUserId && seatHeld(item, now));
        // A seat renews only while its session is open for seats: live, or
        // Starting Soon before its planned end. A session moved back out of
        // Starting Soon, or a waiting room left open past its end, releases
        // the seat now instead (QA final review B6, X-2).
        const renewable = seatRenewable(session, now);
        if (presence && renewable) presence.lastSeenAt = now.toISOString();
        if (presence && !renewable) presence.leftAt = now.toISOString();
        return { seated: Boolean(presence) && renewable, occupancy: seatCount(store, session.id, now), state: effectiveSessionState(session, now) };
      });
    },

    sweepPresence: () => sweepPresence(),

    async issueToken(input: { actorUserId: string; sessionId: string; recovery?: boolean }) {
      const store = await deps.repository.read();
      const { session, membership } = requireOpenSession(store, input.sessionId, input.actorUserId);
      const state = effectiveSessionState(session, deps.now());
      if (state === "completed") throw new StudyGroupError("session_unavailable", "This Live Session has ended.");
      if (state !== "live") throw new StudyGroupError("session_not_open", "LiveKit tokens are available only after the Host starts the Live Session.");
      const presence = store.presences.find((item) => item.sessionId === session.id && item.userId === input.actorUserId && seatHeld(item, deps.now()));
      if (!presence) throw new StudyGroupError("forbidden", "Enter the Live Session before requesting a token.");
      let assignedProjectId = session.liveKitProjectId;
      try {
        // Key first: a token must never be signed when the audit log line
        // cannot be written. An unset key is a typed unavailability, not a 500.
        const tokenLogKey = deps.tokenLogKey();
        if (!tokenLogKey) throw new StudyGroupError("unavailable", "The Study Group token issuance log key is not configured.");
        const profile = await deps.userProfile(input.actorUserId);
        if (deps.liveKitProjects && deps.liveKitGateway && !assignedProjectId) {
          const selected = deps.liveKitProjects.selectForNewSession({ sessionId: session.id });
          assignedProjectId = await deps.repository.update((current) => {
            const row = current.sessions.find((item) => item.id === session.id);
            if (!row || row.status === "removed") throw new StudyGroupError("not_found", "Live Session was not found.");
            row.liveKitProjectId ??= selected.id;
            return row.liveKitProjectId;
          });
        }
        const signed = deps.liveKitProjects && deps.liveKitGateway
          ? await (() => {
            if (!assignedProjectId) throw new StudyGroupError("unavailable", "LiveKit room is not assigned to a project.");
            const tokenInput = {
              project: deps.liveKitProjects!.getAssigned(assignedProjectId),
              identity: input.actorUserId,
              name: profile?.displayName || input.actorUserId,
              room: session.id,
              ttlSeconds: TOKEN_TTL_SECONDS
            };
            if (!input.recovery) return deps.liveKitGateway!.issueParticipantToken(tokenInput);
            if (!deps.liveKitGateway!.recoverParticipantToken) throw new StudyGroupError("unavailable", "LiveKit credential recovery is unavailable.");
            return deps.liveKitGateway!.recoverParticipantToken(tokenInput);
          })()
          : (() => {
            if (!deps.liveKit.apiKey || !deps.liveKit.apiSecret || !deps.liveKit.url) throw new StudyGroupError("unavailable", "LiveKit is not configured.");
            return signParticipantToken({
              apiKey: deps.liveKit.apiKey,
              apiSecret: deps.liveKit.apiSecret,
              identity: input.actorUserId,
              name: profile?.displayName || input.actorUserId,
              room: session.id,
              ttlSeconds: TOKEN_TTL_SECONDS,
              now: deps.now()
            });
          })();
        const line = encryptTokenLogLine({
          userId: input.actorUserId,
          role: membership.role,
          sessionId: session.id,
          state: "token_issued",
          at: deps.now().toISOString()
        }, tokenLogKey);
        if (line.includes(signed.token) || (!deps.liveKitGateway && line.includes(deps.liveKit.apiSecret))) throw new StudyGroupError("unavailable", "Token log refused.");
        await deps.repository.appendTokenLog(line);
        return { token: signed.token, expiresAt: signed.expiresAt, liveKitUrl: "url" in signed ? signed.url : deps.liveKit.url };
      } catch (error) {
        // Issuing a token is not a user leave. Keeping the admission row makes
        // both an initial failure and a verified-recovery failure retryable,
        // and prevents concurrent token requests from evicting a valid user.
        if (error instanceof LiveKitGatewayError) {
          emitLiveKitIncident({
            sessionId: session.id,
            projectId: assignedProjectId,
            code: classifyLiveKitIncident({ source: "gateway", code: error.code, phase: "existing_room" }).code,
            source: "gateway"
          });
          throw liveKitFailure(error, "LiveKit cannot issue a verified participant token right now.");
        }
        throw error;
      }
    },

    async reportLiveKitIncident(input: { actorUserId: string; sessionId: string; code: LiveKitIncidentCode }) {
      const store = await deps.repository.read();
      const { session } = requireOpenSession(store, input.sessionId, input.actorUserId);
      const presence = store.presences.find((item) => item.sessionId === session.id && item.userId === input.actorUserId && item.enteredAt && !item.leftAt);
      if (!presence) throw new StudyGroupError("forbidden", "Enter the Live Session before reporting a connection issue.");
      emitLiveKitIncident({ sessionId: session.id, projectId: session.liveKitProjectId, code: input.code, source: "client" });
      return { accepted: true };
    },

    async enqueueTutor(input: { actorUserId: string; sessionId: string; text: string; clientEventId: string }) {
      const text = requireText(input.text, "AI Tutor request", TUTOR_REQUEST_MAX_LENGTH);
      const clientEventId = requiredValue(input.clientEventId, "Client event id");
      const receivedAt = deps.now().toISOString();
      return deps.repository.update((store) => {
        const existing = store.tutorRequests.find((item) => item.sessionId === input.sessionId && item.userId === input.actorUserId && item.clientEventId === clientEventId);
        if (existing) return existing;
        const session = store.sessions.find((item) => item.id === input.sessionId);
        if (!session || session.status === "removed") throw new StudyGroupError("not_found", "Live Session was not found.");
        if (session.status === "completed") throw new StudyGroupError("session_unavailable", "This Live Session has ended.");
        if (session.status !== "live") throw new StudyGroupError("session_not_open", "AI Tutor is available only while the Live Session is live.");
        if (!session.aiTutorEnabled) throw new StudyGroupError("forbidden", "AI Tutor is not enabled for this Live Session.");
        const presence = store.presences.find((item) => item.sessionId === session.id && item.userId === input.actorUserId);
        if (!presence || !seatHeld(presence, deps.now())) {
          // A seat that ran out (the page's heartbeats did not get through)
          // says so, so the room can tell the asker to wait for its re-entry
          // rather than "You cannot do that" (QA final review X-5).
          if (presence && seatLapsed(presence, deps.now())) throw new StudyGroupError("seat_lapsed", "Your seat lapsed; ask again once the room has re-entered.");
          throw new StudyGroupError("forbidden", "Enter the Live Session before requesting AI Tutor.");
        }
        const mine = store.tutorRequests.filter((item) => item.sessionId === session.id && item.userId === input.actorUserId);
        if (mine.filter(tutorRequestPending).length >= TUTOR_PENDING_PER_USER) throw new StudyGroupError("tutor_busy", "Wait for the AI Tutor to answer your earlier questions.");
        const minuteAgo = deps.now().getTime() - 60_000;
        if (mine.filter((item) => Date.parse(item.receivedAt) > minuteAgo).length >= TUTOR_REQUESTS_PER_MINUTE) throw new StudyGroupError("tutor_rate_limited", "Too many AI Tutor questions in a minute.");
        // No enqueue-time in-flight marking (design §3.3c): the durable claim
        // owns the single-flight marker, so a new item simply waits as queued.
        const row = {
          id: randomUUID(),
          sessionId: session.id,
          userId: input.actorUserId,
          clientEventId,
          text,
          receivedAt,
          inFlight: false,
          status: "queued" as const
        };
        store.tutorRequests.push(row);
        return row;
      });
    },

    deliverTutorAnswer(input: { sessionId: string }) {
      return drainTutorSession(input.sessionId);
    },

    async recoverTutorWork() {
      // Bounded recovery (global review risk 1): leases and outbox rows
      // stranded by a crash have no inbound ask left to wake them. The claim
      // path keeps single-flight, so a session another instance is actively
      // draining simply yields nothing to claim.
      const sessions = await deps.repository.listSessionsWithPendingTutorWork({ limit: 5 });
      for (const sessionId of sessions) await drainTutorSession(sessionId);
      return { sessions: sessions.length };
    },

    dispatchDueReminders: () => dispatchDueReminders(),
    dispatchDueRemindersOnRequest,

    async handleLiveKitWebhook(input: { rawBody: string; authHeader: string | null }): Promise<StudyGroupWebhookOutcome> {
      // Receipt-first ordering (slice-2 design §3): verify → insert receipt →
      // act → mark. A failure before the mark leaves the row `received` so the
      // provider retry (or sweep A plus retry) resumes instead of being
      // swallowed as a duplicate.
      const gateway = deps.liveKitGateway;
      if (!gateway?.verifyWebhook) throw new StudyGroupWebhookError("webhook_unavailable");
      let event: LiveKitWebhookEvent;
      try {
        event = await gateway.verifyWebhook({ rawBody: input.rawBody, authHeader: input.authHeader });
      } catch (error) {
        if (error instanceof LiveKitGatewayError && error.code === "unverified") {
          // The exact place an invalid or missing signature is determined.
          webhookRejectionCount += 1;
          throw new StudyGroupWebhookError("invalid_signature");
        }
        throw new StudyGroupWebhookError("webhook_unavailable");
      }
      // The gateway already parsed this body; parsing cannot throw on real traffic.
      const payload = JSON.parse(input.rawBody) as unknown;
      let inserted: boolean;
      try {
        inserted = await deps.repository.insertWebhookReceipt({
          receiptId: event.eventId,
          eventType: event.eventType,
          sessionId: event.room,
          payload
        });
      } catch (error) {
        if (error instanceof StudyGroupStoreUnsupportedError) throw new StudyGroupWebhookError("webhook_unavailable");
        throw error;
      }
      if (!inserted) {
        const existing = await deps.repository.getWebhookReceipt(event.eventId);
        // Only a crashed (`received`) or swept (`failed`/`abandoned`) delivery
        // resumes; every other existing state is a settled duplicate that must
        // have no side effect and no second mark (mirrors the stripe_events rule).
        if (existing && !(existing.status === "received" || (existing.status === "failed" && existing.failureClass === "abandoned"))) {
          return { status: "duplicate" };
        }
      }
      // Provider events are recorded, never acted on: who holds a seat is the
      // server's own lease (presence.ts), renewed by the seat holder's
      // heartbeat. A participant_left used to close seats here, which raced
      // the reload it could not tell apart from a departure (BUG-0108) and,
      // with its timestamp misread, closed nothing at all (QA N3). Verifying
      // and recording the receipt keeps the endpoint an honest audit trail.
      const result = "ignored" as const;
      // Success only: an unexpected action failure above propagates with the
      // receipt still `received` (route 500; the retry resumes it).
      await deps.repository.markWebhookProcessed({ receiptId: event.eventId, result });
      return { status: result };
    },

    consumeWebhookRejectionCount() {
      // Read-and-reset in one synchronous step: the metrics timer drains the
      // returned value, so no count is dropped or reported twice.
      const count = webhookRejectionCount;
      webhookRejectionCount = 0;
      return count;
    },

    async reconcileLiveKitState(): Promise<{ abandonedReceipts: number; sessionsChecked: number; presencesClosed: number }> {
      // Bounded reconciliation (slice-2 design §4). Sweep A errors propagate:
      // the runtime timer swallows and logs a tick at its layer. Seats are no
      // longer repaired from the provider's participant list: the seat lease
      // is the single source of truth, so this tick runs the same presence
      // sweep every backend runs.
      const abandonedReceipts = await deps.repository.abandonStaleWebhookReceipts({ olderThanSeconds: 300, limit: 50 });
      const swept = await sweepPresence();
      return { abandonedReceipts, sessionsChecked: swept.sessionsEnded, presencesClosed: swept.seatsClosed };
    },

    async operationalMetrics(): Promise<StudyGroupOperationalMetrics> {
      // Redacted counts only (slice-3 design §5.2): a thin passthrough. Errors
      // propagate — including the file adapter's typed
      // StudyGroupStoreUnsupportedError — and the runtime metrics timer
      // swallows a failing tick at its layer.
      return deps.repository.studyGroupOperationalMetrics();
    },

    listReminders(actorUserId: string) {
      return deps.listReminders(actorUserId);
    },

    listCreatableCourses(actorUserId: string) {
      return deps.accessibleCourses(actorUserId);
    }
  };
}

// The metrics timer's emit-and-reset step, kept a small pure function so the
// cadence behavior is testable without timers: consume the counter (resetting
// it) and return the one redacted line when the count is above zero, else
// null. The line carries only the fixed type, the fixed reason and a number —
// never the signature, the header, the raw body, or any identity — and fires
// once per non-empty cadence, never per rejection (flood-safe).
export function webhookRejectionLogLine(service: { consumeWebhookRejectionCount?: () => number }): string | null {
  const count = service.consumeWebhookRejectionCount?.() ?? 0;
  if (count <= 0) return null;
  return JSON.stringify({ type: "study_group.webhook_rejected", reason: "invalid_signature", count });
}

export type StudyGroupService = Omit<ReturnType<typeof createStudyGroupService>, "consumeWebhookRejectionCount"> & {
  // Optional so lightweight service stand-ins in other fixtures keep
  // compiling; the runtime timer treats an absent method as a zero counter.
  consumeWebhookRejectionCount?: () => number;
};
