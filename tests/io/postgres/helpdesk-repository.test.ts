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
import { createAssistantService } from "../../../modules/helpdesk/assistant";
import { eventType, type EventRecord, type MessageRecord, type TicketRecord } from "../../../modules/helpdesk/domain";
import { uuidv7 } from "../../../lib/uuidv7";
import { closePool, requireDatabaseUrl, rows } from "./harness";
import { DOCX, PDF as PDF_BYTES, XLSX } from "../../unit/helpdesk-fixtures";

const TABLES = ["helpdesk_ai_ratings", "helpdesk_assist_log", "helpdesk_ticket_tags", "helpdesk_ticket_events", "helpdesk_attachments", "helpdesk_ticket_messages", "helpdesk_tickets", "helpdesk_ticket_counters"];
const MIGRATION = readFileSync(path.join(process.cwd(), "db", "migrations", "017_helpdesk_tickets.sql"), "utf8");
const MIGRATION_V2 = readFileSync(path.join(process.cwd(), "db", "migrations", "018_helpdesk_v2.sql"), "utf8");
const MIGRATION_019 = readFileSync(path.join(process.cwd(), "db", "migrations", "019_helpdesk_outcome_delivery.sql"), "utf8");
const MIGRATION_020 = readFileSync(path.join(process.cwd(), "db", "migrations", "020_helpdesk_ai_ratings.sql"), "utf8");
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

