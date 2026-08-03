"use client";

import { FormEvent, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Bot, Check, CircleHelp, ClipboardCheck, Lightbulb, RotateCcw, Send, Sparkles, TriangleAlert, UserRound, X } from "lucide-react";
import { MarkdownAnswer } from "@/components/MarkdownAnswer";

const STREAM_ERROR_PREFIX = "__DIALOGUE_TESTING_ERROR__:";

type ChatMode = "lecture" | "socratic";
type DialogueRoute = {
  id: string;
  model: string;
  modelLabel: string;
  useKnowledge: boolean;
  releaseId: string | null;
};
type DialogueMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  error?: boolean;
};
type DialogueState = {
  knowledgeTitle: string;
  route: DialogueRoute | null;
  session: {
    mode: ChatMode;
    messages: DialogueMessage[];
  };
};
type DialogueRound = {
  index: number;
  user: DialogueMessage;
  assistant: DialogueMessage;
};
type AssessmentResult = {
  turn_count: number;
  overall_quality: "strong" | "mostly_good" | "partial" | "weak" | "unclear";
  student_understands: string[];
  student_gaps: string[];
  next_question: string | null;
};
type AssessmentRecord = {
  id: string;
  createdAt: string;
  result: AssessmentResult;
};

const QUALITY_LABELS: Record<AssessmentResult["overall_quality"], string> = {
  strong: "Strong understanding",
  mostly_good: "Mostly good understanding",
  partial: "Partial understanding",
  weak: "Needs support",
  unclear: "Not enough evidence yet"
};

function welcomeMessage(knowledgeTitle: string, mode: ChatMode): DialogueMessage {
  return {
    id: "welcome",
    role: "assistant",
    content: mode === "socratic"
      ? `Welcome! Let's explore ${knowledgeTitle} together. I'll guide you with questions to help you reason through the topic.`
      : `Welcome! Let's explore ${knowledgeTitle} together. Ask me a question and I'll explain it clearly.`,
    createdAt: new Date().toISOString()
  };
}

function normaliseComposerInput(value: string) {
  return value.replace(/^\s*\d+\.\s*(?=\S)/, "");
}

function dialogueRounds(messages: DialogueMessage[]) {
  const rounds: DialogueRound[] = [];
  for (let index = 0; index < messages.length - 1; index += 1) {
    const user = messages[index];
    const assistant = messages[index + 1];
    if (user.role !== "user" || assistant.role !== "assistant" || assistant.error || !user.content.trim() || !assistant.content.trim()) continue;
    rounds.push({ index: rounds.length, user, assistant });
    index += 1;
  }
  return rounds;
}

