// Figma addendum (2026-10-28) behaviour of the Helpdesk service: contact
// email, declined AI suggestions, the wider attachment set, tags, the unread
// flag, the BackOffice student / subscription projection and email on agent
// replies and "handled" proposals.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { HelpdeskProblem, type UploadInput } from "../../contracts/helpdesk";
import { createHelpdeskService, type HelpdeskDeps, type HelpdeskEmail } from "../../modules/helpdesk/service";
import type { StudentDirectoryEntry } from "../../modules/helpdesk/studentDirectory";
import { createLocalHelpdeskRepository } from "../../repositories/helpdeskRepository";
import { CSV, DOCX, EXE, GIF, HTML, PDF, PNG, SVG, XLSX } from "./helpdesk-fixtures";

let root = "";
before(async () => { root = await mkdtemp(path.join(tmpdir(), "lg-helpdesk-addendum-")); });
after(async () => { if (root && path.dirname(root) === tmpdir()) await rm(root, { recursive: true, force: true }); });

const learner = { id: "user-emily", email: "emily.carter@example.com", name: "Emily Carter" };
const wechatLearner = { id: "user-wechat", email: "", name: "WeChat Learner" };
const agent = { id: "emp-1", name: "Jack" };
const agent2 = { id: "emp-2", name: "Ben" };
const SUGGESTION_ID = "0192d4f0-7b6a-7c3e-9a10-0000000000aa";
const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function harness(options: Partial<HelpdeskDeps> = {}) {
  let clock = Date.parse("2026-10-28T06:00:00.000Z");
  const blobs = new Map<string, Buffer>();
  const emails: HelpdeskEmail[] = [];
  const logs: Array<Record<string, unknown>> = [];
  const service = createHelpdeskService({
    repository: createLocalHelpdeskRepository(path.join(root, randomUUID())),
    blobs: { async put(key, bytes) { blobs.set(key, Buffer.from(bytes)); }, async get(key) { const value = blobs.get(key); if (!value) throw new Error("missing blob"); return value; } },
    email: async (mail) => { emails.push(mail); },
    ticketLink: (ticketId, locale) => `https://www.example.test/${locale}/account/my-learning/support/${ticketId}`,
    now: () => new Date(clock),
    log: (line) => logs.push(line),
    ...options
  });
  return { service, blobs, emails, logs, advance(ms: number) { clock += ms; } };
}

const file = (bytes: Buffer, fileName: string, declaredType = "application/octet-stream"): UploadInput => ({ fileName, declaredType, bytes: new Uint8Array(bytes) });
const enquiry = (overrides: Record<string, unknown> = {}, files: UploadInput[] = []) => ({
  category: "technical_support" as const, subject: "Cannot log in to my account",
  body: "I am unable to log in to my account. It keeps showing an error message saying \"invalid email or password\" even though I am sure my details are correct.",
  locale: "en-GB" as const, contactEmail: null, suggestionId: null, files, ...overrides
});

async function rejects(promise: Promise<unknown>, code: string, field?: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof HelpdeskProblem, String(error));
    assert.equal(error.code, code);
    if (field) assert.equal(error.field, field);
    return true;
  });
}

test("contact email defaults to the account email, can be changed, and is required when the account has none", async () => {
  const h = harness();
  const defaulted = await h.service.createTicket(learner, enquiry(), randomUUID());
  assert.equal(defaulted.ticket.contactEmail, "emily.carter@example.com");
  const changed = await h.service.createTicket(learner, enquiry({ contactEmail: "emily@work.example" }), randomUUID());
  assert.equal(changed.ticket.contactEmail, "emily@work.example");
  const agentView = await h.service.getAgentTicket(changed.ticket.id);
  assert.equal(agentView.contactEmail, "emily@work.example");
  assert.equal(agentView.learner.email, "emily.carter@example.com", "the account email is unchanged");
  await rejects(h.service.createTicket(wechatLearner, enquiry(), randomUUID()), "validation_failed", "contactEmail");
  const wechat = await h.service.createTicket(wechatLearner, enquiry({ contactEmail: "wx@example.com" }), randomUUID());
  assert.equal(wechat.ticket.contactEmail, "wx@example.com");
  const key = randomUUID();
  await h.service.createTicket(learner, enquiry({ contactEmail: "a@example.com" }), key);
  await rejects(h.service.createTicket(learner, enquiry({ contactEmail: "b@example.com" }), key), "idempotency_conflict");
});

