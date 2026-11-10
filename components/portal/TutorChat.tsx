"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { PortalDialog } from "./PortalDialog";
import { TutorAnswer } from "./TutorAnswer";
import { tutorAnswerPlainText } from "@/lib/tutorAnswer";
import { getMessages } from "@/lib/i18n/messages";
import { Copy as CopyIcon, RotateCw, Undo2 } from "lucide-react";
import { TutorRequestError, tutorErrorMessage } from "./tutorChatError";

type Message = { role: "user" | "assistant"; content: string; createdAt?: string };

type Copy = {
  tutor: string;
  lecture: string;
  socratic: string;
  send: string;
  askTutor: string;
  you: string;
  newChat: string;
  closeTutor: string;
  askTutorPlaceholder: string;
};

function formatTime(value: string | undefined, locale: "en-GB" | "zh-CN") {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(date);
}

function SparkleIcon() {
  return <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true"><path d="M14 3.5L16.9167 11.0833L24.5 14L16.9167 16.9167L14 24.5L11.0833 16.9167L3.5 14L11.0833 11.0833L14 3.5ZM23.3333 18.6667L24.5 22.1667L28 23.3333L24.5 24.5L23.3333 28L22.1667 24.5L18.6667 23.3333L22.1667 22.1667L23.3333 18.6667Z" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" stroke="#005CFF"/></svg>;
}

function CloseIcon() {
  return <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M5 5L15 15M15 5L5 15" stroke="#667085" strokeWidth="1.6" strokeLinecap="round"/></svg>;
}

/** 与 CSS `.tutor-composer textarea` 的 max-height 同步；10 行后出现滚动条。 */
const MAX_TEXTAREA_HEIGHT = 196;

