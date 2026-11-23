import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { verifiedUser } from "./helpers/my-learning";

/**
 * Notification P0 operator surface (design §3): broadcast list/draft/send/
 * withdraw/detail, audience counts and the send log (filters, pagination,
 * detail timeline and 180-day retention).
 */

const originalCwd = process.cwd();
const originalStorageBackend = process.env.STORAGE_BACKEND;
const originalToken = process.env.NOTIFICATIONS_SERVICE_TOKEN;
const origin = "http://localhost:3014";
const TOKEN = "test-notifications-service-token";
let isolatedCwd: string;
let store: typeof import("../../services/productStore");
let service: typeof import("../../services/notifications/service");
let broadcastsRoute: typeof import("../../app/api/integration/notifications/broadcasts/route");
let broadcastRoute: typeof import("../../app/api/integration/notifications/broadcasts/[id]/route");
let audiencesRoute: typeof import("../../app/api/integration/notifications/audiences/route");
let sendLogRoute: typeof import("../../app/api/integration/notifications/send-log/route");
let sendLogDetailRoute: typeof import("../../app/api/integration/notifications/send-log/[id]/route");

before(async () => {
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-notification-ops-broadcasts-"));
  process.chdir(isolatedCwd);
  process.env.STORAGE_BACKEND = "local";
  process.env.NOTIFICATIONS_SERVICE_TOKEN = TOKEN;
  store = await import("../../services/productStore");
  service = await import("../../services/notifications/service");
  broadcastsRoute = await import("../../app/api/integration/notifications/broadcasts/route");
  broadcastRoute = await import("../../app/api/integration/notifications/broadcasts/[id]/route");
  audiencesRoute = await import("../../app/api/integration/notifications/audiences/route");
  sendLogRoute = await import("../../app/api/integration/notifications/send-log/route");
  sendLogDetailRoute = await import("../../app/api/integration/notifications/send-log/[id]/route");
  await store.ensureProductData();
  await verifiedUser(store, "broadcast-audience-one@example.test");
  await verifiedUser(store, "broadcast-audience-two@example.test");
});

after(async () => {
  process.chdir(originalCwd);
  if (originalStorageBackend === undefined) delete process.env.STORAGE_BACKEND;
  else process.env.STORAGE_BACKEND = originalStorageBackend;
  if (originalToken === undefined) delete process.env.NOTIFICATIONS_SERVICE_TOKEN;
  else process.env.NOTIFICATIONS_SERVICE_TOKEN = originalToken;
  if (isolatedCwd && path.dirname(isolatedCwd) === tmpdir()) await rm(isolatedCwd, { recursive: true, force: true });
});

