import { createNotificationInData, notificationEmailRow, purgeExpiredNotificationRecordsInData } from "./core";
import { dispatchPendingNotificationEmails, sendNotificationEmailForUser, type SendEmail } from "./email";
import { editProductData, readProductData } from "../productStore";
import type { ProductData, ProductPlan, ProductSubscription, ProductUser } from "../productStore";

/**
 * Notification P0 schedulers (design §7).
 *
 * Renewal reminder: an in-process timer (the repository's existing
 * setInterval pattern) plus a stored per-HKT-day run marker; the message
 * itself is idempotent per billing period through its event key, so a second
 * instance or a manual rerun can never send it twice.
 *
 * Live Session reminder stays with the Study Group module's existing T-10
 * dispatch; its email is wrapped by services/emailService.ts and linked to the
 * in-app row there.
 *
 * Send-log clean-up: once per HKT day, deletes records older than 180 days.
 */

export const RENEWAL_REMINDER_DAYS_BEFORE = 5;
export const RENEWAL_REMINDER_HOUR_HKT = 10;
export const NOTIFICATION_JOB_TICK_MS = 60_000;

/** Per-process guards: after the first run of a day, ticks never touch storage again. */
let renewalDayRun = "";
let retentionDayRun = "";

const HKT = "Asia/Hong_Kong";
const DAY_MS = 86_400_000;

type HktParts = { year: number; month: number; day: number; hour: number; minute: number };

function hktParts(value: Date | string | number): HktParts | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: HKT,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

