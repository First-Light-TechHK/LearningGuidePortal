// Helpdesk v5 chat panel rules (pure; modules/helpdesk/chatSession.ts and learnerUi.ts) that the
// panel (components/helpdesk/AssistantChat.tsx) builds on:
// - a choice card (A/B/C/D, graph design §1) is a step, not an answer: it neither counts as unsolved
//   nor breaks the run, and the rating card never rates it;
// - "thanks" / "bye" after an answered assist is followed by the v3 rating card when it is not rated
//   yet (Part B §3), as a "rate" line that the transcript keeps; a rated one is never asked again;
// - the session the next turn belongs to is the newest turn's (the server's), else the one the page
//   started; nothing after an end.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { AssistantTurn } from "../../contracts/helpdesk";
import { chatSessionId, isChoiceTurn, lastAnsweredAssist, ratingAfterFarewell, unsolvedStreak, cardsAfterChange } from "../../modules/helpdesk/chatSession";
import { optionLetter, readTranscript, type ChatEntry } from "../../modules/helpdesk/learnerUi";

const id = (n: number) => `01a18100-0000-7000-8000-${String(n).padStart(12, "0")}`;
const SESSION = id(30);
const OTHER = id(31);
const q = (text = "Q?"): ChatEntry => ({ kind: "question", text });
const turn = (kind: AssistantTurn["kind"], extra: Partial<AssistantTurn> = {}): AssistantTurn => ({
  kind, intent: null, via: "typed", nodeId: null, nodeType: null, opening: null, closing: null, reply: null, explanation: null, covered: null, excerpt: null, next: null, source: null,
  releaseVersion: 3, sessionId: SESSION, turnIndex: 1, unsolved: kind === "no_match", countsAsQuestion: kind === "answer" || kind === "no_match", ...extra
});
const answered = (n: number, extra: Partial<AssistantTurn> = {}): ChatEntry => ({ kind: "answer", id: id(n), reply: { id: id(n), faqId: id(900 + n), question: `FAQ ${n}`, answer: "A." }, feedback: null, turn: turn("answer", { nodeId: id(900 + n), nodeType: "answer", ...extra }) });
const choice = (n: number): ChatEntry => ({
  kind: "answer", id: id(n), reply: { id: id(n), faqId: id(900 + n), question: "Payment problem?", answer: "Which one is it?" }, feedback: null,
  turn: turn("answer", { nodeId: id(900 + n), nodeType: "choice", next: { kind: "option", steps: [{ nodeId: id(1), label: "Failed" }, { nodeId: id(2), label: "Charged twice" }] } })
});
const noMatch = (n: number): ChatEntry => ({ kind: "answer", id: id(n), reply: null, feedback: null, turn: turn("no_match") });
const farewell = (n: number): ChatEntry => ({ kind: "answer", id: id(n), reply: null, feedback: null, turn: turn("smalltalk", { intent: "farewell", reply: "You're welcome!" }) });
const hello = (n: number): ChatEntry => ({ kind: "answer", id: id(n), reply: null, feedback: null, turn: turn("smalltalk", { intent: "greeting", reply: "Hi!" }) });

test("v5 chat: a choice card is a step, never unsolved, never an answered turn, never rated", () => {
  assert.equal(isChoiceTurn(choice(1)), true);
  assert.equal(isChoiceTurn(answered(1)), false);
  assert.equal(unsolvedStreak([q(), noMatch(1), q("payment problem"), choice(2)]), 1, "the choice card neither counts nor breaks the run");
  assert.deepEqual(cardsAfterChange([q(), noMatch(1), q("payment problem"), choice(2), q(), noMatch(3)]), [{ kind: "handover", reason: "unsolved" }]);
  assert.equal(lastAnsweredAssist([q(), answered(1), q("payment problem"), choice(2)]), id(1), "the rating card rates the answer before it");
  assert.equal(lastAnsweredAssist([q("payment problem"), choice(2)]), null);
});

test("v5 chat: thanks after an answered assist brings the rating card once; never without an answer, never when it was rated", () => {
  assert.deepEqual(ratingAfterFarewell([q(), answered(1), q("thanks"), farewell(2)]), { kind: "rate", ratingFor: id(1), rating: "open" });
  assert.equal(ratingAfterFarewell([q("thanks"), farewell(2)]), null, "nothing was answered");
  assert.equal(ratingAfterFarewell([q(), answered(1), q("hi"), hello(2)]), null, "a hello is not a farewell");
  assert.equal(ratingAfterFarewell([q(), answered(1), q("thanks"), farewell(2), { kind: "rate", ratingFor: id(1), rating: "rated" }, q("bye"), farewell(3)]), null, "rated already");
  assert.equal(ratingAfterFarewell([q(), answered(1), q("thanks"), farewell(2), { kind: "rate", ratingFor: id(1), rating: "skipped" }, q("bye"), farewell(3)]), null, "skipped already: not asked again");
  assert.equal(ratingAfterFarewell([q(), answered(1), q("thanks"), farewell(2), { kind: "rate", ratingFor: id(1), rating: "open" }, q("bye"), farewell(3)]), null, "still open above");
  assert.equal(lastAnsweredAssist([q(), answered(1), q("thanks"), farewell(2), { kind: "rate", ratingFor: id(1), rating: "rated" }]), null, "the end card does not ask again either");
  const next = [q(), answered(1), q("thanks"), farewell(2), { kind: "rate", ratingFor: id(1), rating: "open" } as ChatEntry];
  assert.deepEqual(cardsAfterChange(next), [], "a rating card adds no other card");
  // The transcript keeps it.
  const stored = readTranscript(JSON.stringify([...next, { kind: "rate", ratingFor: "nope", rating: "open" }, { kind: "rate", ratingFor: id(1), rating: "maybe" }]));
  assert.deepEqual(stored.at(-1), { kind: "rate", ratingFor: id(1), rating: "open" });
  assert.equal(stored.length, 5, "malformed rating lines are dropped");
});

test("v5 chat: the next turn's session is the newest turn's, else the page's; after an end only a new one", () => {
  assert.equal(chatSessionId([], SESSION), SESSION);
  assert.equal(chatSessionId([q(), answered(1)], null), SESSION);
  assert.equal(chatSessionId([q(), answered(1, { sessionId: OTHER })], SESSION), OTHER, "the server's session wins");
  assert.equal(chatSessionId([q(), { kind: "answer", id: id(5), reply: null, feedback: null }], null), null, "an older server: none");
  assert.equal(chatSessionId([q(), answered(1), { kind: "ended", reason: "learner", ratingFor: null, rating: "open" }], null), null, "an ended session is not continued");
  assert.equal(chatSessionId([q(), answered(1), { kind: "ended", reason: "idle", ratingFor: null, rating: "open" }], OTHER), OTHER, "the new one the chat started");
});

test("v5 chat: options are lettered A to D", () => {
  assert.deepEqual([0, 1, 2, 3].map(optionLetter), ["A", "B", "C", "D"]);
});
