// NTF-REV-03: one HelpDesk reply must produce exactly one in-app message, and
// the row must be template-routed (switch + operator copy), so the Portal-side
// write and the Admin event share one event key instead of stacking two rows.
//
// Red-first: written before modules/helpdesk/runtime.ts exported helpdeskNotify
// and modules/helpdesk/service.ts carried the template metadata.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createLocalHelpdeskRepository } from "../../repositories/helpdeskRepository";
import { createHelpdeskService, type HelpdeskService } from "../../modules/helpdesk/service";
import { helpdeskNotify } from "../../modules/helpdesk/runtime";

const originalCwd = process.cwd();
const originalEnv = { ...process.env };
let isolatedCwd = "";
let store: typeof import("../../services/productStore");
let notifications: typeof import("../../services/notifications/service");

before(async () => {
  isolatedCwd = await mkdtemp(path.join(tmpdir(), "lg-helpdesk-routing-"));
  process.chdir(isolatedCwd);
  process.env.APP_ENV = "DEV";
  process.env.STORAGE_BACKEND = "local";
  delete process.env.DATABASE_URL;
  store = await import("../../services/productStore");
  notifications = await import("../../services/notifications/service");
  await store.ensureProductData();
  await store.persistDataMigrations();
});

after(async () => {
  process.chdir(originalCwd);
  process.env = originalEnv;
  if (isolatedCwd && path.dirname(isolatedCwd) === tmpdir()) await rm(isolatedCwd, { recursive: true, force: true });
});

type Learner = { id: string; email: string; name: string; locale: "en-GB" | "zh-CN" };
const agent = { id: "emp-routing", name: "Routing Agent" };

let userSeq = 0;
async function makeLearner(): Promise<Learner> {
  userSeq += 1;
  const email = `helpdesk-routing-${userSeq}@example.test`;
  const user = await store.registerUser({ email, password: "password1", nickname: `Learner ${userSeq}` });
  await store.verifyEmailToken(await store.issueEmailVerificationToken(user.id));
  const stored = await store.getUserById(user.id);
  assert.ok(stored);
  return { id: stored.id, email: stored.email ?? email, name: stored.nickname, locale: "en-GB" };
}

function harness() {
  const repository = createLocalHelpdeskRepository(path.join(isolatedCwd, "helpdesk-" + randomUUID()));
  const blobs = new Map<string, Buffer>();
  const service: HelpdeskService = createHelpdeskService({
    repository,
    blobs: {
      async put(key, bytes) { blobs.set(key, Buffer.from(bytes)); },
      async get(key) { const value = blobs.get(key); if (!value) throw new Error("missing blob"); return value; },
    },
    notify: helpdeskNotify,
    ticketLink: (ticketId, locale) => `/en-GB/account/my-learning/support/${encodeURIComponent(ticketId)}`,
    now: () => new Date(),
  });
  return { service, repository };
}

async function openTicket(service: HelpdeskService, learner: Learner) {
  return service.createTicket(learner, {
    category: "payments_subscriptions", subject: "Upgrade did not apply",
    body: "I paid but I am still on Basic.", locale: "en-GB", files: [],
  }, randomUUID());
}

async function agentReply(service: HelpdeskService, ticketId: string, body: string, expectedSequence: number) {
  return service.postAgentMessage(ticketId, { body, internal: false, agent, expectedSequence }, randomUUID());
}

async function rowsFor(userId: string) {
  const data = await store.ensureProductData();
  return data.notifications.filter((item) => item.userId === userId && item.templateId === "HELPDESK_TICKET_REPLIED" && !item.isTest);
}

async function setEnabled(enabled: boolean) {
  const result = await notifications.updateTemplate({ id: "HELPDESK_TICKET_REPLIED", enabled, operator: "test-operator" });
  assert.equal(result.ok, true, JSON.stringify(result));
}

