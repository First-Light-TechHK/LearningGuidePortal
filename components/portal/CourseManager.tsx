"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Archive, Eye, Pencil, Plus, RotateCcw, UserRoundCog, X } from "lucide-react";
import { App, Alert, Button, Card, Drawer, Empty, Form, Input, Pagination, Select, Space, Table, Tag } from "antd";
import type { TableProps } from "antd";
import { useBackofficePopupContainer } from "@/components/backoffice/BackofficeProvider";
import { CourseOutlineEditor } from "./CourseOutlineEditor";
import { CourseCatalogueManager } from "./CourseCatalogueManager";
import { LessonContentPlayer } from "./LessonContentPlayer";
import { getMessages } from "@/lib/i18n/messages";
import { getCourseManagementMessages } from "@/lib/i18n/courseManagementMessages";
import type { ProductCourse } from "@/services/productStore";
import type { CatalogueEntry } from "@/contracts/course-authoring";
import { courseEditorGate } from "@/lib/courseEditor";
import styles from "./CourseManager.module.css";

type ListResult = { courses: ProductCourse[]; total: number; page: number; pages: number; counts: { total: number; draft: number; published: number; archived: number; lessons: number } };
const empty: ListResult = { courses: [], total: 0, page: 1, pages: 1, counts: { total: 0, draft: 0, published: 0, archived: 0, lessons: 0 } };

