// Helpdesk contract v8 (2026-11-06, owner: "一句话问了多件事这个情况值得单独处理", "可以给多个 和排序卡片"):
// one message that asks two or three things gets a card per ask, in the order the user asked, at most 3 in all
// (Admin's suggestion plus up to 2 further cards, `more`), and `missed` says how many asks found no card.
// Portal side: the tolerant read of Admin's fields, the row that keeps them (so a replay shows the same reply),
// the turn the chat gets (the excerpt from the cached release, as on the first card) and the browser's stored copy.
// Storage is the real DEV-only local repository; Admin and the release are fakes.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { SUGGEST_MORE_MAX, parseFaqRelease, parseSuggestTurn, type AdminSuggestReply, type AdminSuggestRequest, type AssistantTurnResponse, type FaqRelease } from "../../contracts/helpdesk";
import { createAssistantService } from "../../modules/helpdesk/assistant";
import { MORE_MAX, storedTurn } from "../../modules/helpdesk/learnerUi";
import { createLocalHelpdeskRepository } from "../../repositories/helpdeskRepository";

let root = "";
before(async () => { root = await mkdtemp(path.join(tmpdir(), "lg-helpdesk-v8-")); });
after(async () => { if (root && path.dirname(root) === tmpdir()) await rm(root, { recursive: true, force: true }); });

const fixture = JSON.parse(readFileSync("tests/fixtures/helpdesk-contract.json", "utf8")) as { version: number; portalToAdmin: Record<string, Record<string, unknown>> };
const RELEASE = parseFaqRelease(fixture.portalToAdmin.faqReleaseResponse) as FaqRelease;
const MULTI = fixture.portalToAdmin.suggestMultiAskResponse;
const id = (n: number) => `01a18100-0000-7000-8000-${String(n).padStart(12, "0")}`;
const CHOICE = id(20), FAILED = id(21), PAID = id(22), TWICE = id(23), CONTACT = id(24);
const node = (nodeId: string) => RELEASE.nodes.find((entry) => entry.id === nodeId)!;
const card = (nodeId: string, blocks: string[] = []) => ({ faqId: nodeId, question: node(nodeId).question, answer: node(nodeId).answer, blocks });
const learner = { id: "user-emily", email: "emily.carter@example.com", name: "Emily Carter" };

/** Admin's reply as the client reads it: the body's suggestion and alternatives, and its turn fields. */
function replyOf(body: Record<string, unknown>, input: AdminSuggestRequest): AdminSuggestReply {
  const copy = structuredClone(body);
  const suggestion = copy.suggestion as Record<string, unknown> | null;
  if (suggestion) suggestion.id = input.runId;
  const turn = parseSuggestTurn(copy);
  return { suggestion: suggestion as AdminSuggestReply["suggestion"], alternatives: [], ...(turn ? { turn } : {}) };
}

function harness(body: (input: AdminSuggestRequest) => Record<string, unknown>) {
  const repository = createLocalHelpdeskRepository(path.join(root, randomUUID()));
  const admin = {
    async suggest(): Promise<null> { throw new Error("v5 asks with suggestReply"); },
    async suggestReply(input: AdminSuggestRequest) { return replyOf(body(input), input); },
    async reportOutcome() { return true; },
    async faqs() { return []; },
    async faq() { return null; }
  };
  const assistant = createAssistantService({
    repository, admin, now: () => new Date("2026-11-06T09:00:00.000Z"), log: () => undefined, traceId: null,
    release: { async current(locale) { return RELEASE.locale === locale ? RELEASE : null; } },
    learnerRecords: async () => ({ user: { email: learner.email, emailVerifiedAt: "2026-01-01T00:00:00.000Z" }, orders: [], subscriptions: [] }),
    ownsOrder: async () => false
  });
  return { assistant, repository };
}

const typed = (message: string, sessionId: string) => ({ message, locale: "en-GB" as const, faqId: null, sessionId });
const turnOf = (response: unknown) => (response as AssistantTurnResponse).turn;

