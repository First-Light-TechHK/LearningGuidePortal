import assert from "node:assert/strict";
import { test } from "node:test";
import { projectStudent, type StudentSource } from "../../modules/helpdesk/studentDirectory";

const NOW = new Date("2026-10-28T06:00:00.000Z");

function source(overrides: Partial<StudentSource> = {}): StudentSource {
  return {
    users: [
      { id: "u1", email: "emily.carter@example.com", nickname: "Emily Carter", createdAt: "2024-01-15T09:00:00.000Z" },
      { id: "u2", email: null, nickname: "WeChat Learner", createdAt: "2025-03-01T00:00:00.000Z" }
    ],
    plans: [
      { id: "plan-annual", name: "Everything · PC · 12 months", termMonths: 12 },
      { id: "plan-half", name: "Science · PC · 6 months", termMonths: 6 }
    ],
    subscriptions: [
      { id: "s-old", userId: "u1", planId: "plan-half", state: "expired", source: "purchase", validFrom: "2024-01-15T00:00:00.000Z", validTo: "2024-07-15T00:00:00.000Z", cancelAtPeriodEnd: false },
      { id: "s-live", userId: "u1", planId: "plan-annual", state: "active", source: "purchase", validFrom: "2026-01-15T00:00:00.000Z", validTo: "2027-01-15T00:00:00.000Z", cancelAtPeriodEnd: false },
      { id: "s-other", userId: "u2", planId: "plan-annual", state: "active", source: "purchase", validFrom: "2026-01-15T00:00:00.000Z", validTo: "2027-01-15T00:00:00.000Z", cancelAtPeriodEnd: false }
    ],
    studyRecords: [
      { userId: "u1", courseId: "c-old", updatedAt: "2026-09-01T00:00:00.000Z" },
      { userId: "u1", courseId: "c-new", updatedAt: "2026-10-27T00:00:00.000Z" },
      { userId: "u2", courseId: "c-old", updatedAt: "2026-10-28T00:00:00.000Z" }
    ],
    courses: [{ id: "c-old", title: "Epicureanism" }, { id: "c-new", title: "Advanced Web Development" }],
    ...overrides
  };
}

test("student projection: account email, joined date, Portal user id and the most recently studied course", () => {
  const entry = projectStudent(source(), "u1", NOW);
  assert.deepEqual({ ...entry, subscription: undefined }, {
    name: "Emily Carter",
    accountEmail: "emily.carter@example.com",
    joinedAt: "2024-01-15T09:00:00.000Z",
    currentCourse: { id: "c-new", title: "Advanced Web Development" },
    subscription: undefined
  });
  assert.equal(projectStudent(source(), "missing", NOW), null);
  assert.equal(projectStudent(source(), "u2", NOW)?.accountEmail, null, "a WeChat-only account has no account email");
});

test("current course skips records whose course no longer exists", () => {
  const entry = projectStudent(source({ courses: [{ id: "c-old", title: "Epicureanism" }] }), "u1", NOW);
  assert.deepEqual(entry?.currentCourse, { id: "c-old", title: "Epicureanism" });
  assert.equal(projectStudent(source({ studyRecords: [] }), "u1", NOW)?.currentCourse, null);
});

test("subscription projection: the live plan with the latest end, its billing cycle and renewal date", () => {
  assert.deepEqual(projectStudent(source(), "u1", NOW)?.subscription, {
    planName: "Everything · PC · 12 months", billingCycle: "annual", status: "active", trial: false,
    renewalDate: "2027-01-15T00:00:00.000Z", validTo: "2027-01-15T00:00:00.000Z"
  });
  const cancelling = source();
  cancelling.subscriptions[1] = { ...cancelling.subscriptions[1], state: "cancel_at_period_end", cancelAtPeriodEnd: true, planId: "plan-half", source: "trial" };
  assert.deepEqual(projectStudent(cancelling, "u1", NOW)?.subscription, {
    planName: "Science · PC · 6 months", billingCycle: "semiannual", status: "cancel_at_period_end", trial: true,
    renewalDate: null, validTo: "2027-01-15T00:00:00.000Z"
  });
});

test("no live subscription (none, expired, or past its end date) projects to null", () => {
  assert.equal(projectStudent(source({ subscriptions: [] }), "u1", NOW)?.subscription, null);
  const lapsed = source();
  lapsed.subscriptions = lapsed.subscriptions.filter((item) => item.id !== "s-live");
  assert.equal(projectStudent(lapsed, "u1", NOW)?.subscription, null);
  const pastEnd = source();
  pastEnd.subscriptions[1] = { ...pastEnd.subscriptions[1], validTo: "2026-10-01T00:00:00.000Z" };
  assert.equal(projectStudent(pastEnd, "u1", NOW)?.subscription, null);
  const graceOk = source();
  graceOk.subscriptions[1] = { ...graceOk.subscriptions[1], state: "grace", validTo: "2026-10-01T00:00:00.000Z", graceEndsAt: "2026-11-01T00:00:00.000Z" };
  assert.equal(projectStudent(graceOk, "u1", NOW)?.subscription?.status, "grace");
  const unknownPlan = source();
  unknownPlan.subscriptions[1] = { ...unknownPlan.subscriptions[1], planId: "gone" };
  const unknown = projectStudent(unknownPlan, "u1", NOW)?.subscription;
  assert.equal(unknown?.planName, "gone", "a deleted plan still shows its id");
  assert.equal(unknown?.billingCycle, null);
});
