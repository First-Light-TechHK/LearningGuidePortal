// Helpdesk v5 (helpdesk-v5-context-chips-and-smalltalk.md Part B §3, Part D §4):
// the v4 chat rules (modules/helpdesk/chatSession.ts) with small talk and
// explanations of the card on screen. Small talk and clarify turns never
// count toward the 8-question check-in or the unsolved run, except a clarify
// the card does not cover, which is unsolved; an explanation is an answered
// turn (rated at the end, broken run unless voted down). The stored
// transcript keeps the server's turn.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { AssistantTurn } from "../../contracts/helpdesk";
import { cardsAfterChange, idleDeadline, lastAnsweredAssist, sessionQuestions, unsolvedStreak } from "../../modules/helpdesk/chatSession";
import { readTranscript, storedTurn, type ChatEntry } from "../../modules/helpdesk/learnerUi";

const id = (n: number) => `01a18100-0000-7000-8000-${String(n).padStart(12, "0")}`;
const SESSION = id(30);
const q = (text = "Q?"): ChatEntry => ({ kind: "question", text });
const turn = (kind: AssistantTurn["kind"], extra: Partial<AssistantTurn> = {}): AssistantTurn => ({
  kind, intent: null, via: "typed", nodeId: null, nodeType: null, opening: null, closing: null, reply: null, explanation: null, covered: null, excerpt: null, next: null, source: null,
  releaseVersion: 3, sessionId: SESSION, turnIndex: 1, unsolved: kind === "no_match", countsAsQuestion: kind === "answer" || kind === "no_match", ...extra
});
const answered = (n: number, feedback: "helpful" | "not_helpful" | null = null): ChatEntry => ({ kind: "answer", id: id(n), reply: { id: id(n), faqId: id(900 + n), question: `FAQ ${n}`, answer: "A." }, feedback, turn: turn("answer", { nodeId: id(900 + n), nodeType: "answer" }) });
const noMatch = (n: number): ChatEntry => ({ kind: "answer", id: id(n), reply: null, feedback: null, turn: turn("no_match") });
const smalltalk = (n: number, intent: AssistantTurn["intent"] = "greeting"): ChatEntry => ({ kind: "answer", id: id(n), reply: null, feedback: null, turn: turn("smalltalk", { intent, reply: "Hi! What can I help with?" }) });
const clarify = (n: number, covered: boolean, feedback: "helpful" | "not_helpful" | null = null): ChatEntry => ({
  kind: "answer", id: id(n), reply: null, feedback,
  turn: turn("clarify", { intent: "clarify", nodeId: id(901), covered, explanation: covered ? "Only for a few minutes." : null, source: { faqId: id(901), question: "FAQ 1" }, unsolved: !covered })
});

test("v5 chat: small talk and explanations do not count toward the 8-question check-in", () => {
  const turns = (count: number, from = 1) => Array.from({ length: count }, (_, index) => [q(`Q${index + from}`), answered(index + from)]).flat();
  assert.equal(sessionQuestions([q("hi"), smalltalk(1), q("thanks"), smalltalk(2, "farewell")]), 0);
  assert.equal(sessionQuestions([...turns(2), q("what does that mean?"), clarify(3, true), q("and if?"), clarify(4, false)]), 2);
  assert.deepEqual(cardsAfterChange([...turns(7), q("hi"), smalltalk(50)]), [], "7 counted questions and a hello: no check-in");
  assert.deepEqual(cardsAfterChange([...turns(7), q("?"), clarify(50, true)]), [], "nor after an explanation");
  assert.deepEqual(cardsAfterChange([...turns(7), q("hi"), smalltalk(50), q("Q8"), answered(8)]), [{ kind: "checkin" }], "the reply to the 8th counted question");
  assert.deepEqual(cardsAfterChange([...turns(8), q("thanks"), smalltalk(51, "farewell")]), [], "the check-in follows a counted reply only");
});

