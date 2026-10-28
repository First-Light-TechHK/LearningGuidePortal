// Renders an FAQ answer through the one safe parser (modules/helpdesk/markdown.ts).
// Every answer surface uses this: the chat panel, the submit-time modal and the
// Help Centre. Text goes through React, so nothing is ever parsed as HTML.
import React, { Fragment } from "react";
import { parseMarkdown, type Inline, type Line } from "@/modules/helpdesk/markdown";

function InlineParts({ parts }: { parts: Inline[] }) {
  return <>{parts.map((part, index) => {
    if (part.kind === "text") return <Fragment key={index}>{part.text}</Fragment>;
    if (part.kind === "strong") return <strong key={index}><InlineParts parts={part.children} /></strong>;
    return part.external
      ? <a key={index} href={part.href} target="_blank" rel="noopener noreferrer"><InlineParts parts={part.children} /></a>
      : <a key={index} href={part.href} rel="noopener noreferrer"><InlineParts parts={part.children} /></a>;
  })}</>;
}

function Lines({ lines }: { lines: Line[] }) {
  return <>{lines.map((line, index) => <Fragment key={index}>{index > 0 ? <br /> : null}<InlineParts parts={line} /></Fragment>)}</>;
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = parseMarkdown(text).map((block, index) => {
    if (block.kind === "paragraph") return <p key={index}><Lines lines={block.lines} /></p>;
    const items = block.items.map((item, itemIndex) => <li key={itemIndex}><Lines lines={item} /></li>);
    if (block.kind === "bullet") return <ul key={index}>{items}</ul>;
    return <ol key={index} start={block.start === 1 ? undefined : block.start}>{items}</ol>;
  });
  return className ? <div className={className}>{blocks}</div> : <>{blocks}</>;
}
