"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";

type Model = { label: string; id: string; note?: string };
type Message = { role: "user" | "assistant"; content: string };
type Prompts = { base: string; lecture: string; socratic: string };

type Props = {
  models: Model[];
  knowledgePack: unknown;
  sources: string;
  professorMaterial: string;
  prompts: Prompts;
};

type KnowledgeDraft = {
  topic?: string;
  title?: string;
  status?: string;
  summary?: string;
  sections?: { title: string; body?: string; bullets?: string[] }[];
  sourceReferences?: string[];
  learningObjectives: unknown[];
  sourcePriorities: unknown[];
  misunderstandingMaps: unknown[];
  teachingSequences: unknown[];
  socraticPromptPatterns: unknown[];
  editorialStandards: unknown[];
  answerRubric: unknown[];
  materialDigest?: string;
};

type SourceState = {
  videoLinks: string[];
  files: { name: string; storedAs?: string; chars?: number; error?: string }[];
  qa: { name: string; storedAs?: string; chars?: number; error?: string }[];
  materialText: string;
};

type PublishStatus = {
  status: string;
  topic: string;
  file: string;
  markdownChars: number;
  publishedAt: string;
} | null;

type CourseNode = {
  id: string;
  title: string;
  type: "course" | "knowledge";
  children?: CourseNode[];
};

const EXAMPLES = [
  "Did Epicurus believe pleasure means indulgence?",
  "Why is friendship so important in Epicurean philosophy?",
  "Is Epicureanism selfish?",
  "My answer: Epicurus says pleasure means enjoying luxury. Is that right?"
];

const DEFAULT_SOCRATIC_PROMPTS = [
  "What do people usually mean when they say \"pleasure\"?",
  "If a pleasure creates more anxiety later, would Epicurus still call it a good pleasure?",
  "Why might friendship matter more than wealth in Epicurean life?",
  "What kind of desire is natural, and what kind is socially manufactured?"
];

const DEFAULT_KNOWLEDGE_DRAFT: KnowledgeDraft = {
  learningObjectives: [
    "Understand Epicurean pleasure beyond indulgence",
    "Distinguish natural and unnecessary desires",
    "Explain the role of friendship in Epicurean ethics",
    "Apply Epicurean ideas to modern life"
  ],
  sourcePriorities: [
    "Use Epicurus' Letter to Menoeceus for pleasure, desire, fear, and prudence.",
    "Use Principal Doctrines for the limit of pleasure and friendship."
  ],
  misunderstandingMaps: [
    "Epicureanism = indulgence",
    "Pleasure = stimulation",
    "Wealth naturally creates happiness",
    "Friendship is secondary to success"
  ],
  teachingSequences: [
    "Start from student misconception",
    "Connect to everyday experience",
    "Introduce emotional problem",
    "Present Epicurean framework",
    "Encourage reflection"
  ],
  socraticPromptPatterns: [
    "Ask students to define key concepts.",
    "Use contradiction discovery.",
    "Move from daily life to philosophical ideas.",
    "Delay technical terminology."
  ],
  editorialStandards: [
    "Explain ideas in historical context first.",
    "Avoid immediate moral judgement.",
    "Encourage multiple interpretations.",
    "Treat philosophy as a lived practice."
  ],
  answerRubric: [
    "Defines pleasure accurately.",
    "Mentions judgement about pleasures and pains.",
    "Uses at least one source or course example.",
    "Avoids the indulgence misunderstanding."
  ],
  materialDigest: ""
};

const REQUEST_TIMEOUT_MS = 50_000;

function requestTimeoutError(label: string) {
  return `${label} timed out after ${REQUEST_TIMEOUT_MS / 1000}s. Try another model or retry later.`;
}

function stringifyDraftValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("misunderstanding" in record && "correction" in record) {
      return `${stringifyDraftValue(record.misunderstanding)} -> ${stringifyDraftValue(record.correction)}`;
    }
    if ("criterion" in record && "goodAnswer" in record) {
      return `${stringifyDraftValue(record.criterion)} -> ${stringifyDraftValue(record.goodAnswer)}`;
    }
    if ("source" in record && "useFor" in record) {
      return `${stringifyDraftValue(record.source)} -> ${stringifyDraftValue(record.useFor)}`;
    }
    return Object.entries(record)
      .map(([key, item]) => `${key}: ${stringifyDraftValue(item)}`)
      .join("; ");
  }
  return "";
}

function formatDraftList(value: unknown): string {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list.map(stringifyDraftValue).filter(Boolean).join("\n");
}

function parseDraftLines(value: string): string[] {
  return value.split("\n").map((item) => item.trim()).filter(Boolean);
}

function normaliseList(value: unknown): string[] {
  return parseDraftLines(formatDraftList(value));
}

async function readJsonResponse(response: Response) {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(text.slice(0, 500) || "Server returned an invalid response.");
  }
}

export default function ChatApp({
  models,
  knowledgePack,
  sources,
  professorMaterial,
  prompts: initialPrompts
}: Props) {
  const [view, setView] = useState<"knowledge" | "chat">("knowledge");
  const [topic, setTopic] = useState("Epicureanism");
  const [model, setModel] = useState(models[0]?.id || "");
  const [mode, setMode] = useState<"lecture" | "socratic">("lecture");
  const [prompts, setPrompts] = useState(initialPrompts);
  const [runtimeKnowledgePack, setRuntimeKnowledgePack] = useState(knowledgePack);

  const [material, setMaterial] = useState(professorMaterial);
  const [prepStep, setPrepStep] = useState<1 | 2 | 3 | 4>(1);
  const [videoLinks, setVideoLinks] = useState([""]);
  const [sourceState, setSourceState] = useState<SourceState>({
    videoLinks: [],
    files: [],
    qa: [],
    materialText: professorMaterial
  });
  const [extractionRequirements, setExtractionRequirements] = useState(
    "Extract wiki entries for key concepts, misunderstandings, teaching examples, source references, and follow-up questions."
  );
  const [sourceLoading, setSourceLoading] = useState(false);
  const [publishStatus, setPublishStatus] = useState<PublishStatus>(null);
  const [socraticPrompts, setSocraticPrompts] = useState(DEFAULT_SOCRATIC_PROMPTS);
  const [knowledgeDraft, setKnowledgeDraft] = useState<KnowledgeDraft | null>(null);
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftWarning, setDraftWarning] = useState("");

  const [message, setMessage] = useState(EXAMPLES[0]);
  const [history, setHistory] = useState<Message[]>([]);
  const [assistantDraft, setAssistantDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showConfig, setShowConfig] = useState(true);
  const [showRuntimeContext, setShowRuntimeContext] = useState(true);

  const compactHistory = useMemo(() => history.slice(-6), [history]);
  const runtimeContextPreview = useMemo(
    () => ({
      model,
      topic,
      mode,
      memoryTurnsSent: compactHistory.length,
      knowledgePack: runtimeKnowledgePack,
      sourceExcerptChars: sources.length,
      promptPacketOrder: [
        "base prompt",
        `${mode} prompt`,
        "approved runtime knowledge pack",
        "source excerpts",
        "last six conversation turns",
        "current student turn"
      ]
    }),
    [compactHistory.length, mode, model, runtimeKnowledgePack, sources.length, topic]
  );

  async function send() {
    const trimmed = message.trim();
    if (!trimmed || loading) return;

    setError("");
    setLoading(true);
    setAssistantDraft("");

    const userMessage: Message = { role: "user", content: trimmed };
    const nextHistory = [...history, userMessage];
    setHistory(nextHistory);
    setMessage("");

    const abortController = new AbortController();
    const timeout = window.setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        signal: abortController.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          topic,
          mode,
          message: trimmed,
          history: compactHistory,
          prompts,
          knowledgePack: runtimeKnowledgePack,
          sources
        })
      });

      if (!response.ok || !response.body) throw new Error(await response.text());

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        assistantText += decoder.decode(value, { stream: true });
        setAssistantDraft(assistantText);
      }

      setHistory([...nextHistory, { role: "assistant", content: assistantText }]);
      setAssistantDraft("");
    } catch (err) {
      setError(
        err instanceof Error && err.name === "AbortError"
          ? requestTimeoutError("Chat request")
          : err instanceof Error
            ? err.message
            : "Request failed"
      );
    } finally {
      window.clearTimeout(timeout);
      setLoading(false);
    }
  }

  async function extractFile(file: File) {
    const form = new FormData();
    form.append("file", file);
    const response = await fetch("/api/extract-material", { method: "POST", body: form });
    const data = await readJsonResponse(response);
    if (!response.ok) {
      setDraftWarning(data.error || "Could not extract file.");
      return;
    }
    setMaterial(data.text || "");
  }

  async function uploadSourceMaterials(fileList: FileList | null, qaFileList: FileList | null) {
    setSourceLoading(true);
    setDraftWarning("");
    try {
      const form = new FormData();
      form.append("topic", topic);
      for (const link of videoLinks.map((item) => item.trim()).filter(Boolean)) {
        form.append("videoLinks", link);
      }
      for (const file of Array.from(fileList || [])) form.append("files", file);
      for (const file of Array.from(qaFileList || [])) form.append("qaFiles", file);

      const response = await fetch("/api/wiki/source-materials", { method: "POST", body: form });
      const data = await readJsonResponse(response);
      if (!response.ok) throw new Error(data.error || "Source upload failed.");
      setSourceState({
        videoLinks: data.sources.video || [],
        files: data.sources.file || [],
        qa: data.sources.qa || [],
        materialText: data.materialText || material
      });
      setMaterial([material, data.materialText].filter(Boolean).join("\n\n"));
      setPrepStep(2);
    } catch (err) {
      setDraftWarning(err instanceof Error ? err.message : "Source upload failed.");
    } finally {
      setSourceLoading(false);
    }
  }

  async function generateKnowledgeDraft() {
    setDraftLoading(true);
    setDraftWarning("");
    const abortController = new AbortController();
    const timeout = window.setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch("/api/knowledge-draft", {
        method: "POST",
        signal: abortController.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          topic,
          material,
          socraticPrompts,
          extractionRequirements,
          currentPack: runtimeKnowledgePack
        })
      });
      const data = await readJsonResponse(response);
      if (!response.ok) {
        throw new Error(data.error || data.warning || "Draft generation failed.");
      }
      if (!data.draft) {
        throw new Error("Model response did not include a draft.");
      }
      setKnowledgeDraft(data.draft);
      setPrepStep(3);
      if (data.warning) setDraftWarning(data.warning);
    } catch (err) {
      setDraftWarning(
        err instanceof Error && err.name === "AbortError"
          ? requestTimeoutError("Draft generation")
          : err instanceof Error
            ? err.message
            : "Draft generation failed."
      );
    } finally {
      window.clearTimeout(timeout);
      setDraftLoading(false);
    }
  }

  function approveDraft() {
    if (!knowledgeDraft) return;
    setRuntimeKnowledgePack({
      topic,
      scope: "Runtime pack generated from professor material and Socratic prompts.",
      sourcePriorities: normaliseList(knowledgeDraft.sourcePriorities),
      topicFrame: {
        learningObjectives: normaliseList(knowledgeDraft.learningObjectives),
        teachingSequence: normaliseList(knowledgeDraft.teachingSequences)
      },
      misconceptions: normaliseList(knowledgeDraft.misunderstandingMaps),
      rubric: normaliseList(knowledgeDraft.answerRubric),
      editorialRules: normaliseList(knowledgeDraft.editorialStandards),
      socraticPromptPatterns: normaliseList(knowledgeDraft.socraticPromptPatterns),
      materialDigest: knowledgeDraft.materialDigest
    });
    setView("chat");
  }

  async function saveWikiDraft() {
    if (!knowledgeDraft) return;
    setDraftWarning("");
    const response = await fetch("/api/wiki/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic, draft: { ...knowledgeDraft, topic } })
    });
    const data = await readJsonResponse(response);
    if (!response.ok) {
      setDraftWarning(data.error || "Save draft failed.");
      return;
    }
    setDraftWarning(`Draft saved: ${data.file}`);
  }

  async function publishWikiDraft() {
    if (!knowledgeDraft) return;
    setDraftWarning("");
    const response = await fetch("/api/wiki/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic, draft: { ...knowledgeDraft, topic, status: "Published" } })
    });
    const data = await readJsonResponse(response);
    if (!response.ok) {
      setDraftWarning(data.error || "Publish failed.");
      return;
    }
    setPublishStatus(data);
    setPrepStep(4);
  }