test("v8 fixture: the several-asks example is a context answer with one further card and one missed ask", () => {
  assert.equal(fixture.version, 8);
  assert.equal(SUGGEST_MORE_MAX, 2);
  assert.equal(MORE_MAX, SUGGEST_MORE_MAX, "the browser's copy of the limit");
  const read = parseSuggestTurn(MULTI);
  assert.equal(read?.kind, "answer");
  assert.equal(read?.nodeId, PAID);
  assert.deepEqual(read?.blocks, ["b2", "b3"]);
  assert.deepEqual(read?.more, [card(TWICE)], "the card verbatim, in the order the user asked");
  assert.equal(read?.missed, 1);
  // A one-ask answer (every v7 example) has neither key.
  const single = parseSuggestTurn(fixture.portalToAdmin.suggestAnswerContextResponse);
  assert.equal("more" in (single ?? {}), false);
  assert.equal("missed" in (single ?? {}), false);
});

test("v8 read: a malformed card, the suggestion's own card or a repeat is dropped, at most 2 are kept; only an answer with a card has them", () => {
  const read = (extra: Record<string, unknown>) => parseSuggestTurn({ ...MULTI, ...extra });
  assert.deepEqual(read({ more: [card(PAID), { ...card(TWICE), faqId: TWICE.toUpperCase() }, card(TWICE), { faqId: "nope", question: "Q", answer: "A" }, { ...card(FAILED), answer: " " }, card(CONTACT, ["b1", "x9", "b1"])] })?.more,
    [card(TWICE), card(CONTACT, ["b1"])], "lower-cased ids, no repeat of the first card or of each other, valid block ids once, at most 2");
  assert.equal("more" in (read({ more: "two cards" }) ?? {}), false);
  assert.equal("more" in (read({ more: [] }) ?? {}), false);
  assert.equal(read({ missed: 2 })?.missed, 2);
  assert.equal(read({ missed: 9 })?.missed, SUGGEST_MORE_MAX, "never more than the limit");
  for (const missed of [0, -1, 1.5, "1", null]) assert.equal("missed" in (read({ missed }) ?? {}), false, `missed ${String(missed)}`);
  const noMatch = parseSuggestTurn({ ...fixture.portalToAdmin.suggestNoMatchContextResponse, more: [card(TWICE)], missed: 1 });
  assert.equal(noMatch?.kind, "no_match");
  assert.equal("more" in (noMatch ?? {}), false, "no card, no further cards");
  assert.equal("missed" in (noMatch ?? {}), false);
  const smalltalk = parseSuggestTurn({ ...fixture.portalToAdmin.suggestSmalltalkResponse, more: [card(TWICE)], missed: 1 });
  assert.equal("more" in (smalltalk ?? {}), false);
});

test("v8 typed: the first card as before, the further cards in order with their excerpt from the release, the missed asks; kept on the row so a replay is the same", async () => {
  const h = harness(() => ({ ...MULTI, more: [card(TWICE), card(CONTACT)], missed: 1 }));
  const { sessionId } = await h.assistant.startSession(learner, { locale: "en-GB", orderId: null });
  const key = randomUUID();
  const { response } = await h.assistant.ask(learner, typed("I paid but my plan is not active. Will I be charged twice? And can I get a refund?", sessionId), key);
  const turn = turnOf(response);
  assert.equal(response.reply?.faqId, PAID, "the v3 answer is the first card, as for one ask");
  assert.equal(turn.kind, "answer");
  assert.equal(turn.opening, MULTI.opening, "Admin's fixed several-cards opening passes Portal's own check");
  assert.deepEqual(turn.excerpt?.map((block) => block.id), ["b2", "b3"]);
  assert.deepEqual(turn.more, [
    { faqId: TWICE, question: node(TWICE).question, answer: node(TWICE).answer, excerpt: null },
    { faqId: CONTACT, question: node(CONTACT).question, answer: node(CONTACT).answer, excerpt: null }
  ], "short cards are whole");
  assert.equal(turn.missed, 1);
  assert.equal(turn.unsolved, false, "an answer was given; the chat offers a person for the missed ask");
  assert.deepEqual(turn.next, { kind: "follow_up", steps: [{ nodeId: CONTACT, label: "How do I contact support?" }] }, "the first card's next steps as before");
  const row = await h.repository.findAssist(response.id);
  assert.deepEqual(row?.texts?.more, [card(TWICE), card(CONTACT)]);
  assert.equal(row?.texts?.missed, 1);
  assert.equal((await h.repository.findChatSession(sessionId))?.currentNodeId, PAID, "the first card is the one on screen");
  const again = await h.assistant.ask(learner, typed("I paid but my plan is not active. Will I be charged twice? And can I get a refund?", sessionId), key);
  assert.equal(again.replayed, true);
  assert.deepEqual(again.response, response, "an Idempotency-Key replay shows the same cards");
});

