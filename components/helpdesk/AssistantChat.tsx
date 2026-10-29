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
import { Bot, Check, ChevronRight, CircleHelp, Send, Star } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { cardsAfterChange, currentSession, endSession, idleDeadline, isHumanRequest } from "@/modules/helpdesk/chatSession";
import { assistIdsOf, chatStorageKey, fillTemplate, readTranscript, settleTranscript, type ChatEntry } from "@/modules/helpdesk/learnerUi";
import { plainText } from "@/modules/helpdesk/markdown";
import { alternativesIn, askAssistant, newIdempotencyKey, rateAnswer, sendAssistantFeedback } from "./helpdeskApi";
import type { HelpdeskCopy } from "./HelpdeskParts";
import { Markdown } from "./Markdown";

export type ChatChip = { id: string; question: string };

function readStored(key: string): ChatEntry[] {
  try { return readTranscript(window.sessionStorage.getItem(key)); } catch { return []; }
}

function store(key: string, entries: ChatEntry[]) {
  try { window.sessionStorage.setItem(key, JSON.stringify(entries)); } catch { /* storage full or blocked: the chat still works */ }
}

/** What the live region says after a reply that brought a card. */
function cardNotice(text: HelpdeskCopy["chat"], cards: ChatEntry[]): string {
  return cards.map((card) => (card.kind === "handover" ? text.handoverTitle : card.kind === "checkin" ? text.checkinTitle : "")).filter(Boolean).join(" ");
}