function updateDraftList(key: keyof KnowledgeDraft, value: string) {
    if (!knowledgeDraft) {
      setKnowledgeDraft({
        ...DEFAULT_KNOWLEDGE_DRAFT,
        [key]: parseDraftLines(value)
      });
      return;
    }
    setKnowledgeDraft({
      ...knowledgeDraft,
      [key]: parseDraftLines(value)
    });
  }

  return (
    <main className="shell">
      {view === "chat" ? (
        <header className="topbar">
          <div>
            <h1>Epicureanism AI Tutor Demo</h1>
            <p>Knowledge ingestion, editable prompts, OpenRouter streaming, six-turn context.</p>
          </div>
          <div className="topActions">
            <div className="segmented nav">
              <button onClick={() => setView("knowledge")}>
                Knowledge Preparation
              </button>
              <button className="active" onClick={() => setView("chat")}>
                Runtime Chat
              </button>
            </div>
            <button className="ghost" onClick={() => setShowConfig(!showConfig)}>
              {showConfig ? "Hide setup" : "Show setup"}
            </button>
          </div>
        </header>
      ) : null}

      {view === "knowledge" ? (
        <KnowledgePreparation
          material={material}
          setMaterial={setMaterial}
          topic={topic}
          setTopic={setTopic}
          prepStep={prepStep}
          setPrepStep={setPrepStep}
          videoLinks={videoLinks}
          setVideoLinks={setVideoLinks}
          sourceState={sourceState}
          extractionRequirements={extractionRequirements}
          setExtractionRequirements={setExtractionRequirements}
          sourceLoading={sourceLoading}
          uploadSourceMaterials={uploadSourceMaterials}
          knowledgeDraft={knowledgeDraft}
          draftLoading={draftLoading}
          draftWarning={draftWarning}
          extractFile={extractFile}
          generateKnowledgeDraft={generateKnowledgeDraft}
          approveDraft={approveDraft}
          updateDraftList={updateDraftList}
          setKnowledgeDraft={setKnowledgeDraft}
          saveWikiDraft={saveWikiDraft}
          publishWikiDraft={publishWikiDraft}
          publishStatus={publishStatus}
          socraticPrompts={socraticPrompts}
          setSocraticPrompts={setSocraticPrompts}
        />
      ) : (
        <section className="workspace">
          {showConfig ? (
            <aside className="panel setup">
              <div className="field">
                <label>Topic</label>
                <input className="textInput" value={topic} onChange={(event) => setTopic(event.target.value)} />
              </div>

              <div className="field">
                <label>Model</label>
                <select value={model} onChange={(event) => setModel(event.target.value)}>
                  {models.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label} · {item.id}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label>Mode</label>
                <div className="segmented">
                  <button className={mode === "lecture" ? "active" : ""} onClick={() => setMode("lecture")}>
                    Lecture
                  </button>
                  <button className={mode === "socratic" ? "active" : ""} onClick={() => setMode("socratic")}>
                    Socratic
                  </button>
                </div>
              </div>

              <PromptEditor title="Base Prompt" value={prompts.base} onChange={(base) => setPrompts({ ...prompts, base })} />
              <PromptEditor title="Lecture Prompt" value={prompts.lecture} onChange={(lecture) => setPrompts({ ...prompts, lecture })} />
              <PromptEditor title="Socratic Prompt" value={prompts.socratic} onChange={(socratic) => setPrompts({ ...prompts, socratic })} />
            </aside>
          ) : null}

          <section className="panel chat">
            <div className="chatHeader">
              <div>
                <h2>Conversation</h2>
                <p>Uses approved KS Wiki + source excerpts + last six turns.</p>
              </div>
              <div className="chatHeaderActions">
                <button className="ghost" onClick={() => setShowRuntimeContext(!showRuntimeContext)}>
                  {showRuntimeContext ? "Hide Runtime Context" : "Show Runtime Context"}
                </button>
                <button
                  className="ghost"
                  onClick={() => {
                    setHistory([]);
                    setAssistantDraft("");
                    setError("");
                  }}
                >
                  Clear
                </button>
              </div>
            </div>

            {showRuntimeContext ? (
              <section className="runtimeContext">
                <div className="runtimeSummary">
                  <div>
                    <span>Model</span>
                    <strong>{model}</strong>
                  </div>
                  <div>
                    <span>Mode</span>
                    <strong>{mode}</strong>
                  </div>
                  <div>
                    <span>Memory</span>
                    <strong>{compactHistory.length}/6 turns</strong>
                  </div>
                  <div>
                    <span>Knowledge</span>
                    <strong>approved runtime pack</strong>
                  </div>
                </div>
                <details>
                  <summary>View prompt packet inputs</summary>
                  <pre>{JSON.stringify(runtimeContextPreview, null, 2)}</pre>
                </details>
              </section>
            ) : null}

            <div className="examples">
              {EXAMPLES.map((example) => (
                <button key={example} onClick={() => setMessage(example)}>
                  {example}
                </button>
              ))}
            </div>

            <div className="messages">
              {history.length === 0 ? (
                <div className="empty">Ask a question, or paste a student answer for rubric-style feedback.</div>
              ) : null}
              {history.map((item, index) => (
                <article key={`${item.role}-${index}`} className={`message ${item.role}`}>
                  <div className="role">{item.role === "user" ? "Student" : "AI Tutor"}</div>
                  <div className="content">{item.content}</div>
                </article>
              ))}
              {assistantDraft ? (
                <article className="message assistant">
                  <div className="role">AI Tutor</div>
                  <div className="content">{assistantDraft}</div>
                </article>
              ) : null}
            </div>

            {error ? <div className="error">{error}</div> : null}

            <div className="composer">
              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) send();
                }}
                placeholder="Ask about Epicureanism..."
              />
              <button onClick={send} disabled={loading || !message.trim()}>
                {loading ? "Streaming..." : "Send"}
              </button>
            </div>
          </section>

          <aside className="panel knowledge">
            <h2>Runtime Pack</h2>
            <pre>{JSON.stringify(runtimeKnowledgePack, null, 2)}</pre>
            <h2>Source Excerpts</h2>
            <pre>{sources}</pre>
          </aside>
        </section>
      )}
    </main>
  );
}

