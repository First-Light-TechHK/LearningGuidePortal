"use client";
// Shared pieces of the learner Helpdesk pages: the attachment drop zone
// (Figma 1216:6 "file-upload-area"), file chips, status pill, message
// attachments and auto-linked plain text.
import { Download, FileText, Image as ImageIcon, Paperclip, Upload, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ClipboardEvent as ReactClipboardEvent } from "react";
import type { AttachmentView, TicketStatus } from "@/contracts/helpdesk";
import type { getMessages } from "@/lib/i18n/messages";
import { fillTemplate, formatBytes, linkify, pastedFiles, screenFiles, type FileProblem, type HelpdeskUiConfig } from "@/modules/helpdesk/learnerUi";

export type HelpdeskCopy = ReturnType<typeof getMessages>["helpdesk"];

function problemText(copy: HelpdeskCopy, problems: FileProblem[]) {
  const lines = problems.map((problem) => problem.kind === "count" ? copy.fileErrors.count : fillTemplate(copy.fileErrors[problem.kind], { name: problem.name }));
  return [...new Set(lines)].join(" ");
}

/** Attachment state with the same checks as the server (type, 10 MB, 5 files); errors are one line of copy. */
export function useAttachments(config: HelpdeskUiConfig, copy: HelpdeskCopy, disabled = false) {
  const [files, setFilesState] = useState<File[]>([]);
  const [error, setError] = useState("");
  const current = useRef<File[]>([]);
  const busy = useRef(disabled);
  busy.current = disabled;
  const setFiles = useCallback((next: File[]) => { current.current = next; setFilesState(next); }, []);
  const add = useCallback((incoming: File[]) => {
    if (incoming.length === 0) return;
    const { accepted, errors } = screenFiles(current.current.length, incoming, config.limits, config.extensions);
    setError(errors.length ? problemText(copy, errors) : "");
    if (accepted.length) setFiles([...current.current, ...accepted]);
  }, [config, copy, setFiles]);
  const remove = useCallback((index: number) => { setFiles(current.current.filter((_, position) => position !== index)); setError(""); }, [setFiles]);
  const clear = useCallback(() => { setFiles([]); setError(""); }, [setFiles]);
  /**
   * Paste anywhere in the form: files on the clipboard become attachments,
   * except while the form is busy, and except when text is being pasted into
   * a text field (Office copies a picture of the cells next to the text):
   * then the browser pastes the text as usual.
   */
  const onPaste = useCallback((event: ReactClipboardEvent) => {
    const target = event.target as HTMLElement;
    const intoTextField = target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement && !["file", "checkbox", "radio", "button", "submit", "reset"].includes(target.type)) || target.isContentEditable;
    const pasted = pastedFiles({ files: [...(event.clipboardData?.files ?? [])], plainText: event.clipboardData?.getData("text/plain") ?? "", intoTextField, disabled: busy.current });
    if (pasted.length === 0) return;
    event.preventDefault();
    add(pasted.map((file, index) => file.name && file.name !== "image.png" ? file : new File([file], `screenshot-${Date.now()}${index ? `-${index}` : ""}.${(file.type.split("/")[1] || "png").replace("jpeg", "jpg")}`, { type: file.type, lastModified: file.lastModified })));
  }, [add]);
  return { files, error, setError, add, remove, clear, onPaste };
}

