// Helpdesk v2 (tickets-v2-figma-addendum.md §4a/§4b): the agent flag, the
// flagged / learnerId list filters, the AI assist log with its ticket linking
// rules and the BackOffice aiAssist projection, and the learner assistant
// (rate limit, Admin failures -> null, feedback first-wins). Storage is the
// real DEV-only local repository; Admin is a stub.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  AGENT_ACTIONS, ASSIST_FEEDBACK, FAQ_CATEGORIES, HELPDESK_LIMITS, HelpdeskProblem,
  parseAgentActionInput, parseAgentListQuery, parseAssistantFeedback, parseAssistantInput, parseCreateTicketInput, parseHelpCentreQuery,
  type AdminSuggestRequest, type HelpdeskSuggestion
} from "../../contracts/helpdesk";
import { decide, evolve, ignoredByStaleCheck, isLearnerVisibleEvent, type TicketRecord } from "../../modules/helpdesk/domain";
import { createHelpdeskService } from "../../modules/helpdesk/service";
import { createAssistantService } from "../../modules/helpdesk/assistant";
import { createLocalHelpdeskRepository } from "../../repositories/helpdeskRepository";

let root = "";
before(async () => { root = await mkdtemp(path.join(tmpdir(), "lg-helpdesk-v2-")); });
after(async () => { if (root && path.dirname(root) === tmpdir()) await rm(root, { recursive: true, force: true }); });

const learner = { id: "user-emily", email: "emily.carter@example.com", name: "Emily Carter" };
const other = { id: "user-other", email: "other@example.com", name: "Other Learner" };
const agent = { id: "emp-1", name: "Jack" };
const FAQ_ID = "0192d4f0-7b6a-7c3e-9a10-0000000000f1";
const HOUR = 3_600_000;

async function rejects(promise: Promise<unknown>, code: string, field?: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof HelpdeskProblem, String(error));
    assert.equal(error.code, code);
    if (field) assert.equal(error.field, field);
    return true;
  });
}

function problem(fn: () => unknown, code: string, field?: string) {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof HelpdeskProblem, String(error));
    assert.equal(error.code, code);
    if (field) assert.equal(error.field, field);
    return true;
  });
}

type AdminStub = {
  suggest(input: AdminSuggestRequest): Promise<HelpdeskSuggestion | null>;
  reportOutcome(id: string, outcome: string): Promise<boolean>;
};

function harness(adminOverride: Partial<AdminStub> = {}) {
  let clock = Date.parse("2026-10-28T06:00:00.000Z");
  const repository = createLocalHelpdeskRepository(path.join(root, randomUUID()));
  const suggestCalls: AdminSuggestRequest[] = [];
  const outcomes: Array<[string, string]> = [];
  const admin: AdminStub = {
    async suggest(input) {
      suggestCalls.push(input);
      if (input.faqId) return { id: randomUUID(), faqId: input.faqId, question: "How do I reset my password?", answer: "Open **Sign in**, then *Forgot password*." };
      return /password/i.test(input.message) ? { id: randomUUID(), faqId: FAQ_ID, question: "How do I reset my password?", answer: "Open **Sign in**, then Forgot password." } : null;
    },
    async reportOutcome(id, outcome) { outcomes.push([id, outcome]); return true; },
    ...adminOverride
  };
  const now = () => new Date(clock);
  const logs: Array<Record<string, unknown>> = [];
  const service = createHelpdeskService({ repository, blobs: { async put() {}, async get() { return new Uint8Array(); } }, now, log: () => undefined });
  const assistant = createAssistantService({ repository, admin, now, log: (line) => logs.push(line) });
  return { service, assistant, repository, suggestCalls, outcomes, logs, advance(ms: number) { clock += ms; } };
}

const enquiry = (overrides: Record<string, unknown> = {}) => ({
  category: "technical_support" as const, subject: "Cannot log in", body: "The reset email never arrives.", locale: "en-GB" as const,
  contactEmail: null, suggestionId: null, assistIds: [] as string[], files: [], ...overrides
});

// ---------------------------------------------------------------- contract

