// Helpdesk v3 (helpdesk-v3-alternatives-rating.md, 2026-10-29), server side:
// "You might be asking" alternatives carried from Admin to the submit check
// and the chat (Admin picks them in code; Portal only passes them on and
// keeps them with the logged answer so a replay is the same), and the AI
// service rating (one per answer the learner was shown, first wins, 409 for a
// different value) that the BackOffice reads on aiAssist. Storage is the real
// DEV-only local repository; Admin is a stub.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  HELPDESK_LIMITS, HelpdeskProblem, PROBLEM_STATUS, parseAssistantRating, problemBody,
  type AdminSuggestReply, type AdminSuggestRequest, type HelpdeskAlternative
} from "../../contracts/helpdesk";
import { createAssistantService } from "../../modules/helpdesk/assistant";
import { createHelpdeskService } from "../../modules/helpdesk/service";
import { createLocalHelpdeskRepository } from "../../repositories/helpdeskRepository";

let root = "";
before(async () => { root = await mkdtemp(path.join(tmpdir(), "lg-helpdesk-v3-")); });
after(async () => { if (root && path.dirname(root) === tmpdir()) await rm(root, { recursive: true, force: true }); });

const learner = { id: "user-emily", email: "emily.carter@example.com", name: "Emily Carter" };
const other = { id: "user-other", email: "other@example.com", name: "Other Learner" };
const FAQ_ID = "0192d4f0-7b6a-7c3e-9a10-0000000000f1";
const ALTERNATIVES: HelpdeskAlternative[] = [
  { faqId: "0192d4f0-7b6a-7c3e-9a10-0000000000a1", question: "How do I reset my password?" },
  { faqId: "0192d4f0-7b6a-7c3e-9a10-0000000000a2", question: "Where can I find my invoice?" }
];

async function rejects(promise: Promise<unknown>, code: string, field?: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof HelpdeskProblem, String(error));
    assert.equal(error.code, code);
    if (field) assert.equal(error.field, field);
    return true;
  });
}

/** Admin as v4 of the contract: an answer for "password" (or a chip), otherwise no answer and the alternatives. */
function harness(reply?: (input: AdminSuggestRequest) => Promise<AdminSuggestReply>) {
  let clock = Date.parse("2026-10-29T06:00:00.000Z");
  const repository = createLocalHelpdeskRepository(path.join(root, randomUUID()));
  const calls: AdminSuggestRequest[] = [];
  const answer = (input: AdminSuggestRequest) => ({ id: input.runId, faqId: input.faqId ?? FAQ_ID, question: "How do I reset my password?", answer: "Open **Sign in**, then Forgot password." });
  const admin = {
    async suggest(): Promise<null> { throw new Error("v3 asks with suggestReply"); },
    async suggestReply(input: AdminSuggestRequest): Promise<AdminSuggestReply> {
      calls.push(input);
      if (reply) return reply(input);
      if (input.faqId || /password/i.test(`${input.subject ?? ""} ${input.message}`)) return { suggestion: answer(input), alternatives: [] };
      return { suggestion: null, alternatives: ALTERNATIVES };
    },
    async reportOutcome() { return true; }
  };
  const now = () => new Date(clock);
  const service = createHelpdeskService({ repository, blobs: { async put() {}, async get() { return new Uint8Array(); } }, now, log: () => undefined });
  const assistant = createAssistantService({ repository, admin, now, log: () => undefined });
  return { service, assistant, repository, calls, advance(ms: number) { clock += ms; } };
}

const enquiry = { category: "technical_support" as const, subject: "Cannot get in", message: "My account will not open.", locale: "en-GB" as const };

// ---------------------------------------------------------------- contract

test("v3 contract: up to 3 alternatives; a rating is an integer 1..5; a different second rating is 409 answer_already_rated", () => {
  assert.equal(HELPDESK_LIMITS.alternativesMax, 3);
  assert.equal(parseAssistantRating({ rating: 1 }), 1);
  assert.equal(parseAssistantRating({ rating: 5 }), 5);
  for (const rating of [0, 6, 2.5, "4", null, undefined, true]) {
    assert.throws(() => parseAssistantRating({ rating }), (error: unknown) => error instanceof HelpdeskProblem && error.code === "validation_failed" && error.field === "rating", String(rating));
  }
  assert.throws(() => parseAssistantRating([]), (error: unknown) => error instanceof HelpdeskProblem && error.code === "invalid_request");
  assert.equal(PROBLEM_STATUS.answer_already_rated, 409);
  const body = problemBody(new HelpdeskProblem("answer_already_rated", "This answer was already rated.", { rating: 4 }));
  assert.equal(body.type, "https://www.ilovelearningguide.com/problems/answer_already_rated");
  assert.equal(body.status, 409);
  assert.equal((body as Record<string, unknown>).rating, 4, "the stored rating is in the problem");
});

