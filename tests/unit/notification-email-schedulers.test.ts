import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import nodemailer from "nodemailer";
import { purchaseCourse, verifiedUser } from "./helpers/my-learning";

/**
 * Notification P0 Phase 2 (design §6/§7): the three transactional emails,
 * their fixed HTML layout, SMTP Sent/Failed logging, the daily renewal
 * reminder, the deferred email dispatcher, the T-10 Live Session email
 * wrapper and the 180-day clean-up job.
 *
 * Red-first: written before services/notifications/{email,emailLayout,emailLog,scheduler}.ts
 * existed, so the module imports below failed with MODULE_NOT_FOUND.
 */

const originalCwd = process.cwd();
const originalStorageBackend = process.env.STORAGE_BACKEND;
const originalEnvironment = { ...process.env };
let isolatedCwd: string;
let store: typeof import("../../services/productStore");
let notifications: typeof import("../../services/notifications/service");
let email: typeof import("../../services/notifications/email");
let scheduler: typeof import("../../services/notifications/scheduler");
let emailService: typeof import("../../services/emailService");
let emailLog: typeof import("../../services/notifications/emailLog");

const APP_URL = "https://learningguide.test";

type Mail = { to: string; subject: string; text: string; html?: string };
let mails: Mail[] = [];
let transportMode: "ok" | "fail" = "ok";
let originalCreateTransport: typeof nodemailer.createTransport;

before(async () => {
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-notification-email-"));
  process.chdir(isolatedCwd);
  process.env.STORAGE_BACKEND = "local";
  process.env.NEXT_PUBLIC_APP_URL = APP_URL;
  process.env.SMTP_HOST = "smtp.example.test";
  process.env.SMTP_USER = "sender@example.test";
  process.env.SMTP_PASS = "test-only";
  process.env.SMTP_FROM = "Learning Guide <no-reply@example.test>";
  originalCreateTransport = nodemailer.createTransport;
  nodemailer.createTransport = (() => ({
    sendMail: async (mail: Mail) => {
      if (transportMode === "fail") throw Object.assign(new Error("smtp unavailable"), { code: "ETIMEDOUT" });
      mails.push(mail);
      return { messageId: `<${mails.length}@example.test>`, accepted: [mail.to], rejected: [] };
    },
  })) as unknown as typeof nodemailer.createTransport;

  store = await import("../../services/productStore");
  notifications = await import("../../services/notifications/service");
  email = await import("../../services/notifications/email");
  scheduler = await import("../../services/notifications/scheduler");
  emailService = await import("../../services/emailService");
  emailLog = await import("../../services/notifications/emailLog");
  await store.ensureProductData();
  await store.persistDataMigrations();
});

after(async () => {
  nodemailer.createTransport = originalCreateTransport;
  process.chdir(originalCwd);
  process.env = originalEnvironment;
  if (isolatedCwd && path.dirname(isolatedCwd) === tmpdir()) await rm(isolatedCwd, { recursive: true, force: true });
});

beforeEach(() => {
  mails = [];
  transportMode = "ok";
});

async function cleanUser(emailAddress: string, nickname = "Margaret") {
  const user = await verifiedUser(store, emailAddress, nickname);
  await store.editProductData((data) => {
    data.notifications = data.notifications.filter((item) => item.userId !== user.id);
    data.notificationLog = (data.notificationLog || []).filter((item) => item.userId !== user.id);
    const logIds = new Set((data.notificationLog || []).map((item) => item.id));
    data.notificationEmailDeliveries = (data.notificationEmailDeliveries || []).filter((item) => logIds.has(item.logId));
  });
  return user;
}

async function activeSubscription(userId: string, patch: Partial<{ validTo: string; cancelAtPeriodEnd: boolean; state: "active" | "cancel_at_period_end" | "grace" | "expired" }> = {}) {
  await purchaseCourse(store, userId);
  const subscriptionId = await store.editProductData((data) => {
    const subscription = data.subscriptions
      .filter((item) => item.userId === userId && item.source === "purchase" && !item.supersededBy)
      .sort((left, right) => right.validTo.localeCompare(left.validTo))[0];
    Object.assign(subscription, { state: "active", cancelAtPeriodEnd: false, graceEndsAt: null }, patch);
    return subscription.id;
  });
  const data = await store.ensureProductData();
  return data.subscriptions.find((item) => item.id === subscriptionId)!;
}

