"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Archive, ChevronLeft, ChevronRight, Eye, Pencil, Plus, RotateCcw, UserRoundCog, X } from "lucide-react";
import { CourseOutlineEditor } from "./CourseOutlineEditor";
import { CourseCatalogueManager } from "./CourseCatalogueManager";
import { LessonContentPlayer } from "./LessonContentPlayer";
import { getMessages } from "@/lib/i18n/messages";
import { getCourseManagementMessages } from "@/lib/i18n/courseManagementMessages";
import type { ProductCourse } from "@/services/productStore";
import type { CatalogueEntry } from "@/contracts/course-authoring";
import styles from "./CourseManager.module.css";

type ListResult = { courses: ProductCourse[]; total: number; page: number; pages: number; counts: { total: number; draft: number; published: number; archived: number; lessons: number } };
const empty: ListResult = { courses: [], total: 0, page: 1, pages: 1, counts: { total: 0, draft: 0, published: 0, archived: 0, lessons: 0 } };

export function CourseManager({ copy, locale, operator = false }: { copy: ReturnType<typeof getMessages>["backoffice"]; locale: "en-GB" | "zh-CN"; operator?: boolean }) {
  const messages = getCourseManagementMessages(locale);
  const [result, setResult] = useState<ListResult>(empty), [catalogue, setCatalogue] = useState<CatalogueEntry[]>([]);
  const [search, setSearch] = useState(""), [query, setQuery] = useState(""), [status, setStatus] = useState("all"), [categoryId, setCategoryId] = useState(""), [subjectId, setSubjectId] = useState(""), [level, setLevel] = useState("");
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(10);
  const [title, setTitle] = useState(""), [description, setDescription] = useState("");
  const [category, setCategory] = useState<NonNullable<ProductCourse["category"]>>("European Humanities");
  const [creating, setCreating] = useState(false), [showCatalogue, setShowCatalogue] = useState(false);
  const [editing, setEditing] = useState<ProductCourse | null>(null), [preview, setPreview] = useState<ProductCourse | null>(null);
  const [assigning, setAssigning] = useState<ProductCourse | null>(null), [ownerEmail, setOwnerEmail] = useState("");
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const loadVersion = useRef(0);
  const failure = useCallback((code: string) => messages.errors[code as keyof typeof messages.errors] || messages.errors.failed, [messages]);
  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({ search: query, status, categoryId, subjectId, level, page: String(page), pageSize: String(pageSize) });
      const response = await fetch("/api/backoffice/courses?" + params, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(failure(data.code));
      if (version === loadVersion.current) { setResult(data); setError(""); }
    } catch (e) { if (version === loadVersion.current) setError(e instanceof Error ? e.message : messages.errors.failed); }
    finally { if (version === loadVersion.current) setLoading(false); }
  }, [query, status, categoryId, subjectId, level, page, pageSize, failure, messages.errors.failed]);
  const loadCatalogue = useCallback(async () => {
    const response = await fetch("/api/backoffice/courses/catalogue", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(failure(data.code));
    setCatalogue(data.entries);
  }, [failure]);
  useEffect(() => { const timeout = setTimeout(() => { setQuery(search); setPage(1); }, 250); return () => clearTimeout(timeout); }, [search]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadCatalogue().catch(() => setError(messages.errors.failed)); }, [loadCatalogue, messages.errors.failed]);

  async function mutate(path: string, method: string, body: unknown) {
    const response = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw new Error(failure(data.code));
    return data;
  }
  async function create(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const data = await mutate("/api/backoffice/courses", "POST", { title, description, category });
      setTitle(""); setDescription(""); setCreating(false); setEditing(data.course); await load();
    } catch (e) { setError(e instanceof Error ? e.message : messages.errors.failed); } finally { setBusy(false); }
  }
  async function updateStatus(course: ProductCourse, nextStatus: ProductCourse["status"]) {
    if (nextStatus === "archived" && !window.confirm(messages.archiveConfirm)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await mutate("/api/backoffice/courses/" + encodeURIComponent(course.id), nextStatus === "archived" ? "DELETE" : "PATCH", { status: nextStatus, expectedUpdatedAt: course.updatedAt });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : messages.errors.failed); } finally { setBusy(false); }
  }
  async function assign(event: FormEvent) {
    event.preventDefault();
    if (!assigning || !window.confirm(messages.assignConfirm)) return;
    setBusy(true); setError("");
    try {
      await mutate("/api/backoffice/courses/" + encodeURIComponent(assigning.id) + "/ownership", "PUT", { email: ownerEmail, expectedUpdatedAt: assigning.updatedAt });
      setAssigning(null); setOwnerEmail(""); setNotice(messages.ownerAssigned); await load();
    } catch (e) { setError(e instanceof Error ? e.message : messages.errors.failed); } finally { setBusy(false); }
  }
  const entryName = (id?: string | null) => catalogue.find(entry => entry.id === id)?.name;
  return <section className={styles.manager + " backoffice-panel"}>
    <header className="course-manager-heading"><div><p className="portal-eyebrow">{copy.title}</p><h1>{copy.courses}</h1></div>{!editing && !preview && <button className="portal-button portal-button-primary" type="button" disabled={busy} onClick={() => { setCreating(!creating); setShowCatalogue(false); }}><Plus size={18}/>{copy.create}</button>}</header>
    {error && <p className="portal-form-error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {editing ? <CourseOutlineEditor key={editing.id} course={editing} locale={locale} catalogue={catalogue} copy={getMessages(locale).authoring} onSaved={load} onClose={() => setEditing(null)}/> : preview ? <section className="course-draft-preview">
      <header className="authoring-heading"><h2>{preview.title}</h2><button type="button" aria-label={messages.close} title={messages.close} onClick={() => setPreview(null)}><X size={18}/></button></header>
      {preview.cover && <img className="preview-cover" src={preview.cover} alt="" width={480} height={270}/>}<p>{preview.subtitle}</p><p>{preview.description}</p>
      {preview.sections.map(section => <section key={section.id}><h3>{section.title}</h3>{section.lessons.map(lesson => <article key={lesson.id}><h4>{lesson.title}</h4>{lesson.contents?.length ? <LessonContentPlayer contents={lesson.contents} locale={locale}/> : <p style={{ whiteSpace: "pre-wrap" }}>{lesson.body}</p>}</article>)}</section>)}
    </section> : <>
      <dl id="course-overview" className="course-counts">{(["total", "draft", "published", "archived", "lessons"] as const).map(key => <div key={key}><dt>{messages[key]}</dt><dd>{result.counts[key]}</dd></div>)}</dl>
      {operator && <nav className="course-tabs"><button type="button" aria-pressed={!showCatalogue} onClick={() => setShowCatalogue(false)}>{copy.courses}</button><button type="button" aria-pressed={showCatalogue} onClick={() => { setShowCatalogue(true); setCreating(false); }}>{messages.catalogue}</button></nav>}
      {showCatalogue && operator ? <CourseCatalogueManager entries={catalogue} locale={locale} onSaved={loadCatalogue}/> : <>
        {creating && <form className="backoffice-form" onSubmit={create}>
          <label>{copy.courseTitle}<input value={title} maxLength={255} onChange={e => setTitle(e.target.value)} required disabled={busy}/></label>
          <label>{copy.description}<textarea value={description} maxLength={5000} onChange={e => setDescription(e.target.value)} rows={3} disabled={busy}/></label>
          <label>{copy.category}<select value={category} onChange={e => setCategory(e.target.value as typeof category)} disabled={busy}>{(["Chinese Humanities", "European Humanities", "Science"] as const).map((value, index) => <option key={value} value={value}>{getMessages(locale).portal.courseCategories[index + 1]}</option>)}</select></label>
          <div className="backoffice-row-actions"><button className="portal-button portal-button-primary" disabled={busy}>{copy.create}</button><button type="button" className="portal-button portal-button-secondary" disabled={busy} onClick={() => setCreating(false)}>{messages.cancel}</button></div>
        </form>}
        <div className="course-filters backoffice-form">
          <label>{messages.search}<input type="search" value={search} maxLength={200} onChange={e => setSearch(e.target.value)}/></label>
          <label>{messages.status}<select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="all">{messages.all}</option>{(["draft", "published", "archived"] as const).map(value => <option key={value} value={value}>{messages[value]}</option>)}</select></label>
          <label>{messages.category}<select value={categoryId} onChange={e => { setCategoryId(e.target.value); setSubjectId(""); setPage(1); }}><option value="">{messages.all}</option>{catalogue.filter(e => !e.parentId).map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
          <label>{messages.subject}<select value={subjectId} disabled={!categoryId} onChange={e => { setSubjectId(e.target.value); setPage(1); }}><option value="">{messages.all}</option>{catalogue.filter(e => e.parentId === categoryId).map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
          <label>{messages.level}<select value={level} onChange={e => { setLevel(e.target.value); setPage(1); }}><option value="">{messages.all}</option>{(["beginner", "intermediate", "advanced"] as const).map(value => <option key={value} value={value}>{messages[value]}</option>)}</select></label>
        </div>
        {loading && <p role="status">{messages.loading}</p>}
        {!loading && !result.courses.length && <p>{messages.empty}</p>}
        <div className="backoffice-course-list" aria-busy={loading}>{result.courses.map(course => <article className="backoffice-course-row" key={course.id}>
          <div className="course-list-identity">{(course.cover || course.thumbnailPath) && <img src={course.cover || course.thumbnailPath!} alt="" width={96} height={60}/>}<div><strong>{course.title}</strong>{course.subtitle && <span>{course.subtitle}</span>}<span>{[entryName(course.categoryId), entryName(course.subjectId), course.level ? messages[course.level] : null, messages[course.status], course.sections.reduce((sum, s) => sum + s.lessons.length, 0) + " " + messages.lessons].filter(Boolean).join(" · ")}</span></div></div>
          <div className="backoffice-row-actions">
            <span className="authoring-actions">
              <button type="button" title={course.status === "draft" ? messages.edit : messages.publishedRequired} aria-label={getMessages(locale).authoring.heading} disabled={busy || course.status !== "draft"} onClick={() => setEditing(course)}><Pencil size={18}/></button>
              <button type="button" title={messages.preview} aria-label={messages.preview + ": " + course.title} onClick={() => setPreview(course)}><Eye size={18}/></button>
              {operator && <button type="button" title={messages.ownership} aria-label={messages.ownership + ": " + course.title} disabled={busy} onClick={() => { setAssigning(course); setOwnerEmail(""); }}><UserRoundCog size={18}/></button>}
              {course.status !== "archived" && <button type="button" title={messages.archive} aria-label={messages.archive + ": " + course.title} disabled={busy} onClick={() => void updateStatus(course, "archived")}><Archive size={18}/></button>}
            </span>
            <button className="portal-button portal-button-secondary" type="button" disabled={busy} onClick={() => void updateStatus(course, course.status === "published" || course.status === "archived" ? "draft" : "published")}>{course.status === "archived" && <RotateCcw size={16}/>} {course.status === "published" ? copy.unpublish : course.status === "archived" ? messages.restore : copy.publish}</button>
          </div>
        </article>)}</div>
        <footer className="course-pagination"><label>{messages.pageSize}<select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}>{[10, 25, 50].map(size => <option key={size}>{size}</option>)}</select></label><span>{messages.page} {result.page} {messages.of} {result.pages} · {result.total}</span><span className="authoring-actions"><button type="button" title={messages.previous} aria-label={messages.previous} disabled={loading || result.page <= 1} onClick={() => setPage(result.page - 1)}><ChevronLeft size={18}/></button><button type="button" title={messages.next} aria-label={messages.next} disabled={loading || result.page >= result.pages} onClick={() => setPage(result.page + 1)}><ChevronRight size={18}/></button></span></footer>
        {assigning && <form className="backoffice-form" onSubmit={assign}><h2>{messages.ownership}: {assigning.title}</h2><label>{messages.ownerEmail}<input type="email" maxLength={254} required value={ownerEmail} onChange={e => setOwnerEmail(e.target.value)} disabled={busy}/></label><div className="backoffice-row-actions"><button className="portal-button portal-button-primary" disabled={busy}>{messages.assignOwner}</button><button type="button" className="portal-button portal-button-secondary" disabled={busy} onClick={() => setAssigning(null)}>{messages.cancel}</button></div></form>}
      </>}
    </>}
  </section>;
}
