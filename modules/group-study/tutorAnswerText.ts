// Turns a room AI Tutor answer into the Markdown the chat renders (owner
// 2026-10-29: render the model's LaTeX, and keep the layout tidy).
//
// - \( … \) and \[ … \] become $ … $ and $$ … $$, the delimiters remark-math reads.
// - Each answer line is its own paragraph (the model writes one point per line),
//   except inside a $$ block, a list or a table, whose lines belong together.
// - A * between two digits is arithmetic (2*3*4), never emphasis.
// - "[Source: …]" citations leave the prose and come back once each, in order,
//   as a short source list under the answer.

export type TutorAnswerParts = { markdown: string; sources: string[] };

const SOURCE = /\s*[[［【]\s*(?:Source|来源)\s*[:：]\s*([^\]］】]+?)\s*[\]］】]/gi;

function mathDelimiters(text: string) {
  return text
    .replace(/\\\[([\s\S]+?)\\\]/g, (_match, body: string) => `\n$$\n${body.trim()}\n$$\n`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_match, body: string) => `$${body.trim()}$`);
}

// Escapes digit*digit outside $ … $ and $$ … $$ (inside, * is the formula's own).
function arithmeticStars(text: string) {
  return text.split(/(\$\$[\s\S]*?\$\$|\$[^$\n]+\$)/).map((part, index) => index % 2 ? part : part.replace(/(\d)\*(?=\d)/g, "$1\\*")).join("");
}

function groupedLine(line: string) {
  return /^\s*(?:[-*+]\s|\d+[.)]\s|\|)/.test(line);
}

export function tutorAnswerParts(text: string): TutorAnswerParts {
  const sources: string[] = [];
  const prose = text.replace(SOURCE, (_match, name: string) => {
    const clean = name.trim();
    if (clean && !sources.includes(clean)) sources.push(clean);
    return "";
  });
  const lines = arithmeticStars(mathDelimiters(prose)).split("\n");
  const out: string[] = [];
  let inMath = false;
  let previous = "";
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    const fence = line.trim() === "$$";
    if (!line.trim() && !inMath) continue;
    if (inMath || fence) {
      // A $$ block stands apart from the prose around it and keeps its own lines.
      if (fence && !inMath && out.length) out.push("");
      out.push(line);
      if (fence) inMath = !inMath;
      if (fence && !inMath) out.push("");
      previous = fence && !inMath ? "" : line;
      continue;
    }
    if (out.length && out[out.length - 1] !== "" && !(groupedLine(previous) && groupedLine(line))) out.push("");
    out.push(line);
    previous = line;
  }
  if (inMath) out.push("$$");
  return { markdown: out.join("\n").replace(/\n{3,}/g, "\n\n").trim(), sources };
}