test("v2 contract: flag / unflag actions need expectedSequence; FAQ categories, assistant limits and feedback values", () => {
  assert.deepEqual([...AGENT_ACTIONS].slice(-2), ["flag", "unflag"]);
  assert.deepEqual(parseAgentActionInput({ action: "flag", agent, expectedSequence: 3 }), { action: "flag", agent, expectedSequence: 3 });
  problem(() => parseAgentActionInput({ action: "unflag", agent }), "validation_failed", "expectedSequence");
  assert.deepEqual([...FAQ_CATEGORIES], ["account_technical", "courses_learning", "payments_subscriptions", "other"]);
  assert.deepEqual([...ASSIST_FEEDBACK], ["helpful", "not_helpful", "solved", "declined", "edited"]);
  assert.equal(HELPDESK_LIMITS.assistantPerHour, 30);
  assert.equal(HELPDESK_LIMITS.assistIdsPerTicket, 10);
  assert.equal(HELPDESK_LIMITS.assistQuestionMax, 500);
});

test("v2 contract: agent list accepts flagged=true and learnerId=", () => {
  const query = parseAgentListQuery(new URLSearchParams("flagged=true&learnerId=%20user-emily%20"));
  assert.equal(query.flagged, true);
  assert.equal(query.learnerId, "user-emily");
  assert.equal(parseAgentListQuery(new URLSearchParams("flagged=false")).flagged, null, "false means no filter");
  assert.equal(parseAgentListQuery(new URLSearchParams("")).learnerId, null);
  problem(() => parseAgentListQuery(new URLSearchParams("flagged=yes")), "validation_failed", "flagged");
  problem(() => parseAgentListQuery(new URLSearchParams(`learnerId=${"x".repeat(129)}`)), "validation_failed", "learnerId");
  problem(() => parseAgentListQuery(new URLSearchParams("learnerId=a%00b")), "validation_failed", "learnerId");
});

test("v2 contract: create accepts up to 10 distinct assistIds (UUIDs, one value or repeated)", () => {
  const base = { category: "other", subject: "s", body: "b", locale: "en-GB" };
  const id = randomUUID();
  assert.deepEqual(parseCreateTicketInput({ ...base, assistIds: id.toUpperCase() }, []).assistIds, [id]);
  assert.deepEqual(parseCreateTicketInput({ ...base, assistIds: [id, id] }, []).assistIds, [id], "duplicates collapse");
  assert.deepEqual(parseCreateTicketInput(base, []).assistIds, []);
  assert.equal(parseCreateTicketInput({ ...base, assistIds: Array.from({ length: 10 }, () => randomUUID()) }, []).assistIds?.length, 10);
  problem(() => parseCreateTicketInput({ ...base, assistIds: Array.from({ length: 11 }, () => randomUUID()) }, []), "validation_failed", "assistIds");
  problem(() => parseCreateTicketInput({ ...base, assistIds: ["nope"] }, []), "validation_failed", "assistIds");
});

test("v2 contract: assistant input is 1..500 code points, a locale and an optional FAQ id; feedback is a boolean", () => {
  assert.deepEqual(parseAssistantInput({ message: "  How do I reset?  ", locale: "zh-CN" }), { message: "How do I reset?", locale: "zh-CN", faqId: null });
  assert.equal(parseAssistantInput({ message: "q", locale: "en-GB", faqId: FAQ_ID.toUpperCase() }).faqId, FAQ_ID);
  assert.equal(parseAssistantInput({ message: "密".repeat(500), locale: "en-GB" }).message.length, 500);
  problem(() => parseAssistantInput({ message: "a".repeat(501), locale: "en-GB" }), "validation_failed", "message");
  problem(() => parseAssistantInput({ message: "   ", locale: "en-GB" }), "validation_failed", "message");
  problem(() => parseAssistantInput({ message: "q", locale: "fr-FR" }), "validation_failed", "locale");
  problem(() => parseAssistantInput({ message: "q", locale: "en-GB", faqId: "x" }), "validation_failed", "faqId");
  assert.equal(parseAssistantFeedback({ helpful: false }), false);
  problem(() => parseAssistantFeedback({ helpful: "yes" }), "validation_failed", "helpful");
});