// ---------------------------------------------------------------- alternatives

test("submit check: no answer comes back with Admin's alternatives; an answer comes back with none; suggestForSubmit keeps its v2 meaning", async () => {
  const h = harness();
  const none = await h.assistant.checkForSubmit(learner, enquiry);
  assert.deepEqual(none, { suggestion: null, alternatives: ALTERNATIVES });
  assert.deepEqual(h.calls[0], { learnerId: learner.id, locale: "en-GB", source: "submit", category: "technical_support", subject: "Cannot get in", message: "My account will not open.", runId: h.calls[0].runId, parentRunId: null }, "Portal asks exactly as in v2");
  const row = await h.repository.findAssist(h.calls[0].runId);
  assert.equal(row?.answer, null);
  assert.deepEqual(row?.alternatives, ALTERNATIVES, "what was offered is kept with the logged check");
  const answered = await h.assistant.checkForSubmit(learner, { ...enquiry, subject: "Password" });
  assert.ok(answered.suggestion);
  assert.deepEqual(answered.alternatives, []);
  assert.equal(await h.assistant.suggestForSubmit(learner, enquiry), null);
});

test("submit check: over the hourly budget, an Admin failure or the timeout give no answer and no alternatives (the page submits directly)", async () => {
  const h = harness();
  for (let index = 0; index < HELPDESK_LIMITS.submitChecksPerHour; index += 1) await h.assistant.checkForSubmit(learner, enquiry);
  assert.deepEqual(await h.assistant.checkForSubmit(learner, enquiry), { suggestion: null, alternatives: [] }, "rate limited: []");
  assert.equal(h.calls.length, HELPDESK_LIMITS.submitChecksPerHour, "Admin is not asked over the limit");
  const down = harness(async () => { throw new Error("down"); });
  assert.deepEqual(await down.assistant.checkForSubmit(learner, enquiry), { suggestion: null, alternatives: [] });
  const slow = harness();
  const timed = createAssistantService({ repository: slow.repository, admin: { suggest: async () => null, suggestReply: () => new Promise<AdminSuggestReply>(() => undefined), reportOutcome: async () => true }, timeoutMs: 30, log: () => undefined });
  assert.deepEqual(await timed.checkForSubmit(learner, enquiry), { suggestion: null, alternatives: [] });
});

test("alternatives are passed on defensively: at most 3, once each, never the FAQ just shown, never next to an answer", async () => {
  const malformed = [{ faqId: 42, question: "x" }, null, { faqId: "0192d4f0-7b6a-7c3e-9a10-0000000000a9", question: "" }] as unknown as HelpdeskAlternative[];
  const many = [...ALTERNATIVES, ...malformed, ALTERNATIVES[0], { faqId: "0192d4f0-7b6a-7c3e-9a10-0000000000a3", question: "Third" }, { faqId: "0192d4f0-7b6a-7c3e-9a10-0000000000a4", question: "Fourth" }];
  const h = harness(async (input) => ({ suggestion: null, alternatives: input.faqId ? [{ faqId: input.faqId, question: "The chip itself" }, ...many] : many }));
  assert.deepEqual((await h.assistant.checkForSubmit(learner, enquiry)).alternatives.map((item) => item.question), ["How do I reset my password?", "Where can I find my invoice?", "Third"]);
  const chip = await h.assistant.ask(learner, { message: "Unpublished", locale: "en-GB", faqId: FAQ_ID }, randomUUID());
  assert.equal(chip.response.reply, null);
  assert.ok(!chip.response.alternatives.some((item) => item.faqId === FAQ_ID), "the chip the learner just tried is not offered again");
  const both = harness(async (input) => ({ suggestion: { id: input.runId, faqId: FAQ_ID, question: "Q", answer: "A" }, alternatives: ALTERNATIVES }));
  assert.deepEqual((await both.assistant.checkForSubmit(learner, enquiry)).alternatives, []);
});