test("a declined AI suggestion is recorded as ticket.suggestion_declined right after created; the learner timeline hides it", async () => {
  const h = harness();
  const key = randomUUID();
  const { ticket } = await h.service.createTicket(learner, enquiry({ suggestionId: SUGGESTION_ID }), key);
  assert.equal(ticket.sequence, 2);
  assert.deepEqual(ticket.timeline.map((item) => item.type), ["created"]);
  const agentView = await h.service.getAgentTicket(ticket.id);
  assert.equal(agentView.suggestionId, SUGGESTION_ID);
  assert.deepEqual(agentView.events.map((item) => [item.sequence, item.type.split(".").pop()]), [[1, "created"], [2, "suggestion_declined"]]);
  assert.deepEqual(agentView.events[1].data, { from_state: "OPEN", to_state: "OPEN", actor: { kind: "learner", id: learner.id, name: learner.name }, suggestion_id: SUGGESTION_ID });
  const replay = await h.service.createTicket(learner, enquiry({ suggestionId: SUGGESTION_ID }), key);
  assert.equal(replay.replayed, true);
  assert.equal((await h.service.getAgentTicket(ticket.id)).events.length, 2);
  await rejects(h.service.createTicket(learner, enquiry({ suggestionId: null }), key), "idempotency_conflict");
  const plain = await h.service.createTicket(learner, enquiry(), randomUUID());
  assert.equal(plain.ticket.sequence, 1);
  assert.equal((await h.service.getAgentTicket(plain.ticket.id)).suggestionId, null);
  const answered = await h.service.learnerAction(learner, ticket.id, { action: "cancel", expectedSequence: 2 }, randomUUID());
  assert.equal(answered.ticket.status, "CANCELLED", "the learner's page carries sequence 2 after a declined suggestion");
});

test("attachments: up to five of png/jpeg/webp/gif/pdf/txt/csv/docx/xlsx, typed by content, served back with the detected type", async () => {
  const h = harness();
  const { ticket } = await h.service.createTicket(learner, enquiry({}, [file(PDF, "invoice.pdf"), file(DOCX, "steps.docx"), file(XLSX, "payments.xlsx"), file(CSV, "rows.csv"), file(GIF, "screen.gif")]), randomUUID());
  const attachments = ticket.messages[0].attachments;
  assert.deepEqual(attachments.map((item) => item.contentType), ["application/pdf", DOCX_TYPE, XLSX_TYPE, "text/csv", "image/gif"]);
  assert.deepEqual(attachments.map((item) => item.fileName), ["invoice.pdf", "steps.docx", "payments.xlsx", "rows.csv", "screen.gif"]);
  const pdf = await h.service.readLearnerAttachment(learner, attachments[0].id);
  assert.equal(pdf.contentType, "application/pdf");
  assert.deepEqual(Buffer.from(pdf.bytes), PDF);
  for (const [bytes, name] of [[SVG, "a.svg"], [HTML, "a.html"], [EXE, "a.exe"], [HTML, "a.txt"]] as const) {
    await rejects(h.service.createTicket(learner, enquiry({}, [file(bytes, name)]), randomUUID()), "attachment_type_unsupported");
  }
  const reply = await h.service.learnerMessage(learner, ticket.id, { body: "More detail", expectedSequence: 1, files: [file(PNG, "a.png"), file(PNG, "b.png"), file(PNG, "c.png"), file(PNG, "d.png"), file(PNG, "e.png")] }, randomUUID());
  assert.equal(reply.ticket.messages.at(-1)?.attachments.length, 5);
});

