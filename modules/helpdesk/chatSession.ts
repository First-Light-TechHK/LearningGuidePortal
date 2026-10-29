// Helpdesk v4 Part B (helpdesk-v4-order-and-chat-end.md, 2026-10-29): when the
// Portal chat hands over to a person or ends a long chat. These rules are
// code only; the model is never asked (GB/T 47746-2026: the human entry is
// visible, an explicit request for a person is transferred promptly, and the
// history goes with the handover, as the chat's assistIds).
// v5 (helpdesk-v5-context-chips-and-smalltalk.md Parts B §3 and D §4): small
// talk (hello, thanks, "I have a problem", off-topic) and an explanation of
// the card on screen (clarify) never count toward the 8-question check-in or
// the unsolved run; small talk neither breaks the run, while an explanation is
// an answered turn (it breaks the run unless voted down). A clarify the card
// does not cover counts as unsolved, like a turn with no answer. Small talk
// still counts as activity for the idle end.
// Client-safe: pure functions over the transcript (learnerUi ChatEntry), no
// Node APIs. A session is everything after the last "ended" line, so the next
// message after an end starts a new session with every counter at zero.
import type { ChatEntry } from "./learnerUi";

function deepFreeze<T extends object>(value: T): Readonly<T> {
  for (const child of Object.values(value)) if (child && typeof child === "object") deepFreeze(child as object);
  return Object.freeze(value);
}

/** Every constant of the chat end and handover rules, in one place. */
export const CHAT_SESSION_RULES = deepFreeze({
  /**
   * An explicit request for a person (spec Part B §1), Simplified and
   * Traditional Chinese and English, case-insensitive; English entries match
   * whole words (an "s" plural too), Chinese ones anywhere in the message.
   * Only Latin letters, digits and a hyphen join a word, so an English
   * keyword typed right next to Chinese ("我要human") matches, while a
   * hyphenated course topic ("human-computer interaction") does not.
   */
  humanKeywords: ["人工", "真人", "客服", "转人工", "轉人工", "投诉", "投訴", "human", "agent", "real person", "complaint", "speak to someone"] as string[],
  /**
   * Phrases taken out before matching, because on a learning platform they are
   * course topics, not a request for a person ("人工智能" is artificial
   * intelligence and contains 人工; "AI agent" contains agent). English ones
   * are cut as whole words like the keywords ("Thai agent" is no "AI agent").
   */
  humanKeywordExceptions: ["人工智能", "人工智慧", "ai agent"] as string[],
  /** Consecutive unsolved learner turns (no answer, or an answer marked not helpful) before the handover card. */
  unsolvedInARow: 2,
  /** After the reply to this many learner questions in one session, "Still need help?". */
  checkInAfterQuestions: 8,
  /** No learner input for this long after an AI answer ends the session. */
  idleMs: 10 * 60_000
});

export type ChatSessionRules = { humanKeywords: readonly string[]; humanKeywordExceptions: readonly string[]; unsolvedInARow: number; checkInAfterQuestions: number; idleMs: number };

const normalise = (text: string) => text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
const HAN = /[㐀-鿿豈-﫿]/;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** What joins an English word: Latin letters, digits and a hyphen (never a Han character, which is a letter too). */
const JOINER = "[\\p{Script=Latin}\\p{N}-]";

/** A whole-word pattern for an English keyword or exception (an "s" plural too); null for a Chinese one, matched anywhere. */
function wordPattern(word: string, flags: string): RegExp | null {
  if (HAN.test(word)) return null;
  return new RegExp(`(?<!${JOINER})${escape(word).replace(/ /g, "\\s+")}s?(?!${JOINER})`, `u${flags}`);
}

function matches(message: string, keyword: string): boolean {
  const word = normalise(keyword);
  if (!word) return false;
  return wordPattern(word, "")?.test(message) ?? message.includes(word);
}

/** True when a typed chat message asks for a person: then no AI answer is attempted and the handover card shows at once. */
export function isHumanRequest(message: string, rules: ChatSessionRules = CHAT_SESSION_RULES): boolean {
  let text = normalise(message);
  for (const phrase of rules.humanKeywordExceptions) {
    const cut = normalise(phrase);
    if (!cut) continue;
    const pattern = wordPattern(cut, "g");
    text = pattern ? text.replace(pattern, " ") : text.split(cut).join(" ");
  }
  return rules.humanKeywords.some((keyword) => matches(text, keyword));
}

/** The current session: the entries after the last end line. */
export function currentSession(entries: ChatEntry[]): ChatEntry[] {
  let start = 0;
  entries.forEach((entry, index) => { if (entry.kind === "ended") start = index + 1; });
  return entries.slice(start);
}

type AnswerEntry = Extract<ChatEntry, { kind: "answer" }>;