/** The HKT calendar day key, "YYYY-MM-DD". */
export function hktDayKey(value: Date | string | number): string {
  const parts = hktParts(value);
  if (!parts) return "";
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function hktHour(value: Date | string | number): number {
  return hktParts(value)?.hour ?? 0;
}

function dayNumber(key: string): number {
  const [year, month, day] = key.split("-").map(Number);
  if (!year || !month || !day) return Number.NaN;
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

/** True on the HKT calendar day exactly five days before the period end. */
export function isRenewalReminderDue(validTo: string, now: Date | string, daysBefore = RENEWAL_REMINDER_DAYS_BEFORE): boolean {
  const end = Date.parse(validTo);
  if (!Number.isFinite(end)) return false;
  const endDay = dayNumber(hktDayKey(new Date(end)));
  const today = dayNumber(hktDayKey(now));
  if (!Number.isFinite(endDay) || !Number.isFinite(today)) return false;
  return endDay - today === daysBefore;
}

/** Auto-renewal on, still active, and not superseded by an upgrade. */
export function renewalReminderEligible(subscription: ProductSubscription): boolean {
  if (subscription.source !== "purchase") return false;
  if (subscription.supersededBy) return false;
  if (subscription.state !== "active") return false;
  if (subscription.cancelAtPeriodEnd) return false;
  return true;
}

/** PRD §13.2 plan_name: "Everything · 12 months" (device is not part of the copy). */
function planDisplayName(plan: ProductPlan): string {
  return plan.name.replace(/\s*·\s*(PC|Mobile)\s*·/i, " · ").trim();
}

/** PRD §13.2 scope_name: "Everything" / a category / a course title. */
function planScopeName(plan: ProductPlan, data: ProductData): string {
  const scope = plan.scope === "category"
    ? { kind: "category" as const, id: plan.scopeId || plan.category || null }
    : plan.scope === "everything" || plan.courseId === "*"
      ? { kind: "everything" as const, id: "*" }
      : { kind: "course" as const, id: plan.scopeId || plan.courseId };
  if (scope.kind === "everything") return "Everything";
  if (scope.kind === "category") return scope.id || "All courses";
  return data.courses.find((course) => course.id === scope.id)?.title || scope.id || "Course";
}

export function renewalReminderParams(plan: ProductPlan, subscription: ProductSubscription, user: ProductUser, data: ProductData): Record<string, unknown> {
  return {
    plan_name: planDisplayName(plan),
    scope_name: planScopeName(plan, data),
    renewal_date: subscription.validTo,
    renewal_amount: plan.amountMinor,
    user_name: (user.nickname || "").trim() || "there",
  };
}

export type NotificationJobState = {
  renewalReminderDay?: string;
  retentionDay?: string;
};

type NotificationJobData = ProductData & { notificationJobState?: NotificationJobState };

export type RenewalReminderSummary = {
  ran: boolean;
  reason?: "before_window" | "already_ran";
  due: number;
  created: number;
  emailsSent: number;
  emailsFailed: number;
  skipped: number;
};

type RenewalClaim = {
  ran: boolean;
  reason?: "before_window" | "already_ran";
  due: number;
  created: number;
  skipped: number;
  jobs: Array<{ userId: string; notificationId: string; params: Record<string, unknown>; related: string }>;
};

/**
 * The daily renewal reminder. Runs on the first scheduler tick at/after 10:00
 * HKT (a manual run may force another time), once per HKT day; the billing
 * period event key makes a rerun a no-op. The in-app row is written inside the
 * serialised product transaction; the email is sent afterwards so SMTP never
 * holds that lock.
 */
export async function runRenewalReminderJob(options: {
  now?: Date | string;
  appUrl?: string;
  send?: SendEmail;
  force?: boolean;
} = {}): Promise<RenewalReminderSummary> {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const nowIso = now.toISOString();
  const day = hktDayKey(now);
  if (!options.force && hktHour(now) < RENEWAL_REMINDER_HOUR_HKT) {
    return { ran: false, reason: "before_window", due: 0, created: 0, emailsSent: 0, emailsFailed: 0, skipped: 0 };
  }
  if (!options.force && renewalDayRun === day) {
    return { ran: false, reason: "already_ran", due: 0, created: 0, emailsSent: 0, emailsFailed: 0, skipped: 0 };
  }
  // Read-only pre-check: a day with nothing due must not open a write transaction.
  const snapshot = await readProductData();
  if (!snapshot.subscriptions.some((subscription) => renewalReminderEligible(subscription) && isRenewalReminderDue(subscription.validTo, now))) {
    renewalDayRun = day;
    return { ran: true, due: 0, created: 0, emailsSent: 0, emailsFailed: 0, skipped: 0 };
  }

  const claim: RenewalClaim = await editProductData((data) => {
    const state = ((data as NotificationJobData).notificationJobState ||= {});
    if (!options.force && state.renewalReminderDay === day) {
      return { ran: false, reason: "already_ran", due: 0, created: 0, skipped: 0, jobs: [] };
    }
    let due = 0;
    let skipped = 0;
    const jobs: RenewalClaim["jobs"] = [];
    for (const subscription of data.subscriptions) {
      if (!renewalReminderEligible(subscription)) continue;
      if (!isRenewalReminderDue(subscription.validTo, now)) continue;
      due += 1;
      const user = data.users.find((item) => item.id === subscription.userId);
      if (!user || user.status !== "active" || user.deactivatedAt || user.mergedIntoUserId) {
        skipped += 1;
        continue;
      }
      const plan = data.plans.find((item) => item.id === subscription.planId);
      if (!plan) {
        skipped += 1;
        continue;
      }
      const params = renewalReminderParams(plan, subscription, user, data);
      const result = createNotificationInData(data, {
        userId: user.id,
        templateId: "SUB_RENEWAL_REMINDER",
        eventKey: `${subscription.id}:${subscription.validTo}:SUB_RENEWAL_REMINDER`,
        params,
        related: subscription.id,
        now: nowIso,
      });
      if (!result.created) {
        skipped += 1;
        continue;
      }
      // Claim the email now: the dispatcher skips the row for its lease while this job sends it.
      notificationEmailRow(result.notification).emailClaimedAt = nowIso;
      jobs.push({ userId: user.id, notificationId: result.notification.id, params, related: subscription.id });
    }
    state.renewalReminderDay = day;
    return { ran: true, due, created: jobs.length, skipped, jobs };
  });

  if (!claim.ran) {
    if (claim.reason === "already_ran") renewalDayRun = day;
    return { ran: false, reason: claim.reason, due: 0, created: 0, emailsSent: 0, emailsFailed: 0, skipped: 0 };
  }
  renewalDayRun = day;

  let emailsSent = 0;
  let emailsFailed = 0;
  for (const job of claim.jobs) {
    const result = await sendNotificationEmailForUser({
      userId: job.userId,
      templateId: "SUB_RENEWAL_REMINDER",
      params: job.params,
      notificationId: job.notificationId,
      related: job.related,
      now: nowIso,
      appUrl: options.appUrl,
      send: options.send,
    });
    if (result.ok) emailsSent += 1;
    else emailsFailed += 1;
  }
  return { ran: true, due: claim.due, created: claim.created, emailsSent, emailsFailed, skipped: claim.skipped };
}

export type RetentionSummary = {
  ran: boolean;
  reason?: "already_ran";
  notifications: number;
  logs: number;
};

/** Delete notification and log rows older than 180 days, once per HKT day. */
export async function runNotificationRetentionJob(options: { now?: Date | string; force?: boolean } = {}): Promise<RetentionSummary> {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const day = hktDayKey(now);
  if (!options.force && retentionDayRun === day) {
    return { ran: false, reason: "already_ran", notifications: 0, logs: 0 };
  }
  const result: RetentionSummary = await editProductData((data): RetentionSummary => {
    const state = ((data as NotificationJobData).notificationJobState ||= {});
    if (!options.force && state.retentionDay === day) {
      return { ran: false, reason: "already_ran", notifications: 0, logs: 0 };
    }
    const purged = purgeExpiredNotificationRecordsInData(data, now);
    state.retentionDay = day;
    return { ran: true, ...purged };
  });
  if (result.ran || result.reason === "already_ran") retentionDayRun = day;
  return result;
}

export type NotificationJobsSummary = {
  renewal: RenewalReminderSummary;
  emails: Awaited<ReturnType<typeof dispatchPendingNotificationEmails>>;
  retention: RetentionSummary;
};

/** One scheduler tick, also exposed to the internal operations route. */
export async function runNotificationJobsOnce(options: {
  now?: Date | string;
  appUrl?: string;
  send?: SendEmail;
  force?: boolean;
} = {}): Promise<NotificationJobsSummary> {
  const renewal = await runRenewalReminderJob(options);
  const emails = await dispatchPendingNotificationEmails({ now: options.now, appUrl: options.appUrl, send: options.send });
  const retention = await runNotificationRetentionJob({ now: options.now, force: options.force });
  return { renewal, emails, retention };
}

type SchedulerHolder = typeof globalThis & {
  __lgNotificationSchedulerTimer?: ReturnType<typeof setInterval>;
  __lgNotificationSchedulerRunning?: boolean;
};

/**
 * Start the in-process timer once per process. The first tick is delayed by one
 * interval; a slow tick (SMTP is bounded at 20 s per recipient) never overlaps
 * the next one; failures are logged as a redacted type line and the timer keeps
 * going. Unref'd so it never keeps a process alive.
 */
export function startNotificationScheduler(): void {
  const holder = globalThis as SchedulerHolder;
  if (holder.__lgNotificationSchedulerTimer) return;
  const timer = setInterval(() => {
    if (holder.__lgNotificationSchedulerRunning) return;
    holder.__lgNotificationSchedulerRunning = true;
    void runNotificationJobsOnce()
      .then((result) => {
        if (result.renewal.created > 0 || result.emails.attempted > 0 || result.retention.ran) {
          console.info(JSON.stringify({
            type: "notifications.jobs",
            renewal: { created: result.renewal.created, sent: result.renewal.emailsSent, failed: result.renewal.emailsFailed },
            emailDispatch: result.emails,
            retention: { notifications: result.retention.notifications, logs: result.retention.logs },
          }));
        }
      })
      .catch(() => console.info(JSON.stringify({ type: "notifications.jobs_failed" })))
      .finally(() => { holder.__lgNotificationSchedulerRunning = false; });
  }, NOTIFICATION_JOB_TICK_MS);
  timer.unref?.();
  holder.__lgNotificationSchedulerTimer = timer;
}

export function stopNotificationScheduler(): void {
  const holder = globalThis as SchedulerHolder;
  if (!holder.__lgNotificationSchedulerTimer) return;
  clearInterval(holder.__lgNotificationSchedulerTimer);
  holder.__lgNotificationSchedulerTimer = undefined;
  holder.__lgNotificationSchedulerRunning = false;
}
