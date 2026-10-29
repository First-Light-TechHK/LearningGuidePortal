"use client";
// AI Support Assistant chat panel, the right column of Contact Support (Figma
// 1216:6, tickets-v2-figma-addendum §4c). The learner asks a question (or taps
// a popular-FAQ chip); the server asks Admin, logs what was shown and returns
// the FAQ answer verbatim, or null for the fallback. The panel only renders
// what came back. The transcript lives in sessionStorage for this tab, per
// account, and its answer ids go with the enquiry as assistIds.
// v3 (helpdesk-v3-alternatives-rating §1): a fallback reply is followed by
// Admin's "You might be asking" questions as chips (the starter chip style;
// no Figma frame, 待视觉验收); a chip asks with its FAQ id like a starter chip.
// v4 Part B (helpdesk-v4-order-and-chat-end, 2026-10-29): code decides, never
// the model (rules in modules/helpdesk/chatSession.ts, CHAT_SESSION_RULES):
// a typed request for a person shows the handover card at once with no AI
// call; two unsolved turns in a row show it after the reply; the reply to the
// 8th question of a session is followed by "Still need help?" (End chat, or
// Contact a person); 10 minutes with no learner input after an AI answer end
// the session. An end shows "This chat has ended" and the v3 rating card for
// the session's last answered assist (or thanks); the next message starts a
// new session. The handover opens the enquiry form on this page, and the
// enquiry links the chat's assistIds, so the history goes with it. Typing and
// the form are never blocked. No Figma frame for these cards: they reuse the
// answer bubble, button and star styles and are 待视觉验收.
// v5 (helpdesk-v5-context-chips-and-smalltalk.md Parts A, B, C, D, H and
// helpdesk-v5-faq-graph-design.md §1, §4, 2026-10-29). Locked vs flexible: the
// panel never asks the model anything itself and never shows model text as
// Markdown; it renders what the server's turn says.
// - The greeting is personal ("{name}, hi! What's the problem?") and shows the
//   situation chips the server's code picked from the learner's own records
//   (the page starts the session; titled "You might be running into" when a
//   signal matched, else "Try asking"), plus the fixed card for an enquiry
//   waiting for the learner's reply.
// - An answer is one message in three parts: the opening line, the approved
//   FAQ text verbatim in a quoted card (only the blocks picked for this
//   learner, with "From: <question>", "Show the full answer" expanding in
//   place, "Open in Help Centre"), the closing line, then the follow-up chips
//   and the vote. Screen readers get them in that order.
// - A choice card shows its prompt and 2-4 A/B/C/D options; a click on a
//   chip, follow-up or option goes to the click endpoint, checked against the
//   release by the server (no model).
// - Small talk is a short reply line; hello / "I have a problem" is followed
//   by the situation chips, thanks / bye after an answer by the rating card.
// - An explanation of the card on screen says "Explained from <question>",
//   which shows that card again; one the card does not cover is the fixed
//   line and the handover card.
// None of these states has a Figma frame: they reuse the answer bubble, chip,
// button and star styles and are 待视觉验收 (the Part C polish too).
import { Bot, Check, ChevronDown, ChevronRight, ChevronUp, CircleHelp, Send, Star } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { AssistantNextStep, AssistantSessionResponse, AssistantTurn, ClickVia, LearnerEndReason } from "@/contracts/helpdesk";
import { cardsAfterChange, chatSessionId, currentSession, endSession, idleDeadline, isHumanRequest, ratingAfterFarewell } from "@/modules/helpdesk/chatSession";
import { assistIdsOf, chatStorageKey, fillTemplate, optionLetter, readTranscript, settleTranscript, storedTurn, type ChatEntry } from "@/modules/helpdesk/learnerUi";
import { plainText } from "@/modules/helpdesk/markdown";
import { alternativesIn, askAssistant, clickAssistant, endAssistantSession, newIdempotencyKey, rateAnswer, reportExpanded, sendAssistantFeedback, startAssistantSession } from "./helpdeskApi";
import type { HelpdeskCopy } from "./HelpdeskParts";
import { Markdown } from "./Markdown";

/** A starter or (v5) situation chip: an FAQ / entry node question; reason signal = it matched the learner's situation. */
export type ChatChip = { id: string; question: string; reason?: "signal" | "popular" };

/** v5: the chat session the page (or the chat, after an end) started, and its chips. */
type Situation = { sessionId: string | null; chips: ChatChip[]; situational: boolean; waitingTicket: { id: string; number: string } | null; releaseVersion: number | null };

type AnswerEntry = Extract<ChatEntry, { kind: "answer" }>;
/** What the learner asked: typed text, a chip (starter / situation / "You might be asking"), or a follow-up / option of the card it sits on. */
type Ask =
  | { kind: "typed"; message: string }
  | { kind: "chip"; message: string; nodeId: string; via: Extract<ClickVia, "starter" | "signal" | "alternative"> }
  | { kind: "step"; message: string; nodeId: string; via: Extract<ClickVia, "follow_up" | "option">; fromNodeId: string };

function readStored(key: string): ChatEntry[] {
  try { return readTranscript(window.sessionStorage.getItem(key)); } catch { return []; }
}

