// PostgreSQL proofs for Helpdesk Tickets v1 (migration 017): the runtime
// bootstrap creates the tables, the artifact is repeatable, ticket numbers
// and idempotency keys are unique under concurrency, and optimistic
// concurrency on ticket.sequence lets exactly one of several racing writers
// commit. The PostgreSQL repository holds no in-process lock, and every
// concurrent call below runs on its own pooled connection, so the database
// alone arbitrates each race.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { ensureSchema, getPool } from "../../../services/persistence/db";
import { createPostgresHelpdeskRepository } from "../../../repositories/helpdeskRepository";
import { createHelpdeskService } from "../../../modules/helpdesk/service";
import { eventType, type EventRecord, type MessageRecord, type TicketRecord } from "../../../modules/helpdesk/domain";
import { uuidv7 } from "../../../lib/uuidv7";
import { closePool, requireDatabaseUrl, rows } from "./harness";
import { DOCX, PDF as PDF_BYTES, XLSX } from "../../unit/helpdesk-fixtures";

const TABLES = ["helpdesk_ticket_tags", "helpdesk_ticket_events", "helpdesk_attachments", "helpdesk_ticket_messages", "helpdesk_tickets", "helpdesk_ticket_counters"];
const MIGRATION = readFileSync(path.join(process.cwd(), "db", "migrations", "017_helpdesk_tickets.sql"), "utf8");
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const learner = { id: "pg-learner", email: "pg-learner@example.test", name: "PG Learner" };
const agent = { id: "emp-pg", name: "PG Agent" };

function service(clock: () => Date = () => new Date("2026-10-28T06:00:00.000Z")) {
  const blobs = new Map<string, Uint8Array>();
  return createHelpdeskService({
    repository: createPostgresHelpdeskRepository(),
    blobs: { async put(key, bytes) { blobs.set(key, bytes); }, async get(key) { return blobs.get(key) as Uint8Array; } },
    now: clock,
    log: () => undefined
  });
}

const input = (subject = "Upgrade did not apply") => ({ category: "payments_subscriptions" as const, subject, body: "Paid but still Basic.", locale: "en-GB" as const, files: [] });

before(async () => {
  requireDatabaseUrl();
  await getPool().query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`);
});

after(async () => {
  await closePool();
});

beforeEach(async () => {
  await ensureSchema();
  await getPool().query(`TRUNCATE ${TABLES.join(", ")} CASCADE`);
});

test("the runtime bootstrap creates every 017 table and the artifact re-applies cleanly", async () => {
  const present = await rows<{ name: string | null }>(`SELECT to_regclass(name)::text AS name FROM unnest($1::text[]) AS name`, [TABLES]);
  assert.deepEqual(present.map((row) => row.name), TABLES);
  await getPool().query(MIGRATION);
  await getPool().query(MIGRATION);
  const constraints = await rows<{ definition: string }>(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid = 'helpdesk_ticket_events'::regclass AND contype = 'u'`);
  assert.ok(constraints.some((row) => row.definition === "UNIQUE (subject, sequence)"));
  assert.ok(constraints.some((row) => row.definition === "UNIQUE (client_event_id)"));
});

test("20 concurrent creates get 20 distinct, gap-free numbers for the UTC day", async () => {
  const hd = service();
  const results = await Promise.all(Array.from({ length: 20 }, (_, index) => hd.createTicket(learner, input(`Question ${index}`), randomUUID())));
  const numbers = results.map((item) => item.ticket.number).sort();
  assert.deepEqual(numbers, Array.from({ length: 20 }, (_, index) => `LG-261028-${String(index + 1).padStart(4, "0")}`));
  assert.deepEqual(await rows("SELECT day, last FROM helpdesk_ticket_counters"), [{ day: "261028", last: 20 }]);
});

test("a duplicate Idempotency-Key replays without consuming a ticket number", async () => {
  const hd = service();
  const key = randomUUID();
  const racing = await Promise.all(Array.from({ length: 6 }, () => hd.createTicket(learner, input(), key)));
  assert.equal(new Set(racing.map((item) => item.ticket.id)).size, 1);
  assert.equal(racing.filter((item) => !item.replayed).length, 1);
  const next = await hd.createTicket(learner, input("Another"), randomUUID());
  assert.equal(next.ticket.number, "LG-261028-0002");
  assert.equal(Number((await rows<{ count: string }>("SELECT count(*) FROM helpdesk_tickets"))[0].count), 2);
  await assert.rejects(hd.createTicket(learner, input("Changed"), key), { code: "idempotency_conflict" });
});

