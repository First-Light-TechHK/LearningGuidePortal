// Helpdesk v5 Part G1/G2: the flywheel feed. Every assist turn as Admin's
// nightly gap mining reads it: the learner's words only through the code-only
// scrubber, the turn's labels as enum names (kind, intent, guard, via, nodes,
// release, vote, rating, handover, an enquiry after the chat, its outcome,
// signals, session and turn index), never the learner's id, name, email or
// account data. Read-only and paged by (createdAt, id) with a fixed window
// end, so the same cursor returns the same page.
// Storage is the real DEV-only local repository; Admin is a fake.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  ASSIST_FEEDBACK, ASSIST_SOURCES, ASSIST_VIAS, CHAT_END_REASONS, CLOSE_REASONS, HELPDESK_LOCALES, HelpdeskProblem, INSIGHT_LIMITS, SITUATION_SIGNALS, SUGGEST_INTENTS, TICKET_STATUSES, TURN_GUARDS, TURN_KINDS,
  encodeInsightsCursor, parseFaqRelease, parseInsightsQuery, parseSuggestTurn, type AdminSuggestReply, type AdminSuggestRequest, type FaqRelease, type InsightTurn
} from "../../contracts/helpdesk";
import { createAssistantService } from "../../modules/helpdesk/assistant";
import { createInsightsService, insightTurn } from "../../modules/helpdesk/insights";
import { createHelpdeskService } from "../../modules/helpdesk/service";
import { createLocalHelpdeskRepository } from "../../repositories/helpdeskRepository";

let root = "";
before(async () => { root = await mkdtemp(path.join(tmpdir(), "lg-helpdesk-insights-")); });
after(async () => { if (root && path.dirname(root) === tmpdir()) await rm(root, { recursive: true, force: true }); });

const fixture = JSON.parse(readFileSync("tests/fixtures/helpdesk-contract.json", "utf8")) as { portalToAdmin: Record<string, Record<string, unknown>> };
const RELEASE = parseFaqRelease(fixture.portalToAdmin.faqReleaseResponse) as FaqRelease;
const id = (n: number) => `01a18100-0000-7000-8000-${String(n).padStart(12, "0")}`;
const CHOICE = id(20), FAILED = id(21);
const learner = { id: "user_1761700000000_a1b2c3d4", email: "lin.learner42@example.test", name: "Lin Learner" };
const agent = { id: "emp-7", name: "Support Sam" };

function reply(name: string, input: AdminSuggestRequest): AdminSuggestReply {
  const body = structuredClone(fixture.portalToAdmin[name]);
  const suggestion = body.suggestion as Record<string, unknown> | null;
  if (suggestion) suggestion.id = input.runId;
  const turn = parseSuggestTurn(body);
  return { suggestion: suggestion as AdminSuggestReply["suggestion"], alternatives: (body.alternatives as AdminSuggestReply["alternatives"]) ?? [], ...(turn ? { turn } : {}) };
}

function harness() {
  let clock = Date.parse("2026-10-30T09:00:00.000Z");
  const now = () => new Date(clock);
  let next = "suggestNoMatchContextResponse";
  const repository = createLocalHelpdeskRepository(path.join(root, randomUUID()));
  const assistant = createAssistantService({
    repository,
    admin: { async suggest() { return null; }, async suggestReply(input: AdminSuggestRequest) { return reply(next, input); }, async reportOutcome() { return true; }, async faqs() { return []; }, async faq() { return null; } },
    now, log: () => undefined,
    release: { async current(locale) { return locale === RELEASE.locale ? RELEASE : null; } },
    learnerRecords: async () => ({ user: { email: learner.email, emailVerifiedAt: "2026-01-01T00:00:00.000Z" }, orders: [{ userId: learner.id, status: "failed", createdAt: "2026-10-30T08:00:00.000Z" }], subscriptions: [] })
  });
  const service = createHelpdeskService({ repository, blobs: { async put() {}, async get() { return new Uint8Array(); } }, now, log: () => undefined });
  const accounts = async (ids: string[]) => new Map(ids.filter((value) => value === learner.id).map((value) => [value, { name: learner.name, email: learner.email }]));
  let lag = 10 * 60_000;
  const insights = createInsightsService({ repository, accounts, now: () => new Date(clock + lag) });
  return { repository, assistant, service, insights, advance(ms: number) { clock += ms; }, answerWith(name: string) { next = name; }, readLater(ms: number) { lag = ms; } };
}

