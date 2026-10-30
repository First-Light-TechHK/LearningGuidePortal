// Helpdesk v5, Portal server side (helpdesk-v5-context-chips-and-smalltalk.md
// Parts A, B, D, G1, H; helpdesk-v5-faq-graph-design.md §3, §4): chat sessions
// with situation chips, the context sent with a typed question, Admin's turn
// kinds as the chat gets them (with Portal's own check of the short strings),
// clicks checked against the cached release (no model, no Admin), and every
// turn logged on the assist log with its session, path and enum names.
// Storage is the real DEV-only local repository; Admin and the release are fakes.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  HelpdeskProblem, parseAssistantClick, parseAssistantSessionInput, parseAssistantTurnInput, parseChatEndReason, parseFaqRelease, parseSuggestTurn,
  type AdminSuggestReply, type AdminSuggestRequest, type AssistantStep, type AssistantTurnResponse, type FaqRelease, type HelpFaq
} from "../../contracts/helpdesk";
import { createAssistantService, LEARNER_STATE_WAIT_MS, type AssistantDeps, type LearnerRecords } from "../../modules/helpdesk/assistant";
import { TURN_TEMPLATES } from "../../modules/helpdesk/assistantTurn";
import { CHAT_SESSION_RULES } from "../../modules/helpdesk/chatSession";
import { createHelpdeskService } from "../../modules/helpdesk/service";
import { createLocalHelpdeskRepository } from "../../repositories/helpdeskRepository";

let root = "";
before(async () => { root = await mkdtemp(path.join(tmpdir(), "lg-helpdesk-v5-")); });
after(async () => { if (root && path.dirname(root) === tmpdir()) await rm(root, { recursive: true, force: true }); });

const fixture = JSON.parse(readFileSync("tests/fixtures/helpdesk-contract.json", "utf8")) as { portalToAdmin: Record<string, Record<string, unknown>> };
const RELEASE = parseFaqRelease(fixture.portalToAdmin.faqReleaseResponse) as FaqRelease;
const example = (name: string) => fixture.portalToAdmin[name] as Record<string, unknown>;
const id = (n: number) => `01a18100-0000-7000-8000-${String(n).padStart(12, "0")}`;
const CHOICE = id(20), FAILED = id(21), PAID = id(22), TWICE = id(23), CONTACT = id(24);
const learner = { id: "user-emily", email: "emily.carter@example.com", name: "Emily Carter" };
const other = { id: "user-other", email: "other@example.com", name: "Other Learner" };

/** Admin as contract v6 reads it: the fixture answer whose name the test sets, with the run id Portal sent. */
function reply(name: string, input: AdminSuggestRequest): AdminSuggestReply {
  const body = structuredClone(example(name));
  const suggestion = body.suggestion as Record<string, unknown> | null;
  if (suggestion) suggestion.id = input.runId;
  const turn = parseSuggestTurn(body);
  return { suggestion: suggestion as AdminSuggestReply["suggestion"], alternatives: (body.alternatives as AdminSuggestReply["alternatives"]) ?? [], ...(turn ? { turn } : {}) };
}

const PUBLISHED: HelpFaq[] = [
  { id: id(41), category: "payments_subscriptions", popular: true, question: "How do I change my plan?", answer: "Open **My Subscription**.", signals: [], updatedAt: "" },
  { id: id(42), category: "payments_subscriptions", popular: false, question: "Why did my payment fail?", answer: "Check your card.", signals: ["payment_failed"], updatedAt: "" },
  { id: id(43), category: "account_technical", popular: true, question: "How do I reset my password?", answer: "Use Forgot password.", signals: [], updatedAt: "" }
];

function harness(options: { answer?: (input: AdminSuggestRequest, streaming?: { onStep?: (step: AssistantStep) => void }) => AdminSuggestReply | Promise<AdminSuggestReply>; release?: FaqRelease | null; records?: LearnerRecords; ownsOrder?: boolean; stateSources?: AssistantDeps["learnerStateSources"] } = {}) {
  let clock = Date.parse("2026-10-30T09:00:00.000Z");
  const repository = createLocalHelpdeskRepository(path.join(root, randomUUID()));
  const calls: AdminSuggestRequest[] = [];
  const outcomes: string[] = [];
  const logs: Array<Record<string, unknown>> = [];
  let release: FaqRelease | null = options.release === undefined ? RELEASE : options.release;
  const admin = {
    async suggest(): Promise<null> { throw new Error("v5 asks with suggestReply"); },
    async suggestReply(input: AdminSuggestRequest, streaming?: { onStep?: (step: AssistantStep) => void }) {
      calls.push(structuredClone(input));
      if (options.answer) return options.answer(input, streaming);
      if (input.faqId) return { suggestion: { id: input.runId, faqId: input.faqId, question: "Chip question", answer: "Chip answer." }, alternatives: [] };
      return reply("suggestAnswerContextResponse", input);
    },
    async reportOutcome(runId: string) { outcomes.push(runId); return true; },
    async faqs() { return PUBLISHED; },
    async faq(faqId: string) { return PUBLISHED.find((faq) => faq.id === faqId) ?? null; }
  };
  const now = () => new Date(clock);
  const assistant = createAssistantService({
    repository, admin, now, log: (line) => logs.push(line), traceId: "0af7651916cd43dd8448eb211c80319c",
    release: { async current(locale) { return release && release.locale === locale ? release : null; } },
    learnerRecords: async () => options.records ?? { user: { email: learner.email, emailVerifiedAt: "2026-01-01T00:00:00.000Z" }, orders: [], subscriptions: [] },
    ownsOrder: async () => options.ownsOrder ?? false,
    ...(options.stateSources ? { learnerStateSources: options.stateSources } : {})
  });
  const service = createHelpdeskService({ repository, blobs: { async put() {}, async get() { return new Uint8Array(); } }, now, log: () => undefined });
  return { assistant, service, repository, calls, outcomes, logs, advance(ms: number) { clock += ms; }, setRelease(next: FaqRelease | null) { release = next; } };
}