test("v2 contract: Help Centre query reads q, a known category and a FAQ id; anything else is ignored", () => {
  assert.deepEqual(parseHelpCentreQuery({ q: "  invoice ", category: "payments_subscriptions", faq: FAQ_ID }), { q: "invoice", category: "payments_subscriptions", faq: FAQ_ID });
  assert.deepEqual(parseHelpCentreQuery({ q: ["a", "b"], category: "billing", faq: "1" }), { q: "a", category: null, faq: null });
  assert.equal(parseHelpCentreQuery({ q: "x".repeat(300) }).q.length, HELPDESK_LIMITS.queryMax);
  assert.equal(parseHelpCentreQuery({ q: "a\u0000b" }).q, "");
});

// ---------------------------------------------------------------- domain

test("flag / unflag: agent bookkeeping on any state; never moves activity, never shown to or stales anyone", () => {
  const at = new Date("2026-10-28T08:00:00.000Z");
  const ticket = { status: "CLOSED", assigneeId: "emp-1", confirmDueAt: null, closedAt: at.toISOString(), rating: null, flaggedAt: null } as unknown as TicketRecord;
  for (const status of ["OPEN", "ASSIGNED", "WAITING_USER", "PENDING_CONFIRM", "CLOSED", "CANCELLED"] as const) {
    assert.equal(decide({ ...ticket, status }, "flag", "agent", at).ok, true, status);
    assert.equal(decide({ ...ticket, status }, "unflag", "agent", at).ok, true, status);
    assert.equal(decide({ ...ticket, status }, "flag", "learner", at).ok, false);
  }
  const record = { ...ticket, status: "ASSIGNED", sequence: 4, updatedAt: "2026-10-27T00:00:00.000Z", lastMessageAt: "2026-10-27T00:00:00.000Z", lastMessageBy: "learner", flaggedBy: null } as unknown as TicketRecord;
  const decision = decide(record, "flag", "agent", at);
  assert.ok(decision.ok);
  const flagged = evolve(record, decision, { now: at, actor: { kind: "agent", id: "emp-1", name: "Jack" }, publicMessage: false });
  assert.equal(flagged.flaggedAt, at.toISOString());
  assert.equal(flagged.flaggedBy, "emp-1");
  assert.equal(flagged.updatedAt, record.updatedAt, "bookkeeping keeps the activity time");
  assert.equal(flagged.status, "ASSIGNED");
  const undo = decide(flagged, "unflag", "agent", at);
  assert.ok(undo.ok);
  const unflagged = evolve(flagged, undo, { now: at, actor: { kind: "agent", id: "emp-2", name: "Ben" }, publicMessage: false });
  assert.equal(unflagged.flaggedAt, null);
  assert.equal(unflagged.flaggedBy, null);
  for (const name of ["flagged", "unflagged"] as const) {
    assert.equal(isLearnerVisibleEvent(name), false);
    assert.equal(ignoredByStaleCheck(name, "learner"), true);
    assert.equal(ignoredByStaleCheck(name, "agent"), true, "a flag never makes another agent's reply stale");
  }
});

// ---------------------------------------------------------------- flag + filters (service)

test("flag / unflag through the service: idempotent, CloudEvents, flagged in summary and detail, learner sees nothing", async () => {
  const h = harness();
  const created = (await h.service.createTicket(learner, enquiry(), randomUUID())).ticket;
  const flagged = (await h.service.agentAction(created.id, { action: "flag", agent, expectedSequence: 1 }, randomUUID())).ticket;
  assert.equal(flagged.flagged, true);
  assert.equal(flagged.sequence, 2);
  assert.equal(flagged.events.at(-1)?.type, "com.ilovelearningguide.helpdesk.ticket.flagged");
  assert.deepEqual(flagged.events.at(-1)?.data.actor, { kind: "agent", id: "emp-1", name: "Jack" });
  const again = (await h.service.agentAction(created.id, { action: "flag", agent, expectedSequence: 2 }, randomUUID())).ticket;
  assert.equal(again.sequence, 2, "flagging a flagged enquiry changes nothing");
  const key = randomUUID();
  const replay = await h.service.agentAction(created.id, { action: "flag", agent, expectedSequence: 2 }, key);
  assert.equal(replay.ticket.flagged, true);
  const learnerView = await h.service.getLearnerTicket(learner, created.id);
  assert.equal(learnerView.timeline.some((item) => item.type === "flagged"), false);
  assert.equal("flagged" in learnerView, false, "the learner projection has no flag");
  const list = await h.service.listAgentTickets(parseAgentListQuery(new URLSearchParams("")));
  assert.equal(list.tickets[0].flagged, true);
  // A learner reply after the flag is not stale, and an agent reply on the pre-flag sequence is not stale either.
  await h.service.postAgentMessage(created.id, { body: "Looking", internal: false, agent, expectedSequence: 1 }, randomUUID());
  const unflagged = (await h.service.agentAction(created.id, { action: "unflag", agent, expectedSequence: 3 }, randomUUID())).ticket;
  assert.equal(unflagged.flagged, false);
  assert.equal(unflagged.events.at(-1)?.type, "com.ilovelearningguide.helpdesk.ticket.unflagged");
  await rejects(h.service.agentAction(created.id, { action: "flag", agent, expectedSequence: null }, randomUUID()), "validation_failed", "expectedSequence");
});