export function AttachmentZone({ copy, config, attachments, disabled, inputId }: { copy: HelpdeskCopy; config: HelpdeskUiConfig; attachments: ReturnType<typeof useAttachments>; disabled?: boolean; inputId: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  return <div className="helpdesk-attachments">
    <div className={`helpdesk-dropzone${dragging ? " is-dragging" : ""}`} aria-describedby={`${inputId}-hint`}
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
      onDrop={(event) => { event.preventDefault(); setDragging(false); if (!disabled) attachments.add([...event.dataTransfer.files]); }}>
      <div className="helpdesk-dropzone-text">
        <Paperclip size={20} strokeWidth={2} aria-hidden="true" className="helpdesk-dropzone-clip" />
        <div><p>{copy.dropTitle}</p><p id={`${inputId}-hint`}>{copy.dropHint}</p></div>
      </div>
      <button type="button" className="helpdesk-upload-button" disabled={disabled} onClick={() => input.current?.click()}><Upload size={16} aria-hidden="true" />{copy.uploadFiles}</button>
      <input ref={input} id={inputId} type="file" multiple accept={config.accept} hidden disabled={disabled} aria-label={copy.uploadFiles}
        onChange={(event) => { attachments.add([...(event.currentTarget.files ?? [])]); event.currentTarget.value = ""; }} />
    </div>
    {attachments.files.length ? <ul className="helpdesk-file-list" aria-label={copy.attachments}>{attachments.files.map((file, index) => <FileChip key={`${file.name}-${file.size}-${file.lastModified}-${index}`} file={file} removeLabel={fillTemplate(copy.removeFile, { name: file.name })} onRemove={disabled ? undefined : () => attachments.remove(index)} />)}</ul> : null}
    {attachments.error ? <p role="alert" className="helpdesk-inline-error">{attachments.error}</p> : null}
  </div>;
}

function FileChip({ file, removeLabel, onRemove }: { file: File; removeLabel: string; onRemove?: () => void }) {
  const isImage = file.type.startsWith("image/");
  const [preview, setPreview] = useState<string | null>(null);
  // Created and revoked in the same effect so a re-run (React strict mode) never shows a revoked URL.
  useEffect(() => {
    if (!isImage || typeof URL.createObjectURL !== "function") return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => { URL.revokeObjectURL(url); setPreview(null); };
  }, [file, isImage]);
  return <li className="helpdesk-file-chip">
    <span className="helpdesk-file-thumb">{preview ? <PlainImage src={preview} alt="" /> : isImage ? <ImageIcon size={16} aria-hidden="true" /> : <FileText size={16} aria-hidden="true" />}</span>
    <span className="helpdesk-file-name">{file.name}</span><span className="helpdesk-file-size">{formatBytes(file.size)}</span>
    {onRemove ? <button type="button" onClick={onRemove} aria-label={removeLabel}><X size={14} aria-hidden="true" /></button> : null}
  </li>;
}

/** Read-only chip for a file the learner chose (assistant modal, Figma 1341:29). */
export function FileSummaryChip({ name, size, image }: { name: string; size: number; image: boolean }) {
  return <span className="helpdesk-file-chip helpdesk-file-chip-static">
    <span className="helpdesk-file-thumb">{image ? <ImageIcon size={16} aria-hidden="true" /> : <FileText size={16} aria-hidden="true" />}</span>
    <span className="helpdesk-file-name">{name}</span><span className="helpdesk-file-size">{formatBytes(size)}</span>
  </span>;
}

export function StatusPill({ status, copy }: { status: TicketStatus; copy: HelpdeskCopy }) {
  return <span className={`helpdesk-status-pill helpdesk-status-${status.toLowerCase().replace("_", "-")}`}>{copy.status[status]}</span>;
}

export function LinkifiedText({ text }: { text: string }) {
  return <>{linkify(text).map((segment, index) => segment.href ? <a key={index} href={segment.href} target="_blank" rel="noopener noreferrer">{segment.text}</a> : <span key={index}>{segment.text}</span>)}</>;
}

/** Message attachments: images inline as thumbnails, everything else as a download chip. */
export function MessageAttachments({ attachments, copy }: { attachments: AttachmentView[]; copy: HelpdeskCopy }) {
  if (!attachments.length) return null;
  return <div className="helpdesk-message-attachments">{attachments.map((attachment) => attachment.contentType.startsWith("image/")
    ? <a key={attachment.id} className="helpdesk-attachment-image" href={attachment.url} target="_blank" rel="noopener noreferrer"><PlainImage src={attachment.url} alt={attachment.fileName} /></a>
    : <a key={attachment.id} className="helpdesk-file-chip helpdesk-file-chip-static" href={attachment.url} download={attachment.fileName} aria-label={fillTemplate(copy.detail.download, { name: attachment.fileName })}>
      <span className="helpdesk-file-thumb"><FileText size={16} aria-hidden="true" /></span><span className="helpdesk-file-name">{attachment.fileName}</span><span className="helpdesk-file-size">{formatBytes(attachment.sizeBytes)}</span><Download size={14} aria-hidden="true" />
    </a>)}</div>;
}

/** A date in the reader's own time zone (the server renders UTC; the browser's wording wins after hydration). */
export function LocalTime({ iso, locale, dateOnly = false }: { iso: string; locale: string; dateOnly?: boolean }) {
  const format = new Intl.DateTimeFormat(locale, dateOnly ? { dateStyle: "medium" } : { dateStyle: "medium", timeStyle: "short" });
  return <time dateTime={iso} suppressHydrationWarning>{format.format(new Date(iso))}</time>;
}

/** blob: previews and private, no-store attachment URLs cannot go through next/image optimisation. */
function PlainImage({ src, alt }: { src: string; alt: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} loading="lazy" />;
}
