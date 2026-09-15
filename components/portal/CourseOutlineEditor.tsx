"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowUp, ArrowDown, Plus, Save, X, Trash2, Eye, Pencil } from "lucide-react";
import type { CourseDraftInput, CatalogueEntry } from "@/contracts/course-authoring";
import type { ProductCourse } from "@/services/productStore";
import type { getMessages } from "@/lib/i18n/messages";
import { getCourseManagementMessages } from "@/lib/i18n/courseManagementMessages";
import { CourseMetadataEditor } from "./CourseMetadataEditor";
import { LessonContentEditor } from "./LessonContentEditor";
import { LessonContentPlayer } from "./LessonContentPlayer";
import { CourseUploadActivity } from "./CourseUploadActivity";

type Copy = ReturnType<typeof getMessages>["authoring"];
export function CourseOutlineEditor({ course, copy, onSaved, onClose, catalogue = [], locale = "en-GB" }: { course: ProductCourse; copy: Copy; onSaved: () => Promise<void>; onClose: () => void; catalogue?: CatalogueEntry[]; locale?: "en-GB" | "zh-CN" }) {
  const messages = getCourseManagementMessages(locale);
  const draftOf = (value: ProductCourse): CourseDraftInput => ({ expectedUpdatedAt: value.updatedAt, title: value.title, description: value.description, subtitle: value.subtitle || "", cover: value.cover ?? value.thumbnailPath ?? null, level: value.level || "", tags: value.tags || [], categoryId: value.categoryId || null, subjectId: value.subjectId || null, referencePrice: value.referencePrice ?? null, discount: value.discount ?? null, sections: structuredClone(value.sections), removedSectionIds: [], removedLessonIds: [] });
  const [draft, setDraft] = useState<CourseDraftInput>(() => draftOf(course));
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [coverUploading, setUploading] = useState(false), [preview, setPreview] = useState(false), [saved, setSaved] = useState(false);
  const [nestedUploads, setNestedUploads] = useState(0);
  const uploading = coverUploading || nestedUploads > 0;
  const beginUpload = useCallback(() => {
    setNestedUploads(count => count + 1);
    let pending = true;
    return () => { if (pending) { pending = false; setNestedUploads(count => count - 1); } };
  }, []);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  function edit(fn: (next: CourseDraftInput) => void) {
    setDraft(previous => { const next = structuredClone(previous); fn(next); return next; });
    setDirty(true);
    setSaved(false);
  }
  function move<T>(items: T[], index: number, delta: number) { const target = index + delta; if (target >= 0 && target < items.length) [items[index], items[target]] = [items[target], items[index]]; }
  function close() { if (!dirty || window.confirm(copy.discard)) onClose(); }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy || uploading) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/backoffice/courses/${encodeURIComponent(course.id)}/draft`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
      const result = await response.json();
      if (!response.ok) { setError(messages.errors[result.code as keyof typeof messages.errors] || copy.errors.failed); return; }
      setDraft(draftOf(result.data));
      setDirty(false);
      setSaved(true);
      await onSaved();
      onClose();
    } catch { setError(copy.errors.failed); } finally { setBusy(false); }
  }
  const orderButtons = (index: number, count: number, reorder: (delta: number) => void) => <span className="authoring-actions"><button type="button" title={copy.up} aria-label={copy.up} disabled={busy || index === 0} onClick={() => reorder(-1)}><ArrowUp size={18}/></button><button type="button" title={copy.down} aria-label={copy.down} disabled={busy || index === count - 1} onClick={() => reorder(1)}><ArrowDown size={18}/></button></span>;
  return <CourseUploadActivity.Provider value={beginUpload}><form className="backoffice-form authoring-editor" onSubmit={save}>
    <header className="authoring-heading"><h2>{copy.heading}</h2><div className="authoring-actions"><button type="button" title={preview ? messages.edit : messages.preview} aria-label={preview ? messages.edit : messages.preview} disabled={busy || uploading} onClick={() => setPreview(!preview)}>{preview ? <Pencil size={18}/> : <Eye size={18}/>}</button><button type="button" title={copy.close} aria-label={copy.close} onClick={close} disabled={busy || uploading}><X size={20}/></button></div></header>
    {error && <p role="alert" className="portal-form-error">{error}</p>}
    {saved && <p role="status">{messages.saved}</p>}
    {preview ? <div className="course-draft-preview"><h2>{draft.title}</h2><p>{draft.subtitle}</p><p>{draft.description}</p>{draft.sections.map(section => <section key={section.id}><h3>{section.title}</h3>{section.lessons.map(lesson => <article key={lesson.id}><h4>{lesson.title}</h4>{lesson.contents?.length ? <LessonContentPlayer contents={lesson.contents} locale={locale}/> : <p style={{ whiteSpace: "pre-wrap" }}>{lesson.body}</p>}</article>)}</section>)}</div> : <fieldset disabled={busy || uploading} inert={busy || uploading}>
      <label>{copy.title}<input required maxLength={255} value={draft.title} onChange={event => edit(next => { next.title = event.target.value; })}/></label>
      <label>{copy.description}<textarea maxLength={5000} rows={3} value={draft.description} onChange={event => edit(next => { next.description = event.target.value; })}/></label>
      <CourseMetadataEditor courseId={course.id} value={draft} locale={locale} catalogue={catalogue} onUploadingChange={setUploading} onChange={patch => edit(next => { Object.assign(next, patch); })}/>
      {draft.sections.map((section, s) => <section className="authoring-section" key={section.id}>
        <div className="authoring-heading"><label>{copy.section}<input required maxLength={255} value={section.title} onChange={event => edit(next => { next.sections[s].title = event.target.value; })}/></label>{orderButtons(s, draft.sections.length, delta => edit(next => move(next.sections, s, delta)))}<button type="button" title={messages.removeSection} aria-label={messages.removeSection} onClick={() => { if (window.confirm(messages.removeConfirm)) edit(next => { const removed = next.sections.splice(s, 1)[0]; if (!removed.id.startsWith("new-")) next.removedSectionIds!.push(removed.id); for (const lesson of removed.lessons) if (!lesson.id.startsWith("new-")) next.removedLessonIds!.push(lesson.id); }); }}><Trash2 size={18}/></button></div>
        {section.lessons.map((lesson, l) => <details className="authoring-lesson" key={lesson.id} open={lesson.id.startsWith("new-")}>
          <summary>{lesson.title || copy.newLesson}</summary>
          <div className="authoring-heading"><label>{copy.lesson}<input required maxLength={255} value={lesson.title} onChange={event => edit(next => { next.sections[s].lessons[l].title = event.target.value; })}/></label>{orderButtons(l, section.lessons.length, delta => edit(next => move(next.sections[s].lessons, l, delta)))}<button type="button" title={messages.removeLesson} aria-label={messages.removeLesson} onClick={() => { if (window.confirm(messages.removeConfirm)) edit(next => { const removed = next.sections[s].lessons.splice(l, 1)[0]; if (!removed.id.startsWith("new-")) next.removedLessonIds!.push(removed.id); }); }}><Trash2 size={18}/></button></div>
          {lesson.contents === undefined ? <><label>{copy.body}<textarea maxLength={200000} rows={8} value={lesson.body} onChange={event => edit(next => { next.sections[s].lessons[l].body = event.target.value; })}/></label><button type="button" className="portal-button portal-button-secondary" onClick={() => edit(next => { const element = document.createElement("p"); element.textContent = lesson.body; next.sections[s].lessons[l].contents = [{ id: `content-${crypto.randomUUID()}`, title: lesson.title || copy.newLesson, type: "text", mode: "lecture", html: element.outerHTML, nodes: [] }]; })}>{messages.convert}</button></> : <LessonContentEditor courseId={course.id} value={lesson.contents} locale={locale} onChange={contents => edit(next => { next.sections[s].lessons[l].contents = contents; next.sections[s].lessons[l].body = ""; })}/>}
          <label>{copy.duration}<input type="number" min={1} max={600} required value={lesson.durationMinutes} onChange={event => edit(next => { next.sections[s].lessons[l].durationMinutes = Number(event.target.value); })}/></label>
          <label>{copy.videoDuration}<input type="number" min={0} max={36000} value={lesson.videoDurationSeconds ?? ""} onChange={event => edit(next => { next.sections[s].lessons[l].videoDurationSeconds = event.target.value === "" ? null : Number(event.target.value); })}/></label>
          <label className="backoffice-checkbox"><input type="checkbox" checked={lesson.isPublic} onChange={event => edit(next => { if (event.target.checked) next.sections.forEach(item => item.lessons.forEach(item => { item.isPublic = false; })); next.sections[s].lessons[l].isPublic = event.target.checked; })}/>{copy.publicLesson}</label>
          <label>{copy.moveTo}<select value={section.id} onChange={event => edit(next => { const target = next.sections.find(item => item.id === event.target.value); if (target && target.id !== section.id) target.lessons.push(next.sections[s].lessons.splice(l, 1)[0]); })}>{draft.sections.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        </details>)}
        <button className="portal-button portal-button-secondary" type="button" onClick={() => edit(next => { next.sections[s].lessons.push({ id: `new-${crypto.randomUUID()}`, title: "", body: "", contents: [], durationMinutes: 20, isPublic: false }); })}><Plus size={16}/>{copy.addLesson}</button>
      </section>)}
      <button className="portal-button portal-button-secondary" type="button" onClick={() => edit(next => { next.sections.push({ id: `new-${crypto.randomUUID()}`, title: copy.newSection, lessons: [] }); })}><Plus size={16}/>{copy.addSection}</button>
    </fieldset>}
    <button className="portal-button portal-button-primary" type="submit" disabled={busy || uploading || !dirty}><Save size={16}/>{busy ? copy.saving : copy.save}</button>
  </form></CourseUploadActivity.Provider>;
}
