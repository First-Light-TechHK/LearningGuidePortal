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
  type StudyGroupStore
} from "./domain";
import { signParticipantToken } from "./liveKitToken";
import { LiveKitGatewayError, type LiveKitRoomGateway, type LiveKitWebhookEvent } from "./liveKitGateway";
import { classifyLiveKitIncident, type LiveKitIncidentCode } from "./liveKitIncident";
import type { LiveKitProjectRef, LiveKitProjectRegistry } from "./liveKitProjectRegistry";
import { StudyGroupStoreUnsupportedError, type StudyGroupOperationalMetrics, type StudyGroupRepository } from "./repository";
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
  publishRoomChat?: (input: { room: string; text: string; projectId: string | null; messageId: string; mode: string }) => Promise<void>;
  tutorKeys?: () => Array<{ id: string; secret: string }>;
  tutorCall?: (input: { secret: string; text: string; context: string }) => Promise<{ outcome: TutorKeyOutcome; latencyMs: number; body?: string }>;
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
  live: boolean;
};

export type StudyGroupWebhookOutcome = Readonly<{ status: "processed" | "ignored" | "duplicate" }>;

// Sweep B never closes a presence younger than this (slice-2 design §4, with
// the extra safety margin): a user mid-join or mid-re-join must never be raced
// by the repair path.
const RECONCILE_GRACE_SECONDS = 120;