export function CourseManager({ copy, locale, operator = false }: { copy: ReturnType<typeof getMessages>["backoffice"]; locale: "en-GB" | "zh-CN"; operator?: boolean }) {
  const messages = getCourseManagementMessages(locale);
  const { modal } = App.useApp();
  const getContainer = useBackofficePopupContainer();
  const [filtersOpen, setFiltersOpen] = useState(false);
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
  async function create() {
    setBusy(true); setError("");
    try {
      const data = await mutate("/api/backoffice/courses", "POST", { title, description, category });
      setTitle(""); setDescription(""); setCreating(false); setEditing(data.course); await load();
    } catch (e) { setError(e instanceof Error ? e.message : messages.errors.failed); } finally { setBusy(false); }
  }
  function confirm(title: string) {
    return new Promise<boolean>(resolve => { modal.confirm({ title, getContainer, okText: messages.save, cancelText: messages.cancel, onOk: () => resolve(true), onCancel: () => resolve(false) }); });
  }
  async function updateStatus(course: ProductCourse, nextStatus: ProductCourse["status"]) {
    if (nextStatus === "archived" && !await confirm(messages.archiveConfirm)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await mutate("/api/backoffice/courses/" + encodeURIComponent(course.id), nextStatus === "archived" ? "DELETE" : "PATCH", { status: nextStatus, expectedUpdatedAt: course.updatedAt });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : messages.errors.failed); } finally { setBusy(false); }
  }
  async function startEdit(course: ProductCourse) {
    const gate = courseEditorGate(course.status);
    if (gate === "unpublish" && !await confirm(messages.publishedRequired)) return;
    if (gate === "restore" && !await confirm(messages.errors.archived)) return;
    let current = course;
    if (gate !== "open") {
      setBusy(true); setError("");
      try {
        const data = await mutate("/api/backoffice/courses/" + encodeURIComponent(course.id), "PATCH", { status: "draft", expectedUpdatedAt: course.updatedAt });
        current = data.course;
        await load();
      } catch (e) { setError(e instanceof Error ? e.message : messages.errors.failed); setBusy(false); return; }
      setBusy(false);
    }
    setEditing(current);
  }
  async function assign() {
    if (!assigning || !await confirm(messages.assignConfirm)) return;
    setBusy(true); setError("");
    try {
      await mutate("/api/backoffice/courses/" + encodeURIComponent(assigning.id) + "/ownership", "PUT", { email: ownerEmail, expectedUpdatedAt: assigning.updatedAt });
      setAssigning(null); setOwnerEmail(""); setNotice(messages.ownerAssigned); await load();
    } catch (e) { setError(e instanceof Error ? e.message : messages.errors.failed); } finally { setBusy(false); }
  }
  const entryName = (id?: string | null) => catalogue.find(entry => entry.id === id)?.name;
  const formatTime = (value: string) => new Date(value).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
  const courseCell = (course: ProductCourse) => <div className={styles.courseCell}>
    {course.cover || course.thumbnailPath ? <img src={course.cover || course.thumbnailPath || ""} alt="" width={64} height={40}/> : <span className={styles.coverPlaceholder}/>}
    <div><strong>{course.title}</strong>{course.subtitle && <span>{course.subtitle}</span>}</div>
  </div>;
  const courseStatus = (course: ProductCourse) => <Tag color={course.status === "published" ? "success" : course.status === "archived" ? "warning" : "default"}>{messages[course.status]}</Tag>;
  const actions = (course: ProductCourse) => <Space wrap>
    <Button size="small" disabled={busy} icon={<Pencil size={16}/>} onClick={() => void startEdit(course)}>{messages.edit}</Button>
    <Button size="small" icon={<Eye size={16}/>} onClick={() => setPreview(course)}>{messages.preview}</Button>
    {operator && <Button size="small" disabled={busy} icon={<UserRoundCog size={16}/>} onClick={() => { setAssigning(course); setOwnerEmail(""); }}>{messages.ownership}</Button>}
    {course.status !== "archived" && <Button size="small" disabled={busy} icon={<Archive size={16}/>} onClick={() => void updateStatus(course,"archived")}>{messages.archive}</Button>}
    <Button size="small" disabled={busy} icon={course.status === "archived" ? <RotateCcw size={14}/> : undefined} onClick={() => void updateStatus(course,course.status === "published" || course.status === "archived" ? "draft" : "published")}>{course.status === "published" ? copy.unpublish : course.status === "archived" ? messages.restore : copy.publish}</Button>
  </Space>;
  const columns: TableProps<ProductCourse>["columns"] = [
    {title:messages.columnCourse,key:"course",width:340,render:(_,course)=>courseCell(course)},
    {title:messages.category,key:"category",width:150,render:(_,course)=>entryName(course.categoryId)||course.category||messages.none},
    {title:messages.status,key:"status",width:100,render:(_,course)=>courseStatus(course)},
    {title:messages.lessons,key:"lessons",width:80,render:(_,course)=>course.sections.reduce((sum,section)=>sum+section.lessons.length,0)},
    {title:messages.updated,key:"updated",width:150,render:(_,course)=>formatTime(course.updatedAt)},
    {title:messages.columnActions,key:"actions",width:260,render:(_,course)=>actions(course)},
  ];
  const filters = (suffix: string) => <Form layout="vertical" className={styles.filters}>
    <Form.Item label={messages.search} htmlFor={`course-search-${suffix}`}><Input id={`course-search-${suffix}`} type="search" value={search} maxLength={200} placeholder={messages.searchPlaceholder} onChange={e=>setSearch(e.target.value)}/></Form.Item>
    <Form.Item label={messages.status} htmlFor={`course-status-${suffix}`}><Select id={`course-status-${suffix}`} value={status} onChange={value=>{setStatus(value);setPage(1);}} options={[{value:"all",label:messages.all},...(["draft","published","archived"] as const).map(value=>({value,label:messages[value]}))]}/></Form.Item>
    <Form.Item label={messages.category} htmlFor={`course-category-${suffix}`}><Select id={`course-category-${suffix}`} value={categoryId} onChange={value=>{setCategoryId(value);setSubjectId("");setPage(1);}} options={[{value:"",label:messages.all},...catalogue.filter(e=>!e.parentId).map(entry=>({value:entry.id,label:entry.name}))]}/></Form.Item>
    <Form.Item label={messages.subject} htmlFor={`course-subject-${suffix}`}><Select id={`course-subject-${suffix}`} disabled={!categoryId} value={subjectId} onChange={value=>{setSubjectId(value);setPage(1);}} options={[{value:"",label:messages.all},...catalogue.filter(e=>e.parentId===categoryId).map(entry=>({value:entry.id,label:entry.name}))]}/></Form.Item>
    <Form.Item label={messages.level} htmlFor={`course-level-${suffix}`}><Select id={`course-level-${suffix}`} value={level} onChange={value=>{setLevel(value);setPage(1);}} options={[{value:"",label:messages.all},...(["beginner","intermediate","advanced"] as const).map(value=>({value,label:messages[value]}))]}/></Form.Item>
  </Form>;
  return <section className={styles.manager}>
    {editing ? <CourseOutlineEditor key={editing.id} course={editing} locale={locale} catalogue={catalogue} copy={getMessages(locale).authoring} onSaved={load} onClose={()=>setEditing(null)}/> : <>
      <header className={styles.pageHeader}><div><h1>{copy.courses}</h1><p>{messages.pageLead}</p></div>
        {!preview && <Button type="primary" disabled={busy} icon={<Plus size={18}/>} onClick={()=>{setCreating(!creating);setShowCatalogue(false);}}>{copy.create}</Button>}
      </header>
      {error && <Alert type="error" title={error} showIcon/>}
      {notice && <Alert type="success" title={notice} showIcon/>}
      {preview ? <section className={styles.preview}>
        <header className={styles.previewHeader}><h2>{preview.title}</h2><Button aria-label={messages.close} title={messages.close} icon={<X size={18}/>} onClick={()=>setPreview(null)}/></header>
        {preview.cover && <img className={styles.previewCover} src={preview.cover} alt="" width={480} height={270}/>}<p>{preview.subtitle}</p><p>{preview.description}</p>
        {preview.sections.map(section=><section key={section.id}><h3>{section.title}</h3>{section.lessons.map(lesson=><article key={lesson.id}><h4>{lesson.title}</h4>{lesson.contents?.length ? <LessonContentPlayer contents={lesson.contents} locale={locale}/> : <p style={{whiteSpace:"pre-wrap"}}>{lesson.body}</p>}</article>)}</section>)}
      </section> : <>
        <dl className={styles.stats}>{(["total","draft","published","archived","lessons"] as const).map(key=><div key={key}><dt>{messages[key]}</dt><dd>{result.counts[key]}</dd></div>)}</dl>
        {operator && <Space><Button type={!showCatalogue ? "primary" : "default"} aria-pressed={!showCatalogue} onClick={()=>setShowCatalogue(false)}>{copy.courses}</Button><Button type={showCatalogue ? "primary" : "default"} aria-pressed={showCatalogue} onClick={()=>{setShowCatalogue(true);setCreating(false);}}>{messages.catalogue}</Button></Space>}
        {showCatalogue && operator ? <CourseCatalogueManager entries={catalogue} locale={locale} onSaved={loadCatalogue}/> : <>
          {creating && <Form layout="vertical" className={styles.cardForm} onFinish={()=>void create()} disabled={busy}>
            <Form.Item label={copy.courseTitle} htmlFor="new-course-title"><Input id="new-course-title" value={title} maxLength={255} onChange={e=>setTitle(e.target.value)} required/></Form.Item>
            <Form.Item label={copy.description} htmlFor="new-course-description"><Input.TextArea id="new-course-description" value={description} maxLength={5000} onChange={e=>setDescription(e.target.value)} rows={3}/></Form.Item>
            <Form.Item label={copy.category} htmlFor="new-course-category"><Select id="new-course-category" value={category} onChange={setCategory} options={(["Chinese Humanities","European Humanities","Science"] as const).map((value,index)=>({value,label:getMessages(locale).portal.courseCategories[index+1]}))}/></Form.Item>
            <Space wrap><Button type="primary" htmlType="submit" loading={busy}>{copy.create}</Button><Button onClick={()=>setCreating(false)}>{messages.cancel}</Button></Space>
          </Form>}
          <div className="bo-desktop">{filters("desktop")}</div>
          <Button className="bo-mobile" onClick={()=>setFiltersOpen(true)}>{messages.search}</Button>
          <Drawer title={messages.search} open={filtersOpen} onClose={()=>setFiltersOpen(false)} getContainer={getContainer} size="default" styles={{wrapper:{maxWidth:"100vw"}}} destroyOnHidden>{filters("mobile")}</Drawer>
          <div className="bo-desktop"><Table<ProductCourse> rowKey="id" columns={columns} dataSource={result.courses} loading={loading} pagination={false} locale={{emptyText:messages.empty}} scroll={{x:1050}}/></div>
          <div className="bo-mobile"><div className="bo-mobile-cards">
            {loading && <p role="status">{messages.loading}</p>}
            {!loading && !result.courses.length && <Empty description={messages.empty}/>}
            {result.courses.map(course=><Card key={course.id} size="small"><div className="bo-card-heading">{courseCell(course)}{courseStatus(course)}</div><p>{entryName(course.categoryId)||course.category||messages.none}</p>{actions(course)}</Card>)}
          </div></div>
          <div className="bo-pagination"><Pagination current={result.page} total={result.total} pageSize={pageSize} showSizeChanger pageSizeOptions={[10,25,50]} responsive disabled={loading} onChange={(value,size)=>{setPageSize(size);setPage(size!==pageSize?1:value);}}/></div>
          {assigning && <Form layout="vertical" className={styles.cardForm} onFinish={()=>void assign()} disabled={busy}><h2>{messages.ownership}: {assigning.title}</h2><Form.Item label={messages.ownerEmail} htmlFor="course-owner-email"><Input id="course-owner-email" type="email" maxLength={254} required value={ownerEmail} onChange={e=>setOwnerEmail(e.target.value)}/></Form.Item><Space wrap><Button type="primary" htmlType="submit" loading={busy}>{messages.assignOwner}</Button><Button onClick={()=>setAssigning(null)}>{messages.cancel}</Button></Space></Form>}
        </>}
      </>}
    </>}
  </section>;
}
