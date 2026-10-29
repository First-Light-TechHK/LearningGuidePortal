// Helpdesk v4 Part B (helpdesk-v4-order-and-chat-end.md): ending or handing
// over a long AI chat, decided by code in the Portal chat (never by a model).
// The constants live in one exported object (CHAT_SESSION_RULES); these tests
// lock the keyword list, the two-unsolved rule, the check-in after the 8th
// question, the 10-minute idle end and how a stored transcript keeps it all.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CHAT_SESSION_RULES, cardsAfterChange, currentSession, endSession, idleDeadline, isHumanRequest, lastAnsweredAssist, sessionQuestions, unsolvedStreak } from "../../modules/helpdesk/chatSession";
import { assistIdsOf, readTranscript, settleTranscript, type ChatEntry } from "../../modules/helpdesk/learnerUi";

const id = (n: number) => `01a18100-0000-7000-8000-${String(n).padStart(12, "0")}`;
const q = (text = "Q?"): ChatEntry => ({ kind: "question", text });
const answered = (n: number, feedback: "helpful" | "not_helpful" | null = null): ChatEntry => ({ kind: "answer", id: id(n), reply: { id: id(n), faqId: id(900 + n), question: `FAQ ${n}`, answer: "A." }, feedback });
const fallback = (n: number, feedback: "helpful" | "not_helpful" | null = null): ChatEntry => ({ kind: "answer", id: id(n), reply: null, feedback });
const error: ChatEntry = { kind: "error", error: "error" };
const handover = (reason: "requested" | "unsolved" = "unsolved"): ChatEntry => ({ kind: "handover", reason });

test("v4 Part B: the rules are one exported, frozen config object with the spec's numbers and keyword list", () => {
  assert.equal(CHAT_SESSION_RULES.unsolvedInARow, 2);
  assert.equal(CHAT_SESSION_RULES.checkInAfterQuestions, 8);
  assert.equal(CHAT_SESSION_RULES.idleMs, 10 * 60_000);
  for (const keyword of ["人工", "真人", "客服", "转人工", "投诉", "human", "agent", "real person", "complaint", "speak to someone"]) assert.ok(CHAT_SESSION_RULES.humanKeywords.includes(keyword), `spec keyword ${keyword}`);
  for (const keyword of ["轉人工", "投訴"]) assert.ok(CHAT_SESSION_RULES.humanKeywords.includes(keyword), `Traditional form ${keyword}`);
  assert.deepEqual([...CHAT_SESSION_RULES.humanKeywordExceptions], ["人工智能", "人工智慧", "ai agent"]);
  assert.ok(Object.isFrozen(CHAT_SESSION_RULES));
  assert.ok(Object.isFrozen(CHAT_SESSION_RULES.humanKeywords));
  assert.ok(Object.isFrozen(CHAT_SESSION_RULES.humanKeywordExceptions));
  assert.throws(() => { (CHAT_SESSION_RULES as { idleMs: number }).idleMs = 1; }, TypeError, "nothing can change a rule at run time");
});

test("v4 Part B: an explicit request for a person matches the keyword list, case-insensitive, Simplified and Traditional, whole English words", () => {
  const yes = [
    "人工", "我要转人工", "轉人工客服", "找真人", "联系客服", "我要投诉", "我要投訴", "人工客服在吗",
    "human", "HUMAN please", "Can I talk to a Human?", "an agent please", "Agents?", "real person", "a REAL   person", "I have a complaint", "complaints",
    "I want to speak to someone", "Speak To Someone", "ＨＵＭＡＮ", "human-agent", "我想要人工智能课程的客服"
  ];
  for (const message of yes) assert.equal(isHumanRequest(message), true, message);
  const no = [
    "How do I reset my password?", "Where is my invoice?", "humanities course", "What is on the agenda?", "reagent", "nonhuman", "personal data",
    "人工智能课程怎么退款", "人工智慧課程", "What is an AI agent?", "Build AI agents with Python", "", "   "
  ];
  for (const message of no) assert.equal(isHumanRequest(message), false, message);
  // The list is the config's: a custom rule set is honoured as given.
  assert.equal(isHumanRequest("operator", { ...CHAT_SESSION_RULES, humanKeywords: ["operator"] }), true);
  assert.equal(isHumanRequest("human", { ...CHAT_SESSION_RULES, humanKeywords: ["operator"] }), false);
});

test("v4 Part B: a session is everything after the last end; the counters count only its learner questions", () => {
  const ended: ChatEntry = { kind: "ended", reason: "idle", ratingFor: null, rating: "open" };
  const entries = [q(), answered(1), q(), fallback(2), ended, q("again"), fallback(3)];
  assert.deepEqual(currentSession(entries), [q("again"), fallback(3)]);
  assert.equal(sessionQuestions(entries), 1);
  assert.equal(sessionQuestions([q(), q(), handover("requested"), q(), error]), 3, "a keyword question and an unanswered one count as questions");
  assert.deepEqual(currentSession([q(), answered(1), ended]), []);
});

