"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { Download, ExternalLink, FileText, Trash2, X, Youtube } from "lucide-react";

type SourceFileType = "file" | "qa_note";
type UploadedFile = { id: string; originalName: string; storedName: string; relativePath: string };
type TranscriptStatus = "idle" | "resolving" | "downloading" | "generating" | "saving" | "ready" | "error";
type VideoLink = {
  id: string;
  videoId: string;
  title: string;
  url: string;
  transcriptStatus: TranscriptStatus;
  rawTranscriptPath?: string;
  semanticTranscriptPath?: string;
  transcriptError?: string;
};
type Sources = { files: UploadedFile[]; qaNotes: UploadedFile | null; videos: VideoLink[] };
type PendingRemoval = { file: UploadedFile; sourceType: SourceFileType };

export default function SourceMaterialsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const fileInput = useRef<HTMLInputElement>(null);
  const qaInput = useRef<HTMLInputElement>(null);
  const [sources, setSources] = useState<Sources>({ files: [], qaNotes: null, videos: [] });
  const [video, setVideo] = useState("");
  const [error, setError] = useState("");
  const [addingVideo, setAddingVideo] = useState(false);
  const [parsingVideoId, setParsingVideoId] = useState<string | null>(null);
  const [parseLabels, setParseLabels] = useState<Record<string, string>>({});
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval | null>(null);
  const [removing, setRemoving] = useState(false);

  const parts = pathname.split("/").filter(Boolean);
  const courseId = parts[0] === "knowledge" ? parts[1] : "philosophy";
  const knowledgeId = parts[0] === "knowledge" ? parts[2] : "epicureanism";
  const query = `courseId=${encodeURIComponent(courseId)}&knowledgeId=${encodeURIComponent(knowledgeId)}`;

  function refreshSidebar() {
    window.dispatchEvent(new Event("ks:navigation-refresh"));
  }

  async function refreshSources() {
    const res = await fetch(`/api/source-materials?${query}`);
    const data = await res.json();
    setSources(data);
    return data as Sources;
  }

  useEffect(() => {
    setError("");
    refreshSources();
  }, [query]);

  async function uploadFiles(files: FileList | null) {
    if (!files?.length) return;
    const form = new FormData();
    form.append("courseId", courseId);
    form.append("knowledgeId", knowledgeId);
    [...files].forEach((file) => form.append("files", file));
    const res = await fetch(`/api/source-materials/files?${query}`, { method: "POST", body: form });
    if (!res.ok) return setError((await res.json()).error || "Upload failed");
    setSources(await res.json());
    if (fileInput.current) fileInput.current.value = "";
    setError("");
    refreshSidebar();
  }

  async function uploadQa(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append("courseId", courseId);
    form.append("knowledgeId", knowledgeId);
    form.append("file", file);
    const res = await fetch(`/api/source-materials/qa-notes?${query}`, { method: "POST", body: form });
    if (!res.ok) return setError((await res.json()).error || "Upload failed");
    setSources(await res.json());
    if (qaInput.current) qaInput.current.value = "";
    setError("");
    refreshSidebar();
  }

  async function addVideo() {
    setError("");
    setAddingVideo(true);
    try {
      const res = await fetch("/api/source-materials/videos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: video, courseId, knowledgeId }) });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Add YouTube link failed");
        return;
      }
      setSources(data);
      setVideo("");
      refreshSidebar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Add YouTube link failed");
    } finally {
      setAddingVideo(false);
    }
  }

  async function deleteVideo(videoId: string) {
    setError("");
    const res = await fetch(`/api/source-materials/videos/${encodeURIComponent(videoId)}?${query}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) return setError(data.error || "Delete YouTube link failed");
    setSources(data);
    refreshSidebar();
  }

  async function parseTranscript(item: VideoLink) {
    setError("");
    setParsingVideoId(item.id);
    setParseLabels((current) => ({ ...current, [item.id]: "Resolving transcript..." }));
    const timers = [
      window.setTimeout(() => setParseLabels((current) => ({ ...current, [item.id]: "Downloading transcript..." })), 450),
      window.setTimeout(() => setParseLabels((current) => ({ ...current, [item.id]: "Generating semantic transcript..." })), 1400),
      window.setTimeout(() => setParseLabels((current) => ({ ...current, [item.id]: "Saving files..." })), 2600)
    ];
    try {
      const res = await fetch(`/api/source-materials/videos/${encodeURIComponent(item.id)}/transcript`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseId, knowledgeId })
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Parse transcript failed");
        await refreshSources();
        return;
      }
      setSources(data);
      const updated = data.videos?.find((videoItem: VideoLink) => videoItem.id === item.id);
      if (updated?.transcriptStatus === "error" && updated.transcriptError) setError(updated.transcriptError);
      refreshSidebar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Parse transcript failed");
      await refreshSources();
    } finally {
      timers.forEach(window.clearTimeout);
      setParsingVideoId(null);
      setParseLabels((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
    }
  }

  async function removeUploadedFile() {
    if (!pendingRemoval) return;
    setError("");
    setRemoving(true);
    try {
      const res = await fetch("/api/source-materials/files", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseId,
          knowledgeId,
          sourceType: pendingRemoval.sourceType,
          fileId: pendingRemoval.file.id,
          storedName: pendingRemoval.file.storedName,
          relativePath: pendingRemoval.file.relativePath
        })
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to remove file. Please try again.");
        return;
      }
      setSources(data);
      setPendingRemoval(null);
      refreshSidebar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove file. Please try again.");
    } finally {
      setRemoving(false);
    }
  }

  async function saveAndContinue() {
    await fetch("/api/source-materials", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ courseId, knowledgeId }) });
    router.push(`/knowledge/${courseId}/${knowledgeId}/llm-draft`);
  }

  return (
    <AppShell>
      {error ? <div className="error-banner">{error}</div> : null}
      <div className="card">
        <h2>File</h2>
        <div className="dropzone">
          <button className="btn secondary-blue" onClick={() => fileInput.current?.click()}>Choose Files</button>
          <span className="subtitle" style={{ margin: 0 }}>Supported formats: PDF, TXT, DOC, DOCX, MD.</span>
          <input className="hidden-input" ref={fileInput} type="file" multiple accept=".pdf,.txt,.doc,.docx,.md" onChange={(e) => uploadFiles(e.target.files)} />
        </div>
        <UploadedFilePanel
          label="Uploaded files"
          files={sources.files}
          emptyText="No files selected"
          countText={sources.files.length ? `${sources.files.length} ${sources.files.length === 1 ? "file" : "files"} selected` : "No files selected"}
          limitText="Maximum 5 files"
          sourceType="file"
          onRemove={(file) => setPendingRemoval({ file, sourceType: "file" })}
        />
      </div>
      <div className="card">
        <h2>Q&amp;A Notes</h2>
        <div className="dropzone">
          <button className="btn secondary-blue" onClick={() => qaInput.current?.click()}>Choose File</button>
          <span className="subtitle" style={{ margin: 0 }}>Supported formats: PDF, TXT, DOC, DOCX, MD.</span>
          <input className="hidden-input" ref={qaInput} type="file" accept=".pdf,.txt,.doc,.docx,.md" onChange={(e) => uploadQa(e.target.files)} />
        </div>
        <UploadedFilePanel
          label="Uploaded file"
          files={sources.qaNotes ? [sources.qaNotes] : []}
          emptyText="No file selected"
          countText={sources.qaNotes ? "1 file selected" : "No file selected"}
          limitText="Maximum 1 file"
          sourceType="qa_note"
          onRemove={(file) => setPendingRemoval({ file, sourceType: "qa_note" })}
        />
      </div>
      <div className="card">
        <h2>YouTube</h2>
        <div className="video-line">
          <input value={video} onChange={(e) => setVideo(e.target.value)} placeholder="https://..." />
          <button className="btn secondary-blue" onClick={addVideo} disabled={addingVideo || !video.trim() || sources.videos.length >= 5}>
            {addingVideo ? "Resolving..." : "Add YouTube Link"}
          </button>
        </div>
        <YouTubeList
          videos={sources.videos}
          query={query}
          parsingVideoId={parsingVideoId}
          parseLabels={parseLabels}
          onParse={parseTranscript}
          onDelete={deleteVideo}
        />
        <div className="card-foot"><span>{sources.videos.length} of 5 links added</span><span /></div>
      </div>
      <button className="btn primary full" onClick={saveAndContinue}>Save Sources and Continue</button>
      {pendingRemoval ? (
        <div className="modal-backdrop">
          <div className="modal-card source-remove-modal">
            <h2>Remove this file?</h2>
            <p>This will remove the uploaded copy from the current Knowledge source materials.</p>
            <div className="modal-actions">
              <button className="btn" onClick={() => setPendingRemoval(null)} disabled={removing}>Cancel</button>
              <button className="btn primary" onClick={removeUploadedFile} disabled={removing}>{removing ? "Removing" : "Remove"}</button>
            </div>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}

function statusLabel(status: TranscriptStatus) {
  if (status === "downloading") return "Downloading transcript...";
  if (status === "generating") return "Generating semantic transcript...";
  if (status === "saving") return "Saving files...";
  if (status === "ready") return "Transcript ready";
  if (status === "error") return "Needs retry";
  return "Not parsed";
}

function transcriptDownloadHref(query: string, relativePath: string) {
  return `/api/source-materials/transcripts/download?${query}&path=${encodeURIComponent(relativePath)}`;
}

function YouTubeList({
  videos,
  query,
  parsingVideoId,
  parseLabels,
  onParse,
  onDelete
}: {
  videos: VideoLink[];
  query: string;
  parsingVideoId: string | null;
  parseLabels: Record<string, string>;
  onParse: (video: VideoLink) => void;
  onDelete: (videoId: string) => void;
}) {
  if (!videos.length) return <div className="uploaded-files-empty">No YouTube links added</div>;
  return (
    <div className="youtube-list">
      {videos.map((item) => {
        const isParsing = parsingVideoId === item.id;
        const label = parseLabels[item.id] || statusLabel(item.transcriptStatus);
        return (
          <article className="youtube-item" key={item.id}>
            <div className="youtube-main">
              <Youtube size={22} />
              <div className="youtube-text">
                <a className="youtube-title" href={item.url} target="_blank" rel="noreferrer">
                  {item.title}
                  <ExternalLink size={14} />
                </a>
                <div className={`youtube-status status-${item.transcriptStatus}`}>{label}</div>
              </div>
            </div>
            <div className="youtube-actions">
              <button className="btn secondary-blue" onClick={() => onParse(item)} disabled={isParsing}>
                {isParsing ? label : item.rawTranscriptPath ? "Retry Parse" : "Parse Transcript"}
              </button>
              {item.rawTranscriptPath ? (
                <a className="btn" href={transcriptDownloadHref(query, item.rawTranscriptPath)}>
                  <Download size={17} />
                  RawTranscript.json
                </a>
              ) : null}
              {item.semanticTranscriptPath ? (
                <a className="btn" href={transcriptDownloadHref(query, item.semanticTranscriptPath)}>
                  <Download size={17} />
                  SemanticTranscript.md
                </a>
              ) : null}
              <button className="icon-button danger" type="button" onClick={() => onDelete(item.id)} aria-label={`Delete ${item.title}`}>
                <Trash2 size={17} />
              </button>
            </div>
            {item.transcriptStatus === "error" && item.transcriptError ? (
              <div className="youtube-error">{item.transcriptError}</div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

function UploadedFilePanel({
  label,
  files,
  emptyText,
  countText,
  limitText,
  onRemove
}: {
  label: string;
  files: UploadedFile[];
  emptyText: string;
  countText: string;
  limitText: string;
  sourceType: SourceFileType;
  onRemove: (file: UploadedFile) => void;
}) {
  return (
    <div className="uploaded-files">
      <div className="uploaded-files-head">
        <div>
          <div className="uploaded-files-label">{label}</div>
          <div className="uploaded-files-limit">{limitText}</div>
        </div>
        <span>{countText}</span>
      </div>
      {files.length ? (
        <div className="file-chip-list">
          {files.map((file, index) => (
            <span className="file-chip" key={file.id || `${file.originalName}-${index}`}>
              <FileText size={17} />
              <span>{file.originalName}</span>
              <button className="file-chip-remove" type="button" onClick={() => onRemove(file)} aria-label={`Remove ${file.originalName}`}>
                <X size={14} />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <div className="uploaded-files-empty">{emptyText}</div>
      )}
    </div>
  );
}
