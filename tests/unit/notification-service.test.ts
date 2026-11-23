import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { verifiedUser } from "./helpers/my-learning";

// Notification P0 service behaviour: template seeding, event rendering and
// de-duplication, missing-data logging, read/unread, broadcast withdrawal,
// 180-day retention and audience definitions.

const originalCwd = process.cwd();
const originalStorageBackend = process.env.STORAGE_BACKEND;
let isolatedCwd: string;
let store: typeof import("../../services/productStore");
let notifications: typeof import("../../services/notifications/service");

async function cleanUser(email: string) {
  const user = await verifiedUser(store, email);
  await store.editProductData((data) => {
    data.notifications = data.notifications.filter((item) => item.userId !== user.id);
  });
  return user;
}

before(async () => {
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-notifications-"));
  process.chdir(isolatedCwd);
  process.env.STORAGE_BACKEND = "local";
  store = await import("../../services/productStore");
  notifications = await import("../../services/notifications/service");
});

after(async () => {
  process.chdir(originalCwd);
  if (originalStorageBackend === undefined) delete process.env.STORAGE_BACKEND;
  else process.env.STORAGE_BACKEND = originalStorageBackend;
  if (isolatedCwd && path.dirname(isolatedCwd) === tmpdir()) await rm(isolatedCwd, { recursive: true, force: true });
});

test("boot seeds the fixed template catalogue idempotently", async () => {
  await store.ensureProductData();
  await store.persistDataMigrations();
  const first = await notifications.listTemplates();
  assert.equal(first.length, 13);
  await store.persistDataMigrations();
  assert.equal((await notifications.listTemplates()).length, 13);
  assert.equal(first.filter((item) => item.locked).length, 7);
});

test("an event renders and stores one in-app message; the same event key never sends twice", async () => {
  const user = await cleanUser("notify-event@example.test");
  const input = {
    eventType: "HELPDESK_TICKET_REPLIED",
    eventKey: "ticket:1:reply:1",
    userId: user.id,
    params: { ticket_subject: "Can't play the video in Lesson 3", ticket_link: "/my-learning/support/1" },
  };
  const first = await notifications.emitNotificationEvent(input);
  assert.equal(first.created, true);
  const second = await notifications.emitNotificationEvent(input);
  assert.equal(second.created, false);
  assert.equal((second as { reason: string }).reason, "duplicate");
  const data = await store.ensureProductData();
  const rows = data.notifications.filter((item) => item.userId === user.id && item.eventKey === "ticket:1:reply:1");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].category, "support");
  assert.equal(rows[0].templateId, "HELPDESK_TICKET_REPLIED");
  assert.equal(rows[0].language, "en");
  assert.equal(rows[0].buttonLink, "/en-GB/my-learning/support/1");
  assert.equal(rows[0].isTest, undefined);
  const log = (data.notificationLog || []).filter((item) => item.notificationId === rows[0].id);
  assert.equal(log.length, 1);
  assert.equal(log[0].status, "delivered");
});

test("a missing variable blocks the message and records Failed missing data", async () => {
  const user = await cleanUser("notify-missing@example.test");
  const result = await notifications.emitNotificationEvent({
    eventType: "SUB_RENEWAL_FAILED",
    eventKey: "sub:1:period:1",
    userId: user.id,
    params: { plan_name: "Everything · 12 months", grace_end_date: "2026-11-19T10:00:00.000Z" },
  });
  assert.equal(result.created, false);
  assert.equal((result as { reason: string }).reason, "missing_data");
  const data = await store.ensureProductData();
  assert.equal(data.notifications.some((item) => item.userId === user.id && item.eventKey === "sub:1:period:1"), false);
  const failed = (data.notificationLog || []).filter((item) => item.userId === user.id && item.status === "failed");
  assert.equal(failed.length, 1);
  assert.equal(failed[0].failureReason, "missing data");
  assert.equal(failed[0].templateId, "SUB_RENEWAL_FAILED");
});

