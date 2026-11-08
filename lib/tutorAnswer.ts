// D1 (docs/phase1/ai-tutor-answer-layer.md): reads an AI Tutor answer for the
// lesson drawer (TutorChat) and the Study Group room, which both render it
// through the one renderer in components/portal/TutorAnswer.tsx. Both places
// show the same KnowledgeSystem course Tutor, so they share one reading of its
// text; a format fix made here reaches both.
//
// The reading decides each question in exactly one place (2026-11-08; before,
// several regex passes each guessed again and could disagree):
// 1. What is code: only fenced blocks (``` / ~~~ at the start of a line) and
//    `inline` spans. Indentation never makes code (remarkTutorNoIndentedCode),
//    because KS indents ordinary prose, for example after an image.
// 2. What is a formula: \( … \), \[ … \], $$ … $$, and $ … $ under Pandoc's
//    rule (the opening $ is followed by a non-space, the closing $ follows a
//    non-space and is not followed by a digit). Every other $ is a plain dollar
//    sign, so "$5 and $10" stays money. Code and formulas are found by one
//    scan (tutorAnswerSegments) and handed to the Markdown parser in the one
//    form it reads ($ … $ inline, $$ on their own lines for display).
// 3. Where a paragraph ends: each answer line is its own paragraph (the model
//    writes one point per line; owner 2026-10-29). This happens after parsing
//    (remarkTutorLines), so a bold, link or formula that wraps onto the next
//    line stays whole. Before parsing only block edges are marked
//    (layoutLines): a blank line between prose and a list, table, quote,
//    heading, fenced block or $$ block.
// "[Source: …]" / "【来源：…】" citations and a closing "Sources" / "来源" list of
// "[n] …" entries leave the prose and come back once each, in order, as the
// source list under the answer. A * between two digits is arithmetic (2*3*4),
// never emphasis.

export type TutorAnswerParts = { markdown: string; sources: string[] };

export type TutorAnswerSegment =
  | { kind: "code"; text: string; fenced: boolean }
  | { kind: "math"; tex: string; display: boolean }
  | { kind: "prose"; text: string };

