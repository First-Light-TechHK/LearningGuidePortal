"use client";

import { useState } from "react";
import Image from "next/image";
import { Plus, X } from "lucide-react";
import type { CourseMetadata, CatalogueEntry } from "@/contracts/course-authoring";
import { getCourseManagementMessages } from "@/lib/i18n/courseManagementMessages";

export function CourseMetadataEditor({ courseId, value, onChange, catalogue, locale, onUploadingChange }: {
  courseId: string; value: CourseMetadata; onChange: (patch: Partial<CourseMetadata>) => void; catalogue: CatalogueEntry[]; locale: "en-GB" | "zh-CN"; onUploadingChange: (busy: boolean) => void;
}) {
  const copy = getCourseManagementMessages(locale);
  const [tag, setTag] = useState(""), [error, setError] = useState(""), [uploading, setUploading] = useState(false);
  const categories = catalogue.filter(entry => !entry.parentId && (entry.status === "active" || entry.id === value.categoryId));
  const subjects = catalogue.filter(entry => entry.parentId === value.categoryId && (entry.status === "active" || entry.id === value.subjectId));
  function addTag() {
    const next = tag.trim();
    if (next && !(value.tags || []).includes(next) && (value.tags?.length || 0) < 30) onChange({ tags: [...(value.tags || []), next] });
    setTag("");
  }
  async function upload(file?: File) {
    if (!file) return;
    setUploading(true); onUploadingChange(true); setError("");
    try {
      const data = new FormData(); data.set("file", file); data.set("usage", "course-cover");
      const response = await fetch(`/api/backoffice/courses/${encodeURIComponent(courseId)}/media`, { method: "POST", body: data });
      const result = await response.json();
      if (!response.ok || !result.data?.url) throw new Error();
      onChange({ cover: result.data.url });
    } catch { setError(copy.errors.failed); } finally { setUploading(false); onUploadingChange(false); }
  }
  return <div className="course-metadata">
    <label>{copy.subtitle}<input maxLength={255} value={value.subtitle || ""} onChange={e => onChange({ subtitle: e.target.value })}/></label>
    <div className="course-fields">
      <label>{copy.category}<select value={value.categoryId || ""} onChange={e => onChange({ categoryId: e.target.value || null, subjectId: null })}><option value="">{copy.none}</option>{categories.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
      <label>{copy.subject}<select value={value.subjectId || ""} disabled={!value.categoryId} onChange={e => onChange({ subjectId: e.target.value || null })}><option value="">{copy.none}</option>{subjects.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
      <label>{copy.level}<select value={value.level || ""} onChange={e => onChange({ level: e.target.value as CourseMetadata["level"] })}>{(["", "beginner", "intermediate", "advanced"] as const).map(level => <option key={level} value={level}>{level ? copy[level] : copy.none}</option>)}</select></label>
    </div>
    <label>{copy.tags}<span className="course-tag-input"><input maxLength={60} value={tag} onChange={e => setTag(e.target.value)} onBlur={addTag} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}/><button type="button" title={copy.addTag} aria-label={copy.addTag} onClick={addTag}><Plus size={18}/></button></span></label>
    <div className="course-tags">{(value.tags || []).map(item => <span key={item}>{item}<button type="button" title={copy.removeLesson + ": " + item} aria-label={copy.removeLesson + ": " + item} onClick={() => onChange({ tags: value.tags!.filter(t => t !== item) })}><X size={14}/></button></span>)}</div>
    <div className="course-fields">
      <label>{copy.referencePrice}<input type="number" min="0" max="99999999" step="0.01" value={value.referencePrice ?? ""} onChange={e => onChange({ referencePrice: e.target.value === "" ? null : Number(e.target.value) })}/></label>
      <label>{copy.discount}<input type="number" min="0" max="100" step="0.01" value={value.discount ?? ""} onChange={e => onChange({ discount: e.target.value === "" ? null : Number(e.target.value) })}/></label>
    </div>
    <label>{copy.uploadCover}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={uploading} onChange={e => { void upload(e.target.files?.[0]); e.target.value = ""; }}/></label>
    {uploading && <p role="status">{copy.loading}</p>}
    {error && <p role="alert" className="portal-form-error">{error}</p>}
    {value.cover && <div className="course-cover-preview"><Image src={value.cover} alt={copy.cover} width={240} height={135} unoptimized/><button type="button" title={copy.removeCover} aria-label={copy.removeCover} onClick={() => onChange({ cover: null })}><X size={18}/></button></div>}
  </div>;
}
