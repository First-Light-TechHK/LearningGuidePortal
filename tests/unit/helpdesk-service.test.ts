import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { HelpdeskProblem, type UploadInput } from "../../contracts/helpdesk";
import { createHelpdeskService, type HelpdeskNotification } from "../../modules/helpdesk/service";
import { createLocalHelpdeskRepository } from "../../repositories/helpdeskRepository";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBPVP8 ")]);
const GIF = Buffer.from("GIF89a\x01\x00\x01\x00", "binary");

let root = "";
before(async () => { root = await mkdtemp(path.join(tmpdir(), "lg-helpdesk-service-")); });
after(async () => { if (root && path.dirname(root) === tmpdir()) await rm(root, { recursive: true, force: true }); });

const learner = { id: "user-learner", email: "learner@example.test", name: "Lin Learner" };
const stranger = { id: "user-stranger", email: "stranger@example.test", name: "Sam Stranger" };
const agent = { id: "emp-1", name: "Amy Agent" };
const agent2 = { id: "emp-2", name: "Ben Agent" };

function harness(startAt = "2026-10-28T06:00:00.000Z") {
  let clock = Date.parse(startAt);
  const blobs = new Map<string, Buffer>();
  const notifications: HelpdeskNotification[] = [];
  const logs: Array<Record<string, unknown>> = [];
  const service = createHelpdeskService({
    repository: createLocalHelpdeskRepository(path.join(root, randomUUID())),
    blobs: { async put(key, bytes) { blobs.set(key, Buffer.from(bytes)); }, async get(key) { const value = blobs.get(key); if (!value) throw new Error("missing blob"); return value; } },
    notify: async (notification) => { notifications.push(notification); },
    now: () => new Date(clock),
    log: (line) => logs.push(line)
  });
  return { service, blobs, notifications, logs, advance(ms: number) { clock += ms; }, now: () => new Date(clock).toISOString() };
}

const file = (bytes: Buffer, fileName = "screen.png", declaredType = "image/png"): UploadInput => ({ fileName, declaredType, bytes: new Uint8Array(bytes) });
const ticketInput = (overrides: Record<string, unknown> = {}, files: UploadInput[] = []) => ({ category: "billing" as const, subject: "Upgrade did not apply", body: "I paid but I am still on Basic.", locale: "en-GB" as const, files, ...overrides });

async function rejects(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof HelpdeskProblem, String(error));
    assert.equal(error.code, code);
    return true;
  });
}

test("create: numbered per UTC day, OPEN, one learner message with sniffed attachments, CloudEvents created", async () => {
  const h = harness();
  const { ticket, replayed } = await h.service.createTicket(learner, ticketInput({}, [file(PNG), file(JPEG, "photo.jpg", "image/jpeg")]), randomUUID());
  assert.equal(replayed, false);
  assert.equal(ticket.number, "LG-261028-0001");
  assert.equal(ticket.status, "OPEN");
  assert.equal(ticket.sequence, 1);
  assert.match(ticket.id, /^[0-9a-f]{8}-[0-9a-f]{4}-7/);
  assert.equal(ticket.messages.length, 1);
  assert.equal(ticket.messages[0].authorKind, "learner");
  assert.equal(ticket.messages[0].authorName, "Lin Learner");
  assert.deepEqual(ticket.messages[0].attachments.map((item) => [item.contentType, item.url.startsWith("/api/helpdesk/attachments/")]), [["image/png", true], ["image/jpeg", true]]);
  assert.deepEqual(ticket.timeline.map((item) => [item.type, item.fromStatus, item.toStatus]), [["created", null, "OPEN"]]);
  assert.deepEqual(ticket.allowedActions, ["reply", "cancel"]);
  assert.equal(h.blobs.size, 2);
  const second = await h.service.createTicket(learner, ticketInput({ subject: "Second" }), randomUUID());
  assert.equal(second.ticket.number, "LG-261028-0002");
  h.advance(DAY);
  const nextDay = await h.service.createTicket(learner, ticketInput({ subject: "Next day" }), randomUUID());
  assert.equal(nextDay.ticket.number, "LG-261029-0001");
  const agentView = await h.service.getAgentTicket(ticket.id);
  assert.deepEqual(agentView.events[0], {
    id: agentView.events[0].id, specversion: "1.0", source: "/portal/helpdesk", type: "com.ilovelearningguide.helpdesk.ticket.created",
    subject: ticket.id, time: "2026-10-28T06:00:00.000Z", datacontenttype: "application/json", sequence: 1,
    data: { from_state: null, to_state: "OPEN", actor: { kind: "learner", id: learner.id, name: learner.name }, message_id: ticket.messages[0].id }
  });
  assert.deepEqual(agentView.learner, { id: learner.id, email: learner.email, name: learner.name, locale: "en-GB" });
});