test("a switched-off optional notification sends nothing and is not replayed later", async () => {
  const user = await cleanUser("notify-disabled@example.test");
  const template = (await notifications.listTemplates()).find((item) => item.id === "LIVE_SESSION_RESCHEDULED");
  assert.equal(template?.enabled, false);
  const result = await notifications.emitNotificationEvent({
    eventType: "LIVE_SESSION_RESCHEDULED",
    eventKey: "session:1:move:1",
    userId: user.id,
    params: { session_title: "Reading Plato", group_name: "Philosophy Circle", session_date: "2026-11-12T10:00:00.000Z", session_time: "2026-11-12T11:00:00.000Z", session_link: "/portal/study-groups/sessions/1" },
  });
  assert.equal(result.created, false);
  assert.equal((result as { reason: string }).reason, "disabled");
  assert.equal((await store.ensureProductData()).notifications.some((item) => item.userId === user.id), false);
  const replay = await notifications.emitNotificationEvent({
    eventType: "LIVE_SESSION_RESCHEDULED",
    eventKey: "session:1:move:1",
    userId: user.id,
    params: { session_title: "Reading Plato", group_name: "Philosophy Circle", session_date: "2026-11-12T10:00:00.000Z", session_time: "2026-11-12T11:00:00.000Z", session_link: "/portal/study-groups/sessions/1" },
  });
  assert.equal((replay as { reason: string }).reason, "duplicate", "an event while off is never replayed later");
});

test("learner list: newest first, unread filter and count, mark read/unread", async () => {
  const user = await cleanUser("notify-reader@example.test");
  for (const [index, key] of ["a", "b", "c"].entries()) {
    const result = await notifications.emitNotificationEvent({
      eventType: "HELPDESK_TICKET_REPLIED",
      eventKey: `reader:${key}`,
      userId: user.id,
      params: { ticket_subject: `Question ${key}`, ticket_link: `/my-learning/support/${index}` },
    });
    assert.equal(result.created, true);
  }
  const all = await notifications.listLearnerNotifications(user.id, { filter: "all", limit: 2 });
  assert.equal(all.items.length, 2);
  assert.equal(all.unreadCount, 3);
  assert.ok(all.nextCursor);
  const page2 = await notifications.listLearnerNotifications(user.id, { filter: "all", limit: 2, cursor: all.nextCursor });
  assert.equal(page2.items.length, 1);
  const first = all.items[0];
  await notifications.setNotificationRead(user.id, first.id, true);
  assert.equal((await notifications.listLearnerNotifications(user.id, { filter: "unread" })).unreadCount, 2);
  assert.equal((await notifications.listLearnerNotifications(user.id, { filter: "unread" })).items.some((item) => item.id === first.id), false);
  await notifications.setNotificationRead(user.id, first.id, false);
  assert.equal((await notifications.listLearnerNotifications(user.id, { filter: "unread" })).unreadCount, 3);
  await assert.rejects(() => notifications.setNotificationRead("someone-else", first.id, true), /not found/i);
});

test("withdrawing a broadcast removes it and its unread count from every learner", async () => {
  const user = await cleanUser("notify-broadcast@example.test");
  const draft = await notifications.createBroadcastDraft({
    titleEn: "Scheduled maintenance", bodyEn: "Learning Guide will be unavailable for scheduled maintenance.",
    audience: "all", createdBy: "operator-1",
  });
  const audience = await notifications.audienceCounts();
  const sent = await notifications.sendBroadcast(draft.id, "operator-1");
  assert.equal(sent.recipients, audience.all);
  assert.equal((await notifications.listLearnerNotifications(user.id, { filter: "all" })).unreadCount, 1);
  const withdrawn = await notifications.withdrawBroadcast(draft.id, "operator-1");
  assert.equal(withdrawn.withdrawn, audience.all);
  const afterWithdraw = await notifications.listLearnerNotifications(user.id, { filter: "all" });
  assert.equal(afterWithdraw.items.length, 0);
  assert.equal(afterWithdraw.unreadCount, 0);
  const data = await store.ensureProductData();
  const broadcast = data.notificationBroadcasts?.find((item) => item.id === draft.id);
  assert.equal(broadcast?.status, "withdrawn");
  assert.ok((data.notificationLog || []).some((item) => item.broadcastId === draft.id && item.status === "withdrawn"));
});

