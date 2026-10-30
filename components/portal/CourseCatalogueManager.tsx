"use client";

import { useState } from "react";
import { Archive, Pencil, Plus, RotateCcw, Save, X } from "lucide-react";
import type { CatalogueEntry, CatalogueInput } from "@/contracts/course-authoring";
import { getCourseManagementMessages } from "@/lib/i18n/courseManagementMessages";
import { App, Alert, Button, Form, Input, Select, Space, Tag } from "antd";
import { useBackofficePopupContainer } from "@/components/backoffice/BackofficeProvider";

export function CourseCatalogueManager({ entries, locale, onSaved }: { entries: CatalogueEntry[]; locale: "en-GB" | "zh-CN"; onSaved: () => Promise<void> }) {
  const copy = getCourseManagementMessages(locale);
  const { modal } = App.useApp();
  const getContainer = useBackofficePopupContainer();
  const [editing, setEditing] = useState<CatalogueEntry | null>(null), [open, setOpen] = useState(false);
  const [name, setName] = useState(""), [description, setDescription] = useState(""), [parentId, setParentId] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  function begin(entry?: CatalogueEntry) {
    setEditing(entry || null); setName(entry?.name || ""); setDescription(entry?.description || ""); setParentId(entry?.parentId || ""); setOpen(true); setError("");
  }
  async function save(entry: CatalogueEntry | null, input: CatalogueInput) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/backoffice/courses/catalogue${entry ? "/" + encodeURIComponent(entry.id) : ""}`, { method: entry ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      const data = await response.json();
      if (!response.ok) { setError(copy.errors[data.code as keyof typeof copy.errors] || copy.errors.failed); return; }
      setOpen(false); await onSaved();
    } catch { setError(copy.errors.failed); } finally { setBusy(false); }
  }
  return <section className="course-catalogue">
    <header className="authoring-heading"><h2>{copy.catalogue}</h2><Button title={copy.createCategory} aria-label={copy.createCategory} disabled={busy} icon={<Plus size={18}/>} onClick={() => begin()}/></header>
    {error && <Alert type="error" title={error} showIcon/>}
    {open && <Form layout="vertical" className="bo-form" disabled={busy} onFinish={() => { void save(editing, { name, description, parentId: parentId || null, expectedUpdatedAt: editing?.updatedAt }); }}>
      <h3>{editing ? copy.editCatalogue : parentId ? copy.createSubject : copy.createCategory}</h3>
      <Form.Item label={copy.category} htmlFor="catalogue-parent"><Select id="catalogue-parent" disabled={busy || Boolean(editing)} value={parentId} onChange={setParentId} options={[{value:"",label:copy.none},...entries.filter(entry=>!entry.parentId&&entry.status==="active").map(entry=>({value:entry.id,label:entry.name}))]}/></Form.Item>
      <Form.Item label={copy.name} htmlFor="catalogue-name"><Input id="catalogue-name" required maxLength={100} value={name} onChange={e=>setName(e.target.value)}/></Form.Item>
      <Form.Item label={copy.description} htmlFor="catalogue-description"><Input.TextArea id="catalogue-description" maxLength={1000} value={description} onChange={e=>setDescription(e.target.value)}/></Form.Item>
      <Space wrap><Button type="primary" htmlType="submit" loading={busy} icon={<Save size={16}/>}>{copy.save}</Button><Button disabled={busy} icon={<X size={16}/>} onClick={()=>setOpen(false)}>{copy.cancel}</Button></Space>
    </Form>}
    {!entries.length && <p>{copy.emptyCatalogue}</p>}
    <ul className="course-catalogue-list">{[...entries].sort((a, b) => (a.parentId || a.id).localeCompare(b.parentId || b.id) || Number(Boolean(a.parentId)) - Number(Boolean(b.parentId))).map(entry => <li key={entry.id}>
      <div><strong>{entry.name}</strong><span>{entry.parentId ? entries.find(parent => parent.id === entry.parentId)?.name : copy.category}{entry.status === "archived" && <Tag>{copy.archived}</Tag>}</span></div>
      <Space><Button title={copy.editCatalogue} aria-label={copy.editCatalogue + ": " + entry.name} disabled={busy} icon={<Pencil size={16}/>} onClick={()=>begin(entry)}/><Button title={entry.status === "active" ? copy.archive : copy.restore} aria-label={(entry.status === "active" ? copy.archive : copy.restore) + ": " + entry.name} disabled={busy} icon={entry.status === "active" ? <Archive size={16}/> : <RotateCcw size={16}/>} onClick={() => {
        const apply = () => save(entry,{...entry,expectedUpdatedAt:entry.updatedAt,status:entry.status === "active" ? "archived" : "active"});
        if(entry.status === "archived") void apply();
        else modal.confirm({title:copy.archiveCatalogueConfirm,getContainer,okText:copy.archive,cancelText:copy.cancel,onOk:apply});
      }}/></Space>
    </li>)}</ul>
  </section>;
}