const RAW = "我叫 Lin Learner，手机 13800138000，邮箱 lin.learner42@example.test，订单 order_1761700000000_a1b2c3d4 付了钱没开通";

// ---------------------------------------------------------------- query

test("the query: since is required, until optional and not before since, limit 1-500 (default 200), the cursor keeps the window end", () => {
  const q = (value: string) => parseInsightsQuery(new URLSearchParams(value));
  assert.deepEqual(q("since=2026-10-29T00:00:00Z"), { since: "2026-10-29T00:00:00.000Z", until: null, cursor: null, limit: INSIGHT_LIMITS.pageDefault });
  assert.equal(q("since=2026-10-29&limit=9999").limit, INSIGHT_LIMITS.pageMax);
  assert.equal(q("since=2026-10-29T00:00:00%2B08:00").since, "2026-10-28T16:00:00.000Z");
  const field = (value: string) => { try { q(value); return null; } catch (error) { return error instanceof HelpdeskProblem ? error.field : "other"; } };
  assert.equal(field(""), "since");
  assert.equal(field("since=yesterday"), "since");
  assert.equal(field("since=2026-10-29&until=2026-10-28"), "until");
  assert.equal(field("since=2026-10-29&limit=0"), "limit");
  assert.equal(field("since=2026-10-29&limit=-1"), "limit");
  assert.equal(field("since=2026-10-29&cursor=abc"), "cursor");
  const cursor = encodeInsightsCursor({ createdAt: "2026-10-30T09:00:00.000Z", id: id(1), until: "2026-10-30T10:00:00.000Z" });
  assert.deepEqual(q(`since=2026-10-29&cursor=${cursor}`).cursor, { createdAt: "2026-10-30T09:00:00.000Z", id: id(1), until: "2026-10-30T10:00:00.000Z" });
});

// ---------------------------------------------------------------- content

test("a turn leaves Portal scrubbed with its labels as enum names; never the learner's id, name, email, order or raw words", async () => {
  const h = harness();
  const { sessionId } = await h.assistant.startSession(learner, { locale: "en-GB", orderId: null });
  const typed = await h.assistant.ask(learner, { message: RAW, locale: "en-GB", faqId: null, sessionId }, randomUUID());
  h.advance(1000);
  h.answerWith("suggestChoiceResponse");
  await h.assistant.ask(learner, { message: "payment problem", locale: "en-GB", faqId: null, sessionId }, randomUUID());
  h.advance(1000);
  const option = await h.assistant.click(learner, { locale: "en-GB", nodeId: FAILED, fromNodeId: CHOICE, via: "option", sessionId, label: null }, randomUUID());
  await h.assistant.feedback(learner, option.response.id, false);
  await h.assistant.rate(learner, option.response.id, 2);
  const page = await h.insights.page(parseInsightsQuery(new URLSearchParams("since=2026-10-30T00:00:00Z")));
  assert.equal(page.turns.length, 3);
  const [first, second, third] = page.turns;
  assert.equal(first.text, "我叫 <name>，手机 <phone>，邮箱 <email>，订单 <order> 付了钱没开通");
  assert.deepEqual([first.kind, first.via, first.intent, first.turnIndex, first.sessionId, first.answered], ["no_match", "typed", "question", 1, sessionId, false]);
  assert.deepEqual(first.signals, ["payment_failed"], "the session's signals, enum names only");
  assert.equal(first.id, typed.response.id);
  assert.deepEqual([second.kind, second.nodeId, second.intent, second.releaseVersion, second.turnIndex], ["answer", CHOICE, "question", 3, 2]);
  assert.equal(second.guard, null, "Admin sent no guard result for the choice");
  assert.deepEqual([third.via, third.nodeId, third.parentNodeId, third.vote, third.rating, third.answered, third.lastTurn], ["option", FAILED, CHOICE, "not_helpful", 2, true, true]);
  assert.equal(first.lastTurn, false);
  assert.equal(third.handover, false);
  assert.equal(third.ticketAfterChat, false);
  assert.equal(third.ticket, null);
  const json = JSON.stringify(page);
  for (const secret of [learner.id, learner.email, learner.name, "13800138000", "order_1761700000000", "lin.learner42", "Lin", "emily"]) assert.ok(!json.includes(secret), `no ${secret} in the feed`);
  const keys = new Set<string>();
  const walk = (value: unknown) => { if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) { if (!Array.isArray(value)) keys.add(key); walk(child); } };
  walk(page);
  for (const key of ["learnerId", "email", "name", "question", "answer", "faqQuestion", "texts", "alternatives", "traceId", "clientEventId", "payloadHash", "ticketId", "subject", "number"]) assert.ok(!keys.has(key), `no ${key} field`);
});