test("database constraints back the idempotency and event-sequence rules", async () => {
  const hd = service();
  const { ticket } = await hd.createTicket(learner, input(), randomUUID());
  const event = (await rows<{ client_event_id: string }>("SELECT client_event_id::text FROM helpdesk_ticket_events WHERE subject = $1", [ticket.id]))[0];
  const insertEvent = (sequence: number, key: string | null) => getPool().query(`INSERT INTO helpdesk_ticket_events (id, type, subject, time, data, sequence, client_event_id)
    VALUES ($1, $2, $3, NOW(), '{}'::jsonb, $4, $5)`, [uuidv7(), eventType("claimed"), ticket.id, sequence, key]);
  await assert.rejects(insertEvent(1, null), { code: "23505" }, "UNIQUE (subject, sequence)");
  await assert.rejects(insertEvent(2, event.client_event_id), { code: "23505" }, "UNIQUE client_event_id");
  await assert.rejects(getPool().query("UPDATE helpdesk_tickets SET rating = 6 WHERE id = $1", [ticket.id]), { code: "23514" });
  await assert.rejects(getPool().query("UPDATE helpdesk_tickets SET status = 'DONE' WHERE id = $1", [ticket.id]), { code: "23514" });
});

test("racing writers on the same expectedSequence: exactly one commits, the rest are stale", async () => {
  const hd = service();
  const { ticket } = await hd.createTicket(learner, input(), randomUUID());
  const repository = createPostgresHelpdeskRepository();
  const aggregate = await repository.findTicket(ticket.id);
  assert.ok(aggregate);
  const base = aggregate.ticket;
  const attempts = Array.from({ length: 8 }, (_, index) => {
    const at = new Date(Date.parse(base.updatedAt) + 1000 + index).toISOString();
    const message: MessageRecord = { id: uuidv7(), ticketId: base.id, authorKind: "agent", authorId: `emp-${index}`, authorName: `Agent ${index}`, body: `Reply ${index}`, internal: false, attachmentIds: [], clientEventId: randomUUID(), payloadHash: "a".repeat(64), createdAt: at };
    const next: TicketRecord = { ...base, status: "WAITING_USER", sequence: base.sequence + 1, assigneeId: `emp-${index}`, assigneeName: `Agent ${index}`, updatedAt: at, lastMessageAt: at, lastMessageBy: "agent" };
    const event: EventRecord = { id: uuidv7(), specversion: "1.0", source: "/portal/helpdesk", type: eventType("agent_replied"), subject: base.id, time: at, datacontenttype: "application/json", data: { from_state: "OPEN", to_state: "WAITING_USER", actor: { kind: "agent", id: `emp-${index}`, name: `Agent ${index}` }, message_id: message.id }, sequence: next.sequence, clientEventId: message.clientEventId, payloadHash: "a".repeat(64) };
    return repository.appendChange({ ticket: next, expectedSequence: base.sequence, message, attachments: [], event });
  });
  const outcomes = await Promise.all(attempts);
  assert.equal(outcomes.filter((item) => item === "applied").length, 1);
  assert.equal(outcomes.filter((item) => item === "stale").length, 7);
  const stored = await repository.findTicket(ticket.id);
  assert.ok(stored);
  assert.equal(stored.ticket.sequence, 2);
  assert.deepEqual(stored.events.map((item) => item.sequence), [1, 2]);
  assert.equal(stored.messages.length, 2, "losers leave no orphan message");
  assert.equal(stored.messages[1].authorId, stored.ticket.assigneeId);
});