test("the runtime bootstrap creates every 017 and 018 table and both artifacts re-apply cleanly", async () => {
  const present = await rows<{ name: string | null }>(`SELECT to_regclass(name)::text AS name FROM unnest($1::text[]) AS name`, [TABLES]);
  assert.deepEqual(present.map((row) => row.name), TABLES);
  await getPool().query(MIGRATION);
  await getPool().query(MIGRATION);
  await getPool().query(MIGRATION_V2);
  await getPool().query(MIGRATION_V2);
  const columns = await rows<{ column_name: string; is_nullable: string }>("SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'helpdesk_tickets' AND column_name IN ('flagged_at', 'flagged_by') ORDER BY column_name");
  assert.deepEqual(columns, [{ column_name: "flagged_at", is_nullable: "YES" }, { column_name: "flagged_by", is_nullable: "YES" }]);
  const constraints = await rows<{ definition: string }>(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid = 'helpdesk_ticket_events'::regclass AND contype = 'u'`);
  assert.ok(constraints.some((row) => row.definition === "UNIQUE (subject, sequence)"));
  assert.ok(constraints.some((row) => row.definition === "UNIQUE (client_event_id)"));
});

test("20 concurrent creates get 20 distinct, gap-free numbers for the UTC day", async () => {
  const hd = service();
  // Twenty learners (one learner may open only ten tickets an hour).
  const results = await Promise.all(Array.from({ length: 20 }, (_, index) => hd.createTicket({ ...learner, id: `pg-learner-${index}` }, input(`Question ${index}`), randomUUID())));
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

test("the same learner message sent twice at once with one Idempotency-Key lands once; the other call replays it", async () => {
  const { ticket } = await service().createTicket(learner, input(), randomUUID());
  const key = randomUUID();
  const send = () => service().learnerMessage(learner, ticket.id, { body: "Still on Basic after signing out.", expectedSequence: ticket.sequence, files: [] }, key);
  const results = await Promise.all([send(), send()]);
  assert.deepEqual(results.map((item) => item.replayed).sort(), [false, true]);
  assert.equal(results[0].ticket.sequence, results[1].ticket.sequence);
  const messages = await rows<{ n: string }>("SELECT count(*)::text AS n FROM helpdesk_ticket_messages WHERE ticket_id = $1 AND client_event_id = $2", [ticket.id, key]);
  assert.deepEqual(messages, [{ n: "1" }]);
  const events = await rows<{ sequence: number }>("SELECT sequence FROM helpdesk_ticket_events WHERE subject = $1 ORDER BY sequence", [ticket.id]);
  assert.deepEqual(events.map((item) => item.sequence), [1, 2]);
});

test("a due auto-confirm racing the learner's own confirm closes the ticket exactly once", async () => {
  for (let round = 0; round < 5; round += 1) {
    await getPool().query(`TRUNCATE ${TABLES.join(", ")} CASCADE`);
    let clock = Date.parse("2026-10-28T06:00:00.000Z");
    const at = () => new Date(clock);
    const { ticket } = await service(at).createTicket(learner, input(), randomUUID());
    await service(at).agentAction(ticket.id, { action: "claim", agent, expectedSequence: 1 }, randomUUID());
    await service(at).agentAction(ticket.id, { action: "propose_resolution", agent, expectedSequence: 2 }, randomUUID());
    clock += 72 * 3_600_000 + 1;
    const outcomes = await Promise.allSettled([
      service(at).learnerAction(learner, ticket.id, { action: "confirm", expectedSequence: 3 }, randomUUID()),
      service(at).listLearnerTickets(learner),
      service(at).getAgentTicket(ticket.id)
    ]);
    for (const outcome of outcomes) {
      // The learner's confirm may lose to the sweep: then it is a clean 409, never a 500.
      if (outcome.status === "rejected") assert.ok(["stale_ticket", "invalid_transition"].includes((outcome.reason as { code?: string }).code ?? ""), String(outcome.reason));
    }
    const events = await rows<{ type: string; sequence: number }>("SELECT type, sequence FROM helpdesk_ticket_events WHERE subject = $1 ORDER BY sequence", [ticket.id]);
    assert.deepEqual(events.map((item) => item.sequence), [1, 2, 3, 4], `round ${round}`);
    assert.ok([eventType("confirmed"), eventType("auto_confirmed")].includes(events[3].type as ReturnType<typeof eventType>));
    const stored = await rows<{ status: string; sequence: number }>("SELECT status, sequence FROM helpdesk_tickets WHERE id = $1", [ticket.id]);
    assert.deepEqual(stored, [{ status: "CLOSED", sequence: 4 }]);
  }
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

test("unread flag: a mark_read for an older snapshot leaves a newer learner message unread; racing it never loses the dot", async () => {
  const hd = service();
  const { ticket } = await hd.createTicket(learner, input(), randomUUID());
  const seen = (await hd.getAgentTicket(ticket.id)).sequence;
  await hd.learnerMessage(learner, ticket.id, { body: "Also the receipt is missing", expectedSequence: seen, files: [] }, randomUUID());
  const late = await hd.agentAction(ticket.id, { action: "mark_read", agent, expectedSequence: seen }, randomUUID());
  assert.equal(late.ticket.unreadByAgent, true);
  assert.equal((await hd.agentAction(ticket.id, { action: "mark_read", agent, expectedSequence: late.ticket.sequence }, randomUUID())).ticket.unreadByAgent, false);
  // Race the learner's message against mark_read for the snapshot before it, many times:
  // whichever commits first, the message must end up unread.
  for (let round = 0; round < 10; round += 1) {
    const before = (await hd.getAgentTicket(ticket.id)).sequence;
    await Promise.all([
      hd.learnerMessage(learner, ticket.id, { body: `Follow-up ${round}`, expectedSequence: before, files: [] }, randomUUID()),
      hd.agentAction(ticket.id, { action: "mark_read", agent, expectedSequence: before }, randomUUID())
    ]);
    assert.equal((await hd.getAgentTicket(ticket.id)).unreadByAgent, true, `round ${round}`);
    await hd.agentAction(ticket.id, { action: "mark_read", agent, expectedSequence: before + 1 }, randomUUID());
    assert.equal((await hd.getAgentTicket(ticket.id)).unreadByAgent, false);
  }
});

test("'Not yet' without a message raises unread_by_agent and counts in Needs reply in PostgreSQL", async () => {
  let clock = Date.parse("2026-10-28T06:00:00.000Z");
  const hd = service(() => new Date(clock));
  const { ticket } = await hd.createTicket(learner, input(), randomUUID());
  await hd.agentAction(ticket.id, { action: "mark_read", agent, expectedSequence: 1 }, randomUUID());
  await hd.postAgentMessage(ticket.id, { body: "Please sign out and in again.", internal: false, agent, expectedSequence: 1 }, randomUUID());
  await hd.agentAction(ticket.id, { action: "propose_resolution", agent, expectedSequence: 2 }, randomUUID());
  assert.equal((await hd.listAgentTickets({ status: "needs_reply", q: "", limit: 20, cursor: null })).counts.needs_reply, 0);
  clock += 60_000;
  await hd.learnerAction(learner, ticket.id, { action: "reject", expectedSequence: 3 }, randomUUID());
  const stored = await rows<{ status: string; unread_by_agent: boolean; last_message_by: string }>("SELECT status, unread_by_agent, last_message_by FROM helpdesk_tickets WHERE id = $1", [ticket.id]);
  assert.deepEqual(stored, [{ status: "ASSIGNED", unread_by_agent: true, last_message_by: "learner" }]);
  const queue = await hd.listAgentTickets({ status: "needs_reply", q: "", limit: 20, cursor: null });
  assert.deepEqual(queue.tickets.map((item) => item.id), [ticket.id]);
  assert.equal(queue.counts.needs_reply, 1);
  assert.equal(queue.tickets[0].unreadByAgent, true);
});

test("rate limits count the learner's own tickets and messages in PostgreSQL over a rolling hour", async () => {
  let clock = Date.parse("2026-10-28T06:00:00.000Z");
  const hd = service(() => new Date(clock));
  const tickets = [];
  for (let index = 0; index < 10; index += 1) {
    tickets.push((await hd.createTicket(learner, input(`Limit ${index}`), randomUUID())).ticket);
    clock += 1000;
  }
  await assert.rejects(hd.createTicket(learner, input("Eleventh"), randomUUID()), (error: { code?: string; extra?: { retryAfter?: number } }) => error.code === "rate_limited" && error.extra?.retryAfter === 3590);
  await hd.createTicket({ ...learner, id: "pg-someone-else" }, input("Other learner"), randomUUID());
  // 10 opening messages so far; 50 more replies reach the 60-message limit.
  let sequence = tickets[0].sequence;
  for (let index = 0; index < 50; index += 1) sequence = (await hd.learnerMessage(learner, tickets[0].id, { body: `Reply ${index}`, expectedSequence: sequence, files: [] }, randomUUID())).ticket.sequence;
  await assert.rejects(hd.learnerMessage(learner, tickets[1].id, { body: "One too many", expectedSequence: 1, files: [] }, randomUUID()), { code: "rate_limited" });
  clock += 3_600_000;
  assert.equal((await hd.createTicket(learner, input("Next hour"), randomUUID())).replayed, false);
  assert.equal((await hd.learnerMessage(learner, tickets[1].id, { body: "Next hour", expectedSequence: 1, files: [] }, randomUUID())).ticket.messages.length, 2);
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

test("v2 in PostgreSQL: flag round-trips, flagged and learnerId filters bound list and counts", async () => {
  const hd = service();
  const a = (await hd.createTicket(learner, input("A"), randomUUID())).ticket;
  const b = (await hd.createTicket({ ...learner, id: "pg-other" }, input("B"), randomUUID())).ticket;
  const flagged = (await hd.agentAction(a.id, { action: "flag", agent, expectedSequence: 1 }, randomUUID())).ticket;
  assert.equal(flagged.flagged, true);
  assert.deepEqual(await rows("SELECT flagged_by FROM helpdesk_tickets WHERE id = $1", [a.id]), [{ flagged_by: agent.id }]);
  const list = await hd.listAgentTickets({ status: null, q: "", limit: 20, cursor: null, flagged: true });
  assert.deepEqual(list.tickets.map((item) => item.id), [a.id]);
  assert.equal(list.counts.all, 1);
  const mine = await hd.listAgentTickets({ status: null, q: "", limit: 20, cursor: null, learnerId: "pg-other" });
  assert.deepEqual(mine.tickets.map((item) => item.id), [b.id]);
  const unflagged = (await hd.agentAction(a.id, { action: "unflag", agent, expectedSequence: 2 }, randomUUID())).ticket;
  assert.equal(unflagged.flagged, false);
  assert.deepEqual(await rows("SELECT flagged_at, flagged_by FROM helpdesk_tickets WHERE id = $1", [a.id]), [{ flagged_at: null, flagged_by: null }]);
});

test("v2 in PostgreSQL: assist log rows, first-wins feedback under a race, the hourly count and the linking rules", async () => {
  let clock = Date.parse("2026-10-28T06:00:00.000Z");
  const now = () => new Date(clock);
  const repository = createPostgresHelpdeskRepository();
  const reported: string[] = [];
  const assistant = createAssistantService({
    repository, now, log: () => undefined,
    admin: {
      async suggest(request) { return /password/.test(request.message) ? { id: uuidv7(clock), faqId: "0192d4f0-7b6a-7c3e-9a10-0000000000f1", question: "Reset?", answer: "Use **Forgot password**." } : null; },
      async reportOutcome(_id, outcome) { reported.push(outcome); return true; }
    }
  });
  const key = randomUUID();
  const asked = await assistant.ask(learner, { message: "password help", locale: "en-GB", faqId: null }, key);
  assert.equal((await assistant.ask(learner, { message: "password help", locale: "en-GB", faqId: null }, key)).replayed, true);
  const racing = await Promise.all([true, false, true, false].map((helpful) => assistant.feedback(learner, asked.response.id, helpful)));
  assert.equal(new Set(racing.map((item) => item.feedback)).size, 1, "every caller sees the one stored value");
  assert.equal(reported.length >= 1 && reported.length <= 4, true);
  clock += 1000;
  const fallback = await assistant.ask(learner, { message: "refund", locale: "en-GB", faqId: null }, randomUUID());
  const foreign = await assistant.ask({ ...learner, id: "pg-other" }, { message: "password", locale: "en-GB", faqId: null }, randomUUID());
  assert.equal(await repository.nthRecentAssistAt(learner.id, "2026-10-28T05:00:00.000Z", 2, ["chat", "chip"]), "2026-10-28T06:00:00.000Z");
  assert.equal(await repository.nthRecentAssistAt(learner.id, "2026-10-28T05:00:00.000Z", 3, ["chat", "chip"]), null);
  clock += 24 * 3_600_000;
  const late = await assistant.ask(learner, { message: "password later", locale: "en-GB", faqId: null }, randomUUID());
  // The conversation root (Admin's parentRunId): the learner's oldest unlinked row after the cut-off.
  assert.equal(await repository.conversationRootAssist(learner.id, "2026-10-28T05:00:00.000Z"), asked.response.id);
  assert.equal(await repository.conversationRootAssist(learner.id, "2026-10-28T06:00:00.000Z"), fallback.response.id, "strictly after the cut-off");
  assert.equal(await repository.conversationRootAssist("pg-other", "2026-10-28T05:00:00.000Z"), foreign.response.id);
  const hd = service(now);
  const ticket = (await hd.createTicket(learner, { ...input("Linked"), assistIds: [asked.response.id, fallback.response.id, foreign.response.id, late.response.id] }, randomUUID())).ticket;
  assert.equal(await repository.conversationRootAssist(learner.id, "2026-10-28T06:00:01.000Z"), null, "a linked row closes its conversation");
  assert.equal(await repository.conversationRootAssist(learner.id, "2026-10-28T05:00:00.000Z"), asked.response.id, "rows the ticket did not take stay open");
  // asked is now older than 24 h; fallback is exactly 24 h old (not newer than the window); foreign belongs to someone else.
  const detail = await hd.getAgentTicket(ticket.id);
  assert.deepEqual(detail.aiAssist.map((item) => item.id), [late.response.id]);
  assert.equal(detail.aiAssist[0].answer, "Use **Forgot password**.");
  assert.match(detail.aiAssist[0].createdAt, /^2026-10-29T06:00:01\.000Z$/);
});

test("019 in PostgreSQL: re-applies; declined is stored with the ticket; undelivered outcomes are listed least recently tried first; mark_read ignores agent-only events", async () => {
  await getPool().query(MIGRATION_019);
  await getPool().query(MIGRATION_019);
  const columns = await rows<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name = 'helpdesk_assist_log' AND column_name LIKE 'feedback_%' ORDER BY column_name");
  assert.deepEqual(columns.map((row) => row.column_name), ["feedback_attempted_at", "feedback_delivered_at"]);
  let clock = Date.parse("2026-10-28T06:00:00.000Z");
  const now = () => new Date(clock);
  const repository = createPostgresHelpdeskRepository();
  let up = false;
  const reported: string[] = [];
  const assistant = createAssistantService({
    repository, now, log: () => undefined,
    admin: {
      async suggest() { return { id: uuidv7(clock), faqId: "0192d4f0-7b6a-7c3e-9a10-0000000000f1", question: "Reset?", answer: "Use **Forgot password**." }; },
      async reportOutcome(id) { if (!up) return false; reported.push(id); return true; }
    }
  });
  const submit = await assistant.suggestForSubmit(learner, { category: "technical_support", subject: "Password", message: "password", locale: "en-GB" });
  assert.ok(submit);
  clock += 1000;
  const hd = service(now);
  const ticket = (await hd.createTicket(learner, { ...input("Declined"), suggestionId: submit.id }, randomUUID())).ticket;
  assert.equal((await repository.findAssist(submit.id))?.feedback, "declined");
  assert.equal((await hd.getAgentTicket(ticket.id)).aiAssist[0].feedback, "declined");
  const chat = await assistant.ask(learner, { message: "password", locale: "en-GB", faqId: null }, randomUUID());
  clock += 1000;
  await assistant.feedback(learner, chat.response.id, true);
  clock += 1000;
  assert.equal(await assistant.deliverOutcome(submit.id), false, "Admin is down");
  const pending = await repository.listUndeliveredAssists("2026-10-27T00:00:00.000Z", 5);
  assert.deepEqual(pending.map((row) => row.id), [chat.response.id, submit.id], "the most recently tried goes last");
  up = true;
  assert.equal(await assistant.deliverPending(), 2);
  assert.deepEqual(reported.sort(), [chat.response.id, submit.id].sort());
  assert.ok((await repository.findAssist(submit.id))?.feedbackDeliveredAt);
  assert.deepEqual(await repository.listUndeliveredAssists("2026-10-27T00:00:00.000Z", 5), []);
  // mark_read for the seen sequence after another agent's tag and flag still clears the dot.
  const seen = (await hd.getAgentTicket(ticket.id)).sequence;
  await hd.agentAction(ticket.id, { action: "add_tag", agent, tag: "pg", expectedSequence: null }, randomUUID());
  await hd.agentAction(ticket.id, { action: "flag", agent, expectedSequence: seen + 1 }, randomUUID());
  assert.equal((await hd.agentAction(ticket.id, { action: "mark_read", agent, expectedSequence: seen }, randomUUID())).ticket.unreadByAgent, false);
});

test("020 in PostgreSQL: re-applies; alternatives round-trip and replay; one rating per answer under a race; aiAssist carries it", async () => {
  await getPool().query(MIGRATION_020);
  await getPool().query(MIGRATION_020);
  let clock = Date.parse("2026-10-29T06:00:00.000Z");
  const now = () => new Date(clock);
  const repository = createPostgresHelpdeskRepository();
  const ALTERNATIVES = [{ faqId: "0192d4f0-7b6a-7c3e-9a10-0000000000a1", question: "Reset my password?" }, { faqId: "0192d4f0-7b6a-7c3e-9a10-0000000000a2", question: "Where is my invoice?" }];
  const assistant = createAssistantService({
    repository, now, log: () => undefined,
    admin: {
      async suggest() { return null; },
      async suggestReply(request) {
        return request.faqId || /password/.test(request.message)
          ? { suggestion: { id: request.runId, faqId: request.faqId ?? "0192d4f0-7b6a-7c3e-9a10-0000000000f1", question: "Reset?", answer: "Use **Forgot password**." }, alternatives: [] }
          : { suggestion: null, alternatives: ALTERNATIVES };
      },
      async reportOutcome() { return true; }
    }
  });
  const key = randomUUID();
  const fallback = await assistant.ask(learner, { message: "account locked", locale: "en-GB", faqId: null }, key);
  assert.deepEqual(fallback.response.alternatives, ALTERNATIVES);
  assert.deepEqual((await repository.findAssist(fallback.response.id))?.alternatives, ALTERNATIVES);
  const replay = await assistant.ask(learner, { message: "account locked", locale: "en-GB", faqId: null }, key);
  assert.deepEqual(replay.response, fallback.response, "the replay shows the same chips");
  const check = await assistant.checkForSubmit(learner, { category: "technical_support", subject: "Locked", message: "account locked", locale: "en-GB" });
  assert.deepEqual(check, { suggestion: null, alternatives: ALTERNATIVES });
  clock += 1000;
  const chip = await assistant.ask(learner, { message: ALTERNATIVES[0].question, locale: "en-GB", faqId: ALTERNATIVES[0].faqId }, randomUUID());
  assert.deepEqual((await repository.findAssist(chip.response.id))?.alternatives, [], "an answer row stores none (NULL)");
  const racing = await Promise.allSettled([5, 1, 3].map((rating) => assistant.rate(learner, chip.response.id, rating)));
  const stored = await repository.findAiRating(chip.response.id);
  assert.ok(stored !== null);
  assert.equal(racing.filter((result) => result.status === "fulfilled").length, 1, "the database keeps the first rating; the others get 409");
  assert.deepEqual(await assistant.rate(learner, chip.response.id, stored), { id: chip.response.id, rating: stored });
  const count = await rows<{ n: number }>("SELECT count(*)::int AS n FROM helpdesk_ai_ratings WHERE run_id = $1", [chip.response.id]);
  assert.equal(count[0].n, 1);
  await assert.rejects(getPool().query("INSERT INTO helpdesk_ai_ratings (run_id, learner_id, source, rating, created_at) VALUES ($1, 'x', 'chat', 3, now())", [randomUUID()]), /foreign key/i, "a rating needs a logged answer");
  await assert.rejects(getPool().query("INSERT INTO helpdesk_ai_ratings (run_id, learner_id, source, rating, created_at) VALUES ($1, 'x', 'chat', 6, now())", [fallback.response.id]), /check constraint/i);
  const hd = service(now);
  const ticket = (await hd.createTicket(learner, { ...input("Rated"), assistIds: [fallback.response.id, chip.response.id] }, randomUUID())).ticket;
  assert.deepEqual((await hd.getAgentTicket(ticket.id)).aiAssist.map((item) => [item.id, item.rating]), [[fallback.response.id, null], [chip.response.id, stored]]);
});