test("v5 chat: small talk neither counts nor breaks the unsolved run; a covered explanation breaks it; an uncovered one is unsolved", () => {
  assert.equal(unsolvedStreak([q(), noMatch(1), q("hi"), smalltalk(2), q(), noMatch(3)]), 2, "small talk in between");
  assert.deepEqual(cardsAfterChange([q(), noMatch(1), q("hi"), smalltalk(2), q(), noMatch(3)]), [{ kind: "handover", reason: "unsolved" }]);
  assert.deepEqual(cardsAfterChange([q(), noMatch(1), q("hi"), smalltalk(2)]), [], "small talk after one unsolved turn is not the second");
  assert.equal(unsolvedStreak([q("hi"), smalltalk(1), q("bye"), smalltalk(2)]), 0, "small talk alone is never unsolved");
  assert.deepEqual(cardsAfterChange([q(), answered(1), q("那如果…呢"), clarify(2, false), q(), noMatch(3)]), [{ kind: "handover", reason: "unsolved" }], "not covered, then no answer");
  assert.deepEqual(cardsAfterChange([q(), answered(1), q("?"), clarify(2, false), q("?"), clarify(3, false)]), [{ kind: "handover", reason: "unsolved" }], "two uncovered in a row");
  assert.deepEqual(cardsAfterChange([q(), noMatch(1), q(), answered(2), q("?"), clarify(3, true)]), [], "an explanation is an answered turn");
  assert.deepEqual(cardsAfterChange([q(), noMatch(1), q(), clarify(2, true, "not_helpful")]), [{ kind: "handover", reason: "unsolved" }], "unless voted down");
  // v4 entries without a turn keep v4's rules exactly.
  const v4Fallback: ChatEntry = { kind: "answer", id: id(9), reply: null, feedback: null };
  assert.equal(unsolvedStreak([q(), v4Fallback, q(), v4Fallback]), 2);
});

test("v5 chat: the end-of-session rating card rates the newest answer or covered explanation, never small talk; small talk alone does not arm the idle end", () => {
  assert.equal(lastAnsweredAssist([q(), answered(1), q("thanks"), smalltalk(2, "farewell")]), id(1), "thanks after an answer: rate the answer");
  assert.equal(lastAnsweredAssist([q("hi"), smalltalk(1)]), null);
  assert.equal(lastAnsweredAssist([q(), answered(1), q("?"), clarify(2, true)]), id(2));
  assert.equal(lastAnsweredAssist([q(), answered(1), q("?"), clarify(2, false)]), id(1), "an uncovered clarify answered nothing");
  const at = (entry: ChatEntry, iso: string) => ({ ...entry, at: iso }) as ChatEntry;
  assert.equal(idleDeadline([at(q("hi"), "2026-10-30T09:00:00.000Z"), at(smalltalk(1), "2026-10-30T09:00:01.000Z")], 0), null, "nothing answered yet");
  assert.equal(idleDeadline([at(q(), "2026-10-30T09:00:00.000Z"), at(answered(1), "2026-10-30T09:00:01.000Z"), at(q("thanks"), "2026-10-30T09:05:00.000Z"), at(smalltalk(2), "2026-10-30T09:05:01.000Z")], 0), Date.parse("2026-10-30T09:15:01.000Z"), "small talk resets the idle timer");
});

test("v5 chat: the stored transcript keeps the server's turn; a malformed turn is dropped and the entry reads as before v5", () => {
  const full = turn("answer", {
    intent: "question", nodeId: id(22), nodeType: "answer", opening: "Don't worry:", closing: "Tell me if not.", excerpt: [{ id: "b2", text: "1. Reload" }],
    next: { kind: "follow_up", steps: [{ nodeId: id(24), label: "How do I contact support?" }] }, turnIndex: 4
  });
  const stored = JSON.stringify([
    { kind: "answer", id: id(1), reply: { id: id(1), faqId: id(22), question: "Q", answer: "A" }, feedback: null, turn: full },
    { kind: "answer", id: id(2), reply: null, feedback: null, turn: { ...turn("smalltalk"), reply: "Hi!", intent: "greeting" } },
    { kind: "answer", id: id(3), reply: null, feedback: null, turn: { kind: "weird", via: "typed", sessionId: SESSION, turnIndex: 1 } },
    { kind: "answer", id: id(4), reply: null, feedback: null, turn: { ...turn("clarify"), sessionId: "nope" } },
    { kind: "answer", id: id(5), reply: null, feedback: null, turn: { ...turn("clarify", { covered: true, explanation: "E" }), excerpt: [{ id: "x", text: "bad" }], next: { kind: "jump", steps: [] }, source: { faqId: "bad", question: "Q" } } }
  ]);
  const entries = readTranscript(stored);
  assert.deepEqual((entries[0] as { turn?: AssistantTurn }).turn, full);
  assert.equal((entries[1] as { turn?: AssistantTurn }).turn?.reply, "Hi!");
  assert.equal("turn" in entries[2], false, "an unknown kind: no turn");
  assert.equal("turn" in entries[3], false, "no valid session: no turn");
  const lenient = (entries[4] as { turn?: AssistantTurn }).turn;
  assert.equal(lenient?.explanation, "E");
  assert.equal(lenient?.excerpt, null);
  assert.equal(lenient?.next, null);
  assert.equal(lenient?.source, null);
  assert.equal(storedTurn(null), null);
  assert.equal(storedTurn({ ...full, turnIndex: 0 }), null);
});