/** v5: a small-talk reply (no card). */
const isSmalltalk = (entry: AnswerEntry) => entry.turn?.kind === "smalltalk";
/** v5: an explanation of the card on screen; covered = the card said what the learner asked. */
const isClarify = (entry: AnswerEntry) => entry.turn?.kind === "clarify";
/** An answered turn: a card, or (v5) an explanation the card covered. */
const isAnswered = (entry: AnswerEntry) => (entry.reply !== null && !isSmalltalk(entry) && !isClarify(entry)) || (isClarify(entry) && entry.turn?.covered === true);

/**
 * Learner questions in the current session (typed, chips, and a request for a person alike), except (v5) the ones
 * answered with small talk or an explanation of the card on screen.
 */
export function sessionQuestions(entries: ChatEntry[]): number {
  const session = currentSession(entries);
  const asked = session.filter((entry) => entry.kind === "question").length;
  const notCounted = session.filter((entry) => entry.kind === "answer" && (isSmalltalk(entry) || isClarify(entry))).length;
  return Math.max(0, asked - notCounted);
}

/**
 * Unsolved learner turns in a row at the end of the current session: a reply
 * with no answer (the fallback; v5: or a clarify the card does not cover), an
 * answer (v5: or an explanation) marked not helpful, or a call that
 * failed or was rate limited (the error bubble: a turn with no answer too, and
 * the learner who most needs a person then). A handover card shown restarts
 * the count.
 */
export function unsolvedStreak(entries: ChatEntry[]): number {
  const session = currentSession(entries);
  let streak = 0;
  for (let index = session.length - 1; index >= 0; index -= 1) {
    const entry = session[index];
    if (entry.kind === "handover") break;
    if (entry.kind === "error") { streak += 1; continue; }
    if (entry.kind !== "answer") continue;
    // v5: small talk neither counts nor breaks the run.
    if (isSmalltalk(entry)) continue;
    if (isAnswered(entry) && entry.feedback !== "not_helpful") break;
    streak += 1;
  }
  return streak;
}

/**
 * The cards to add after the transcript changed (a reply came, or a vote was
 * stored): the handover card when the unsolved run is long enough; otherwise,
 * after the reply to the 8th question, "Still need help?" (once per session).
 * When both are due, the handover card alone offers the person, and the
 * check-in follows the next reply.
 */
export function cardsAfterChange(entries: ChatEntry[], rules: ChatSessionRules = CHAT_SESSION_RULES): ChatEntry[] {
  const session = currentSession(entries);
  const last = session[session.length - 1];
  if (!last) return [];
  if (unsolvedStreak(session) >= rules.unsolvedInARow) return [{ kind: "handover", reason: "unsolved" }];
  // v5: small talk and an explanation do not count, so the check-in waits for the reply to a counted question.
  if (last.kind === "answer" && !isSmalltalk(last) && !isClarify(last) && sessionQuestions(session) >= rules.checkInAfterQuestions && !session.some((entry) => entry.kind === "checkin")) return [{ kind: "checkin" }];
  return [];
}

/** The assist the end-of-session rating card rates: the newest answered one (not a fallback; v5: not small talk; an explanation the card covered counts) of this session, unless it was rated already. */
export function lastAnsweredAssist(entries: ChatEntry[]): string | null {
  const rated = new Set(entries.flatMap((entry) => (entry.kind === "ended" && entry.rating === "rated" && entry.ratingFor ? [entry.ratingFor] : [])));
  const session = currentSession(entries);
  for (let index = session.length - 1; index >= 0; index -= 1) {
    const entry = session[index];
    if (entry.kind === "answer" && isAnswered(entry)) return rated.has(entry.id) ? null : entry.id;
  }
  return null;
}

/** The end line of the current session (End chat or idle), with its rating card's assist. */
export function endSession(entries: ChatEntry[], reason: "idle" | "learner"): ChatEntry {
  return { kind: "ended", reason, ratingFor: lastAnsweredAssist(entries), rating: "open" };
}

/**
 * When the session ends for want of learner input (epoch ms), or null: only a
 * session with an AI answer has one. It is the idle time after the newest of
 * the shown times (questions and answers) and lastInputMs, the learner's last
 * input in the panel (typing, a vote, a card button; 0 when unknown).
 */
export function idleDeadline(entries: ChatEntry[], lastInputMs: number, rules: ChatSessionRules = CHAT_SESSION_RULES): number | null {
  const session = currentSession(entries);
  // v5: small talk alone does not arm the idle end, but its time counts as activity once an answer is there.
  if (!session.some((entry) => entry.kind === "answer" && !isSmalltalk(entry))) return null;
  let latest = lastInputMs;
  for (const entry of session) {
    if ((entry.kind === "question" || entry.kind === "answer") && entry.at) latest = Math.max(latest, Date.parse(entry.at));
  }
  return latest > 0 ? latest + rules.idleMs : null;
}