test("agent list filters: flagged=true and learnerId= (the student timeline), with counts inside the filter", async () => {
  const h = harness();
  const a = (await h.service.createTicket(learner, enquiry({ subject: "A" }), randomUUID())).ticket;
  h.advance(1000);
  const b = (await h.service.createTicket(learner, enquiry({ subject: "B" }), randomUUID())).ticket;
  h.advance(1000);
  const c = (await h.service.createTicket(other, enquiry({ subject: "C" }), randomUUID())).ticket;
  await h.service.agentAction(a.id, { action: "flag", agent, expectedSequence: 1 }, randomUUID());
  await h.service.agentAction(c.id, { action: "flag", agent, expectedSequence: 1 }, randomUUID());
  const flagged = await h.service.listAgentTickets(parseAgentListQuery(new URLSearchParams("flagged=true")));
  assert.deepEqual(flagged.tickets.map((item) => item.subject), ["C", "A"]);
  assert.equal(flagged.counts.all, 2);
  const timeline = await h.service.listAgentTickets(parseAgentListQuery(new URLSearchParams(`learnerId=${learner.id}`)));
  assert.deepEqual(timeline.tickets.map((item) => item.subject), ["B", "A"]);
  assert.equal(timeline.counts.all, 2);
  const both = await h.service.listAgentTickets(parseAgentListQuery(new URLSearchParams(`learnerId=${learner.id}&flagged=true`)));
  assert.deepEqual(both.tickets.map((item) => item.id), [a.id]);
  assert.equal(b.status, "OPEN");
});

// ---------------------------------------------------------------- assistant

test("assistant: chat asks Admin with source chat, a chip with source chip + faqId; every answer is logged; null is the fallback", async () => {
  const h = harness();
  const chat = await h.assistant.ask(learner, { message: "I forgot my password", locale: "en-GB", faqId: null }, randomUUID());
  assert.equal(chat.replayed, false);
  assert.ok(chat.response.reply);
  assert.equal(chat.response.id, chat.response.reply.id, "the row id is Admin's suggestion id");
  assert.deepEqual(h.suggestCalls[0], { learnerId: learner.id, locale: "en-GB", source: "chat", message: "I forgot my password" });
  const chip = await h.assistant.ask(learner, { message: "How do I reset my password?", locale: "zh-CN", faqId: FAQ_ID }, randomUUID());
  assert.equal(chip.response.reply?.faqId, FAQ_ID);
  assert.deepEqual(h.suggestCalls[1], { learnerId: learner.id, locale: "zh-CN", source: "chip", message: "How do I reset my password?", faqId: FAQ_ID });
  const none = await h.assistant.ask(learner, { message: "Where is my refund?", locale: "en-GB", faqId: null }, randomUUID());
  assert.equal(none.response.reply, null);
  assert.match(none.response.id, /^[0-9a-f]{8}-[0-9a-f]{4}-7/, "a Portal UUIDv7 when Admin returned null");
  const row = await h.repository.findAssist(none.response.id);
  assert.equal(row?.answer, null);
  assert.equal(row?.source, "chat");
  assert.equal(row?.question, "Where is my refund?");
  const answered = await h.repository.findAssist(chat.response.id);
  assert.equal(answered?.faqId, FAQ_ID);
  assert.equal(answered?.faqQuestion, "How do I reset my password?");
  assert.equal(answered?.answer, "Open **Sign in**, then Forgot password.");
  assert.equal(answered?.learnerId, learner.id);
});