test("attachments are sniffed from magic bytes, not the declared type", async () => {
  const h = harness();
  const { ticket } = await h.service.createTicket(learner, ticketInput({}, [file(PNG, "x.pdf", "application/pdf"), file(WEBP, "w.webp", "image/webp")]), randomUUID());
  assert.deepEqual(ticket.messages[0].attachments.map((item) => item.contentType), ["image/png", "image/webp"]);
  await rejects(h.service.createTicket(learner, ticketInput({}, [file(GIF, "a.png", "image/png")]), randomUUID()), "attachment_type_unsupported");
  await rejects(h.service.createTicket(learner, ticketInput({}, [file(Buffer.from("<svg/>"), "a.png", "image/png")]), randomUUID()), "attachment_type_unsupported");
  const named = await h.service.createTicket(learner, ticketInput({}, [file(PNG, "../../etc/pass\u0000wd.png")]), randomUUID());
  assert.ok(!named.ticket.messages[0].attachments[0].fileName.includes("/"));
  assert.ok(!named.ticket.messages[0].attachments[0].fileName.includes("\u0000"));
});

test("idempotency: same key + same payload replays; changed payload or other user conflicts", async () => {
  const h = harness();
  const key = randomUUID();
  const first = await h.service.createTicket(learner, ticketInput({}, [file(PNG)]), key);
  const again = await h.service.createTicket(learner, ticketInput({}, [file(PNG)]), key);
  assert.equal(again.replayed, true);
  assert.equal(again.ticket.id, first.ticket.id);
  assert.equal(h.blobs.size, 1, "a replay does not store the attachment twice");
  await rejects(h.service.createTicket(learner, ticketInput({ subject: "Changed" }), key), "idempotency_conflict");
  await rejects(h.service.createTicket(learner, ticketInput({}, [file(JPEG, "screen.png")]), key), "idempotency_conflict");
  await rejects(h.service.createTicket(stranger, ticketInput({}, [file(PNG)]), key), "idempotency_conflict");
  assert.equal((await h.service.listLearnerTickets(learner)).tickets.length, 1);

  const actionKey = randomUUID();
  const claimed = await h.service.agentAction(first.ticket.id, { action: "claim", agent, expectedSequence: 1 }, actionKey);
  assert.equal(claimed.replayed, false);
  const replay = await h.service.agentAction(first.ticket.id, { action: "claim", agent, expectedSequence: 1 }, actionKey);
  assert.equal(replay.replayed, true);
  assert.equal(replay.ticket.sequence, 2, "a replayed command adds no event");
  await rejects(h.service.agentAction(first.ticket.id, { action: "claim", agent: agent2, expectedSequence: 1 }, actionKey), "idempotency_conflict");

  const messageKey = randomUUID();
  const concurrent = await Promise.all(Array.from({ length: 5 }, () => h.service.postAgentMessage(first.ticket.id, { body: "On it", internal: false, agent, expectedSequence: 2 }, messageKey)));
  assert.equal(concurrent.filter((item) => !item.replayed).length, 1);
  const detail = await h.service.getAgentTicket(first.ticket.id);
  assert.equal(detail.messages.filter((item) => item.body === "On it").length, 1);
  assert.equal(detail.sequence, 3);
});

test("stale expectedSequence is rejected and nothing changes", async () => {
  const h = harness();
  const { ticket } = await h.service.createTicket(learner, ticketInput(), randomUUID());
  await h.service.agentAction(ticket.id, { action: "claim", agent, expectedSequence: 1 }, randomUUID());
  await assert.rejects(h.service.learnerMessage(learner, ticket.id, { body: "hello?", expectedSequence: 1, files: [] }, randomUUID()), (error: unknown) => {
    assert.ok(error instanceof HelpdeskProblem);
    assert.equal(error.code, "stale_ticket");
    assert.equal(error.extra.currentSequence, 2);
    return true;
  });
  const detail = await h.service.getLearnerTicket(learner, ticket.id);
  assert.equal(detail.sequence, 2);
  assert.equal(detail.messages.length, 1);
});

