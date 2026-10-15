export type StudyGroupMember = { userId: string; displayName: string; role: "host" | "member" };
export type StudySession = {
  id: string;
  groupId: string;
  title: string;
  startsAt: string;
  durationSeconds: number;
  maxParticipants: number;
  focus: string | null;
  aiTutorEnabled: boolean;
  startedAt: string | null;
  relatedLessonId: string | null;
  state: "scheduled" | "starting_soon" | "live" | "completed";
  occupancy: number;
  plannedCount: number;
  viewerPlanned: boolean;
  attendees: Array<{ userId: string; displayName: string }>;
};
export type StudyGroupDetail = {
  id: string;
  title: string;
  courseId: string;
  courseTitle: string;
  courseSlug: string;
  about: string;
  role: "host" | "member" | null;
  memberCount: number;
  live: boolean;
  canJoin?: boolean;
  members?: StudyGroupMember[];
  sessions?: StudySession[] | null;
  lessons?: Array<{ id: string; title: string }>;
};

export type StudyGroupResponse<T> = { ok: boolean; code: string; message: string; data: T };

export async function studyGroupRequest<T>(url: string, init?: RequestInit): Promise<StudyGroupResponse<T>> {
  try {
    const response = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers || {}) } });
    return await response.json() as StudyGroupResponse<T>;
  } catch {
    // F-1 (dev audit 2026-10-14): a rejected fetch (offline, DNS failure) or a non-JSON
    // body (a gateway error page) used to reject at the await, skip every caller's !ok
    // branch and surface as an unhandled rejection with no UI feedback. Resolve a
    // synthetic failure instead so the existing single error slot renders it; callers
    // that still carry a catch keep it as belt-and-braces only.
    return { ok: false, code: "network", message: "", data: null as T };
  }
}

export const SESSION_TITLE_MAX = 20;

// BUG-0116 (SIT): the create form capped About at 200 but the edit dialog rendered the
// stored value uncontrolled, so text beyond the limit could still be shown and saved.
// The boundary lives here once, shared by both fields (the server enforces the same 200).
export const GROUP_ABOUT_MAX = 200;

export function clampGroupAbout(value: string) {
  return value.slice(0, GROUP_ABOUT_MAX);
}

export const DURATION_MINUTE_CHOICES = [30, 45, 60, 90] as const;

export function hostMayOpenRoom(startOk: boolean, enterOk: boolean) {
  return startOk && enterOk;
}

export function tutorQueueBody(message: string) {
  return { message };
}

// The outbox publishes at-least-once: a crash between publish and settle can
// republish an answer with the same tutor message id, so chat lines keyed by
// that id render once (design §3.2, client companion).
export function tutorChatLines<T extends { id: string }>(current: T[], line: T): T[] {
  if (current.some((item) => item.id === line.id)) return current;
  return [...current, line];
}

export function sessionNotStarted(session: { state: string; occupancy: number; startsAt: string; durationSeconds: number }, now = Date.now()) {
  if (session.state !== "starting_soon" || session.occupancy > 0) return false;
  const end = Date.parse(session.startsAt) + session.durationSeconds * 1000;
  return Number.isFinite(end) && now >= end;
}

export function plannedMinutes(session: { durationSeconds: number }) {
  return Math.round(session.durationSeconds / 60);
}

export function sessionDateLabel(locale: string, startsAt: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(startsAt));
}

export function sessionTimeLabel(locale: string, session: { startsAt: string; durationSeconds: number }) {
  const start = new Date(session.startsAt);
  const end = new Date(start.getTime() + session.durationSeconds * 1000);
  const clock = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" });
  return `${clock.format(start)} – ${clock.format(end)}`;
}

export function sessionScheduleLabel(locale: string, session: { startsAt: string; durationSeconds: number }) {
  return `${sessionDateLabel(locale, session.startsAt)} · ${sessionTimeLabel(locale, session)}`;
}

export function scheduleSessionFields(input: { title: FormDataEntryValue | null; startsAt: string; durationMinutes: number; maxParticipants: number; focus: FormDataEntryValue | null; aiTutorEnabled: boolean; relatedLessonId?: FormDataEntryValue | null }) {
  const lesson = typeof input.relatedLessonId === "string" ? input.relatedLessonId.trim() : "";
  return {
    title: input.title,
    startsAt: input.startsAt,
    durationSeconds: input.durationMinutes * 60,
    maxParticipants: input.maxParticipants,
    focus: input.focus,
    aiTutorEnabled: input.aiTutorEnabled,
    relatedLessonId: lesson || null
  };
}

export function sessionTitleCount(value: string) {
  const length = Math.min(value.length, SESSION_TITLE_MAX);
  return `${length}/${SESSION_TITLE_MAX}`;
}

export function fill(template: string, values: Record<string, string | number>) {
  return Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template);
}
