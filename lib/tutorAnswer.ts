// D1 (docs/phase1/ai-tutor-answer-layer.md): turns an AI Tutor answer into the
// Markdown both the lesson drawer (TutorChat) and the Study Group room render,
// through the one renderer in components/portal/TutorAnswer.tsx. Both places
// show the same KnowledgeSystem course Tutor, so they share one reading of its
// text; a format fix made here reaches both.
//
// Code (``` / ~~~ fences and `inline` spans) is passed through untouched. In
// the rest of the text:
// - Prose indented by 4+ spaces is pulled back so it is not read as a code
//   block (KS indents everything after an image).
// - "[Source: …]" / "【来源：…】" citations and a closing "Sources" list of
//   "[n] …" entries leave the prose and come back once each, in order, as the
//   source list under the answer.
// - \( … \) and \[ … \] become $ … $ and $$ … $$, the delimiters remark-math reads.
// - A * between two digits is arithmetic (2*3*4), never emphasis.
// - Each answer line is its own paragraph (the model writes one point per
//   line; owner 2026-10-29), except inside a $$ block, a list, a table or a
//   quote, whose lines belong together.

export type TutorAnswerParts = { markdown: string; sources: string[] };

// A fenced block (closed by the same fence, or running to the end of a
// streaming answer) or an inline code span.
const CODE = /(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n\1[ \t]*(?=\n|$)|$)|(`+)[^\n]*?\2/g;
const FENCE = /^\s*(`{3,}|~{3,})/;

/** Applies `change` to the text between code spans; the code itself is kept as it is. */
function outsideCode(text: string, change: (prose: string) => string): string {
  let result = "";
  let start = 0;
  for (const match of text.matchAll(CODE)) {
    result += change(text.slice(start, match.index)) + match[0];
    start = match.index + match[0].length;
  }
  return result + change(text.slice(start));
}

export function normalizeTutorIndent(text: string): string {
  const protectedToken = /(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n\1[ \t]*(?=\n|$)|$)|(`+)[^\n]*?\2|\\\[[\s\S]*?(?:\\\]|$)|\\\([\s\S]*?(?:\\\)|$)|(?<!\\)\$\$[\s\S]*?(?:\$\$|$)|(?<!\\)\$(?!\$)[^$\n]*(?:\$|(?=\n|$))/g;
  const prose = (part: string) => part.replace(/^(?: {4,}|\t+)(?=(?:\*\*|[-*] |Sources[ \t]*$|\[\d+\][ \t]))/gm, "");
  let result = "", start = 0;
  for (const match of text.matchAll(protectedToken)) {
    result += prose(text.slice(start, match.index)) + match[0];
    start = match.index + match[0].length;
  }
  return result + prose(text.slice(start));
}

const SOURCE = /\s*[[［【]\s*(?:Source|来源)\s*[:：]\s*([^\]］】]+?)\s*[\]］】]/gi;
const SOURCES_LIST = /^(?:\*\*)?Sources(?:\*\*)?[ \t]*\n((?:(?:\*\*)?\[\d+\][^\n]*(?:\n|$))+)[ \t]*$/m;

function mathDelimiters(text: string) {
  return text
    .replace(/\\\[([\s\S]+?)\\\]/g, (_match, body: string) => `\n$$\n${body.trim()}\n$$\n`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_match, body: string) => `$${body.trim()}$`);
}

// Escapes digit*digit outside $ … $ and $$ … $$ (inside, * is the formula's own).
function arithmeticStars(text: string) {
  return text.split(/(\$\$[\s\S]*?\$\$|\$[^$\n]+\$)/).map((part, index) => index % 2 ? part : part.replace(/(\d)\*(?=\d)/g, "$1\\*")).join("");
}

// Lines that belong with the line before them: list items, table rows, quotes.
function groupedLine(line: string) {
  return /^\s*(?:[-*+]\s|\d+[.)]\s|\||>)/.test(line);
}

export function tutorAnswerParts(text: string): TutorAnswerParts {
  const sources: string[] = [];
  const keep = (name: string) => {
    const clean = name.trim().replace(/^\*\*|\*\*$/g, "").replace(/&#x20;$/i, "").trim();
    if (clean && !sources.includes(clean)) sources.push(clean);
  };
  const prose = outsideCode(normalizeTutorIndent(text), (part) => arithmeticStars(mathDelimiters(part
    .replace(SOURCE, (_match, name: string) => { keep(name); return ""; })
    .replace(SOURCES_LIST, (_match, entries: string) => {
      // "[1] A [2] B" on one line is two entries.
      for (const entry of entries.trimEnd().replace(/[ \t]+(?=(?:\*\*)?\[\d+\][ \t])/g, "\n").split("\n")) keep(entry);
      return "";
    }))));

  const out: string[] = [];
  let fence: string | null = null;
  let inMath = false;
  let previous = "";
  for (const raw of prose.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    const fenceMark = FENCE.exec(line)?.[1];
    if (fence !== null || (fenceMark && !inMath)) {
      // A fenced block keeps every line, blank ones included, and stands apart from the prose.
      if (fence === null) {
        if (out.length && out[out.length - 1] !== "") out.push("");
        fence = fenceMark!;
      } else if (fenceMark && fenceMark[0] === fence[0] && fenceMark.length >= fence.length && line.trim() === fenceMark) {
        fence = null;
      }
      out.push(raw);
      if (fence === null) out.push("");
      previous = "";
      continue;
    }
    const mathFence = line.trim() === "$$";
    if (!line.trim() && !inMath) continue;
    if (inMath || mathFence) {
      // A $$ block stands apart from the prose around it and keeps its own lines.
      if (mathFence && !inMath && out.length && out[out.length - 1] !== "") out.push("");
      out.push(line);
      if (mathFence) inMath = !inMath;
      if (mathFence && !inMath) out.push("");
      previous = mathFence && !inMath ? "" : line;
      continue;
    }
    if (out.length && out[out.length - 1] !== "" && !(groupedLine(previous) && groupedLine(line))) out.push("");
    out.push(line);
    previous = line;
  }
  if (inMath) out.push("$$");
  // No blank-line squeeze here: outside a fence the loop never writes two in a
  // row, and inside one the blank lines are the code's own.
  return { markdown: out.join("\n").trim(), sources };
}