test("chat: the fallback reply carries the alternatives; an answer carries none; a replay returns exactly what was shown", async () => {
  const h = harness();
  const key = randomUUID();
  const fallback = await h.assistant.ask(learner, { message: "My account will not open", locale: "en-GB", faqId: null }, key);
  assert.equal(fallback.response.reply, null);
  assert.deepEqual(fallback.response.alternatives, ALTERNATIVES);
  const replayed = await h.assistant.ask(learner, { message: "My account will not open", locale: "en-GB", faqId: null }, key);
  assert.equal(replayed.replayed, true);
  assert.deepEqual(replayed.response, fallback.response, "same body, alternatives included");
  assert.equal(h.calls.length, 1);
  const answered = await h.assistant.ask(learner, { message: "password", locale: "en-GB", faqId: null }, randomUUID());
  assert.ok(answered.response.reply);
  assert.deepEqual(answered.response.alternatives, []);
  const chip = await h.assistant.ask(learner, { message: ALTERNATIVES[1].question, locale: "en-GB", faqId: ALTERNATIVES[1].faqId }, randomUUID());
  assert.equal(chip.response.reply?.faqId, ALTERNATIVES[1].faqId, "an alternative is asked like a starter chip");
  assert.equal(h.calls.at(-1)?.source, "chip");
});

test("Admin is told which FAQs this conversation already showed (shownFaqIds), so its alternatives never repeat one; Portal drops any it still sends", async () => {
  const h = harness();
  const fresh = await h.assistant.checkForSubmit(learner, enquiry);
  assert.equal("shownFaqIds" in h.calls[0], false, "nothing shown yet: the request is as in v2");
  assert.equal(fresh.suggestion, null);
  // The learner reads two answers in this conversation (a chip, then the submit suggestion), and one answer with no match.
  const chip = (await h.assistant.ask(learner, { message: ALTERNATIVES[1].question, locale: "en-GB", faqId: ALTERNATIVES[1].faqId }, randomUUID())).response;
  h.advance(1_000);
  await h.assistant.checkForSubmit(learner, { ...enquiry, subject: "Password" });
  h.advance(1_000);
  await h.assistant.ask(learner, { message: "Something odd", locale: "en-GB", faqId: null }, randomUUID());
  // Another learner's answers never count.
  await h.assistant.ask(other, { message: ALTERNATIVES[0].question, locale: "en-GB", faqId: ALTERNATIVES[0].faqId }, randomUUID());
  h.advance(1_000);
  const next = await h.assistant.ask(learner, { message: "Still locked out", locale: "en-GB", faqId: null }, randomUUID());
  assert.deepEqual(h.calls.at(-1)?.shownFaqIds, [FAQ_ID, ALTERNATIVES[1].faqId], "newest first, each once, answered rows only");
  assert.deepEqual(next.response.alternatives.map((item) => item.faqId), [ALTERNATIVES[0].faqId], "Portal also drops a shown FAQ Admin still offers");
  // Once those answers are linked to a ticket the conversation starts afresh.
  await h.service.createTicket(learner, { category: "technical_support", subject: "Still stuck", body: "Neither helped.", locale: "en-GB", contactEmail: null, suggestionId: null, assistIds: [chip.id, h.calls[2].runId], files: [] }, randomUUID());
  await h.assistant.ask(learner, { message: "A new question", locale: "en-GB", faqId: null }, randomUUID());
  assert.equal("shownFaqIds" in h.calls.at(-1)!, false, "a linked conversation is over");
});