test("one reply creates one template-routed row; the Admin event with the same key is a duplicate", async () => {
  await setEnabled(true);
  const learner = await makeLearner();
  const { service } = harness();
  const { ticket } = await openTicket(service, learner);
  await service.agentAction(ticket.id, { action: "claim", agent, expectedSequence: ticket.sequence }, randomUUID());
  const replied = await agentReply(service, ticket.id, "We are fixing this now.", 2);
  const reply = [...replied.ticket.messages].reverse().find((message) => message.authorKind === "agent" && !message.internal);
  assert.ok(reply);

  const rows = await rowsFor(learner.id);
  assert.equal(rows.length, 1, "one row after the Portal write");
  assert.equal(rows[0].title, "New reply to your request");
  assert.equal(rows[0].eventKey, `ticket:${ticket.id}:${reply.id}`);
  assert.match(rows[0].buttonLink ?? "", new RegExp(`/en-GB/account/my-learning/support/${ticket.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));

  // Admin emits the same event after postMessage; the shared key keeps one row.
  const event = await notifications.emitNotificationEvent({
    eventType: "HELPDESK_TICKET_REPLIED",
    eventKey: `ticket:${ticket.id}:${reply.id}`,
    email: learner.email,
    params: { ticket_subject: replied.ticket.subject, ticket_link: `/en-GB/account/my-learning/support/${ticket.id}` },
  });
  assert.equal(event.created, false);
  assert.equal((event as { reason: string }).reason, "duplicate");
  assert.equal((await rowsFor(learner.id)).length, 1, "still one row after the Admin event");
});

test("a second reply while the first is unread updates that row instead of stacking", async () => {
  await setEnabled(true);
  const learner = await makeLearner();
  const { service } = harness();
  const { ticket } = await openTicket(service, learner);
  await service.agentAction(ticket.id, { action: "claim", agent, expectedSequence: ticket.sequence }, randomUUID());
  const first = await agentReply(service, ticket.id, "First answer.", 2);
  const firstReply = [...first.ticket.messages].reverse().find((message) => message.authorKind === "agent" && !message.internal);
  assert.ok(firstReply);

  const learnerView = await service.getLearnerTicket(learner, ticket.id);
  const learnerReply = await service.learnerMessage(learner, ticket.id, { body: "Still broken.", expectedSequence: learnerView.sequence, files: [] }, randomUUID());
  const second = await agentReply(service, ticket.id, "Second answer.", learnerReply.ticket.sequence);
  const secondReply = [...second.ticket.messages].reverse().find((message) => message.authorKind === "agent" && !message.internal);
  assert.ok(secondReply);

  const rows = await rowsFor(learner.id);
  assert.equal(rows.length, 1, "one unread row for the ticket");
  assert.equal(rows[0].eventKey, `ticket:${ticket.id}:${secondReply.id}`, "updated to the latest reply key");
});

test("a switched-off HelpDesk template sends nothing, and the Admin event stays consumed", async () => {
  await setEnabled(false);
  const learner = await makeLearner();
  const { service } = harness();
  const { ticket } = await openTicket(service, learner);
  await service.agentAction(ticket.id, { action: "claim", agent, expectedSequence: ticket.sequence }, randomUUID());
  const replied = await agentReply(service, ticket.id, "You should not see this.", 2);
  const reply = [...replied.ticket.messages].reverse().find((message) => message.authorKind === "agent" && !message.internal);
  assert.ok(reply);

  assert.equal((await rowsFor(learner.id)).length, 0, "no in-app row while off");

  const event = await notifications.emitNotificationEvent({
    eventType: "HELPDESK_TICKET_REPLIED",
    eventKey: `ticket:${ticket.id}:${reply.id}`,
    email: learner.email,
    params: { ticket_subject: replied.ticket.subject, ticket_link: `/en-GB/account/my-learning/support/${ticket.id}` },
  });
  assert.equal(event.created, false);
  assert.equal((event as { reason: string }).reason, "duplicate", "the off event is consumed, not replayed");
  assert.equal((await rowsFor(learner.id)).length, 0);
});

for (const order of ["portal-first", "admin-first"] as const) {
  test(`one ticket and one reply give exactly one row (${order})`, async () => {
    await setEnabled(true);
    const learner = await makeLearner();
    const params = { ticket_subject: "Upgrade did not apply", ticket_link: "/en-GB/account/my-learning/support/T1" };
    const portalWrite = () => notifications.emitCatalogueNotification({
      templateId: "HELPDESK_TICKET_REPLIED",
      userId: learner.id,
      eventKey: "ticket:T1:R1",
      params,
      channels: ["in_app"],
      replaceUnreadEventKeyPrefix: "ticket:T1:",
    });
    const adminEvent = () => notifications.emitNotificationEvent({
      eventType: "HELPDESK_TICKET_REPLIED",
      eventKey: "ticket:T1:R1",
      email: learner.email,
      params,
    });
    if (order === "portal-first") { await portalWrite(); await adminEvent(); } else { await adminEvent(); await portalWrite(); }
    assert.equal((await rowsFor(learner.id)).length, 1);
  });
}
