import type { JSONContent } from "@tiptap/core";
import katex from "katex";

const MARKED_MATH = /\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\)|\$\$([\s\S]*?)\$\$|(?<!\\)\$(?![\s$])((?:\\.|[^$\\\r\n])*?(?:\\.|[^\s$\\]))\$(?!\d)/g;

function bareFormula(line: string): boolean {
  // Only explicit TeX commands on a standalone line qualify; ordinary prose stays text.
  if (!/^\s*(?:[a-zA-Z0-9_{}^=+*/().,\s-]*?)\\(?:frac|dfrac|tfrac|sqrt|begin|sum|int|lim|alpha|beta|theta|pi)\b/.test(line) || /[A-Za-z]{2,}/.test(line.split("\\")[0])) return false;
  if (/\s+[A-Za-z]{2,}(?:\s|$)/.test(line.replace(/\\(?:text|operatorname)\{[^}]*\}/g, ""))) return false;
  try { katex.renderToString(line, { throwOnError: true, trust: false, maxExpand: 100 }); return true; } catch { return false; }
}

export function answerDocument(text: string): JSONContent {
  // Object replacement characters can come from pasted documents; never treat them as our tokens.
  if (text.includes("\uFFFC")) return { type: "doc", content: text.split("\n").map(line => ({ type: "paragraph", content: line ? [{ type: "text", text: line }] : [] })) };
  if (/^\s*\\begin\{(?:aligned|align\*?|matrix|pmatrix|bmatrix|cases|gathered)\}/.test(text) && bareFormula(text)) {
    return { type: "doc", content: [{ type: "blockMath", attrs: { latex: text.trim(), originalLatex: text.trim(), originalSource: text } }] };
  }
  const tokens: JSONContent[] = [];
  const marked = text.replace(MARKED_MATH, (raw, block, inline, dollars, single) => {
    const latex = block ?? inline ?? dollars ?? single;
    tokens.push({ type: block !== undefined || dollars !== undefined ? "blockMath" : "inlineMath", attrs: { latex, originalLatex: latex, originalSource: raw } });
    return `\uFFFC${tokens.length - 1}\uFFFC`;
  });
  return { type: "doc", content: marked.split("\n").map(line => {
    if (bareFormula(line)) return { type: "blockMath", attrs: { latex: line.trim(), originalLatex: line.trim(), originalSource: line } };
    const only = /^\s*\uFFFC(\d+)\uFFFC\s*$/.exec(line);
    if (only && tokens[Number(only[1])].type === "blockMath") {
      const token = tokens[Number(only[1])];
      return { ...token, attrs: { ...token.attrs, originalSource: line.replace(/\uFFFC\d+\uFFFC/, () => token.attrs!.originalSource) } };
    }
    const content: JSONContent[] = [];
    for (const part of line.split(/(\uFFFC\d+\uFFFC)/)) {
      if (!part) continue;
      const token = /^\uFFFC(\d+)\uFFFC$/.exec(part);
      content.push(token ? { ...tokens[Number(token[1])], type: "inlineMath" } : { type: "text", text: part });
    }
    return { type: "paragraph", content };
  }) };
}

export function documentAnswer(doc: JSONContent): string {
  function nodeText(node: JSONContent): string {
    if (node.type === "text") return node.text || "";
    if (node.type === "inlineMath" || node.type === "blockMath") {
      const attrs = node.attrs || {};
      if (attrs.originalLatex === attrs.latex && attrs.originalSource) return attrs.originalSource;
      return node.type === "inlineMath" ? `\\(${attrs.latex}\\)` : `\\[${attrs.latex}\\]`;
    }
    if (node.type === "hardBreak") return "\n";
    return (node.content || []).map(nodeText).join("");
  }
  return (doc.content || []).map(nodeText).join("\n");
}

export function needsAnswerSource(text: string): boolean {
  if (/^\s*\\begin\{(?:aligned|align\*?|matrix|pmatrix|bmatrix|cases|gathered)\}/.test(text) && bareFormula(text)) return false;
  const prose = text.replace(MARKED_MATH, "").split("\n").map(line => bareFormula(line) ? "" : line).join("\n").replace(/\r/g, "");
  return /[`\uFFFC]|^(?:[ \t]{4}\S|[ \t]*[#>|*+-]\s)|\[[^\]]*\]\(|\*\*|__/m.test(prose);
}