test("tags: add and remove are idempotent agent bookkeeping events, at most 10, never shown to the learner", async () => {
  const h = harness();
  const { ticket } = await h.service.createTicket(learner, enquiry(), randomUUID());
  const before = await h.service.getAgentTicket(ticket.id);
  h.advance(60_000);
  const tagged = await h.service.agentAction(ticket.id, { action: "add_tag", agent, tag: "login issue", expectedSequence: null }, randomUUID());
  assert.deepEqual(tagged.ticket.tags, ["login issue"]);
  assert.equal(tagged.ticket.sequence, 2);
  assert.equal(tagged.ticket.updatedAt, before.updatedAt, "tagging does not reorder the queue");
  assert.deepEqual(tagged.ticket.events.at(-1)?.data, { from_state: "OPEN", to_state: "OPEN", actor: { kind: "agent", id: agent.id, name: agent.name }, tag: "login issue" });
  assert.equal(tagged.ticket.events.at(-1)?.type, "com.ilovelearningguide.helpdesk.ticket.tag_added");
  const again = await h.service.agentAction(ticket.id, { action: "add_tag", agent: agent2, tag: "login issue", expectedSequence: null }, randomUUID());
  assert.equal(again.ticket.sequence, 2, "adding a tag that is already there changes nothing");
  await h.service.agentAction(ticket.id, { action: "add_tag", agent, tag: "account access", expectedSequence: null }, randomUUID());
  const removed = await h.service.agentAction(ticket.id, { action: "remove_tag", agent, tag: "login issue", expectedSequence: null }, randomUUID());
  assert.deepEqual(removed.ticket.tags, ["account access"]);
  assert.equal(removed.ticket.events.at(-1)?.type, "com.ilovelearningguide.helpdesk.ticket.tag_removed");
  const missing = await h.service.agentAction(ticket.id, { action: "remove_tag", agent, tag: "never added", expectedSequence: null }, randomUUID());
  assert.equal(missing.ticket.sequence, removed.ticket.sequence);
  const replayKey = randomUUID();
  await h.service.agentAction(ticket.id, { action: "add_tag", agent, tag: "payment", expectedSequence: null }, replayKey);
  const replay = await h.service.agentAction(ticket.id, { action: "add_tag", agent, tag: "payment", expectedSequence: null }, replayKey);
  assert.equal(replay.replayed, true);
  await rejects(h.service.agentAction(ticket.id, { action: "add_tag", agent, tag: "other", expectedSequence: null }, replayKey), "idempotency_conflict");
  for (let index = 0; index < 8; index += 1) await h.service.agentAction(ticket.id, { action: "add_tag", agent, tag: `t${index}`, expectedSequence: null }, randomUUID());
  const full = await h.service.getAgentTicket(ticket.id);
  assert.equal(full.tags.length, 10);
  await rejects(h.service.agentAction(ticket.id, { action: "add_tag", agent, tag: "eleventh", expectedSequence: null }, randomUUID()), "tag_limit_reached");
  const learnerView = await h.service.getLearnerTicket(learner, ticket.id);
  assert.ok(!JSON.stringify(learnerView).includes("account access"), "tags are agent-only");
  assert.deepEqual(learnerView.timeline.map((item) => item.type), ["created"]);
  const listed = await h.service.listAgentTickets({ status: null, q: "", limit: 20, cursor: null, category: null, tag: "payment" });
  assert.deepEqual(listed.tickets.map((item) => item.id), [ticket.id]);
  assert.deepEqual(listed.tickets[0].tags, full.tags);
  assert.equal((await h.service.listAgentTickets({ status: null, q: "", limit: 20, cursor: null, category: null, tag: "nope" })).tickets.length, 0);
});

test("tags work on closed and withdrawn tickets", async () => {
  const h = harness();
  const { ticket } = await h.service.createTicket(learner, enquiry(), randomUUID());
  await h.service.learnerAction(learner, ticket.id, { action: "cancel", expectedSequence: 1 }, randomUUID());
  const tagged = await h.service.agentAction(ticket.id, { action: "add_tag", agent, tag: "duplicate", expectedSequence: null }, randomUUID());
  assert.equal(tagged.ticket.status, "CANCELLED");
  assert.deepEqual(tagged.ticket.tags, ["duplicate"]);
});

