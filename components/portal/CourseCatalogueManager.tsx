"use client";

import { useState } from "react";
import { Archive, Pencil, Plus, RotateCcw, Save, X } from "lucide-react";
import type { CatalogueEntry, CatalogueInput } from "@/contracts/course-authoring";
import { getCourseManagementMessages } from "@/lib/i18n/courseManagementMessages";

export function CourseCatalogueManager({ entries, locale, onSaved }: { entries: CatalogueEntry[]; locale: "en-GB" | "zh-CN"; onSaved: () => Promise<void> }) {
  const copy = getCourseManagementMessages(locale);
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
    <header className="authoring-heading"><h2>{copy.catalogue}</h2><button type="button" title={copy.createCategory} aria-label={copy.createCategory} disabled={busy} onClick={() => begin()}><Plus size={18}/></button></header>
    {error && <p role="alert" className="portal-form-error">{error}</p>}
    {open && <form className="backoffice-form" onSubmit={e => { e.preventDefault(); void save(editing, { name, description, parentId: parentId || null, expectedUpdatedAt: editing?.updatedAt }); }}>
      <h3>{editing ? copy.editCatalogue : parentId ? copy.createSubject : copy.createCategory}</h3>
      <label>{copy.category}<select disabled={busy || Boolean(editing)} value={parentId} onChange={e => setParentId(e.target.value)}><option value="">{copy.none}</option>{entries.filter(entry => !entry.parentId && entry.status === "active").map(entry => <option value={entry.id} key={entry.id}>{entry.name}</option>)}</select></label>
      <label>{copy.name}<input required maxLength={100} value={name} onChange={e => setName(e.target.value)} disabled={busy}/></label>
      <label>{copy.description}<textarea maxLength={1000} value={description} onChange={e => setDescription(e.target.value)} disabled={busy}/></label>
      <div className="backoffice-row-actions"><button className="portal-button portal-button-primary" disabled={busy}><Save size={16}/>{copy.save}</button><button type="button" className="portal-button portal-button-secondary" disabled={busy} onClick={() => setOpen(false)}><X size={16}/>{copy.cancel}</button></div>
    </form>}
    {!entries.length && <p>{copy.emptyCatalogue}</p>}
    <ul className="course-catalogue-list">{[...entries].sort((a, b) => (a.parentId || a.id).localeCompare(b.parentId || b.id) || Number(Boolean(a.parentId)) - Number(Boolean(b.parentId))).map(entry => <li key={entry.id}>
      <div><strong>{entry.name}</strong><span>{entry.parentId ? entries.find(parent => parent.id === entry.parentId)?.name : copy.category}{entry.status === "archived" ? " · " + copy.archived : ""}</span></div>
      <div className="authoring-actions"><button type="button" title={copy.editCatalogue} aria-label={copy.editCatalogue + ": " + entry.name} disabled={busy} onClick={() => begin(entry)}><Pencil size={16}/></button><button type="button" title={entry.status === "active" ? copy.archive : copy.restore} aria-label={(entry.status === "active" ? copy.archive : copy.restore) + ": " + entry.name} disabled={busy} onClick={() => { if (entry.status === "archived" || window.confirm(copy.archiveCatalogueConfirm)) void save(entry, { ...entry, expectedUpdatedAt: entry.updatedAt, status: entry.status === "active" ? "archived" : "active" }); }}>{entry.status === "active" ? <Archive size={16}/> : <RotateCcw size={16}/>}</button></div>
    </li>)}</ul>
  </section>;
}