test("ownership: a learner only sees and acts on their own tickets and attachments", async () => {
  const h = harness();
  const { ticket } = await h.service.createTicket(learner, ticketInput({}, [file(PNG)]), randomUUID());
  await rejects(h.service.getLearnerTicket(stranger, ticket.id), "not_found");
  await rejects(h.service.learnerAction(stranger, ticket.id, { action: "cancel", expectedSequence: 1 }, randomUUID()), "not_found");
  await rejects(h.service.learnerMessage(stranger, ticket.id, { body: "mine now", expectedSequence: 1, files: [] }, randomUUID()), "not_found");
  await rejects(h.service.readLearnerAttachment(stranger, ticket.messages[0].attachments[0].id), "not_found");
  assert.deepEqual((await h.service.listLearnerTickets(stranger)).tickets, []);
  const own = await h.service.readLearnerAttachment(learner, ticket.messages[0].attachments[0].id);
  assert.equal(own.contentType, "image/png");
  assert.deepEqual(Buffer.from(own.bytes), PNG);
  await rejects(h.service.getLearnerTicket(learner, randomUUID()), "not_found");
  await rejects(h.service.getAgentTicket(randomUUID()), "not_found");
});

test("full lifecycle with notifications, hidden internal notes, confirmation and a single rating", async () => {
  const h = harness();
  const { ticket } = await h.service.createTicket(learner, ticketInput({ locale: "zh-CN" }), randomUUID());
  const claimed = await h.service.agentAction(ticket.id, { action: "claim", agent, expectedSequence: 1 }, randomUUID());
  assert.equal(claimed.ticket.status, "ASSIGNED");
  assert.deepEqual(claimed.ticket.assignee, agent);
  assert.deepEqual(claimed.ticket.allowedActions, ["reply", "internal_note", "propose_resolution"]);

  const note = await h.service.postAgentMessage(ticket.id, { body: "Check Stripe dashboard", internal: true, agent, expectedSequence: 2 }, randomUUID());
  assert.equal(note.ticket.status, "ASSIGNED");
  assert.equal(h.notifications.length, 0, "internal notes never notify the learner");

  const replied = await h.service.postAgentMessage(ticket.id, { body: "Please send your order number.", internal: false, agent, expectedSequence: 3 }, randomUUID());
  assert.equal(replied.ticket.status, "WAITING_USER");
  assert.equal(h.notifications.length, 1);
  assert.equal(h.notifications[0].userId, learner.id);
  assert.equal(h.notifications[0].ticketId, ticket.id);
  assert.equal(h.notifications[0].locale, "zh-CN");
  assert.match(h.notifications[0].body, /LG-261028-0001/);

  let view = await h.service.getLearnerTicket(learner, ticket.id);
  assert.equal(view.status, "WAITING_USER");
  assert.deepEqual(view.messages.map((item) => [item.authorKind, item.body]), [["learner", "I paid but I am still on Basic."], ["agent", "Please send your order number."]]);
  assert.ok(!JSON.stringify(view).includes("Stripe dashboard"), "the learner view never contains internal notes");
  assert.ok(!view.timeline.some((item) => item.type === "internal_note_added"));
  assert.equal(view.messages[1].authorName, "Amy Agent");
  assert.deepEqual(view.allowedActions, ["reply", "close"]);

  const learnerReply = await h.service.learnerMessage(learner, ticket.id, { body: "Order LG-123", expectedSequence: view.sequence, files: [file(PNG)] }, randomUUID());
  assert.equal(learnerReply.ticket.status, "ASSIGNED");
  assert.equal(learnerReply.ticket.messages.at(-1)?.attachments.length, 1);

  const proposed = await h.service.agentAction(ticket.id, { action: "propose_resolution", agent, expectedSequence: learnerReply.ticket.sequence }, randomUUID());
  assert.equal(proposed.ticket.status, "PENDING_CONFIRM");
  assert.equal(proposed.ticket.confirmDueAt, new Date(Date.parse(h.now()) + 72 * HOUR).toISOString());
  assert.equal(h.notifications.length, 2);

  view = await h.service.getLearnerTicket(learner, ticket.id);
  assert.deepEqual(view.allowedActions, ["reply", "confirm", "reject"]);
  const confirmed = await h.service.learnerAction(learner, ticket.id, { action: "confirm", expectedSequence: view.sequence }, randomUUID());
  assert.equal(confirmed.ticket.status, "CLOSED");
  assert.equal(confirmed.ticket.closeReason, "user_confirmed");
  assert.equal(confirmed.ticket.followUpUntil, new Date(Date.parse(h.now()) + 7 * DAY).toISOString());
  assert.deepEqual(confirmed.ticket.allowedActions, ["reply", "rate"]);

  const rated = await h.service.learnerAction(learner, ticket.id, { action: "rate", rating: 5, expectedSequence: confirmed.ticket.sequence }, randomUUID());
  assert.equal(rated.ticket.rating, 5);
  assert.deepEqual(rated.ticket.allowedActions, ["reply"]);
  await rejects(h.service.learnerAction(learner, ticket.id, { action: "rate", rating: 1, expectedSequence: rated.ticket.sequence }, randomUUID()), "already_rated");

  const agentView = await h.service.getAgentTicket(ticket.id);
  assert.deepEqual(agentView.events.map((item) => item.sequence), agentView.events.map((_, index) => index + 1));
  assert.deepEqual(agentView.events.map((item) => item.type.replace("com.ilovelearningguide.helpdesk.ticket.", "")), ["created", "claimed", "internal_note_added", "agent_replied", "learner_replied", "resolution_proposed", "confirmed", "rated"]);
  assert.equal(agentView.messages.find((item) => item.internal)?.body, "Check Stripe dashboard");
  assert.deepEqual(agentView.events[3].data, { from_state: "ASSIGNED", to_state: "WAITING_USER", actor: { kind: "agent", id: agent.id, name: agent.name }, message_id: agentView.messages[2].id });
});