// A fenced block: the fence opens a line and is closed by a line with the same
// fence character at least as long, or runs to the end of a streaming answer.
const FENCED = /(?:^|(?<=\n))[ \t]*(?:(`{3,})[^\n`]*(?:\n[\s\S]*?(?:\n[ \t]*\1`*[ \t]*(?=\n|$)|$)|$)|(~{3,})[^\n]*(?:\n[\s\S]*?(?:\n[ \t]*\2~*[ \t]*(?=\n|$)|$)|$))/g;
// An inline code span: a run of backticks closed by a run of the same length, on one line.
const INLINE_CODE = /(?<!`)(`+)(?!`)[^\n]*?(?<!`)\1(?!`)/g;

// Formula delimiters, tried at each position.
const DISPLAY_LINE = /[ \t]*\$\$[ \t]*(?=\n|$)/y; // $$ alone on its line opens a display block
const DISPLAY_CLOSE = /\n[ \t]*\$\$[ \t]*(?=\n|$)/g;
const TEX_DISPLAY = /\\\[([\s\S]*?)\\\]/y;
const TEX_INLINE = /\\\(([\s\S]*?)\\\)/y;
const DOUBLE_DOLLAR = /\$\$([^$]+?)\$\$/y;
// Pandoc's tex_math_dollars: $ then a non-space; the closing $ follows a
// non-space and is not followed by a digit; one line.
const SINGLE_DOLLAR = /\$(?![\s$])((?:\\.|[^$\\\n])*?[^\s\\])\$(?!\d)/y;

const SOURCE = /[ \t]*[[［【]\s*(?:Source|来源)\s*[:：]\s*([^\]］】]+?)\s*[\]］】]/gi;
const SOURCES_LIST = /^[ \t]*(?:\*\*)?(?:Sources|来源)(?:\*\*)?[ \t]*[:：]?[ \t]*\n((?:[ \t]*(?:\*\*)?\[\d+\][^\n]*(?:\n|$))+)[ \t]*$/m;

type CodePart = { code: false; text: string } | { code: true; text: string; fenced: boolean };

function splitInlineCode(text: string, push: (part: CodePart) => void) {
  let at = 0;
  for (const span of text.matchAll(INLINE_CODE)) {
    push({ code: false, text: text.slice(at, span.index) });
    push({ code: true, text: span[0], fenced: false });
    at = span.index + span[0].length;
  }
  push({ code: false, text: text.slice(at) });
}

function splitCode(text: string): CodePart[] {
  const parts: CodePart[] = [];
  const push = (part: CodePart) => { if (part.text) parts.push(part); };
  let start = 0;
  for (const fence of text.matchAll(FENCED)) {
    splitInlineCode(text.slice(start, fence.index), push);
    push({ code: true, text: fence[0], fenced: true });
    start = fence.index + fence[0].length;
  }
  splitInlineCode(text.slice(start), push);
  return parts;
}

/** Splits prose into formulas and the text between them; every $ left in the text is escaped as a plain dollar sign. */
function splitMath(text: string, startsLine: boolean): TutorAnswerSegment[] {
  const out: TutorAnswerSegment[] = [];
  let prose = "";
  const flush = () => { if (prose) out.push({ kind: "prose", text: prose }); prose = ""; };
  const math = (tex: string, display: boolean) => {
    const body = tex.trim();
    if (!body && !display) return;
    flush();
    out.push({ kind: "math", tex: body, display });
  };
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\" && text[i + 1] === "$") { prose += "\\$"; i += 2; continue; }
    if (ch === "\\" && (text[i + 1] === "[" || text[i + 1] === "(")) {
      const rule = text[i + 1] === "[" ? TEX_DISPLAY : TEX_INLINE;
      rule.lastIndex = i;
      const found = rule.exec(text);
      if (found && found[1].trim()) { math(found[1], rule === TEX_DISPLAY); i = rule.lastIndex; continue; }
    }
    if (i === 0 ? startsLine : text[i - 1] === "\n") {
      DISPLAY_LINE.lastIndex = i;
      if (DISPLAY_LINE.exec(text)) {
        // A display block runs to the next line holding only $$, or to the end of a streaming answer.
        const bodyStart = text.indexOf("\n", DISPLAY_LINE.lastIndex);
        let end = text.length, after = text.length;
        if (bodyStart >= 0) {
          DISPLAY_CLOSE.lastIndex = bodyStart;
          const found = DISPLAY_CLOSE.exec(text);
          if (found) { end = found.index; after = DISPLAY_CLOSE.lastIndex; }
        }
        math(bodyStart < 0 ? "" : text.slice(bodyStart + 1, end), true);
        i = after;
        continue;
      }
    }
    if (ch === "$") {
      DOUBLE_DOLLAR.lastIndex = i;
      const double = DOUBLE_DOLLAR.exec(text);
      if (double) { math(double[1], false); i = DOUBLE_DOLLAR.lastIndex; continue; }
      SINGLE_DOLLAR.lastIndex = i;
      const single = SINGLE_DOLLAR.exec(text);
      if (single) { math(single[1], false); i = SINGLE_DOLLAR.lastIndex; continue; }
      prose += "\\$";
      i += 1;
      continue;
    }
    prose += ch;
    i += 1;
  }
  flush();
  return out;
}