test("stale check: agent-private bookkeeping never makes a learner's page stale; a public change still does", async () => {
  const h = harness();
  const { ticket } = await h.service.createTicket(learner, enquiry(), randomUUID());
  await h.service.agentAction(ticket.id, { action: "claim", agent, expectedSequence: 1 }, randomUUID());
  const page = await h.service.getLearnerTicket(learner, ticket.id);
  await h.service.postAgentMessage(ticket.id, { body: "VIP", internal: true, agent, expectedSequence: page.sequence }, randomUUID());
  await h.service.agentAction(ticket.id, { action: "add_tag", agent, tag: "vip", expectedSequence: null }, randomUUID());
  const reply = await h.service.learnerMessage(learner, ticket.id, { body: "Any news?", expectedSequence: page.sequence, files: [] }, randomUUID());
  assert.equal(reply.ticket.status, "ASSIGNED");
  assert.equal(reply.ticket.sequence, page.sequence + 3);
  const agentPage = await h.service.getAgentTicket(ticket.id);
  await h.service.agentAction(ticket.id, { action: "add_tag", agent: agent2, tag: "follow-up", expectedSequence: null }, randomUUID());
  const agentReply = await h.service.postAgentMessage(ticket.id, { body: "Looking now", internal: false, agent, expectedSequence: agentPage.sequence }, randomUUID());
  assert.equal(agentReply.ticket.status, "WAITING_USER", "a colleague's tag does not make the agent stale");
  const agentPage2 = agentReply.ticket;
  await h.service.postAgentMessage(ticket.id, { body: "Careful: refund pending", internal: true, agent: agent2, expectedSequence: agentPage2.sequence }, randomUUID());
  await rejects(h.service.agentAction(ticket.id, { action: "propose_resolution", agent, expectedSequence: agentPage2.sequence }, randomUUID()), "stale_ticket");
  const learnerPage = await h.service.getLearnerTicket(learner, ticket.id);
  await h.service.postAgentMessage(ticket.id, { body: "One more thing", internal: false, agent, expectedSequence: learnerPage.sequence }, randomUUID());
  await rejects(h.service.learnerMessage(learner, ticket.id, { body: "ok", expectedSequence: learnerPage.sequence, files: [] }, randomUUID()), "stale_ticket");
});

test("unread flag: set by the learner's ticket and messages, cleared only by mark_read (no event)", async () => {
  const h = harness();
  const { ticket } = await h.service.createTicket(learner, enquiry(), randomUUID());
  let view = await h.service.getAgentTicket(ticket.id);
  assert.equal(view.unreadByAgent, true);
  const readKey = randomUUID();
  const read = await h.service.agentAction(ticket.id, { action: "mark_read", agent, expectedSequence: null }, readKey);
  assert.equal(read.ticket.unreadByAgent, false);
  assert.equal(read.ticket.sequence, 1, "mark_read is not an event");
  assert.equal((await h.service.agentAction(ticket.id, { action: "mark_read", agent, expectedSequence: null }, readKey)).ticket.unreadByAgent, false);
  view = (await h.service.postAgentMessage(ticket.id, { body: "Which browser?", internal: false, agent, expectedSequence: 1 }, randomUUID())).ticket;
  assert.equal(view.unreadByAgent, false);
  await h.service.learnerMessage(learner, ticket.id, { body: "Chrome", expectedSequence: view.sequence, files: [] }, randomUUID());
  view = await h.service.getAgentTicket(ticket.id);
  assert.equal(view.unreadByAgent, true);
  const summary = (await h.service.listAgentTickets({ status: null, q: "", limit: 20, cursor: null, category: null, tag: null })).tickets[0];
  assert.equal(summary.unreadByAgent, true);
  await h.service.agentAction(ticket.id, { action: "mark_read", agent, expectedSequence: null }, randomUUID());
  await h.service.agentAction(ticket.id, { action: "propose_resolution", agent, expectedSequence: view.sequence }, randomUUID());
  const confirmed = await h.service.learnerAction(learner, ticket.id, { action: "confirm", expectedSequence: view.sequence + 1 }, randomUUID());
  assert.equal(confirmed.ticket.status, "CLOSED");
  assert.equal((await h.service.getAgentTicket(ticket.id)).unreadByAgent, false, "confirming is not a new message");
});

