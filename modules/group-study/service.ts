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
  type TutorRequestRow
} from "./domain";
import { signParticipantToken } from "./liveKitToken";
import { LiveKitGatewayError, type LiveKitRoomGateway } from "./liveKitGateway";
import { classifyLiveKitIncident, type LiveKitIncidentCode } from "./liveKitIncident";
import type { LiveKitProjectRegistry } from "./liveKitProjectRegistry";
import type { StudyGroupRepository } from "./repository";
import { encryptTokenLogLine } from "./tokenLog";
import { createTutorKeyPool, type TutorKeyOutcome } from "./tutorKeyPool";
import { COURSE_MATERIAL_ABSENT, courseQuestionTerms, retrieveCourseKnowledge } from "./tutorAnswer";

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
  notify: (input: { userId: string; title: string; body: string }) => Promise<void>;
  sendMail: (input: { to: string; subject: string; text: string; locale: "en-GB" | "zh-CN" }) => Promise<void>;
  liveKit: { apiKey: string; apiSecret: string; url: string };
  liveKitProjects?: LiveKitProjectRegistry;
  liveKitGateway?: LiveKitRoomGateway;
  liveKitIncidentReporter?: (input: { sessionId: string; projectId: string | null; code: LiveKitIncidentCode; source: "client" | "gateway" }) => void;
  tokenLogKey: Buffer;
  courseKnowledge?: (courseId: string) => Promise<string>;
  publishRoomChat?: (input: { room: string; text: string; projectId: string | null; messageId: string }) => Promise<void>;
  tutorKeys?: () => Array<{ id: string; secret: string }>;
  tutorCall?: (input: { secret: string; text: string; context: string }) => Promise<{ outcome: TutorKeyOutcome; latencyMs: number; body?: string }>;
};

export type GroupView = StudyGroupRow & {
  role: GroupRole | null;
  memberCount: number;
  courseTitle: string;
  courseSlug: string;
  live: boolean;
};

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

function plannedCount(store: StudyGroupStore, sessionId: string) {
  return store.intents.filter((item) => item.sessionId === sessionId && !item.cancelledAt).length;
}

