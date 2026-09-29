"use client";

import { Children, Fragment, isValidElement, type ReactNode } from "react";
import Image from "next/image";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

function allowedImageSrc(src: string) {
  const trimmed = src.trim();
  if (!trimmed || trimmed.startsWith("data:") || trimmed.startsWith("javascript:")) return "";
  if (trimmed.startsWith("/science-diagrams/") && !trimmed.includes("..")) return trimmed;
  if (trimmed.startsWith("/") && !trimmed.startsWith("//") && !trimmed.includes("..")) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return "";
}

function isMarkdownFigure(node: ReactNode) {
  return isValidElement(node) && node.type === markdownComponents.img;
}

const markdownComponents: Components = {
  p({ children }) {
    const nodes = Children.toArray(children);
    if (!nodes.some(isMarkdownFigure)) return <p>{children}</p>;
    return <>
      {nodes.map((node, index) => {
        if (isMarkdownFigure(node)) return <Fragment key={index}>{node}</Fragment>;
        if (typeof node === "string" && !node.trim()) return null;
        return <p key={index}>{node}</p>;
      })}
    </>;
  },
  img({ src, alt }) {
    const safe = allowedImageSrc(String(src || ""));
    if (!safe) return <span>{alt || "figure"}</span>;
    return (
      <figure className="course-figure">
        {/* Markdown figures have no known dimensions; .course-figure img sizes them to width:100% and height:auto. */}
        <Image src={safe} alt={alt || "Course figure"} width={0} height={0} unoptimized />
        {alt ? <figcaption>{alt}</figcaption> : null}
      </figure>
    );
  },
  a({ href, children }) {
    return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
  }
};

export function MarkdownAnswer({ content, compact = false }: { content: string; compact?: boolean }) {
  return (
    <div className={`markdown-answer${compact ? " compact" : ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: "ignore", output: "html" }]]}
        components={markdownComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