function store(key: string, entries: ChatEntry[]) {
  try { window.sessionStorage.setItem(key, JSON.stringify(entries)); } catch { /* storage full or blocked: the chat still works */ }
}

/** What the live region says after a reply that brought a card. */
function cardNotice(text: HelpdeskCopy["chat"], rateTitle: string, cards: ChatEntry[]): string {
  return cards.map((card) => (card.kind === "handover" ? text.handoverTitle : card.kind === "checkin" ? text.checkinTitle : card.kind === "rate" ? rateTitle : "")).filter(Boolean).join(" ");
}

/** v5: small talk that asks what the learner needs (hello, "I have a problem"): the situation chips follow it. */
const offersChips = (turn: AssistantTurn | undefined) => turn?.kind === "smalltalk" && (turn.intent === "greeting" || turn.intent === "vague" || turn.intent === null);

export function AssistantChat({ locale, copy, questionMax, accountId, chips, onIdeas, onAssistIds, onHandover, pageInput, name = null, session = null, orderId = null }: {
  locale: "en-GB" | "zh-CN"; copy: HelpdeskCopy; questionMax: number; accountId: string; chips: ChatChip[]; onIdeas: () => void; onAssistIds: (ids: string[]) => void;
  /** v4: open Contact Support (the form on this page) with the chat's assistIds. */ onHandover?: (assistIds: string[]) => void;
  /** v4: the learner's last input elsewhere on the page (epoch ms; the enquiry form after a handover): the learner is still here, so the chat does not end idle. */ pageInput?: { readonly current: number };
  /** v5 Part B §4: the learner's first name for the greeting (none: the greeting without a name). */ name?: string | null;
  /** v5 Part A: the chat session the page started, with its situation chips (none: an older server, or it could not start one; the chips prop is used). */ session?: AssistantSessionResponse | null;
  /** v5: the learner's own order Contact Support was opened for (the from_order signal of a new session after an end). */ orderId?: string | null;
}) {
  const text = copy.chat;
  const ids = useId();
  const storageKey = chatStorageKey(accountId);
  const [entries, setEntriesState] = useState<ChatEntry[]>([]);
  /** The transcript as last set, so a change computed after an await (a reply, a vote) builds on the newest one. */
  const latest = useRef<ChatEntry[]>([]);
  const setEntries = useCallback((next: ChatEntry[] | ((current: ChatEntry[]) => ChatEntry[])) => {
    latest.current = typeof next === "function" ? next(latest.current) : next;
    setEntriesState(latest.current);
  }, []);
  const [situation, setSituationState] = useState<Situation>(() => session
    ? { sessionId: session.sessionId, chips: session.chips, situational: session.situational, waitingTicket: session.waitingTicket, releaseVersion: session.releaseVersion }
    : { sessionId: null, chips, situational: false, waitingTicket: null, releaseVersion: null });
  const situationNow = useRef(situation);
  const setSituation = useCallback((next: Situation) => { situationNow.current = next; setSituationState(next); }, []);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [voting, setVoting] = useState<string | null>(null);
  const [voteError, setVoteError] = useState<string | null>(null);
  /** v5 Part H: the answers whose full text is open under the excerpt (by assist id); each is reported once. */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const reported = useRef(new Set<string>());
  /** v5 Part D: the explanations whose card is shown again (by transcript index). */
  const [reshown, setReshown] = useState<ReadonlySet<number>>(new Set());
  /** What the one live region says after the reply (the typing text while pending). Errors use role=alert. */
  const [announcement, setAnnouncement] = useState("");
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const shown = useRef({ count: 0, pending: false });
  const report = useRef(onAssistIds);
  report.current = onAssistIds;
  /** v4: the learner's last input in the panel (epoch ms: typing, a question, a vote, a card button); 0 while the shown times say enough. */
  const lastInput = useRef(0);
  /** v4: re-arms the idle timer when it fired early because the learner did something meanwhile. */
  const [idleCheck, setIdleCheck] = useState(0);
  /** v4: the end-of-session rating card being saved, or whose save failed (by transcript index). */
  const [rating, setRating] = useState<{ index: number; state: "saving" | "error" } | null>(null);
  const ratingRun = useRef(0);
  /** v4: the end line to move focus to after the next render (End chat, a rating saved or skipped). */
  const focusEnd = useRef<number | null>(null);
  const touched = () => { lastInput.current = Date.now(); };
  /** The newest learner input: in the panel, or on the page around it. */
  const inputAt = useCallback(() => Math.max(lastInput.current, pageInput?.current ?? 0), [pageInput]);
  /** A fresh announcement: cleared first, so the same words said again (asking for a person twice) are read out again. */
  const announceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const announce = useCallback((message: string) => {
    if (announceTimer.current) clearTimeout(announceTimer.current);
    setAnnouncement("");
    announceTimer.current = setTimeout(() => { announceTimer.current = null; setAnnouncement(message); }, 100);
  }, []);
  useEffect(() => () => { if (announceTimer.current) clearTimeout(announceTimer.current); }, []);

  // sessionStorage is read after mount, so the server render and the first client render match.
  // A chat left without learner input for the idle time while the page was away ends as it loads.
  useEffect(() => {
    let stored = settleTranscript(readStored(storageKey));
    const now = Date.now();
    const deadline = idleDeadline(stored, 0);
    if (deadline !== null && deadline <= now) stored = [...stored, endSession(stored, "idle")];
    // An older transcript has no times: count from now.
    lastInput.current = deadline === null ? now : 0;
    setEntries(stored);
    setLoaded(true);
  }, [storageKey, setEntries]);
  useEffect(() => {
    if (!loaded) return;
    store(storageKey, entries);
    report.current(assistIdsOf(entries));
  }, [entries, loaded, storageKey]);
  // Scroll only when something new appears: a question or the typing state shows the newest line;
  // an answer taller than the panel opens at its start, also when a v4 card came with it (what
  // was added, from its first entry to its last, is what must fit). A vote never scrolls to an answer.
  useLayoutEffect(() => {
    const node = log.current;
    const before = shown.current;
    shown.current = { count: entries.length, pending };
    if (!node || !entries.length) return;
    const grew = entries.length > before.count;
    if (!grew && !(pending && !before.pending)) return;
    const added = entries.slice(before.count);
    const first = node.querySelector<HTMLElement>(`[data-entry="${before.count}"]`);
    const last = node.querySelector<HTMLElement>(`[data-entry="${entries.length - 1}"]`);
    if (grew && before.count > 0 && !added.some((entry) => entry.kind === "question") && first && last && last.getBoundingClientRect().bottom - first.getBoundingClientRect().top > node.clientHeight - 26) {
      node.scrollTop += first.getBoundingClientRect().top - node.getBoundingClientRect().top - 13;
      return;
    }
    node.scrollTop = node.scrollHeight;
  }, [entries, pending]);
  // v4: after End chat the rating card (or the thanks) takes focus so it is read out; after a rating is saved or skipped, the end line keeps it.
  // v5: a rating card after thanks that was skipped is gone, so focus goes back to the input.
  useEffect(() => {
    const index = focusEnd.current;
    if (index === null) return;
    focusEnd.current = null;
    const line = log.current?.querySelector<HTMLElement>(`[data-entry="${index}"] .helpdesk-chat-ended-card, [data-entry="${index}"] .helpdesk-chat-rate-card`);
    (line?.querySelector<HTMLElement>(".helpdesk-chat-rating") ?? line ?? input.current)?.focus();
  }, [entries]);

  /** v5: the session the next turn belongs to (the newest turn's, else the one the page or chat started). */
  const sessionId = () => chatSessionId(latest.current, situationNow.current.sessionId);

  /**
   * v5: tells the server the session ended (the first end wins there) and starts the next one, whose chips replace
   * the greeting's. Only a chat with a v5 session does this; a failure keeps the chips and lets the server start one.
   */
  const nextSession = useCallback((ending: string | null, reason: LearnerEndReason) => {
    if (!ending && !situationNow.current.sessionId) return;
    if (ending) endAssistantSession(ending, reason);
    const asked = situationNow.current;
    setSituation({ ...asked, sessionId: null });
    void startAssistantSession(orderId ? { locale, orderId } : { locale }).then((result) => {
      if (situationNow.current.sessionId !== null || !result.ok || !result.data?.sessionId) return;
      const started = result.data;
      setSituation({ sessionId: started.sessionId, chips: Array.isArray(started.chips) ? started.chips : asked.chips, situational: started.situational === true, waitingTicket: started.waitingTicket ?? null, releaseVersion: started.releaseVersion ?? null });
    });
  }, [locale, orderId, setSituation]);

  /** v4: ends the current session (End chat, or idle); nothing to end when the session is empty. */
  const endChat = useCallback((reason: "idle" | "learner") => {
    const current = latest.current;
    if (!currentSession(current).length) return;
    const ending = chatSessionId(current, situationNow.current.sessionId);
    const end = endSession(current, reason);
    if (reason === "learner") focusEnd.current = current.length;
    setEntries([...current, end]);
    nextSession(ending, reason === "idle" ? "idle" : "ended_by_learner");
    // End chat moves focus to the rating card (read out with its title) or to the thanks; an idle end leaves focus alone and is announced.
    const rates = end.kind === "ended" && end.ratingFor !== null;
    announce(reason === "idle" ? (rates ? `${text.ended} ${copy.assistant.rateTitle}` : text.ended) : rates ? text.ended : "");
  }, [announce, copy.assistant.rateTitle, nextSession, setEntries, text.ended]);

  // v4: the idle end. Armed while a session with an AI answer waits for the learner; input meanwhile moves the deadline.
  useEffect(() => {
    if (!loaded || pending) return;
    const deadline = idleDeadline(entries, inputAt());
    if (deadline === null) return;
    const timer = setTimeout(() => {
      const due = idleDeadline(latest.current, inputAt());
      if (due !== null && Date.now() < due) setIdleCheck((value) => value + 1);
      else if (due !== null) endChat("idle");
    }, Math.max(0, deadline - Date.now()));
    return () => clearTimeout(timer);
  }, [entries, pending, loaded, idleCheck, endChat, inputAt]);

  function handOver() {
    touched();
    // v5: the session ends as a handover (the server keeps the first end); the chat itself goes on.
    const ending = sessionId();
    if (ending) endAssistantSession(ending, "handover");
    onHandover?.(assistIdsOf(latest.current));
  }

  /** v5: the release the chat's chips belong to: the newest turn's, else the session's (null: Admin has none; chips go the per-FAQ way). */
  function releaseKnown(): boolean {
    for (const entry of [...currentSession(latest.current)].reverse()) if (entry.kind === "answer" && entry.turn) return entry.turn.releaseVersion !== null;
    return situationNow.current.releaseVersion !== null;
  }

  /** What the live region says for a reply, in the order it is shown (opening, card, closing, next steps). */
  function spoken(entry: AnswerEntry): string {
    const turn = entry.turn;
    const steps = (title: string, list: Array<{ label: string }>) => (list.length ? `${title} ${list.map((item) => item.label).join("; ")}` : "");
    if (turn?.kind === "smalltalk") return [turn.reply ?? "", offersChips(turn) ? steps(situationNow.current.situational ? text.situationTitle : text.tryAsking, situationNow.current.chips.map((chip) => ({ label: chip.question }))) : ""].filter(Boolean).join(" ");
    if (turn?.kind === "clarify") return turn.covered === true && turn.explanation ? turn.explanation : text.clarifyNotCovered;
    if (entry.reply && turn?.kind === "answer") {
      if (turn.nodeType === "choice") return [plainText(entry.reply.answer), turn.next ? turn.next.steps.map((step, index) => `${optionLetter(index)}. ${step.label}`).join("; ") : ""].filter(Boolean).join(" ");
      const body = turn.excerpt ? turn.excerpt.map((block) => plainText(block.text)).join(" ") : plainText(entry.reply.answer);
      return [turn.opening ?? "", body, turn.closing ?? "", turn.next?.kind === "follow_up" ? steps(text.followUpsTitle, turn.next.steps) : ""].filter(Boolean).join(" ");
    }
    if (entry.reply) return plainText(entry.reply.answer);
    const alternatives = entry.alternatives ?? [];
    return alternatives.length ? `${text.fallbackAlternatives} ${text.alternativesTitle} ${alternatives.map((item) => item.question).join("; ")}` : text.fallback;
  }

  async function ask(request: Ask): Promise<boolean> {
    const message = request.message;
    if (pending || !message.trim()) return false;
    touched();
    const question: ChatEntry = { kind: "question", text: message, at: new Date().toISOString() };
    // v4 §1: a typed request for a person is handed over at once; no AI answer is attempted. (A chip is the FAQ's own question.)
    if (request.kind === "typed" && isHumanRequest(message)) {
      setEntries((current) => [...current, question, { kind: "handover", reason: "requested" }]);
      announce(`${text.handoverTitle} ${text.handoverBody}`);
      return true;
    }
    setPending(true);
    if (announceTimer.current) clearTimeout(announceTimer.current);
    setAnnouncement("");
    const session = sessionId();
    const viaRelease = request.kind === "step" || (request.kind === "chip" && request.via !== "alternative" && releaseKnown());
    setEntries((current) => [...current, question]);
    const key = newIdempotencyKey();
    // Clicks on the release never ask the model (the server checks the edge); typed text and the per-FAQ chips go to the assistant.
    // Before v5 (no session known) a chip is sent exactly as v3 sent it.
    const result = viaRelease
      ? await clickAssistant({ locale, nodeId: request.nodeId, fromNodeId: request.kind === "step" ? request.fromNodeId : null, via: request.via, sessionId: session, label: message }, key)
      : await askAssistant({ message, locale, ...(request.kind === "typed" ? {} : { faqId: request.nodeId }), ...(session ? { sessionId: session, ...(request.kind === "chip" ? { via: request.via } : {}) } : {}) }, key);
    setPending(false);
    if (result.ok && result.data) {
      const { id, reply } = result.data;
      const turn = storedTurn(result.data.turn);
      const alternatives = reply ? [] : alternativesIn(result.data.alternatives);
      const at = new Date().toISOString();
      const entry: AnswerEntry = { kind: "answer", id, reply, feedback: null, ...(alternatives.length ? { alternatives } : {}), at, ...(turn ? { turn } : {}) };
      const next = [...latest.current, entry];
      // v4 §2 and §3: the handover card after the second unsolved turn in a row, or "Still need help?" after the 8th reply.
      // v5 Part D: an explanation the card does not cover hands over at once; Part B: thanks after an answer asks for a rating.
      let cards = cardsAfterChange(next);
      if (turn?.kind === "clarify" && turn.covered !== true) cards = [{ kind: "handover", reason: "unsolved" }];
      const rate = ratingAfterFarewell(next);
      if (rate) cards = [...cards, rate];
      setEntries([...next, ...cards]);
      const said = spoken(entry);
      if (announceTimer.current) clearTimeout(announceTimer.current);
      setAnnouncement(cards.length ? `${said} ${cardNotice(text, copy.assistant.rateTitle, cards)}` : said);
      return true;
    }
    // v4 §2: a failed call is a turn with no answer too; the second unsolved turn in a row offers a person.
    const failed = [...latest.current, { kind: "error" as const, error: result.status === 429 ? "rateLimited" as const : "error" as const }];
    const cards = cardsAfterChange(failed);
    setEntries([...failed, ...cards]);
    if (cards.length) announce(cardNotice(text, copy.assistant.rateTitle, cards));
    return false;
  }

  async function sendDraft() {
    const message = draft.trim();
    if (!message || pending) return;
    setDraft("");
    // Not answered (network, 429, timeout): give the question back unless the learner already typed something else.
    if (!(await ask({ kind: "typed", message }))) setDraft((current) => (current === "" ? message : current));
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Safari confirms an IME candidate with a keydown whose isComposing is already false but keyCode is 229.
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    void sendDraft();
  }

  async function vote(id: string, helpful: boolean) {
    if (voting) return;
    touched();
    setVoting(id);
    setVoteError(null);
    const result = await sendAssistantFeedback(id, helpful, newIdempotencyKey());
    setVoting(null);
    // The server keeps the first value; show what it stored.
    if (result.ok && result.data && (result.data.feedback === "helpful" || result.data.feedback === "not_helpful")) {
      const stored = result.data.feedback;
      const next = latest.current.map((entry) => (entry.kind === "answer" && entry.id === id ? { ...entry, feedback: stored } : entry));
      // v4 §2: a No on the newest answer can complete an unsolved pair. With a question still waiting
      // for its reply, the card goes after the voted turns and before that question.
      const waiting = next.length && next[next.length - 1].kind === "question" ? next.slice(-1) : [];
      const settled = next.slice(0, next.length - waiting.length);
      const cards = cardsAfterChange(settled);
      setEntries([...settled, ...cards, ...waiting]);
      if (cards.length) announce(cardNotice(text, copy.assistant.rateTitle, cards));
    } else setVoteError(id);
  }

  /** v4: the end-of-session rating card (v5: and the one after thanks), the v3 endpoint (the first rating wins; 409 counts as rated). */
  async function rate(index: number, assistId: string, stars: number) {
    if (rating?.state === "saving") return;
    touched();
    const run = ++ratingRun.current;
    setRating({ index, state: "saving" });
    const result = await rateAnswer(assistId, stars, newIdempotencyKey());
    if (run !== ratingRun.current) return;
    if (result.ok || result.status === 409) {
      setRating(null);
      focusEnd.current = index;
      // Focus moves to the end line, which now reads the thanks.
      setEntries((current) => current.map((entry, position) => (position === index && (entry.kind === "ended" || entry.kind === "rate") ? { ...entry, rating: "rated" } : entry)));
      return;
    }
    setRating({ index, state: "error" });
  }

  /** Skip is never blocked, not even by a save in flight; it stores nothing. */
  function skipRating(index: number) {
    touched();
    ratingRun.current += 1;
    setRating(null);
    focusEnd.current = index;
    setEntries((current) => current.map((entry, position) => (position === index && (entry.kind === "ended" || entry.kind === "rate") ? { ...entry, rating: "skipped" } : entry)));
  }

  /** v5 Part H: "Show the full answer" opens the whole card in place (and Show less closes it); the first open is reported. */
  function toggleFull(entry: AnswerEntry) {
    touched();
    const open = expanded.has(entry.id);
    const next = new Set(expanded);
    if (open) next.delete(entry.id); else next.add(entry.id);
    setExpanded(next);
    if (!open && entry.turn && !reported.current.has(entry.id)) {
      reported.current.add(entry.id);
      reportExpanded(entry.id);
    }
  }

  function toggleReshown(index: number) {
    touched();
    const next = new Set(reshown);
    if (next.has(index)) next.delete(index); else next.add(index);
    setReshown(next);
  }

  /** Where the current session starts: cards before it belong to an ended session. */
  const sessionStart = entries.reduce((start, entry, index) => (entry.kind === "ended" ? index + 1 : start), 0);
  const chipTitle = situation.situational ? text.situationTitle : text.tryAsking;
  const greetingTitle = name ? fillTemplate(text.greetingTitleNamed, { name }) : text.greetingTitle;

  /** A list of chip buttons (situation chips, "You might be asking", follow-ups): the starter chip style. */
  const chipButtons = (items: Array<{ key: string; label: string; onClick: () => void }>, props: { className?: string; labelledBy?: string }) =>
    <ul className={`helpdesk-chat-chips${props.className ? ` ${props.className}` : ""}`} aria-labelledby={props.labelledBy}>
      {items.map((item) => <li key={item.key}><button type="button" className="helpdesk-chat-chip" title={item.label} disabled={pending} onClick={item.onClick}><span>{item.label}</span><ChevronRight size={14} aria-hidden="true" /></button></li>)}
    </ul>;
  const situationChips = (list: ChatChip[], className: string | undefined, labelledBy: string) =>
    chipButtons(list.map((chip) => ({ key: chip.id, label: chip.question, onClick: () => void ask({ kind: "chip", message: chip.question, nodeId: chip.id, via: chip.reason === "signal" ? "signal" : "starter" }) })), { className, labelledBy });

  const row = (index: number, body: ReactNode) => <div key={index} data-entry={index} className="helpdesk-chat-row"><span className="helpdesk-chat-avatar" aria-hidden="true"><Bot size={18} /></span>{body}</div>;

  const voteRow = (entry: AnswerEntry) => <>
    <div className="helpdesk-chat-feedback">
      <span>{text.helpful}</span>
      <button type="button" className="helpdesk-chat-vote helpdesk-chat-vote-yes" aria-pressed={entry.feedback === "helpful"} disabled={entry.feedback !== null || voting !== null} onClick={() => void vote(entry.id, true)}><Check size={13} aria-hidden="true" />{text.yes}</button>
      <button type="button" className="helpdesk-chat-vote helpdesk-chat-vote-no" aria-pressed={entry.feedback === "not_helpful"} disabled={entry.feedback !== null || voting !== null} onClick={() => void vote(entry.id, false)}>{text.no}</button>
    </div>
    {voteError === entry.id && entry.feedback === null ? <p className="helpdesk-chat-vote-error" role="alert">{text.voteError}</p> : null}
  </>;

  const helpLink = (faqId: string, label: string) => <a className="helpdesk-chat-related" href={`/${locale}/help?faq=${encodeURIComponent(faqId)}`} target="_blank" rel="noopener noreferrer">{label}</a>;

  /** v5 Part H: the quoted FAQ card: the excerpt (or the whole answer) verbatim, its source, "Show the full answer" and the Help Centre link. */
  const quotedCard = (entry: AnswerEntry, index: number, reply: NonNullable<AnswerEntry["reply"]>, excerpt: AssistantTurn["excerpt"]) => {
    const open = expanded.has(entry.id);
    const textId = `${ids}-card-text-${index}`;
    return <blockquote className="helpdesk-chat-excerpt">
      <Markdown className="helpdesk-chat-answer-text" id={textId} text={excerpt && !open ? excerpt.map((block) => block.text).join("\n\n") : reply.answer} />
      <p className="helpdesk-chat-source">{fillTemplate(text.excerptSource, { question: reply.question })}</p>
      <div className="helpdesk-chat-excerpt-actions">
        {excerpt ? <button type="button" className="helpdesk-chat-expand" aria-expanded={open} aria-controls={textId} onClick={() => toggleFull(entry)}>{open ? text.showLess : text.showFull}{open ? <ChevronUp size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}</button> : null}
        {helpLink(reply.faqId, text.openInHelpCentre)}
      </div>
    </blockquote>;
  };

  const stepButtons = (entry: AnswerEntry, index: number, turn: AssistantTurn, steps: AssistantNextStep[]) => {
    const from = turn.nodeId ?? entry.reply?.faqId ?? "";
    if (turn.next?.kind === "option") {
      // A/B/C/D: the starter chip style with a letter; the prompt names the group.
      return <ul className="helpdesk-chat-chips helpdesk-chat-alternatives helpdesk-chat-options" aria-labelledby={`${ids}-prompt-${index}`}>
        {steps.map((step, position) => <li key={step.nodeId}><button type="button" className="helpdesk-chat-chip helpdesk-chat-option" title={step.label} disabled={pending} onClick={() => void ask({ kind: "step", message: step.label, nodeId: step.nodeId, via: "option", fromNodeId: from })}>
          <span className="helpdesk-chat-option-letter" aria-hidden="true">{optionLetter(position)}</span><span>{step.label}</span><ChevronRight size={14} aria-hidden="true" />
        </button></li>)}
      </ul>;
    }
    return <>
      <p className="helpdesk-chat-try" id={`${ids}-next-${index}`}>{text.followUpsTitle}</p>
      {chipButtons(steps.map((step) => ({ key: step.nodeId, label: step.label, onClick: () => void ask({ kind: "step", message: step.label, nodeId: step.nodeId, via: "follow_up", fromNodeId: from }) })), { className: "helpdesk-chat-alternatives helpdesk-chat-followups", labelledBy: `${ids}-next-${index}` })}
    </>;
  };

  /** The card an explanation is about: the newest answer before it that showed that FAQ. */
  const explainedCard = (index: number, faqId: string) => {
    for (let position = index - 1; position >= 0; position -= 1) {
      const entry = entries[position];
      if (entry.kind === "answer" && entry.reply && entry.reply.faqId.toLowerCase() === faqId.toLowerCase()) return entry.reply;
    }
    return null;
  };

  const answerBubble = (entry: AnswerEntry, index: number) => {
    const turn = entry.turn;
    // v5 Part B: small talk, a short plain line (never Markdown); hello / "I have a problem" brings the situation chips.
    if (turn?.kind === "smalltalk") return <div className="helpdesk-chat-answer helpdesk-chat-smalltalk">
      <p className="helpdesk-chat-reply">{turn.reply}</p>
      {offersChips(turn) && situation.chips.length ? <>
        <p className="helpdesk-chat-try" id={`${ids}-again-${index}`}>{chipTitle}</p>
        {situationChips(situation.chips, "helpdesk-chat-alternatives", `${ids}-again-${index}`)}
      </> : null}
    </div>;
    // v5 Part D: the explanation of the card on screen, or (not covered) the fixed line; the handover card follows that.
    if (turn?.kind === "clarify") {
      if (turn.covered !== true || !turn.explanation) return <div className="helpdesk-chat-answer helpdesk-chat-clarify"><p className="helpdesk-chat-reply">{text.clarifyNotCovered}</p></div>;
      const source = turn.source;
      const card = source ? explainedCard(index, source.faqId) : null;
      const open = reshown.has(index);
      return <div className="helpdesk-chat-answer helpdesk-chat-clarify">
        <p className="helpdesk-chat-reply">{turn.explanation}</p>
        {source ? card
          ? <button type="button" className="helpdesk-chat-expand helpdesk-chat-explained" aria-expanded={open} aria-controls={`${ids}-explained-${index}`} onClick={() => toggleReshown(index)}>{fillTemplate(text.clarifySource, { question: source.question })}{open ? <ChevronUp size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}</button>
          : helpLink(source.faqId, fillTemplate(text.clarifySource, { question: source.question })) : null}
        {card && open ? <blockquote className="helpdesk-chat-excerpt" id={`${ids}-explained-${index}`}>
          <Markdown className="helpdesk-chat-answer-text" text={card.answer} />
          <p className="helpdesk-chat-source">{fillTemplate(text.excerptSource, { question: card.question })}</p>
        </blockquote> : null}
        {voteRow(entry)}
      </div>;
    }
    const reply = entry.reply;
    // v5 Part H and graph design §1: the three-part answer, or a choice card.
    if (reply && turn?.kind === "answer") {
      const steps = turn.next?.steps ?? [];
      if (turn.nodeType === "choice") return <div className="helpdesk-chat-answer helpdesk-chat-choice">
        <div id={`${ids}-prompt-${index}`}><Markdown className="helpdesk-chat-answer-text helpdesk-chat-choice-prompt" text={reply.answer} /></div>
        {steps.length ? stepButtons(entry, index, turn, steps) : null}
      </div>;
      return <div className="helpdesk-chat-answer helpdesk-chat-three-part">
        {turn.opening ? <p className="helpdesk-chat-opening">{turn.opening}</p> : null}
        {quotedCard(entry, index, reply, turn.excerpt)}
        {turn.closing ? <p className="helpdesk-chat-closing">{turn.closing}</p> : null}
        {steps.length ? stepButtons(entry, index, turn, steps) : null}
        {voteRow(entry)}
      </div>;
    }
    return <div className="helpdesk-chat-answer">
      {reply ? <>
        <Markdown className="helpdesk-chat-answer-text" text={reply.answer} />
        {helpLink(reply.faqId, fillTemplate(text.relatedFaq, { question: reply.question }))}
        {voteRow(entry)}
      </> : <>
        <p className="helpdesk-chat-fallback">{entry.alternatives?.length ? text.fallbackAlternatives : text.fallback}</p>
        {/* v3 alternatives under the fallback: no Figma frame, 待视觉验收 (reuses .helpdesk-chat-try / .helpdesk-chat-chip). */}
        {entry.alternatives?.length ? <>
          <p className="helpdesk-chat-try" id={`${ids}-alternatives-${index}`}>{text.alternativesTitle}</p>
          {chipButtons(entry.alternatives.map((item) => ({ key: item.faqId, label: item.question, onClick: () => void ask({ kind: "chip", message: item.question, nodeId: item.faqId, via: "alternative" }) })), { className: "helpdesk-chat-alternatives", labelledBy: `${ids}-alternatives-${index}` })}
        </> : null}
      </>}
    </div>;
  };

  const ratingCard = (index: number, ratingFor: string) => {
    const busy = rating?.index === index ? rating.state : null;
    return <section className="helpdesk-rating helpdesk-chat-rating" role="group" aria-labelledby={`${ids}-rate-${index}`} tabIndex={-1}>
      <h3 id={`${ids}-rate-${index}`}>{copy.assistant.rateTitle}</h3>
      <div className="helpdesk-stars">{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" disabled={busy === "saving"} aria-label={fillTemplate(copy.assistant.rateStar, { n })} onClick={() => void rate(index, ratingFor, n)}><Star size={20} aria-hidden="true" /></button>)}</div>
      {busy === "error" ? <p role="alert" className="helpdesk-inline-error">{copy.assistant.rateError}</p> : null}
      {/* Skip stays enabled while a star is saving: the card never traps the learner. */}
      <button type="button" className="helpdesk-secondary-button" onClick={() => skipRating(index)}>{copy.assistant.skip}</button>
    </section>;
  };

  return <section className="helpdesk-chat" aria-labelledby={`${ids}-title`}>
    <header className="helpdesk-chat-header">
      <h2 id={`${ids}-title`}>{text.title}</h2>
      <p>{text.subtitle}</p>
    </header>
    <div className="helpdesk-chat-divider" aria-hidden="true" />
    <div className="helpdesk-chat-messages" ref={log} aria-busy={!loaded}>
      <div className="helpdesk-chat-row">
        <span className="helpdesk-chat-avatar" aria-hidden="true"><Bot size={18} /></span>
        <div className="helpdesk-chat-greeting">
          <p className="helpdesk-chat-greeting-title">{greetingTitle}</p>
          <p className="helpdesk-chat-greeting-body">{text.greetingBody}</p>
          <p className="helpdesk-chat-greeting-limit">{text.greetingLimit}</p>
          <button type="button" className="helpdesk-chat-ideas" onClick={onIdeas}>{text.ideas}</button>
        </div>
      </div>
      {/* v5 Part A: the fixed card for an enquiry waiting for the learner's reply (no Figma frame, 待视觉验收). */}
      {situation.waitingTicket ? <div className="helpdesk-chat-row helpdesk-chat-waiting-row">
        <span className="helpdesk-chat-avatar" aria-hidden="true"><Bot size={18} /></span>
        <section className="helpdesk-chat-card helpdesk-chat-waiting" role="group" aria-labelledby={`${ids}-waiting`}>
          <p className="helpdesk-chat-card-title" id={`${ids}-waiting`}>{text.waitingTitle}</p>
          <a className="helpdesk-chat-related" href={`/${locale}/account/my-learning/support/${encodeURIComponent(situation.waitingTicket.id)}`}>{text.waitingLink}</a>
        </section>
      </div> : null}
      {situation.chips.length ? <>
        <p className="helpdesk-chat-try" id={`${ids}-chips`}>{chipTitle}</p>
        {situationChips(situation.chips, undefined, `${ids}-chips`)}
      </> : null}
      {entries.map((entry, index) => {
        if (entry.kind === "question") return <div key={index} data-entry={index} className="helpdesk-chat-mine"><p className="helpdesk-chat-question">{entry.text}</p></div>;
        // v4 Part B cards: no Figma frame, 待视觉验收 (the answer bubble, .helpdesk-submit-button / .helpdesk-secondary-button, the v3 stars).
        if (entry.kind === "handover") return row(index, <section className="helpdesk-chat-card helpdesk-chat-card-handover" role="group" aria-labelledby={`${ids}-card-${index}`}>
          <p className="helpdesk-chat-card-title" id={`${ids}-card-${index}`}>{text.handoverTitle}</p>
          <p className="helpdesk-chat-card-text">{text.handoverBody}</p>
          <div className="helpdesk-chat-card-actions"><button type="button" className="helpdesk-submit-button" onClick={handOver}>{text.handoverButton}</button></div>
        </section>);
        if (entry.kind === "checkin") return row(index, <section className="helpdesk-chat-card helpdesk-chat-card-checkin" role="group" aria-labelledby={`${ids}-card-${index}`}>
          <p className="helpdesk-chat-card-title" id={`${ids}-card-${index}`}>{text.checkinTitle}</p>
          <div className="helpdesk-chat-card-actions">
            {/* Only the open session can be ended; the way to a person stays on every card. */}
            {index >= sessionStart ? <button type="button" className="helpdesk-secondary-button" disabled={pending} onClick={() => endChat("learner")}>{text.endChat}</button> : null}
            <button type="button" className="helpdesk-submit-button" onClick={handOver}>{text.contactPerson}</button>
          </div>
        </section>);
        if (entry.kind === "ended") return row(index, <div className="helpdesk-chat-card helpdesk-chat-ended-card" tabIndex={-1}>
          <p className="helpdesk-chat-ended">{text.ended}</p>
          {entry.ratingFor && entry.rating === "open" ? ratingCard(index, entry.ratingFor)
            : entry.rating === "rated" ? <p className="helpdesk-chat-card-text helpdesk-chat-rated">{copy.assistant.rated}</p>
              : entry.reason === "learner" && !entry.ratingFor ? <p className="helpdesk-chat-card-text">{text.endThanks}</p> : null}
        </div>);
        // v5 Part B §3: the rating card after thanks / bye (no end line: the session goes on). Skipped: nothing is left.
        if (entry.kind === "rate") return entry.rating === "skipped" ? null : row(index, <div className="helpdesk-chat-card helpdesk-chat-rate-card" tabIndex={-1}>
          {entry.rating === "open" ? ratingCard(index, entry.ratingFor) : <p className="helpdesk-chat-card-text helpdesk-chat-rated">{copy.assistant.rated}</p>}
        </div>);
        if (entry.kind === "error") return row(index, <p className="helpdesk-chat-error" role="alert">{entry.error === "rateLimited" ? text.rateLimited : text.error}</p>);
        return row(index, answerBubble(entry, index));
      })}
      {pending ? <div className="helpdesk-chat-row"><span className="helpdesk-chat-avatar" aria-hidden="true"><Bot size={18} /></span><div className="helpdesk-chat-typing"><span aria-hidden="true" /><span aria-hidden="true" /><span aria-hidden="true" /></div></div> : null}
      <div className="helpdesk-chat-info"><CircleHelp size={19} aria-hidden="true" /><p><span className="helpdesk-chat-info-side">{text.info}</span><span className="helpdesk-chat-info-stacked">{text.infoStacked}</span></p></div>
    </div>
    {/* Always mounted, so screen readers announce what is put in it: the typing state, then the answer or the fallback. */}
    <p className="helpdesk-visually-hidden helpdesk-chat-live" role="status" aria-live="polite">{pending ? text.typing : announcement}</p>
    {/* v5 Part C: the send button sits inside the input box (待视觉验收). */}
    <div className="helpdesk-chat-footer">
      <textarea ref={input} className="helpdesk-chat-input" aria-label={text.inputLabel} placeholder={text.placeholder} maxLength={questionMax} value={draft} onChange={(event) => { touched(); setDraft(event.target.value); }} onKeyDown={onKeyDown} />
      <button type="button" className="helpdesk-chat-send" aria-label={text.send} disabled={pending || !draft.trim()} onClick={() => void sendDraft()}><Send size={19} aria-hidden="true" /></button>
    </div>
  </section>;
}
