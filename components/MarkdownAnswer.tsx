"use client";

import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

/**
 * 将 AI 输出中的纯文本格式转换为可渲染的 HTML：
 *
 * 1. 行内 `[n]` 引用标记 → `<sup>[n]</sup>`
 *    只匹配独立的 `[数字]`，不匹配 markdown link `[text](url)` / `[text][ref]`。
 *
 * 2. 底部 "Sources" 章节 → 包裹在 `<div class="markdown-sources">` 里，
 *    便于 CSS 独立样式（灰色小字、左边框等）。
 *
 * 3. 禁止 AI 输出的 HTML 中出现 script / iframe / event handler 等危险标签，
 *    简单 strip 掉。
 */
function preprocessContent(raw: string): string {
  let s = raw;

  // Step 1: 行内 [n] → <sup>[n]</sup>
  // 匹配 `[数字]`，后面不跟 ( 或 [（排除 markdown link），前面不跟 ]（排除连续引用的边界）
  s = s.replace(/\[(\d+)\](?![(\[])/g, "<sup>[$1]</sup>");

  // Step 2: 底部 Sources 章节包裹
  // AI 输出形如：
  //   Sources
  //   [1] Chapter X — Section Title
  //   [2] Chapter Y — Section Title
  // 找到最后出现的 "Sources" 开头段落，把它和后续所有引用行包在 div 里
  s = s.replace(/\n?^Sources\s*\n((?:^\[\d+\].*$\n?)+)$/m, "\n<div class=\"markdown-sources\">\nSources\n$1</div>\n");

  // Step 3: 安全清理 — strip 常见危险标签（小写不敏感）
  s = s.replace(/<\s*(script|iframe|object|embed|link|meta|style|body|head|html)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "");
  s = s.replace(/<\s*(script|iframe|object|embed|link|meta|style|body|head|html)[^>]*\/?\s*>/gi, "");
  // strip 事件属性 onclick= onload= 等
  s = s.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "");
  s = s.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "");

  return s;
}

function allowedImageSrc(src: string) {
  const trimmed = src.trim();
  if (!trimmed || trimmed.startsWith("data:") || trimmed.startsWith("javascript:")) return "";
  if (trimmed.startsWith("/science-diagrams/") && !trimmed.includes("..")) return trimmed;
  if (trimmed.startsWith("/") && !trimmed.startsWith("//") && !trimmed.includes("..")) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return "";
}

const markdownComponents: Components = {
  img({ src, alt }) {
    const safe = allowedImageSrc(String(src || ""));
    if (!safe) return <span>{alt || "figure"}</span>;
    return (
      <figure className="course-figure">
        <img src={safe} alt={alt || "Course figure"} />
        {alt ? <figcaption>{alt}</figcaption> : null}
      </figure>
    );
  },
  a({ href, children }) {
    return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
  },
};

export function MarkdownAnswer({ content, compact = false }: { content: string; compact?: boolean }) {
  const processed = preprocessContent(content);
  return (
    <div className={`markdown-answer${compact ? " compact" : ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeKatex, { throwOnError: false, strict: "ignore", output: "html" }]]}
        components={markdownComponents}
      >
        {processed}
      </ReactMarkdown>
    </div>
  );
}
