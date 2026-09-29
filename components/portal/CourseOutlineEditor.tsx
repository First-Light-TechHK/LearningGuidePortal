"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Save, Trash2, Eye, Pencil, ChevronLeft } from "lucide-react";
import type { CourseDraftInput, CatalogueEntry } from "@/contracts/course-authoring";
import type { ProductCourse } from "@/services/productStore";
import type { getMessages } from "@/lib/i18n/messages";
import { getCourseManagementMessages } from "@/lib/i18n/courseManagementMessages";
import { resolveOutlineSelection, type OutlineSelection } from "@/lib/courseEditor";
import { CourseMetadataEditor } from "./CourseMetadataEditor";
import { LessonContentEditor } from "./LessonContentEditor";
import { LessonContentPlayer } from "./LessonContentPlayer";
import { CourseUploadActivity } from "./CourseUploadActivity";
import styles from "./CourseOutlineEditor.module.css";

type Copy = ReturnType<typeof getMessages>["authoring"];

export function CourseOutlineEditor({ course, copy, onSaved, onClose, catalogue = [], locale = "en-GB" }: { course: ProductCourse; copy: Copy; onSaved: () => Promise<void>; onClose: () => void; catalogue?: CatalogueEntry[]; locale?: "en-GB" | "zh-CN" }) {
  const messages = getCourseManagementMessages(locale);
  const draftOf = (value: ProductCourse): CourseDraftInput => ({ expectedUpdatedAt: value.updatedAt, title: value.title, description: value.description, subtitle: value.subtitle || "", cover: value.cover ?? value.thumbnailPath ?? null, level: value.level || "", tags: value.tags || [], categoryId: value.categoryId || null, subjectId: value.subjectId || null, referencePrice: value.referencePrice ?? null, discount: value.discount ?? null, sections: structuredClone(value.sections), removedSectionIds: [], removedLessonIds: [] });
  const [draft, setDraft] = useState<CourseDraftInput>(() => draftOf(course));
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [coverUploading, setUploading] = useState(false), [preview, setPreview] = useState(false), [saved, setSaved] = useState(false);
  const [tab, setTab] = useState<"basic" | "content">(course.sections.length ? "content" : "basic");
  const [selection, setSelection] = useState<OutlineSelection | null>(() => resolveOutlineSelection(course.sections, null));
  const [nestedUploads, setNestedUploads] = useState(0);
  const uploading = coverUploading || nestedUploads > 0;
  const outline = useMemo(() => resolveOutlineSelection(draft.sections, selection), [draft.sections, selection]);
  const sectionIndex = draft.sections.findIndex((section) => section.id === outline?.sectionId);
  const section = sectionIndex >= 0 ? draft.sections[sectionIndex] : null;
  const lessonIndex = section?.lessons.findIndex((lesson) => lesson.id === outline?.lessonId) ?? -1;
  const lesson = section && lessonIndex >= 0 ? section.lessons[lessonIndex] : null;
  const beginUpload = useCallback(() => {
    setNestedUploads((count) => count + 1);
    let pending = true;
    return () => { if (pending) { pending = false; setNestedUploads((count) => count - 1); } };
  }, []);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  function edit(fn: (next: CourseDraftInput) => void) {
    setDraft((previous) => { const next = structuredClone(previous); fn(next); return next; });
    setDirty(true);
    setSaved(false);
  }
  function move<T>(items: T[], index: number, delta: number) {
    const target = index + delta;
    if (target >= 0 && target < items.length) [items[index], items[target]] = [items[target], items[index]];
  }
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
  function addSection() {
    const id = `new-${crypto.randomUUID()}`;
    edit((next) => { next.sections.push({ id, title: copy.newSection, lessons: [] }); });
    setSelection({ sectionId: id, lessonId: null });
    setTab("content");
  }
  function addLesson(index: number) {
    const sectionId = draft.sections[index].id;
    const id = `new-${crypto.randomUUID()}`;
    edit((next) => { next.sections[index].lessons.push({ id, title: "", body: "", contents: [], durationMinutes: 20, isPublic: false }); });
    setSelection({ sectionId, lessonId: id });
    setTab("content");
  }
  const locked = busy || uploading;
  return <CourseUploadActivity.Provider value={beginUpload}><form className={styles.page} onSubmit={save}>
    <header className={styles.header}>
      <div>
        <h1>{draft.title || copy.heading}</h1>
        <p>{messages.pageLead}</p>
      </div>
      <div className={styles.actions}>
        <button className={styles.ghost} type="button" onClick={close} disabled={locked}><ChevronLeft size={18}/>{copy.close}</button>
        <button className={styles.secondary} type="button" disabled={locked} onClick={() => setPreview(!preview)}>{preview ? <Pencil size={16}/> : <Eye size={16}/>}{preview ? messages.edit : messages.preview}</button>
        <button className={styles.primary} type="submit" disabled={locked || !dirty}><Save size={16}/>{copy.save}</button>
      </div>
    </header>
    {error && <p role="alert" className="portal-form-error">{error}</p>}
    {saved && <p role="status">{messages.saved}</p>}
    {preview ? <section className={styles.card}><div className={styles.pane}><h2>{draft.title}</h2><p>{draft.subtitle}</p><p>{draft.description}</p>{draft.sections.map((item) => <section key={item.id}><h3>{item.title}</h3>{item.lessons.map((entry) => <article key={entry.id}><h4>{entry.title}</h4>{entry.contents?.length ? <LessonContentPlayer contents={entry.contents} locale={locale}/> : <p style={{ whiteSpace: "pre-wrap" }}>{entry.body}</p>}</article>)}</section>)}</div></section> : <section className={styles.card}>
      <nav className={styles.tabs} aria-label={copy.heading}>
        <button className={`${styles.tab} ${tab === "basic" ? styles.tabActive : ""}`} type="button" aria-pressed={tab === "basic"} onClick={() => setTab("basic")}>{messages.tabBasic}</button>
        <button className={`${styles.tab} ${tab === "content" ? styles.tabActive : ""}`} type="button" aria-pressed={tab === "content"} onClick={() => setTab("content")}>{messages.tabContent}</button>
      </nav>
      {tab === "basic" ? <div className={styles.pane}><fieldset className={styles.fields} disabled={locked}>
        <label>{copy.title}<input required maxLength={255} value={draft.title} onChange={(event) => edit((next) => { next.title = event.target.value; })}/></label>
        <label>{copy.description}<textarea maxLength={5000} rows={4} value={draft.description} onChange={(event) => edit((next) => { next.description = event.target.value; })}/></label>
        <CourseMetadataEditor courseId={course.id} value={draft} locale={locale} catalogue={catalogue} onUploadingChange={setUploading} onChange={(patch) => edit((next) => { Object.assign(next, patch); })}/>
      </fieldset></div> : <div className={styles.pane}>
        <div className={styles.workspace}>
          <aside className={styles.outline}>
            {draft.sections.map((item, index) => <section className={styles.section} key={item.id}>
              <div className={styles.sectionHead}>
                <button type="button" onClick={() => setSelection({ sectionId: item.id, lessonId: item.lessons[0]?.id ?? null })}>{item.title || copy.newSection}</button>
                <button className={styles.icon} type="button" title={copy.up} aria-label={copy.up} disabled={locked || index === 0} onClick={() => edit((next) => move(next.sections, index, -1))}><ArrowUp size={16}/></button>
                <button className={styles.icon} type="button" title={copy.down} aria-label={copy.down} disabled={locked || index === draft.sections.length - 1} onClick={() => edit((next) => move(next.sections, index, 1))}><ArrowDown size={16}/></button>
                <button className={styles.icon} type="button" title={messages.removeSection} aria-label={messages.removeSection} disabled={locked} onClick={() => { if (window.confirm(messages.removeConfirm)) edit((next) => { const removed = next.sections.splice(index, 1)[0]; if (!removed.id.startsWith("new-")) next.removedSectionIds!.push(removed.id); for (const entry of removed.lessons) if (!entry.id.startsWith("new-")) next.removedLessonIds!.push(entry.id); }); }}><Trash2 size={16}/></button>
              </div>
              <div className={styles.lessons}>
                {item.lessons.map((entry) => <button className={`${styles.lessonRow} ${entry.id === lesson?.id ? styles.lessonRowActive : ""}`} type="button" key={entry.id} onClick={() => setSelection({ sectionId: item.id, lessonId: entry.id })}>{entry.title || copy.newLesson}</button>)}
                <button className={styles.secondary} type="button" disabled={locked} onClick={() => addLesson(index)}><Plus size={16}/>{copy.addLesson}</button>
              </div>
            </section>)}
            <button className={styles.secondary} type="button" disabled={locked} onClick={addSection}><Plus size={16}/>{copy.addSection}</button>
          </aside>
          {lesson && section ? <fieldset className={styles.lesson} disabled={locked}>
            <label>{copy.section}<input required maxLength={255} value={section.title} onChange={(event) => edit((next) => { next.sections[sectionIndex].title = event.target.value; })}/></label>
            <label>{copy.lesson}<input required maxLength={255} value={lesson.title} onChange={(event) => edit((next) => { next.sections[sectionIndex].lessons[lessonIndex].title = event.target.value; })}/></label>
            <div className={styles.actions}>
              <button className={styles.icon} type="button" title={copy.up} aria-label={copy.up} disabled={locked || lessonIndex === 0} onClick={() => edit((next) => move(next.sections[sectionIndex].lessons, lessonIndex, -1))}><ArrowUp size={16}/></button>
              <button className={styles.icon} type="button" title={copy.down} aria-label={copy.down} disabled={locked || lessonIndex === section.lessons.length - 1} onClick={() => edit((next) => move(next.sections[sectionIndex].lessons, lessonIndex, 1))}><ArrowDown size={16}/></button>
              <button className={styles.secondary} type="button" disabled={locked} onClick={() => { if (window.confirm(messages.removeConfirm)) edit((next) => { const removed = next.sections[sectionIndex].lessons.splice(lessonIndex, 1)[0]; if (!removed.id.startsWith("new-")) next.removedLessonIds!.push(removed.id); }); }}><Trash2 size={16}/>{messages.removeLesson}</button>
            </div>
            {lesson.contents === undefined ? <>
              <label>{copy.body}<textarea maxLength={200000} rows={10} value={lesson.body} onChange={(event) => edit((next) => { next.sections[sectionIndex].lessons[lessonIndex].body = event.target.value; })}/></label>
              <button type="button" className={styles.secondary} onClick={() => edit((next) => { const element = document.createElement("p"); element.textContent = lesson.body; next.sections[sectionIndex].lessons[lessonIndex].contents = [{ id: `content-${crypto.randomUUID()}`, title: lesson.title || copy.newLesson, type: "text", mode: "lecture", html: element.outerHTML, nodes: [] }]; })}>{messages.convert}</button>
            </> : <LessonContentEditor courseId={course.id} value={lesson.contents} locale={locale} onChange={(contents) => edit((next) => { next.sections[sectionIndex].lessons[lessonIndex].contents = contents; next.sections[sectionIndex].lessons[lessonIndex].body = ""; })}/>}
            <label>{copy.duration}<input type="number" min={1} max={600} required value={lesson.durationMinutes} onChange={(event) => edit((next) => { next.sections[sectionIndex].lessons[lessonIndex].durationMinutes = Number(event.target.value); })}/></label>
            <label>{copy.videoDuration}<input type="number" min={0} max={36000} value={lesson.videoDurationSeconds ?? ""} onChange={(event) => edit((next) => { next.sections[sectionIndex].lessons[lessonIndex].videoDurationSeconds = event.target.value === "" ? null : Number(event.target.value); })}/></label>
            <label className="backoffice-checkbox"><input type="checkbox" checked={lesson.isPublic} onChange={(event) => edit((next) => { if (event.target.checked) next.sections.forEach((item) => item.lessons.forEach((item) => { item.isPublic = false; })); next.sections[sectionIndex].lessons[lessonIndex].isPublic = event.target.checked; })}/>{copy.publicLesson}</label>
            <label>{copy.moveTo}<select value={section.id} onChange={(event) => { const targetId = event.target.value; if (targetId === section.id) return; edit((next) => { const source = next.sections[sectionIndex]; const target = next.sections.find((item) => item.id === targetId); if (!target) return; target.lessons.push(source.lessons.splice(lessonIndex, 1)[0]); }); setSelection({ sectionId: targetId, lessonId: lesson.id }); }}>{draft.sections.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
          </fieldset> : <p className={styles.empty}>{draft.sections.length ? copy.addLesson : copy.addSection}</p>}
        </div>
      </div>}
    </section>}
  </form></CourseUploadActivity.Provider>;
}