test("every label is one of the contract's enum values, and every field is in the contract's shape", async () => {
  const h = harness();
  const { sessionId } = await h.assistant.startSession(learner, { locale: "en-GB", orderId: null });
  for (const name of ["suggestAnswerContextResponse", "suggestSmalltalkResponse", "suggestNoMatchContextResponse", "suggestClarifyResponse"]) {
    h.answerWith(name);
    await h.assistant.ask(learner, { message: `question ${name}`, locale: "en-GB", faqId: null, sessionId }, randomUUID());
    h.advance(1000);
  }
  const { turns } = await h.insights.page(parseInsightsQuery(new URLSearchParams("since=2026-10-30T00:00:00Z")));
  assert.equal(turns.length, 4);
  const keys: Array<keyof InsightTurn> = ["id", "createdAt", "source", "locale", "text", "sessionId", "turnIndex", "lastTurn", "sessionEndReason", "kind", "intent", "guard", "via", "faqId", "nodeId", "parentNodeId", "releaseVersion", "answered", "vote", "rating", "covered", "expanded", "handover", "ticketAfterChat", "ticket", "signals"];
  for (const turn of turns) {
    assert.deepEqual(Object.keys(turn).sort(), [...keys].sort());
    assert.ok((ASSIST_SOURCES as readonly string[]).includes(turn.source));
    assert.ok((HELPDESK_LOCALES as readonly string[]).includes(turn.locale));
    assert.ok(turn.kind === null || (TURN_KINDS as readonly string[]).includes(turn.kind));
    assert.ok(turn.intent === null || (SUGGEST_INTENTS as readonly string[]).includes(turn.intent));
    assert.ok(turn.guard === null || (TURN_GUARDS as readonly string[]).includes(turn.guard));
    assert.ok(turn.via === null || (ASSIST_VIAS as readonly string[]).includes(turn.via));
    assert.ok(turn.vote === null || (ASSIST_FEEDBACK as readonly string[]).includes(turn.vote));
    assert.ok(turn.sessionEndReason === null || (CHAT_END_REASONS as readonly string[]).includes(turn.sessionEndReason));
    for (const signal of turn.signals) assert.ok((SITUATION_SIGNALS as readonly string[]).includes(signal));
  }
  assert.deepEqual(turns.map((turn) => turn.kind), ["answer", "smalltalk", "no_match", "clarify"]);
  assert.equal(turns[3].covered, true);
});

