"use client";

import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { useEffect, useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { tutorAnswerParts } from "@/modules/group-study/tutorAnswerText";

// Room chat is shared with everyone in the call; only course images behind the
// Portal entitlement proxy render. Links open without a referrer, and raw HTML
// is never rendered (react-markdown's default).
const KS_IMAGE = /^\/api\/(?:user\/courses\/[^/]+\/images|files\/images\/[^/]+)\/([0-9a-f-]{36}\.(?:png|jpg|gif|webp))$/i;
const linkComponents: Components = {
  a({ href, children }) {
    return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
  }
};

// Class names come from the room (study-groups.module.css) so this stays
// renderable without a CSS loader (tests/unit/study-group-tutor-answer.test.ts).
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

export function TutorAnswer({ text, courseId, sourcesLabel, className, sourcesClassName }: { text: string; courseId?: string; sourcesLabel: string; className?: string; sourcesClassName?: string }) {
  const { markdown, sources } = tutorAnswerParts(text);
  const components = useMemo<Components>(() => ({
    ...linkComponents,
    img({ src, alt }) {
      const match = KS_IMAGE.exec(String(src || ""));
      return match && courseId ? <img src={`/api/ai-tutor/images/${match[1]}?courseId=${encodeURIComponent(courseId)}`} alt={alt || "Tutor figure"} loading="lazy" /> : <span>{alt || ""}</span>;
    },
  }), [courseId]);
  return (
    <div className={className} data-testid="tutor-answer">
      <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: "ignore", output: "html" }]]} components={components}>
        {markdown}
      </ReactMarkdown>
      {sources.length ? <div className={sourcesClassName}><p>{sourcesLabel}</p>{sources.map((source) => <p key={source}>{source}</p>)}</div> : null}
    </div>
  );
}