/** One scan of the answer: code, formulas and the prose between them, with citations taken out of the prose. */
export function tutorAnswerSegments(text: string): { segments: TutorAnswerSegment[]; sources: string[] } {
  const sources: string[] = [];
  const keep = (name: string) => {
    const clean = name.trim().replace(/^\*\*|\*\*$/g, "").replace(/&#x20;$/i, "").trim();
    if (clean && !sources.includes(clean)) sources.push(clean);
  };
  const segments: TutorAnswerSegment[] = [];
  let startsLine = true;
  for (const part of splitCode(text)) {
    if (part.code) { segments.push({ kind: "code", text: part.text, fenced: part.fenced }); startsLine = part.fenced; continue; }
    const prose = part.text
      .replace(SOURCES_LIST, (_match, entries: string) => {
        // "[1] A [2] B" on one line is two entries.
        for (const entry of entries.trimEnd().replace(/[ \t]+(?=(?:\*\*)?\[\d+\][ \t])/g, "\n").split("\n")) keep(entry);
        return "";
      })
      .replace(SOURCE, (_match, name: string) => { keep(name); return ""; });
    segments.push(...splitMath(prose, startsLine));
    startsLine = part.text.endsWith("\n");
  }
  return { segments, sources };
}

// Lines that start a block the prose around them must not run into.
const BLOCK_START = /^[ \t]*(?:[-*+][ \t]|\d+[.)][ \t]|\||>|#{1,6}[ \t])/;
const CONTINUES_BLOCK = /^[ \t]+\S/; // an indented line under a list item belongs to it
const FENCE = /^[ \t]*(`{3,}|~{3,})/;

/**
 * Lays the Markdown out by line: a blank line where prose meets a list, table,
 * quote, heading, fenced block or $$ block, and never two blank lines in a row.
 * Fenced code and $$ blocks keep every line as written. Prose lines are not
 * separated here; remarkTutorLines does that after parsing (rule 3).
 */
function layoutLines(markdown: string) {
  const out: string[] = [];
  let fence: string | null = null;
  let inMath = false;
  let previous: "prose" | "block" | "blank" | "closed" = "blank"; // "closed": a fenced or $$ block just ended
  const gap = () => { if (previous !== "blank") { out.push(""); previous = "blank"; } };
  for (const raw of markdown.split("\n")) {
    const line = raw.replace(/[ \t]+$/, "");
    const mark = FENCE.exec(line)?.[1];
    if (fence !== null) {
      out.push(raw);
      if (mark && mark[0] === fence[0] && mark.length >= fence.length && line.trim() === mark) { fence = null; previous = "closed"; }
      continue;
    }
    if (inMath) {
      out.push(line);
      if (line.trim() === "$$") { inMath = false; previous = "closed"; }
      continue;
    }
    if (mark) { gap(); fence = mark; out.push(raw); continue; }
    if (line.trim() === "$$") { gap(); inMath = true; out.push(line); continue; }
    if (!line.trim()) { gap(); continue; }
    const kind: "prose" | "block" = BLOCK_START.test(line) || (previous === "block" && CONTINUES_BLOCK.test(line)) ? "block" : "prose";
    if (previous !== "blank" && previous !== kind) gap();
    out.push(line);
    previous = kind;
  }
  if (inMath) out.push("$$");
  return out.join("\n").trim();
}

export function tutorAnswerParts(text: string): TutorAnswerParts {
  const { segments, sources } = tutorAnswerSegments(text);
  let markdown = "";
  for (const segment of segments) {
    if (segment.kind === "code") markdown += segment.fenced ? `\n${segment.text}\n` : segment.text;
    else if (segment.kind === "math") markdown += segment.display ? `\n$$\n${segment.tex}\n$$\n` : (segment.tex.includes("$") ? `$$${segment.tex}$$` : `$${segment.tex}$`);
    else markdown += segment.text.replace(/(\d)\*(?=\d)/g, "$1\\*");
  }
  return { markdown: layoutLines(markdown), sources };
}

// --- Markdown parser settings shared by every place that renders an answer ---

type MdNode = { type: string; value?: string; spread?: boolean; children?: MdNode[] };
type ProcessorLike = { data(): unknown };

/** remark plugin: indentation never makes a code block, only fences do (rule 1). */
export function remarkTutorNoIndentedCode(this: ProcessorLike) {
  const data = this.data() as { micromarkExtensions?: unknown[] };
  (data.micromarkExtensions ??= []).push({ disable: { null: ["codeIndented"] } });
}

/** Splits a paragraph at its line breaks; inline spans (bold, links, formulas) are never cut. */
function splitParagraph(paragraph: MdNode): MdNode[] {
  const lines: MdNode[][] = [[]];
  for (const child of paragraph.children ?? []) {
    if (child.type === "break") { lines.push([]); continue; }
    if (child.type !== "text" || !child.value?.includes("\n")) { lines[lines.length - 1].push(child); continue; }
    child.value.split("\n").forEach((piece, index) => {
      if (index > 0) lines.push([]);
      if (piece) lines[lines.length - 1].push({ type: "text", value: piece });
    });
  }
  return lines
    .map((children) => {
      const first = children[0], last = children[children.length - 1];
      if (first?.type === "text") first.value = first.value!.replace(/^[ \t]+/, "");
      if (last?.type === "text") last.value = last.value!.replace(/[ \t]+$/, "");
      return children.filter((child) => child.type !== "text" || child.value);
    })
    .filter((children) => children.length)
    .map((children) => ({ ...paragraph, children }));
}

function splitLines(node: MdNode) {
  if (!node.children) return;
  const before = node.children.length;
  node.children = node.children.flatMap((child) => {
    if (child.type === "paragraph") return splitParagraph(child);
    splitLines(child);
    return [child];
  });
  // A list item that now holds several lines shows each as its own paragraph
  // (a tight item would run them together on one line).
  if (node.type === "listItem" && node.children.length > before) node.spread = true;
}

/** remark plugin: each answer line is its own paragraph (rule 3), decided after inline parsing. */
export function remarkTutorLines() {
  return (tree: MdNode) => splitLines(tree);
}

// --- Plain text (the lesson drawer's "copy as plain text") ---

function plainProse(text: string) {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
    .replace(/^[ \t]*>[ \t]?/gm, "")
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2")
    // Single * or _ emphasis only where Markdown reads it (never 2*3, x_1 or snake_case).
    .replace(/(^|[^\w*\\])\*(?=[^\s*])([^*]*?[^\s*\\])\*(?![\w*])/gm, "$1$2")
    .replace(/(^|[^\w\\])_(?=[^\s_])([^_]*?[^\s_\\])_(?!\w)/gm, "$1$2")
    .replace(/\\([\\`*_{}[\]()#+\-.!$|>])/g, "$1")
    // Indentation means nothing outside code (rule 1), except under a list item.
    // (Only at line breaks inside this prose: its two ends may sit beside a formula or code.)
    .replace(/(?<=\n)[ \t]+(?![-*+][ \t]|\d+[.)][ \t])/g, "")
    .replace(/[ \t]+(?=\n)/g, "")
    .replace(/\n{3,}/g, "\n\n");
}