test("messages older than 180 days are hidden and excluded from unread counts", async () => {
  const user = await cleanUser("notify-old@example.test");
  await store.editProductData((data) => {
    const old = new Date(Date.now() - 200 * 86400000).toISOString();
    data.notifications.unshift({
      id: "notification_old_1", userId: user.id, title: "Old news", body: "Too old to show.", readAt: null,
      createdAt: old, category: "announcement", language: "en",
    });
  });
  const listed = await notifications.listLearnerNotifications(user.id, { filter: "all" });
  assert.equal(listed.items.some((item) => item.id === "notification_old_1"), false);
  assert.equal(listed.unreadCount, 0);
});

test("fan-out uses one Set lookup per recipient instead of scanning every row", async () => {
  const base = await notifications.audienceCounts();
  const users = [];
  for (let index = 0; index < 50; index += 1) users.push(await cleanUser(`notify-fanout-${index}@example.test`));
  const validTo = new Date(Date.now() + 30 * 86400000).toISOString();
  await store.editProductData((data) => {
    for (const user of users) {
      data.subscriptions.push({
        id: `sub_fanout_${user.id}`, userId: user.id, planId: "epicureanism-pc-6", courseId: "epicureanism",
        state: "active", source: "purchase", validFrom: new Date().toISOString(), validTo, cancelAtPeriodEnd: false,
      });
    }
  });
  const paid = (await notifications.audienceCounts()).paid;
  assert.equal(paid, base.paid + 50);
  const params = { course_title: "Stoicism", category_name: "Philosophy", course_link: "/portal/courses/stoicism" };
  const eventKey = "course:fanout:v1";
  // One paid user already has this launch notification (fan-out keys carry the user id).
  const first = await notifications.emitNotificationEvent({ eventType: "COURSE_NEW_LAUNCH", eventKey: `${eventKey}:${users[0].id}`, userId: users[0].id, params });
  assert.equal(first.created, true);
  // Count the row scans of the duplicate check (a `.some` whose predicate reads eventKey).
  let scans = 0;
  const originalSome = Array.prototype.some;
  Array.prototype.some = function some(this: unknown[], predicate: Parameters<typeof originalSome>[0], thisArg?: unknown) {
    if (String(predicate).includes("eventKey")) scans += 1;
    return originalSome.call(this, predicate, thisArg);
  } as typeof originalSome;
  let fanOut: Awaited<ReturnType<typeof notifications.emitNotificationEvent>>;
  try {
    fanOut = await notifications.emitNotificationEvent({ eventType: "COURSE_NEW_LAUNCH", eventKey, params });
  } finally {
    Array.prototype.some = originalSome;
  }
  assert.equal(fanOut.created, true);
  assert.equal((fanOut as { recipients: number }).recipients, paid - 1);
  assert.equal(scans, 0, "the duplicate check must not scan data.notifications per recipient");
  const again = await notifications.emitNotificationEvent({ eventType: "COURSE_NEW_LAUNCH", eventKey, params });
  assert.equal(again.created, false);
  assert.equal((again as { reason: string }).reason, "duplicate");
});

test("audience counts: all registered users versus paid subscribers with live access", async () => {
  const user = await cleanUser("notify-audience@example.test");
  const before = await notifications.audienceCounts();
  assert.equal(before.all >= 1, true);
  const { quote } = await store.createQuote(user.id, "epicureanism-pc-6");
  const pending = await store.createPendingDemoOrder(user.id, quote.id);
  await store.completeDemoOrder(user.id, pending.order.id);
  const afterPurchase = await notifications.audienceCounts();
  assert.equal(afterPurchase.paid, before.paid + 1);
});
