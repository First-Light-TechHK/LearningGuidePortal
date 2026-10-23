import { deadlineSignal } from "@/modules/group-study/seatIntents";
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
  // Seats a member who is not the Host can still take: before the start the
  // server keeps one for the Host until the Host holds a seat.
  seatsOpen: number;
  plannedCount: number;
  viewerPlanned: boolean;
  // True when the viewer already holds a seat (another tab, or a reload while
  // waiting): entering again renews that seat, so the session is not full for them.
  viewerSeated?: boolean;
  attendees: Array<{ userId: string; displayName: string }>;
  // Live sessions with the AI Tutor on: whether the room offers it right now
  // (and why not), and the viewer's own questions still waiting.
  tutor?: { available: true } | { available: false; reason: "no_key" | "provider_down" | "budget" | "offline" };
  viewerTutorQuestions?: Array<{ id: string; position: number; answering: boolean }>;
};
export type StudyGroupDetail = {
  id: string;
  title: string;
  courseId: string;
  courseTitle: string;
  courseSlug: string;
  // False when the related Course is no longer published: its title and
  // slug are then empty and the page says so instead.
  courseAvailable?: boolean;
  /** KS 课程级 AI Tutor Online 状态；false 时主持人不能开启房间 Tutor */
  tutorOnline?: boolean;
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

// A request that gets no answer (a phone switching networks can stall one for
// minutes) ends as the network failure after this long, so a poll waiting on it
// runs again instead of waiting for good (QA3 groups #1).
export const STUDY_GROUP_REQUEST_TIMEOUT_MS = 15_000;

export async function studyGroupRequest<T>(url: string, init?: RequestInit, timeoutMs = STUDY_GROUP_REQUEST_TIMEOUT_MS): Promise<StudyGroupResponse<T>> {
  try {
    const response = await fetch(url, { ...init, signal: init?.signal ?? deadlineSignal(timeoutMs), headers: { "content-type": "application/json", ...(init?.headers || {}) } });
    return await response.json() as StudyGroupResponse<T>;
  } catch {
    // F-1 (dev audit 2026-10-14): a rejected fetch (offline, DNS failure) or a non-JSON
    // body (a gateway error page) used to reject at the await, skip every caller's !ok
    // branch and surface as an unhandled rejection with no UI feedback. Resolve a
    // synthetic failure instead so the existing single error slot renders it; callers
    // that still carry a catch keep it as belt-and-braces only. A timed-out request
    // lands here too.
    return { ok: false, code: "network", message: "", data: null as T };
  }
}

// The server issues Study Group ids as UUIDs. A `?group=` value is only opened
// when it is one, and every id goes into the API path encoded, so a crafted
// value cannot point the request at another route (QA3 groups #7).
const STUDY_GROUP_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function studyGroupIdFromQuery(search: string) {
  const id = new URLSearchParams(search).get("group");
  return id && STUDY_GROUP_ID.test(id) ? id : null;
}

export function studyGroupPath(groupId: string) {
  return `/api/study-groups/${encodeURIComponent(groupId)}`;
}

// Join now is closed only for a viewer who holds no seat: a seat the viewer
// already holds is renewed when they enter again (QA3 groups #2).
export function sessionFullForViewer(session: { seatsOpen: number; viewerSeated?: boolean }) {
  return session.seatsOpen <= 0 && !session.viewerSeated;
}

// The Related Course line wherever a group shows it: a Course that is no
// longer published says so instead of an empty title (QA M7, QA3 groups #8).
export function groupCourseLabel(group: { courseTitle: string; courseAvailable?: boolean }, unavailable: string) {
  return group.courseAvailable === false ? unavailable : group.courseTitle;
}

// The phone layout puts the details under the whole sidebar; what changes
// there is brought into view (QA N12, QA3 groups #6).
export const PHONE_LAYOUT_QUERY = "(max-width: 800px)";

export function revealOnPhone(element: { scrollIntoView: (options: ScrollIntoViewOptions) => void } | null, matchMedia: (query: string) => { matches: boolean }) {
  if (element && matchMedia(PHONE_LAYOUT_QUERY).matches) element.scrollIntoView({ behavior: "smooth", block: "start" });
}

// Owner ruling 2026-10-15 (BUG-0128): Session Title allows 50 characters like the Study
// Group Title / Session Focus (a 32 character sample like "Classical Poetry Reading
// Session" must fit). The server enforces the same 50 in modules/group-study/service.ts.
export const SESSION_TITLE_MAX = 50;

// BUG-0116 (SIT): the create form capped About at 200 but the edit dialog rendered the
// stored value uncontrolled, so text beyond the limit could still be shown and saved.
// The boundary lives here once, shared by both fields (the server enforces the same 200).
export const GROUP_ABOUT_MAX = 200;

export function clampGroupAbout(value: string) {
  return value.slice(0, GROUP_ABOUT_MAX);
}

export const DURATION_MINUTE_CHOICES = [30, 45, 60, 90] as const;

type ValidatableForm = { checkValidity: () => boolean; elements: ArrayLike<unknown> };

// The one form check every Study Group form runs before it submits (QA
// 2026-10-19 BUG-0125): the forms are `noValidate`, so the browser never
// shows its own bubble in the browser's language; a field that is missing or
// out of range becomes the page's own message in the page's language. A
// missing field is reported first, so fixing the Start Time never uncovers a
// second message (QA r1-F-3); then a date or time before its `min` is the
// dedicated "Start Time must be in the future" message; anything else is the
// generic required-fields one. The server runs the same rules again
// (modules/group-study/service.ts).
export function studyGroupFormProblem(form: ValidatableForm): "validation" | "start_in_past" | null {
  if (form.checkValidity()) return null;
  const validities = Array.from(form.elements).map((element) => (element as { validity?: { valueMissing?: boolean; rangeUnderflow?: boolean } }).validity);
  if (validities.some((validity) => validity?.valueMissing)) return "validation";
  if (validities.some((validity) => validity?.rangeUnderflow)) return "start_in_past";
  return "validation";
}

export function hostMayOpenRoom(startOk: boolean, enterOk: boolean) {
  return startOk && enterOk;
}

export function tutorQueueBody(message: string, clientEventId?: string) {
  return clientEventId ? { message, clientEventId } : { message };
}

// The outbox publishes at-least-once: a crash between publish and settle can
// republish an answer with the same tutor message id, so chat lines keyed by
// that id render once (design §3.2, client companion).
// The asker's own "answering" placeholder carries the same id (the queued
// question's id is the answer's message id), so the arriving answer takes the
// placeholder's place instead of rendering next to it.
export function tutorChatLines<T extends { id: string; pending?: boolean }>(current: T[], line: T): T[] {
  const index = current.findIndex((item) => item.id === line.id);
  if (index < 0) return [...current, line];
  if (!current[index].pending || line.pending) return current;
  return current.map((item, position) => position === index ? line : item);
}

// The asker's question line asks again, with a new client event id, once its
// answer came back unavailable (the model failed, or the wait timed out): the
// old id is settled on the server, so a retry under it would only return the
// failed answer again (QA 2026-10-19 final review r3-B2).
export function tutorAskAgain(items: Array<{ id: string; mode?: string }>, answerId: string | undefined) {
  if (!answerId) return false;
  return items.some((item) => item.id === answerId && item.mode === "unavailable");
}

// Why the room does not offer the AI Tutor right now, or null when it does
// (tutor infra 2026-10-20): the server decides, the room only shows it.
export function tutorOfflineReason(session: Pick<StudySession, "aiTutorEnabled" | "tutor">) {
  if (!session.aiTutorEnabled || !session.tutor || session.tutor.available) return null;
  return session.tutor.reason;
}

// Where the asker's waiting question stands, from the session the server
// last returned: "answering" while it is being answered (or nothing says
// otherwise), "queued" with how many come first (0 = next), and whether it
// can still be withdrawn (only a question nobody started on).
// Before the next poll lists a question just taken, the position the server
// gave when it took it stands in (`queuedPosition`).
export function tutorPendingState(session: Pick<StudySession, "viewerTutorQuestions"> | null, answerLineId: string, queuedPosition?: number | null) {
  const id = answerLineId.replace(/^tutor-/, "");
  const listed = session?.viewerTutorQuestions?.find((item) => item.id === id);
  const entry = listed ?? (typeof queuedPosition === "number" && queuedPosition > 0 ? { id, position: queuedPosition, answering: false } : undefined);
  if (!entry || entry.answering) return { state: "answering" as const, ahead: 0, withdrawable: false };
  return { state: "queued" as const, ahead: Math.max(0, entry.position), withdrawable: true };
}

// Whether the server still lists the asker's question as waiting or being
// answered: the room's own answer timer must not call such a question
// unavailable (QA 2026-10-20; a fair queue can make the wait long).
export function tutorStillWaiting(session: Pick<StudySession, "viewerTutorQuestions"> | null, answerLineId: string) {
  const id = answerLineId.replace(/^tutor-/, "");
  return Boolean(session?.viewerTutorQuestions?.some((item) => item.id === id));
}

// Why a question never reached the AI Tutor, for the asker's own line (QA
// 2026-10-19 X-5): the refusals the server names get their own words, any
// other failure the generic one.
export const TUTOR_REFUSAL_CODES = ["tutor_busy", "tutor_rate_limited", "seat_lapsed", "session_not_open", "tutor_unavailable"] as const;
export function tutorRefusalReason(code: string, words: { errors: Record<string, string>; notLive: string }) {
  if (code === "session_not_open") return words.notLive;
  return words.errors[code] || words.errors.error;
}

// Entry refusals no automatic retry can fix: the page stops re-entering and says why.
export const FINAL_ENTRY_CODES = new Set(["forbidden", "not_found", "session_unavailable", "session_full", "course_access_required", "unauthenticated"]);

// What the seat heartbeat does when its seat is gone and entering again was
// refused. "keep" leaves everything as it is and the next heartbeat tries
// again; "stop" gives the seat up and releases the call. A full session while
// this page's own call is still connected means the lease lapsed under a
// working call (the heartbeat failed for a while) and someone took the seat:
// the call is not dropped for it (QA 2026-10-19 final review X-4).
export function seatReentryAction(code: string, callConnected: boolean): "keep" | "stop" {
  if (!FINAL_ENTRY_CODES.has(code)) return "keep";
  if (code === "session_full" && callConnected) return "keep";
  return "stop";
}

// The way forward a room page offers when it cannot show the session (QA
// 2026-10-19 M20): signing in for a signed-out visitor, the Study Groups page
// for someone who is not (or no longer) a member, a retry otherwise.
export function roomGateAction(code: string): "sign-in" | "groups" | "retry" {
  if (code === "unauthenticated") return "sign-in";
  if (code === "forbidden" || code === "not_found" || code === "course_access_required") return "groups";
  return "retry";
}

export function roomSignInHref(locale: string, sessionId: string) {
  return `/${locale}/portal/sign-in?returnTo=${encodeURIComponent(`/${locale}/portal/study-groups/sessions/${sessionId}`)}`;
}

// Screen sharing needs getDisplayMedia, which phones and some embedded
// browsers lack; the Share control is hidden there (QA 2026-10-19 M18).
export function screenShareSupported(media: { getDisplayMedia?: unknown } | undefined) {
  return typeof media?.getDisplayMedia === "function";
}

// The seat lease is renewed this often while the page holds a seat (the
// server releases a seat 30 s after the last renewal, modules/group-study/presence.ts).
export const SEAT_HEARTBEAT_MS = 10_000;

// Waits between automatic reconnect attempts after the SDK's own recovery
// gave up: quick at first, then every 30 s, for as long as the page is open.
export function reconnectDelayMs(failures: number) {
  return Math.min(30_000, 1_000 * 2 ** Math.max(0, failures));
}

// A question queued for the AI Tutor keeps one client event id across
// retries, so a retry of a request that did reach the server is not asked twice.
export function tutorClientEventId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
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

// A counted line in the page's language: "1 learner" / "2 learners" (QA M8).
// Chinese has one form, so its copy repeats it under both keys.
export function fillCount(locale: string, forms: { one: string; other: string }, count: number) {
  return fill(new Intl.PluralRules(locale).select(count) === "one" ? forms.one : forms.other, { count });
}

// The Study Groups page, with the open group in its query so a reload, the
// language switch and a sign-in come back to it (QA M6).
export function studyGroupsPageHref(locale: string, groupId: string | null) {
  return `/${locale}/portal/study-groups${groupId ? `?group=${encodeURIComponent(groupId)}` : ""}`;
}

export function studyGroupSignInHref(locale: string, returnTo: string) {
  return `/${locale}/portal/sign-in?returnTo=${encodeURIComponent(returnTo)}`;
}