test("v4 Part B: two unsolved turns in a row (no answer, or an answer marked not helpful) show the handover card; errors are neutral; a card restarts the count", () => {
  assert.equal(unsolvedStreak([q(), fallback(1), q(), fallback(2)]), 2);
  assert.deepEqual(cardsAfterChange([q(), fallback(1), q(), fallback(2)]), [handover()], "two fallbacks");
  assert.deepEqual(cardsAfterChange([q(), answered(1, "not_helpful"), q(), fallback(2)]), [handover()], "not helpful, then no answer");
  assert.deepEqual(cardsAfterChange([q(), fallback(1), q(), answered(2, "not_helpful")]), [handover()], "a No vote on the newest answer completes the pair");
  assert.deepEqual(cardsAfterChange([q(), answered(1), q(), fallback(2)]), [], "an answer not voted down breaks the run");
  assert.deepEqual(cardsAfterChange([q(), answered(1, "helpful"), q(), fallback(2)]), []);
  assert.deepEqual(cardsAfterChange([q(), fallback(1)]), [], "one is not enough");
  assert.deepEqual(cardsAfterChange([q(), fallback(1), q(), error, q(), fallback(2)]), [handover()], "an error bubble neither counts nor breaks the run");
  assert.deepEqual(cardsAfterChange([q(), fallback(1), q(), fallback(2), handover(), q(), fallback(3)]), [], "the card restarts the count");
  assert.deepEqual(cardsAfterChange([q(), fallback(1), q(), fallback(2), handover(), q(), fallback(3), q(), fallback(4)]), [handover()], "and two more show it again");
  assert.deepEqual(cardsAfterChange([q(), fallback(1), q("human"), handover("requested"), q(), fallback(2)]), [], "a requested handover restarts it too");
  assert.deepEqual(cardsAfterChange([q(), fallback(1), { kind: "ended", reason: "learner", ratingFor: null, rating: "open" }, q(), fallback(2)]), [], "a new session starts from zero");
  assert.deepEqual(cardsAfterChange([q(), fallback(1), q(), fallback(2), handover()]), [], "never twice for the same turns");
});

test("v4 Part B: the reply to the 8th learner question is followed by “Still need help?”, once per session; a due handover goes first", () => {
  const turns = (count: number, from = 1) => Array.from({ length: count }, (_, index) => [q(`Q${index + from}`), answered(index + from)]).flat();
  assert.deepEqual(cardsAfterChange(turns(7)), [], "7 questions: nothing");
  assert.deepEqual(cardsAfterChange(turns(8)), [{ kind: "checkin" }], "the 8th reply");
  assert.deepEqual(cardsAfterChange([...turns(8), { kind: "checkin" }, ...turns(1, 9)]), [], "once per session");
  assert.deepEqual(cardsAfterChange([...turns(8), { kind: "checkin" }, { kind: "ended", reason: "learner", ratingFor: id(8), rating: "open" }, ...turns(8, 20)]), [{ kind: "checkin" }], "a new session counts again");
  // The 8th reply is the second unsolved in a row: the handover card offers the person; the check-in waits for the next reply.
  const unsolved = [...turns(6), q(), fallback(7), q(), fallback(8)];
  assert.deepEqual(cardsAfterChange(unsolved), [handover()]);
  assert.deepEqual(cardsAfterChange([...unsolved, handover(), q(), answered(9)]), [{ kind: "checkin" }]);
  // The 8th question asked for a person (no reply): the check-in follows the next reply.
  const requested = [...turns(7), q("人工"), handover("requested")];
  assert.deepEqual(cardsAfterChange(requested), []);
  assert.deepEqual(cardsAfterChange([...requested, q(), answered(9)]), [{ kind: "checkin" }]);
  assert.deepEqual(cardsAfterChange([...turns(7), q(), error]), [], "an error is not a reply");
  assert.deepEqual(cardsAfterChange([...turns(7), q()]), [], "nor is a question still waiting");
});