test("full lifecycle round-trips through PostgreSQL with RFC 3339 times, arrays and JSONB event data", async () => {
  let clock = Date.parse("2026-10-28T06:00:00.000Z");
  const hd = service(() => new Date(clock));
  const { ticket } = await hd.createTicket(learner, { ...input(), files: [{ fileName: "shot.png", declaredType: "image/png", bytes: new Uint8Array(PNG) }] }, randomUUID());
  assert.equal(ticket.messages[0].attachments.length, 1);
  clock += 1000;
  await hd.postAgentMessage(ticket.id, { body: "Internal: check Stripe", internal: true, agent, expectedSequence: 1 }, randomUUID());
  const replied = await hd.postAgentMessage(ticket.id, { body: "Which order?", internal: false, agent, expectedSequence: 2 }, randomUUID());
  assert.equal(replied.ticket.status, "WAITING_USER");
  const learnerView = await hd.learnerMessage(learner, ticket.id, { body: "Order 7", expectedSequence: 3, files: [] }, randomUUID());
  assert.equal(learnerView.ticket.status, "ASSIGNED");
  assert.ok(!learnerView.ticket.messages.some((item) => item.body.startsWith("Internal")));
  const proposed = await hd.agentAction(ticket.id, { action: "propose_resolution", agent, expectedSequence: 4 }, randomUUID());
  assert.equal(proposed.ticket.confirmDueAt, "2026-10-31T06:00:01.000Z");
  clock += 72 * 3_600_000;
  const listed = await hd.listAgentTickets({ status: null, q: "", limit: 20, cursor: null });
  assert.equal(listed.tickets[0].status, "CLOSED");
  const detail = await hd.getAgentTicket(ticket.id);
  assert.equal(detail.closeReason, "auto_confirmed");
  assert.equal(detail.closedAt, "2026-10-31T06:00:01.000Z");
  assert.deepEqual(detail.events.map((item) => item.sequence), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(detail.events[5].data, { from_state: "PENDING_CONFIRM", to_state: "CLOSED", actor: { kind: "system", id: null, name: null }, reason: "auto_confirmed" });
  assert.match(detail.events[0].time, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(detail.messages[0].attachments[0].contentType, "image/png");
  const rated = await hd.learnerAction(learner, ticket.id, { action: "rate", rating: 4, expectedSequence: 6 }, randomUUID());
  assert.equal(rated.ticket.rating, 4);
});

test("agent list in PostgreSQL: counts, needs-reply, literal search and keyset paging", async () => {
  let clock = Date.parse("2026-10-28T06:00:00.000Z");
  const hd = service(() => new Date(clock));
  const created = [];
  for (let index = 0; index < 5; index += 1) {
    created.push((await hd.createTicket(index === 4 ? { ...learner, id: "other", email: "other_x@example.test" } : learner, input(index === 3 ? "100% broken" : `Question ${index}`), randomUUID())).ticket);
    clock += 1000;
  }
  await hd.postAgentMessage(created[0].id, { body: "Hi", internal: false, agent, expectedSequence: 1 }, randomUUID());
  const all = await hd.listAgentTickets({ status: null, q: "", limit: 20, cursor: null });
  assert.equal(all.tickets[0].id, created[0].id);
  assert.deepEqual(all.counts, { OPEN: 4, ASSIGNED: 0, WAITING_USER: 1, PENDING_CONFIRM: 0, CLOSED: 0, CANCELLED: 0, needs_reply: 4, all: 5 });
  assert.equal((await hd.listAgentTickets({ status: "needs_reply", q: "", limit: 20, cursor: null })).tickets.length, 4);
  assert.deepEqual((await hd.listAgentTickets({ status: null, q: "100%", limit: 20, cursor: null })).tickets.map((item) => item.id), [created[3].id]);
  assert.deepEqual((await hd.listAgentTickets({ status: null, q: "other_", limit: 20, cursor: null })).tickets.map((item) => item.id), [created[4].id]);
  assert.equal((await hd.listAgentTickets({ status: null, q: "r_x", limit: 20, cursor: null })).tickets.length, 1);
  assert.equal((await hd.listAgentTickets({ status: null, q: "%", limit: 20, cursor: null })).tickets.length, 1, "% is literal");
  const seen: string[] = [];
  let cursor = null as null | { updatedAt: string; id: string };
  for (;;) {
    const page = await hd.listAgentTickets({ status: null, q: "", limit: 2, cursor });
    seen.push(...page.tickets.map((item) => item.id));
    if (!page.nextCursor) break;
    cursor = JSON.parse(Buffer.from(page.nextCursor, "base64url").toString("utf8"));
  }
  assert.deepEqual(seen, all.tickets.map((item) => item.id));
  assert.equal((await hd.listLearnerTickets(learner)).tickets.length, 4);
});

// ------------------------------------------------------------ Figma addendum

test("addendum columns round-trip: contact email, declined suggestion event, unread flag, wider attachments", async () => {
  const hd = service();
  const suggestionId = "0192d4f0-7b6a-7c3e-9a10-0000000000aa";
  const files = [
    { fileName: "invoice.pdf", declaredType: "application/pdf", bytes: new Uint8Array(PDF_BYTES) },
    { fileName: "steps.docx", declaredType: "", bytes: new Uint8Array(DOCX) },
    { fileName: "rows.xlsx", declaredType: "", bytes: new Uint8Array(XLSX) },
    { fileName: "notes.txt", declaredType: "text/plain", bytes: new Uint8Array(Buffer.from("a\nb")) },
    { fileName: "shot.png", declaredType: "image/png", bytes: new Uint8Array(PNG) }
  ];
  const { ticket } = await hd.createTicket(learner, { ...input(), category: "technical_support", contactEmail: "pg@work.example", suggestionId, files }, randomUUID());
  assert.equal(ticket.contactEmail, "pg@work.example");
  assert.equal(ticket.sequence, 2);
  assert.equal(ticket.messages[0].attachments.length, 5);
  const detail = await hd.getAgentTicket(ticket.id);
  assert.equal(detail.suggestionId, suggestionId);
  assert.equal(detail.unreadByAgent, true);
  assert.deepEqual(detail.events.map((item) => item.type.split(".").pop()), ["created", "suggestion_declined"]);
  assert.equal(detail.events[1].data.suggestion_id, suggestionId);
  const stored = await rows<{ contact_email: string; category: string; unread_by_agent: boolean }>("SELECT contact_email, category, unread_by_agent FROM helpdesk_tickets WHERE id = $1", [ticket.id]);
  assert.deepEqual(stored, [{ contact_email: "pg@work.example", category: "technical_support", unread_by_agent: true }]);
  await assert.rejects(getPool().query("UPDATE helpdesk_tickets SET category = 'billing' WHERE id = $1", [ticket.id]), { code: "23514" }, "old categories are refused");
  await assert.rejects(getPool().query("UPDATE helpdesk_attachments SET content_type = 'image/svg+xml' WHERE ticket_id = $1", [ticket.id]), { code: "23514" }, "svg is refused");
  await assert.rejects(getPool().query("UPDATE helpdesk_attachments SET size_bytes = 10485761 WHERE ticket_id = $1", [ticket.id]), { code: "23514" });
});

test("unread flag: mark_read clears it without an event; a stale agent snapshot never raises it again; a learner message does", async () => {
  const hd = service();
  const { ticket } = await hd.createTicket(learner, input(), randomUUID());
  const repository = createPostgresHelpdeskRepository();
  const snapshot = await repository.findTicket(ticket.id);
  assert.ok(snapshot);
  await hd.agentAction(ticket.id, { action: "mark_read", agent, expectedSequence: null }, randomUUID());
  assert.equal((await hd.getAgentTicket(ticket.id)).unreadByAgent, false);
  assert.equal((await hd.getAgentTicket(ticket.id)).sequence, 1);
  // An agent command built from the pre-mark_read snapshot (unreadByAgent: true) must not undo it.
  const at = new Date(Date.parse(snapshot.ticket.updatedAt) + 1000).toISOString();
  const next: TicketRecord = { ...snapshot.ticket, status: "ASSIGNED", sequence: 2, assigneeId: agent.id, assigneeName: agent.name, updatedAt: at };
  const event: EventRecord = { id: uuidv7(), specversion: "1.0", source: "/portal/helpdesk", type: eventType("claimed"), subject: ticket.id, time: at, datacontenttype: "application/json", data: { from_state: "OPEN", to_state: "ASSIGNED", actor: { kind: "agent", id: agent.id, name: agent.name } }, sequence: 2, clientEventId: randomUUID(), payloadHash: "b".repeat(64) };
  assert.equal(await repository.appendChange({ ticket: next, expectedSequence: 1, attachments: [], event }), "applied");
  assert.equal((await hd.getAgentTicket(ticket.id)).unreadByAgent, false);
  await hd.learnerMessage(learner, ticket.id, { body: "Any update?", expectedSequence: 2, files: [] }, randomUUID());
  assert.equal((await hd.getAgentTicket(ticket.id)).unreadByAgent, true);
});

test("tags in PostgreSQL: idempotent add/remove events, limit of 10, list filter and counts, concurrent tagging all lands", async () => {
  const hd = service();
  const { ticket } = await hd.createTicket(learner, input(), randomUUID());
  const other = (await hd.createTicket({ ...learner, id: "pg-other", email: "daniel.wu@example.test", name: "Daniel Wu" }, { ...input("Charged twice"), category: "technical_support" }, randomUUID())).ticket;
  const racing = await Promise.all(["login issue", "account access", "payment", "vip"].map((tag) => hd.agentAction(ticket.id, { action: "add_tag", agent, tag, expectedSequence: null }, randomUUID())));
  assert.equal(racing.length, 4);
  const tagged = await hd.getAgentTicket(ticket.id);
  assert.deepEqual([...tagged.tags].sort(), ["account access", "login issue", "payment", "vip"]);
  assert.deepEqual(tagged.events.map((item) => item.sequence), [1, 2, 3, 4, 5]);
  await hd.agentAction(ticket.id, { action: "add_tag", agent, tag: "vip", expectedSequence: null }, randomUUID());
  await hd.agentAction(ticket.id, { action: "remove_tag", agent, tag: "vip", expectedSequence: null }, randomUUID());
  await hd.agentAction(ticket.id, { action: "remove_tag", agent, tag: "vip", expectedSequence: null }, randomUUID());
  assert.equal((await hd.getAgentTicket(ticket.id)).sequence, 6);
  for (let index = 0; index < 7; index += 1) await hd.agentAction(ticket.id, { action: "add_tag", agent, tag: `t${index}`, expectedSequence: null }, randomUUID());
  await assert.rejects(hd.agentAction(ticket.id, { action: "add_tag", agent, tag: "eleventh", expectedSequence: null }, randomUUID()), { code: "tag_limit_reached" });
  assert.equal(Number((await rows<{ count: string }>("SELECT count(*) FROM helpdesk_ticket_tags WHERE ticket_id = $1", [ticket.id]))[0].count), 10);
  const byTag = await hd.listAgentTickets({ status: null, q: "", limit: 20, cursor: null, category: null, tag: "payment" });
  assert.deepEqual(byTag.tickets.map((item) => item.id), [ticket.id]);
  assert.equal(byTag.counts.all, 1);
  assert.equal(byTag.tickets[0].tags.length, 10);
  assert.equal(byTag.tickets[0].preview, "Paid but still Basic.");
  assert.equal(byTag.tickets[0].contactEmail, learner.email);
  const byCategory = await hd.listAgentTickets({ status: null, q: "", limit: 20, cursor: null, category: "technical_support", tag: null });
  assert.deepEqual(byCategory.tickets.map((item) => item.id), [other.id]);
  assert.deepEqual((await hd.listAgentTickets({ status: null, q: "daniel w", limit: 20, cursor: null, category: null, tag: null })).tickets.map((item) => item.id), [other.id]);
  await assert.rejects(getPool().query("INSERT INTO helpdesk_ticket_tags (ticket_id, tag, created_at) VALUES ($1, 'payment', NOW())", [ticket.id]), { code: "23505" });
  await assert.rejects(getPool().query(`INSERT INTO helpdesk_ticket_tags (ticket_id, tag, created_at) VALUES ($1, '${"x".repeat(33)}', NOW())`, [ticket.id]), { code: "23514" });
});

test("student projection counts the learner's tickets in PostgreSQL", async () => {
  const hd = createHelpdeskService({
    repository: createPostgresHelpdeskRepository(),
    blobs: { async put() {}, async get() { return new Uint8Array(); } },
    studentDirectory: async () => ({ name: "PG Learner", accountEmail: learner.email, joinedAt: "2024-01-15T00:00:00.000Z", currentCourse: null, subscription: null }),
    now: () => new Date("2026-10-28T06:00:00.000Z"),
    log: () => undefined
  });
  await hd.createTicket(learner, input("One"), randomUUID());
  const { ticket } = await hd.createTicket(learner, input("Two"), randomUUID());
  await hd.createTicket({ ...learner, id: "someone-else" }, input("Three"), randomUUID());
  const detail = await hd.getAgentTicket(ticket.id);
  assert.equal(detail.student.totalEnquiries, 2);
  assert.equal(detail.student.joinedAt, "2024-01-15T00:00:00.000Z");
});