test("assistant: the same Idempotency-Key replays the stored reply without asking Admin again; a different question conflicts", async () => {
  const h = harness();
  const key = randomUUID();
  const first = await h.assistant.ask(learner, { message: "reset password", locale: "en-GB", faqId: null }, key);
  const second = await h.assistant.ask(learner, { message: "reset password", locale: "en-GB", faqId: null }, key);
  assert.equal(second.replayed, true);
  assert.deepEqual(second.response, first.response);
  assert.equal(h.suggestCalls.length, 1);
  await rejects(h.assistant.ask(learner, { message: "something else", locale: "en-GB", faqId: null }, key), "idempotency_conflict");
  await rejects(h.assistant.ask(other, { message: "reset password", locale: "en-GB", faqId: null }, key), "idempotency_conflict");
});

test("assistant: 30 questions per learner per rolling hour (chat + chip), then 429 rate_limited with retryAfter; submit checks do not count", async () => {
  const h = harness();
  for (let index = 0; index < 5; index += 1) await h.assistant.suggestForSubmit(learner, { category: "other", subject: "s", message: "password", locale: "en-GB" });
  for (let index = 0; index < 30; index += 1) {
    await h.assistant.ask(learner, { message: `question ${index}`, locale: "en-GB", faqId: index % 2 ? FAQ_ID : null }, randomUUID());
    h.advance(1000);
  }
  await assert.rejects(h.assistant.ask(learner, { message: "one more", locale: "en-GB", faqId: null }, randomUUID()), (error: unknown) => {
    assert.ok(error instanceof HelpdeskProblem);
    assert.equal(error.code, "rate_limited");
    assert.equal(error.status, 429);
    assert.equal(error.extra.retryAfter, 3600 - 30);
    return true;
  });
  assert.equal(h.suggestCalls.filter((call) => call.source !== "submit").length, 30, "a limited question never reaches Admin");
  await h.assistant.ask(other, { message: "other learner", locale: "en-GB", faqId: null }, randomUUID());
  h.advance(HOUR - 29_000);
  await h.assistant.ask(learner, { message: "an hour later", locale: "en-GB", faqId: null }, randomUUID());
});

test("assistant: an Admin failure or timeout is a null reply (the UI shows the fallback), still logged", async () => {
  const h = harness({ async suggest() { throw new Error("down"); } });
  const result = await h.assistant.ask(learner, { message: "reset password", locale: "en-GB", faqId: null }, randomUUID());
  assert.equal(result.response.reply, null);
  assert.ok(await h.repository.findAssist(result.response.id));
  const slow = harness({ suggest: () => new Promise(() => undefined) });
  const timed = createAssistantService({ repository: slow.repository, admin: { suggest: () => new Promise(() => undefined), reportOutcome: async () => true }, timeoutMs: 30 });
  const started = Date.now();
  assert.equal((await timed.ask(learner, { message: "reset password", locale: "en-GB", faqId: null }, randomUUID())).response.reply, null);
  assert.ok(Date.now() - started < 1_000);
});

test("assistant feedback: own answered rows only, first value wins, forwarded to Admin as helpful / not_helpful", async () => {
  const h = harness();
  const asked = await h.assistant.ask(learner, { message: "reset password", locale: "en-GB", faqId: null }, randomUUID());
  await rejects(h.assistant.feedback(other, asked.response.id, true), "not_found");
  assert.deepEqual(await h.assistant.feedback(learner, asked.response.id, false), { id: asked.response.id, feedback: "not_helpful" });
  assert.deepEqual(await h.assistant.feedback(learner, asked.response.id, true), { id: asked.response.id, feedback: "not_helpful" }, "the first value wins");
  assert.deepEqual(h.outcomes, [[asked.response.id, "not_helpful"]], "Admin is told once");
  const none = await h.assistant.ask(learner, { message: "refund", locale: "en-GB", faqId: null }, randomUUID());
  await rejects(h.assistant.feedback(learner, none.response.id, true), "not_found", undefined);
  await rejects(h.assistant.feedback(learner, randomUUID(), true), "not_found");
});

