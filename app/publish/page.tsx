"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { Download, ExternalLink, Trash2 } from "lucide-react";

type Release = {
  id: string;
  revisionNotes: string;
  fileName: string;
  publishedAt: string;
};

export default function PublishPage() {
  const pathname = usePathname();
  const parts = pathname.split("/").filter(Boolean);
  const courseId = parts[0] === "knowledge" ? parts[1] : "philosophy";
  const knowledgeId = parts[0] === "knowledge" ? parts[2] : "epicureanism";
  const query = `courseId=${encodeURIComponent(courseId)}&knowledgeId=${encodeURIComponent(knowledgeId)}`;
  const [notes, setNotes] = useState("");
  const [releases, setReleases] = useState<Release[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [publishing, setPublishing] = useState(false);

  useEffect(() => { loadReleases(); }, [query]);

  async function loadReleases() {
    setError("");
    const res = await fetch(`/api/releases?${query}`, { cache: "no-store" });
    const data = await res.json();
    setReleases(Array.isArray(data) ? data : data.releases || []);
  }

  async function publish() {
    setError("");
    setSuccess("");
    setPublishing(true);
    try {
      const res = await fetch("/api/releases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revisionNotes: notes, courseId, knowledgeId })
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Publish failed");
        return;
      }
      setReleases([data, ...releases.filter((release) => release.id !== data.id)]);
      setNotes("");
      setSuccess("Release published successfully.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Publish failed");
    } finally {
      setPublishing(false);
    }
  }

  async function deletePublishedRelease(release: Release) {
    if (!confirm("Delete this published release?")) return;
    setError("");
    setSuccess("");
    const res = await fetch(`/api/releases/${encodeURIComponent(release.id)}?${query}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Delete release failed");
      return;
    }
    setReleases(data.releases || []);
    setSuccess("Published release deleted.");
  }

  return (
    <AppShell>
      <div className="workflow-page-actions">
        <a className="btn secondary-blue" href={`/knowledge/${courseId}/${knowledgeId}/chat-testing`} target="_blank" rel="noreferrer">
          <ExternalLink size={18} /> Chat Testing
        </a>
        <a className="btn secondary-blue" href={`/knowledge/${courseId}/${knowledgeId}/dialogue-testing`} target="_blank" rel="noreferrer">
          <ExternalLink size={18} /> Dialogue Testing
        </a>
        <a className="btn secondary-blue" href={`/knowledge/${courseId}/${knowledgeId}/dialogue`} target="_blank" rel="noreferrer">
          <ExternalLink size={18} /> Dialogue
        </a>
      </div>
      {error ? <div className="error-banner">{error}</div> : null}
      {success ? <div className="success-banner">{success}</div> : null}
      <div className="card publish-card">
        <h2>Release Notes</h2>
        <textarea placeholder="Please enter the revision notes for this release" value={notes} onChange={(event) => setNotes(event.target.value)} />
        <button className="btn primary" style={{ marginTop: 22, width: 150 }} onClick={publish} disabled={publishing}>{publishing ? "Publishing" : "Publish"}</button>
      </div>
      <div className="card">
        <h2>Published Releases</h2>
        {releases.length ? (
          <table className="release-table">
            <thead><tr><th>Release ID</th><th>Revision Notes</th><th>Markdown File</th><th>Action</th></tr></thead>
            <tbody>
              {releases.map((release) => (
                <tr key={release.id}>
                  <td>{release.id}</td>
                  <td>{release.revisionNotes || "No revision notes provided."}</td>
                  <td><a className="btn secondary-blue" href={`/api/releases/${encodeURIComponent(release.id)}/download?${query}`}><Download size={18} /> Download .md</a></td>
                  <td>
                    <button className="icon-button danger" onClick={() => deletePublishedRelease(release)} aria-label="Delete published release">
                      <Trash2 size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty-state">No published releases yet.</div>
        )}
      </div>
    </AppShell>
  );
}