const typed = (message: string, sessionId: string | null = null) => ({ message, locale: "en-GB" as const, faqId: null, sessionId });
const turnOf = (response: unknown) => (response as AssistantTurnResponse).turn;

async function rejects(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error: unknown) => error instanceof HelpdeskProblem && error.code === code);
}

// ---------------------------------------------------------------- inputs

test("v5 inputs: sessionId and via on the chat question, the click body, the session start and the end reason", () => {
  assert.deepEqual(parseAssistantTurnInput({ message: " Hi ", locale: "en-GB" }), { message: "Hi", locale: "en-GB", faqId: null, sessionId: null, via: null });
  assert.equal(parseAssistantTurnInput({ message: "Hi", locale: "en-GB", sessionId: id(30).toUpperCase() }).sessionId, id(30));
  assert.equal(parseAssistantTurnInput({ message: "Chip", locale: "en-GB", faqId: id(41), via: "signal" }).via, "signal");
  assert.throws(() => parseAssistantTurnInput({ message: "Hi", locale: "en-GB", via: "signal" }), (error: unknown) => error instanceof HelpdeskProblem && error.field === "via", "via only with a chip");
  assert.throws(() => parseAssistantTurnInput({ message: "Hi", locale: "en-GB", sessionId: "nope" }), (error: unknown) => error instanceof HelpdeskProblem && error.field === "sessionId");
  assert.deepEqual(parseAssistantClick({ locale: "zh-CN", nodeId: id(21), fromNodeId: id(20), via: "option" }), { locale: "zh-CN", nodeId: id(21), fromNodeId: id(20), via: "option", sessionId: null, label: null });
  assert.throws(() => parseAssistantClick({ locale: "en-GB", nodeId: id(21), via: "follow_up" }), (error: unknown) => error instanceof HelpdeskProblem && error.field === "fromNodeId");
  assert.throws(() => parseAssistantClick({ locale: "en-GB", nodeId: id(21), via: "typed" }), (error: unknown) => error instanceof HelpdeskProblem && error.field === "via", "typing is not a click");
  assert.throws(() => parseAssistantClick({ locale: "en-GB", nodeId: "x", via: "starter" }), (error: unknown) => error instanceof HelpdeskProblem && error.field === "nodeId");
  assert.equal(parseAssistantClick({ locale: "en-GB", nodeId: id(21), via: "starter", label: " Chip " }).label, "Chip");
  assert.deepEqual(parseAssistantSessionInput({ locale: "en-GB", orderId: "order_1_ab" }), { locale: "en-GB", orderId: "order_1_ab" });
  assert.deepEqual(parseAssistantSessionInput({ locale: "zh-CN" }), { locale: "zh-CN", orderId: null });
  assert.equal(parseChatEndReason({ reason: "ended_by_learner" }), "ended_by_learner");
  assert.throws(() => parseChatEndReason({ reason: "ticket" }), (error: unknown) => error instanceof HelpdeskProblem, "ticket is Portal's own end");
});

// ---------------------------------------------------------------- sessions and chips

