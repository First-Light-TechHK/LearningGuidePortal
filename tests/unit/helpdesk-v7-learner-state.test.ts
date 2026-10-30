// Helpdesk v7 learner state (owner 2026-10-30): the learner's situation as coarse numbers and enums, worked out by
// code from Portal's own records, for the agent. Each rule is locked at its boundaries, and nothing identifying leaks.
import assert from "node:assert/strict";
import { test } from "node:test";
import { LEARNER_STATE_LIMITS } from "../../contracts/helpdesk";
import { learnerState, type LearnerStateSources } from "../../modules/helpdesk/learnerState";

const NOW = new Date("2026-10-30T12:00:00.000Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
const ME = "user_me";
const OTHER = "user_other";

const course = (id: string, extra: Partial<LearnerStateSources["courses"][number]> = {}) => ({ id, title: `Course ${id}`, status: "published" as const, category: "Science" as const, ...extra });
const record = (courseId: string, extra: Partial<LearnerStateSources["studyRecords"][number]> = {}) => ({ userId: ME, courseId, progress: 0, totalSeconds: 0, updatedAt: at(-DAY), completedAt: null, ...extra });
const entitlement = (courseId: string, extra: Partial<LearnerStateSources["entitlements"][number]> = {}) => ({ userId: ME, courseId, state: "active" as const, validTo: at(30 * DAY), scope: "course" as const, scopeId: courseId, ...extra });
const plan = (extra: Partial<LearnerStateSources["subscriptions"][number]> = {}) => ({ userId: ME, state: "active" as const, source: "purchase" as const, validTo: at(30 * DAY), scope: "course" as const, device: "pc" as const, graceEndsAt: null, ...extra });

function sources(overrides: Partial<LearnerStateSources> = {}): LearnerStateSources {
  return {
    now: NOW,
    user: { createdAt: at(-40 * DAY - HOUR), email: "me@example.test", emailVerifiedAt: at(-39 * DAY) },
    subscriptions: [], entitlements: [], courses: [], studyRecords: [], orders: [],
    studyGroups: { groups: [], memberships: [], sessions: [] },
    tickets: [],
    ...overrides
  };
}
const state = (overrides: Partial<LearnerStateSources> = {}) => {
  const value = learnerState(ME, sources(overrides));
  assert.ok(value);
  return value;
};

test("v7 learner state: no account record means no state; a new account with nothing going on", () => {
  assert.equal(learnerState(ME, sources({ user: null })), null);
  assert.deepEqual(state(), {
    accountAgeDays: 40, emailVerified: true, plans: [], courses: [], notStartedWithAccess: 0,
    studyGroups: { groups: 0, hosting: 0, upcomingSessions: 0, nextSessionInHours: null }, latestOrder: null, tickets: { open: 0, waitingOnUser: 0 }
  });
  assert.equal(state({ user: { createdAt: at(-HOUR), email: "me@example.test", emailVerifiedAt: null } }).emailVerified, false);
  assert.equal(state({ user: { createdAt: at(-HOUR), email: null, emailVerifiedAt: null } }).emailVerified, null, "no email to verify (WeChat)");
  assert.equal(state({ user: { createdAt: at(-HOUR), email: null, emailVerifiedAt: null } }).accountAgeDays, 0);
  assert.equal(state({ user: { createdAt: at(-20_000 * DAY), email: null, emailVerifiedAt: null } }).accountAgeDays, LEARNER_STATE_LIMITS.daysMax, "clipped");
});

test("v7 learner state: plans are the learner's subscriptions, live first (latest end first), access left in whole days, an overdue live one counts as expired", () => {
  const value = state({
    subscriptions: [
      plan({ state: "expired", validTo: at(-10 * DAY) }),
      plan({ state: "active", source: "trial", validTo: at(2 * DAY + HOUR), device: undefined, scope: undefined }),
      plan({ state: "cancel_at_period_end", validTo: at(20 * DAY - HOUR), scope: "everything" }),
      plan({ state: "active", validTo: at(-HOUR) }),
      plan({ state: "grace", validTo: at(-DAY), graceEndsAt: at(3 * DAY) }),
      plan({ state: "trial_canceled", source: "trial", validTo: at(-3 * DAY) }),
      plan({ userId: OTHER, state: "active", validTo: at(300 * DAY) })
    ]
  });
  assert.deepEqual(value.plans, [
    { source: "purchase", state: "cancel_at_period_end", scope: "everything", device: "pc", endsInDays: 19 },
    { source: "purchase", state: "grace", scope: "course", device: "pc", endsInDays: 3 },
    { source: "trial", state: "active", scope: "course", device: null, endsInDays: 2 },
    { source: "purchase", state: "expired", scope: "course", device: "pc", endsInDays: -1 },
    { source: "trial", state: "trial_canceled", scope: "course", device: "pc", endsInDays: -3 }
  ], "live ones by the end of access (grace: its grace end), then ended ones latest first; at most plansMax, other users ignored");
  assert.equal(value.plans.length, LEARNER_STATE_LIMITS.plansMax);
});

test("v7 learner state: courses studied (status, progress, minutes, last studied) with access, then course-scope access never started", () => {
  const value = state({
    courses: [course("c1"), course("c2", { category: "European Humanities" }), course("c3"), course("c4", { title: "x".repeat(200) }), course("c5", { status: "draft" })],
    entitlements: [entitlement("*", { scope: "category", scopeId: "Science" }), entitlement("c4", { validTo: at(-HOUR) }), entitlement("c5"), entitlement("c2", { userId: OTHER })],
    studyRecords: [
      record("c1", { progress: 35.6, totalSeconds: 3_000, updatedAt: at(-2 * DAY - HOUR) }),
      record("c2", { progress: 100, totalSeconds: 7_230, updatedAt: at(-HOUR), completedAt: at(-HOUR) }),
      record("c4", { progress: 0, totalSeconds: 0, updatedAt: at(-50 * DAY) }),
      record("gone", { progress: 10 }),
      record("c3", { userId: OTHER, progress: 50 })
    ]
  });
  assert.deepEqual(value.courses, [
    { courseId: "c2", title: "Course c2", status: "completed", progress: 100, minutes: 121, lastStudiedDaysAgo: 0, hasAccess: false },
    { courseId: "c1", title: "Course c1", status: "in_progress", progress: 36, minutes: 50, lastStudiedDaysAgo: 2, hasAccess: true },
    { courseId: "c4", title: "x".repeat(LEARNER_STATE_LIMITS.courseTitleMax), status: "not_started", progress: 0, minutes: 0, lastStudiedDaysAgo: 50, hasAccess: true }
  ], "latest studied first; a course gone from the catalogue is left out; c4 is covered by the Science category; c5 (own access, never started) is a draft nobody can open");
  const own = state({ courses: [course("c6")], entitlements: [entitlement("c6")] });
  assert.deepEqual(own.courses, [{ courseId: "c6", title: "Course c6", status: "not_started", progress: 0, minutes: 0, lastStudiedDaysAgo: null, hasAccess: true }], "course-scope access never started");
  // c3 (Science, published, never started) and c4 (record without progress) can be opened and were never started; c5 is a draft
  assert.equal(value.notStartedWithAccess, 2);
});

test("v7 learner state: at most coursesMax courses; studied ones win the places", () => {
  const ids = Array.from({ length: 14 }, (_, i) => `c${i}`);
  const value = state({
    courses: ids.map((id) => course(id)),
    entitlements: ids.map((id) => entitlement(id)),
    studyRecords: ids.slice(0, 3).map((id, i) => record(id, { progress: 10, updatedAt: at(-i * DAY) }))
  });
  assert.equal(value.courses.length, LEARNER_STATE_LIMITS.coursesMax);
  assert.deepEqual(value.courses.slice(0, 3).map((c) => c.courseId), ["c0", "c1", "c2"]);
  assert.equal(value.notStartedWithAccess, 11);
});

test("v7 learner state: the schedule is the active Study Groups the learner is in and their upcoming Live Sessions", () => {
  const value = state({
    studyGroups: {
      groups: [{ id: "g1", status: "active" }, { id: "g2", status: "active" }, { id: "g3", status: "cancelled" }, { id: "g4", status: "active" }],
      memberships: [
        { userId: ME, groupId: "g1", role: "host", leftAt: null },
        { userId: ME, groupId: "g2", role: "member", leftAt: null },
        { userId: ME, groupId: "g3", role: "host", leftAt: null },
        { userId: ME, groupId: "g4", role: "member", leftAt: at(-DAY) },
        { userId: OTHER, groupId: "g4", role: "host", leftAt: null }
      ],
      sessions: [
        { groupId: "g1", startsAt: at(26 * HOUR + 59 * 60_000), status: "scheduled" },
        { groupId: "g2", startsAt: at(5 * DAY), status: "scheduled" },
        { groupId: "g2", startsAt: at(-HOUR), status: "completed" },
        { groupId: "g1", startsAt: at(2 * DAY), status: "removed" },
        { groupId: "g3", startsAt: at(HOUR), status: "scheduled" },
        { groupId: "g4", startsAt: at(HOUR), status: "scheduled" }
      ]
    }
  });
  assert.deepEqual(value.studyGroups, { groups: 2, hosting: 1, upcomingSessions: 2, nextSessionInHours: 26 });
  const far = state({ studyGroups: { groups: [{ id: "g1", status: "active" }], memberships: [{ userId: ME, groupId: "g1", role: "member", leftAt: null }], sessions: [{ groupId: "g1", startsAt: at(90 * DAY), status: "scheduled" }] } });
  assert.equal(far.studyGroups.nextSessionInHours, LEARNER_STATE_LIMITS.hoursMax, "clipped");
});

test("v7 learner state: the latest order (status, days ago) and the learner's enquiries", () => {
  const value = state({
    orders: [{ userId: ME, status: "paid", createdAt: at(-10 * DAY) }, { userId: ME, status: "failed", createdAt: at(-DAY - HOUR) }, { userId: OTHER, status: "pending", createdAt: at(-HOUR) }],
    tickets: [{ status: "OPEN" }, { status: "WAITING_USER" }, { status: "CLOSED" }, { status: "CANCELLED" }, { status: "PENDING_CONFIRM" }]
  });
  assert.deepEqual(value.latestOrder, { status: "failed", daysAgo: 1 });
  assert.deepEqual(value.tickets, { open: 3, waitingOnUser: 1 });
});

test("v7 learner state: never a name, email, order or plan id, amount or date", () => {
  const value = state({
    user: { createdAt: at(-5 * DAY), email: "secret.person@example.test", emailVerifiedAt: at(-4 * DAY) },
    subscriptions: [plan()], courses: [course("c1")], entitlements: [entitlement("c1")], studyRecords: [record("c1", { progress: 20 })],
    orders: [{ userId: ME, status: "paid", createdAt: at(-DAY) }]
  });
  const json = JSON.stringify(value);
  assert.doesNotMatch(json, /secret|example\.test|user_me|\d{4}-\d{2}-\d{2}/);
});
