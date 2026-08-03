"use client";

import { type CSSProperties, type RefObject, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ChevronDown, Clipboard, FileText, Info, Sparkles } from "lucide-react";
import configuredModels from "@/config/models.json";
import { IncrementalWikiUpdate, parseIncrementalWikiUpdate } from "@/lib/incrementalWikiParser";

type ConfiguredModel = {
  label: string;
  id: string;
  note?: string;
};

type SelectableSource = {
  key: string;
  sourceType: "document" | "qa_note" | "youtube_transcript";
  sourceId: string;
  label: string;
  group: "Documents" | "Q&A Notes" | "YouTube Transcripts";
};

type OutputTab = "full" | "incremental" | "import_source";

type ConfirmAction = {
  title: string;
  message: string;
  onContinue: () => Promise<void>;
  incrementalPreview?: IncrementalWikiUpdate;
  incrementalMarkdown?: string;
};

type SourceMenuPosition = {
  top: number;
  left: number;
  width: number;
};

type CopyFeedback = {
  key: string;
  status: "copied" | "failed";
};

type ModelLimitInfo = {
  maxCompletionTokens: number;
  source: "model-limit" | "fallback" | "auto-fallback";
  contextLength?: number | null;
  modelMaxCompletionTokens?: number | null;
  pricing?: {
    inputPer1M: number | null;
    outputPer1M: number | null;
    display: string;
  } | null;
  note?: string;
};

const DEFAULT_MODEL_ID = "openrouter/auto";
const models = configuredModels as ConfiguredModel[];

function modelLabel(model: ConfiguredModel) {
  return model.id === DEFAULT_MODEL_ID ? "OpenRouter Auto" : model.label;
}

function normaliseModel(modelId?: string) {
  return models.some((model) => model.id === modelId) ? modelId! : DEFAULT_MODEL_ID;
}

function selectedModelLabel(modelId: string) {
  const selected = models.find((item) => item.id === modelId);
  return selected ? modelLabel(selected) : "OpenRouter Auto";
}

function modelLimitLabel(limit: ModelLimitInfo | null) {
  if (!limit) return "Max output: not loaded";
  const tokens = limit.maxCompletionTokens.toLocaleString();
  return `Max output: ${tokens} tokens`;
}