function request(url: string, token?: string, body?: unknown, method = "GET") {
  return new Request(`${origin}${url}`, {
    method,
    headers: { ...(token ? { "x-notifications-token": token } : {}), "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

test("broadcast, audience and send-log routes reject a missing or wrong service token", async () => {
  assert.equal((await broadcastsRoute.GET(request("/api/integration/notifications/broadcasts"))).status, 401);
  assert.equal((await broadcastsRoute.POST(request("/api/integration/notifications/broadcasts", undefined, {}, "POST"))).status, 401);
  assert.equal((await broadcastsRoute.PATCH(request("/api/integration/notifications/broadcasts", undefined, {}, "PATCH"))).status, 401);
  assert.equal((await audiencesRoute.GET(request("/api/integration/notifications/audiences"))).status, 401);
  assert.equal((await sendLogRoute.GET(request("/api/integration/notifications/send-log"))).status, 401);
  assert.equal((await sendLogDetailRoute.GET(request("/api/integration/notifications/send-log/nlog_x"), params("nlog_x"))).status, 401);
});

test("audiences returns live all/paid counts", async () => {
  const response = await audiencesRoute.GET(request("/api/integration/notifications/audiences", TOKEN));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.ok(body.all >= 2);
  assert.equal(typeof body.paid, "number");
});

test("paid audience keeps grace-period subscribers until the grace end", async () => {
  const user = await verifiedUser(store, "broadcast-grace@example.test");
  const before = await (await audiencesRoute.GET(request("/api/integration/notifications/audiences", TOKEN))).json();
  const planId = (await store.ensureProductData()).plans[0].id;
  await store.editProductData((data) => {
    data.subscriptions.push({
      id: "sub_grace_test", userId: user.id, planId, courseId: "",
      state: "grace", source: "purchase",
      validFrom: new Date(Date.now() - 40 * 86400000).toISOString(),
      validTo: new Date(Date.now() - 2 * 86400000).toISOString(),
      cancelAtPeriodEnd: false, scope: "everything",
      graceEndsAt: new Date(Date.now() + 86400000).toISOString(),
    });
  });
  const duringGrace = await (await audiencesRoute.GET(request("/api/integration/notifications/audiences", TOKEN))).json();
  assert.ok(duringGrace.paid >= before.paid + 1);
  await store.editProductData((data) => {
    const row = data.subscriptions.find((item) => item.id === "sub_grace_test")!;
    row.graceEndsAt = new Date(Date.now() - 1000).toISOString();
  });
  const afterGrace = await (await audiencesRoute.GET(request("/api/integration/notifications/audiences", TOKEN))).json();
  assert.equal(afterGrace.paid, before.paid);
});

test("POST broadcasts validates the PRD content rules and records the operator", async () => {
  const badLink = await broadcastsRoute.POST(request("/api/integration/notifications/broadcasts", TOKEN, {
    titleEn: "Maintenance", bodyEn: "We will be offline.", audience: "all", buttonText: "Details", buttonLink: "javascript:alert(1)", operator: "ops@example.test",
  }, "POST"));
  assert.equal(badLink.status, 400);
  assert.equal((await badLink.json()).code, "invalid");

  const halfButton = await broadcastsRoute.POST(request("/api/integration/notifications/broadcasts", TOKEN, {
    titleEn: "Maintenance", bodyEn: "We will be offline.", audience: "all", buttonText: "Details", operator: "ops@example.test",
  }, "POST"));
  assert.equal(halfButton.status, 400);

  const missingOperator = await broadcastsRoute.POST(request("/api/integration/notifications/broadcasts", TOKEN, {
    titleEn: "Maintenance", bodyEn: "We will be offline.", audience: "all",
  }, "POST"));
  assert.equal(missingOperator.status, 400);

  const created = await broadcastsRoute.POST(request("/api/integration/notifications/broadcasts", TOKEN, {
    titleEn: "Maintenance", bodyEn: "We will be offline for one hour.", titleZh: "系统维护", bodyZh: "系统将维护一小时。",
    audience: "all", operator: "ops@example.test",
  }, "POST"));
  assert.equal(created.status, 200);
  const body = await created.json();
  assert.equal(body.ok, true);
  assert.equal(body.broadcast.status, "draft");
  assert.equal(body.broadcast.createdBy, "ops@example.test");
  assert.equal(body.broadcast.metadata?.lastOperator, "ops@example.test");
});

test("PATCH broadcasts deletes a draft and keeps an audited tombstone out of the list", async () => {
  const created = await broadcastsRoute.POST(request("/api/integration/notifications/broadcasts", TOKEN, {
    titleEn: "Delete me", bodyEn: "Draft to delete.", audience: "all", operator: "ops@example.test",
  }, "POST"));
  const draft = (await created.json()).broadcast;
  const deleted = await broadcastsRoute.PATCH(request("/api/integration/notifications/broadcasts", TOKEN, {
    id: draft.id, action: "delete", operator: "ops-delete@example.test",
  }, "PATCH"));
  assert.equal(deleted.status, 200);
  assert.equal((await deleted.json()).deleted, true);
  const data = await store.ensureProductData();
  const row = data.notificationBroadcasts!.find((item) => item.id === draft.id)!;
  assert.ok(row.deletedAt);
  assert.equal(row.deletedBy, "ops-delete@example.test");
  assert.equal(row.audit?.at(-1)?.action, "broadcast_deleted");
  const list = await (await broadcastsRoute.GET(request("/api/integration/notifications/broadcasts", TOKEN))).json();
  assert.equal(list.broadcasts.some((item: { id: string }) => item.id === draft.id), false);
  const detail = await broadcastRoute.GET(request(`/api/integration/notifications/broadcasts/${draft.id}`, TOKEN), params(draft.id));
  assert.equal(detail.status, 404);
  const again = await broadcastsRoute.PATCH(request("/api/integration/notifications/broadcasts", TOKEN, {
    id: draft.id, action: "delete", operator: "ops-delete@example.test",
  }, "PATCH"));
  assert.equal(again.status, 404);
});

test("PATCH broadcasts edits a draft, sends to the whole audience, and exposes read rate", async () => {
  const created = await broadcastsRoute.POST(request("/api/integration/notifications/broadcasts", TOKEN, {
    titleEn: "Draft title", bodyEn: "Draft body.", audience: "all", operator: "ops@example.test",
  }, "POST"));
  const draft = (await created.json()).broadcast;
  const updated = await broadcastsRoute.PATCH(request("/api/integration/notifications/broadcasts", TOKEN, {
    id: draft.id, action: "update", titleEn: "Final title", bodyEn: "Final body.", audience: "all", operator: "ops@example.test",
  }, "PATCH"));
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).broadcast.titleEn, "Final title");

  const counts = await (await audiencesRoute.GET(request("/api/integration/notifications/audiences", TOKEN))).json();
  const sent = await broadcastsRoute.PATCH(request("/api/integration/notifications/broadcasts", TOKEN, {
    id: draft.id, action: "send", operator: "ops@example.test",
  }, "PATCH"));
  assert.equal(sent.status, 200);
  const sentBody = await sent.json();
  assert.equal(sentBody.broadcast.status, "sent");
  assert.ok(sentBody.recipients >= counts.all);
  assert.ok(sentBody.broadcast.sentAt);

  const detail = await broadcastRoute.GET(request(`/api/integration/notifications/broadcasts/${draft.id}`, TOKEN), params(draft.id));
  assert.equal(detail.status, 200);
  const detailBody = await detail.json();
  assert.equal(detailBody.broadcast.id, draft.id);
  assert.ok(detailBody.readRate.recipients >= counts.all);
  assert.equal(detailBody.readRate.read, 0);

  const data = await store.ensureProductData();
  const rows = data.notifications.filter((item) => item.broadcastId === draft.id);
  assert.equal(rows.length, detailBody.readRate.recipients);
  assert.equal(rows[0].category, "announcement");
  await service.setNotificationRead(rows[0].userId, rows[0].id, true);
  const afterRead = await (await broadcastRoute.GET(request(`/api/integration/notifications/broadcasts/${draft.id}`, TOKEN), params(draft.id))).json();
  assert.equal(afterRead.readRate.read, 1);
});

test("a broadcast button link reaches each recipient in their own locale (REV-06)", async () => {
  const zh = await verifiedUser(store, "broadcast-link-zh@example.test");
  const en = await verifiedUser(store, "broadcast-link-en@example.test");
  await store.editProductData((data) => { data.users.find((user) => user.id === zh.id)!.locale = "zh-CN"; });
  const created = await broadcastsRoute.POST(request("/api/integration/notifications/broadcasts", TOKEN, {
    titleEn: "New courses", bodyEn: "Have a look.", buttonText: "Browse", buttonLink: "/portal/courses", audience: "all", operator: "ops@example.test",
  }, "POST"));
  const draft = (await created.json()).broadcast;
  const sent = await broadcastsRoute.PATCH(request("/api/integration/notifications/broadcasts", TOKEN, { id: draft.id, action: "send", operator: "ops@example.test" }, "PATCH"));
  assert.equal(sent.status, 200);
  const rows = (await store.ensureProductData()).notifications.filter((item) => item.broadcastId === draft.id);
  assert.equal(rows.find((item) => item.userId === zh.id)?.buttonLink, "/zh-CN/portal/courses");
  assert.equal(rows.find((item) => item.userId === en.id)?.buttonLink, "/en-GB/portal/courses");
});

test("PATCH broadcasts withdraw is irreversible, writes withdrawn and clears learner inbox", async () => {
  const created = await broadcastsRoute.POST(request("/api/integration/notifications/broadcasts", TOKEN, {
    titleEn: "Withdraw me", bodyEn: "This will be withdrawn.", audience: "all", operator: "ops@example.test",
  }, "POST"));
  const draft = (await created.json()).broadcast;
  await broadcastsRoute.PATCH(request("/api/integration/notifications/broadcasts", TOKEN, {
    id: draft.id, action: "send", operator: "ops@example.test",
  }, "PATCH"));
  const withdrawn = await broadcastsRoute.PATCH(request("/api/integration/notifications/broadcasts", TOKEN, {
    id: draft.id, action: "withdraw", operator: "ops-two@example.test",
  }, "PATCH"));
  assert.equal(withdrawn.status, 200);
  const body = await withdrawn.json();
  assert.equal(body.broadcast.status, "withdrawn");
  assert.ok(body.broadcast.withdrawnAt);
  assert.equal(body.broadcast.withdrawnBy, "ops-two@example.test");
  assert.ok(body.withdrawn >= 1);

  const data = await store.ensureProductData();
  const rows = data.notifications.filter((item) => item.broadcastId === draft.id);
  assert.ok(rows.every((item) => item.withdrawnAt));
  assert.ok((data.notificationLog || []).some((item) => item.broadcastId === draft.id && item.status === "withdrawn"));

  const again = await broadcastsRoute.PATCH(request("/api/integration/notifications/broadcasts", TOKEN, {
    id: draft.id, action: "withdraw", operator: "ops-two@example.test",
  }, "PATCH"));
  assert.equal(again.status, 409);
  assert.equal((await again.json()).code, "not_sent");
});

test("broadcast list is newest first, 20 per page, with read rates", async () => {
  await store.editProductData((data) => {
    data.notificationBroadcasts ||= [];
    for (let index = 0; index < 23; index += 1) {
      data.notificationBroadcasts.push({
        id: `broadcast_page_${index}`,
        titleEn: `Page broadcast ${index}`,
        bodyEn: "Body.",
        audience: "all",
        status: "draft",
        createdBy: "ops@example.test",
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
        sentAt: null,
        withdrawnAt: null,
        withdrawnBy: null,
      });
    }
  });
  const first = await broadcastsRoute.GET(request("/api/integration/notifications/broadcasts?page=1", TOKEN));
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  assert.equal(firstBody.pageSize, 20);
  assert.equal(firstBody.broadcasts.length, 20);
  assert.ok(firstBody.total >= 23);
  assert.ok(firstBody.broadcasts[0].createdAt >= firstBody.broadcasts[1].createdAt);
  assert.equal(typeof firstBody.broadcasts[0].rate, "number");
  const second = await (await broadcastsRoute.GET(request("/api/integration/notifications/broadcasts?page=2", TOKEN))).json();
  assert.ok(second.broadcasts.length >= 3);
  const badPage = await broadcastsRoute.GET(request("/api/integration/notifications/broadcasts?page=0", TOKEN));
  assert.equal(badPage.status, 400);
});

test("send log filters combine, default to 7 days, page at 20 and expose a Test tag", async () => {
  const user = await verifiedUser(store, "send-log-learner@example.test");
  for (const key of ["one", "two", "three"]) {
    await service.emitNotificationEvent({
      eventType: "HELPDESK_TICKET_REPLIED", eventKey: `sendlog:${key}`, userId: user.id,
      params: { ticket_subject: `Ticket ${key}`, ticket_link: `/my-learning/support/${key}` },
    });
  }
  const first = (await (await sendLogRoute.GET(request(`/api/integration/notifications/send-log?recipient=${encodeURIComponent(user.email)}`, TOKEN))).json());
  assert.equal(first.ok, true);
  assert.equal(first.pageSize, 20);
  assert.equal(first.items.length, 3);
  assert.equal(first.items[0].templateId, "HELPDESK_TICKET_REPLIED");
  assert.equal(first.items[0].channel, "in_app");

  const byTemplate = await (await sendLogRoute.GET(request("/api/integration/notifications/send-log?template=HELPDESK_TICKET_REPLIED", TOKEN))).json();
  assert.ok(byTemplate.items.every((item: { templateId: string }) => item.templateId === "HELPDESK_TICKET_REPLIED"));
  const byStatus = await (await sendLogRoute.GET(request("/api/integration/notifications/send-log?status=delivered", TOKEN))).json();
  assert.ok(byStatus.items.every((item: { status: string }) => item.status === "delivered"));
  assert.equal((await sendLogRoute.GET(request("/api/integration/notifications/send-log?channel=bogus", TOKEN))).status, 400);
  assert.equal((await sendLogRoute.GET(request("/api/integration/notifications/send-log?page=0", TOKEN))).status, 400);

  const row = first.items[0];
  const detail = await sendLogDetailRoute.GET(request(`/api/integration/notifications/send-log/${row.id}`, TOKEN), params(row.id));
  assert.equal(detail.status, 200);
  const detailBody = await detail.json();
  assert.equal(detailBody.entry.recipientEmail, user.email);
  assert.equal(detailBody.message.title.length > 0, true);
  assert.equal(detailBody.message.language, "en");
  assert.ok(detailBody.timeline.some((item: { status: string }) => item.status === "delivered"));
  assert.equal(detailBody.isTest, false);
});

test("send log default window hides older rows; detail 404 after 180 days; purge removes them", async () => {
  const user = await verifiedUser(store, "send-log-old@example.test");
  const tenDays = new Date(Date.now() - 10 * 86400000).toISOString();
  const twoHundredDays = new Date(Date.now() - 200 * 86400000).toISOString();
  await store.editProductData((data) => {
    data.notificationLog ||= [];
    data.notifications.push(
      { id: "notification_ten_days", userId: user.id, title: "Ten days", body: "Recent enough.", readAt: null, createdAt: tenDays, category: "support", templateId: "HELPDESK_TICKET_REPLIED", language: "en" },
      { id: "notification_two_hundred_days", userId: user.id, title: "Old", body: "Too old.", readAt: null, createdAt: twoHundredDays, category: "support", templateId: "HELPDESK_TICKET_REPLIED", language: "en" },
    );
    data.notificationLog.push(
      { id: "nlog_ten_days", notificationId: "notification_ten_days", userId: user.id, templateId: "HELPDESK_TICKET_REPLIED", channel: "in_app", status: "delivered", failureReason: null, occurredAt: tenDays, isTest: false },
      { id: "nlog_two_hundred_days", notificationId: "notification_two_hundred_days", userId: user.id, templateId: "HELPDESK_TICKET_REPLIED", channel: "in_app", status: "delivered", failureReason: null, occurredAt: twoHundredDays, isTest: false },
    );
  });
  const defaults = await (await sendLogRoute.GET(request("/api/integration/notifications/send-log", TOKEN))).json();
  assert.equal(defaults.items.some((item: { id: string }) => item.id === "nlog_ten_days"), false);
  assert.equal(defaults.items.some((item: { id: string }) => item.id === "nlog_two_hundred_days"), false);
  const widened = await (await sendLogRoute.GET(request("/api/integration/notifications/send-log?from=2020-01-01", TOKEN))).json();
  assert.equal(widened.items.some((item: { id: string }) => item.id === "nlog_ten_days"), true);
  assert.equal(widened.items.some((item: { id: string }) => item.id === "nlog_two_hundred_days"), false);

  const oldDetail = await sendLogDetailRoute.GET(request("/api/integration/notifications/send-log/nlog_two_hundred_days", TOKEN), params("nlog_two_hundred_days"));
  assert.equal(oldDetail.status, 404);

  const purged = await service.purgeExpiredNotificationRecords();
  assert.ok(purged.notifications >= 1);
  assert.ok(purged.logs >= 1);
  const data = await store.ensureProductData();
  assert.equal(data.notifications.some((item) => item.id === "notification_two_hundred_days"), false);
  assert.equal((data.notificationLog || []).some((item) => item.id === "nlog_two_hundred_days"), false);
});

test("send log detail shows failure reason, related record and Test tag", async () => {
  const user = await verifiedUser(store, "send-log-failed@example.test");
  const now = new Date().toISOString();
  await store.editProductData((data) => {
    data.notificationLog ||= [];
    data.notificationLog.push({
      id: "nlog_failed_detail", notificationId: null, userId: user.id, templateId: "SUB_RENEWAL_FAILED",
      channel: "email", status: "failed", failureReason: "missing data", occurredAt: now, isTest: true, related: "subscription:sub_1",
    });
  });
  const detail = await sendLogDetailRoute.GET(request("/api/integration/notifications/send-log/nlog_failed_detail", TOKEN), params("nlog_failed_detail"));
  assert.equal(detail.status, 200);
  const body = await detail.json();
  assert.equal(body.entry.status, "failed");
  assert.equal(body.entry.failureReason, "missing data");
  assert.equal(body.entry.related, "subscription:sub_1");
  assert.equal(body.isTest, true);
  assert.equal(body.message, null);
  const list = await (await sendLogRoute.GET(request("/api/integration/notifications/send-log?status=failed", TOKEN))).json();
  assert.ok(list.items.some((item: { id: string; isTest: boolean }) => item.id === "nlog_failed_detail" && item.isTest === true));
});
