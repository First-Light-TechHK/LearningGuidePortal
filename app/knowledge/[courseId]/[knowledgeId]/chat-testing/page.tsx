"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { BookOpen, Route, Send, Settings } from "lucide-react";
import { MarkdownAnswer } from "@/components/MarkdownAnswer";

type Model = { id: string; label: string };
type Release = { id: string };
type ChatMode = "lecture" | "socratic";
type ExecutionMode = "sequential" | "parallel";
type ChatRouteStatus = "pending" | "loading" | "streaming" | "done" | "error";
const STREAM_ERROR_PREFIX = "__CHAT_TESTING_ROUTE_ERROR__:";
type PromptSettings = {
  basePrompt: string;
  lecturePrompt: string;
  socraticPrompt: string;
  assessmentPrompt: string;
};
type ChatRoute = {
  id: string;
  model: string;
  modelLabel: string;
  useKnowledge: boolean;
  releaseId: string | null;
};
type ChatResult = ChatRoute & {
  routeId: string;
  question?: string;
  answer: string;
  error?: string;
  status?: ChatRouteStatus;
  createdAt?: string;
  startedAt?: string;
  completedAt?: string;
};
type ChatState = {
  knowledgeTitle: string;
  models: Model[];
  releases: Release[];
  promptSettings: PromptSettings;
  routeConfig: { routes: ChatRoute[] };
  lastRun: { question: string; mode: ChatMode; results: ChatResult[] } | null;
};
type CopyFeedback = "copied" | "failed" | null;

function displayTime(value?: string) {
  return value ? new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
}

function routeShell(route: ChatRoute): ChatResult {
  return { ...route, routeId: route.id, answer: "", createdAt: "" };
}

function pendingResult(route: ChatRoute, question: string): ChatResult {
  return { ...route, routeId: route.id, question, answer: "", status: "pending" };
}

function mergeResultsWithRoutes(routes: ChatRoute[], results: ChatResult[]) {
  const byRouteId = new Map(results.map((result) => [result.routeId, result]));
  return routes.map((route) => {
    const result = byRouteId.get(route.id);
    return result ? { ...route, ...result, routeId: route.id } : routeShell(route);
  });
}

