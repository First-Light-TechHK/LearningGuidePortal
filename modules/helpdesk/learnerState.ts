// Helpdesk v7 (owner 2026-10-30): the learner state Portal hands the agent with a typed question, so it can narrow
// the cards to the learner's real situation: the schedule (Study Groups and their upcoming Live Sessions), the
// courses studied and for how long, the ones they can open and never started, each course's status, the
// subscriptions (entitlements) and how long ago the account was registered. Pure: worked out by code from
// Portal's own records (the product store and the Study Group store, read only), no I/O, no clock of its own.
// Coarse numbers and enums only (contracts/helpdesk.ts LearnerState): never a name, email, order number, amount
// or date; every age or time left is whole days / hours relative to `now`, clipped to LEARNER_STATE_LIMITS.
import { LEARNER_STATE_LIMITS, type LearnerCourseState, type LearnerPlanState, type LearnerState, type TicketStatus } from "@/contracts/helpdesk";
import type { ProductCourse, ProductEntitlement, ProductOrder, ProductStudyRecord, ProductSubscription, ProductUser } from "@/services/productStore";
import type { LiveSessionRow, MembershipRow, StudyGroupRow } from "@/modules/group-study/domain";

export type LearnerStateSources = {
  now: Date;
  user: Pick<ProductUser, "createdAt" | "email" | "emailVerifiedAt"> | null;
  subscriptions: Array<Pick<ProductSubscription, "userId" | "state" | "source" | "validTo"> & Partial<Pick<ProductSubscription, "scope" | "device" | "graceEndsAt">>>;
  entitlements: Array<Pick<ProductEntitlement, "userId" | "courseId" | "state" | "validTo"> & Partial<Pick<ProductEntitlement, "scope" | "scopeId">>>;
  courses: Array<Pick<ProductCourse, "id" | "title" | "status"> & Partial<Pick<ProductCourse, "category">>>;
  studyRecords: Array<Pick<ProductStudyRecord, "userId" | "courseId" | "progress" | "totalSeconds" | "updatedAt" | "completedAt">>;
  orders: Array<Pick<ProductOrder, "userId" | "status" | "createdAt">>;
  studyGroups: {
    groups: Array<Pick<StudyGroupRow, "id" | "status">>;
    memberships: Array<Pick<MembershipRow, "userId" | "groupId" | "role" | "leftAt">>;
    sessions: Array<Pick<LiveSessionRow, "groupId" | "startsAt" | "status">>;
  };
  /** The learner's own enquiries (status only). */
  tickets: Array<{ status: TicketStatus }>;
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const LIVE_PLAN_STATES: ReadonlyArray<LearnerPlanState["state"]> = ["active", "cancel_at_period_end", "grace"];
const CLOSED_TICKETS: ReadonlyArray<TicketStatus> = ["CLOSED", "CANCELLED"];

const time = (iso: string | null | undefined): number => {
  const value = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(value) ? value : NaN;
};
const clip = (value: number, max: number) => Math.max(-max, Math.min(max, value));
const daysAgo = (now: number, iso: string | null | undefined) => (Number.isFinite(time(iso)) ? clip(Math.max(0, Math.floor((now - time(iso)) / DAY)), LEARNER_STATE_LIMITS.daysMax) : null);
const count = (value: number) => Math.min(value, LEARNER_STATE_LIMITS.countMax);

/** The same coverage rule as the product store (scope everything / a category / one course). */
function covers(entitlement: LearnerStateSources["entitlements"][number], course: LearnerStateSources["courses"][number]) {
  const scope = entitlement.scope || (entitlement.courseId === "*" ? "everything" : "course");
  if (scope === "everything") return true;
  if (scope === "category") return (entitlement.scopeId || null) === (course.category ?? null);
  return (entitlement.scopeId || entitlement.courseId) === course.id;
}

/** The learner's state, or null without an account record. Records of other users are ignored. */
export function learnerState(userId: string, sources: LearnerStateSources): LearnerState | null {
  if (!sources.user) return null;
  const now = sources.now.getTime();

  // A live subscription whose access ran out (the store expires lazily) counts as expired.
  const plans = sources.subscriptions
    .filter((item) => item.userId === userId)
    .map((item) => {
      const end = time(item.state === "grace" ? item.graceEndsAt || item.validTo : item.validTo);
      const live = LIVE_PLAN_STATES.includes(item.state) && end > now;
      const plan: LearnerPlanState = {
        source: item.source, state: !live && LIVE_PLAN_STATES.includes(item.state) ? "expired" : item.state,
        scope: item.scope ?? "course", device: item.device ?? null, endsInDays: clip(Math.floor((end - now) / DAY), LEARNER_STATE_LIMITS.daysMax)
      };
      return { plan, live, end };
    })
    .filter((item) => Number.isFinite(item.end))
    .sort((a, b) => Number(b.live) - Number(a.live) || b.end - a.end)
    .slice(0, LEARNER_STATE_LIMITS.plansMax)
    .map((item) => item.plan);

  const liveAccess = sources.entitlements.filter((item) => item.userId === userId && item.state === "active" && time(item.validTo) > now);
  const hasAccess = (course: LearnerStateSources["courses"][number]) => liveAccess.some((item) => covers(item, course));
  const courseById = new Map(sources.courses.map((course) => [course.id, course]));
  const title = (course: LearnerStateSources["courses"][number]) => [...course.title.trim()].slice(0, LEARNER_STATE_LIMITS.courseTitleMax).join("");
  const records = sources.studyRecords.filter((item) => item.userId === userId && courseById.has(item.courseId));
  const started = new Set(records.filter((item) => item.progress > 0 || item.totalSeconds > 0 || item.completedAt).map((item) => item.courseId));

  const studied: LearnerCourseState[] = [...records]
    .sort((a, b) => (time(b.updatedAt) || 0) - (time(a.updatedAt) || 0))
    .map((item) => {
      const course = courseById.get(item.courseId) as LearnerStateSources["courses"][number];
      const progress = Math.max(0, Math.min(100, Math.round(item.progress) || 0));
      return {
        courseId: course.id, title: title(course),
        status: item.completedAt || progress >= 100 ? "completed" : started.has(course.id) ? "in_progress" : "not_started",
        progress, minutes: Math.min(LEARNER_STATE_LIMITS.minutesMax, Math.round(Math.max(0, item.totalSeconds || 0) / 60)),
        lastStudiedDaysAgo: daysAgo(now, item.updatedAt), hasAccess: hasAccess(course)
      };
    });
  // Course-scope access to a published course with no study record at all: not started.
  const recorded = new Set(records.map((item) => item.courseId));
  const neverOpened: LearnerCourseState[] = [...new Set(liveAccess.filter((item) => (item.scope || "course") === "course").map((item) => item.scopeId || item.courseId))]
    .map((id) => courseById.get(id))
    .filter((course): course is LearnerStateSources["courses"][number] => course !== undefined && course.status === "published" && !recorded.has(course.id))
    .map((course) => ({ courseId: course.id, title: title(course), status: "not_started", progress: 0, minutes: 0, lastStudiedDaysAgo: null, hasAccess: true }));
  const notStartedWithAccess = sources.courses.filter((course) => course.status === "published" && !started.has(course.id) && hasAccess(course)).length;

  const groupIds = new Set(sources.studyGroups.groups.filter((group) => group.status === "active").map((group) => group.id));
  const memberships = sources.studyGroups.memberships.filter((item) => item.userId === userId && !item.leftAt && groupIds.has(item.groupId));
  const mine = new Set(memberships.map((item) => item.groupId));
  const upcoming = sources.studyGroups.sessions
    .filter((session) => mine.has(session.groupId) && session.status === "scheduled" && time(session.startsAt) > now)
    .map((session) => time(session.startsAt))
    .sort((a, b) => a - b);

  const latest = sources.orders
    .filter((order) => order.userId === userId && Number.isFinite(time(order.createdAt)))
    .sort((a, b) => time(b.createdAt) - time(a.createdAt))[0];
  const tickets = sources.tickets.filter((ticket) => !CLOSED_TICKETS.includes(ticket.status));

  return {
    accountAgeDays: daysAgo(now, sources.user.createdAt) ?? 0,
    emailVerified: sources.user.email ? Boolean(sources.user.emailVerifiedAt) : null,
    plans,
    courses: [...studied, ...neverOpened].slice(0, LEARNER_STATE_LIMITS.coursesMax),
    notStartedWithAccess: count(notStartedWithAccess),
    studyGroups: {
      groups: count(memberships.length), hosting: count(memberships.filter((item) => item.role === "host").length), upcomingSessions: count(upcoming.length),
      nextSessionInHours: upcoming.length ? Math.min(LEARNER_STATE_LIMITS.hoursMax, Math.floor((upcoming[0] - now) / HOUR)) : null
    },
    latestOrder: latest ? { status: latest.status, daysAgo: daysAgo(now, latest.createdAt) ?? 0 } : null,
    tickets: { open: count(tickets.length), waitingOnUser: count(tickets.filter((ticket) => ticket.status === "WAITING_USER").length) }
  };
}