/* ------------------------------------------------------------------ *
 * §6 fixed layout and rendering
 * ------------------------------------------------------------------ */

test("renewal reminder email renders the fixed layout, HKT date, amount and app deep link", async () => {
  const rendered = email.renderNotificationEmail({
    templateId: "SUB_RENEWAL_REMINDER",
    locale: "en-GB",
    appUrl: APP_URL,
    now: "2026-12-11T02:00:00.000Z",
    params: {
      plan_name: "Everything · 12 months",
      scope_name: "Everything",
      renewal_date: "2026-12-16T02:00:00.000Z",
      renewal_amount: 14900,
      user_name: "Margaret",
    },
  });
  assert.equal(rendered.subject, "Your subscription renews soon");
  assert.match(rendered.html, /data-email-layout="notification-p0"/);
  assert.match(rendered.html, /Learning Guide/);
  assert.match(rendered.html, /Hi Margaret,/);
  assert.match(rendered.html, /16 Dec 2026/);
  assert.match(rendered.html, /US\$149\.00/);
  assert.match(rendered.html, /href="https:\/\/learningguide\.test\/en-GB\/my-learning\/subscription"/);
  assert.match(rendered.html, /Privacy policy/);
  assert.match(rendered.text, /16 Dec 2026/);
  assert.match(rendered.text, /US\$149\.00/);
});

test("live session email renders session date and time with (HKT), Chinese included", () => {
  const params = {
    session_title: "Reading Plato's Republic",
    group_name: "Philosophy Circle",
    session_date: "2026-11-12T10:00:00.000Z",
    session_time: "2026-11-12T11:00:00.000Z",
    session_link: "/portal/study-groups/sessions/1",
    user_name: "Margaret",
  };
  const en = email.renderNotificationEmail({ templateId: "LIVE_SESSION_REMINDER", locale: "en-GB", appUrl: APP_URL, params });
  assert.match(en.html, /12 Nov 2026/);
  assert.match(en.html, /7:00 PM \(HKT\)/);
  assert.match(en.html, /href="https:\/\/learningguide\.test\/en-GB\/portal\/study-groups\/sessions\/1"/);
  const zh = email.renderNotificationEmail({ templateId: "LIVE_SESSION_REMINDER", locale: "zh-CN", appUrl: APP_URL, params });
  assert.match(zh.html, /2026年11月12日/);
  assert.match(zh.html, /19:00 \(HKT\)/);
});

test("a missing variable blocks the email and is reported as missing data", () => {
  assert.throws(
    () => email.renderNotificationEmail({
      templateId: "SUB_RENEWAL_REMINDER",
      locale: "en-GB",
      appUrl: APP_URL,
      params: { plan_name: "Everything · 12 months", renewal_date: "2026-12-16T02:00:00.000Z", user_name: "Margaret" },
    }),
    (error: unknown) => error instanceof Error && error.name === "MissingNotificationDataError",
  );
});

/* ------------------------------------------------------------------ *
 * §6 SMTP Sent / Failed logging (never Delivered without a provider receipt)
 * ------------------------------------------------------------------ */