export default function LlmDraftPage() {
  const router = useRouter();
  const pathname = usePathname();
  const parts = pathname.split("/").filter(Boolean);
  const courseId = parts[0] === "knowledge" ? parts[1] : "philosophy";
  const knowledgeId = parts[0] === "knowledge" ? parts[2] : "epicureanism";
  const query = `courseId=${encodeURIComponent(courseId)}&knowledgeId=${encodeURIComponent(knowledgeId)}`;
  const [requirements, setRequirements] = useState("");
  const [output, setOutput] = useState("");
  const [incrementalOutput, setIncrementalOutput] = useState("");
  const [importSourceOutput, setImportSourceOutput] = useState("");
  const [selectableSources, setSelectableSources] = useState<SelectableSource[]>([]);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [importSourceOpen, setImportSourceOpen] = useState(false);
  const [selectedImportKeys, setSelectedImportKeys] = useState<string[]>([]);
  const [importingSource, setImportingSource] = useState(false);
  const [model, setModel] = useState(DEFAULT_MODEL_ID);
  const [loading, setLoading] = useState(false);
  const [incrementalLoading, setIncrementalLoading] = useState(false);
  const [savingOutput, setSavingOutput] = useState<OutputTab | null>(null);
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  const [sourceMenuPosition, setSourceMenuPosition] = useState<SourceMenuPosition | null>(null);
  const [importSourceMenuPosition, setImportSourceMenuPosition] = useState<SourceMenuPosition | null>(null);
  const [activeOutputTab, setActiveOutputTab] = useState<OutputTab>("full");
  const [hasWiki, setHasWiki] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [draftWarning, setDraftWarning] = useState("");
  const [finishReason, setFinishReason] = useState<string | null>(null);
  const [modelLimit, setModelLimit] = useState<ModelLimitInfo | null>(null);
  const sourceMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const sourceMenuRef = useRef<HTMLDivElement | null>(null);
  const importSourceButtonRef = useRef<HTMLButtonElement | null>(null);
  const importSourceMenuRef = useRef<HTMLDivElement | null>(null);
  const busy = loading || incrementalLoading;
  const selectedCount = selectedSourceIds.length;
  const importSourceOptions = selectableSources;

  function updateSourceMenuPosition() {
    const rect = sourceMenuButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(420, Math.max(340, window.innerWidth - 32));
    const left = Math.min(Math.max(16, rect.right - width), window.innerWidth - width - 16);
    setSourceMenuPosition({ top: rect.bottom + 8, left, width });
  }

  function updateImportSourceMenuPosition() {
    const rect = importSourceButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(420, Math.max(340, window.innerWidth - 32));
    const left = Math.min(Math.max(16, rect.right - width), window.innerWidth - width - 16);
    setImportSourceMenuPosition({ top: rect.bottom + 8, left, width });
  }

  function toggleSourceMenu() {
    if (sourceMenuOpen) {
      setSourceMenuOpen(false);
      return;
    }
    setImportSourceOpen(false);
    updateSourceMenuPosition();
    setSourceMenuOpen(true);
  }

  function toggleImportSourceMenu() {
    if (importSourceOpen) {
      setImportSourceOpen(false);
      return;
    }
    setSourceMenuOpen(false);
    updateImportSourceMenuPosition();
    setImportSourceOpen(true);
  }

  useEffect(() => {
    setError("");
    setSuccess("");
    fetch(`/api/draft?${query}`)
      .then((res) => res.json())
      .then((data) => {
        setRequirements(data.requirements || "");
        setOutput(data.output || "");
        setIncrementalOutput(data.incrementalOutput || "");
        setImportSourceOutput(data.importSourceOutput || "");
        setSelectableSources(data.selectableSources || []);
        setSelectedSourceIds([]);
        setSelectedImportKeys([]);
        setModel(normaliseModel(data.selectedModel?.model));
        setHasWiki(Boolean(data.hasWiki));
        setDraftWarning(data.draftWarning || "");
        setFinishReason(data.finishReason || null);
        setModelLimit(data.selectedModelLimit || null);
        if (data.error) setError(data.error);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Unable to load draft settings"));
  }, [query]);

  async function changeModel(nextModel: string) {
    const selected = normaliseModel(nextModel);
    setModel(selected);
    setError("");
    setSuccess("");
    const res = await fetch("/api/draft/model", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseId, knowledgeId, model: selected })
    });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Selected model is not configured.");
      return;
    }
    const data = await res.json();
    setModelLimit(data.selectedModelLimit || null);
  }

  function toggleSource(sourceId: string) {
    setSelectedSourceIds((current) => current.includes(sourceId) ? current.filter((id) => id !== sourceId) : [...current, sourceId]);
  }

  function toggleImportSource(sourceKey: string) {
    setSelectedImportKeys((current) => current.includes(sourceKey) ? current.filter((key) => key !== sourceKey) : [...current, sourceKey]);
  }

  useEffect(() => {
    const availableSourceKeys = new Set(selectableSources.map((source) => source.key));
    setSelectedSourceIds((current) => current.filter((key) => availableSourceKeys.has(key)));
  }, [selectableSources]);

  useEffect(() => {
    const availableImportKeys = new Set(importSourceOptions.map((option) => option.key));
    setSelectedImportKeys((current) => current.filter((key) => availableImportKeys.has(key)));
  }, [importSourceOptions]);

  useEffect(() => {
    if (!sourceMenuOpen) return;
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (sourceMenuRef.current?.contains(target) || sourceMenuButtonRef.current?.contains(target)) return;
      setSourceMenuOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setSourceMenuOpen(false);
    }
    function handleScrollOrResize() {
      setSourceMenuOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [sourceMenuOpen]);

  useEffect(() => {
    if (!importSourceOpen) return;
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (importSourceMenuRef.current?.contains(target) || importSourceButtonRef.current?.contains(target)) return;
      setImportSourceOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setImportSourceOpen(false);
    }
    function handleScrollOrResize() {
      setImportSourceOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [importSourceOpen]);

  async function generate() {
    setError("");
    setSuccess("");
    setLoading(true);
    setSourceMenuOpen(false);
    setImportSourceOpen(false);
    try {
      const res = await fetch("/api/draft/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requirements, courseId, knowledgeId, model }) });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Draft generation failed");
        return;
      }
      setOutput(data.output || "");
      setDraftWarning(data.draftWarning || "");
      setFinishReason(data.finishReason || null);
      setActiveOutputTab("full");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Draft generation failed");
    } finally {
      setLoading(false);
    }
  }

  async function incrementalGenerate() {
    if (!selectedSourceIds.length) return;
    const selectedFiles = selectableSources
      .filter((source) => selectedSourceIds.includes(source.key))
      .map((source) => ({ sourceType: source.sourceType, sourceId: source.sourceId }));
    setError("");
    setSuccess("");
    setIncrementalLoading(true);
    setSourceMenuOpen(false);
    setImportSourceOpen(false);
    try {
      const res = await fetch("/api/draft/incremental-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requirements, courseId, knowledgeId, model, selectedFiles })
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Incremental draft generation failed");
        return;
      }
      setIncrementalOutput(data.output || "");
      setHasWiki(Boolean(data.existingWikiFound));
      setDraftWarning(data.draftWarning || "");
      setFinishReason(data.finishReason || null);
      setActiveOutputTab("incremental");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Incremental draft generation failed");
    } finally {
      setIncrementalLoading(false);
    }
  }

  function handleIncrementalAction() {
    if (busy) return;
    if (!selectedSourceIds.length) {
      setSuccess("");
      setError("Select one or more source files before running an incremental draft.");
      updateSourceMenuPosition();
      setImportSourceOpen(false);
      setSourceMenuOpen(true);
      return;
    }
    void incrementalGenerate();
  }

  async function createWikiDraft() {
    setError("");
    setSuccess("");
    const res = await fetch("/api/draft/create-wiki", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ courseId, knowledgeId }) });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Please generate a draft first.");
      return;
    }
    setHasWiki(true);
    router.push(`/knowledge/${courseId}/${knowledgeId}/knowledge-wiki`);
  }

  async function updateWikiFromIncrementalDraft(incrementalMarkdown: string) {
    setError("");
    setSuccess("");
    const res = await fetch("/api/wiki/apply-incremental", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseId, knowledgeId, incrementalMarkdown })
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Please generate an incremental draft first.");
      return;
    }
    setHasWiki(true);
    setSuccess(data.message || "Wiki updated successfully.");
    router.push(`/knowledge/${courseId}/${knowledgeId}/knowledge-wiki`);
  }

  function requestCreateWikiDraft() {
    if (!hasWiki) {
      void createWikiDraft();
      return;
    }
    setConfirmAction({
      title: "Existing Wiki Found",
      message: "This Knowledge already has an existing Wiki.\n\nCreating a Wiki from the current draft may overwrite or replace existing expert-edited content.\n\nDo you want to continue?",
      onContinue: createWikiDraft
    });
  }

  async function importSelectedSources() {
    const selectedOptions = importSourceOptions.filter((option) => selectedImportKeys.includes(option.key));
    if (!selectedOptions.length) return;
    setError("");
    setSuccess("");
    setImportingSource(true);
    try {
      const res = await fetch("/api/llm-draft/import-source-output", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseId,
          knowledgeId,
          selectedFiles: selectedOptions.map((option) => ({ sourceType: option.sourceType, sourceId: option.sourceId }))
        })
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Import source failed");
        return;
      }
      setImportSourceOutput(data.output || "");
      setImportSourceOpen(false);
      setActiveOutputTab("import_source");
      setSuccess(`Import Source Output generated successfully. ${data.entryCount || 0} entries found.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import source failed");
    } finally {
      setImportingSource(false);
    }
  }

  async function importSourceOutputToWiki() {
    setError("");
    setSuccess("");
    const res = await fetch("/api/wiki/import-source-output-to-wiki", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseId, knowledgeId, importSourceMarkdown: importSourceOutput })
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Import Source Output to Wiki failed");
      return;
    }
    setHasWiki(true);
    router.push(`/knowledge/${courseId}/${knowledgeId}/knowledge-wiki`);
  }

  function requestUpdateWiki() {
    const incrementalMarkdown = incrementalOutput;
    const incrementalPreview = parseIncrementalWikiUpdate(incrementalMarkdown);
    setConfirmAction({
      title: "Apply Incremental Draft",
      message: "This will apply the Incremental Draft to the current Wiki.\n\nSections beginning with “# Existing Entry:” will be merged into matching existing Wiki entries.\n\nSections beginning with “# New Entry:” will be added as new Wiki entries.\n\nHeadings inside each section, such as “## Introducing the Topic”, will be kept as part of that entry’s content.\n\nSummary, Not Included, and other report-level sections will not be written to the Wiki.",
      incrementalPreview,
      incrementalMarkdown,
      onContinue: () => updateWikiFromIncrementalDraft(incrementalMarkdown)
    });
  }

  function requestImportSourceOutputToWiki() {
    setConfirmAction({
      title: "Import Source Output to Wiki",
      message: "This will import the current Import Source Output into the Wiki.\n\nEach “##” heading will become a Wiki entry.\n\nIf the current Wiki already has content, it may be replaced.\n\nDo you want to continue?",
      onContinue: importSourceOutputToWiki
    });
  }

  async function saveDraftOutput(kind: OutputTab) {
    setError("");
    setSuccess("");
    setSavingOutput(kind);
    try {
      const isFull = kind === "full";
      const isImportSource = kind === "import_source";
      const res = await fetch("/api/draft/save-output", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseId,
          knowledgeId,
          kind: isFull ? "generated" : isImportSource ? "import_source" : "incremental",
          output: isFull ? output : isImportSource ? importSourceOutput : incrementalOutput
        })
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Save draft output failed");
        return;
      }
      setSuccess(data.message || (isFull ? "Draft saved successfully." : isImportSource ? "Import Source output saved successfully." : "Incremental draft saved successfully."));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save draft output failed");
    } finally {
      setSavingOutput(null);
    }
  }

  async function copyDraftOutput(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyFeedback({ key, status: "copied" });
    } catch {
      setCopyFeedback({ key, status: "failed" });
    }
    window.setTimeout(() => {
      setCopyFeedback((current) => (current?.key === key ? null : current));
    }, 1500);
  }

  async function continueConfirmedAction() {
    if (!confirmAction) return;
    const updateCount = confirmAction.incrementalPreview?.suggestedUpdates.length ?? 1;
    const newCount = confirmAction.incrementalPreview?.newEntries.length ?? 1;
    if (confirmAction.incrementalPreview && updateCount + newCount === 0) return;
    setConfirmLoading(true);
    try {
      await confirmAction.onContinue();
      setConfirmAction(null);
    } finally {
      setConfirmLoading(false);
    }
  }

  function pluralise(count: number, singular: string, plural = `${singular}s`) {
    return `${count} ${count === 1 ? singular : plural}`;
  }

  function incrementalPreviewBlock(preview: IncrementalWikiUpdate) {
    const updateCount = preview.suggestedUpdates.length;
    const newCount = preview.newEntries.length;
    const hasEntries = updateCount + newCount > 0;
    return (
      <div className="incremental-apply-preview">
        <h3>Entries to be applied</h3>
        {hasEntries ? (
          <p className="preview-summary">
            This update will apply {pluralise(updateCount, "update")} and {pluralise(newCount, "new entry", "new entries")}.
          </p>
        ) : (
          <div className="preview-warning">
            No applicable entries were found in the Incremental Draft.<br />
            Only sections beginning with “# Existing Entry:” or “# New Entry:” can be applied.
          </div>
        )}
        <div className="preview-group">
          <h4>Suggested Updates</h4>
          {updateCount ? (
            <ul>
              {preview.suggestedUpdates.map((item, index) => <li key={`${item.existingTitle}-${index}`}>{item.existingTitle}</li>)}
            </ul>
          ) : (
            <p>No existing entries will be updated.</p>
          )}
        </div>
        <div className="preview-group">
          <h4>New Entries</h4>
          {newCount ? (
            <ul>
              {preview.newEntries.map((item, index) => <li key={`${item.title}-${index}`}>{item.title}</li>)}
            </ul>
          ) : (
            <p>No new entries will be added.</p>
          )}
        </div>
      </div>
    );
  }

  function outputPanel(kind: OutputTab) {
    const isFull = kind === "full";
    const isImportSource = kind === "import_source";
    const value = isFull ? output : isImportSource ? importSourceOutput : incrementalOutput;
    const setValue = isFull ? setOutput : isImportSource ? setImportSourceOutput : setIncrementalOutput;
    const isGenerating = isFull ? loading : isImportSource ? importingSource : incrementalLoading;
    const isSaving = savingOutput === kind;
    const copyKey = isFull ? "generated-draft-output" : isImportSource ? "import-source-output" : "incremental-draft-output";
    const copyLabel = copyFeedback?.key === copyKey
      ? (copyFeedback.status === "copied" ? "Copied" : "Copy failed")
      : "Copy";
    const outputTitle = isFull ? "Generated Draft Output" : isImportSource ? "Import Source Output" : "Incremental Wiki Update Proposal";
    return (
      <div className="draft-output-panel">
        <div className="output-panel-head">
          <div>
            <h2>{outputTitle}</h2>
            {value ? (
              <div className="output-meta">
                Output length: {value.length.toLocaleString()} characters
                {isFull && finishReason ? ` · Finish reason: ${finishReason}` : ""}
              </div>
            ) : null}
          </div>
          <div className="output-panel-actions">
            <button className="btn" onClick={() => saveDraftOutput(kind)} disabled={busy || Boolean(savingOutput)}>
              {isSaving ? <span className="loading-spinner" /> : null}
              Save
            </button>
            <button className="btn" onClick={() => copyDraftOutput(copyKey, value)} disabled={!value}>
              <Clipboard size={18} /> {copyLabel}
            </button>
            {isFull ? (
              <button className="btn primary" onClick={requestCreateWikiDraft} disabled={!output || busy || Boolean(savingOutput)}>Create Wiki</button>
            ) : isImportSource ? (
              <button className="btn primary" onClick={requestImportSourceOutputToWiki} disabled={!importSourceOutput || busy || Boolean(savingOutput)}>Import to Wiki</button>
            ) : (
              <button className="btn primary" onClick={requestUpdateWiki} disabled={!incrementalOutput || busy || Boolean(savingOutput)}>Update Wiki</button>
            )}
          </div>
        </div>
        <div className={`output-wrap ${isGenerating ? "is-loading" : ""}`}>
          <textarea className="output output-editor" value={value} onChange={(event) => setValue(event.target.value)} />
          {isGenerating ? (
            <div className="output-mask" aria-live="polite">
              <span className="loading-spinner large" />
              <span>{isFull ? "Generating draft output..." : isImportSource ? "Generating import source output..." : "Generating incremental draft output..."}</span>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  function selectableSourceMenu({
    title,
    description,
    selectedKeys,
    onToggle,
    onCancel,
    onRun,
    runLabel,
    running,
    menuRef,
    style
  }: {
    title: string;
    description: string;
    selectedKeys: string[];
    onToggle: (key: string) => void;
    onCancel: () => void;
    onRun: () => void;
    runLabel: string;
    running: boolean;
    menuRef: RefObject<HTMLDivElement | null>;
    style?: CSSProperties;
  }) {
    const groups: SelectableSource["group"][] = ["Documents", "Q&A Notes", "YouTube Transcripts"];
    const selectedCount = selectedKeys.length;
    return (
      <div className="source-import-popover import-source-menu" ref={menuRef} style={style}>
        <div className="source-import-head">
          <strong>{title}</strong>
          <span>{selectedCount} selected</span>
        </div>
        <p>{description}</p>
        {selectableSources.length ? (
          <>
            {groups.map((group) => {
              const options = selectableSources.filter((option) => option.group === group);
              return (
                <div className="source-import-section" key={group}>
                  <h3>{group}</h3>
                  {options.length ? options.map((option) => (
                    <label className="source-import-option" key={option.key}>
                      <input type="checkbox" checked={selectedKeys.includes(option.key)} onChange={() => onToggle(option.key)} />
                      <FileText size={17} />
                      <span>{option.label}</span>
                    </label>
                  )) : <div className="source-import-empty">No {group} available.</div>}
                </div>
              );
            })}
            <div className="source-import-actions">
              <button className="btn" onClick={onCancel} disabled={running}>Cancel</button>
              <button className="btn primary" onClick={onRun} disabled={running || !selectedCount}>
                {running ? <span className="loading-spinner" /> : null}
                {runLabel}
              </button>
            </div>
          </>
        ) : (
          <div className="source-import-empty">No source files available.</div>
        )}
      </div>
    );
  }

  const sourceDropdown = typeof document !== "undefined" && sourceMenuOpen && sourceMenuPosition ? createPortal(
    selectableSourceMenu({
      title: "Incremental Sources",
      description: "Choose source files to merge before running the incremental LLM draft.",
      selectedKeys: selectedSourceIds,
      onToggle: toggleSource,
      onCancel: () => setSourceMenuOpen(false),
      onRun: handleIncrementalAction,
      runLabel: "Run Incremental",
      running: incrementalLoading,
      menuRef: sourceMenuRef,
      style: {
        position: "fixed",
        top: sourceMenuPosition.top,
        left: sourceMenuPosition.left,
        right: "auto",
        width: sourceMenuPosition.width,
        zIndex: 1000
      }
    }),
    document.body
  ) : null;

  const importSourceDropdown = typeof document !== "undefined" && importSourceOpen && importSourceMenuPosition ? createPortal(
    selectableSourceMenu({
      title: "Import Sources",
      description: "Choose source files to merge into Import Source Output. Wiki files will not be changed.",
      selectedKeys: selectedImportKeys,
      onToggle: toggleImportSource,
      onCancel: () => setImportSourceOpen(false),
      onRun: importSelectedSources,
      runLabel: "Generate Output",
      running: importingSource,
      menuRef: importSourceMenuRef,
      style: {
        position: "fixed",
        top: importSourceMenuPosition.top,
        left: importSourceMenuPosition.left,
        right: "auto",
        width: importSourceMenuPosition.width,
        zIndex: 1000
      }
    }),
    document.body
  ) : null;

  return (
    <AppShell>
      {error ? <div className="error-banner">{error}</div> : null}
      {draftWarning ? <div className="warning-banner">{draftWarning}</div> : null}
      {success ? <div className="success-banner">{success}</div> : null}
      {!hasWiki ? <div className="notice compact"><Info size={18} /> No existing Wiki found. Incremental output will be treated as new entries.</div> : null}
      <div className="card">
        <h2>Draft Requirements</h2>
        <div className="draft-box editor">
          <textarea value={requirements} onChange={(e) => setRequirements(e.target.value)} />
          <div className="draft-requirements-footer">
            <div className="draft-model-area">
              <label className="model model-picker">
                <Sparkles size={18} />
                <span className="model-picker-label">{selectedModelLabel(model)}</span>
                <select
                  aria-label="Select model"
                  value={model}
                  onChange={(event) => changeModel(event.target.value)}
                  disabled={busy}
                >
                  {models.map((item) => (
                    <option value={item.id} key={item.id}>{modelLabel(item)}</option>
                  ))}
                </select>
                <ChevronDown className="model-picker-chevron" size={16} />
              </label>
              <span
                className="model-limit-hint draft-model-meta"
                title={modelLimit?.note || "OpenRouter list price per 1M tokens. Effective cost may vary by provider routing and caching."}
              >
                {modelLimitLabel(modelLimit)}
                {" • "}
                <strong>In/Out:</strong>
                {" "}
                <span className="draft-model-price">{modelLimit?.pricing?.display ?? "Price unavailable"}</span>
              </span>
            </div>
            <div className="draft-actions">
              <button
                className="btn primary generate-button"
                onClick={generate}
                disabled={busy}
                aria-busy={loading}
                title="Generate a full draft from all source materials."
              >
                {loading ? <span className="loading-spinner" /> : <Sparkles size={18} />}
                {loading ? "Generating" : "Generate"}
              </button>
              <div className="split-button-wrap">
                <button
                  className="btn secondary-blue split-main"
                  onClick={handleIncrementalAction}
                  disabled={busy}
                  aria-busy={incrementalLoading}
                  title="Generate an incremental update from selected source files."
                >
                  {incrementalLoading ? <span className="loading-spinner" /> : <Sparkles size={18} />}
                  {incrementalLoading ? "Generating..." : "Incremental"}
                </button>
                <button
                  className="btn secondary-blue split-arrow"
                  ref={sourceMenuButtonRef}
                  onClick={toggleSourceMenu}
                  disabled={busy}
                  aria-label="Choose source files for incremental generation"
                  title="Generate an incremental update from selected source files."
                >
                  <ChevronDown size={17} />
                </button>
              </div>
              <div className="split-button-wrap import-source-wrap">
                <button
                  className="btn secondary-blue split-main"
                  onClick={toggleImportSourceMenu}
                  disabled={busy || importingSource || !importSourceOptions.length}
                  title="Generate editable Import Source Output."
                  aria-busy={importingSource}
                >
                  {importingSource ? <span className="loading-spinner" /> : <FileText size={18} />}
                  {importingSource ? "Importing..." : "Import"}
                </button>
                <button
                  className="btn secondary-blue split-arrow"
                  ref={importSourceButtonRef}
                  onClick={toggleImportSourceMenu}
                  disabled={busy || importingSource || !importSourceOptions.length}
                  aria-label="Choose files to parse into Import Source Output"
                  title="Parse selected source or Q&A files into Import Source Output."
                >
                  <ChevronDown size={17} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="card">
        <div className="tabs">
          <button className={`tab ${activeOutputTab === "full" ? "active" : ""}`} onClick={() => setActiveOutputTab("full")}>Generated Draft Output</button>
          <button className={`tab ${activeOutputTab === "incremental" ? "active" : ""}`} onClick={() => setActiveOutputTab("incremental")}>Incremental Draft Output</button>
          <button className={`tab ${activeOutputTab === "import_source" ? "active" : ""}`} onClick={() => setActiveOutputTab("import_source")}>Import Source Output</button>
        </div>
        {outputPanel(activeOutputTab)}
      </div>
      <div className="notice">
        <div className="notice-text"><Info size={22} /> <span>AI-extracted results do not represent expert opinion and are for reference only.<br />Review full and incremental drafts separately before creating or updating Wiki content.</span></div>
      </div>
      {confirmAction ? (
        <div className="modal-backdrop">
          <div className="modal-card confirm-modal">
            <div className="confirm-modal-body">
              <h2>{confirmAction.title}</h2>
              <p>{confirmAction.message}</p>
              {confirmAction.incrementalPreview ? incrementalPreviewBlock(confirmAction.incrementalPreview) : null}
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setConfirmAction(null)} disabled={confirmLoading}>Cancel</button>
              <button
                className="btn primary"
                onClick={continueConfirmedAction}
                disabled={confirmLoading || Boolean(confirmAction.incrementalPreview && confirmAction.incrementalPreview.suggestedUpdates.length + confirmAction.incrementalPreview.newEntries.length === 0)}
              >
                {confirmLoading ? <span className="loading-spinner" /> : null}
                Continue
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {sourceDropdown}
      {importSourceDropdown}
    </AppShell>
  );
}
