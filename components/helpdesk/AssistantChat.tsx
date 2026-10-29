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
import { Bot, Check, ChevronRight, CircleHelp, Send } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { assistIdsOf, chatStorageKey, fillTemplate, readTranscript, settleTranscript, type ChatEntry } from "@/modules/helpdesk/learnerUi";
import { plainText } from "@/modules/helpdesk/markdown";
import { alternativesIn, askAssistant, newIdempotencyKey, sendAssistantFeedback } from "./helpdeskApi";
import type { HelpdeskCopy } from "./HelpdeskParts";
import { Markdown } from "./Markdown";

export type ChatChip = { id: string; question: string };

function readStored(key: string): ChatEntry[] {
  try { return readTranscript(window.sessionStorage.getItem(key)); } catch { return []; }
}

function store(key: string, entries: ChatEntry[]) {
  try { window.sessionStorage.setItem(key, JSON.stringify(entries)); } catch { /* storage full or blocked: the chat still works */ }
}

export function AssistantChat({ locale, copy, questionMax, accountId, chips, onIdeas, onAssistIds }: { locale: "en-GB" | "zh-CN"; copy: HelpdeskCopy; questionMax: number; accountId: string; chips: ChatChip[]; onIdeas: () => void; onAssistIds: (ids: string[]) => void }) {
  const text = copy.chat;
  const ids = useId();
  const storageKey = chatStorageKey(accountId);
  const [entries, setEntries] = useState<ChatEntry[]>([]);
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

  // sessionStorage is read after mount, so the server render and the first client render match.
  useEffect(() => { setEntries(settleTranscript(readStored(storageKey))); setLoaded(true); }, [storageKey]);
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

  async function ask(message: string, faqId?: string): Promise<boolean> {
    if (pending || !message.trim()) return false;
    setPending(true);
    setAnnouncement("");
    setEntries((current) => [...current, { kind: "question", text: message }]);
    const result = await askAssistant(faqId ? { message, locale, faqId } : { message, locale }, newIdempotencyKey());
    setPending(false);
    if (result.ok && result.data) {
      const { id, reply } = result.data;
      const alternatives = reply ? [] : alternativesIn(result.data.alternatives);
      setEntries((current) => [...current, alternatives.length ? { kind: "answer", id, reply, feedback: null, alternatives } : { kind: "answer", id, reply, feedback: null }]);
      setAnnouncement(reply ? plainText(reply.answer) : alternatives.length ? `${text.fallback} ${text.alternativesTitle} ${alternatives.map((item) => item.question).join("; ")}` : text.fallback);
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
    setVoting(id);
    setVoteError(null);
    const result = await sendAssistantFeedback(id, helpful, newIdempotencyKey());
    setVoting(null);
    // The server keeps the first value; show what it stored.
    if (result.ok && result.data && (result.data.feedback === "helpful" || result.data.feedback === "not_helpful")) {
      const stored = result.data.feedback;
      setEntries((current) => current.map((entry) => (entry.kind === "answer" && entry.id === id ? { ...entry, feedback: stored } : entry)));
    } else setVoteError(id);
  }

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
      <textarea className="helpdesk-chat-input" aria-label={text.inputLabel} placeholder={text.placeholder} maxLength={questionMax} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onKeyDown} />
      <button type="button" className="helpdesk-chat-send" aria-label={text.send} disabled={pending || !draft.trim()} onClick={() => void sendDraft()}><Send size={19} aria-hidden="true" /></button>
    </div>
  </section>;
}