test("v8 typed: a further card's excerpt is the release's blocks when its text is the release's; a choice node or a card the release words differently is handled like the first card", async () => {
  const failedFirst = (input: AdminSuggestRequest) => ({
    ...MULTI, suggestion: { id: input.runId, faqId: FAILED, question: node(FAILED).question, answer: node(FAILED).answer }, nodeId: FAILED, blocks: [],
    more: [card(PAID, ["b2", "b3"]), card(CHOICE), { ...card(TWICE), answer: "An older wording of the card." }]
  });
  // more is capped at 2 when read: PAID and CHOICE reach Portal; CHOICE is a choice node in the release, so it is dropped.
  const h = harness(failedFirst);
  const { sessionId } = await h.assistant.startSession(learner, { locale: "en-GB", orderId: null });
  const turn = turnOf((await h.assistant.ask(learner, typed("Payment failed? And I paid but have no access?", sessionId), randomUUID())).response);
  assert.deepEqual(turn.more?.map((entry) => [entry.faqId, entry.excerpt?.map((block) => block.id) ?? null]), [[PAID, ["b2", "b3"]]]);
  assert.equal(turn.more?.[0].excerpt?.[0].text, "1. Reload **My Learning**\n2. Sign out and sign in again");
  const reworded = harness((input) => ({ ...failedFirst(input), more: [{ ...card(PAID, ["b2", "b3"]), answer: "An older wording of the card." }] }));
  const second = await reworded.assistant.startSession(learner, { locale: "en-GB", orderId: null });
  const shown = turnOf((await reworded.assistant.ask(learner, typed("Payment failed? And I paid but have no access?", second.sessionId), randomUUID())).response);
  assert.deepEqual(shown.more, [{ faqId: PAID, question: node(PAID).question, answer: "An older wording of the card.", excerpt: null }], "Admin's text, whole");
  const choiceFirst = harness((input) => ({ ...fixture.portalToAdmin.suggestChoiceResponse, suggestion: { ...(fixture.portalToAdmin.suggestChoiceResponse.suggestion as object), id: input.runId }, more: [card(TWICE)], missed: 1 }));
  const third = await choiceFirst.assistant.startSession(learner, { locale: "en-GB", orderId: null });
  const choice = turnOf((await choiceFirst.assistant.ask(learner, typed("payment problem", third.sessionId), randomUUID())).response);
  assert.equal(choice.nodeType, "choice");
  assert.equal("more" in choice, false, "a choice card stands alone: its options need the turn");
  assert.equal("missed" in choice, false);
});

test("v8 stored transcript: the further cards and missed asks come back from the browser's copy, read tolerantly", () => {
  const base = {
    kind: "answer", intent: "question", via: "typed", nodeId: PAID, nodeType: "answer", opening: "o", closing: "c", reply: null, explanation: null, covered: null,
    excerpt: null, next: null, source: null, releaseVersion: 3, sessionId: id(30), turnIndex: 1, unsolved: false, countsAsQuestion: true
  };
  const blocks = [{ id: "b2", text: "two" }, { id: "x", text: "bad" }];
  const more = [{ faqId: TWICE, question: "Q2", answer: "A2", excerpt: blocks }, { faqId: PAID, question: "again", answer: "again" }, { faqId: CONTACT, question: "Q3", answer: "A3", excerpt: [] }, { faqId: FAILED, question: "Q4", answer: "A4" }];
  const read = storedTurn({ ...base, more, missed: 1 });
  assert.deepEqual(read?.more, [{ faqId: TWICE, question: "Q2", answer: "A2", excerpt: [{ id: "b2", text: "two" }] }, { faqId: CONTACT, question: "Q3", answer: "A3", excerpt: null }], "no repeat of the first card, at most 2");
  assert.equal(read?.missed, 1);
  assert.equal("more" in (storedTurn(base) ?? {}), false, "a one-ask turn reads as before");
  assert.equal("missed" in (storedTurn({ ...base, missed: 0 }) ?? {}), false);
  assert.equal("more" in (storedTurn({ ...base, kind: "clarify", more }) ?? {}), false, "only an answer has them");
});