function presenceAgeMs(presence: { enteredAt: string | null; requestedAt: string }): number {
  // The enter path reuses one row per user/session and refreshes BOTH
  // enteredAt and requestedAt on re-entry (`seat()`), so enteredAt is the
  // honest presence age; a waiting row has no enteredAt yet and `requestedAt`
  // is the "<ISO>#<seq>" receipt string, so only its ISO prefix is parsed.
  return Date.parse(presence.enteredAt ?? presence.requestedAt.split("#", 1)[0]);
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

function occupancy(store: StudyGroupStore, sessionId: string) {
  return store.presences.filter((item) => item.sessionId === sessionId && item.enteredAt && !item.leftAt).length;
}

// Shared completion rule (leave, webhook repair, reconciliation): a live
// session whose last open presence closes is completed and its meeting ended.
// The rule only ever reduces state — it can never grant anything.
function completeLiveSessionIfEmpty(store: StudyGroupStore, session: StudyGroupStore["sessions"][number], now: string) {
  if (session.status !== "live" || occupancy(store, session.id) !== 0) return;
  session.status = "completed";
  session.completedAt = now;
  session.updatedAt = now;
  const meeting = store.meetings.find((item) => item.sessionId === session.id);
  if (meeting && !meeting.endedAt) meeting.endedAt = now;
}

function plannedCount(store: StudyGroupStore, sessionId: string) {
  return store.intents.filter((item) => item.sessionId === sessionId && !item.cancelledAt).length;
}

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
    for (;;) {
      if (!tutorDraining.has(sessionId)) {
        tutorDraining.add(sessionId);
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const leaseOwner = randomUUID();
    try {
      let last: { text: string; mode: string } | null = null;
      for (;;) {
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
        // Grounding and the model call run outside every transaction and
        // lock; the claim lease, not the process, guards the window. The whole
        // course material goes to the model verbatim (owner decision): the
        // model itself fuzzy-matches a question against it, across languages,
        // so no server-side retrieval or threshold may short-circuit the call.
        const group = snapshot.groups.find((entry) => entry.id === session.groupId);
        const corpus = group && deps.courseKnowledge ? await deps.courseKnowledge(group.courseId) : "";
        const context = corpus.trim();
        const keys = deps.tutorKeys?.() ?? [];
        let reply: { text: string; mode: "course" | "general" | "unavailable" } = { text: "", mode: "unavailable" };
        if (deps.tutorCall && keys.length > 0) {
          const result = await tutorPoolFor(keys).execute(item.text, (secret) => deps.tutorCall!({ secret, text: item.text, context }));
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
          outbox: { room: session.id, projectId: session.liveKitProjectId ?? "", text: reply.text, messageId: item.id, mode: reply.mode }
        });
        if (!deps.publishRoomChat) last = { text: reply.text, mode: reply.mode };
      }
      const publish = deps.publishRoomChat;
      if (publish) {
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
              mode
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
      }
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

  async function toView(group: StudyGroupRow, store: StudyGroupStore, memberCount: number, role: GroupRole | null): Promise<GroupView> {
    const course = await deps.courseSummary(group.courseId);
    return {
      ...group,
      role,
      memberCount,
      courseTitle: course?.title || "",
      courseSlug: course?.slug || "",
      live: groupIsLive(store, group.id)
    };
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
      ? store.presences.filter((item) => item.sessionId === session.id && item.enteredAt && (state === "completed" || !item.leftAt))
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
      occupancy: occupancy(store, session.id),
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

  async function seat(input: { actorUserId: string; sessionId: string; requestedAt: string }) {
    const allowed = await (async () => {
      const store = await deps.repository.read();
      const session = store.sessions.find((item) => item.id === input.sessionId);
      return session ? deps.hasCourseAccess(input.actorUserId, store.groups.find((item) => item.id === session.groupId)?.courseId || "") : false;
    })();
    if (!allowed) {
      const store = await deps.repository.read();
      if (!store.sessions.some((item) => item.id === input.sessionId && item.status !== "removed")) throw new StudyGroupError("not_found", "Live Session was not found.");
      throw new StudyGroupError("course_access_required", "Valid Course access is required.");
    }
    return deps.repository.update((store) => {
      const { session } = requireOpenSession(store, input.sessionId, input.actorUserId);
      const state = effectiveSessionState(session, deps.now());
      if (state === "completed") throw new StudyGroupError("session_unavailable", "This Live Session has ended.");
      if (state !== "starting_soon" && state !== "live") throw new StudyGroupError("session_not_open", "The Live Session is not open yet.");
      const existing = store.presences.find((item) => item.sessionId === session.id && item.userId === input.actorUserId);
      if (existing && !existing.leftAt) {
        // Entering while already seated (a reload re-runs /enter): renew the
        // row's timestamps so the presence age read by the grace window and
        // the webhook's stale-seat guard is the CURRENT entry, never the
        // original one. Mirrors the reopen path below.
        existing.requestedAt = input.requestedAt;
        existing.enteredAt = deps.now().toISOString();
        return { occupancy: occupancy(store, session.id) };
      }
      if (missedUnstarted(session, deps.now(), occupancy(store, session.id))) throw new StudyGroupError("session_not_open", "This Live Session was not started.");
      if (occupancy(store, session.id) >= session.maxParticipants) throw new StudyGroupError("session_full", "Session Full.");
      const enteredAt = deps.now().toISOString();
      if (existing) {
        existing.leftAt = null;
        existing.requestedAt = input.requestedAt;
        existing.enteredAt = enteredAt;
        existing.phase = state === "live" ? "live" : "waiting";
      } else {
        store.presences.push({
          id: randomUUID(),
          sessionId: session.id,
          userId: input.actorUserId,
          requestedAt: input.requestedAt,
          enteredAt,
          leftAt: null,
          phase: state === "live" ? "live" : "waiting"
        });
      }
      return { occupancy: occupancy(store, session.id) };
    });
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
          throw new StudyGroupError("unavailable", "LiveKit cannot create this room right now.");
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
      for (const membership of store.memberships.filter((item) => item.userId === actorUserId && !item.leftAt)) {
        const group = store.groups.find((item) => item.id === membership.groupId && item.status === "active");
        if (!group) continue;
        const memberCount = store.memberships.filter((item) => item.groupId === group.id && !item.leftAt).length;
        views.push(await toView(group, store, memberCount, membership.role));
      }
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
      const sessions = mine ? await Promise.all(store.sessions.filter((item) => item.groupId === group.id && item.status !== "removed").map((item) => sessionView(store, item, input.actorUserId || ""))) : null;
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
      const sessionIds = await deps.repository.update((current) => {
        const row = current.memberships.find((item) => item.groupId === input.groupId && item.userId === input.actorUserId && !item.leftAt);
        if (row) row.leftAt = now;
        const sessionIds = new Set(current.sessions.filter((item) => item.groupId === input.groupId && item.status === "scheduled").map((item) => item.id));
        for (const intent of current.intents) {
          if (intent.userId === input.actorUserId && sessionIds.has(intent.sessionId) && !intent.cancelledAt) intent.cancelledAt = now;
        }
        for (const presence of current.presences) {
          if (presence.userId !== input.actorUserId || presence.leftAt || !presence.enteredAt) continue;
          const session = current.sessions.find((item) => item.id === presence.sessionId && item.groupId === input.groupId);
          if (!session || session.status === "completed" || session.status === "removed") continue;
          presence.leftAt = now;
          if (session.status === "live" && occupancy(current, session.id) === 0) {
            session.status = "completed";
            session.completedAt = now;
            session.updatedAt = now;
            const meeting = current.meetings.find((item) => item.sessionId === session.id);
            if (meeting && !meeting.endedAt) meeting.endedAt = now;
          }
        }
        return current.sessions.filter((item) => item.groupId === input.groupId).map((item) => item.id);
      });
      // Leaving drops the member's pending Plan-to-Attend reminders (BR-023):
      // withdraw their reminder rows for this group's Sessions only.
      await deps.withdrawReminders?.({ sessionIds, userId: input.actorUserId });
    },

    async listDiscover(input: { actorUserId: string | null; courseId?: string; query?: string }) {
      const store = await deps.repository.read();
      const joined = new Set(store.memberships.filter((item) => item.userId === input.actorUserId && !item.leftAt).map((item) => item.groupId));
      const needle = clean(input.query || "").toLowerCase();
      const views: GroupView[] = [];
      for (const group of store.groups) {
        if (group.status !== "active" || joined.has(group.id)) continue;
        if (input.courseId && group.courseId !== input.courseId) continue;
        const course = await deps.courseSummary(group.courseId);
        const haystack = `${group.title} ${group.about} ${course?.title || ""}`.toLowerCase();
        if (needle && !haystack.includes(needle)) continue;
        const memberCount = store.memberships.filter((item) => item.groupId === group.id && !item.leftAt).length;
        views.push(await toView(group, store, memberCount, null));
      }
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
      const { notified, sessionIds } = await deps.repository.update((store) => {
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
            session.status = "completed";
            session.completedAt = now;
            session.updatedAt = now;
            const meeting = store.meetings.find((item) => item.sessionId === session.id);
            if (meeting && !meeting.endedAt) meeting.endedAt = now;
            for (const presence of store.presences) {
              if (presence.sessionId === session.id && presence.enteredAt && !presence.leftAt) presence.leftAt = now;
            }
          }
        }
        return {
          notified: store.memberships.filter((item) => item.groupId === row.id && !item.leftAt).map((item) => item.userId),
          sessionIds: store.sessions.filter((item) => item.groupId === row.id).map((item) => item.id)
        };
      });
      // The cancelled group's pending reminders die with it (storage honesty);
      // the members' in-site cancellation notices below are kept.
      await deps.withdrawReminders?.({ sessionIds });
      await Promise.all(notified.map(async (userId) => {
        const profile = await deps.userProfile(userId);
        const body = profile?.locale === "zh-CN" ? "这个学习小组已经不再可用。" : "This Study Group is no longer available.";
        await deps.notify({ userId, title: "Study Group cancelled", body });
      }));
    },

    async scheduleSession(input: { actorUserId: string; groupId: string; title: string; startsAt: string; durationSeconds: number; maxParticipants: number; relatedLessonId?: string | null; focus?: string | null; aiTutorEnabled?: boolean }) {
      const title = requireText(input.title, "Session Title", 20);
      const startsAt = new Date(input.startsAt);
      if (Number.isNaN(startsAt.getTime())) throw new StudyGroupError("validation", "Start Time is required.");
      if (startsAt.getTime() <= deps.now().getTime()) throw new StudyGroupError("start_in_past", "Start Time must be in the future.");
      if (!SESSION_DURATION_SECONDS.includes(input.durationSeconds as (typeof SESSION_DURATION_SECONDS)[number])) throw new StudyGroupError("validation", "Duration is required.");
      if (!Number.isInteger(input.maxParticipants) || input.maxParticipants < 2 || input.maxParticipants > 6) throw new StudyGroupError("validation", "Maximum Participants must be from 2 to 6.");
      const now = deps.now().toISOString();
      const session = await deps.repository.update((store) => {
        const group = store.groups.find((item) => item.id === input.groupId && item.status === "active");
        if (!group) throw new StudyGroupError("not_found", "Study Group was not found.");
        if (activeMembership(store, group.id, input.actorUserId)?.role !== "host") throw new StudyGroupError("forbidden", "Only the Host can schedule a Live Session.");
        const row: LiveSessionRow = {
          id: randomUUID(),
          groupId: group.id,
          title,
          relatedLessonId: clean(input.relatedLessonId || "") || null,
          startsAt: startsAt.toISOString(),
          durationSeconds: input.durationSeconds,
          maxParticipants: input.maxParticipants,
          focus: (() => { const focus = clean(input.focus || ""); if (focus.length > 50) throw new StudyGroupError("validation", "Session Focus is too long."); return focus || null; })(),
          aiTutorEnabled: input.aiTutorEnabled !== false,
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
      if (input.title !== undefined) requireText(input.title, "Session Title", 20);
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
        if (input.maxParticipants !== undefined && input.maxParticipants < occupancy(store, current.id)) throw new StudyGroupError("conflict", "Maximum Participants is below the number already in the session.");
        if (input.title !== undefined) current.title = requireText(input.title, "Session Title", 20);
        if (input.relatedLessonId !== undefined) current.relatedLessonId = clean(input.relatedLessonId || "") || null;
        if (input.startsAt !== undefined) current.startsAt = new Date(input.startsAt).toISOString();
        if (input.durationSeconds !== undefined) current.durationSeconds = input.durationSeconds;
        if (input.maxParticipants !== undefined) current.maxParticipants = input.maxParticipants;
        if (focus !== undefined) current.focus = focus;
        if (input.aiTutorEnabled !== undefined) current.aiTutorEnabled = input.aiTutorEnabled;
        current.updatedAt = now;
        return current;
      });
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
      await deps.withdrawReminders?.({ sessionIds: [input.sessionId] });
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
      if (cancelled) await deps.withdrawReminders?.({ sessionIds: [input.sessionId], userId: input.actorUserId });
    },

    orderEntry<T>(requestedAt: string, run: () => Promise<T>) {
      return enqueueEntry(requestedAt, run);
    },

    enterSession(input: { actorUserId: string; sessionId: string; requestedAt: string }) {
      return enqueueEntry(input.requestedAt, () => seat(input));
    },

    grantSeat(input: { actorUserId: string; sessionId: string; requestedAt: string }) {
      return seat(input);
    },

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
        if (missedUnstarted(current, deps.now(), occupancy(pending, current.id))) throw new StudyGroupError("session_not_open", "This Live Session was not started.");
        assignedProjectId = await provisionProject(current, deps.liveKitProjects, deps.liveKitGateway);
      }
      const now = deps.now().toISOString();
      const session = await deps.repository.update((store) => {
        const { session: current, membership } = requireOpenSession(store, input.sessionId, input.actorUserId);
        if (membership.role !== "host") throw new StudyGroupError("forbidden", "Only the Host can start the Live Session.");
        const state = effectiveSessionState(current, deps.now());
        if (state === "completed") throw new StudyGroupError("session_unavailable", "This Live Session has ended.");
        if (state === "scheduled") throw new StudyGroupError("session_not_open", "Start is available from 10 minutes before the scheduled time.");
        if (missedUnstarted(current, deps.now(), occupancy(store, current.id))) throw new StudyGroupError("session_not_open", "This Live Session was not started.");
        if (current.status !== "live") {
          if (assignedProjectId) current.liveKitProjectId = assignedProjectId;
          current.status = "live";
          current.startedAt = now;
          current.updatedAt = now;
          for (const presence of store.presences) {
            if (presence.sessionId === current.id && presence.enteredAt && !presence.leftAt) presence.phase = "live";
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
      const now = deps.now().toISOString();
      await deps.repository.update((store) => {
        const { session } = requireOpenSession(store, input.sessionId, input.actorUserId);
        const presence = store.presences.find((item) => item.sessionId === session.id && item.userId === input.actorUserId && !item.leftAt);
        if (input.reason === "unload") {
          // Unload-class leave (pagehide: refresh, tab close, navigating away):
          // the same browser can re-enter seconds later, so this must NEVER
          // complete the session. With others still seated the seat is
          // released like a leave; as the last open presence the seat is HELD
          // and only its age renews, so the 120 s grace window plus the
          // provider-verified reconcile (or the signed participant_left)
          // decide the completion — the session stays discoverable to both
          // repair paths and can never hang live with nobody in it.
          if (presence) {
            if (occupancy(store, session.id) > 1) presence.leftAt = now;
            else presence.enteredAt = now;
          }
          completeLiveSessionIfEmpty(store, session, now);
          return;
        }
        if (presence) presence.leftAt = now;
        completeLiveSessionIfEmpty(store, session, now);
      });
    },

    async issueToken(input: { actorUserId: string; sessionId: string; recovery?: boolean }) {
      const store = await deps.repository.read();
      const { session, membership } = requireOpenSession(store, input.sessionId, input.actorUserId);
      const state = effectiveSessionState(session, deps.now());
      if (state === "completed") throw new StudyGroupError("session_unavailable", "This Live Session has ended.");
      if (state !== "live") throw new StudyGroupError("session_not_open", "LiveKit tokens are available only after the Host starts the Live Session.");
      const presence = store.presences.find((item) => item.sessionId === session.id && item.userId === input.actorUserId && item.enteredAt && !item.leftAt);
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
          throw new StudyGroupError("unavailable", "LiveKit cannot issue a verified participant token right now.");
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
      const text = requiredValue(input.text, "AI Tutor request");
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
        const seated = store.presences.some((item) => item.sessionId === session.id && item.userId === input.actorUserId && item.enteredAt && !item.leftAt);
        if (!seated) throw new StudyGroupError("forbidden", "Enter the Live Session before requesting AI Tutor.");
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

    async dispatchDueReminders() {
      const now = deps.now();
      const dueJobs = (store: StudyGroupStore, record: boolean) => {
        const jobs: Array<{ userId: string; sessionId: string; sessionTitle: string }> = [];
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
            if (store.reminders.some((item) => item.sessionId === session.id && item.userId === userId)) continue;
            if (record) store.reminders.push({ id: randomUUID(), sessionId: session.id, userId, sentAt: now.toISOString() });
            jobs.push({ userId, sessionId: session.id, sessionTitle: session.title });
          }
        }
        return jobs;
      };
      if (dueJobs(await deps.repository.read(), false).length === 0) return;
      const due = await deps.repository.update((store) => dueJobs(store, true));
      for (const job of due) {
        const profile = await deps.userProfile(job.userId);
        const copy = profile?.locale === "zh-CN"
          ? { subject: "直播课提醒", body: `${job.sessionTitle} 将在 10 分钟后开始。` }
          : { subject: "Live Session reminder", body: `${job.sessionTitle} starts in 10 minutes.` };
        await deps.notify({ userId: job.userId, title: "Live Session reminder", body: copy.body, sessionId: job.sessionId });
        if (profile?.email) await deps.sendMail({ to: profile.email, subject: copy.subject, text: copy.body, locale: profile.locale });
      }
    },

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
      let result: "processed" | "ignored" = "ignored";
      if (event.eventType === "participant_left" && event.room && event.participantIdentity) {
        const room = event.room;
        const identity = event.participantIdentity;
        // The only mapping action: close that identity's open presence row
        // inside the serialized mutate — unless the seat was (re)established
        // at or after the event's own time, in which case the event reports a
        // connection generation that no longer exists (a refresh re-entered
        // before a delayed participant_left arrived) and the fresh seat must
        // stay open. Closing the last open presence of a live session also
        // completes the session and ends its meeting — the same reducing rule
        // as an explicit leave — and can never grant membership, role, token,
        // or access.
        result = await deps.repository.update((store) => {
          const session = store.sessions.find((item) => item.id === room);
          if (!session) return "ignored" as const;
          const at = event.createdAt ?? deps.now().toISOString();
          const presence = store.presences.find((item) => item.sessionId === room && item.userId === identity && item.leftAt === null);
          const seatIsNewer = presence?.enteredAt ? Date.parse(presence.enteredAt) >= Date.parse(at) : false;
          if (presence && !seatIsNewer) presence.leftAt = at;
          completeLiveSessionIfEmpty(store, session, at);
          return "processed" as const;
        });
      }
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
      // the runtime timer swallows and logs a tick at its layer.
      const abandonedReceipts = await deps.repository.abandonStaleWebhookReceipts({ olderThanSeconds: 300, limit: 50 });
      // Sweep B needs a provider-verified participant read; absence means the
      // capability is unavailable and the sweep is skipped, never guessed.
      const gateway = deps.liveKitGateway;
      if (!gateway?.listParticipants) return { abandonedReceipts, sessionsChecked: 0, presencesClosed: 0 };
      const sessions = await deps.repository.listLiveSessionsWithOpenPresences(5);
      let sessionsChecked = 0;
      let presencesClosed = 0;
      for (const session of sessions) {
        let project: LiveKitProjectRef;
        try {
          if (!deps.liveKitProjects || !session.liveKitProjectId) throw new Error("The Live Session has no resolvable LiveKit project.");
          project = deps.liveKitProjects.getAssigned(session.liveKitProjectId);
        } catch {
          // A dangling assignment cannot be probed. Redacted incident only —
          // never identities, tokens, or payloads — and no check is counted.
          emitLiveKitIncident({
            sessionId: session.id,
            projectId: session.liveKitProjectId,
            code: classifyLiveKitIncident({ source: "gateway", code: "credential_unavailable", phase: "existing_room" }).code,
            source: "gateway"
          });
          continue;
        }
        let participants: ReadonlyArray<{ identity: string }>;
        try {
          participants = await gateway.listParticipants({ project, room: session.id });
        } catch (error) {
          emitLiveKitIncident({
            sessionId: session.id,
            projectId: project.id,
            code: classifyLiveKitIncident({
              source: "gateway",
              code: error instanceof LiveKitGatewayError ? error.code : "unreachable",
              phase: "existing_room"
            }).code,
            source: "gateway"
          });
          sessionsChecked += 1;
          continue;
        }
        sessionsChecked += 1;
        const presentIdentities = new Set(participants.map((participant) => participant.identity));
        // The only repair actions: conditionally close open presences of this
        // session whose identity the provider no longer lists — and, when that
        // closed the last open presence of a live session, complete the session
        // and end its meeting (the reducing counterpart of the leave rule,
        // never a grant) — inside the serialized mutate. Rows younger than the
        // grace window are left alone so a join in flight is never raced.
        presencesClosed += await deps.repository.update((store) => {
          const now = deps.now();
          let closed = 0;
          for (const presence of store.presences) {
            if (presence.sessionId !== session.id || presence.leftAt !== null || presentIdentities.has(presence.userId)) continue;
            const age = presenceAgeMs(presence);
            if (!Number.isFinite(age) || now.getTime() - age <= RECONCILE_GRACE_SECONDS * 1000) continue;
            presence.leftAt = now.toISOString();
            closed += 1;
          }
          const sessionRow = store.sessions.find((entry) => entry.id === session.id);
          if (sessionRow) completeLiveSessionIfEmpty(store, sessionRow, now.toISOString());
          return closed;
        });
      }
      return { abandonedReceipts, sessionsChecked, presencesClosed };
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
