"use client";

import type { ReactNode } from "react";

type InlineToken = { type: "text" | "bold" | "italic" | "link"; text: string; href?: string };

function parseInline(text: string) {
  const tokens: InlineToken[] = [];
  const pattern = /(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(\[([^\]]+)\]\((https?:\/\/[^)\s]+)\))/g;
  let index = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > index) tokens.push({ type: "text", text: text.slice(index, match.index) });
    if (match[2]) tokens.push({ type: "bold", text: match[2] });
    else if (match[4]) tokens.push({ type: "italic", text: match[4] });
    else if (match[6] && match[7]) tokens.push({ type: "link", text: match[6], href: match[7] });
    index = match.index + match[0].length;
  }
  if (index < text.length) tokens.push({ type: "text", text: text.slice(index) });
  return tokens;
}

function renderInline(text: string) {
  return parseInline(text).map((token, index) => {
    if (token.type === "bold") return <strong key={index}>{token.text}</strong>;
    if (token.type === "italic") return <em key={index}>{token.text}</em>;
    if (token.type === "link") {
      return <a href={token.href} target="_blank" rel="noreferrer" key={index}>{token.text}</a>;
    }
    return <span key={index}>{token.text}</span>;
  });
}

function flushParagraph(lines: string[], nodes: ReactNode[], key: string) {
  if (!lines.length) return;
  nodes.push(<p key={key}>{renderInline(lines.join(" "))}</p>);
  lines.length = 0;
}

function flushList(items: string[], ordered: boolean, nodes: ReactNode[], key: string) {
  if (!items.length) return;
  const listItems = items.map((item, index) => <li key={index}>{renderInline(item)}</li>);
  nodes.push(ordered ? <ol key={key}>{listItems}</ol> : <ul key={key}>{listItems}</ul>);
  items.length = 0;
}

export function MarkdownAnswer({ content, compact = false }: { content: string; compact?: boolean }) {
  const nodes: ReactNode[] = [];
  const paragraph: string[] = [];
  const bulletItems: string[] = [];
  const numberedItems: string[] = [];
  const lines = content.replace(/\r\n/g, "\n").split("\n");

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    const key = `md-${index}`;
    if (!trimmed) {
      flushParagraph(paragraph, nodes, `${key}-p`);
      flushList(bulletItems, false, nodes, `${key}-ul`);
      flushList(numberedItems, true, nodes, `${key}-ol`);
      return;
    }

    if (/^---+$/.test(trimmed)) {
      flushParagraph(paragraph, nodes, `${key}-p`);
      flushList(bulletItems, false, nodes, `${key}-ul`);
      flushList(numberedItems, true, nodes, `${key}-ol`);
      nodes.push(<hr key={key} />);
      return;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushParagraph(paragraph, nodes, `${key}-p`);
      flushList(bulletItems, false, nodes, `${key}-ul`);
      flushList(numberedItems, true, nodes, `${key}-ol`);
      const level = heading[1].length;
      const children = renderInline(heading[2]);
      if (level === 1) nodes.push(<h2 key={key}>{children}</h2>);
      else if (level === 2) nodes.push(<h3 key={key}>{children}</h3>);
      else nodes.push(<h4 key={key}>{children}</h4>);
      return;
    }

    const bullet = /^[-*]\s+(.+)$/.exec(trimmed);
    if (bullet) {
      flushParagraph(paragraph, nodes, `${key}-p`);
      flushList(numberedItems, true, nodes, `${key}-ol`);
      bulletItems.push(bullet[1]);
      return;
    }

    const numbered = /^\d+\.\s+(.+)$/.exec(trimmed);
    if (numbered) {
      flushParagraph(paragraph, nodes, `${key}-p`);
      flushList(bulletItems, false, nodes, `${key}-ul`);
      numberedItems.push(numbered[1]);
      return;
    }

    flushList(bulletItems, false, nodes, `${key}-ul`);
    flushList(numberedItems, true, nodes, `${key}-ol`);
    paragraph.push(trimmed);
  });

  flushParagraph(paragraph, nodes, "md-final-p");
  flushList(bulletItems, false, nodes, "md-final-ul");
  flushList(numberedItems, true, nodes, "md-final-ol");

  return <div className={`markdown-answer${compact ? " compact" : ""}`}>{nodes}</div>;
}