export default function DialoguePage() {
  const pathname = usePathname();
  const parts = pathname.split("/").filter(Boolean);
  const courseId = parts[1] || "philosophy";
  const knowledgeId = parts[2] || "epicureanism";
  const query = `courseId=${encodeURIComponent(courseId)}&knowledgeId=${encodeURIComponent(knowledgeId)}`;

  const [state, setState] = useState<DialogueState | null>(null);
  const [mode, setMode] = useState<ChatMode>("lecture");
  const [route, setRoute] = useState<DialogueRoute | null>(null);
  const [messages, setMessages] = useState<DialogueMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [assessmentOpen, setAssessmentOpen] = useState(false);
  const [assessmentStatus, setAssessmentStatus] = useState<"select" | "loading" | "result" | "error">("select");
  const [assessmentStart, setAssessmentStart] = useState(0);
  const [assessmentEnd, setAssessmentEnd] = useState(0);
  const [assessmentSelectionChanged, setAssessmentSelectionChanged] = useState(false);
  const [assessmentError, setAssessmentError] = useState("");
  const [assessment, setAssessment] = useState<AssessmentRecord | null>(null);

  useEffect(() => { void loadState(); }, [query]);

  async function loadState() {
    setError("");
    const [res, assessmentRes] = await Promise.all([
      fetch(`/api/dialogue?${query}`, { cache: "no-store" }),
      fetch(`/api/dialogue/assessment?${query}`, { cache: "no-store" })
    ]);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Load dialogue failed.");
      return;
    }
    setState(data);
    setMode(data.session?.mode || "lecture");
    setRoute(data.route || null);
    setMessages(data.session?.messages || []);
    if (assessmentRes.ok) {
      const assessmentData = await assessmentRes.json() as { assessment?: AssessmentRecord | null };
      setAssessment(assessmentData.assessment || null);
    }
  }

  const knowledgeTitle = state?.knowledgeTitle || knowledgeId;
  const visibleMessages = messages.length ? messages : [welcomeMessage(knowledgeTitle, mode)];
  const rounds = dialogueRounds(messages);
  const selectedRoundIds = new Set(
    assessmentStatus === "select" ? rounds.slice(assessmentStart, assessmentEnd + 1).flatMap((round) => [round.user.id, round.assistant.id]) : []
  );

  function prepareAssessmentSelection() {
    if (!rounds.length) return false;
    const start = Math.max(0, rounds.length - 5);
    setAssessmentStart(start);
    setAssessmentEnd(rounds.length - 1);
    setAssessmentSelectionChanged(false);
    setAssessmentError("");
    setAssessmentStatus("select");
    return true;
  }

  function openAssessment() {
    if (!rounds.length && !assessment) return;
    setAssessmentOpen(true);
    if (assessment) {
      setAssessmentError("");
      setAssessmentStatus("result");
      return;
    }
    prepareAssessmentSelection();
  }

  function reassess() {
    if (prepareAssessmentSelection()) return;
    setAssessmentError("Add a complete dialogue round before starting a new assessment.");
    setAssessmentStatus("error");
  }

  function closeAssessment() {
    setAssessmentOpen(false);
    setAssessmentError("");
  }

  function updateAssessmentRange(boundary: "start" | "end", value: number) {
    setAssessmentSelectionChanged(true);
    if (boundary === "start") setAssessmentStart(Math.min(value, assessmentEnd));
    else setAssessmentEnd(Math.max(value, assessmentStart));
  }

  async function runAssessment() {
    if (assessmentStatus === "loading" || !rounds.length) return;
    setAssessmentStatus("loading");
    setAssessmentError("");
    try {
      const res = await fetch("/api/dialogue/assessment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseId,
          knowledgeId,
          startRound: assessmentStart,
          endRound: assessmentEnd,
          selectionMethod: assessmentSelectionChanged ? "user_selected_turns" : "default_latest_turns"
        })
      });
      const responseText = await res.text();
      let data: { assessment?: AssessmentRecord; error?: string } = {};
      try {
        data = responseText ? JSON.parse(responseText) : {};
      } catch {
        throw new Error(res.ok ? "Assessment returned an invalid response." : "Assessment request failed. Please retry.");
      }
      if (!res.ok) throw new Error(data.error || "Assessment failed.");
      if (!data.assessment) throw new Error("Assessment returned an invalid response.");
      setAssessment(data.assessment);
      setAssessmentStatus("result");
    } catch (err) {
      setAssessmentError(err instanceof Error ? err.message : "Assessment failed.");
      setAssessmentStatus("error");
    }
  }

  function useSuggestedQuestion() {
    const question = assessment?.result.next_question;
    if (!question) return;
    setInput(question);
    closeAssessment();
  }

  async function requestAssistantResponse(history: DialogueMessage[], userMessage: DialogueMessage, assistantShell: DialogueMessage) {
    if (!route) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/dialogue/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseId, knowledgeId, mode, config: route, messages: history, input: userMessage.content })
      });
      if (!res.ok) throw new Error(await res.text() || "Dialogue send failed.");
      if (!res.body) throw new Error("Dialogue returned no response stream.");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let answer = "";
      const serverUserId = res.headers.get("X-User-Message-Id");
      const serverUserCreatedAt = res.headers.get("X-User-Message-Created-At");
      const resolvedUserMessage = {
        ...userMessage,
        id: serverUserId || userMessage.id,
        createdAt: serverUserCreatedAt || userMessage.createdAt
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (!chunk) continue;
        const errorIndex = chunk.indexOf(STREAM_ERROR_PREFIX);
        if (errorIndex >= 0) {
          const answerChunk = chunk.slice(0, errorIndex);
          if (answerChunk) {
            answer += answerChunk;
            setMessages([...history, resolvedUserMessage, { ...assistantShell, content: answer }]);
          }
          throw new Error(chunk.slice(errorIndex + STREAM_ERROR_PREFIX.length).trim() || "Dialogue stream failed.");
        }
        answer += chunk;
        setMessages([...history, resolvedUserMessage, { ...assistantShell, content: answer }]);
      }

      if (!answer.trim()) throw new Error("OpenRouter returned an empty answer for this dialogue.");
      setMessages([...history, resolvedUserMessage, { ...assistantShell, content: answer, createdAt: new Date().toISOString() }]);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Dialogue send failed.";
      setError(message);
      setMessages([...history, userMessage, {
        ...assistantShell,
        role: "assistant",
        content: message,
        createdAt: new Date().toISOString(),
        error: true
      }]);
    } finally {
      setLoading(false);
    }
  }

  async function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    const trimmed = normaliseComposerInput(input).trim();
    if (!trimmed || loading || !route) return;
    const history = messages;
    const createdAt = new Date().toISOString();
    const optimisticUser: DialogueMessage = {
      id: `user_${Date.now()}`,
      role: "user",
      content: trimmed,
      createdAt
    };
    const assistantShell: DialogueMessage = {
      id: `assistant_${Date.now()}`,
      role: "assistant",
      content: "",
      createdAt
    };
    setMessages([...history, optimisticUser, assistantShell]);
    setInput("");
    await requestAssistantResponse(history, optimisticUser, assistantShell);
  }

  async function retryAssistantMessage(assistantIndex: number) {
    if (loading) return;
    const assistantMessage = messages[assistantIndex];
    if (!assistantMessage || assistantMessage.role !== "assistant") return;
    let userIndex = assistantIndex - 1;
    while (userIndex >= 0 && messages[userIndex].role !== "user") userIndex -= 1;
    if (userIndex < 0) {
      setError("No user message found for retry.");
      return;
    }
    const userMessage = messages[userIndex];
    const history = messages.slice(0, userIndex);
    const assistantShell: DialogueMessage = {
      ...assistantMessage,
      content: "",
      error: undefined,
      createdAt: new Date().toISOString()
    };
    setMessages([...history, userMessage, assistantShell]);
    await requestAssistantResponse(history, userMessage, assistantShell);
  }

  return (
    <main className="single-dialogue-page">
      {error ? <div className="single-dialogue-error">{error}</div> : null}
      <section className="single-dialogue-scroll" aria-label="Dialogue">
        <div className="single-dialogue-thread">
          {visibleMessages.map((message, messageIndex) => (
            <div className={`single-dialogue-row ${message.role} ${message.error ? "error" : ""} ${assessmentOpen && selectedRoundIds.has(message.id) ? "assessment-selected" : ""}`} key={message.id}>
              {message.role === "assistant" ? <div className="single-dialogue-avatar assistant"><Bot /></div> : null}
              <div className="single-dialogue-content">
                <div className="single-dialogue-speaker">{message.role === "assistant" ? "AI Tutor" : "You"}</div>
                <div className="single-dialogue-bubble">
                  {message.error ? message.content : message.role === "assistant" && !message.content ? (
                    <span className="loading-bubble"><span className="loading-spinner" /> Thinking...</span>
                  ) : <MarkdownAnswer content={message.content} compact />}
                </div>
                {message.role === "assistant" && message.id !== "welcome" ? (
                  <button
                    className="dialogue-retry-button"
                    type="button"
                    aria-label="Retry response"
                    title="Retry response"
                    onClick={() => retryAssistantMessage(messageIndex)}
                    disabled={loading}
                  >
                    <RotateCcw size={15} />
                  </button>
                ) : null}
              </div>
              {message.role === "user" ? <div className="single-dialogue-avatar user"><UserRound /></div> : null}
            </div>
          ))}
        </div>
      </section>
      <form className="single-dialogue-composer" onSubmit={sendMessage}>
        <button className="single-dialogue-tool" type="button" aria-label="Assess selected dialogue" title={rounds.length || assessment ? "Assess dialogue" : "Add a complete dialogue round to assess"} onClick={openAssessment} disabled={loading || (!rounds.length && !assessment)}>
          <ClipboardCheck />
        </button>
        <input
          value={input}
          onChange={(event) => setInput(normaliseComposerInput(event.target.value))}
          placeholder="Type a message for this setup..."
          disabled={loading || !route}
        />
        <button className="single-dialogue-send" type="submit" disabled={loading || !input.trim() || !route}>
          <Send /> Send
        </button>
      </form>
      {assessmentOpen ? (
        <div className="assessment-overlay" role="dialog" aria-modal="true" aria-label="Dialogue assessment">
          <section className="assessment-sheet">
            <div className="assessment-handle" />
            <button className="assessment-close" type="button" aria-label="Close assessment" title="Close assessment" onClick={closeAssessment}><X /></button>
            {assessmentStatus === "select" ? (
              <div className="assessment-selection">
                <div className="assessment-heading"><div className="assessment-icon"><Sparkles /></div><div><h2>Assess conversation</h2><p>Select a continuous range of dialogue rounds.</p></div></div>
                <div className="assessment-range-controls">
                  <label>From round<select value={assessmentStart} onChange={(event) => updateAssessmentRange("start", Number(event.target.value))}>{rounds.map((round, index) => <option key={round.user.id} value={index}>Round {index + 1}</option>)}</select></label>
                  <label>To round<select value={assessmentEnd} onChange={(event) => updateAssessmentRange("end", Number(event.target.value))}>{rounds.map((round, index) => <option key={round.assistant.id} value={index}>Round {index + 1}</option>)}</select></label>
                </div>
                <p className="assessment-selection-note">{assessmentEnd - assessmentStart + 1} {assessmentEnd === assessmentStart ? "round" : "rounds"} selected</p>
                <div className="assessment-actions"><button className="btn" type="button" onClick={closeAssessment}>Cancel</button><button className="btn primary" type="button" onClick={runAssessment}>Start assessment</button></div>
              </div>
            ) : null}
            {assessmentStatus === "loading" ? <div className="assessment-state"><span className="loading-spinner" /><h2>Assessing selected conversation</h2><p>Reviewing {assessmentEnd - assessmentStart + 1} dialogue {assessmentEnd === assessmentStart ? "round" : "rounds"} with the Knowledge assessment prompt.</p></div> : null}
            {assessmentStatus === "error" ? <div className="assessment-state error"><TriangleAlert /><h2>Assessment could not be completed</h2><p>{assessmentError || "Please try again."}</p><div className="assessment-actions"><button className="btn" type="button" onClick={closeAssessment}>Close</button><button className="btn primary" type="button" onClick={runAssessment}>Retry</button></div></div> : null}
            {assessmentStatus === "result" && assessment ? (
              <div className="assessment-result">
                <div className="assessment-result-heading">
                  <div className="assessment-heading"><div className="assessment-icon"><Sparkles /></div><div><h2>Assessment Result</h2><p>Based on the selected conversation: {assessment.result.turn_count} {assessment.result.turn_count === 1 ? "round" : "rounds"}</p></div></div>
                  <button className="assessment-reassess" type="button" onClick={reassess} disabled={loading}><RotateCcw size={16} /> Reassess</button>
                </div>
                <div className="assessment-grid">
                  <section className={`assessment-panel overall quality-${assessment.result.overall_quality}`}><h3>Overall quality</h3><strong>{QUALITY_LABELS[assessment.result.overall_quality]}</strong></section>
                  <section className="assessment-panel understands"><h3>What the student understands</h3><ul>{assessment.result.student_understands.map((item) => <li key={item}><Check />{item}</li>)}</ul></section>
                  <section className="assessment-panel gaps"><h3>What is still missing</h3><ul>{assessment.result.student_gaps.map((item) => <li key={item}><TriangleAlert />{item}</li>)}</ul></section>
                  {assessment.result.next_question ? <section className="assessment-panel next-question"><h3>Suggested next question</h3><div className="next-question-content"><CircleHelp /><p>{assessment.result.next_question}</p></div><button className="assessment-use-question" type="button" onClick={useSuggestedQuestion}>Use this question</button></section> : <section className="assessment-panel next-question complete"><h3>Assessment complete</h3><div className="next-question-content"><Lightbulb /><p>This conversation has reached a suitable conclusion.</p></div></section>}
                </div>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </main>
  );
}