export function AssistantChat({ locale, copy, questionMax, accountId, chips, onIdeas, onAssistIds, onHandover }: { locale: "en-GB" | "zh-CN"; copy: HelpdeskCopy; questionMax: number; accountId: string; chips: ChatChip[]; onIdeas: () => void; onAssistIds: (ids: string[]) => void; /** v4: open Contact Support (the form on this page) with the chat's assistIds. */ onHandover?: (assistIds: string[]) => void }) {
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
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [voting, setVoting] = useState<string | null>(null);
  const [voteError, setVoteError] = useState<string | null>(null);
  /** What the one live region says after the reply (the typing text while pending). Errors use role=alert. */
  const [announcement, setAnnouncement] = useState("");
  const log = useRef<HTMLDivElement>(null);
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
  // an answer taller than the panel opens at its start. A vote (same entries, updated) never scrolls.
  useLayoutEffect(() => {
    const node = log.current;
    const before = shown.current;
    shown.current = { count: entries.length, pending };
    if (!node || !entries.length) return;
    const grew = entries.length > before.count;
    if (!grew && !(pending && !before.pending)) return;
    const last = entries[entries.length - 1];
    const element = node.querySelector<HTMLElement>(`[data-entry="${entries.length - 1}"]`);
    if (grew && before.count > 0 && last.kind !== "question" && element && element.offsetHeight > node.clientHeight - 26) {
      node.scrollTop += element.getBoundingClientRect().top - node.getBoundingClientRect().top - 13;
      return;
    }
    node.scrollTop = node.scrollHeight;
  }, [entries, pending]);
  // v4: after End chat the rating card (or the thanks) takes focus so it is read out; after a rating is saved or skipped, the end line keeps it.
  useEffect(() => {
    const index = focusEnd.current;
    if (index === null) return;
    focusEnd.current = null;
    const line = log.current?.querySelector<HTMLElement>(`[data-entry="${index}"] .helpdesk-chat-ended-card`);
    (line?.querySelector<HTMLElement>(".helpdesk-chat-rating") ?? line)?.focus();
  }, [entries]);

  /** v4: ends the current session (End chat, or idle); nothing to end when the session is empty. */
  const endChat = useCallback((reason: "idle" | "learner") => {
    const current = latest.current;
    if (!currentSession(current).length) return;
    const end = endSession(current, reason);
    if (reason === "learner") focusEnd.current = current.length;
    setEntries([...current, end]);
    // End chat moves focus to the rating card (read out with its title) or to the thanks; an idle end leaves focus alone and is announced.
    const rates = end.kind === "ended" && end.ratingFor !== null;
    setAnnouncement(reason === "idle" ? (rates ? `${text.ended} ${copy.assistant.rateTitle}` : text.ended) : rates ? text.ended : "");
  }, [copy.assistant.rateTitle, setEntries, text.ended]);

  // v4: the idle end. Armed while a session with an AI answer waits for the learner; input meanwhile moves the deadline.
  useEffect(() => {
    if (!loaded || pending) return;
    const deadline = idleDeadline(entries, lastInput.current);
    if (deadline === null) return;
    const timer = setTimeout(() => {
      const due = idleDeadline(latest.current, lastInput.current);
      if (due !== null && Date.now() < due) setIdleCheck((value) => value + 1);
      else if (due !== null) endChat("idle");
    }, Math.max(0, deadline - Date.now()));
    return () => clearTimeout(timer);
  }, [entries, pending, loaded, idleCheck, endChat]);

  function handOver() {
    touched();
    onHandover?.(assistIdsOf(latest.current));
  }

  async function ask(message: string, faqId?: string): Promise<boolean> {
    if (pending || !message.trim()) return false;
    touched();
    const question: ChatEntry = { kind: "question", text: message, at: new Date().toISOString() };
    // v4 §1: a typed request for a person is handed over at once; no AI answer is attempted. (A chip is the FAQ's own question.)
    if (!faqId && isHumanRequest(message)) {
      setEntries((current) => [...current, question, { kind: "handover", reason: "requested" }]);
      setAnnouncement(`${text.handoverTitle} ${text.handoverBody}`);
      return true;
    }
    setPending(true);
    setAnnouncement("");
    setEntries((current) => [...current, question]);
    const result = await askAssistant(faqId ? { message, locale, faqId } : { message, locale }, newIdempotencyKey());
    setPending(false);
    if (result.ok && result.data) {
      const { id, reply } = result.data;
      const alternatives = reply ? [] : alternativesIn(result.data.alternatives);
      const at = new Date().toISOString();
      const next = [...latest.current, alternatives.length ? { kind: "answer" as const, id, reply, feedback: null, alternatives, at } : { kind: "answer" as const, id, reply, feedback: null, at }];
      // v4 §2 and §3: the handover card after the second unsolved turn in a row, or "Still need help?" after the 8th reply.
      const cards = cardsAfterChange(next);
      setEntries([...next, ...cards]);
      const said = reply ? plainText(reply.answer) : alternatives.length ? `${text.fallback} ${text.alternativesTitle} ${alternatives.map((item) => item.question).join("; ")}` : text.fallback;
      setAnnouncement(cards.length ? `${said} ${cardNotice(text, cards)}` : said);
      return true;
    }
    setEntries((current) => [...current, { kind: "error", error: result.status === 429 ? "rateLimited" : "error" }]);
    return false;
  }

  async function sendDraft() {
    const message = draft.trim();
    if (!message || pending) return;
    setDraft("");
    // Not answered (network, 429, timeout): give the question back unless the learner already typed something else.
    if (!(await ask(message))) setDraft((current) => (current === "" ? message : current));
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
      // v4 §2: a No on the newest answer can complete an unsolved pair.
      const cards = cardsAfterChange(next);
      setEntries([...next, ...cards]);
      if (cards.length) setAnnouncement(cardNotice(text, cards));
    } else setVoteError(id);
  }

  /** v4: the end-of-session rating card, the v3 endpoint (the first rating wins; 409 counts as rated). */
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
      setEntries((current) => current.map((entry, position) => (position === index && entry.kind === "ended" ? { ...entry, rating: "rated" } : entry)));
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
    setEntries((current) => current.map((entry, position) => (position === index && entry.kind === "ended" ? { ...entry, rating: "skipped" } : entry)));
  }

  /** Where the current session starts: cards before it belong to an ended session. */
  const sessionStart = entries.reduce((start, entry, index) => (entry.kind === "ended" ? index + 1 : start), 0);

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
          <p className="helpdesk-chat-greeting-title">{text.greetingTitle}</p>
          <p className="helpdesk-chat-greeting-body">{text.greetingBody}</p>
          <p className="helpdesk-chat-greeting-limit">{text.greetingLimit}</p>
          <button type="button" className="helpdesk-chat-ideas" onClick={onIdeas}>{text.ideas}</button>
        </div>
      </div>
      {chips.length ? <>
        <p className="helpdesk-chat-try">{text.tryAsking}</p>
        <ul className="helpdesk-chat-chips">
          {chips.map((chip) => <li key={chip.id}><button type="button" className="helpdesk-chat-chip" title={chip.question} disabled={pending} onClick={() => void ask(chip.question, chip.id)}><span>{chip.question}</span><ChevronRight size={14} aria-hidden="true" /></button></li>)}
        </ul>
      </> : null}
      {entries.map((entry, index) => {
        if (entry.kind === "question") return <div key={index} data-entry={index} className="helpdesk-chat-mine"><p className="helpdesk-chat-question">{entry.text}</p></div>;
        // v4 Part B cards: no Figma frame, 待视觉验收 (the answer bubble, .helpdesk-submit-button / .helpdesk-secondary-button, the v3 stars).
        if (entry.kind === "handover") return <div key={index} data-entry={index} className="helpdesk-chat-row">
          <span className="helpdesk-chat-avatar" aria-hidden="true"><Bot size={18} /></span>
          <section className="helpdesk-chat-card helpdesk-chat-card-handover" role="group" aria-labelledby={`${ids}-card-${index}`}>
            <p className="helpdesk-chat-card-title" id={`${ids}-card-${index}`}>{text.handoverTitle}</p>
            <p className="helpdesk-chat-card-text">{text.handoverBody}</p>
            <div className="helpdesk-chat-card-actions"><button type="button" className="helpdesk-submit-button" onClick={handOver}>{text.handoverButton}</button></div>
          </section>
        </div>;
        if (entry.kind === "checkin") return <div key={index} data-entry={index} className="helpdesk-chat-row">
          <span className="helpdesk-chat-avatar" aria-hidden="true"><Bot size={18} /></span>
          <section className="helpdesk-chat-card helpdesk-chat-card-checkin" role="group" aria-labelledby={`${ids}-card-${index}`}>
            <p className="helpdesk-chat-card-title" id={`${ids}-card-${index}`}>{text.checkinTitle}</p>
            <div className="helpdesk-chat-card-actions">
              {/* Only the open session can be ended; the way to a person stays on every card. */}
              {index >= sessionStart ? <button type="button" className="helpdesk-secondary-button" disabled={pending} onClick={() => endChat("learner")}>{text.endChat}</button> : null}
              <button type="button" className="helpdesk-submit-button" onClick={handOver}>{text.contactPerson}</button>
            </div>
          </section>
        </div>;
        if (entry.kind === "ended") {
          const busy = rating?.index === index ? rating.state : null;
          return <div key={index} data-entry={index} className="helpdesk-chat-row">
            <span className="helpdesk-chat-avatar" aria-hidden="true"><Bot size={18} /></span>
            <div className="helpdesk-chat-card helpdesk-chat-ended-card" tabIndex={-1}>
              <p className="helpdesk-chat-ended">{text.ended}</p>
              {entry.ratingFor && entry.rating === "open" ? <section className="helpdesk-rating helpdesk-chat-rating" role="group" aria-labelledby={`${ids}-rate-${index}`} tabIndex={-1}>
                <h3 id={`${ids}-rate-${index}`}>{copy.assistant.rateTitle}</h3>
                <div className="helpdesk-stars">{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" disabled={busy === "saving"} aria-label={fillTemplate(copy.assistant.rateStar, { n })} onClick={() => void rate(index, entry.ratingFor!, n)}><Star size={20} aria-hidden="true" /></button>)}</div>
                {busy === "error" ? <p role="alert" className="helpdesk-inline-error">{copy.assistant.rateError}</p> : null}
                {/* Skip stays enabled while a star is saving: the card never traps the learner. */}
                <button type="button" className="helpdesk-secondary-button" onClick={() => skipRating(index)}>{copy.assistant.skip}</button>
              </section> : entry.rating === "rated" ? <p className="helpdesk-chat-card-text helpdesk-chat-rated">{copy.assistant.rated}</p>
                : entry.reason === "learner" && !entry.ratingFor ? <p className="helpdesk-chat-card-text">{text.endThanks}</p> : null}
            </div>
          </div>;
        }
        if (entry.kind === "error") return <div key={index} data-entry={index} className="helpdesk-chat-row"><span className="helpdesk-chat-avatar" aria-hidden="true"><Bot size={18} /></span><p className="helpdesk-chat-error" role="alert">{entry.error === "rateLimited" ? text.rateLimited : text.error}</p></div>;
        return <div key={index} data-entry={index} className="helpdesk-chat-row">
          <span className="helpdesk-chat-avatar" aria-hidden="true"><Bot size={18} /></span>
          <div className="helpdesk-chat-answer">
            {entry.reply ? <>
              <Markdown className="helpdesk-chat-answer-text" text={entry.reply.answer} />
              <a className="helpdesk-chat-related" href={`/${locale}/help?faq=${encodeURIComponent(entry.reply.faqId)}`} target="_blank" rel="noopener noreferrer">{fillTemplate(text.relatedFaq, { question: entry.reply.question })}</a>
              <div className="helpdesk-chat-feedback">
                <span>{text.helpful}</span>
                <button type="button" className="helpdesk-chat-vote helpdesk-chat-vote-yes" aria-pressed={entry.feedback === "helpful"} disabled={entry.feedback !== null || voting !== null} onClick={() => void vote(entry.id, true)}><Check size={13} aria-hidden="true" />{text.yes}</button>
                <button type="button" className="helpdesk-chat-vote helpdesk-chat-vote-no" aria-pressed={entry.feedback === "not_helpful"} disabled={entry.feedback !== null || voting !== null} onClick={() => void vote(entry.id, false)}>{text.no}</button>
              </div>
              {voteError === entry.id && entry.feedback === null ? <p className="helpdesk-chat-vote-error" role="alert">{text.voteError}</p> : null}
            </> : <>
              <p className="helpdesk-chat-fallback">{text.fallback}</p>
              {/* v3 alternatives under the fallback: no Figma frame, 待视觉验收 (reuses .helpdesk-chat-try / .helpdesk-chat-chip). */}
              {entry.alternatives?.length ? <>
                <p className="helpdesk-chat-try" id={`${ids}-alternatives-${index}`}>{text.alternativesTitle}</p>
                <ul className="helpdesk-chat-chips helpdesk-chat-alternatives" aria-labelledby={`${ids}-alternatives-${index}`}>
                  {entry.alternatives.map((item) => <li key={item.faqId}><button type="button" className="helpdesk-chat-chip" title={item.question} disabled={pending} onClick={() => void ask(item.question, item.faqId)}><span>{item.question}</span><ChevronRight size={14} aria-hidden="true" /></button></li>)}
                </ul>
              </> : null}
            </>}
          </div>
        </div>;
      })}
      {pending ? <div className="helpdesk-chat-row"><span className="helpdesk-chat-avatar" aria-hidden="true"><Bot size={18} /></span><div className="helpdesk-chat-typing"><span aria-hidden="true" /><span aria-hidden="true" /><span aria-hidden="true" /></div></div> : null}
      <div className="helpdesk-chat-info"><CircleHelp size={19} aria-hidden="true" /><p><span className="helpdesk-chat-info-side">{text.info}</span><span className="helpdesk-chat-info-stacked">{text.infoStacked}</span></p></div>
    </div>
    {/* Always mounted, so screen readers announce what is put in it: the typing state, then the answer or the fallback. */}
    <p className="helpdesk-visually-hidden helpdesk-chat-live" role="status" aria-live="polite">{pending ? text.typing : announcement}</p>
    <div className="helpdesk-chat-footer">
      <textarea className="helpdesk-chat-input" aria-label={text.inputLabel} placeholder={text.placeholder} maxLength={questionMax} value={draft} onChange={(event) => { touched(); setDraft(event.target.value); }} onKeyDown={onKeyDown} />
      <button type="button" className="helpdesk-chat-send" aria-label={text.send} disabled={pending || !draft.trim()} onClick={() => void sendDraft()}><Send size={19} aria-hidden="true" /></button>
    </div>
  </section>;
}
