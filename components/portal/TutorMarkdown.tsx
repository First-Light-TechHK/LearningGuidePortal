"use client";

import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { normalizeTutorIndent } from "@/modules/group-study/tutorAnswerText";

export function tutorMarkdown(raw: string) {
  raw = normalizeTutorIndent(raw);
  const protectedToken = /(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n\1[ \t]*(?=\n|$)|$)|(`+)[^\n]*?\2|\\\[[\s\S]*?(?:\\\]|$)|\\\([\s\S]*?(?:\\\)|$)|(?<!\\)\$\$[\s\S]*?(?:\$\$|$)|(?<!\\)\$(?!\$)[^$\n]*(?:\$|(?=\n|$))/g;
  const prose = (text: string) => text.replace(
    /^Sources[ \t]*\n((?:\[\d+\][^\n]*(?:\n|$))+)[ \t]*$/m,
    (_match, entries: string) => `> Sources\n>\n${entries.trimEnd().replace(/[ \t]+(?=\[\d+\][ \t])/g, "\n").split("\n").map((line) => `> ${line}`).join("\n>\n")}\n`,
  );
  let result = "", start = 0;
  for (const match of raw.matchAll(protectedToken)) {
    result += prose(raw.slice(start, match.index));
    const token = match[0];
    if (token.startsWith("\\[") && token.endsWith("\\]")) result += `\n$$\n${token.slice(2, -2)}\n$$\n`;
    else if (token.startsWith("\\(") && token.endsWith("\\)")) result += `$${token.slice(2, -2)}$`;
    else result += token;
    start = match.index + token.length;
  }
  return result + prose(raw.slice(start));
}

const KS_IMAGE = /^\/api\/(?:user\/courses\/[^/]+\/images|files\/images\/[^/]+)\/([0-9a-f-]{36}\.(?:png|jpg|gif|webp))$/i;

export function TutorMarkdown({ content, courseId }: { content: string; courseId: string }) {
  const components: Components = {
    img({ src, alt }) {
      const match = KS_IMAGE.exec(String(src || ""));
      return match ? <img src={`/api/ai-tutor/images/${match[1]}?courseId=${encodeURIComponent(courseId)}`} alt={alt || "Tutor figure"} loading="lazy" /> : <span>{alt || ""}</span>;
    },
    a({ href, children }) {
      return /^https?:\/\//i.test(href || "") ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>;
    },
  };
  return <div className="markdown-answer compact"><ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[[rehypeKatex, { throwOnError: false, trust: false, maxExpand: 100 }]]} components={components}>{tutorMarkdown(content)}</ReactMarkdown></div>;
}