function KnowledgePreparation({
  material,
  setMaterial,
  topic,
  setTopic,
  prepStep,
  setPrepStep,
  videoLinks,
  setVideoLinks,
  sourceState,
  extractionRequirements,
  setExtractionRequirements,
  sourceLoading,
  uploadSourceMaterials,
  knowledgeDraft,
  draftLoading,
  draftWarning,
  extractFile,
  generateKnowledgeDraft,
  approveDraft,
  updateDraftList,
  setKnowledgeDraft,
  saveWikiDraft,
  publishWikiDraft,
  publishStatus,
  socraticPrompts,
  setSocraticPrompts
}: {
  material: string;
  setMaterial: (value: string) => void;
  topic: string;
  setTopic: (value: string) => void;
  prepStep: 1 | 2 | 3 | 4;
  setPrepStep: (value: 1 | 2 | 3 | 4) => void;
  videoLinks: string[];
  setVideoLinks: (value: string[]) => void;
  sourceState: SourceState;
  extractionRequirements: string;
  setExtractionRequirements: (value: string) => void;
  sourceLoading: boolean;
  uploadSourceMaterials: (fileList: FileList | null, qaFileList: FileList | null) => void;
  knowledgeDraft: KnowledgeDraft | null;
  draftLoading: boolean;
  draftWarning: string;
  extractFile: (file: File) => void;
  generateKnowledgeDraft: () => void;
  approveDraft: () => void;
  updateDraftList: (key: keyof KnowledgeDraft, value: string) => void;
  setKnowledgeDraft: (value: KnowledgeDraft) => void;
  saveWikiDraft: () => void;
  publishWikiDraft: () => void;
  publishStatus: PublishStatus;
  socraticPrompts: string[];
  setSocraticPrompts: (value: string[]) => void;
}) {
  const draft = knowledgeDraft;
  const [fileInput, setFileInput] = useState<FileList | null>(null);
  const [qaInput, setQaInput] = useState<FileList | null>(null);
  const [courseTree, setCourseTree] = useState<CourseNode[]>([
    {
      id: "course-epicureanism",
      title: "Epicureanism",
      type: "course",
      children: [
        { id: "knowledge-overview", title: "Overview", type: "knowledge" },
        { id: "knowledge-pleasure", title: "Pleasure", type: "knowledge" },
        { id: "knowledge-desire", title: "Desire", type: "knowledge" }
      ]
    }
  ]);
  const [selectedNodeId, setSelectedNodeId] = useState("knowledge-desire");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/wiki/tree")
      .then(readJsonResponse)
      .then((data) => {
        if (!cancelled && Array.isArray(data.tree)) setCourseTree(data.tree);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveCourseTree(nextTree: CourseNode[]) {
    setCourseTree(nextTree);
    await fetch("/api/wiki/tree", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tree: nextTree })
    }).catch(() => {});
  }

  function updatePrompt(index: number, value: string) {
    setSocraticPrompts(socraticPrompts.map((item, itemIndex) => (itemIndex === index ? value : item)));
  }

  function addPrompt() {
    setSocraticPrompts([...socraticPrompts, "Add a guiding discussion question here."]);
  }

  function updateSection(index: number, field: "title" | "body" | "bullets", value: string) {
    if (!draft) return;
    const sections = [...(draft.sections || [])];
    const current = sections[index] || { title: "", body: "", bullets: [] };
    sections[index] = {
      ...current,
      [field]: field === "bullets" ? parseDraftLines(value) : value
    };
    setKnowledgeDraft({ ...draft, sections });
  }

  function addVideoLink() {
    setVideoLinks([...videoLinks, ""]);
  }

  function addRootCourse() {
    const title = window.prompt("Course name");
    if (!title?.trim()) return;
    void saveCourseTree([
      ...courseTree,
      { id: `course-${Date.now()}`, title: title.trim(), type: "course", children: [] }
    ]);
  }

  function addChild(parentId: string, type: "course" | "knowledge") {
    const title = window.prompt(type === "course" ? "Sub-course name" : "Knowledge name");
    if (!title?.trim()) return;
    const child: CourseNode = { id: `${type}-${Date.now()}`, title: title.trim(), type, children: type === "course" ? [] : undefined };
    const insert = (nodes: CourseNode[]): CourseNode[] =>
      nodes.map((node) => {
        if (node.id === parentId && node.type === "course") {
          return { ...node, children: [...(node.children || []), child] };
        }
        return { ...node, children: node.children ? insert(node.children) : node.children };
      });
    void saveCourseTree(insert(courseTree));
  }

  function renderCourseNode(node: CourseNode, depth = 0): ReactNode {
    return (
      <div className="treeNode" key={node.id} style={{ paddingLeft: depth * 14 }}>
        <button
          className={`treeNodeButton ${selectedNodeId === node.id ? "selected" : ""}`}
          onClick={() => {
            setSelectedNodeId(node.id);
            if (node.type === "knowledge") setTopic(node.title);
          }}
        >
          <span>{node.type === "course" ? "Course" : "Knowledge"}</span>
          {node.title}
        </button>
        {node.type === "course" ? (
          <div className="treeActions">
            <button onClick={() => addChild(node.id, "course")}>+ Course</button>
            <button onClick={() => addChild(node.id, "knowledge")}>+ Knowledge</button>
          </div>
        ) : null}
        {node.children?.map((child) => renderCourseNode(child, depth + 1))}
      </div>
    );
  }

  function stepClass(step: 1 | 2 | 3 | 4) {
    return prepStep === step ? "active" : prepStep > step ? "done" : "";
  }

  const savedFileCount = sourceState.files.filter((item) => item.storedAs).length;
  const savedQaCount = sourceState.qa.filter((item) => item.storedAs).length;

  return (
    <section className="ksShell">
      <header className="ksHeader">
        <div className="ksBrand">
          <div className="ksLogo">KS</div>
          <div>
            <h1>KS Wiki</h1>
            <p>LLM-Generated · Expert-Edited</p>
          </div>
        </div>
        <nav className="ksSteps">
          <button className={stepClass(1)} onClick={() => setPrepStep(1)}><span>1</span>Source Materials</button>
          <button className={stepClass(2)} onClick={() => setPrepStep(2)}><span>2</span>LLM Draft</button>
          <button className={stepClass(3)} onClick={() => setPrepStep(3)}><span>3</span>AI Wiki Article</button>
          <button className={stepClass(4)} onClick={() => setPrepStep(4)}><span>4</span>Publish</button>
        </nav>
        <button className="saveDraftButton" onClick={saveWikiDraft} disabled={!draft}>Save Draft</button>
      </header>

      <section className="ksWorkspace">
        <aside className="ksSidebar">
          <label className="field">
            <span>Topic</span>
            <input className="textInput" value={topic} onChange={(event) => setTopic(event.target.value)} />
          </label>
          <div className="kbGroup">
            <div className="treeHeader">
              <strong>Course Knowledge Base</strong>
              <button onClick={addRootCourse}>+ Course</button>
            </div>
            <div className="courseTree">
              {courseTree.map((node) => renderCourseNode(node))}
            </div>
          </div>
          <div className="kbGroup">
            <strong>Source Materials</strong>
            <span>Video <b>{sourceState.videoLinks.length}</b></span>
            <span>Document <b>{savedFileCount}</b></span>
            <span>QA Notes <b>{savedQaCount}</b></span>
          </div>
        </aside>

        <main className="ksMain">
          {draftWarning ? <div className="warning">{draftWarning.slice(0, 900)}</div> : null}

          {prepStep === 1 ? (
            <section className="ksPanel">
              <h2>1. Source Materials</h2>
              <p>Provide video links, source files, and Q&A notes. Files are saved locally, not in SQL.</p>
              <div className="sourceGrid">
                <div className="sourceCard">
                  <h3>Video</h3>
                  <p>Edit links for lecture recordings or transcripts.</p>
                  {videoLinks.map((link, index) => (
                    <input
                      className="textInput"
                      key={index}
                      value={link}
                      placeholder="https://..."
                      onChange={(event) => setVideoLinks(videoLinks.map((item, itemIndex) => itemIndex === index ? event.target.value : item))}
                    />
                  ))}
                  <button className="outlineButton" onClick={addVideoLink}>+ Add Video Link</button>
                </div>
                <div className="sourceCard">
                  <h3>File</h3>
                  <p>Upload multiple source files: PDF, TXT, DOC, DOCX.</p>
                  <input type="file" multiple accept=".pdf,.txt,.doc,.docx" onChange={(event) => setFileInput(event.target.files)} />
                  <small>{fileInput?.length || 0} selected</small>
                </div>
                <div className="sourceCard">
                  <h3>Q&A Notes</h3>
                  <p>Upload multiple discussion/Q&A files: PDF, TXT, DOC, DOCX.</p>
                  <input type="file" multiple accept=".pdf,.txt,.doc,.docx" onChange={(event) => setQaInput(event.target.files)} />
                  <small>{qaInput?.length || 0} selected</small>
                </div>
              </div>
              <button className="primaryWide" onClick={() => uploadSourceMaterials(fileInput, qaInput)} disabled={sourceLoading}>
                {sourceLoading ? "Saving Sources..." : "Save Sources and Continue"}
              </button>
            </section>
          ) : null}

          {prepStep === 2 ? (
            <section className="ksPanel">
              <h2>2. LLM Draft Requirements</h2>
              <p>Tell the model what wiki entries to extract and how the article should be structured.</p>
              <textarea className="requirementsInput" value={extractionRequirements} onChange={(event) => setExtractionRequirements(event.target.value)} />
              <div className="promptList compactList">
                {socraticPrompts.map((prompt, index) => (
                  <label className="questionItem" key={`${index}-${prompt.slice(0, 12)}`}>
                    <span>Q{index + 1}</span>
                    <textarea value={prompt} onChange={(event) => updatePrompt(index, event.target.value)} />
                    <b aria-hidden="true">::</b>
                  </label>
                ))}
              </div>
              <button className="outlineButton" onClick={addPrompt}>+ Add Professor Prompt</button>
              <button className="generateHeroButton" onClick={generateKnowledgeDraft} disabled={draftLoading || !material.trim()}>
                {draftLoading ? "Generating Draft..." : "Generate Draft"}
              </button>
            </section>
          ) : null}

          {prepStep === 3 ? (
            <section className="wikiArticle">
              <div className="articleTop">
                <input
                  className="articleTitle"
                  value={draft?.title || ""}
                  placeholder="Article title"
                  onChange={(event) => draft && setKnowledgeDraft({ ...draft, title: event.target.value })}
                />
                <div className="statusPills"><span>AI Draft</span><span>Expert Revised</span></div>
              </div>
              {draft?.sections?.length ? draft.sections.map((section, index) => (
                <section className="articleSection" key={`${section.title}-${index}`}>
                  <input value={section.title} onChange={(event) => updateSection(index, "title", event.target.value)} />
                  <textarea value={section.body || ""} onChange={(event) => updateSection(index, "body", event.target.value)} />
                  <textarea value={(section.bullets || []).join("\n")} onChange={(event) => updateSection(index, "bullets", event.target.value)} />
                </section>
              )) : (
                <div className="draftEmpty">
                  <strong>No AI wiki article yet</strong>
                  <span>Go to step 2 and generate a draft.</span>
                </div>
              )}
              <div className="draftFooter">
                <button className="saveDraftButton" onClick={saveWikiDraft} disabled={!draft}>Save Draft</button>
                <button className="primaryWide" onClick={publishWikiDraft} disabled={!draft}>Confirm and Publish</button>
              </div>
            </section>
          ) : null}

          {prepStep === 4 ? (
            <section className="ksPanel publishPanel">
              <h2>4. Publish Status</h2>
              {publishStatus ? (
                <>
                  <strong>Published successfully</strong>
                  <p>Topic: {publishStatus.topic}</p>
                  <p>Markdown chars: {publishStatus.markdownChars}</p>
                  <pre>{publishStatus.file}</pre>
                  <button className="primaryWide" onClick={approveDraft}>Open AI Tutor Demo</button>
                </>
              ) : (
                <>
                  <p>No published article yet. Return to step 3 and confirm publish.</p>
                  <button className="outlineButton" onClick={() => setPrepStep(3)}>Back to Article</button>
                </>
              )}
            </section>
          ) : null}
        </main>
      </section>
    </section>
  );
}

function StepTitle({
  number,
  title,
  subtitle,
  tone = "purple",
  badge
}: {
  number: string;
  title: string;
  subtitle: string;
  tone?: "green" | "blue" | "purple";
  badge?: string;
}) {
  return (
    <div className={`stepTitle ${tone}`}>
      <span>{number}</span>
      <div>
        <h2>{title} {badge ? <em>{badge}</em> : null}</h2>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}

function PromptEditor({
  title,
  value,
  onChange
}: {
  title: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="field promptField">
      <label>{title}</label>
      <textarea value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function DraftTextArea({
  title,
  value,
  onChange
}: {
  title: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="draftEditor">
      <span>
        {title}
        <button type="button">Edit</button>
      </span>
      <textarea value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}