test("shownFaqIds: at most 20 (Admin refuses more), and a failing lookup never stops the question", async () => {
  const h = harness(async (input) => ({ suggestion: { id: input.runId, faqId: input.faqId ?? FAQ_ID, question: "Q", answer: "A" }, alternatives: [] }));
  for (let index = 0; index < 23; index += 1) {
    await h.assistant.ask(learner, { message: `chip ${index}`, locale: "en-GB", faqId: `0192d4f0-7b6a-7c3e-9a10-0000000002${String(index).padStart(2, "0")}` }, randomUUID());
    h.advance(1_000);
  }
  assert.equal(h.calls.at(-1)?.shownFaqIds?.length, 20);
  assert.equal(h.calls.at(-1)?.shownFaqIds?.[0], "0192d4f0-7b6a-7c3e-9a10-000000000221", "the newest first");
  const broken = createAssistantService({ repository: { ...h.repository, conversationShownFaqIds: async () => { throw new Error("db down"); } }, admin: { suggest: async () => null, suggestReply: async () => ({ suggestion: null, alternatives: ALTERNATIVES }), reportOutcome: async () => true }, log: () => undefined });
  assert.deepEqual((await broken.ask(other, { message: "x", locale: "en-GB", faqId: null }, randomUUID())).response.alternatives, ALTERNATIVES);
});

test("an older Admin client without suggestReply still works: the answer, and no alternatives", async () => {
  const repository = createLocalHelpdeskRepository(path.join(root, randomUUID()));
  const assistant = createAssistantService({ repository, admin: { suggest: async () => null, reportOutcome: async () => true }, log: () => undefined });
  assert.deepEqual(await assistant.checkForSubmit(learner, enquiry), { suggestion: null, alternatives: [] });
  assert.deepEqual((await assistant.ask(learner, { message: "x", locale: "en-GB", faqId: null }, randomUUID())).response.alternatives, []);
});

// ---------------------------------------------------------------- rating

test("rating: the learner's own answered runs only (submit suggestion or a chosen alternative); first wins; same value is a no-op; a different value is 409", async () => {
  const h = harness();
  const suggestion = (await h.assistant.checkForSubmit(learner, { ...enquiry, subject: "Password" })).suggestion!;
  await rejects(h.assistant.rate(other, suggestion.id, 4), "not_found");
  await rejects(h.assistant.rate(learner, randomUUID(), 4), "not_found");
  assert.deepEqual(await h.assistant.rate(learner, suggestion.id, 4), { id: suggestion.id, rating: 4 });
  assert.deepEqual(await h.assistant.rate(learner, suggestion.id, 4), { id: suggestion.id, rating: 4 }, "a repeat with the same value is fine");
  await assert.rejects(h.assistant.rate(learner, suggestion.id, 2), (error: unknown) => {
    assert.ok(error instanceof HelpdeskProblem);
    assert.equal(error.code, "answer_already_rated");
    assert.equal(error.status, 409);
    assert.equal(error.extra.rating, 4);
    return true;
  });
  assert.equal(await h.repository.findAiRating(suggestion.id), 4, "the first rating is kept");
  const chip = (await h.assistant.ask(learner, { message: ALTERNATIVES[0].question, locale: "en-GB", faqId: ALTERNATIVES[0].faqId }, randomUUID())).response;
  assert.deepEqual(await h.assistant.rate(learner, chip.id, 5), { id: chip.id, rating: 5 });
  const noAnswer = await h.assistant.checkForSubmit(learner, enquiry);
  assert.equal(noAnswer.suggestion, null);
  await rejects(h.assistant.rate(learner, h.calls.at(-1)!.runId, 3), "not_found", undefined);
});

test("rating: two ratings at once keep one; the BackOffice sees it on aiAssist (null when the learner skipped)", async () => {
  const h = harness();
  const rated = (await h.assistant.ask(learner, { message: ALTERNATIVES[0].question, locale: "en-GB", faqId: ALTERNATIVES[0].faqId }, randomUUID())).response;
  const skipped = (await h.assistant.ask(learner, { message: "password", locale: "en-GB", faqId: null }, randomUUID())).response;
  const results = await Promise.allSettled([h.assistant.rate(learner, rated.id, 5), h.assistant.rate(learner, rated.id, 1)]);
  const kept = await h.repository.findAiRating(rated.id);
  assert.ok(kept === 5 || kept === 1);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1, "the other one is refused");
  const ticket = (await h.service.createTicket(learner, { category: "technical_support", subject: "Still stuck", body: "Neither helped.", locale: "en-GB", contactEmail: null, suggestionId: null, assistIds: [rated.id, skipped.id], files: [] }, randomUUID())).ticket;
  const detail = await h.service.getAgentTicket(ticket.id);
  assert.deepEqual(detail.aiAssist.map((item) => [item.id, item.rating]), [[rated.id, kept], [skipped.id, null]]);
});