test("a successful SMTP send records Sent plus a sent delivery row, never Delivered", async () => {
  const user = await cleanUser("email-sent@example.test");
  const result = await email.sendNotificationEmailForUser({
    userId: user.id,
    templateId: "SUB_RENEWAL_REMINDER",
    appUrl: APP_URL,
    params: { plan_name: "Everything · 12 months", renewal_date: "2026-12-16T02:00:00.000Z", renewal_amount: 14900, user_name: "Margaret" },
  });
  assert.equal(result.ok, true);
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, user.email);
  assert.match(String(mails[0].html), /data-email-layout="notification-p0"/);
  const data = await store.ensureProductData();
  const logs = (data.notificationLog || []).filter((item) => item.userId === user.id && item.channel === "email");
  assert.equal(logs.length, 1);
  assert.equal(logs[0].status, "sent");
  assert.equal(logs[0].templateId, "SUB_RENEWAL_REMINDER");
  const deliveries = (data.notificationEmailDeliveries || []).filter((item) => item.logId === logs[0].id);
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].status, "sent");
  assert.notEqual(String(deliveries[0].status), "delivered", "SMTP has no delivery receipt");
  assert.ok(deliveries[0].providerMessageId);
});

test("a provider receipt is the only path from Sent to Delivered", async () => {
  const user = await cleanUser("email-receipt@example.test");
  const result = await email.sendNotificationEmailForUser({
    userId: user.id,
    templateId: "SUB_RENEWAL_REMINDER",
    appUrl: APP_URL,
    params: { plan_name: "Everything · 12 months", renewal_date: "2026-12-16T02:00:00.000Z", renewal_amount: 14900, user_name: "Margaret" },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  let data = await store.ensureProductData();
  assert.equal((data.notificationEmailDeliveries || []).find((item) => item.logId === result.logId)?.status, "sent");
  const receipt = await emailLog.recordEmailDeliveryReceipt({ logId: result.logId, providerMessageId: "receipt-1", deliveredAt: "2026-12-11T02:01:00.000Z" });
  assert.equal(receipt.ok, true);
  data = await store.ensureProductData();
  const delivery = (data.notificationEmailDeliveries || []).find((item) => item.logId === result.logId);
  assert.equal(delivery?.status, "delivered");
  assert.equal(delivery?.providerMessageId, "receipt-1");
  assert.equal((data.notificationLog || []).some((item) => item.id === receipt.logId && item.status === "delivered"), true);
});

test("an SMTP failure records Failed with the provider reason and keeps the in-app message", async () => {
  const user = await cleanUser("email-failed@example.test");
  const event = await notifications.emitNotificationEvent({
    eventType: "SUB_RENEWAL_FAILED",
    eventKey: "failed:smtp:1",
    userId: user.id,
    params: {
      plan_name: "Everything · 12 months",
      scope_name: "Everything",
      renewal_amount: 14900,
      grace_end_date: "2026-12-19T02:00:00.000Z",
      user_name: "Margaret",
    },
  });
  assert.equal(event.created, true);
  transportMode = "fail";
  const summary = await email.dispatchPendingNotificationEmails({ appUrl: APP_URL });
  assert.equal(summary.attempted, 1);
  assert.equal(summary.failed, 1);
  const data = await store.ensureProductData();
  assert.equal(data.notifications.some((item) => item.userId === user.id && item.templateId === "SUB_RENEWAL_FAILED"), true);
  const failed = (data.notificationLog || []).filter((item) => item.userId === user.id && item.channel === "email");
  assert.equal(failed.length, 1);
  assert.equal(failed[0].status, "failed");
  assert.equal(failed[0].failureReason, "provider error");
  assert.equal((data.notificationEmailDeliveries || []).find((item) => item.logId === failed[0].id)?.status, "failed");
});

test("an unverified email is not sent and is logged as Failed email not verified", async () => {
  const user = await store.registerUser({ email: "email-unverified@example.test", password: "password1", nickname: "Margaret" });
  const result = await email.sendNotificationEmailForUser({
    userId: user.id,
    templateId: "SUB_RENEWAL_REMINDER",
    appUrl: APP_URL,
    params: { plan_name: "Everything · 12 months", renewal_date: "2026-12-16T02:00:00.000Z", renewal_amount: 14900, user_name: "Margaret" },
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "email_not_verified");
  assert.equal(mails.length, 0);
  const data = await store.ensureProductData();
  const log = (data.notificationLog || []).find((item) => item.userId === user.id && item.channel === "email");
  assert.equal(log?.status, "failed");
  assert.equal(log?.failureReason, "email not verified");
});

/* ------------------------------------------------------------------ *
 * §7 daily renewal reminder (10:00 HKT, 5 days before, per billing period)
 * ------------------------------------------------------------------ */

test("renewal reminder: due only five HKT days before the period end and not before 10:00 HKT", () => {
  const periodEnd = "2026-12-16T02:00:00.000Z"; // 10:00 HKT
  assert.equal(scheduler.isRenewalReminderDue(periodEnd, new Date("2026-12-11T02:00:00.000Z")), true);
  assert.equal(scheduler.isRenewalReminderDue(periodEnd, new Date("2026-12-11T01:59:00.000Z")), true, "HKT day, not the instant");
  assert.equal(scheduler.isRenewalReminderDue(periodEnd, new Date("2026-12-10T02:00:00.000Z")), false, "six days before");
  assert.equal(scheduler.isRenewalReminderDue(periodEnd, new Date("2026-12-12T02:00:00.000Z")), false, "four days before");
});

test("renewal reminder job creates one in-app message and one email per billing period", async () => {
  const user = await cleanUser("renewal-due@example.test");
  const subscription = await activeSubscription(user.id, { validTo: "2026-12-16T02:00:00.000Z" });
  const now = new Date("2026-12-11T02:00:00.000Z");
  const first = await scheduler.runRenewalReminderJob({ now, appUrl: APP_URL });
  assert.equal(first.ran, true);
  assert.equal(first.created, 1);
  assert.equal(first.emailsSent, 1);
  assert.equal(mails.length, 1);
  assert.equal(mails[0].subject, "Your subscription renews soon");
  assert.match(String(mails[0].html), /16 Dec 2026/);

  const data = await store.ensureProductData();
  const rows = data.notifications.filter((item) => item.userId === user.id && item.templateId === "SUB_RENEWAL_REMINDER");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].eventKey, `${subscription.id}:2026-12-16T02:00:00.000Z:SUB_RENEWAL_REMINDER`);
  assert.equal(rows[0].category, "subscription");
  const emailLogs = (data.notificationLog || []).filter((item) => item.notificationId === rows[0].id && item.channel === "email");
  assert.equal(emailLogs.length, 1);
  assert.equal(emailLogs[0].status, "sent");

  const second = await scheduler.runRenewalReminderJob({ now, force: true, appUrl: APP_URL });
  assert.equal(second.created, 0, "the billing period is idempotent");
  assert.equal(mails.length, 1, "no second email");
});

test("a second instance's dispatcher does not mail a renewal row the job is already sending (N2)", async () => {
  const user = await cleanUser("renewal-claim@example.test");
  await activeSubscription(user.id, { validTo: "2027-01-16T02:00:00.000Z" });
  const now = new Date("2027-01-11T02:00:00.000Z");
  let calls = 0;
  let dispatched: Awaited<ReturnType<typeof email.dispatchPendingNotificationEmails>> | null = null;
  const send: import("../../services/notifications/email").SendEmail = async (input) => {
    calls += 1;
    if (calls === 1) dispatched = await email.dispatchPendingNotificationEmails({ now, appUrl: APP_URL, send });
    mails.push({ to: input.to, subject: input.subject, text: input.text, html: input.html });
    return { messageId: "<claim@example.test>" };
  };
  const summary = await scheduler.runRenewalReminderJob({ now, force: true, appUrl: APP_URL, send });
  assert.equal(summary.emailsSent, 1);
  assert.equal(dispatched!.attempted, 0, "the dispatcher skips the claimed row");
  assert.equal(calls, 1, "one send in total");
  const data = await store.ensureProductData();
  const row = data.notifications.find((item) => item.userId === user.id && item.templateId === "SUB_RENEWAL_REMINDER")!;
  assert.equal((data.notificationLog || []).filter((item) => item.notificationId === row.id && item.channel === "email").length, 1);
});

test("renewal reminder is skipped when auto-renewal is off, six days out, or before 10:00 HKT", async () => {
  const off = await cleanUser("renewal-off@example.test");
  await activeSubscription(off.id, { validTo: "2026-12-16T02:00:00.000Z", cancelAtPeriodEnd: true });
  const sixDays = await cleanUser("renewal-six@example.test");
  await activeSubscription(sixDays.id, { validTo: "2026-12-17T02:00:00.000Z" });
  const due = await cleanUser("renewal-window@example.test");
  await activeSubscription(due.id, { validTo: "2026-12-16T02:00:00.000Z" });

  const beforeTen = await scheduler.runRenewalReminderJob({ now: new Date("2026-12-11T01:00:00.000Z"), appUrl: APP_URL });
  assert.equal(beforeTen.ran, false);
  assert.equal(beforeTen.reason, "before_window");

  const ten = await scheduler.runRenewalReminderJob({ now: new Date("2026-12-11T02:00:00.000Z"), force: true, appUrl: APP_URL });
  assert.equal(ten.ran, true);
  assert.equal(ten.created, 1, "only the five-days, auto-renew-on subscription is due");
  const data = await store.ensureProductData();
  assert.equal(data.notifications.some((item) => item.userId === off.id && item.templateId === "SUB_RENEWAL_REMINDER"), false);
  assert.equal(data.notifications.some((item) => item.userId === sixDays.id && item.templateId === "SUB_RENEWAL_REMINDER"), false);
  assert.equal(data.notifications.some((item) => item.userId === due.id && item.templateId === "SUB_RENEWAL_REMINDER"), true);
});

/* ------------------------------------------------------------------ *
 * §6 deferred email for events written outside the notification service
 * ------------------------------------------------------------------ */

test("the dispatcher sends the renewal-failed email written by the subscription write point, once", async () => {
  const user = await cleanUser("renewal-failed-email@example.test");
  const event = await notifications.emitNotificationEvent({
    eventType: "SUB_RENEWAL_FAILED",
    eventKey: "failed:dispatch:1",
    userId: user.id,
    params: {
      plan_name: "Everything · 12 months",
      scope_name: "Everything",
      renewal_amount: 14900,
      grace_end_date: "2026-12-19T02:00:00.000Z",
      user_name: "Margaret",
    },
  });
  assert.equal(event.created, true);
  const first = await email.dispatchPendingNotificationEmails({ appUrl: APP_URL });
  assert.equal(first.attempted, 1);
  assert.equal(first.sent, 1);
  assert.equal(mails.length, 1);
  assert.equal(mails[0].subject, "Action needed: your renewal payment didn't go through");
  assert.match(String(mails[0].html), /19 Dec 2026/);
  assert.match(String(mails[0].html), /US\$149\.00/);
  const second = await email.dispatchPendingNotificationEmails({ appUrl: APP_URL });
  assert.equal(second.attempted, 0);
  assert.equal(mails.length, 1);
});

/* ------------------------------------------------------------------ *
 * §7 Live Session reminder: the existing T-10 write point's email gets the
 * fixed layout and a Sent/Failed record.
 * ------------------------------------------------------------------ */

test("the T-10 Live Session email uses the fixed layout, app deep link and records Sent", async () => {
  const user = await cleanUser("live-session-mail@example.test");
  const notification = await store.recordUserNotification(
    user.id,
    "Live Session reminder",
    'Reading Plato\'s Republic in the Study Group "Philosophy Circle" starts in 10 minutes.',
    "session-1",
    {
      "en-GB": { title: "Live Session reminder", body: "Reading Plato's Republic starts in 10 minutes." },
      "zh-CN": { title: "直播课提醒", body: "《理想国》将在 10 分钟后开始。" },
    },
  );
  await emailService.sendStudyGroupReminderEmail({
    to: user.email!,
    subject: "Live Session reminder",
    text: "Reading Plato's Republic starts in 10 minutes.",
    link: "/portal/study-groups/sessions/session-1",
    locale: "en-GB",
  });
  assert.equal(mails.length, 1);
  assert.match(String(mails[0].html), /data-email-layout="notification-p0"/);
  assert.match(String(mails[0].html), /href="https:\/\/learningguide\.test\/portal\/study-groups\/sessions\/session-1"/);
  const data = await store.ensureProductData();
  const log = (data.notificationLog || []).find((item) => item.notificationId === notification.id && item.channel === "email");
  assert.equal(log?.status, "sent");
  assert.equal(log?.templateId, "LIVE_SESSION_REMINDER");
  assert.equal((data.notificationEmailDeliveries || []).find((item) => item.logId === log?.id)?.status, "sent");
});

test("a Live Session email failure is recorded as Failed and re-thrown to the caller", async () => {
  const user = await cleanUser("live-session-mail-fail@example.test");
  const notification = await store.recordUserNotification(user.id, "Live Session reminder", "Starts in 10 minutes.", "session-2");
  transportMode = "fail";
  await assert.rejects(
    () => emailService.sendStudyGroupReminderEmail({ to: user.email!, subject: "Live Session reminder", text: "Starts in 10 minutes.", link: "/portal/study-groups/sessions/session-2", locale: "en-GB" }),
    (error: unknown) => error instanceof Error && error.name === "EmailDeliveryError",
  );
  const data = await store.ensureProductData();
  const log = (data.notificationLog || []).find((item) => item.notificationId === notification.id && item.channel === "email");
  assert.equal(log?.status, "failed");
  assert.equal(log?.failureReason, "provider error");
});

/* ------------------------------------------------------------------ *
 * §7 180-day clean-up
 * ------------------------------------------------------------------ */

test("retention job removes notification, log and delivery rows older than 180 days", async () => {
  const user = await cleanUser("retention@example.test");
  const now = new Date("2026-12-11T02:00:00.000Z");
  const old = new Date(now.getTime() - 200 * 86400000).toISOString();
  const fresh = new Date(now.getTime() - 10 * 86400000).toISOString();
  await store.editProductData((data) => {
    data.notifications.unshift(
      { id: "notification_old_retention", userId: user.id, title: "Old", body: "Old", readAt: null, createdAt: old, category: "announcement", language: "en" },
      { id: "notification_fresh_retention", userId: user.id, title: "Fresh", body: "Fresh", readAt: null, createdAt: fresh, category: "announcement", language: "en" },
    );
    data.notificationLog ||= [];
    data.notificationLog.unshift(
      { id: "nlog_old_retention", notificationId: "notification_old_retention", userId: user.id, channel: "in_app", status: "delivered", failureReason: null, occurredAt: old, isTest: false },
      { id: "nlog_fresh_retention", notificationId: "notification_fresh_retention", userId: user.id, channel: "in_app", status: "delivered", failureReason: null, occurredAt: fresh, isTest: false },
    );
    data.notificationEmailDeliveries ||= [];
    data.notificationEmailDeliveries.unshift(
      { id: "delivery_old_retention", logId: "nlog_old_retention", providerMessageId: null, status: "sent", updatedAt: old },
      { id: "delivery_fresh_retention", logId: "nlog_fresh_retention", providerMessageId: null, status: "sent", updatedAt: fresh },
    );
  });
  const result = await scheduler.runNotificationRetentionJob({ now, force: true });
  assert.equal(result.ran, true);
  assert.equal(result.notifications, 1);
  assert.equal(result.logs, 1);
  assert.equal(result.deliveries, 1);
  const data = await store.ensureProductData();
  assert.equal(data.notifications.some((item) => item.id === "notification_old_retention"), false);
  assert.equal(data.notifications.some((item) => item.id === "notification_fresh_retention"), true);
  assert.equal((data.notificationLog || []).some((item) => item.id === "nlog_old_retention"), false);
  assert.equal((data.notificationLog || []).some((item) => item.id === "nlog_fresh_retention"), true);
  assert.equal((data.notificationEmailDeliveries || []).some((item) => item.id === "delivery_old_retention"), false);
  assert.equal((data.notificationEmailDeliveries || []).some((item) => item.id === "delivery_fresh_retention"), true);
});
