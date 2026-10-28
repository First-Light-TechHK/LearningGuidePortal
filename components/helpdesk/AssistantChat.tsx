"use client";
// AI Support Assistant chat panel, the right column of Contact Support (Figma
// 1216:6, tickets-v2-figma-addendum §4c). The learner asks a question (or taps
// a popular-FAQ chip); the server asks Admin, logs what was shown and returns
// the FAQ answer verbatim, or null for the fallback. The panel only renders
// what came back. The transcript lives in sessionStorage for this tab, per
// account, and its answer ids go with the enquiry as assistIds.
import { Bot, Check, ChevronRight, CircleHelp, Send } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { assistIdsOf, chatStorageKey, fillTemplate, readTranscript, type ChatEntry } from "@/modules/helpdesk/learnerUi";
import { askAssistant, newIdempotencyKey, sendAssistantFeedback } from "./helpdeskApi";
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
  const log = useRef<HTMLDivElement>(null);
  const report = useRef(onAssistIds);
  report.current = onAssistIds;

  // sessionStorage is read after mount, so the server render and the first client render match.
  useEffect(() => { setEntries(readStored(storageKey)); setLoaded(true); }, [storageKey]);
  useEffect(() => {
    if (!loaded) return;
    store(storageKey, entries);
    report.current(assistIdsOf(entries));
  }, [entries, loaded, storageKey]);
  useLayoutEffect(() => {
    const node = log.current;
    if (node && entries.length) node.scrollTop = node.scrollHeight;
  }, [entries, pending]);

  async function ask(message: string, faqId?: string) {
    if (pending || !message.trim()) return;
    setPending(true);
    setEntries((current) => [...current, { kind: "question", text: message }]);
    const result = await askAssistant(faqId ? { message, locale, faqId } : { message, locale }, newIdempotencyKey());
    setPending(false);
    if (result.ok && result.data) {
      const { id, reply } = result.data;
      setEntries((current) => [...current, { kind: "answer", id, reply, feedback: null }]);
    } else setEntries((current) => [...current, { kind: "error", error: result.status === 429 ? "rateLimited" : "error" }]);
  }

  function sendDraft() {
    const message = draft.trim();
    if (!message || pending) return;
    setDraft("");
    void ask(message);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    sendDraft();
  }

  async function vote(id: string, helpful: boolean) {
    if (voting) return;
    setVoting(id);
    const result = await sendAssistantFeedback(id, helpful, newIdempotencyKey());
    setVoting(null);
    // The server keeps the first value; show what it stored.
    if (result.ok && result.data && (result.data.feedback === "helpful" || result.data.feedback === "not_helpful")) {
      const stored = result.data.feedback;
      setEntries((current) => current.map((entry) => (entry.kind === "answer" && entry.id === id ? { ...entry, feedback: stored } : entry)));
    }
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
          {chips.map((chip) => <li key={chip.id}><button type="button" className="helpdesk-chat-chip" disabled={pending} onClick={() => void ask(chip.question, chip.id)}><span>{chip.question}</span><ChevronRight size={14} aria-hidden="true" /></button></li>)}
        </ul>
      </> : null}
      {entries.map((entry, index) => {
        if (entry.kind === "question") return <div key={index} className="helpdesk-chat-mine"><p className="helpdesk-chat-question">{entry.text}</p></div>;
        if (entry.kind === "error") return <div key={index} className="helpdesk-chat-row"><span className="helpdesk-chat-avatar" aria-hidden="true"><Bot size={18} /></span><p className="helpdesk-chat-error" role="alert">{entry.error === "rateLimited" ? text.rateLimited : text.error}</p></div>;
        return <div key={index} className="helpdesk-chat-row">
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
            </> : <p className="helpdesk-chat-fallback">{text.fallback}</p>}
          </div>
        </div>;
      })}
      {pending ? <div className="helpdesk-chat-row"><span className="helpdesk-chat-avatar" aria-hidden="true"><Bot size={18} /></span><div className="helpdesk-chat-typing"><span aria-hidden="true" /><span aria-hidden="true" /><span aria-hidden="true" /><span className="helpdesk-visually-hidden" role="status">{text.typing}</span></div></div> : null}
      <div className="helpdesk-chat-info"><CircleHelp size={19} aria-hidden="true" /><p>{text.info}</p></div>
    </div>
    <div className="helpdesk-chat-footer">
      <textarea className="helpdesk-chat-input" aria-label={text.inputLabel} placeholder={text.placeholder} maxLength={questionMax} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onKeyDown} />
      <button type="button" className="helpdesk-chat-send" aria-label={text.send} disabled={pending || !draft.trim()} onClick={sendDraft}><Send size={19} aria-hidden="true" /></button>
    </div>
  </section>;
}
