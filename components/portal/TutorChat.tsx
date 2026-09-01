"use client";

import { FormEvent, useEffect, useState } from "react";

type Message = { role: "user" | "assistant"; content: string };

export function TutorChat({ locale, courseId, lessonId, copy }: { locale: "en-GB" | "zh-CN"; courseId: string; lessonId: string; copy: { tutor: string; lecture: string; socratic: string; send: string; askTutor: string; you: string } }) {
  const [mode, setMode] = useState<"lecture" | "socratic">("lecture");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setMessages([]);
    setConversationId("");
    void fetch(`/api/ai-tutor?courseId=${encodeURIComponent(courseId)}&lessonId=${encodeURIComponent(lessonId)}&mode=${mode}`)
      .then(async (response) => {
        if (!response.ok) return null;
        return await response.json() as { conversation?: { id: string; messages: Message[] } };
      })
      .then((data) => {
        if (!cancelled && data?.conversation) {
          setConversationId(data.conversation.id);
          setMessages(data.conversation.messages || []);
        }
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [courseId, lessonId, mode]);

  async function send(event: FormEvent) {
    event.preventDefault();
    const message = input.trim();
    if (!message || busy) return;
    setInput(""); setBusy(true); setError("");
    const next = [...messages, { role: "user" as const, content: message }, { role: "assistant" as const, content: "" }];
    setMessages(next);
    try {
      const response = await fetch("/api/ai-tutor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ courseId, lessonId, mode, message, conversationId, locale }) });
      if (!response.ok) throw new Error(await response.text() || "AI Tutor request failed.");
      setConversationId(response.headers.get("X-Conversation-Id") || conversationId);
      if (!response.body) throw new Error("AI Tutor returned no stream.");
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let answer = "";
      while (true) { const chunk = await reader.read(); if (chunk.done) break; answer += decoder.decode(chunk.value, { stream: true }); setMessages([...next.slice(0, -1), { role: "assistant", content: answer }]); }
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "AI Tutor request failed."); setMessages(next.slice(0, -1)); }
    setBusy(false);
  }

  return <section className="tutor-panel"><div className="tutor-panel-heading"><h2>{copy.tutor}</h2><div className="mode-switch"><button className={mode === "lecture" ? "selected" : ""} onClick={() => setMode("lecture")} type="button">{copy.lecture}</button><button className={mode === "socratic" ? "selected" : ""} onClick={() => setMode("socratic")} type="button">{copy.socratic}</button></div></div><div className="tutor-messages">{messages.length ? messages.map((message, index) => <div className={`tutor-message ${message.role}`} key={`${index}-${message.role}`}><strong>{message.role === "user" ? copy.you : copy.tutor}</strong><p>{message.content || (busy ? "..." : "")}</p></div>) : <p className="tutor-empty">{copy.askTutor}</p>}</div><form className="tutor-composer" onSubmit={send}><input value={input} onChange={(event) => setInput(event.target.value)} placeholder={copy.askTutor} maxLength={4000} /><button className="portal-button portal-button-primary" disabled={busy || !input.trim()}>{busy ? "..." : copy.send}</button></form>{error ? <p className="portal-form-error" role="alert">{error}</p> : null}</section>;
}