test("v4 Part B: ending a session rates the last answered assist of that session that is not rated yet, or nothing", () => {
  assert.equal(lastAnsweredAssist([q(), answered(1), q(), answered(2), q(), fallback(3)]), id(2), "the newest with an answer (a fallback has none)");
  assert.equal(lastAnsweredAssist([q(), fallback(1)]), null);
  assert.equal(lastAnsweredAssist([q(), answered(1), { kind: "ended", reason: "idle", ratingFor: id(1), rating: "rated" }, q(), fallback(2)]), null, "only this session's answers");
  assert.equal(lastAnsweredAssist([q(), answered(1), { kind: "ended", reason: "idle", ratingFor: id(1), rating: "open" }]), null, "an ended session has nothing left to rate");
  assert.deepEqual(endSession([q(), answered(1), q(), fallback(2)], "learner"), { kind: "ended", reason: "learner", ratingFor: id(1), rating: "open" });
  assert.deepEqual(endSession([q(), fallback(2)], "idle"), { kind: "ended", reason: "idle", ratingFor: null, rating: "open" });
  // The same assist rated in an earlier session (a replayed answer id) is not offered again.
  assert.equal(lastAnsweredAssist([q(), answered(1), { kind: "ended", reason: "learner", ratingFor: id(1), rating: "rated" }, q(), answered(1)]), null);
});

test("v4 Part B: the idle deadline is 10 minutes after the newest of the last AI answer and the last learner input; none before an answer or after an end", () => {
  const at = (iso: string) => Date.parse(iso);
  const answer = { ...answered(1), at: "2026-10-29T12:00:00.000Z" } as ChatEntry;
  const question = { ...q(), at: "2026-10-29T11:59:58.000Z" } as ChatEntry;
  assert.equal(idleDeadline([question, answer], 0), at("2026-10-29T12:10:00.000Z"));
  assert.equal(idleDeadline([question, answer], at("2026-10-29T12:04:00.000Z")), at("2026-10-29T12:14:00.000Z"), "typing or a vote after the answer moves it");
  assert.equal(idleDeadline([question, { ...fallback(2), at: "2026-10-29T12:00:00.000Z" } as ChatEntry], 0), at("2026-10-29T12:10:00.000Z"), "a fallback reply is an AI answer too");
  assert.equal(idleDeadline([question], 0), null, "no AI answer yet");
  assert.equal(idleDeadline([q("人工"), handover("requested")], 0), null);
  assert.equal(idleDeadline([question, answer, { kind: "ended", reason: "idle", ratingFor: id(1), rating: "open" }], 0), null, "already ended");
  assert.equal(idleDeadline([q(), answered(1)], at("2026-10-29T12:00:00.000Z")), at("2026-10-29T12:10:00.000Z"), "an older transcript without times counts from the given input time");
  assert.equal(idleDeadline([q(), answered(1)], 0), null, "and with no time at all there is nothing to count from");
});

test("v4 Part B: the stored transcript keeps the new cards, the end line and the times; malformed ones are dropped; older transcripts read as before", () => {
  const stored = JSON.stringify([
    { kind: "question", text: "Q?", at: "2026-10-29T12:00:00.000Z" },
    { kind: "answer", id: id(1), reply: null, feedback: null, at: "2026-10-29T12:00:01.000Z" },
    { kind: "handover", reason: "requested" },
    { kind: "handover", reason: "unsolved" },
    { kind: "checkin" },
    { kind: "ended", reason: "idle", ratingFor: id(1), rating: "open" },
    { kind: "ended", reason: "learner", ratingFor: null, rating: "skipped" },
    { kind: "ended", reason: "learner", ratingFor: id(2), rating: "rated" },
    { kind: "question", text: "bad time", at: "yesterday" },
    { kind: "handover", reason: "bored" },
    { kind: "ended", reason: "idle", ratingFor: "nope", rating: "open" },
    { kind: "ended", reason: "later", ratingFor: null, rating: "open" },
    { kind: "ended", reason: "idle", ratingFor: null, rating: "maybe" }
  ]);
  assert.deepEqual(readTranscript(stored), [
    { kind: "question", text: "Q?", at: "2026-10-29T12:00:00.000Z" },
    { kind: "answer", id: id(1), reply: null, feedback: null, at: "2026-10-29T12:00:01.000Z" },
    { kind: "handover", reason: "requested" },
    { kind: "handover", reason: "unsolved" },
    { kind: "checkin" },
    { kind: "ended", reason: "idle", ratingFor: id(1), rating: "open" },
    { kind: "ended", reason: "learner", ratingFor: null, rating: "skipped" },
    { kind: "ended", reason: "learner", ratingFor: id(2), rating: "rated" },
    { kind: "question", text: "bad time" }
  ]);
  // A keyword question is answered by its card, so a reload does not add the error bubble.
  const keyword = [q("human"), handover("requested")];
  assert.deepEqual(settleTranscript(keyword), keyword);
  // The cards and the end line are no assists: the enquiry still links the answers only.
  assert.deepEqual(assistIdsOf([q(), answered(1), handover(), { kind: "checkin" }, { kind: "ended", reason: "idle", ratingFor: id(1), rating: "open" }, q(), fallback(2)]), [id(1), id(2)]);
});