test("submit-time suggestion is logged with source submit; its outcome is stored first-wins and forwarded even when Admin is down", async () => {
  let up = true;
  const h = harness({ async reportOutcome() { return up; } });
  const suggestion = await h.assistant.suggestForSubmit(learner, { category: "technical_support", subject: "Password", message: "reset password please", locale: "en-GB" });
  assert.ok(suggestion);
  assert.deepEqual(h.suggestCalls[0], { learnerId: learner.id, locale: "en-GB", source: "submit", category: "technical_support", subject: "Password", message: "reset password please" });
  const row = await h.repository.findAssist(suggestion.id);
  assert.equal(row?.source, "submit");
  assert.equal(row?.question, "Password");
  up = false;
  assert.deepEqual(await h.assistant.submitOutcome(learner, suggestion.id, "declined"), { id: suggestion.id, feedback: "declined", delivered: false });
  assert.equal((await h.assistant.submitOutcome(learner, suggestion.id, "solved")).feedback, "declined");
  await rejects(h.assistant.submitOutcome(other, suggestion.id, "solved"), "not_found");
  assert.equal(await h.assistant.suggestForSubmit(learner, { category: "other", subject: "Refund", message: "money back", locale: "en-GB" }), null);
});

// ---------------------------------------------------------------- linking + aiAssist

test("ticket create links the learner's own, unlinked, < 24 h old assist rows (assistIds + suggestionId); agent detail lists them oldest first", async () => {
  const h = harness();
  const old = await h.assistant.ask(learner, { message: "old password question", locale: "en-GB", faqId: null }, randomUUID());
  h.advance(24 * HOUR + 1);
  const chat = await h.assistant.ask(learner, { message: "I forgot my password", locale: "en-GB", faqId: null }, randomUUID());
  await h.assistant.feedback(learner, chat.response.id, true);
  h.advance(1000);
  const fallback = await h.assistant.ask(learner, { message: "Refund for order 42?", locale: "en-GB", faqId: null }, randomUUID());
  const foreign = await h.assistant.ask(other, { message: "password again", locale: "en-GB", faqId: null }, randomUUID());
  h.advance(1000);
  const submit = await h.assistant.suggestForSubmit(learner, { category: "technical_support", subject: "Password still broken", message: "password", locale: "en-GB" });
  assert.ok(submit);
  await h.assistant.submitOutcome(learner, submit.id, "declined");
  const ticket = (await h.service.createTicket(learner, enquiry({ suggestionId: submit.id, assistIds: [old.response.id, chat.response.id, fallback.response.id, foreign.response.id, randomUUID()] }), randomUUID())).ticket;
  const detail = await h.service.getAgentTicket(ticket.id);
  assert.deepEqual(detail.aiAssist.map((item) => item.id), [chat.response.id, fallback.response.id, submit.id]);
  assert.deepEqual(detail.aiAssist[0], {
    id: chat.response.id, source: "chat", question: "I forgot my password", faqId: FAQ_ID, faqQuestion: "How do I reset my password?",
    answer: "Open **Sign in**, then Forgot password.", feedback: "helpful", createdAt: "2026-10-29T06:00:00.001Z"
  });
  assert.equal(detail.aiAssist[1].answer, null);
  assert.equal(detail.aiAssist[2].feedback, "declined");
  assert.equal(detail.aiAssist[2].source, "submit");
  // Already linked rows are never moved to a second ticket.
  const second = (await h.service.createTicket(learner, enquiry({ subject: "Again", assistIds: [chat.response.id] }), randomUUID())).ticket;
  assert.deepEqual((await h.service.getAgentTicket(second.id)).aiAssist, []);
  assert.equal("aiAssist" in (await h.service.getLearnerTicket(learner, ticket.id)), false, "learners never get the agent projection");
});

test("assistIds are part of the create payload: same key + same ids replays, other ids conflict", async () => {
  const h = harness();
  const chat = await h.assistant.ask(learner, { message: "password", locale: "en-GB", faqId: null }, randomUUID());
  const key = randomUUID();
  const first = await h.service.createTicket(learner, enquiry({ assistIds: [chat.response.id] }), key);
  const replay = await h.service.createTicket(learner, enquiry({ assistIds: [chat.response.id] }), key);
  assert.equal(replay.replayed, true);
  assert.equal(replay.ticket.id, first.ticket.id);
  await rejects(h.service.createTicket(learner, enquiry({ assistIds: [] }), key), "idempotency_conflict");
});