test("agent list: contact email, one-line preview of the first message, search by name or contact email, category filter", async () => {
  const h = harness();
  const long = `${"Line one.\n\n   Line two ".repeat(10)}end`;
  const first = await h.service.createTicket(learner, enquiry({ body: long, contactEmail: "emily@work.example" }), randomUUID());
  h.advance(1000);
  await h.service.createTicket({ id: "user-daniel", email: "daniel.wu@example.com", name: "Daniel Wu" }, enquiry({ category: "payments_subscriptions", subject: "Payment was charged twice", body: "I noticed that my card was charged twice." }), randomUUID());
  const all = await h.service.listAgentTickets({ status: null, q: "", limit: 20, cursor: null, category: null, tag: null });
  const emily = all.tickets.find((item) => item.id === first.ticket.id);
  assert.ok(emily);
  assert.equal(emily.contactEmail, "emily@work.example");
  assert.equal(emily.preview.length, 120);
  assert.ok(!/\s{2,}|\n/.test(emily.preview), "one line");
  assert.ok(emily.preview.startsWith("Line one. Line two Line one."));
  assert.deepEqual(emily.tags, []);
  assert.deepEqual((await h.service.listAgentTickets({ status: null, q: "daniel wu", limit: 20, cursor: null, category: null, tag: null })).tickets.map((item) => item.subject), ["Payment was charged twice"]);
  assert.deepEqual((await h.service.listAgentTickets({ status: null, q: "work.example", limit: 20, cursor: null, category: null, tag: null })).tickets.map((item) => item.id), [first.ticket.id]);
  const billing = await h.service.listAgentTickets({ status: null, q: "", limit: 20, cursor: null, category: "payments_subscriptions", tag: null });
  assert.deepEqual(billing.tickets.map((item) => item.subject), ["Payment was charged twice"]);
  assert.equal(billing.counts.all, 1, "counts follow the category and tag filters, not the status tab");
});

test("agent detail: read-only student and subscription projection with the learner's enquiry count", async () => {
  const entry: StudentDirectoryEntry = {
    name: "Emily Carter", accountEmail: "emily.carter@example.com", joinedAt: "2024-01-15T09:00:00.000Z",
    currentCourse: { id: "c-web", title: "Advanced Web Development" },
    subscription: { planName: "Everything · PC · 12 months", billingCycle: "annual", status: "active", trial: false, renewalDate: "2027-01-15T00:00:00.000Z", validTo: "2027-01-15T00:00:00.000Z" }
  };
  const asked: string[] = [];
  const h = harness({ studentDirectory: async (userId) => { asked.push(userId); return entry; } });
  await h.service.createTicket(learner, enquiry(), randomUUID());
  const { ticket } = await h.service.createTicket(learner, enquiry({ contactEmail: "emily@work.example", subject: "Second" }), randomUUID());
  await h.service.createTicket({ id: "someone-else", email: "x@example.com", name: "X" }, enquiry(), randomUUID());
  const detail = await h.service.getAgentTicket(ticket.id);
  assert.deepEqual(asked, [learner.id]);
  assert.deepEqual(detail.student, {
    id: learner.id, name: "Emily Carter", accountEmail: "emily.carter@example.com", contactEmail: "emily@work.example",
    joinedAt: "2024-01-15T09:00:00.000Z", totalEnquiries: 2, currentCourse: { id: "c-web", title: "Advanced Web Development" }
  });
  assert.deepEqual(detail.subscription, entry.subscription);
  assert.deepEqual(detail.tags, []);
});

test("agent detail falls back to the ticket's own learner fields when the directory is missing or fails", async () => {
  const failing = harness({ studentDirectory: async () => { throw new Error("store down"); } });
  const { ticket } = await failing.service.createTicket(learner, enquiry(), randomUUID());
  const detail = await failing.service.getAgentTicket(ticket.id);
  assert.deepEqual(detail.student, { id: learner.id, name: learner.name, accountEmail: learner.email, contactEmail: learner.email, joinedAt: null, totalEnquiries: 1, currentCourse: null });
  assert.equal(detail.subscription, null);
  assert.ok(failing.logs.some((line) => line.event === "student_directory_failed"));
  const unknown = harness({ studentDirectory: async () => null });
  const other = await unknown.service.createTicket(learner, enquiry(), randomUUID());
  assert.equal((await unknown.service.getAgentTicket(other.ticket.id)).subscription, null);
});