test("the enquiry after a chat: linked tickets and the learner's next enquiry within 24 hours; resolved by the agent with the agent's reply, scrubbed; the session's last turn is the handover", async () => {
  const h = harness();
  const { sessionId } = await h.assistant.startSession(learner, { locale: "en-GB", orderId: null });
  const first = await h.assistant.ask(learner, { message: "still basic after paying", locale: "en-GB", faqId: null, sessionId }, randomUUID());
  h.advance(1000);
  const second = await h.assistant.ask(learner, { message: "it still does not work", locale: "en-GB", faqId: null, sessionId }, randomUUID());
  h.advance(60_000);
  const created = await h.service.createTicket(learner, { category: "payments_subscriptions", subject: "Paid, still Basic", body: "Please check.", locale: "en-GB", files: [], assistIds: [first.response.id, second.response.id] }, randomUUID());
  const ticketId = created.ticket.id;
  let detail = await h.service.agentAction(ticketId, { action: "claim", agent, expectedSequence: created.ticket.sequence }, randomUUID());
  detail = await h.service.postAgentMessage(ticketId, { body: "Hi Lin Learner, I re-synced order order_1761700000000_a1b2c3d4; call 13800138000 if not.", internal: false, agent, expectedSequence: detail.ticket.sequence }, randomUUID());
  detail = await h.service.postAgentMessage(ticketId, { body: "internal: refund 199", internal: true, agent, expectedSequence: detail.ticket.sequence }, randomUUID());
  detail = await h.service.agentAction(ticketId, { action: "propose_resolution", agent, expectedSequence: detail.ticket.sequence }, randomUUID());
  await h.service.learnerAction(learner, ticketId, { action: "confirm", expectedSequence: detail.ticket.sequence }, randomUUID());
  // An unlinked turn an hour later: the same learner opens another enquiry within 24 hours, still open.
  h.advance(3_600_000);
  const later = await h.assistant.ask(learner, { message: "how do I change my plan", locale: "en-GB", faqId: null, sessionId: null }, randomUUID());
  h.advance(23 * 3_600_000);
  await h.service.createTicket(learner, { category: "other", subject: "Change plan", body: "How?", locale: "en-GB", files: [] }, randomUUID());
  h.advance(1000);
  // A turn whose next enquiry comes 25 hours later has none.
  const lonely = await h.assistant.ask(learner, { message: "where are my certificates", locale: "en-GB", faqId: null, sessionId: null }, randomUUID());
  h.advance(25 * 3_600_000);
  await h.service.createTicket(learner, { category: "other", subject: "Certificates", body: "Where?", locale: "en-GB", files: [] }, randomUUID());
  const { turns } = await h.insights.page(parseInsightsQuery(new URLSearchParams("since=2026-10-30T00:00:00Z")));
  const byId = new Map(turns.map((turn) => [turn.id, turn]));
  const a = byId.get(first.response.id)!;
  const b = byId.get(second.response.id)!;
  assert.deepEqual(a.ticket, { linked: true, status: "CLOSED", closeReason: "user_confirmed", resolvedByAgent: true, agentReplied: true, agentReply: "Hi <name>, I re-synced order <order>; call <phone> if not." });
  assert.equal(a.ticketAfterChat, true);
  assert.equal(a.handover, false, "an earlier turn of the session is not where it was handed over");
  assert.equal(b.sessionEndReason, "ticket");
  assert.equal(b.lastTurn, true);
  assert.equal(b.handover, true);
  const c = byId.get(later.response.id)!;
  assert.deepEqual(c.ticket, { linked: false, status: "OPEN", closeReason: null, resolvedByAgent: false, agentReplied: false, agentReply: null });
  assert.equal(c.ticketAfterChat, true);
  const d = byId.get(lonely.response.id)!;
  assert.equal(d.ticketAfterChat, false);
  assert.equal(d.ticket, null);
  assert.doesNotMatch(JSON.stringify(turns), /internal: refund|Paid, still Basic|LG-\d/, "no internal note, subject or ticket number");
});

test("a reply on an enquiry that is not resolved by the agent is not sent; a session ended as handover marks its last turn", async () => {
  const h = harness();
  const { sessionId } = await h.assistant.startSession(learner, { locale: "en-GB", orderId: null });
  const only = await h.assistant.ask(learner, { message: "I want a human", locale: "en-GB", faqId: null, sessionId }, randomUUID());
  await h.assistant.endSession(learner, sessionId, "handover");
  const created = await h.service.createTicket(learner, { category: "other", subject: "Human please", body: "Hi", locale: "en-GB", files: [], assistIds: [only.response.id] }, randomUUID());
  const claimed = await h.service.agentAction(created.ticket.id, { action: "claim", agent, expectedSequence: created.ticket.sequence }, randomUUID());
  await h.service.postAgentMessage(created.ticket.id, { body: "Looking into it.", internal: false, agent, expectedSequence: claimed.ticket.sequence }, randomUUID());
  const [turn] = (await h.insights.page(parseInsightsQuery(new URLSearchParams("since=2026-10-30T00:00:00Z")))).turns;
  assert.equal(turn.handover, true);
  assert.equal(turn.sessionEndReason, "handover");
  assert.deepEqual(turn.ticket, { linked: true, status: "WAITING_USER", closeReason: null, resolvedByAgent: false, agentReplied: true, agentReply: null });
  assert.ok((TICKET_STATUSES as readonly string[]).includes(turn.ticket!.status));
  assert.ok(CLOSE_REASONS.length === 4);
});

// ---------------------------------------------------------------- paging

