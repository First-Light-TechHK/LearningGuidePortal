"use client";

import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { tutorAnswerParts } from "@/modules/group-study/tutorAnswerText";

// Room chat is shared with everyone in the call, so an answer never loads an
// image and its links open in a new tab without a referrer. Raw HTML is never
// rendered (react-markdown's default).
const components: Components = {
  img({ alt }) {
    return <span>{alt || ""}</span>;
  },
  a({ href, children }) {
    return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
  }
};

// Class names come from the room (study-groups.module.css) so this stays
// renderable without a CSS loader (tests/unit/study-group-tutor-answer.test.ts).
export function TutorAnswer({ text, sourcesLabel, className, sourcesClassName }: { text: string; sourcesLabel: string; className?: string; sourcesClassName?: string }) {
  const { markdown, sources } = tutorAnswerParts(text);
  return (
    <div className={className} data-testid="tutor-answer">
      <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: "ignore", output: "html" }]]} components={components}>
        {markdown}
      </ReactMarkdown>
      {sources.length ? <p className={sourcesClassName}>{sourcesLabel} {sources.join(" · ")}</p> : null}
    </div>
  );
}