test("email: an agent's public reply and 'handled' each mail the contact email with a link; internal notes never do", async () => {
  const h = harness();
  const { ticket } = await h.service.createTicket(learner, enquiry({ contactEmail: "emily@work.example" }), randomUUID());
  await h.service.postAgentMessage(ticket.id, { body: "Internal only", internal: true, agent, expectedSequence: 1 }, randomUUID());
  assert.equal(h.emails.length, 0);
  const replied = await h.service.postAgentMessage(ticket.id, { body: "Please try resetting your password from the sign-in page.", internal: false, agent, expectedSequence: 2 }, randomUUID());
  assert.equal(h.emails.length, 1);
  const link = `https://www.example.test/en-GB/account/my-learning/support/${ticket.id}`;
  assert.equal(h.emails[0].to, "emily@work.example");
  assert.equal(h.emails[0].subject, `[${ticket.number}] Support replied to your enquiry`);
  assert.ok(h.emails[0].text.includes("Please try resetting your password from the sign-in page."));
  assert.ok(h.emails[0].text.includes(link));
  assert.ok(h.emails[0].text.includes("Cannot log in to my account"));
  assert.ok(!h.emails[0].text.includes("Internal only"));
  await h.service.agentAction(ticket.id, { action: "propose_resolution", agent, expectedSequence: replied.ticket.sequence }, randomUUID());
  assert.equal(h.emails.length, 2);
  assert.equal(h.emails[1].subject, `[${ticket.number}] Is it solved?`);
  assert.ok(h.emails[1].text.includes("Is it solved?"));
  assert.ok(h.emails[1].text.includes("within 72 hours"), "states the auto-confirm window");
  assert.ok(h.emails[1].text.includes(link));
});

test("email copy follows the ticket locale with the short confirm wording", async () => {
  const h = harness();
  const { ticket } = await h.service.createTicket(learner, enquiry({ locale: "zh-CN" }), randomUUID());
  await h.service.agentAction(ticket.id, { action: "claim", agent, expectedSequence: 1 }, randomUUID());
  await h.service.agentAction(ticket.id, { action: "propose_resolution", agent, expectedSequence: 2 }, randomUUID());
  assert.equal(h.emails.length, 1);
  assert.equal(h.emails[0].subject, `[${ticket.number}] 问题解决了吗？`);
  assert.ok(h.emails[0].text.includes("问题解决了吗？"));
  assert.ok(h.emails[0].text.includes("/zh-CN/account/my-learning/support/"));
});

test("email failure, or no link available, never fails the agent's action", async () => {
  const failing = harness({ email: async () => { throw new Error("smtp down"); } });
  const { ticket } = await failing.service.createTicket(learner, enquiry(), randomUUID());
  const replied = await failing.service.postAgentMessage(ticket.id, { body: "Hi", internal: false, agent, expectedSequence: 1 }, randomUUID());
  assert.equal(replied.ticket.status, "WAITING_USER");
  assert.ok(failing.logs.some((line) => line.event === "email_failed" && line.ticketId === ticket.id));
  assert.ok(!JSON.stringify(failing.logs).includes(learner.email), "no address in logs");
  const noLink = harness({ ticketLink: () => null });
  const other = await noLink.service.createTicket(learner, enquiry(), randomUUID());
  await noLink.service.postAgentMessage(other.ticket.id, { body: "Hi there", internal: false, agent, expectedSequence: 1 }, randomUUID());
  assert.equal(noLink.emails.length, 1);
  assert.ok(!noLink.emails[0].text.includes("undefined") && !noLink.emails[0].text.includes("null"));
});

test("in-site notification for 'handled' uses the short wording", async () => {
  const notes: Array<{ title: string }> = [];
  const h = harness({ notify: async (item) => { notes.push(item); } });
  const { ticket } = await h.service.createTicket(learner, enquiry(), randomUUID());
  await h.service.agentAction(ticket.id, { action: "claim", agent, expectedSequence: 1 }, randomUUID());
  await h.service.agentAction(ticket.id, { action: "propose_resolution", agent, expectedSequence: 2 }, randomUUID());
  assert.deepEqual(notes.map((item) => item.title), ["Is it solved?"]);
});