export default function ChatTestingPage() {
  const pathname = usePathname();
  const parts = pathname.split("/").filter(Boolean);
  const courseId = parts[1] || "philosophy";
  const knowledgeId = parts[2] || "epicureanism";
  const query = `courseId=${encodeURIComponent(courseId)}&knowledgeId=${encodeURIComponent(knowledgeId)}`;

  const [state, setState] = useState<ChatState | null>(null);
  const [mode, setMode] = useState<ChatMode>("lecture");
  const [question, setQuestion] = useState("");
  const [routes, setRoutes] = useState<ChatRoute[]>([]);
  const [results, setResults] = useState<ChatResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [promptOpen, setPromptOpen] = useState(false);
  const [routeOpen, setRouteOpen] = useState(false);
  const [readerResult, setReaderResult] = useState<ChatResult | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback>(null);
  const [draftPrompts, setDraftPrompts] = useState<PromptSettings | null>(null);
  const [draftRoutes, setDraftRoutes] = useState<ChatRoute[]>([]);

  useEffect(() => { loadState(); }, [query]);

  async function loadState() {
    setError("");
    const res = await fetch(`/api/chat-testing?${query}`, { cache: "no-store" });
    const data = await res.json();
    setState(data);
    setRoutes(data.routeConfig.routes || []);
    setResults(data.lastRun?.results?.length ? data.lastRun.results : (data.routeConfig.routes || []).map(routeShell));
    if (data.lastRun?.mode) setMode(data.lastRun.mode);
  }

  function openPrompts() {
    if (!state) return;
    setDraftPrompts(state.promptSettings);
    setPromptOpen(true);
  }

  async function savePrompts() {
    if (!draftPrompts) return;
    const res = await fetch("/api/chat-testing/prompts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseId, knowledgeId, promptSettings: draftPrompts })
    });
    const data = await res.json();
    if (!res.ok) return setError(data.error || "Save prompt settings failed.");
    setState((current) => current ? { ...current, promptSettings: data } : current);
    setPromptOpen(false);
  }

  function openRoutes() {
    setDraftRoutes(routes.map((route) => ({ ...route })));
    setRouteOpen(true);
  }

  function patchDraftRoute(index: number, patch: Partial<ChatRoute>) {
    setDraftRoutes((current) => current.map((route, routeIndex) => {
      if (routeIndex !== index) return route;
      const next = { ...route, ...patch };
      const model = state?.models.find((item) => item.id === next.model);
      if (model) next.modelLabel = model.label;
      if (!next.useKnowledge) next.releaseId = null;
      if (next.useKnowledge && !next.releaseId) next.releaseId = state?.releases[0]?.id || null;
      return next;
    }));
  }

  function addRoute() {
    if (draftRoutes.length >= 3 || !state) return;
    const model = state.models[0];
    const releaseId = state.releases[0]?.id || null;
    setDraftRoutes([...draftRoutes, {
      id: `route_${Date.now()}`,
      model: model.id,
      modelLabel: model.label,
      useKnowledge: Boolean(releaseId),
      releaseId
    }]);
  }

  async function saveRoutes() {
    const res = await fetch("/api/chat-testing/routes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseId, knowledgeId, routes: draftRoutes })
    });
    const data = await res.json();
    if (!res.ok) return setError(data.error || "Save route configuration failed.");
    setRoutes(data.routes);
    setResults(data.routes.map(routeShell));
    setState((current) => current ? { ...current, routeConfig: data } : current);
    setRouteOpen(false);
  }

  async function saveRunSnapshot(nextResults: ChatResult[], nextQuestion: string) {
    const saveRes = await fetch("/api/chat-testing/save-run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseId, knowledgeId, question: nextQuestion, mode, results: nextResults })
    });
    const saveData = await saveRes.json();
    if (!saveRes.ok) throw new Error(saveData.error || "Save run failed.");
  }

  async function runSingleRoute(route: ChatRoute, trimmed: string, nextResults: ChatResult[]) {
    const routeIndex = nextResults.findIndex((item) => item.routeId === route.id);
    if (routeIndex < 0) return;
    const startedAt = new Date().toISOString();
    Object.assign(nextResults[routeIndex], {
      status: "loading",
      startedAt,
      completedAt: undefined,
      createdAt: startedAt,
      answer: "",
      error: undefined
    });
    setResults([...nextResults]);

    try {
      const res = await fetch("/api/chat-testing/run-route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseId, knowledgeId, question: trimmed, mode, route })
      });
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(errorText || "Route failed.");
      }
      if (!res.body) throw new Error("Route returned no response stream.");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let answer = "";

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
            Object.assign(nextResults[routeIndex], { answer, status: "streaming", error: undefined });
            setResults([...nextResults]);
          }
          throw new Error(chunk.slice(errorIndex + STREAM_ERROR_PREFIX.length).trim() || "Route failed.");
        }
        answer += chunk;
        Object.assign(nextResults[routeIndex], { answer, status: "streaming", error: undefined });
        setResults([...nextResults]);
      }

      const completedAt = new Date().toISOString();
      if (!answer.trim()) throw new Error("OpenRouter returned an empty answer for this route.");
      Object.assign(nextResults[routeIndex], {
        answer,
        status: "done",
        completedAt,
        createdAt: completedAt,
        error: undefined
      });
      setResults([...nextResults]);
    } catch (routeError) {
      const completedAt = new Date().toISOString();
      Object.assign(nextResults[routeIndex], {
        status: "error",
        answer: nextResults[routeIndex].answer,
        error: routeError instanceof Error ? routeError.message : "Route failed.",
        completedAt,
        createdAt: completedAt
      });
      setResults([...nextResults]);
    }
  }

  async function sendQuestion() {
    const trimmed = question.trim();
    if (!trimmed) return setError("Question is required.");
    if (!routes.length) return setError("At least one route is required.");
    const executionMode: ExecutionMode = "sequential";
    console.debug("[Chat Testing] Send request", { courseId, knowledgeId, question: trimmed, mode, executionMode, routes });
    setError("");
    setLoading(true);
    const nextResults = routes.map((route) => pendingResult(route, trimmed));
    setResults(nextResults);
    try {
      for (const route of routes) {
        await runSingleRoute(route, trimmed, nextResults);
      }
      await saveRunSnapshot(nextResults, trimmed);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Chat testing failed.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function retryRoute(routeId: string) {
    const route = routes.find((item) => item.id === routeId);
    if (!route) return;
    const trimmed = question.trim();
    if (!trimmed) return setError("Question is required.");
    setError("");
    const nextResults = mergeResultsWithRoutes(routes, results).map((result) => ({ ...result }));
    setLoading(true);
    try {
      await runSingleRoute(route, trimmed, nextResults);
      await saveRunSnapshot(nextResults, trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retry failed.");
    } finally {
      setLoading(false);
    }
  }

  async function copyAnswer() {
    if (!readerResult?.answer) return;
    try {
      await navigator.clipboard.writeText(readerResult.answer);
      setCopyFeedback("copied");
    } catch {
      setCopyFeedback("failed");
    }
    window.setTimeout(() => setCopyFeedback(null), 1500);
  }

  const knowledgeTitle = state?.knowledgeTitle || knowledgeId;

  return (
    <div className="chat-testing-page">
      <div className="chat-testing-head">
        <div>
          <h1>Chat Testing</h1>
          <p className="subtitle">Ask the same question and compare how different setups respond.</p>
        </div>
        <div className="chat-testing-actions">
          <div className="context-pill"><BookOpen size={20} /> Current Knowledge: <strong>{knowledgeTitle}</strong></div>
          <button className="btn" onClick={openPrompts}><Settings size={18} /> Prompt Settings</button>
          <button className="btn" onClick={openRoutes}><Route size={18} /> Route Configuration</button>
          <div className="mode-control">
            <span>Mode:</span>
            <label><input type="radio" checked={mode === "lecture"} onChange={() => setMode("lecture")} /> Lecture</label>
            <label><input type="radio" checked={mode === "socratic"} onChange={() => setMode("socratic")} /> Socratic</label>
          </div>
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="chat-question-bar">
        <div className="chat-tabs"><button className="active">Study</button><button disabled>Understanding</button></div>
        <input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask a question..." />
        <button className="btn primary" onClick={sendQuestion} disabled={loading}><Send size={18} /> Send</button>
      </div>

      <div className={`chat-route-grid route-count-${Math.max(routes.length, 1)}`}>
        {mergeResultsWithRoutes(routes, results).map((result) => (
          <section className={`chat-result-card ${result.useKnowledge ? "with-ks" : "without-ks"}`} key={result.routeId}>
            <header>
              <strong>{result.modelLabel}</strong>
              <span className="readonly-pill">{result.useKnowledge ? result.releaseId : "No KS Wiki"}</span>
            </header>
            <div className="chat-transcript">
              {result.answer || result.error || loading ? (
                <>
                  <strong>You</strong>
                  <div className="question-bubble">{question}</div>
                  <strong className={result.useKnowledge ? "ai-tutor" : "ai-plain"}>{result.useKnowledge ? "AI Tutor" : "AI"}</strong>
                  {result.status ? <span className={`route-status status-${result.status}`}>{result.status}</span> : null}
                  {result.status === "pending" ? <div className="empty-state">Waiting to send this route...</div> : null}
                  {result.status === "loading" ? <div className="empty-state">Waiting for model response...</div> : null}
                  {result.status === "streaming" ? <div className="generating-label">Generating...</div> : null}
                  {result.error ? (
                    <div className="route-error-block">
                      <div className="route-error">{result.error}</div>
                      {result.status === "error" && routes.some((route) => route.id === result.routeId) ? (
                        <button className="btn secondary-blue retry-button" onClick={() => retryRoute(result.routeId)} disabled={loading}>
                          Retry
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  {result.answer ? <div className="answer-preview"><MarkdownAnswer content={result.answer} compact /></div> : null}
                  {result.status === "done" && result.answer ? (
                    <button className="btn secondary-blue answer-view-button" onClick={() => {
                      setCopyFeedback(null);
                      setReaderResult(result);
                    }}>Optimised View</button>
                  ) : null}
                  <span className="chat-time">{displayTime(result.createdAt)}</span>
                </>
              ) : (
                <div className="empty-state">Send a question to test this setup.</div>
              )}
            </div>
          </section>
        ))}
      </div>

      {promptOpen && draftPrompts ? (
        <div className="modal-backdrop">
          <div className="modal-card wide">
            <h2>Prompt Settings</h2>
            <label>Base Prompt<textarea value={draftPrompts.basePrompt} onChange={(event) => setDraftPrompts({ ...draftPrompts, basePrompt: event.target.value })} /></label>
            <label>Lecture Prompt<textarea value={draftPrompts.lecturePrompt} onChange={(event) => setDraftPrompts({ ...draftPrompts, lecturePrompt: event.target.value })} /></label>
            <label>Socratic Prompt<textarea value={draftPrompts.socraticPrompt} onChange={(event) => setDraftPrompts({ ...draftPrompts, socraticPrompt: event.target.value })} /></label>
            <label>Assessment Prompt<textarea value={draftPrompts.assessmentPrompt} disabled /></label>
            <div className="modal-actions"><button className="btn" onClick={() => setPromptOpen(false)}>Cancel</button><button className="btn primary" onClick={savePrompts}>Save</button></div>
          </div>
        </div>
      ) : null}

      {routeOpen && state ? (
        <div className="modal-backdrop">
          <div className="modal-card">
            <h2>Route Configuration</h2>
            <div className="route-editor-list">
              {draftRoutes.map((route, index) => (
                <div className="route-editor" key={route.id}>
                  <select value={route.model} onChange={(event) => patchDraftRoute(index, { model: event.target.value })}>
                    {state.models.map((model) => <option value={model.id} key={model.id}>{model.label}</option>)}
                  </select>
                  <select value={route.useKnowledge ? "ks" : "none"} onChange={(event) => patchDraftRoute(index, { useKnowledge: event.target.value === "ks" })}>
                    <option value="ks">Use KS Wiki</option>
                    <option value="none">No KS Wiki</option>
                  </select>
                  <select value={route.releaseId || ""} disabled={!route.useKnowledge} onChange={(event) => patchDraftRoute(index, { releaseId: event.target.value })}>
                    {state.releases.length ? state.releases.map((release) => <option value={release.id} key={release.id}>{release.id}</option>) : <option value="">No release available</option>}
                  </select>
                  <button className="icon-button danger" disabled={draftRoutes.length <= 1} onClick={() => setDraftRoutes(draftRoutes.filter((_, itemIndex) => itemIndex !== index))}>x</button>
                </div>
              ))}
            </div>
            <button className="btn secondary-blue" onClick={addRoute} disabled={draftRoutes.length >= 3}>Add Route</button>
            <div className="modal-actions"><button className="btn" onClick={() => setRouteOpen(false)}>Cancel</button><button className="btn primary" onClick={saveRoutes}>Save</button></div>
          </div>
        </div>
      ) : null}

      {readerResult ? (
        <div className="modal-backdrop">
          <div className="modal-card answer-reader-modal">
            <div className="answer-reader-head">
              <div>
                <h2>Optimised Answer View</h2>
                <div className="answer-reader-meta">
                  <span>Model: {readerResult.modelLabel}</span>
                  <span>Knowledge: {readerResult.useKnowledge ? readerResult.releaseId : "No KS Wiki"}</span>
                  <span>Mode: {mode === "lecture" ? "Lecture" : "Socratic"}</span>
                </div>
              </div>
            </div>
            <div className="answer-reader-body">
              <MarkdownAnswer content={readerResult.answer} />
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setReaderResult(null)}>Close</button>
              <button className="btn primary" onClick={copyAnswer}>
                {copyFeedback === "copied" ? "Copied" : copyFeedback === "failed" ? "Copy failed" : "Copy"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