test("agent public reply on an unassigned ticket auto-claims it", async () => {
  const h = harness();
  const { ticket } = await h.service.createTicket(learner, ticketInput(), randomUUID());
  const replied = await h.service.postAgentMessage(ticket.id, { body: "Hi", internal: false, agent: agent2, expectedSequence: 1 }, randomUUID());
  assert.equal(replied.ticket.status, "WAITING_USER");
  assert.deepEqual(replied.ticket.assignee, agent2);
  assert.equal((replied.ticket.events.at(-1)?.data as { reason?: string }).reason, "auto_claimed");
  const again = await h.service.postAgentMessage(ticket.id, { body: "Still there?", internal: false, agent, expectedSequence: 2 }, randomUUID());
  assert.deepEqual(again.ticket.assignee, agent2, "a reply never steals an existing assignment");
});

test("rejected transitions return 409 invalid_transition, leave state unchanged and log one structured line", async () => {
  const h = harness();
  const { ticket } = await h.service.createTicket(learner, ticketInput(), randomUUID());
  await h.service.agentAction(ticket.id, { action: "claim", agent, expectedSequence: 1 }, randomUUID());
  await rejects(h.service.learnerAction(learner, ticket.id, { action: "cancel", expectedSequence: 2 }, randomUUID()), "invalid_transition");
  await rejects(h.service.agentAction(ticket.id, { action: "claim", agent: agent2, expectedSequence: 2 }, randomUUID()), "invalid_transition");
  assert.equal((await h.service.getLearnerTicket(learner, ticket.id)).status, "ASSIGNED");
  assert.equal((await h.service.getLearnerTicket(learner, ticket.id)).sequence, 2);
  assert.equal(h.logs.length, 2);
  assert.deepEqual(h.logs[0], { type: "helpdesk", event: "transition_rejected", ticketId: ticket.id, number: ticket.number, from: "ASSIGNED", command: "cancel", actor: "learner", code: "invalid_transition" });
});

test("withdraw: OPEN -> CANCELLED is read-only afterwards", async () => {
  const h = harness();
  const { ticket } = await h.service.createTicket(learner, ticketInput(), randomUUID());
  const cancelled = await h.service.learnerAction(learner, ticket.id, { action: "cancel", expectedSequence: 1 }, randomUUID());
  assert.equal(cancelled.ticket.status, "CANCELLED");
  assert.equal(cancelled.ticket.closeReason, "cancelled");
  assert.deepEqual(cancelled.ticket.allowedActions, []);
  await rejects(h.service.learnerMessage(learner, ticket.id, { body: "wait", expectedSequence: 2, files: [] }, randomUUID()), "invalid_transition");
  await rejects(h.service.postAgentMessage(ticket.id, { body: "note", internal: true, agent, expectedSequence: 2 }, randomUUID()), "invalid_transition");
});