export function TutorChat({ locale, courseId, lessonId, copy, onClose }: { locale: "en-GB" | "zh-CN"; courseId: string; lessonId: string; copy: Copy; onClose?: () => void }) {
  const actions = getMessages(locale).learning;
  const [mode, setMode] = useState<"lecture" | "socratic">("lecture");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState("");
  const [welcome, setWelcome] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [resetting, setResetting] = useState(false);
  const [openedAt] = useState(() => new Date().toISOString());
  // L3: every mode or lesson switch starts a new conversation generation. A stream that
  // began under an older generation must not write into the new conversation — neither its
  // late chunks nor its X-Conversation-Id — so it is aborted and its callbacks are dropped.
  const generationRef = useRef(0);
  const requestRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /** textarea 自动增高，超过 10 行（max-height 196px）受 CSS 约束出现滚动条。 */
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT) + "px";
  }, [input]);

  useEffect(() => {
    generationRef.current += 1;
    requestRef.current?.abort();
    requestRef.current = null;
    setBusy(false);
    setError("");
    let cancelled = false;
    setMessages([]);
    setConversationId("");
    setWelcome("");
    void fetch(`/api/ai-tutor?courseId=${encodeURIComponent(courseId)}&lessonId=${encodeURIComponent(lessonId)}&mode=${mode}&locale=${locale}`)
      .then(async (response) => {
        if (!response.ok) return null;
        return await response.json() as { conversation?: { id: string; messages: Message[] }; welcome?: string };
      })
      .then((data) => {
        if (!cancelled && data) {
          setConversationId(data.conversation?.id || "");
          setMessages(data.conversation?.messages || []);
          setWelcome(typeof data.welcome === "string" ? data.welcome : "");
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      generationRef.current += 1;
      requestRef.current?.abort();
      requestRef.current = null;
    };
    // 2026-10-27：mode 不再作为依赖 —— 切换 Lecture / Socratic 只影响后续请求的提示词注入，
    // 不重置当前聊天会话（对话已按 course+lesson 共享，不再按 mode 隔离）。
  }, [courseId, lessonId, locale]);

  useEffect(() => {
    const node = listRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, welcome, busy]);

  async function sendMessage(message: string, retryAt?: string) {
    if (!message.trim() || busy) return;
    const generation = generationRef.current;
    const controller = new AbortController();
    requestRef.current = controller;
    if (!retryAt) setInput("");
    setBusy(true); setError("");
    const createdAt = new Date().toISOString();
    const prior = retryAt ? messages.slice(0, messages.findLastIndex((item) => item.role === "user")) : messages;
    const next = [...prior, { role: "user" as const, content: message, createdAt }, { role: "assistant" as const, content: "", createdAt }];
    setMessages(next);
    try {
      const response = await fetch("/api/ai-tutor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ courseId, lessonId, mode, message, conversationId, locale, ...(retryAt ? { action: "retry", lastUserAt: retryAt } : {}) }), signal: controller.signal });
      if (generationRef.current !== generation) return;
      if (!response.ok) throw new TutorRequestError(response.status, await response.text().catch(() => ""));
      setConversationId(response.headers.get("X-Conversation-Id") || conversationId);
      if (!response.body) throw new TutorRequestError(null, "");
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let answer = "";
      while (true) {
        const chunk = await reader.read();
        if (generationRef.current !== generation) return;
        if (chunk.done) break;
        answer += decoder.decode(chunk.value, { stream: true });
        setMessages([...next.slice(0, -1), { role: "assistant", content: answer, createdAt }]);
      }
      const refreshed = await fetch(`/api/ai-tutor?courseId=${encodeURIComponent(courseId)}&lessonId=${encodeURIComponent(lessonId)}&mode=${mode}&locale=${locale}`);
      if (refreshed.ok && generationRef.current === generation) {
        const data = await refreshed.json() as { conversation?: { messages: Message[] } };
        // Only adopt persisted timestamps for the answer just displayed; a stale read must not erase it.
        const saved = data.conversation?.messages;
        if (saved?.at(-1)?.role === "assistant" && saved.at(-1)?.content === answer) setMessages(saved);
      }
    } catch (requestError) {
      if (generationRef.current !== generation) return;
      // REQ-0140: never show the API body (JSON) to the learner, only a fixed localised line.
      setError(requestError instanceof TutorRequestError ? tutorErrorMessage(locale, requestError.status, requestError.body) : tutorErrorMessage(locale, null, ""));
      setMessages(retryAt ? prior : next.slice(0, -1));
    }
    if (generationRef.current !== generation) return;
    setBusy(false);
    if (requestRef.current === controller) requestRef.current = null;
  }

  function send(event: FormEvent) { event.preventDefault(); void sendMessage(input.trim()); }

  async function undo(message: Message) {
    if (!window.confirm(actions.tutorUndoConfirm)) return;
    setBusy(true);
    try {
      const response = await fetch("/api/ai-tutor", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ courseId, lessonId, conversationId, lastUserAt: message.createdAt }) });
      if (!response.ok) throw new Error();
      const result = await response.json() as { question: string };
      setMessages((current) => current.slice(0, current.findLastIndex((item) => item.role === "user")));
      setInput(result.question);
    } catch { setError(actions.tutorActionFailed); }
    finally { setBusy(false); }
  }

  async function copyText(value: string) {
    try { await navigator.clipboard.writeText(value); }
    catch { setError(actions.tutorActionFailed); }
  }

  /** New chat：中止当前流、清空界面并删除服务端当前对话记录，下一轮从空白上下文开始。 */
  async function newChat() {
    if (resetting) return;
    generationRef.current += 1;
    requestRef.current?.abort();
    requestRef.current = null;
    setBusy(false);
    setError("");
    setInput("");
    setMessages([]);
    // 即使删除请求失败，也用不存在的 id 让下一次 POST 创建全新对话，避免沿用旧历史。
    setConversationId(`tutor-new-${Date.now()}`);
    setResetting(true);
    try {
      await fetch(`/api/ai-tutor?courseId=${encodeURIComponent(courseId)}&lessonId=${encodeURIComponent(lessonId)}&mode=${mode}`, { method: "DELETE" });
    } catch {
      // 界面上对话已清空；删除失败时旧记录不会再被当前会话引用。
    }
    setResetting(false);
  }

  return <>
    <header className="tutor-panel-heading">
      <div className="tutor-heading-main">
        <span className="tutor-heading-avatar">{SparkleIcon()}</span>
        <h2 id="tutor-panel-title">{copy.tutor}</h2>
      </div>
      <div className="mode-switch" role="group" aria-label={copy.tutor}>
        <button className={mode === "lecture" ? "selected" : ""} onClick={() => setMode("lecture")} type="button" disabled={busy}>{copy.lecture}</button>
        <button className={mode === "socratic" ? "selected" : ""} onClick={() => setMode("socratic")} type="button" disabled={busy}>{copy.socratic}</button>
      </div>
      <button type="button" className="tutor-new-chat" onClick={() => void newChat()} disabled={resetting}>
        <span className="tutor-new-chat-plus" aria-hidden="true">+</span>{copy.newChat}
      </button>
      {onClose ? <button type="button" className="tutor-close" aria-label={copy.closeTutor} onClick={onClose}>{CloseIcon()}</button> : null}
    </header>
    <div className="tutor-messages" ref={listRef}>
      {welcome ? <div className="tutor-message-row assistant">
        <div className="tutor-message-line">
          <div className="tutor-message-bubble-wrap">
            <span className="tutor-avatar tutor-avatar-ai" aria-hidden="true">AI</span>
            <div className="tutor-message assistant">{welcome ? <TutorAnswer text={welcome} courseId={courseId} sourcesLabel={actions.tutorSources} /> : null}</div>
            <time className="tutor-message-time" dateTime={openedAt}>{formatTime(openedAt, locale)}</time>
          </div>
        </div>
      </div> : null}
      {messages.map((message, index) => <div className={`tutor-message-row ${message.role}`} key={`${index}-${message.role}`}>
        <div className="tutor-message-line">
          <div className="tutor-message-bubble-wrap">
            <span className={`tutor-avatar ${message.role === "assistant" ? "tutor-avatar-ai" : "tutor-avatar-user"}`} aria-hidden="true">
              {message.role === "assistant" ? "AI" : Array.from(copy.you)[0]}
            </span>
            <div className={`tutor-message ${message.role}`}>{message.content ? <TutorAnswer text={message.content} courseId={courseId} sourcesLabel={actions.tutorSources} /> : (busy ? <p>...</p> : null)}</div>
            <time className="tutor-message-time" dateTime={message.createdAt}>{formatTime(message.createdAt, locale)}</time>
          </div>
        </div>
        <div className="tutor-message-actions">
          {message.role === "assistant" ? <>
            <details><summary aria-label={actions.tutorCopy} title={actions.tutorCopy}><CopyIcon size={15} /></summary><div className="tutor-copy-menu">
              <button type="button" disabled={!message.content} onClick={() => void copyText(tutorAnswerPlainText(message.content, actions.tutorSources))}>{actions.tutorCopyPlain}</button>
              <button type="button" disabled={!message.content} onClick={() => void copyText(message.content)}>{actions.tutorCopyMarkdown}</button>
            </div></details>
          </> : <>
            <button type="button" aria-label={actions.tutorCopy} title={actions.tutorCopy} onClick={() => void copyText(message.content)}><CopyIcon size={15} /></button>
            <button type="button" aria-label={actions.tutorRetry} title={actions.tutorRetry} disabled={busy || index !== messages.findLastIndex((item) => item.role === "user")} onClick={() => void sendMessage(message.content, message.createdAt)}><RotateCw size={15} /></button>
            <button type="button" aria-label={actions.tutorUndo} title={actions.tutorUndo} disabled={busy || index !== messages.findLastIndex((item) => item.role === "user")} onClick={() => void undo(message)}><Undo2 size={15} /></button>
          </>}
        </div>
      </div>)}
      {!messages.length && !welcome ? <p className="tutor-empty">{copy.askTutor}</p> : null}
    </div>
    <form className="tutor-composer" onSubmit={send}>
      <textarea ref={textareaRef} value={input} onChange={(event) => setInput(event.target.value)} placeholder={copy.askTutorPlaceholder} maxLength={4000} rows={2} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }}/>
      <button className="portal-button portal-button-primary" disabled={busy || !input.trim()}>{copy.send}</button>
    </form>
    {error ? <PortalDialog labelledBy="tutor-error-title" onClose={() => setError("")}>
      <h2 id="tutor-error-title">{actions.tutorErrorTitle}</h2>
      <p role="alert">{error}</p>
      <button type="button" onClick={() => setError("")}>{actions.tutorErrorClose}</button>
    </PortalDialog> : null}
  </>;
}
