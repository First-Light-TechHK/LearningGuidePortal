// Read-only BackOffice projection of existing Portal data for the HelpDesk
// right panel (Figma 1324:2 "Student Information" / "Current Subscription
// Plan"). Pure: it never writes, and it reads only what the account,
// study-record and subscription owners already store.
import type { SubscriptionProjection } from "@/contracts/helpdesk";
import type { ProductCourse, ProductPlan, ProductStudyRecord, ProductSubscription, ProductUser } from "@/services/productStore";

export type StudentSource = {
  users: Array<Pick<ProductUser, "id" | "email" | "nickname" | "createdAt">>;
  plans: Array<Pick<ProductPlan, "id" | "name" | "termMonths">>;
  subscriptions: Array<Pick<ProductSubscription, "id" | "userId" | "planId" | "state" | "source" | "validFrom" | "validTo" | "cancelAtPeriodEnd"> & { graceEndsAt?: string | null }>;
  studyRecords: Array<Pick<ProductStudyRecord, "userId" | "courseId" | "updatedAt">>;
  courses: Array<Pick<ProductCourse, "id" | "title">>;
};

export type StudentDirectoryEntry = {
  name: string;
  /** null for accounts without an email (for example WeChat sign-in). */
  accountEmail: string | null;
  joinedAt: string | null;
  currentCourse: { id: string; title: string } | null;
  subscription: SubscriptionProjection | null;
};

const LIVE_STATES = ["active", "cancel_at_period_end", "grace"] as const;
type LiveState = (typeof LIVE_STATES)[number];

function liveUntil(subscription: StudentSource["subscriptions"][number]) {
  return Date.parse(subscription.state === "grace" ? subscription.graceEndsAt || subscription.validTo : subscription.validTo);
}

function currentSubscription(source: StudentSource, userId: string, now: Date): SubscriptionProjection | null {
  const live = source.subscriptions
    .filter((item) => item.userId === userId && (LIVE_STATES as readonly string[]).includes(item.state) && liveUntil(item) > now.getTime())
    .sort((a, b) => Date.parse(b.validTo) - Date.parse(a.validTo));
  const subscription = live[0];
  if (!subscription) return null;
  const plan = source.plans.find((item) => item.id === subscription.planId);
  const status = subscription.state as LiveState;
  return {
    planName: plan?.name || subscription.planId,
    billingCycle: plan ? (plan.termMonths === 12 ? "annual" : "semiannual") : null,
    status,
    trial: subscription.source === "trial",
    renewalDate: status === "active" && !subscription.cancelAtPeriodEnd ? subscription.validTo : null,
    validTo: subscription.validTo
  };
}

function currentCourse(source: StudentSource, userId: string) {
  const records = source.studyRecords.filter((item) => item.userId === userId).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  for (const record of records) {
    const course = source.courses.find((item) => item.id === record.courseId);
    if (course) return { id: course.id, title: course.title };
  }
  return null;
}

export function projectStudent(source: StudentSource, userId: string, now: Date): StudentDirectoryEntry | null {
  const user = source.users.find((item) => item.id === userId);
  if (!user) return null;
  return {
    name: user.nickname,
    accountEmail: user.email || null,
    joinedAt: user.createdAt || null,
    currentCourse: currentCourse(source, userId),
    subscription: currentSubscription(source, userId, now)
  };
}
