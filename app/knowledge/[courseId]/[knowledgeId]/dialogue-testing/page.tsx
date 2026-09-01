"use client";

import { FormEvent, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { BookOpen, Bot, ChevronDown, Download, Eye, RefreshCw, RotateCcw, Send, Settings, SlidersHorizontal, Upload, UserRound } from "lucide-react";
import { MarkdownAnswer } from "@/components/MarkdownAnswer";
import { ScienceModelCard } from "@/components/ScienceModelCard";

const STREAM_ERROR_PREFIX = "__DIALOGUE_TESTING_ERROR__:";
type CopyFeedback = "copied" | "failed" | null;

type Model = { id: string; label: string };
type Course = { id: string; title: string };
type Knowledge = { id: string; courseId: string; title: string };
type PublishedRelease = { id: string; publishedAt: string };
type Release = { id: string };
type ChatMode = "lecture" | "socratic";
type PromptSettings = {
  basePrompt: string;
  lecturePrompt: string;
  socraticPrompt: string;
  assessmentPrompt: string;
};
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
type DialogueReaderState = {
  route: DialogueRoute;
  message: DialogueMessage;
};
type KnowledgeImportResult = {
  courseId: string;
  knowledgeId: string;
  release: PublishedRelease;
  importResult?: { entryCount?: number };
};
type DialogueTestingSnapshot = {
  routeConfig?: { routes?: DialogueRoute[] };
};
type DialogueState = {
  knowledgeTitle: string;
  models: Model[];
  releases: Release[];
  promptSettings: PromptSettings;
  routeConfig: { routes: DialogueRoute[] };
  session: {
    mode: ChatMode;
    sessions: { routeId: string; messages: DialogueMessage[] }[];
  };
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

function routeShell(route: DialogueRoute): DialogueMessage[] {
  return [];
}

function safeFilePart(value: string) {
  return value.trim().replace(/[^a-z0-9\u4e00-\u9fa5._-]+/gi, "-").replace(/^-+|-+$/g, "") || "dialogue";
}

function normaliseComposerInput(value: string) {
  return value.replace(/^\s*\d+\.\s*(?=\S)/, "");
}

export default function DialogueTestingPage() {
  const pathname = usePathname();
  const router = useRouter();
  const parts = pathname.split("/").filter(Boolean);
  const courseId = parts[1] || "philosophy";
  const knowledgeId = parts[2] || "epicureanism";
  const query = `courseId=${encodeURIComponent(courseId)}&knowledgeId=${encodeURIComponent(knowledgeId)}`;

  const [state, setState] = useState<DialogueState | null>(null);
  const [mode, setMode] = useState<ChatMode>("lecture");
  const [routes, setRoutes] = useState<DialogueRoute[]>([]);
  const [messagesByRoute, setMessagesByRoute] = useState<Record<string, DialogueMessage[]>>({});
  const [inputsByRoute, setInputsByRoute] = useState<Record<string, string>>({});
  const [loadingByRoute, setLoadingByRoute] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");
  const [promptOpen, setPromptOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [draftPrompts, setDraftPrompts] = useState<PromptSettings | null>(null);
  const [draftRoutes, setDraftRoutes] = useState<DialogueRoute[]>([]);
  const [readerState, setReaderState] = useState<DialogueReaderState | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback>(null);
  const [knowledgeImportOpen, setKnowledgeImportOpen] = useState(false);
  const [courses, setCourses] = useState<Course[]>([]);
  const [knowledgeByCourse, setKnowledgeByCourse] = useState<Record<string, Knowledge[]>>({});
  const [targetCourseId, setTargetCourseId] = useState(courseId);
  const [targetKnowledgeId, setTargetKnowledgeId] = useState(knowledgeId);
  const [knowledgeFile, setKnowledgeFile] = useState<File | null>(null);
  const [knowledgeImporting, setKnowledgeImporting] = useState(false);
  const [knowledgeApplying, setKnowledgeApplying] = useState(false);
  const [knowledgeImportStatus, setKnowledgeImportStatus] = useState("");
  const [knowledgeReleases, setKnowledgeReleases] = useState<Record<string, PublishedRelease[]>>({});
  const [modelState, setModelState] = useState("");

  useEffect(() => { loadState(); }, [query]);

  async function loadState() {
    setError("");
    const res = await fetch(`/api/dialogue-testing?${query}`, { cache: "no-store" });
    const data = await res.json();
    const loadedRoutes = data.routeConfig?.routes || [];
    const sessionMap: Record<string, DialogueMessage[]> = {};
    for (const session of data.session?.sessions || []) {
      sessionMap[session.routeId] = session.messages || [];
    }
    if (sessionMap.legacy && loadedRoutes[0]) {
      sessionMap[loadedRoutes[0].id] = sessionMap.legacy;
      delete sessionMap.legacy;
    }
    setState(data);
    setMode(data.session?.mode || "lecture");
    setRoutes(loadedRoutes);
    setMessagesByRoute(sessionMap);
  }

  const knowledgeTitle = state?.knowledgeTitle || knowledgeId;
  const anyLoading = Object.values(loadingByRoute).some(Boolean);
  const selectedKnowledgeRelease = latestKnowledgeRelease(targetCourseId, targetKnowledgeId);
  const knowledgeBusy = knowledgeImporting || knowledgeApplying;

  function visibleMessages(routeId: string) {
    const messages = messagesByRoute[routeId] || [];
    return messages.length ? messages : [welcomeMessage(knowledgeTitle, mode)];
  }

  function latestViewableAssistantMessage(routeId: string) {
    const messages = messagesByRoute[routeId] || [];
    return [...messages].reverse().find((message) => (
      message.role === "assistant"
      && message.id !== "welcome"
      && !message.error
      && message.content.trim()
    )) || null;
  }

  function openPrompts() {
    if (!state) return;
    setDraftPrompts(state.promptSettings);
    setPromptOpen(true);
  }

  async function loadKnowledgeDirectories(initialCourseId = courseId) {
    const res = await fetch("/api/courses", { cache: "no-store" });
    const data = await res.json();
    const loadedCourses: Course[] = data.courses || [];
    setCourses(loadedCourses);
    const selectedCourseId = loadedCourses.some((course) => course.id === initialCourseId)
      ? initialCourseId
      : loadedCourses[0]?.id || initialCourseId;
    setTargetCourseId(selectedCourseId);
    await loadKnowledgeForCourse(selectedCourseId, selectedCourseId === courseId ? knowledgeId : undefined);
  }

  async function loadKnowledgeForCourse(nextCourseId: string, preferredKnowledgeId?: string) {
    if (!nextCourseId) return;
    const res = await fetch(`/api/courses/${encodeURIComponent(nextCourseId)}/knowledge`, { cache: "no-store" });
    const data = await res.json();
    const knowledgeItems: Knowledge[] = data.knowledge || [];
    setKnowledgeByCourse((current) => ({ ...current, [nextCourseId]: knowledgeItems }));
    void loadKnowledgeReleaseState(nextCourseId, knowledgeItems);
    const nextKnowledgeId = preferredKnowledgeId && knowledgeItems.some((item) => item.id === preferredKnowledgeId)
      ? preferredKnowledgeId
      : knowledgeItems[0]?.id || "";
    setTargetKnowledgeId(nextKnowledgeId);
  }

  function knowledgeReleaseKey(nextCourseId: string, nextKnowledgeId: string) {
    return `${nextCourseId}/${nextKnowledgeId}`;
  }

  function latestKnowledgeRelease(nextCourseId: string, nextKnowledgeId: string) {
    return knowledgeReleases[knowledgeReleaseKey(nextCourseId, nextKnowledgeId)]?.[0] || null;
  }

  async function loadKnowledgeReleaseState(nextCourseId: string, knowledgeItems: Knowledge[]) {
    const entries = await Promise.all(knowledgeItems.map(async (knowledge) => {
      try {
        const res = await fetch(`/api/releases?courseId=${encodeURIComponent(nextCourseId)}&knowledgeId=${encodeURIComponent(knowledge.id)}`, { cache: "no-store" });
        const data = await res.json();
        return [knowledgeReleaseKey(nextCourseId, knowledge.id), (data.releases || []) as PublishedRelease[]] as const;
      } catch {
        return [knowledgeReleaseKey(nextCourseId, knowledge.id), [] as PublishedRelease[]] as const;
      }
    }));
    setKnowledgeReleases((current) => ({ ...current, ...Object.fromEntries(entries) }));
  }

  async function openKnowledgeImport() {
    setKnowledgeImportOpen(true);
    setKnowledgeFile(null);
    setKnowledgeImportStatus("");
    setTargetCourseId(courseId);
    setTargetKnowledgeId(knowledgeId);
    await loadKnowledgeDirectories(courseId).catch((err) => setError(err instanceof Error ? err.message : "Load course directories failed."));
  }

  async function changeTargetCourse(nextCourseId: string) {
    setTargetCourseId(nextCourseId);
    if (knowledgeByCourse[nextCourseId]?.length) {
      setTargetKnowledgeId(knowledgeByCourse[nextCourseId][0].id);
      return;
    }
    await loadKnowledgeForCourse(nextCourseId);
  }

  async function applyReleaseToDialogue(nextCourseId: string, nextKnowledgeId: string, release: PublishedRelease) {
    const isCurrentKnowledge = nextCourseId === courseId && nextKnowledgeId === knowledgeId;
    let sourceRoutes = routes;
    if (!isCurrentKnowledge) {
      const res = await fetch(`/api/dialogue-testing?courseId=${encodeURIComponent(nextCourseId)}&knowledgeId=${encodeURIComponent(nextKnowledgeId)}`, { cache: "no-store" });
      const data = await res.json() as DialogueTestingSnapshot;
      sourceRoutes = data.routeConfig?.routes || [];
    }
    const nextRoutes = sourceRoutes.map((route) => ({ ...route, useKnowledge: true, releaseId: release.id }));
    if (nextRoutes.length) {
      const res = await fetch("/api/dialogue-testing/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseId: nextCourseId, knowledgeId: nextKnowledgeId, routes: nextRoutes })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Apply Current Knowledge failed.");
    }
    if (!isCurrentKnowledge) {
      router.push(`/knowledge/${nextCourseId}/${nextKnowledgeId}/dialogue-testing`);
      return;
    }
    setRoutes(nextRoutes);
    setState((current) => current ? {
      ...current,
      releases: [release, ...current.releases.filter((item) => item.id !== release.id)],
      routeConfig: { ...current.routeConfig, routes: nextRoutes }
    } : current);
  }

  async function activateImportedRelease(result: KnowledgeImportResult) {
    setKnowledgeReleases((current) => ({
      ...current,
      [knowledgeReleaseKey(result.courseId, result.knowledgeId)]: [
        result.release,
        ...(current[knowledgeReleaseKey(result.courseId, result.knowledgeId)] || []).filter((item) => item.id !== result.release.id)
      ]
    }));
    await applyReleaseToDialogue(result.courseId, result.knowledgeId, result.release);
  }

  async function applySelectedKnowledge() {
    const release = latestKnowledgeRelease(targetCourseId, targetKnowledgeId);
    if (!release) return;
    setError("");
    setKnowledgeApplying(true);
    setKnowledgeImportStatus("Applying selected Current Knowledge...");
    try {
      await applyReleaseToDialogue(targetCourseId, targetKnowledgeId, release);
      setKnowledgeImportOpen(false);
      setKnowledgeImportStatus("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Apply Current Knowledge failed.");
    } finally {
      setKnowledgeApplying(false);
    }
  }

  async function uploadKnowledgeFile(event: FormEvent) {
    event.preventDefault();
    if (!knowledgeFile || !targetCourseId || !targetKnowledgeId) return;
    setError("");
    setKnowledgeImporting(true);
    setKnowledgeImportStatus("Uploading file and importing source...");
    try {
      const form = new FormData();
      form.append("courseId", courseId);
      form.append("knowledgeId", knowledgeId);
      form.append("targetCourseId", targetCourseId);
      form.append("targetKnowledgeId", targetKnowledgeId);
      form.append("file", knowledgeFile);
      const res = await fetch("/api/dialogue-testing/import-knowledge", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import and publish knowledge failed.");
      setKnowledgeImportStatus("Published new Current Knowledge release.");
      await activateImportedRelease(data);
      setKnowledgeImportOpen(false);
      setKnowledgeFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import and publish knowledge failed.");
    } finally {
      setKnowledgeImporting(false);
    }
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

  function openConfig() {
    setDraftRoutes(routes.map((route) => ({ ...route })));
    setConfigOpen(true);
  }

  function patchDraftRoute(index: number, patch: Partial<DialogueRoute>) {
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
    const res = await fetch("/api/dialogue-testing/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseId, knowledgeId, routes: draftRoutes })
    });
    const data = await res.json();
    if (!res.ok) return setError(data.error || "Save route configuration failed.");
    setRoutes(data.routes);
    setMessagesByRoute((current) => Object.fromEntries(data.routes.map((route: DialogueRoute) => [route.id, current[route.id] || routeShell(route)])));
    setState((current) => current ? { ...current, routeConfig: data } : current);
    setConfigOpen(false);
  }

  async function resetSession() {
    setError("");
    const res = await fetch("/api/dialogue-testing/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseId, knowledgeId, mode })
    });
    const data = await res.json();
    if (!res.ok) return setError(data.error || "Reset session failed.");
    setMessagesByRoute({});
  }

  async function requestAssistantResponse(route: DialogueRoute, history: DialogueMessage[], userMessage: DialogueMessage, assistantShell: DialogueMessage) {
    setLoadingByRoute((current) => ({ ...current, [route.id]: true }));
    setError("");

    try {
      const res = await fetch("/api/dialogue-testing/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseId, knowledgeId, routeId: route.id, mode, config: route, messages: history, input: userMessage.content, modelState })
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
            setMessagesByRoute((current) => ({ ...current, [route.id]: [...history, resolvedUserMessage, { ...assistantShell, content: answer }] }));
          }
          throw new Error(chunk.slice(errorIndex + STREAM_ERROR_PREFIX.length).trim() || "Dialogue stream failed.");
        }
        answer += chunk;
        setMessagesByRoute((current) => ({ ...current, [route.id]: [...history, resolvedUserMessage, { ...assistantShell, content: answer }] }));
      }

      if (!answer.trim()) throw new Error("OpenRouter returned an empty answer for this dialogue.");
      setMessagesByRoute((current) => ({
        ...current,
        [route.id]: [...history, resolvedUserMessage, { ...assistantShell, content: answer, createdAt: new Date().toISOString() }]
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Dialogue send failed.";
      setError(message);
      setMessagesByRoute((current) => ({
        ...current,
        [route.id]: [...history, userMessage, {
          ...assistantShell,
          role: "assistant",
          content: message,
          createdAt: new Date().toISOString(),
          error: true
        }]
      }));
    } finally {
      setLoadingByRoute((current) => ({ ...current, [route.id]: false }));
    }
  }

  async function sendMessage(route: DialogueRoute, event?: FormEvent) {
    event?.preventDefault();
    const trimmed = normaliseComposerInput(inputsByRoute[route.id] || "").trim();
    if (!trimmed || loadingByRoute[route.id]) return;
    const history = messagesByRoute[route.id] || [];
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
    setMessagesByRoute((current) => ({ ...current, [route.id]: [...history, optimisticUser, assistantShell] }));
    setInputsByRoute((current) => ({ ...current, [route.id]: "" }));
    await requestAssistantResponse(route, history, optimisticUser, assistantShell);
  }

  async function retryAssistantMessage(route: DialogueRoute, assistantIndex: number) {
    if (loadingByRoute[route.id]) return;
    const messages = messagesByRoute[route.id] || [];
    const assistantMessage = messages[assistantIndex];
    if (!assistantMessage || assistantMessage.role !== "assistant") return;
    let userIndex = assistantIndex - 1;
    while (userIndex >= 0 && messages[userIndex].role !== "user") userIndex -= 1;
    if (userIndex < 0) return setError("No user message found for retry.");
    const userMessage = messages[userIndex];
    const history = messages.slice(0, userIndex);
    const assistantShell: DialogueMessage = {
      ...assistantMessage,
      content: "",
      error: undefined,
      createdAt: new Date().toISOString()
    };
    setMessagesByRoute((current) => ({ ...current, [route.id]: [...history, userMessage, assistantShell] }));
    await requestAssistantResponse(route, history, userMessage, assistantShell);
  }

  function openOptimisedView(route: DialogueRoute) {
    const message = latestViewableAssistantMessage(route.id);
    if (!message) {
      setError("No assistant answer is available for Optimised View yet.");
      return;
    }
    setCopyFeedback(null);
    setReaderState({ route, message });
  }

  async function copyAnswer() {
    if (!readerState?.message.content) return;
    try {
      await navigator.clipboard.writeText(readerState.message.content);
      setCopyFeedback("copied");
    } catch {
      setCopyFeedback("failed");
    }
    window.setTimeout(() => setCopyFeedback(null), 1500);
  }

  function conversationMessages(routeId: string) {
    return (messagesByRoute[routeId] || []).filter((message) => (
      message.id !== "welcome"
      && (message.role === "assistant" || message.role === "user")
      && message.content.trim()
    ));
  }

  function downloadBlob(content: string, filename: string, type: string) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function textTranscript(route: DialogueRoute, messages: DialogueMessage[]) {
    const metadata = [
      `Dialogue Testing Conversation`,
      `Knowledge: ${knowledgeTitle}`,
      `Model: ${route.modelLabel}`,
      `Knowledge Released Version: ${route.useKnowledge ? route.releaseId : "No KS Wiki"}`,
      `Mode: ${mode === "lecture" ? "Lecture" : "Socratic"}`,
      `Exported At: ${new Date().toISOString()}`
    ];
    const body = messages.map((message) => {
      const speaker = message.role === "assistant" ? "AI Tutor" : "User";
      return `[${message.createdAt}] ${speaker}:\n${message.content.trim()}`;
    });
    return [...metadata, "", ...body].join("\n\n");
  }

  function downloadConversation(route: DialogueRoute, format: "json" | "txt") {
    const messages = conversationMessages(route.id);
    if (!messages.length) {
      setError("No dialogue messages are available to download yet.");
      return;
    }

    const exportedAt = new Date().toISOString();
    const baseName = safeFilePart(`${knowledgeTitle}-${route.modelLabel}-${exportedAt.slice(0, 19)}`);
    if (format === "json") {
      const payload = {
        exportedAt,
        courseId,
        knowledgeId,
        knowledgeTitle,
        mode,
        route: {
          id: route.id,
          model: route.model,
          modelLabel: route.modelLabel,
          useKnowledge: route.useKnowledge,
          releaseId: route.releaseId
        },
        messages: messages.map((message) => ({
          id: message.id,
          speaker: message.role === "assistant" ? "AI Tutor" : "User",
          role: message.role,
          content: message.content,
          createdAt: message.createdAt,
          ...(message.error ? { error: true } : {})
        }))
      };
      downloadBlob(JSON.stringify(payload, null, 2), `${baseName}.json`, "application/json;charset=utf-8");
      return;
    }

    downloadBlob(textTranscript(route, messages), `${baseName}.txt`, "text/plain;charset=utf-8");
  }

  async function downloadKnowledgeMarkdown(route: DialogueRoute) {
    if (!route.useKnowledge || !route.releaseId) return;
    setError("");
    try {
      const res = await fetch(`/api/releases/${encodeURIComponent(route.releaseId)}/download?courseId=${encodeURIComponent(courseId)}&knowledgeId=${encodeURIComponent(knowledgeId)}`);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Download Knowledge Wiki markdown failed.");
      }
      const content = await res.text();
      const disposition = res.headers.get("Content-Disposition") || "";
      const fileName = disposition.match(/filename="([^"]+)"/)?.[1] || `${safeFilePart(route.releaseId)}.md`;
      downloadBlob(content, fileName, "text/markdown;charset=utf-8");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download Knowledge Wiki markdown failed.");
    }
  }

  return (
    <div className="dialogue-page">
      <div className="dialogue-head">
        <h1>Dialogue Testing</h1>
        <div className="dialogue-actions">
          <button className="context-pill context-pill-button" type="button" onClick={openKnowledgeImport} title="Upload or select Current Knowledge">
            <BookOpen size={20} /> Current Knowledge: <strong>{knowledgeTitle}</strong>
          </button>
          <button className="btn" onClick={openPrompts}><Settings size={18} /> Prompt Settings</button>
          <button className="btn" onClick={openConfig}><SlidersHorizontal size={18} /> Route Configuration</button>
          <label className="mode-select">
            <span>Mode:</span>
            <select value={mode} onChange={(event) => setMode(event.target.value as ChatMode)}>
              <option value="lecture">Lecture</option>
              <option value="socratic">Socratic</option>
            </select>
            <ChevronDown size={16} />
          </label>
          <button className="btn" onClick={resetSession} disabled={anyLoading}><RefreshCw size={18} /> Reset Sessions</button>
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      <ScienceModelCard knowledgeId={knowledgeId} onState={setModelState} />

      <div className={`dialogue-route-grid route-count-${Math.max(routes.length, 1)}`}>
        {routes.map((route) => {
          const routeLoading = Boolean(loadingByRoute[route.id]);
          const hasOptimisedView = Boolean(latestViewableAssistantMessage(route.id));
          return (
            <section className="dialogue-route-card" key={route.id}>
              <header>
                <strong>{route.modelLabel}</strong>
                <div className="dialogue-route-tools">
                  <span className="readonly-pill">{route.useKnowledge ? route.releaseId : "No KS Wiki"}</span>
                  <details className="dialogue-download-menu">
                    <summary className="btn secondary-blue dialogue-download-trigger">
                      <Download size={16} /> Download Conversation
                    </summary>
                    <div className="dialogue-download-options">
                      <button type="button" onClick={(event) => { downloadConversation(route, "json"); event.currentTarget.closest("details")?.removeAttribute("open"); }}>JSON</button>
                      <button type="button" onClick={(event) => { downloadConversation(route, "txt"); event.currentTarget.closest("details")?.removeAttribute("open"); }}>TXT</button>
                    </div>
                  </details>
                  <button
                    className="btn secondary-blue dialogue-download-trigger"
                    type="button"
                    onClick={() => downloadKnowledgeMarkdown(route)}
                    disabled={!route.useKnowledge || !route.releaseId}
                    title={route.useKnowledge && route.releaseId ? "Download Knowledge Wiki markdown" : "No KS Wiki is enabled for this route"}
                  >
                    <Download size={16} /> Download .md
                  </button>
                </div>
              </header>
              <section className="dialogue-panel">
                <div className="dialogue-scroll">
                  {visibleMessages(route.id).map((message, messageIndex) => (
                    <div className={`dialogue-row ${message.role} ${message.error ? "error" : ""}`} key={message.id}>
                      {message.role === "assistant" ? <div className="dialogue-avatar assistant"><Bot size={22} /></div> : null}
                      <div className="dialogue-message-wrap">
                        <div className="dialogue-speaker">{message.role === "assistant" ? "AI Tutor" : "You"}</div>
                        <div className="dialogue-bubble">
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
                            onClick={() => retryAssistantMessage(route, messageIndex)}
                            disabled={routeLoading}
                          >
                            <RotateCcw size={15} />
                          </button>
                        ) : null}
                      </div>
                      {message.role === "user" ? <div className="dialogue-avatar user"><UserRound size={22} /></div> : null}
                    </div>
                  ))}
                </div>
                <form className="dialogue-composer" onSubmit={(event) => sendMessage(route, event)}>
                  <button
                    className="icon-button dialogue-reader-button"
                    type="button"
                    aria-label="Open optimised view"
                    title={hasOptimisedView ? "Open Optimised View" : "No assistant answer available yet"}
                    onClick={() => openOptimisedView(route)}
                    disabled={!hasOptimisedView}
                  >
                    <Eye size={20} />
                  </button>
                  <input
                    value={inputsByRoute[route.id] || ""}
                    onChange={(event) => setInputsByRoute((current) => ({ ...current, [route.id]: normaliseComposerInput(event.target.value) }))}
                    placeholder="Type a message for this setup..."
                    disabled={routeLoading}
                  />
                  <button className="btn primary dialogue-send" type="submit" disabled={routeLoading || !(inputsByRoute[route.id] || "").trim()}><Send size={18} /> Send</button>
                </form>
              </section>
            </section>
          );
        })}
      </div>

      {promptOpen && draftPrompts ? (
        <div className="modal-backdrop">
          <div className="modal-card wide">
            <h2>Prompt Settings</h2>
            <label>Base Prompt<textarea value={draftPrompts.basePrompt} onChange={(event) => setDraftPrompts({ ...draftPrompts, basePrompt: event.target.value })} /></label>
            <label>Lecture Prompt<textarea value={draftPrompts.lecturePrompt} onChange={(event) => setDraftPrompts({ ...draftPrompts, lecturePrompt: event.target.value })} /></label>
            <label>Socratic Prompt<textarea value={draftPrompts.socraticPrompt} onChange={(event) => setDraftPrompts({ ...draftPrompts, socraticPrompt: event.target.value })} /></label>
            <label>Assessment Prompt<textarea value={draftPrompts.assessmentPrompt} onChange={(event) => setDraftPrompts({ ...draftPrompts, assessmentPrompt: event.target.value })} /></label>
            <div className="modal-actions"><button className="btn" onClick={() => setPromptOpen(false)}>Cancel</button><button className="btn primary" onClick={savePrompts}>Save</button></div>
          </div>
        </div>
      ) : null}

      {configOpen && state ? (
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
            <div className="modal-actions"><button className="btn" onClick={() => setConfigOpen(false)}>Cancel</button><button className="btn primary" onClick={saveRoutes}>Save</button></div>
          </div>
        </div>
      ) : null}

      {knowledgeImportOpen ? (
        <div className="modal-backdrop">
          <form className="modal-card knowledge-import-modal" onSubmit={uploadKnowledgeFile}>
            <h2>Upload or Select Current Knowledge</h2>
            <label>
              Course Directory
              <select value={targetCourseId} onChange={(event) => void changeTargetCourse(event.target.value)} disabled={knowledgeBusy}>
                {courses.map((course) => (
                  <option value={course.id} key={course.id}>{course.title}</option>
                ))}
              </select>
            </label>
            <label>
              Knowledge Directory
              <select
                className={selectedKnowledgeRelease ? "knowledge-select-has-wiki" : ""}
                value={targetKnowledgeId}
                onChange={(event) => setTargetKnowledgeId(event.target.value)}
                disabled={knowledgeBusy || !(knowledgeByCourse[targetCourseId] || []).length}
              >
                {(knowledgeByCourse[targetCourseId] || []).map((knowledge) => {
                  const hasWiki = Boolean(latestKnowledgeRelease(targetCourseId, knowledge.id));
                  return (
                    <option value={knowledge.id} key={knowledge.id} style={{ fontWeight: hasWiki ? 800 : 500 }}>
                      {knowledge.title}
                    </option>
                  );
                })}
              </select>
            </label>
            <label>
              Source File
              <input
                type="file"
                accept=".pdf,.txt,.doc,.docx,.md,application/pdf,text/plain,text/markdown,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={(event) => setKnowledgeFile(event.target.files?.[0] || null)}
                disabled={knowledgeBusy}
              />
            </label>
            {knowledgeImportStatus ? <div className="knowledge-import-status"><Upload size={17} /> {knowledgeImportStatus}</div> : null}
            <div className="modal-actions">
              <button className="btn" type="button" onClick={() => setKnowledgeImportOpen(false)} disabled={knowledgeBusy}>Cancel</button>
              <button className="btn secondary-blue" type="button" onClick={applySelectedKnowledge} disabled={knowledgeBusy || !selectedKnowledgeRelease}>
                {knowledgeApplying ? "Applying..." : "Apply"}
              </button>
              <button className="btn primary" type="submit" disabled={knowledgeBusy || !knowledgeFile || !targetKnowledgeId}>
                {knowledgeImporting ? "Publishing..." : "Upload & Publish"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {readerState ? (
        <div className="modal-backdrop">
          <div className="modal-card answer-reader-modal">
            <div className="answer-reader-head">
              <div>
                <h2>Optimised Answer View</h2>
                <div className="answer-reader-meta">
                  <span>Model: {readerState.route.modelLabel}</span>
                  <span>Knowledge: {readerState.route.useKnowledge ? readerState.route.releaseId : "No KS Wiki"}</span>
                  <span>Mode: {mode === "lecture" ? "Lecture" : "Socratic"}</span>
                </div>
              </div>
            </div>
            <div className="answer-reader-body">
              <MarkdownAnswer content={readerState.message.content} />
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setReaderState(null)}>Close</button>
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
