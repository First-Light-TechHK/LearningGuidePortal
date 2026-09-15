"use client";

import { useState } from "react";
import { ArrowUp, ArrowDown, Plus, Save, X } from "lucide-react";
import type { CourseDraftInput } from "@/contracts/course-authoring";
import type { ProductCourse } from "@/services/productStore";
import type { getMessages } from "@/lib/i18n/messages";

type Copy = ReturnType<typeof getMessages>["authoring"];
export function CourseOutlineEditor({ course, copy, onSaved, onClose }: { course: ProductCourse; copy: Copy; onSaved: () => Promise<void>; onClose: () => void }) {
  const [draft, setDraft] = useState<CourseDraftInput>(() => ({ expectedUpdatedAt: course.updatedAt, title: course.title, description: course.description, sections: structuredClone(course.sections) }));
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  function edit(fn: (next: CourseDraftInput) => void) {
    setDraft(previous => { const next = structuredClone(previous); fn(next); return next; });
    setDirty(true);
  }
  function move<T>(items: T[], index: number, delta: number) { const target = index + delta; if (target >= 0 && target < items.length) [items[index], items[target]] = [items[target], items[index]]; }
  function close() { if (!dirty || window.confirm(copy.discard)) onClose(); }
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch(`/api/backoffice/courses/${encodeURIComponent(course.id)}/draft`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
      const result = await response.json();
      if (!response.ok) { setError(copy.errors[result.code as keyof typeof copy.errors] || copy.errors.failed); return; }
      setDraft({ ...draft, expectedUpdatedAt: result.data.updatedAt, sections: result.data.sections });
      setDirty(false);
      await onSaved();
      onClose();
    } catch { setError(copy.errors.failed); } finally { setBusy(false); }
  }
  const orderButtons = (index: number, count: number, reorder: (delta: number) => void) => <span className="authoring-actions"><button type="button" title={copy.up} aria-label={copy.up} disabled={busy || index === 0} onClick={() => reorder(-1)}><ArrowUp size={18}/></button><button type="button" title={copy.down} aria-label={copy.down} disabled={busy || index === count - 1} onClick={() => reorder(1)}><ArrowDown size={18}/></button></span>;
  return <form className="backoffice-form authoring-editor" onSubmit={save}>
    <header className="authoring-heading"><h2>{copy.heading}</h2><button type="button" title={copy.close} aria-label={copy.close} onClick={close} disabled={busy}><X size={20}/></button></header>
    {error && <p role="alert" className="portal-form-error">{error}</p>}
    <fieldset disabled={busy}>
      <label>{copy.title}<input required maxLength={255} value={draft.title} onChange={event => edit(next => { next.title = event.target.value; })}/></label>
      <label>{copy.description}<textarea maxLength={5000} rows={3} value={draft.description} onChange={event => edit(next => { next.description = event.target.value; })}/></label>
      {draft.sections.map((section, s) => <section className="authoring-section" key={section.id}>
        <div className="authoring-heading"><label>{copy.section}<input required maxLength={255} value={section.title} onChange={event => edit(next => { next.sections[s].title = event.target.value; })}/></label>{orderButtons(s, draft.sections.length, delta => edit(next => move(next.sections, s, delta)))}</div>
        {section.lessons.map((lesson, l) => <details className="authoring-lesson" key={lesson.id} open={lesson.id.startsWith("new-")}>
          <summary>{lesson.title || copy.newLesson}</summary>
          <div className="authoring-heading"><label>{copy.lesson}<input required maxLength={255} value={lesson.title} onChange={event => edit(next => { next.sections[s].lessons[l].title = event.target.value; })}/></label>{orderButtons(l, section.lessons.length, delta => edit(next => move(next.sections[s].lessons, l, delta)))}</div>
          <label>{copy.body}<textarea required maxLength={200000} rows={8} value={lesson.body} onChange={event => edit(next => { next.sections[s].lessons[l].body = event.target.value; })}/></label>
          <label>{copy.duration}<input type="number" min={1} max={600} required value={lesson.durationMinutes} onChange={event => edit(next => { next.sections[s].lessons[l].durationMinutes = Number(event.target.value); })}/></label>
          <label>{copy.videoDuration}<input type="number" min={0} max={36000} value={lesson.videoDurationSeconds ?? ""} onChange={event => edit(next => { next.sections[s].lessons[l].videoDurationSeconds = event.target.value === "" ? null : Number(event.target.value); })}/></label>
          <label className="backoffice-checkbox"><input type="checkbox" checked={lesson.isPublic} onChange={event => edit(next => { if (event.target.checked) next.sections.forEach(item => item.lessons.forEach(item => { item.isPublic = false; })); next.sections[s].lessons[l].isPublic = event.target.checked; })}/>{copy.publicLesson}</label>
          <label>{copy.moveTo}<select value={section.id} onChange={event => edit(next => { const target = next.sections.find(item => item.id === event.target.value); if (target && target.id !== section.id) target.lessons.push(next.sections[s].lessons.splice(l, 1)[0]); })}>{draft.sections.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        </details>)}
        <button className="portal-button portal-button-secondary" type="button" onClick={() => edit(next => { next.sections[s].lessons.push({ id: `new-${crypto.randomUUID()}`, title: "", body: "", durationMinutes: 20, isPublic: false }); })}><Plus size={16}/>{copy.addLesson}</button>
      </section>)}
      <button className="portal-button portal-button-secondary" type="button" onClick={() => edit(next => { next.sections.push({ id: `new-${crypto.randomUUID()}`, title: copy.newSection, lessons: [] }); })}><Plus size={16}/>{copy.addSection}</button>
    </fieldset>
    <button className="portal-button portal-button-primary" type="submit" disabled={busy || !dirty}><Save size={16}/>{busy ? copy.saving : copy.save}</button>
  </form>;
}