test("paging: oldest first by (createdAt, id); the cursor keeps the window end, so the same cursor returns the same page and new turns wait for the next window", async () => {
  const h = harness();
  const ids: string[] = [];
  for (let index = 0; index < 5; index += 1) {
    ids.push((await h.assistant.ask(learner, { message: `question ${index}`, locale: "en-GB", faqId: null, sessionId: null }, randomUUID())).response.id);
    h.advance(index === 2 ? 0 : 1000);
  }
  // Read with the window ending right now: a turn written after the first page is outside it.
  h.readLater(INSIGHT_LIMITS.settleMs);
  const first = await h.insights.page(parseInsightsQuery(new URLSearchParams("since=2026-10-30T00:00:00Z&limit=2")));
  assert.equal(first.turns.length, 2);
  assert.ok(first.nextCursor);
  const again = await h.insights.page(parseInsightsQuery(new URLSearchParams(`since=2026-10-30T00:00:00Z&limit=2&cursor=${first.nextCursor}`)));
  // A turn written after the first page is outside its window.
  await h.assistant.ask(learner, { message: "late question", locale: "en-GB", faqId: null, sessionId: null }, randomUUID());
  const same = await h.insights.page(parseInsightsQuery(new URLSearchParams(`since=2026-10-30T00:00:00Z&limit=2&cursor=${first.nextCursor}`)));
  assert.deepEqual(same, again, "read-only and repeatable");
  const last = await h.insights.page(parseInsightsQuery(new URLSearchParams(`since=2026-10-30T00:00:00Z&limit=2&cursor=${again.nextCursor}`)));
  assert.equal(last.nextCursor, null);
  const rows = await Promise.all(ids.map((value) => h.repository.findAssist(value)));
  const expected = rows.map((row) => row!).sort((a, b) => (a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1)).map((row) => row.id);
  assert.equal(rows[2]!.createdAt, rows[3]!.createdAt, "two turns in the same millisecond: id breaks the tie");
  assert.deepEqual([...first.turns, ...again.turns, ...last.turns].map((turn) => turn.id), expected, "every turn once, in order");
  assert.equal(first.until, last.until);
  h.advance(1);
  const everything = await h.insights.page(parseInsightsQuery(new URLSearchParams("since=2026-10-30T00:00:00Z")));
  assert.equal(everything.turns.length, 6, "a new window includes the late turn");
});

test("the window ends a minute before now (a turn still being written is never half read); since after the end is an empty page", async () => {
  const h = harness();
  await h.assistant.ask(learner, { message: "first", locale: "en-GB", faqId: null, sessionId: null }, randomUUID());
  h.advance(5 * 60_000);
  await h.assistant.ask(learner, { message: "too fresh", locale: "en-GB", faqId: null, sessionId: null }, randomUUID());
  h.readLater(30_000);
  const page = await h.insights.page(parseInsightsQuery(new URLSearchParams("since=2026-10-30T00:00:00Z&until=2030-01-01T00:00:00Z")));
  assert.deepEqual(page.turns.map((turn) => turn.text), ["first"], "until is capped at now minus the settle time");
  assert.equal(page.until, new Date(Date.parse("2026-10-30T09:05:30.000Z") - INSIGHT_LIMITS.settleMs).toISOString());
  assert.deepEqual((await h.insights.page(parseInsightsQuery(new URLSearchParams("since=2026-10-31T00:00:00Z")))).turns, []);
});

test("insightTurn is pure: an older row (before v5) maps with nulls and its text is scrubbed with the account and the enquiries' contacts", () => {
  const turn = insightTurn({
    id: id(9), learnerId: "u1", source: "submit", locale: "zh-CN", question: "请联系 chen@example.cn 或陈美玲", faqId: null, faqQuestion: null, answer: null, feedback: "declined", ticketId: null,
    clientEventId: null, payloadHash: null, createdAt: "2026-05-01T00:00:00.000Z", feedbackDeliveredAt: null, feedbackAttemptedAt: null, alternatives: [],
    rating: null, scrubbedAt: null, sessionTurns: null, sessionEndReason: null, outcome: null, contacts: { names: ["陈美玲"], emails: ["chen@example.cn"] }
  }, { name: "Chen Mei", email: "mei@example.test" });
  assert.equal(turn.text, "请联系 <email> 或<name>");
  assert.deepEqual([turn.kind, turn.via, turn.sessionId, turn.turnIndex, turn.lastTurn, turn.guard, turn.handover, turn.ticketAfterChat], [null, null, null, null, null, null, false, false]);
  assert.deepEqual(turn.signals, []);
  assert.equal(turn.vote, "declined");
});