test("not solved yet: reject with an optional message and replying while pending both return to ASSIGNED", async () => {
  const h = harness();
  const { ticket } = await h.service.createTicket(learner, ticketInput(), randomUUID());
  await h.service.agentAction(ticket.id, { action: "claim", agent, expectedSequence: 1 }, randomUUID());
  await h.service.agentAction(ticket.id, { action: "propose_resolution", agent, expectedSequence: 2 }, randomUUID());
  const rejected = await h.service.learnerAction(learner, ticket.id, { action: "reject", message: "Still on Basic", expectedSequence: 3 }, randomUUID());
  assert.equal(rejected.ticket.status, "ASSIGNED");
  assert.equal(rejected.ticket.confirmDueAt, null);
  assert.equal(rejected.ticket.messages.at(-1)?.body, "Still on Basic");
  assert.equal(rejected.ticket.timeline.at(-1)?.type, "resolution_rejected");
  await h.service.agentAction(ticket.id, { action: "propose_resolution", agent, expectedSequence: 4 }, randomUUID());
  const replied = await h.service.learnerMessage(learner, ticket.id, { body: "Not yet", expectedSequence: 5, files: [] }, randomUUID());
  assert.equal(replied.ticket.status, "ASSIGNED");
  const solved = await h.service.learnerAction(learner, ticket.id, { action: "close", expectedSequence: 6 }, randomUUID());
  assert.equal(solved.ticket.status, "CLOSED");
  assert.equal(solved.ticket.closeReason, "user_closed");
});

test("auto-confirm is applied lazily on read after 72 hours, then the 7-day follow-up window applies", async () => {
  const h = harness();
  const { ticket } = await h.service.createTicket(learner, ticketInput(), randomUUID());
  await h.service.agentAction(ticket.id, { action: "claim", agent, expectedSequence: 1 }, randomUUID());
  const proposed = await h.service.agentAction(ticket.id, { action: "propose_resolution", agent, expectedSequence: 2 }, randomUUID());
  h.advance(72 * HOUR - 1);
  assert.equal((await h.service.listLearnerTickets(learner)).tickets[0].status, "PENDING_CONFIRM");
  h.advance(1);
  const listed = (await h.service.listLearnerTickets(learner)).tickets[0];
  assert.equal(listed.status, "CLOSED");
  const detail = await h.service.getAgentTicket(ticket.id);
  assert.equal(detail.closeReason, "auto_confirmed");
  assert.equal(detail.closedAt, proposed.ticket.confirmDueAt);
  assert.deepEqual(detail.events.at(-1)?.data.actor, { kind: "system", id: null, name: null });
  assert.equal(detail.events.filter((item) => item.type.endsWith(".auto_confirmed")).length, 1);
  await h.service.listAgentTickets({ status: null, q: "", limit: 20, cursor: null });
  assert.equal((await h.service.getAgentTicket(ticket.id)).events.length, detail.events.length, "auto-confirm is applied once");

  h.advance(7 * DAY - 1);
  const followUp = await h.service.learnerMessage(learner, ticket.id, { body: "It broke again", expectedSequence: detail.sequence, files: [] }, randomUUID());
  assert.equal(followUp.ticket.status, "ASSIGNED");
  assert.equal(followUp.ticket.timeline.at(-1)?.type, "reopened");
  assert.equal(followUp.ticket.closedAt, null);
});

test("follow-up after 7 days is refused with reopen_window_passed", async () => {
  const h = harness();
  const { ticket } = await h.service.createTicket(learner, ticketInput(), randomUUID());
  await h.service.agentAction(ticket.id, { action: "claim", agent, expectedSequence: 1 }, randomUUID());
  await h.service.learnerAction(learner, ticket.id, { action: "close", expectedSequence: 2 }, randomUUID());
  h.advance(7 * DAY + 1);
  const view = await h.service.getLearnerTicket(learner, ticket.id);
  assert.deepEqual(view.allowedActions, []);
  assert.equal(view.followUpUntil, null);
  await rejects(h.service.learnerMessage(learner, ticket.id, { body: "again", expectedSequence: 3, files: [] }, randomUUID()), "reopen_window_passed");
  await rejects(h.service.learnerAction(learner, ticket.id, { action: "rate", rating: 3, expectedSequence: 3 }, randomUUID()), "rating_window_passed");
});