test("v5 session: chips from the learner's own records (payment chip first), the release's entry nodes, the signals kept on the session and never sent anywhere", async () => {
  const h = harness({ records: { user: { email: learner.email, emailVerifiedAt: "2026-01-01T00:00:00.000Z" }, orders: [{ userId: learner.id, status: "failed", createdAt: "2026-10-30T08:00:00.000Z" }], subscriptions: [] } });
  const started = await h.assistant.startSession(learner, { locale: "en-GB", orderId: null });
  assert.deepEqual(started.chips.map((chip) => [chip.id, chip.reason]), [[FAILED, "signal"], [CHOICE, "popular"]], "payment_failed's entry node first, then the popular entry node; the non-entry node never");
  assert.equal(started.situational, true);
  assert.equal(started.waitingTicket, null);
  assert.equal(started.releaseVersion, 3);
  assert.doesNotMatch(JSON.stringify(started), /payment_failed|signal"?:\s*\[/, "the signal names are not returned");
  const session = await h.repository.findChatSession(started.sessionId);
  assert.deepEqual(session?.signals, ["payment_failed"]);
  assert.equal(session?.learnerId, learner.id);
  assert.ok(h.logs.some((line) => line.event === "assistant_session_started" && JSON.stringify(line.chipSignals) === "[\"payment_failed\"]"));
  const asked = await h.assistant.ask(learner, typed("hi", started.sessionId), randomUUID());
  assert.equal(turnOf(asked.response).sessionId, started.sessionId);
  assert.doesNotMatch(JSON.stringify(h.calls), /payment_failed|failed|order/i, "Admin never receives the signals or order data");
  assert.deepEqual((await h.repository.findAssist(asked.response.id))?.signals, ["payment_failed"], "the turn logs the session's signals");
});

test("v5 session: before a release, the chips come from the published FAQs; from_order needs the learner's own order; a waiting enquiry is the fixed card", async () => {
  const h = harness({ release: null, ownsOrder: true });
  const agent = { id: "agent-1", name: "Alex Support" };
  const { ticket } = await h.service.createTicket(learner, { category: "technical_support", subject: "Login", body: "Cannot log in.", locale: "en-GB", files: [] }, randomUUID());
  await h.service.agentAction(ticket.id, { action: "claim", agent, expectedSequence: 1 }, randomUUID());
  const replied = await h.service.postAgentMessage(ticket.id, { body: "Which browser do you use?", internal: false, agent, expectedSequence: 2 }, randomUUID());
  assert.equal(replied.ticket.status, "WAITING_USER");
  const started = await h.assistant.startSession(learner, { locale: "en-GB", orderId: "order_1_ab" });
  assert.deepEqual(started.chips.map((chip) => [chip.question, chip.reason]), [["How do I change my plan?", "popular"], ["How do I reset my password?", "popular"]]);
  assert.equal(started.situational, false);
  assert.equal(started.releaseVersion, null);
  assert.deepEqual((await h.repository.findChatSession(started.sessionId))?.signals, ["open_ticket_waiting", "from_order"]);
  assert.deepEqual(started.waitingTicket, { id: ticket.id, number: ticket.number }, "the fixed card links the enquiry (no dates, no amounts)");
  const notMine = harness({ release: null, ownsOrder: false });
  const plain = await notMine.assistant.startSession(learner, { locale: "en-GB", orderId: "order_1_ab" });
  assert.deepEqual((await notMine.repository.findChatSession(plain.sessionId))?.signals, [], "someone else's order: no from_order");
});

test("v5 session: starting again while the learner's last session is still empty and open reuses it (no new row per call); a used, ended, idle or changed one is not reused", async () => {
  const h = harness();
  const first = await h.assistant.startSession(learner, { locale: "en-GB", orderId: null });
  for (let i = 0; i < 5; i += 1) assert.equal((await h.assistant.startSession(learner, { locale: "en-GB", orderId: null })).sessionId, first.sessionId, "a reload or a repeated call");
  const otherLocale = await h.assistant.startSession(learner, { locale: "zh-CN", orderId: null });
  assert.notEqual(otherLocale.sessionId, first.sessionId, "another locale is its own session");
  const someoneElse = await h.assistant.startSession(other, { locale: "en-GB", orderId: null });
  assert.notEqual(someoneElse.sessionId, first.sessionId);
  await h.assistant.ask(learner, typed("hi", first.sessionId), randomUUID());
  const afterTurn = await h.assistant.startSession(learner, { locale: "en-GB", orderId: null });
  assert.notEqual(afterTurn.sessionId, first.sessionId, "a session with turns is not handed out again");
  await h.assistant.endSession(learner, afterTurn.sessionId, "ended_by_learner");
  const afterEnd = await h.assistant.startSession(learner, { locale: "en-GB", orderId: null });
  assert.notEqual(afterEnd.sessionId, afterTurn.sessionId, "an ended session is never reused");
  h.advance(CHAT_SESSION_RULES.idleMs);
  const afterIdle = await h.assistant.startSession(learner, { locale: "en-GB", orderId: null });
  assert.notEqual(afterIdle.sessionId, afterEnd.sessionId, "an idle one is not reused");
  h.setRelease({ ...RELEASE, version: 4 });
  const newRelease = await h.assistant.startSession(learner, { locale: "en-GB", orderId: null });
  assert.notEqual(newRelease.sessionId, afterIdle.sessionId, "a new release starts a new session");
  assert.equal(newRelease.releaseVersion, 4);
  const withOrder = harness({ ownsOrder: true });
  const plain = await withOrder.assistant.startSession(learner, { locale: "en-GB", orderId: null });
  const fromOrder = await withOrder.assistant.startSession(learner, { locale: "en-GB", orderId: "order_1_ab" });
  assert.notEqual(fromOrder.sessionId, plain.sessionId, "other signals: a new session keeps them");
});

test("v5 session: another learner's, an ended or an idle session is never continued; End chat is first-wins and 404 for someone else", async () => {
  const h = harness();
  const { sessionId } = await h.assistant.startSession(learner, { locale: "en-GB", orderId: null });
  const first = turnOf((await h.assistant.ask(learner, typed("hi", sessionId), randomUUID())).response);
  assert.equal(first.sessionId, sessionId);
  assert.equal(first.turnIndex, 1);
  const stranger = turnOf((await h.assistant.ask(other, typed("hi", sessionId), randomUUID())).response);
  assert.notEqual(stranger.sessionId, sessionId, "someone else's session id starts a new one");
  h.advance(CHAT_SESSION_RULES.idleMs);
  const late = turnOf((await h.assistant.ask(learner, typed("hi again", sessionId), randomUUID())).response);
  assert.notEqual(late.sessionId, sessionId, "10 minutes without a turn: a new session");
  assert.equal(late.turnIndex, 1);
  const idle = await h.repository.findChatSession(sessionId);
  assert.equal(idle?.endReason, "idle");
  assert.equal(idle?.endedAt, new Date(Date.parse(idle!.lastTurnAt) + CHAT_SESSION_RULES.idleMs).toISOString(), "ended when it went idle");
  await rejects(h.assistant.endSession(other, late.sessionId, "ended_by_learner"), "not_found");
  assert.equal((await h.assistant.endSession(learner, late.sessionId, "ended_by_learner")).endReason, "ended_by_learner");
  assert.equal((await h.assistant.endSession(learner, late.sessionId, "handover")).endReason, "ended_by_learner", "the first end wins");
  assert.notEqual(turnOf((await h.assistant.ask(learner, typed("more", late.sessionId), randomUUID())).response).sessionId, late.sessionId, "an ended session is not continued");
});

// ---------------------------------------------------------------- typed questions

test("v5 typed: context is the card on screen, the session and the learner's own last 3 turns (from Portal's log); never account data", async () => {
  const h = harness();
  const { sessionId } = await h.assistant.startSession(learner, { locale: "en-GB", orderId: null });
  await h.assistant.ask(learner, typed("I paid but my plan is not active", sessionId), randomUUID());
  assert.deepEqual(h.calls[0].context, { sessionId }, "the first question: no card yet, no earlier turns");
  for (const message of ["second", "third", "fourth"]) await h.assistant.ask(learner, typed(message, sessionId), randomUUID());
  assert.deepEqual(h.calls[3].context, { nodeId: PAID, sessionId, recentTurns: ["I paid but my plan is not active", "second", "third"] });
  await h.assistant.click(learner, { locale: "en-GB", nodeId: CONTACT, fromNodeId: PAID, via: "follow_up", sessionId, label: null }, randomUUID());
  await h.assistant.ask(learner, typed("fifth", sessionId), randomUUID());
  assert.deepEqual(h.calls[4].context, { nodeId: CONTACT, sessionId, recentTurns: ["second", "third", "fourth"] }, "clicks move the card on screen but are not learner words");
  assert.equal(h.calls.length, 5, "the click asked nobody");
  for (const call of h.calls) assert.deepEqual(Object.keys(call.context ?? {}).filter((key) => !["nodeId", "sessionId", "recentTurns"].includes(key)), []);
});

test("v7 typed: the context carries the learner state worked out from Portal's records (and the learner's enquiries); a chip never; a failing or slow source means none", async () => {
  const records = {
    user: { createdAt: "2026-09-30T09:00:00.000Z", email: learner.email, emailVerifiedAt: "2026-09-30T10:00:00.000Z" },
    subscriptions: [{ userId: learner.id, state: "active" as const, source: "trial" as const, validTo: "2026-11-01T21:00:00.000Z", scope: "course" as const, device: "pc" as const }],
    entitlements: [{ userId: learner.id, courseId: "course_1", state: "active" as const, validTo: "2026-11-01T21:00:00.000Z", scope: "course" as const, scopeId: "course_1" }],
    courses: [{ id: "course_1", title: "Physics", status: "published" as const }],
    studyRecords: [{ userId: learner.id, courseId: "course_1", progress: 40, totalSeconds: 1_800, updatedAt: "2026-10-29T09:00:00.000Z", completedAt: null }],
    orders: [], studyGroups: { groups: [], memberships: [], sessions: [] }
  };
  const h = harness({ stateSources: async () => records });
  const { sessionId } = await h.assistant.startSession(learner, { locale: "en-GB", orderId: null });
  await h.assistant.ask(learner, typed("is my trial still on?", sessionId), randomUUID());
  assert.deepEqual(h.calls[0].context, {
    sessionId,
    learnerState: {
      accountAgeDays: 30, emailVerified: true,
      plans: [{ source: "trial", state: "active", scope: "course", device: "pc", endsInDays: 2 }],
      courses: [{ courseId: "course_1", title: "Physics", status: "in_progress", progress: 40, minutes: 30, lastStudiedDaysAgo: 1, hasAccess: true }],
      notStartedWithAccess: 0, studyGroups: { groups: 0, hosting: 0, upcomingSessions: 0, nextSessionInHours: null }, latestOrder: null, tickets: { open: 0, waitingOnUser: 0 }
    }
  });
  assert.doesNotMatch(JSON.stringify(h.calls[0].context), /emily|example\.com|user-emily|2026-/i, "no name, email, learner id or date");
  await h.assistant.ask(learner, { ...typed("", sessionId), message: "Chip question", faqId: PAID }, randomUUID());
  assert.equal(h.calls[1].context?.learnerState, undefined, "a chip asks Admin's per-FAQ path: no state");

  const failing = harness({ stateSources: async () => { throw new Error("store down"); } });
  const first = await failing.assistant.startSession(learner, { locale: "en-GB", orderId: null });
  const answered = await failing.assistant.ask(learner, typed("hello", first.sessionId), randomUUID());
  assert.equal(failing.calls[0].context?.learnerState, undefined);
  assert.ok(turnOf(answered.response), "the question is still answered");

  const slow = harness({ stateSources: () => new Promise(() => undefined) });
  const second = await slow.assistant.startSession(learner, { locale: "en-GB", orderId: null });
  const started = Date.now();
  await slow.assistant.ask(learner, typed("hello", second.sessionId), randomUUID());
  assert.equal(slow.calls[0].context?.learnerState, undefined);
  assert.ok(Date.now() - started < LEARNER_STATE_WAIT_MS + 1_000, "never waits long for the state");
});

test("v5 typed answer: the card verbatim, Admin's guarded opening and closing, the excerpt from the release, the follow-ups; logged with its path", async () => {
  const h = harness();
  const { sessionId } = await h.assistant.startSession(learner, { locale: "en-GB", orderId: null });
  const key = randomUUID();
  const { response } = await h.assistant.ask(learner, typed("I paid but my plan is not active", sessionId), key);
  const turn = turnOf(response);
  assert.equal(response.reply?.faqId, PAID);
  assert.equal(response.reply?.answer, RELEASE.nodes.find((node) => node.id === PAID)?.answer, "verbatim");
  assert.deepEqual(response.alternatives, []);
  assert.equal(turn.kind, "answer");
  assert.equal(turn.intent, "question");
  assert.equal(turn.via, "typed");
  assert.equal(turn.nodeType, "answer");
  assert.equal(turn.opening, "Don't worry, this is usually quick to sort out:");
  assert.equal(turn.closing, "Try these first, and tell me if it is still not active.");
  assert.deepEqual(turn.excerpt?.map((block) => block.id), ["b2", "b3"]);
  assert.equal(turn.excerpt?.[0].text, "1. Reload **My Learning**\n2. Sign out and sign in again");
  assert.deepEqual(turn.next, { kind: "follow_up", steps: [{ nodeId: CONTACT, label: "How do I contact support?" }] });
  assert.equal(turn.releaseVersion, 3);
  assert.equal(turn.unsolved, false);
  assert.equal(turn.countsAsQuestion, true);
  const row = await h.repository.findAssist(response.id);
  assert.equal(row?.sessionId, sessionId);
  assert.equal(row?.turnIndex, 1);
  assert.equal(row?.nodeId, PAID);
  assert.equal(row?.parentNodeId, null);
  assert.equal(row?.via, "typed");
  assert.equal(row?.kind, "answer");
  assert.equal(row?.intent, "question");
  assert.equal(row?.guard, "passed");
  assert.equal(row?.releaseVersion, 3);
  assert.equal(row?.traceId, "0af7651916cd43dd8448eb211c80319c");
  assert.deepEqual(row?.blocks, ["b2", "b3"]);
  const session = await h.repository.findChatSession(sessionId);
  assert.equal(session?.currentNodeId, PAID);
  assert.equal(session?.turns, 1);
  const again = await h.assistant.ask(learner, typed("I paid but my plan is not active", sessionId), key);
  assert.equal(again.replayed, true);
  assert.deepEqual(again.response, response, "an Idempotency-Key replay shows the same turn");
  await rejects(h.assistant.ask(learner, typed("something else", sessionId), key), "idempotency_conflict");
});

test("v5 typed answer: Portal refuses a bad opening (defence in depth) and uses its template; a choice node has no frame and offers its options", async () => {
  const bad = harness({ answer: (input) => {
    const answer = reply("suggestAnswerContextResponse", input);
    return { ...answer, turn: { ...answer.turn!, opening: "Visit https://evil.example now", closing: "It takes 3 days." } };
  } });
  const { response } = await bad.assistant.ask(learner, typed("paid"), randomUUID());
  assert.equal(turnOf(response).opening, TURN_TEMPLATES["en-GB"].opening);
  assert.equal(turnOf(response).closing, TURN_TEMPLATES["en-GB"].closing);
  assert.equal((await bad.repository.findAssist(response.id))?.guard, "link", "the guard column says Portal refused it");
  assert.ok(bad.logs.some((line) => line.event === "assistant_portal_guard" && line.field === "opening" && line.reason === "link"));
  assert.doesNotMatch(JSON.stringify(bad.logs), /evil\.example/, "the refused text is never logged");
  const choice = harness({ answer: (input) => reply("suggestChoiceResponse", input) });
  const shown = await choice.assistant.ask(learner, typed("payment problem"), randomUUID());
  const turn = turnOf(shown.response);
  assert.equal(turn.nodeType, "choice");
  assert.equal(turn.opening, null);
  assert.equal(turn.closing, null);
  assert.equal(turn.excerpt, null);
  assert.deepEqual(turn.next?.kind, "option");
  assert.deepEqual(turn.next?.steps.map((step) => step.label), ["My payment failed", "I paid but have no access"]);
  assert.equal(shown.response.reply?.answer, "Which of these is it?");
});

test("v5 typed smalltalk: the reply line, no card, not counted; a refused line becomes Portal's template for that intent", async () => {
  const h = harness({ answer: (input) => reply("suggestSmalltalkResponse", input) });
  const { response } = await h.assistant.ask(learner, typed("hello"), randomUUID());
  const turn = turnOf(response);
  assert.equal(response.reply, null);
  assert.deepEqual(response.alternatives, []);
  assert.equal(turn.kind, "smalltalk");
  assert.equal(turn.intent, "greeting");
  assert.equal(turn.reply, "Hi! What can I help you with today?");
  assert.equal(turn.unsolved, false);
  assert.equal(turn.countsAsQuestion, false);
  const row = await h.repository.findAssist(response.id);
  assert.equal(row?.answer, null, "small talk is not an answer");
  assert.equal(row?.kind, "smalltalk");
  await rejects(h.assistant.feedback(learner, response.id, true), "not_found");
  assert.equal((await h.repository.findChatSession(turn.sessionId))?.unsolvedStreak, 0);
  const zh = harness({ answer: (input) => {
    const answer = reply("suggestSmalltalkResponse", input);
    return { ...answer, turn: { ...answer.turn!, intent: "farewell", reply: "谢谢！**再见** 1" } };
  } });
  const bye = turnOf((await zh.assistant.ask(learner, { message: "谢谢", locale: "zh-CN", faqId: null }, randomUUID())).response);
  assert.equal(bye.reply, TURN_TEMPLATES["zh-CN"].farewell);
});

test("v5 typed clarify: an explanation of the card on screen, grounded in it; not covered (or ungrounded) is unsolved with no text", async () => {
  let next = "suggestAnswerContextResponse";
  const h = harness({ answer: (input) => reply(next, input) });
  const { sessionId } = await h.assistant.startSession(learner, { locale: "en-GB", orderId: null });
  await h.assistant.ask(learner, typed("I paid but my plan is not active", sessionId), randomUUID());
  next = "suggestClarifyResponse";
  const explained = await h.assistant.ask(learner, typed("So do I just have to wait?", sessionId), randomUUID());
  const turn = turnOf(explained.response);
  assert.equal(explained.response.reply, null, "never shown as an FAQ card");
  assert.equal(turn.kind, "clarify");
  assert.equal(turn.covered, true);
  assert.equal(turn.explanation, "Only for a few minutes. If it is still not active after that, reload My Learning, then sign out and back in.");
  assert.deepEqual(turn.source, { faqId: PAID, question: "I paid but my plan is not active" });
  assert.equal(turn.unsolved, false);
  assert.equal(turn.countsAsQuestion, false);
  const row = await h.repository.findAssist(explained.response.id);
  assert.equal(row?.covered, true);
  assert.equal(row?.faqId, PAID);
  assert.equal(row?.answer, turn.explanation, "the BackOffice sees what the learner was told");
  assert.deepEqual(await h.assistant.feedback(learner, explained.response.id, true), { id: explained.response.id, feedback: "helpful" }, "an explanation has the vote");
  next = "suggestClarifyNotCoveredResponse";
  const uncovered = turnOf((await h.assistant.ask(learner, typed("And if I paid twice?", sessionId), randomUUID())).response);
  assert.equal(uncovered.covered, false);
  assert.equal(uncovered.explanation, null);
  assert.equal(uncovered.unsolved, true);
  assert.equal(uncovered.uncovered, "not_covered", "the model said the card does not say it: the 'not in the answer' line");
  assert.equal(turn.uncovered, null, "covered: no uncovered reason");
  assert.equal((await h.repository.findChatSession(sessionId))?.unsolvedStreak, 1);
  const ungrounded = harness({ answer: (input) => {
    if (!input.context?.nodeId) return reply("suggestAnswerContextResponse", input);
    const answer = reply("suggestClarifyResponse", input);
    return { ...answer, turn: { ...answer.turn!, explanation: "Usually within 15 minutes." } };
  } });
  const second = await ungrounded.assistant.startSession(learner, { locale: "en-GB", orderId: null });
  await ungrounded.assistant.ask(learner, typed("paid", second.sessionId), randomUUID());
  const refused = await ungrounded.assistant.ask(learner, typed("how long?", second.sessionId), randomUUID());
  assert.equal(turnOf(refused.response).covered, false, "a number the card does not have: not shown");
  assert.equal(turnOf(refused.response).uncovered, "unavailable", "refused by a guard: never claim the card does not say it");
  const late = harness({ answer: (input) => {
    if (!input.context?.nodeId) return reply("suggestAnswerContextResponse", input);
    const answer = reply("suggestClarifyNotCoveredResponse", input);
    return { ...answer, turn: { ...answer.turn!, guard: { result: "fallback", reason: "timeout", fallback: ["explanation"] } } };
  } });
  const third = await late.assistant.startSession(learner, { locale: "en-GB", orderId: null });
  await late.assistant.ask(learner, typed("paid", third.sessionId), randomUUID());
  const timedOut = turnOf((await late.assistant.ask(learner, typed("how long?", third.sessionId), randomUUID())).response);
  assert.deepEqual([timedOut.covered, timedOut.uncovered, timedOut.unsolved], [false, "unavailable", true], "the explain step ran out of time: a neutral line, still unsolved");
  assert.equal((await ungrounded.repository.findAssist(refused.response.id))?.guard, "ungrounded");
  const nothingOnScreen = harness({ answer: (input) => reply("suggestClarifyResponse", input) });
  const lost = await nothingOnScreen.assistant.ask(learner, typed("what does that mean?"), randomUUID());
  assert.equal(turnOf(lost.response).kind, "no_match", "no card on screen: nothing to explain");
});

test("v5 typed no_match and an older Admin: the v3 fallback with alternatives, unsolved; an Admin without turns gets the v5 behaviour", async () => {
  const h = harness({ answer: (input) => reply("suggestNoMatchContextResponse", input) });
  const { response } = await h.assistant.ask(learner, typed("weather?"), randomUUID());
  assert.equal(response.reply, null);
  assert.deepEqual(response.alternatives, [{ faqId: CONTACT, question: "How do I contact support?" }]);
  assert.equal(turnOf(response).kind, "no_match");
  assert.equal(turnOf(response).unsolved, true);
  const old = harness({ answer: (input) => ({ suggestion: { id: input.runId, faqId: PAID, question: "I paid but my plan is not active", answer: RELEASE.nodes[2].answer }, alternatives: [] }) });
  const v5 = turnOf((await old.assistant.ask(learner, typed("paid"), randomUUID())).response);
  assert.equal(v5.kind, "answer");
  assert.equal(v5.intent, null, "no model classification reached Portal");
  assert.equal(v5.opening, null, "an older Admin: no frame, as before");
  assert.equal(v5.excerpt, null);
  const down = harness({ answer: () => { throw new Error("down"); } });
  const failed = await down.assistant.ask(learner, typed("paid"), randomUUID());
  assert.equal(failed.response.reply, null);
  assert.equal(turnOf(failed.response).kind, "no_match");
});

// ---------------------------------------------------------------- clicks

test("v5 click: an option, follow-up or chip is shown from the release verbatim with the fixed templates; neither the model nor Admin is asked", async () => {
  const h = harness();
  const { sessionId } = await h.assistant.startSession(learner, { locale: "en-GB", orderId: null });
  const chip = await h.assistant.click(learner, { locale: "en-GB", nodeId: CHOICE, fromNodeId: null, via: "starter", sessionId, label: null }, randomUUID());
  assert.equal(turnOf(chip.response).nodeType, "choice");
  assert.equal(turnOf(chip.response).opening, null);
  const option = await h.assistant.click(learner, { locale: "en-GB", nodeId: FAILED, fromNodeId: CHOICE, via: "option", sessionId, label: null }, randomUUID());
  const turn = turnOf(option.response);
  assert.deepEqual(option.response.reply, { id: option.response.id, faqId: FAILED, question: "My payment failed. What should I do?", answer: RELEASE.nodes[1].answer });
  assert.equal(turn.opening, TURN_TEMPLATES["en-GB"].opening);
  assert.equal(turn.closing, TURN_TEMPLATES["en-GB"].closing);
  assert.equal(turn.excerpt, null, "a click shows the whole card");
  assert.deepEqual(turn.next?.steps.map((step) => step.nodeId), [TWICE, CONTACT]);
  assert.equal(turn.via, "option");
  assert.equal(turn.turnIndex, 2);
  const followUp = await h.assistant.click(learner, { locale: "en-GB", nodeId: TWICE, fromNodeId: FAILED, via: "follow_up", sessionId, label: null }, randomUUID());
  assert.equal(followUp.response.reply?.faqId, TWICE, "a non-entry node is reached through its edge");
  assert.equal(h.calls.length, 0, "no Admin suggest call for any click");
  const row = await h.repository.findAssist(followUp.response.id);
  assert.equal(row?.parentNodeId, FAILED);
  assert.equal(row?.via, "follow_up");
  assert.equal(row?.question, "Will I be charged twice if I pay again?");
  assert.equal(row?.intent, null);
  assert.equal(row?.guard, null);
  assert.equal(row?.releaseVersion, 3);
  assert.equal(row?.source, "chip");
  assert.equal((await h.repository.findChatSession(sessionId))?.currentNodeId, TWICE);
  const key = randomUUID();
  const first = await h.assistant.click(learner, { locale: "zh-CN", nodeId: CONTACT, fromNodeId: null, via: "signal", sessionId: null, label: null }, key).catch((error: unknown) => error);
  assert.ok(first instanceof HelpdeskProblem, "the zh-CN release is not cached: no per-FAQ fallback without a label");
});

test("v5 click: an edge that does not exist, the wrong kind, a non-entry chip or an unknown node is 400, and nothing is logged", async () => {
  const h = harness();
  const { sessionId } = await h.assistant.startSession(learner, { locale: "en-GB", orderId: null });
  const bad = [
    { nodeId: TWICE, fromNodeId: CHOICE, via: "option" as const },
    { nodeId: FAILED, fromNodeId: CHOICE, via: "follow_up" as const },
    { nodeId: CONTACT, fromNodeId: FAILED, via: "option" as const },
    { nodeId: TWICE, fromNodeId: null, via: "starter" as const },
    { nodeId: TWICE, fromNodeId: null, via: "alternative" as const },
    { nodeId: id(99), fromNodeId: null, via: "signal" as const }
  ];
  for (const click of bad) await rejects(h.assistant.click(learner, { locale: "en-GB", sessionId, label: null, ...click }, randomUUID()), "invalid_request");
  assert.equal((await h.repository.findChatSession(sessionId))?.turns, 0);
  assert.equal(h.logs.filter((line) => line.event === "assistant_click_refused").length, bad.length);
});

test("v5 click without a release: a chip goes through Admin's per-FAQ path (as before v5); a follow-up or option is 400", async () => {
  const h = harness({ release: null });
  await rejects(h.assistant.click(learner, { locale: "en-GB", nodeId: FAILED, fromNodeId: CHOICE, via: "option", sessionId: null, label: "x" }, randomUUID()), "invalid_request");
  await rejects(h.assistant.click(learner, { locale: "en-GB", nodeId: id(42), fromNodeId: null, via: "signal", sessionId: null, label: null }, randomUUID()), "validation_failed");
  const chip = await h.assistant.click(learner, { locale: "en-GB", nodeId: id(42), fromNodeId: null, via: "signal", sessionId: null, label: "Why did my payment fail?" }, randomUUID());
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].faqId, id(42));
  assert.equal(h.calls[0].source, "chip");
  assert.equal(turnOf(chip.response).via, "signal");
  assert.equal(turnOf(chip.response).opening, TURN_TEMPLATES["en-GB"].opening, "the fixed click templates");
  const row = await h.repository.findAssist(chip.response.id);
  assert.equal(row?.releaseVersion, null);
  await h.assistant.feedback(learner, chip.response.id, true);
  assert.deepEqual(h.outcomes, [chip.response.id], "Admin's own run: the feedback goes to Admin");
});

