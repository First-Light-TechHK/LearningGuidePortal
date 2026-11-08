import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import React, { createElement } from "react";
import { tutorAnswerParts } from "../../lib/tutorAnswer";

// One AI Tutor answer layer for the lesson drawer and the Study Group room
// (docs/phase1/ai-tutor-answer-layer.md, 2026-11-06). D1 = the shared reading
// of KS's text, D2 = the one renderer, D3 = the shared styles.

(globalThis as { React?: typeof React }).React = React;
async function render(text: string, courseId?: string) {
  const { TutorAnswer } = await import("../../components/portal/TutorAnswer");
  return renderToStaticMarkup(createElement(TutorAnswer, { text, courseId, sourcesLabel: "Sources" }));
}

test("D1: fenced code keeps its own lines, blank lines and backslashes; prose around it still gets one paragraph per line", async () => {
  const code = "```python\nx = 1\n\n\n# \\(not math\\) [Source: not a citation]\nprint(2*3)\n```";
  const { markdown, sources } = tutorAnswerParts(`First point\nSecond point\n${code}\nAfter`);
  // Prose lines become paragraphs after parsing (remarkTutorLines); the text only marks block edges.
  assert.equal(markdown, `First point\nSecond point\n\n${code}\n\nAfter`);
  assert.deepEqual(sources, []);
  const html = await render(`First point\nSecond point\n${code}\nAfter`);
  assert.match(html, /<p>First point<\/p>\s*<p>Second point<\/p>\s*<pre><code class="language-python">x = 1\n\n\n# \\\(not math\\\) \[Source: not a citation\]\nprint\(2\*3\)\n<\/code><\/pre>\s*<p>After<\/p>/);
});

test("D1: inline code is not rewritten; the prose beside it is", () => {
  const { markdown, sources } = tutorAnswerParts("Use `a\\(b\\)` and \\(x^2\\) with 2*3 [Source: Lesson 1]");
  assert.equal(markdown, "Use `a\\(b\\)` and $x^2$ with 2\\*3");
  assert.deepEqual(sources, ["Lesson 1"]);
});

test("D1: a streaming answer cut inside a fence or a $$ block still parses", () => {
  assert.equal(tutorAnswerParts("Intro\n```js\nconst a = 1;").markdown, "Intro\n\n```js\nconst a = 1;");
  assert.equal(tutorAnswerParts("Intro\n$$\nx^2").markdown, "Intro\n\n$$\nx^2\n$$");
});

test("D1: quote lines stay one quote", () => {
  assert.equal(tutorAnswerParts("Said:\n> one\n> two").markdown, "Said:\n\n> one\n> two");
});

test("D2: links only to http(s), in a new tab with no referrer; anything else is plain text", async () => {
  const html = await render("[ok](https://example.test/a) [mail](mailto:x@example.test) [rel](/en-GB/portal)");
  assert.match(html, /<a href="https:\/\/example\.test\/a" target="_blank" rel="noopener noreferrer">ok<\/a>/);
  assert.doesNotMatch(html, /href="mailto:|href="\/en-GB/);
  assert.match(html, /<span>mail<\/span> <span>rel<\/span>/);
});

test("D2: KaTeX renders HTML only, so the formula's text is not there twice", async () => {
  const html = await render("Power rule $(x^n)'=nx^{n-1}$");
  assert.match(html, /class="katex-html"/);
  assert.doesNotMatch(html, /katex-mathml/);
});

test("D2: the answer and its sources use the shared class names, nothing page-specific", async () => {
  const html = await render("Claim [Source: Modeling Life - 2.2]");
  assert.match(html, /^<div class="tutor-answer" data-testid="tutor-answer"><p>Claim<\/p><div class="tutor-answer-sources"><p>Sources<\/p><p>Modeling Life - 2\.2<\/p><\/div><\/div>$/);
});

test("D2: the lesson drawer and the Study Group room both render through TutorAnswer, and the old lesson renderer is gone", () => {
  const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
  const chat = read("components/portal/TutorChat.tsx");
  const room = read("components/portal/StudySessionRoom.tsx");
  assert.match(chat, /import \{ TutorAnswer \} from "\.\/TutorAnswer";/);
  assert.equal((chat.match(/<TutorAnswer text=/g) || []).length, 2, "welcome and messages");
  assert.match(room, /import \{ TutorAnswer, TutorCopyButton \} from "\.\/TutorAnswer";/);
  assert.equal(chat.includes("TutorMarkdown"), false);
  assert.throws(() => read("components/portal/TutorMarkdown.tsx"));
});

test("D3: one answer layout in app/styles.css; the room module keeps only its bubble, and both pages take the Tutor colours from the same tokens", () => {
  const styles = readFileSync(new URL("../../app/styles.css", import.meta.url), "utf8");
  const room = readFileSync(new URL("../../components/portal/study-groups.module.css", import.meta.url), "utf8");
  assert.match(styles, /:root \{ --lg-tutor-accent:#005cff; --lg-tutor-accent-border:#d1dcff; --lg-tutor-accent-soft:#f5f8ff; \}/);
  assert.match(styles, /\.tutor-answer p \{ margin:0 0 \.6em;/);
  assert.match(styles, /\.tutor-answer-sources \{/);
  assert.doesNotMatch(styles, /\.tutor-message \.markdown-answer/);
  assert.doesNotMatch(room, /\.tutorAnswer\b|\.tutorSources\b/);
  assert.match(room, /\.tutorEntry \{[^}]*color: var\(--lg-tutor-accent\);/);
  assert.match(room, /\.tutorAvatar \{[^}]*background: var\(--lg-tutor-accent\);/);
  assert.match(styles, /\.tutor-new-chat \{[^}]*border:1px solid var\(--lg-tutor-accent-border\);[^}]*color:var\(--lg-tutor-accent\);/);
  assert.match(styles, /\.mode-switch button\.selected \{ background:var\(--lg-tutor-accent\);/);
});