test("agent list: newest activity first, status/needs-reply filters, search, counts and cursor paging", async () => {
  const h = harness();
  const created = [];
  for (let index = 0; index < 5; index += 1) {
    created.push((await h.service.createTicket(index === 4 ? stranger : learner, ticketInput({ subject: `Question ${index}` }), randomUUID())).ticket);
    h.advance(1000);
  }
  await h.service.agentAction(created[0].id, { action: "claim", agent, expectedSequence: 1 }, randomUUID());
  await h.service.postAgentMessage(created[1].id, { body: "Reply", internal: false, agent, expectedSequence: 1 }, randomUUID());
  const all = await h.service.listAgentTickets({ status: null, q: "", limit: 20, cursor: null });
  assert.deepEqual(all.tickets.map((item) => item.subject), ["Question 1", "Question 0", "Question 4", "Question 3", "Question 2"]);
  assert.deepEqual(all.counts, { OPEN: 3, ASSIGNED: 1, WAITING_USER: 1, PENDING_CONFIRM: 0, CLOSED: 0, CANCELLED: 0, needs_reply: 4, all: 5 });
  assert.equal(all.nextCursor, null);
  assert.equal(all.tickets.find((item) => item.subject === "Question 1")?.needsReply, false);
  assert.equal(all.tickets.find((item) => item.subject === "Question 0")?.needsReply, true);
  const needs = await h.service.listAgentTickets({ status: "needs_reply", q: "", limit: 20, cursor: null });
  assert.equal(needs.tickets.length, 4);
  assert.deepEqual((await h.service.listAgentTickets({ status: "WAITING_USER", q: "", limit: 20, cursor: null })).tickets.map((item) => item.subject), ["Question 1"]);
  assert.deepEqual((await h.service.listAgentTickets({ status: null, q: "stranger@", limit: 20, cursor: null })).tickets.map((item) => item.subject), ["Question 4"]);
  assert.deepEqual((await h.service.listAgentTickets({ status: null, q: created[2].number.toLowerCase(), limit: 20, cursor: null })).tickets.map((item) => item.subject), ["Question 2"]);
  assert.deepEqual((await h.service.listAgentTickets({ status: null, q: "question 3", limit: 20, cursor: null })).tickets.map((item) => item.subject), ["Question 3"]);
  assert.equal((await h.service.listAgentTickets({ status: null, q: "100%_", limit: 20, cursor: null })).tickets.length, 0, "LIKE wildcards are literal");
  const page1 = await h.service.listAgentTickets({ status: null, q: "", limit: 2, cursor: null });
  assert.equal(page1.tickets.length, 2);
  assert.ok(page1.nextCursor);
  const decoded = JSON.parse(Buffer.from(page1.nextCursor, "base64url").toString("utf8"));
  const page2 = await h.service.listAgentTickets({ status: null, q: "", limit: 2, cursor: decoded });
  const page3 = await h.service.listAgentTickets({ status: null, q: "", limit: 2, cursor: JSON.parse(Buffer.from(page2.nextCursor!, "base64url").toString("utf8")) });
  assert.deepEqual([...page1.tickets, ...page2.tickets, ...page3.tickets].map((item) => item.id), all.tickets.map((item) => item.id));
  assert.equal(page3.nextCursor, null);
  const learnerList = await h.service.listLearnerTickets(learner);
  assert.deepEqual(learnerList.tickets.map((item) => item.subject), ["Question 1", "Question 0", "Question 3", "Question 2"]);
  assert.deepEqual(Object.keys(learnerList.tickets[0]).sort(), ["category", "closedAt", "confirmDueAt", "createdAt", "id", "lastMessageAt", "lastMessageBy", "number", "sequence", "status", "subject", "updatedAt"]);
});

test("notification failures never fail the agent's command", async () => {
  let clock = Date.parse("2026-10-28T06:00:00.000Z");
  const logs: Array<Record<string, unknown>> = [];
  const service = createHelpdeskService({
    repository: createLocalHelpdeskRepository(path.join(root, randomUUID())),
    blobs: { async put() {}, async get() { return Buffer.alloc(0); } },
    notify: async () => { throw new Error("store down"); },
    now: () => new Date(clock++),
    log: (line) => logs.push(line)
  });
  const { ticket } = await service.createTicket(learner, ticketInput(), randomUUID());
  const replied = await service.postAgentMessage(ticket.id, { body: "Hi", internal: false, agent, expectedSequence: 1 }, randomUUID());
  assert.equal(replied.ticket.status, "WAITING_USER");
  assert.deepEqual(logs.map((line) => line.event), ["notification_failed"]);
});