/**
 * The answer as plain text, read the same way it is shown: code and formulas
 * are kept as written (a formula as its TeX), Markdown marks are dropped, and
 * the sources follow under `sourcesLabel`.
 */
export function tutorAnswerPlainText(text: string, sourcesLabel: string): string {
  const { segments, sources } = tutorAnswerSegments(text);
  let out = "";
  for (const segment of segments) {
    if (segment.kind === "code") {
      out += !segment.fenced
        ? segment.text.replace(/^(`+) ?([\s\S]*?) ?\1$/, "$2")
        : segment.text.replace(/^[ \t]*(?:`{3,}|~{3,})[^\n]*\n?/, "").replace(/\n?[ \t]*(?:`{3,}|~{3,})[ \t]*$/, "");
    } else if (segment.kind === "math") {
      // A display formula stands on its own lines.
      out = segment.display ? `${out.replace(/[ \t]+$/, "")}\n${segment.tex}\n` : out + segment.tex;
    } else {
      out += plainProse(out.endsWith("\n") ? segment.text.replace(/^[ \t]+/, "") : segment.text);
    }
  }
  const body = out.replace(/^\n+|\s+$/g, "");
  return sources.length ? `${body}\n\n${sourcesLabel}\n${sources.join("\n")}` : body;
}
