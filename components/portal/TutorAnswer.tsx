"use client";

import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { useEffect, useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { tutorAnswerParts } from "@/lib/tutorAnswer";

// D2 (docs/phase1/ai-tutor-answer-layer.md): the one renderer for an AI Tutor
// answer. The lesson drawer (TutorChat) and the Study Group room both use it,
// so the same KnowledgeSystem answer looks the same in both; the layout lives
// in app/styles.css under "AI Tutor answer" (.tutor-answer), and each page
// keeps only its own bubble around it.
//
// What may render, for both places (the room shares an answer with everyone in
// the call):
// - images only from KS course storage, through the Portal entitlement proxy;
// - links only to http(s), in a new tab with no referrer;
// - never raw HTML (react-markdown's default);
// - KaTeX that cannot run macros or expand without bound, and that renders HTML
//   only, so copying or reading the text gives the formula once, not twice.
const KS_IMAGE = /^\/api\/(?:user\/courses\/[^/]+\/images|files\/images\/[^/]+)\/([0-9a-f-]{36}\.(?:png|jpg|gif|webp))$/i;
const KATEX = { throwOnError: false, strict: "ignore", trust: false, maxExpand: 100, output: "html" } as const;

// The room's copy action (an icon button outside the bubble). The lesson
// drawer keeps its own two-item copy menu (plain text / Markdown).
export function TutorCopyButton({ text, copyLabel, copiedLabel, className }: { text: string; copyLabel: string; copiedLabel: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  async function copyAnswer() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      const input = document.createElement("textarea");
      input.value = text;
      input.style.position = "fixed";
      input.style.left = "-9999px";
      document.body.appendChild(input);
      input.select();
      try { setCopied(document.execCommand("copy")); }
      catch { setCopied(false); }
      finally { input.remove(); }
    }
  }
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  const label = copied ? copiedLabel : copyLabel;
  return <button className={className} type="button" aria-label={label} title={label} onClick={() => void copyAnswer()}>{copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}</button>;
}

/** `courseId` is the Portal course the answer belongs to; without it course images show their alt text. */
export function TutorAnswer({ text, courseId, sourcesLabel }: { text: string; courseId?: string; sourcesLabel: string }) {
  const { markdown, sources } = tutorAnswerParts(text);
  const components = useMemo<Components>(() => ({
    a({ href, children }) {
      return /^https?:\/\//i.test(href || "") ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>;
    },
    img({ src, alt }) {
      const match = KS_IMAGE.exec(String(src || ""));
      return match && courseId ? <img src={`/api/ai-tutor/images/${match[1]}?courseId=${encodeURIComponent(courseId)}`} alt={alt || "Tutor figure"} loading="lazy" /> : <span>{alt || ""}</span>;
    },
  }), [courseId]);
  return (
    <div className="tutor-answer" data-testid="tutor-answer">
      <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[[rehypeKatex, KATEX]]} components={components}>
        {markdown}
      </ReactMarkdown>
      {sources.length ? <div className="tutor-answer-sources"><p>{sourcesLabel}</p>{sources.map((source) => <p key={source}>{source}</p>)}</div> : null}
    </div>
  );
}
