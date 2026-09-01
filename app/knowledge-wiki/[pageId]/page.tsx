"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { MarkdownAnswer } from "@/components/MarkdownAnswer";
import { Bold, Check, Heading3, Italic, Link as LinkIcon, MessageCircle, Pencil, Plus, Trash2, X } from "lucide-react";

type WikiEntry = {
  id: string;
  title: string;
  content: string;
  order: number;
  updatedAt: string;
};

type WikiPage = {
  courseId: string;
  knowledgeId: string;
  title: string;
  status: "Draft" | "Published";
  entries: WikiEntry[];
};

type WikiComment = { id: string; entryId: string; text: string; author: string; createdAt: string };
type SourceReference = { entryId: string; entryTitle: string; linkText: string; url: string };

export default function KnowledgeWikiPage({ params }: { params: Promise<{ pageId: string }> }) {
  const pathname = usePathname();
  const router = useRouter();
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const [pageId, setPageId] = useState("epicureanism");
  const [page, setPage] = useState<WikiPage | null>(null);
  const [comments, setComments] = useState<WikiComment[]>([]);
  const [references, setReferences] = useState<SourceReference[]>([]);
  const [activeTab, setActiveTab] = useState<"wiki" | "references">("wiki");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [commentingId, setCommentingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [commentText, setCommentText] = useState("");
  const [error, setError] = useState("");

  const parts = pathname.split("/").filter(Boolean);
  const courseId = parts[0] === "knowledge" ? parts[1] : "philosophy";
  const knowledgeId = parts[0] === "knowledge" ? parts[2] : pageId;
  const query = `courseId=${encodeURIComponent(courseId)}&knowledgeId=${encodeURIComponent(knowledgeId)}`;

  useEffect(() => { params.then((value) => setPageId(value.pageId)); }, [params]);
  useEffect(() => { loadWiki(); }, [query, knowledgeId]);

  async function loadWiki() {
    setError("");
    const [pageRes, commentsRes, refsRes] = await Promise.all([
      fetch(`/api/wiki/pages/${knowledgeId}?${query}`, { cache: "no-store" }),
      fetch(`/api/wiki/comments?${query}`, { cache: "no-store" }),
      fetch(`/api/wiki/source-references?${query}`, { cache: "no-store" })
    ]);
    setPage(await pageRes.json());
    const commentsData = await commentsRes.json();
    const refsData = await refsRes.json();
    setComments(commentsData.comments || []);
    setReferences(refsData.references || []);
  }

  function beginEdit(entry: WikiEntry) {
    setEditingId(entry.id);
    setCommentingId(null);
    setEditTitle(entry.title);
    setEditContent(entry.content);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditTitle("");
    setEditContent("");
  }

  async function saveEntry(entryId: string) {
    const res = await fetch(`/api/wiki/pages/${knowledgeId}/entries/${entryId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseId, knowledgeId, title: editTitle, content: editContent })
    });
    const data = await res.json();
    if (!res.ok) return setError(data.error || "Unable to save entry");
    setPage(data.page);
    setEditingId(null);
    await loadWiki();
  }

  async function addEntry() {
    const res = await fetch(`/api/wiki/pages/${knowledgeId}/entries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseId, knowledgeId, title: "New Wiki Entry", content: "" })
    });
    const data = await res.json();
    if (!res.ok) return setError(data.error || "Unable to add entry");
    setPage(data.page);
    setEditingId(data.entry.id);
    setEditTitle(data.entry.title);
    setEditContent(data.entry.content);
    setActiveTab("wiki");
  }

  async function deleteEntry(entry: WikiEntry) {
    if (!confirm(`Delete "${entry.title}"?`)) return;
    const res = await fetch(`/api/wiki/pages/${knowledgeId}/entries/${entry.id}?${query}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) return setError(data.error || "Unable to delete entry");
    setPage(data);
    setEditingId(null);
    await loadWiki();
  }

  function wrapSelection(before: string, after = before) {
    const textarea = contentRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = editContent.slice(start, end);
    const replacement = selected ? `${before}${selected}${after}` : `${before}selected text${after}`;
    setEditContent(editContent.slice(0, start) + replacement + editContent.slice(end));
    requestAnimationFrame(() => textarea.focus());
  }

  function insertSubheading() {
    const textarea = contentRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const insertion = `${start > 0 ? "\n\n" : ""}### Subheading\n`;
    setEditContent(editContent.slice(0, start) + insertion + editContent.slice(start));
    requestAnimationFrame(() => textarea.focus());
  }

  function insertLink() {
    const textarea = contentRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = editContent.slice(start, end) || "Link Text";
    const url = prompt("URL", "https://example.com");
    if (!url) return;
    const replacement = `[${selected}](${url})`;
    setEditContent(editContent.slice(0, start) + replacement + editContent.slice(end));
    requestAnimationFrame(() => textarea.focus());
  }

  async function saveComment(entryId: string) {
    setError("");
    const res = await fetch("/api/wiki/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseId, knowledgeId, entryId, text: commentText })
    });
    const data = await res.json();
    if (!res.ok) return setError(data.error || "Unable to save comment");
    setComments(data.comments || []);
    setCommentText("");
    setError("");
  }

  async function deleteComment(commentId: string) {
    setError("");
    const res = await fetch("/api/wiki/comments", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseId, knowledgeId, commentId })
    });
    const data = await res.json();
    if (!res.ok) return setError(data.error || "Unable to delete comment");
    setComments(data.comments || []);
    setError("");
  }

  function cancelComment() {
    setCommentingId(null);
    setCommentText("");
    setError("");
  }

  async function removeReference(reference: SourceReference) {
    const res = await fetch("/api/wiki/source-references", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseId, knowledgeId, ...reference })
    });
    const data = await res.json();
    if (!res.ok) return setError(data.error || "Unable to remove source reference");
    setReferences(data.references || []);
    await loadWiki();
  }

  const commentCount = (entryId: string) => comments.filter((comment) => comment.entryId === entryId).length;
  const entryComments = (entryId: string) => comments.filter((comment) => comment.entryId === entryId);
  const onThisPage = page?.entries || [];

  return (
    <AppShell>
      <div className="wiki-doc-page">
        <div className="wiki-doc-main">
          <div className="tabs wiki-tabs">
            <button className={`tab ${activeTab === "wiki" ? "active" : ""}`} onClick={() => setActiveTab("wiki")}>Wiki Page</button>
            <button className={`tab ${activeTab === "references" ? "active" : ""}`} onClick={() => setActiveTab("references")}>Source References</button>
            <div className="tabs-actions">
              <button className="btn secondary-blue" onClick={addEntry}><Plus size={18} /> Add Entry</button>
              <button className="btn primary" onClick={() => router.push(`/knowledge/${courseId}/${knowledgeId}/publish`)}>Go to Publish</button>
            </div>
          </div>
          {error ? <div className="error-banner">{error}</div> : null}

          {activeTab === "references" ? (
            <SourceReferences references={references} onRemove={removeReference} />
          ) : !page || !page.entries?.length ? (
            <div className="card empty-wiki">
              <h2>No wiki draft has been created yet.</h2>
              <p className="subtitle">Create a draft from the LLM Draft page first.</p>
              <button className="btn primary" onClick={() => router.push(`/knowledge/${courseId}/${knowledgeId}/llm-draft`)}>Go to LLM Draft</button>
            </div>
          ) : (
            <>
              {page.entries.map((entry, index) => (
                <section className="section wiki-entry-section" id={`entry-${entry.id}`} key={entry.id}>
                  <div className="section-head">
                    <h2>{index + 1}. {entry.title}</h2>
                    {editingId === entry.id ? <span className="edit-badge"><Pencil size={15} /> Editing</span> : null}
                    <div className="section-actions">
                      <button className="icon-button bare" onClick={() => beginEdit(entry)} aria-label="Edit entry"><Pencil size={22} /></button>
                      <button className="icon-button bare" onClick={() => { setError(""); setCommentingId(commentingId === entry.id ? null : entry.id); setEditingId(null); }} aria-label="Comment entry">
                        <span style={{ position: "relative" }}>
                          <MessageCircle size={24} />
                          {commentCount(entry.id) ? <span className="comment-badge">{commentCount(entry.id)}</span> : null}
                        </span>
                      </button>
                      <button className="icon-button bare danger" onClick={() => deleteEntry(entry)} aria-label="Delete entry"><Trash2 size={21} /></button>
                    </div>
                  </div>

                  {editingId === entry.id ? (
                    <>
                      <div className="section-save">
                        <button className="btn primary" onClick={() => saveEntry(entry.id)}><Check size={18} /> Save</button>
                        <button className="btn" onClick={cancelEdit}><X size={18} /> Cancel</button>
                      </div>
                      <input className="entry-title-input" value={editTitle} onChange={(event) => setEditTitle(event.target.value)} />
                      <div className="editor">
                        <div className="toolbar">
                          <button className="icon-button bare" onClick={() => wrapSelection("**")} title="Bold"><Bold size={20} /></button>
                          <button className="icon-button bare" onClick={() => wrapSelection("*")} title="Italic"><Italic size={20} /></button>
                          <button className="icon-button bare" onClick={insertSubheading} title="Content subheading"><Heading3 size={20} /></button>
                          <button className="icon-button bare" onClick={insertLink} title="Hyperlink"><LinkIcon size={20} /></button>
                        </div>
                        <textarea ref={contentRef} value={editContent} onChange={(event) => setEditContent(event.target.value)} />
                      </div>
                    </>
                  ) : (
                    <div className="wiki-markdown"><MarkdownAnswer content={entry.content} /></div>
                  )}

                  {commentingId === entry.id ? (
                    <div className="comment-panel">
                      <div className="comment-title"><MessageCircle size={20} /> Commenting</div>
                      {entryComments(entry.id).length ? (
                        <div className="comment-list">
                          {entryComments(entry.id).map((comment) => (
                            <div className="comment-item" key={comment.id}>
                              <button
                                className="comment-delete"
                                onClick={() => deleteComment(comment.id)}
                                aria-label="Delete comment"
                              >
                                <X size={14} />
                              </button>
                              <strong>{comment.author}</strong>
                              <span>{comment.text}</span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      <textarea placeholder="Add your comment..." value={commentText} onChange={(event) => setCommentText(event.target.value)} />
                      <div className="comment-actions">
                        <button className="btn" onClick={cancelComment}>Cancel</button>
                        <button className="btn primary" onClick={() => saveComment(entry.id)}>Save</button>
                      </div>
                    </div>
                  ) : null}
                </section>
              ))}
            </>
          )}
        </div>
        <aside className="wiki-doc-aside">
          <h3>On this page</h3>
          {onThisPage.length ? onThisPage.map((entry) => (
            <a href={`#entry-${entry.id}`} key={entry.id}>{entry.title}</a>
          )) : <span>No entries yet</span>}
        </aside>
      </div>
    </AppShell>
  );
}

function SourceReferences({ references, onRemove }: { references: SourceReference[]; onRemove: (reference: SourceReference) => void }) {
  if (!references.length) {
    return (
      <div className="card">
        <h2>No source references found in this wiki.</h2>
      </div>
    );
  }
  return (
    <div className="card">
      <h2>Source References</h2>
      <table className="release-table">
        <thead><tr><th>Entry Title</th><th>Link Text</th><th>URL</th><th>Action</th></tr></thead>
        <tbody>
          {references.map((reference, index) => (
            <tr key={`${reference.entryId}-${index}`}>
              <td>{reference.entryTitle}</td>
              <td>{reference.linkText}</td>
              <td><a href={reference.url} target="_blank" rel="noreferrer">{reference.url}</a></td>
              <td>
                <button className="icon-button danger" onClick={() => onRemove(reference)} aria-label="Remove source reference">
                  <Trash2 size={18} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