function nextTutorRequest(requests: TutorRequestRow[], sessionId: string, inFlightOnly: boolean) {
  let next: TutorRequestRow | null = null;
  for (const item of requests) {
    if (item.sessionId !== sessionId || item.answeredAt || (inFlightOnly && !item.inFlight)) continue;
    // Repository updates append requests in receipt order. Preserve that order
    // when the clock has only millisecond precision, including for old rows.
    if (!next || item.receivedAt.localeCompare(next.receivedAt) < 0) next = item;
  }
  return next;
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
    const showActual = state === "starting_soon" || state === "live" || state === "completed";
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
      if (existing && !existing.leftAt) return { occupancy: occupancy(store, session.id) };
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
      await deps.repository.update((current) => {
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
      });
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
      const notified = await deps.repository.update((store) => {
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
        return store.memberships.filter((item) => item.groupId === row.id && !item.leftAt).map((item) => item.userId);
      });
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
      await deps.repository.update((store) => {
        requireOpenSession(store, input.sessionId, input.actorUserId);
        const existing = store.intents.find((item) => item.sessionId === input.sessionId && item.userId === input.actorUserId && !item.cancelledAt);
        if (existing) existing.cancelledAt = now;
      });
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
      const alreadyStarting = startingSessions.get(input.sessionId);
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
        if (current.liveKitProjectId) {
          const project = deps.liveKitProjects.getAssigned(current.liveKitProjectId);
          try {
            await deps.liveKitGateway.ensureRoom({ project, room: current.id, maxParticipants: current.maxParticipants });
          } catch (error) {
            if (error instanceof LiveKitGatewayError) {
              emitLiveKitIncident({
                sessionId: current.id,
                projectId: project.id,
                code: classifyLiveKitIncident({ source: "gateway", code: error.code, phase: "existing_room" }).code,
                source: "gateway"
              });
              throw new StudyGroupError("unavailable", "LiveKit cannot create this room right now.");
            }
            throw error;
          }
          assignedProjectId = project.id;
        } else {
          const unavailable = new Set<string>();
          const activeProjectCount = deps.liveKitProjects.diagnostics().filter((project) => project.state === "active").length;
          while (unavailable.size < activeProjectCount) {
            const project = deps.liveKitProjects.selectForNewSession({ sessionId: current.id, excludeProjectIds: unavailable });
            try {
              await deps.liveKitGateway.ensureRoom({ project, room: current.id, maxParticipants: current.maxParticipants });
              assignedProjectId = project.id;
              break;
            } catch (error) {
              if (!(error instanceof LiveKitGatewayError)) throw error;
              emitLiveKitIncident({
                sessionId: current.id,
                projectId: project.id,
                code: classifyLiveKitIncident({ source: "gateway", code: error.code, phase: "new_room" }).code,
                source: "gateway"
              });
              unavailable.add(project.id);
            }
          }
          if (!assignedProjectId) throw new StudyGroupError("unavailable", "No LiveKit project can create this room right now.");
        }
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
      })().finally(() => { startingSessions.delete(input.sessionId); });
      startingSessions.set(input.sessionId, operation);
      return operation;
    },

    async leaveSession(input: { actorUserId: string; sessionId: string }) {
      const now = deps.now().toISOString();
      await deps.repository.update((store) => {
        const { session } = requireOpenSession(store, input.sessionId, input.actorUserId);
        const presence = store.presences.find((item) => item.sessionId === session.id && item.userId === input.actorUserId && !item.leftAt);
        if (presence) presence.leftAt = now;
        if (session.status === "live" && occupancy(store, session.id) === 0) {
          session.status = "completed";
          session.completedAt = now;
          session.updatedAt = now;
          const meeting = store.meetings.find((item) => item.sessionId === session.id);
          if (meeting && !meeting.endedAt) meeting.endedAt = now;
        }
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
        }, deps.tokenLogKey);
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
        const inFlight = store.tutorRequests.some((item) => item.sessionId === session.id && item.inFlight);
        const row = {
          id: randomUUID(),
          sessionId: session.id,
          userId: input.actorUserId,
          clientEventId,
          text,
          receivedAt,
          inFlight: !inFlight
        };
        store.tutorRequests.push(row);
        return row;
      });
    },

    async deliverTutorAnswer(input: { sessionId: string }) {
      for (;;) {
        if (!tutorDraining.has(input.sessionId)) {
          tutorDraining.add(input.sessionId);
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const markAnswered = async (itemId: string, sessionId: string) => {
        await deps.repository.update((store) => {
          const row = store.tutorRequests.find((entry) => entry.id === itemId);
          if (!row || row.answeredAt) return;
          row.answeredAt = deps.now().toISOString();
          row.inFlight = false;
          const next = nextTutorRequest(store.tutorRequests, sessionId, false);
          if (next) next.inFlight = true;
        });
      };
      try {
        let last: { text: string } | null = null;
        for (;;) {
          const snapshot = await deps.repository.read();
          const session = snapshot.sessions.find((item) => item.id === input.sessionId && item.status !== "removed");
          if (!session) return last;
          const item = nextTutorRequest(snapshot.tutorRequests, session.id, true);
          if (!item) return last;
          const group = snapshot.groups.find((entry) => entry.id === session.groupId);
          const corpus = group && deps.courseKnowledge ? await deps.courseKnowledge(group.courseId) : "";
          const context = retrieveCourseKnowledge(corpus, item.text);
          let reply = COURSE_MATERIAL_ABSENT;
          if (context) {
            const terms = courseQuestionTerms(item.text);
            const missing = terms.filter((term) => !context.toLowerCase().includes(term.toLowerCase()));
            if (terms.length > 0 && missing.length * 2 > terms.length) {
              reply = COURSE_MATERIAL_ABSENT;
            } else {
              const keys = deps.tutorKeys?.() ?? [];
              if (!deps.tutorCall || keys.length === 0) {
                await markAnswered(item.id, session.id);
                continue;
              }
              const result = await tutorPoolFor(keys).execute(item.text, (secret) => deps.tutorCall!({ secret, text: item.text, context }));
              if (!result.keyId || !result.body || keys.some((key) => result.body?.includes(key.secret))) {
                await markAnswered(item.id, session.id);
                continue;
              }
              reply = result.body.trim();
            }
          }
          try {
            if (deps.publishRoomChat) await deps.publishRoomChat({ room: session.id, text: reply, projectId: session.liveKitProjectId, messageId: item.id });
          } catch {
            // A room transport failure must not strand the session's in-flight
            // request and prevent later participants from being served.
            await markAnswered(item.id, session.id);
            continue;
          }
          await markAnswered(item.id, session.id);
          last = { text: reply };
        }
      } finally {
        tutorDraining.delete(input.sessionId);
      }
    },

    async dispatchDueReminders() {
      const now = deps.now();
      const dueJobs = (store: StudyGroupStore, record: boolean) => {
        const jobs: Array<{ userId: string; sessionTitle: string }> = [];
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
            jobs.push({ userId, sessionTitle: session.title });
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
        await deps.notify({ userId: job.userId, title: "Live Session reminder", body: copy.body });
        if (profile?.email) await deps.sendMail({ to: profile.email, subject: copy.subject, text: copy.body, locale: profile.locale });
      }
    },

    listCreatableCourses(actorUserId: string) {
      return deps.accessibleCourses(actorUserId);
    }
  };
}

export type StudyGroupService = ReturnType<typeof createStudyGroupService>;