test("v5 per-FAQ ask on a choice node (an old client's alternative or chip): framed by the cached node type, not as an answer", async () => {
  const h = harness();
  const asked = await h.assistant.ask(learner, { message: "Payment problem", locale: "en-GB", faqId: CHOICE, sessionId: null, via: "alternative" }, randomUUID());
  const turn = turnOf(asked.response);
  assert.equal(turn.nodeType, "choice");
  assert.equal(turn.opening, null, "a choice has no frame");
  assert.equal(turn.closing, null);
  const answer = await h.assistant.ask(learner, { message: "Failed", locale: "en-GB", faqId: FAILED, sessionId: null, via: "alternative" }, randomUUID());
  assert.equal(turnOf(answer.response).nodeType, "answer");
  assert.equal(turnOf(answer.response).opening, TURN_TEMPLATES["en-GB"].opening);
  const none = harness({ release: null });
  const unknown = await none.assistant.ask(learner, { message: "Payment", locale: "en-GB", faqId: id(42), sessionId: null, via: "alternative" }, randomUUID());
  assert.equal(turnOf(unknown.response).nodeType, "answer", "no release: the per-FAQ card is an answer, as before");
});

test("v5 click feedback stays in Portal (Admin never saw the run) and the sweep never forwards it; expanding is logged once, own answers only", async () => {
  const h = harness();
  const { sessionId } = await h.assistant.startSession(learner, { locale: "en-GB", orderId: null });
  const clicked = await h.assistant.click(learner, { locale: "en-GB", nodeId: FAILED, fromNodeId: null, via: "signal", sessionId, label: null }, randomUUID());
  assert.deepEqual(await h.assistant.feedback(learner, clicked.response.id, false), { id: clicked.response.id, feedback: "not_helpful" });
  assert.deepEqual(await h.assistant.rate(learner, clicked.response.id, 4), { id: clicked.response.id, rating: 4 });
  assert.equal(await h.assistant.deliverPending(), 0);
  assert.deepEqual(h.outcomes, []);
  const typedAnswer = await h.assistant.ask(learner, typed("paid", sessionId), randomUUID());
  await rejects(h.assistant.expand(other, typedAnswer.response.id), "not_found");
  assert.deepEqual(await h.assistant.expand(learner, typedAnswer.response.id), { id: typedAnswer.response.id, expanded: true });
  assert.deepEqual(await h.assistant.expand(learner, typedAnswer.response.id), { id: typedAnswer.response.id, expanded: true });
  assert.equal((await h.repository.findAssist(typedAnswer.response.id))?.expanded, true);
  await h.assistant.feedback(learner, typedAnswer.response.id, true);
  assert.deepEqual(h.outcomes, [typedAnswer.response.id], "a typed answer is Admin's run");
});

