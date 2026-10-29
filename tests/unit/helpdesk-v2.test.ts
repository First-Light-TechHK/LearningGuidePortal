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
      // As Admin does: the suggestion id is the run id Portal sent.
      if (input.faqId) return { id: input.runId, faqId: input.faqId, question: "How do I reset my password?", answer: "Open **Sign in**, then *Forgot password*." };
      return /password/i.test(input.message) ? { id: input.runId, faqId: FAQ_ID, question: "How do I reset my password?", answer: "Open **Sign in**, then Forgot password." } : null;
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
  assert.deepEqual(h.suggestCalls[0], { learnerId: learner.id, locale: "en-GB", source: "chat", message: "I forgot my password", runId: chat.response.id, parentRunId: null });
  const chip = await h.assistant.ask(learner, { message: "How do I reset my password?", locale: "zh-CN", faqId: FAQ_ID }, randomUUID());
  assert.equal(chip.response.reply?.faqId, FAQ_ID);
  assert.deepEqual(h.suggestCalls[1], { learnerId: learner.id, locale: "zh-CN", source: "chip", message: "How do I reset my password?", faqId: FAQ_ID, runId: chip.response.id, parentRunId: chat.response.id });
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

test("assistant runs (Admin tracing): runId is the row Portal stores, even for a null or failed answer; parentRunId is the conversation's first row", async () => {
  let down = false;
  const calls: AdminSuggestRequest[] = [];
  const h = {
    ...harness({
      async suggest(input) {
        calls.push(input);
        if (down) throw new Error("down");
        return /password/i.test(input.message) ? { id: input.runId, faqId: FAQ_ID, question: "How do I reset my password?", answer: "Open **Sign in**." } : null;
      }
    }),
    suggestCalls: calls
  };
  const first = await h.assistant.ask(learner, { message: "Refund for order 42?", locale: "en-GB", faqId: null }, randomUUID());
  assert.equal(first.response.reply, null);
  assert.equal(h.suggestCalls[0].runId, first.response.id, "the null answer's row is the run Admin traced");
  assert.equal(h.suggestCalls[0].parentRunId, null, "the first row starts the conversation");
  h.advance(1000);
  const second = await h.assistant.ask(learner, { message: "I forgot my password", locale: "en-GB", faqId: null }, randomUUID());
  assert.equal(second.response.id, h.suggestCalls[1].runId);
  assert.equal(h.suggestCalls[1].parentRunId, first.response.id);
  const foreign = await h.assistant.ask(other, { message: "password", locale: "en-GB", faqId: null }, randomUUID());
  assert.equal(h.suggestCalls[2].parentRunId, null, "another learner's conversation is their own");
  h.advance(1000);
  down = true;
  const failed = await h.assistant.ask(learner, { message: "password again", locale: "en-GB", faqId: null }, randomUUID());
  assert.equal(failed.response.reply, null);
  assert.equal(h.suggestCalls[3].runId, failed.response.id, "a failed call is still traceable by its row id");
  assert.equal(h.suggestCalls[3].parentRunId, first.response.id);
  down = false;
  const submit = await h.assistant.suggestForSubmit(learner, { category: "technical_support", subject: "Password", message: "password", locale: "en-GB" });
  assert.ok(submit);
  assert.equal(submit.id, h.suggestCalls[4].runId);
  assert.equal(h.suggestCalls[4].parentRunId, first.response.id, "the submit check belongs to the same conversation");
  assert.ok(await h.repository.findAssist(submit.id));
  // Submitting the enquiry links the rows: the next question starts a new conversation.
  await h.service.createTicket(learner, enquiry({ suggestionId: submit.id, assistIds: [first.response.id, second.response.id, failed.response.id] }), randomUUID());
  const after = await h.assistant.ask(learner, { message: "Where is my invoice?", locale: "en-GB", faqId: null }, randomUUID());
  assert.equal(h.suggestCalls[5].parentRunId, null);
  // Rows older than the 24 h link window no longer hold a conversation open.
  h.advance(24 * HOUR + 1);
  await h.assistant.ask(learner, { message: "Still no invoice", locale: "en-GB", faqId: null }, randomUUID());
  assert.equal(h.suggestCalls[6].parentRunId, null);
  assert.notEqual(h.suggestCalls[6].runId, after.response.id);
  assert.equal(new Set(h.suggestCalls.map((call) => call.runId)).size, 7, "every call is its own run");
  assert.ok(foreign.response.id);
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
  assert.deepEqual(h.suggestCalls[0], { learnerId: learner.id, locale: "en-GB", source: "submit", category: "technical_support", subject: "Password", message: "reset password please", runId: suggestion.id, parentRunId: null });
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
    answer: "Open **Sign in**, then Forgot password.", feedback: "helpful", createdAt: "2026-10-29T06:00:00.001Z", rating: null
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

// ---------------------------------------------------------------- final verification (2026-10-29)

test("submit-time checks: at most 10 per learner per rolling hour; over it the answer is null without asking Admin or writing a row", async () => {
  const h = harness();
  const since = () => new Date(Date.parse("2026-10-28T06:00:00.000Z") - 1).toISOString();
  for (let index = 0; index < HELPDESK_LIMITS.submitChecksPerHour; index += 1) {
    assert.ok(await h.assistant.suggestForSubmit(learner, { category: "other", subject: `s${index}`, message: "password", locale: "en-GB" }));
    h.advance(1000);
  }
  assert.equal(HELPDESK_LIMITS.submitChecksPerHour, 10);
  assert.equal(await h.assistant.suggestForSubmit(learner, { category: "other", subject: "one more", message: "password", locale: "en-GB" }), null);
  assert.equal(h.suggestCalls.length, 10, "Admin is not asked over the limit");
  assert.equal(await h.repository.nthRecentAssistAt(learner.id, since(), 11, ["submit"]), null, "no row is written over the limit");
  assert.ok(h.logs.some((line) => line.event === "rate_limited" && line.limit === "submit_check"));
  assert.ok(await h.assistant.suggestForSubmit(other, { category: "other", subject: "other learner", message: "password", locale: "en-GB" }));
  h.advance(HOUR);
  assert.ok(await h.assistant.suggestForSubmit(learner, { category: "other", subject: "an hour later", message: "password", locale: "en-GB" }));
  // The chat budget is separate.
  assert.ok((await h.assistant.ask(learner, { message: "password", locale: "en-GB", faqId: null }, randomUUID())).response.reply);
});

test("submitting after a suggestion stores 'declined' on the server in the ticket's transaction (first wins) and the server forwards it to Admin", async () => {
  const h = harness();
  const suggestion = await h.assistant.suggestForSubmit(learner, { category: "technical_support", subject: "Password", message: "reset password", locale: "en-GB" });
  assert.ok(suggestion);
  // The browser's own outcome call never arrives (tab closed, network blip).
  const ticket = (await h.service.createTicket(learner, enquiry({ suggestionId: suggestion.id }), randomUUID())).ticket;
  const row = await h.repository.findAssist(suggestion.id);
  assert.equal(row?.feedback, "declined");
  assert.equal(row?.ticketId, ticket.id);
  assert.equal((await h.service.getAgentTicket(ticket.id)).aiAssist[0].feedback, "declined");
  assert.deepEqual(h.outcomes, []);
  assert.equal(await h.assistant.deliverOutcome(suggestion.id), true);
  assert.deepEqual(h.outcomes, [[suggestion.id, "declined"]]);
  assert.equal(await h.assistant.deliverOutcome(suggestion.id), true, "already delivered");
  assert.equal(h.outcomes.length, 1, "Admin is told once");
  // A value the learner set before (e.g. edited) is kept.
  const edited = await h.assistant.suggestForSubmit(learner, { category: "technical_support", subject: "Password 2", message: "reset password", locale: "en-GB" });
  assert.ok(edited);
  await h.assistant.submitOutcome(learner, edited.id, "edited");
  await h.service.createTicket(learner, enquiry({ subject: "Again", suggestionId: edited.id }), randomUUID());
  assert.equal((await h.repository.findAssist(edited.id))?.feedback, "edited");
  // Someone else's suggestion id is neither linked nor marked.
  const foreign = await h.assistant.suggestForSubmit(other, { category: "technical_support", subject: "Theirs", message: "reset password", locale: "en-GB" });
  assert.ok(foreign);
  await h.service.createTicket(learner, enquiry({ subject: "Third", suggestionId: foreign.id }), randomUUID());
  assert.equal((await h.repository.findAssist(foreign.id))?.feedback, null);
});

test("an outcome Admin did not confirm is delivered later: on a repeat and by the sweep once Admin answers again", async () => {
  let up = false;
  const delivered: Array<[string, string]> = [];
  const h = { ...harness({ async reportOutcome(id, outcome) { if (!up) return false; delivered.push([id, outcome]); return true; } }), outcomes: delivered };
  const first = await h.assistant.ask(learner, { message: "reset password", locale: "en-GB", faqId: null }, randomUUID());
  const second = await h.assistant.ask(learner, { message: "password again", locale: "en-GB", faqId: null }, randomUUID());
  const third = await h.assistant.ask(learner, { message: "password once more", locale: "en-GB", faqId: null }, randomUUID());
  await h.assistant.feedback(learner, first.response.id, false);
  await h.assistant.feedback(learner, second.response.id, true);
  assert.equal(h.outcomes.length, 0, "Admin is down");
  assert.equal((await h.repository.findAssist(first.response.id))?.feedbackDeliveredAt, null);
  up = true;
  // A repeat of the same vote (e.g. a retry) delivers the stored value ...
  assert.deepEqual(await h.assistant.feedback(learner, first.response.id, true), { id: first.response.id, feedback: "not_helpful" });
  assert.deepEqual(h.outcomes, [[first.response.id, "not_helpful"], [second.response.id, "helpful"]], "... and the sweep delivers the other pending one");
  assert.ok((await h.repository.findAssist(second.response.id))?.feedbackDeliveredAt);
  await h.assistant.feedback(learner, third.response.id, true);
  assert.deepEqual(h.outcomes.map(([id]) => id), [first.response.id, second.response.id, third.response.id], "nothing is delivered twice");
  assert.equal(await h.assistant.deliverPending(), 0);
});

test("the delivery sweep takes the least recently tried first, so a refused outcome cannot block the others", async () => {
  const refused = new Set<string>();
  const delivered: Array<[string, string]> = [];
  const h = { ...harness({ async reportOutcome(id, outcome) { if (refused.has(id)) return false; delivered.push([id, outcome]); return true; } }), outcomes: delivered };
  const ids: string[] = [];
  for (let index = 0; index < 7; index += 1) {
    const asked = await h.assistant.ask(learner, { message: `password ${index}`, locale: "en-GB", faqId: null }, randomUUID());
    ids.push(asked.response.id);
    refused.add(asked.response.id);
    await h.assistant.feedback(learner, asked.response.id, true);
    h.advance(1000);
  }
  for (const id of ids.slice(5)) refused.delete(id);
  assert.equal(await h.assistant.deliverPending(), 0, "the 5 oldest are refused");
  assert.equal(await h.assistant.deliverPending(), 2, "the next sweep reaches the 2 others");
  assert.deepEqual(h.outcomes.map(([id]) => id), ids.slice(5));
});

test("two requests with the same Idempotency-Key at once ask Admin once and get the same reply", async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const calls: AdminSuggestRequest[] = [];
  const h = { ...harness({ async suggest(input) { calls.push(input); await gate; return { id: randomUUID(), faqId: FAQ_ID, question: "How do I reset my password?", answer: "Open **Sign in**." }; } }), suggestCalls: calls };
  const key = randomUUID();
  const one = h.assistant.ask(learner, { message: "reset password", locale: "en-GB", faqId: null }, key);
  const two = h.assistant.ask(learner, { message: "reset password", locale: "en-GB", faqId: null }, key);
  await new Promise((resolve) => setTimeout(resolve, 20));
  release();
  const [a, b] = await Promise.all([one, two]);
  assert.equal(h.suggestCalls.length, 1);
  assert.deepEqual(a.response, b.response);
  assert.deepEqual([a.replayed, b.replayed].sort(), [false, true]);
  // A different payload under the same key while the first is in flight is still a conflict.
  const key2 = randomUUID();
  const gate2 = h.assistant.ask(learner, { message: "reset password", locale: "en-GB", faqId: null }, key2);
  await rejects(h.assistant.ask(learner, { message: "different", locale: "en-GB", faqId: null }, key2), "idempotency_conflict");
  await gate2;
});

test("what is logged is clipped to the stored limits in code points: answer 4000, FAQ question 200, question 500", async () => {
  const long = "😀".repeat(4100);
  const h = harness({ async suggest() { return { id: randomUUID(), faqId: FAQ_ID, question: "问".repeat(250), answer: long }; } });
  const asked = await h.assistant.ask(learner, { message: "𠀀".repeat(500), locale: "zh-CN", faqId: null }, randomUUID());
  const row = await h.repository.findAssist(asked.response.id);
  assert.equal([...(row?.answer ?? "")].length, 4000);
  assert.equal(row?.answer, "😀".repeat(4000), "never splits a surrogate pair");
  assert.equal([...(row?.faqQuestion ?? "")].length, 200);
  assert.equal([...(row?.question ?? "")].length, 500);
  assert.equal(asked.response.reply?.answer, "😀".repeat(4000), "the reply is what was stored");
  const submit = await h.assistant.suggestForSubmit(learner, { category: "other", subject: "s".repeat(120), message: "m", locale: "en-GB" });
  assert.equal([...((await h.repository.findAssist(submit?.id ?? ""))?.answer ?? "")].length, 4000);
});

test("mark_read for a snapshot is not undone by another agent's tag, flag or internal note; only learner activity keeps the dot", async () => {
  const h = harness();
  const { ticket } = await h.service.createTicket(learner, enquiry(), randomUUID());
  const seen = (await h.service.getAgentTicket(ticket.id)).sequence;
  await h.service.agentAction(ticket.id, { action: "add_tag", agent, tag: "billing", expectedSequence: null }, randomUUID());
  await h.service.agentAction(ticket.id, { action: "flag", agent, expectedSequence: seen + 1 }, randomUUID());
  await h.service.postAgentMessage(ticket.id, { body: "note", internal: true, agent, expectedSequence: seen + 2 }, randomUUID());
  const read = await h.service.agentAction(ticket.id, { action: "mark_read", agent, expectedSequence: seen }, randomUUID());
  assert.equal(read.ticket.sequence, seen + 3);
  assert.equal(read.ticket.unreadByAgent, false, "agent-only events after the snapshot do not keep it unread");
  const now = read.ticket.sequence;
  await h.service.learnerMessage(learner, ticket.id, { body: "Any news?", expectedSequence: now, files: [] }, randomUUID());
  await h.service.agentAction(ticket.id, { action: "add_tag", agent, tag: "second", expectedSequence: null }, randomUUID());
  assert.equal((await h.service.agentAction(ticket.id, { action: "mark_read", agent, expectedSequence: now }, randomUUID())).ticket.unreadByAgent, true, "a learner message after the snapshot keeps it");
});