test("v5 session rules on the server: small talk keeps the unsolved streak, an answer resets it, no answer adds to it; an enquiry linking the chat ends it as ticket", async () => {
  let next = "suggestNoMatchContextResponse";
  const h = harness({ answer: (input) => reply(next, input) });
  const { sessionId } = await h.assistant.startSession(learner, { locale: "en-GB", orderId: null });
  const ids: string[] = [];
  const say = async () => { const { response } = await h.assistant.ask(learner, typed(next, sessionId), randomUUID()); ids.push(response.id); return (await h.repository.findChatSession(sessionId))!; };
  assert.equal((await say()).unsolvedStreak, 1);
  next = "suggestSmalltalkResponse";
  assert.equal((await say()).unsolvedStreak, 1, "small talk neither counts nor breaks the run");
  next = "suggestNoMatchContextResponse";
  assert.equal((await say()).unsolvedStreak, 2);
  next = "suggestAnswerContextResponse";
  const answered = await say();
  assert.equal(answered.unsolvedStreak, 0);
  assert.equal(answered.turns, 4);
  const ticket = await h.service.createTicket(learner, { category: "technical_support", subject: "Still stuck", body: "Help.", locale: "en-GB", files: [], assistIds: ids }, randomUUID());
  const ended = await h.repository.findChatSession(sessionId);
  assert.equal(ended?.endReason, "ticket");
  assert.equal(ended?.endedAt, ticket.ticket.createdAt);
});

// ---------------------------------------------------------------- v7: the Thinking card's steps

test("v7 steps: ask passes Admin's workflow steps on while it works; a replay of the same key sends none", async () => {
  const h = harness({ answer: (input, streaming) => { streaming?.onStep?.("retrieve"); streaming?.onStep?.("pick"); return reply("suggestAnswerContextResponse", input); } });
  const started = await h.assistant.startSession(learner, { locale: "en-GB", orderId: null });
  const key = randomUUID();
  const seen: AssistantStep[] = [];
  const first = await h.assistant.ask(learner, typed("reset password", started.sessionId), key, { onStep: (step) => seen.push(step) });
  assert.deepEqual(seen, ["retrieve", "pick"]);
  const again: AssistantStep[] = [];
  const replayed = await h.assistant.ask(learner, typed("reset password", started.sessionId), key, { onStep: (step) => again.push(step) });
  assert.equal(replayed.replayed, true);
  assert.deepEqual(again, [], "the stored answer comes back without asking Admin");
  assert.equal(replayed.response.id, first.response.id);
});
