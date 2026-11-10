import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import React, { createElement } from "react";
import { tutorAnswerParts, tutorAnswerPlainText, tutorAnswerSegments } from "../../lib/tutorAnswer";

// Edge cases of the AI Tutor answer layer (docs/phase1/ai-tutor-answer-layer.md,
// 2026-11-08): what is code, what is a formula and where a paragraph ends are
// each decided in one place, so these hold in the lesson drawer and the room alike.

(globalThis as { React?: typeof React }).React = React;
async function render(text: string, courseId = "course-1") {
  const { TutorAnswer } = await import("../../components/portal/TutorAnswer");
  return renderToStaticMarkup(createElement(TutorAnswer, { text, courseId, sourcesLabel: "Sources" }));
}
const katexCount = (html: string) => (html.match(/class="katex"/g) || []).length;
const IMAGE = "![图](/api/user/courses/modeling-life/images/22222222-2222-4222-8222-222222222222.png)";

test("formula rule: money stays money, in English and Chinese, beside a real formula and in a range", async () => {
  for (const text of ["A book costs $5 and a pen costs $10.", "书 $5，笔 $10，一共 $15。", "Between $3-$4 each.", "Spaced $ x $ is not a formula."]) {
    const html = await render(text);
    assert.equal(katexCount(html), 0, text);
    assert.match(html, new RegExp(`<p>${text.replace(/[$.()*+?[\]\\^{}|-]/g, "\\$&")}</p>`), text);
  }
  const mixed = await render("It costs $5. The area is $x^2$.");
  assert.equal(katexCount(mixed), 1);
  assert.match(mixed, /<p>It costs \$5\. The area is <span class="katex">/);
});

test("formula rule: $ … $, \\( … \\), \\[ … \\], $$ … $$ inline and on their own lines are formulas; \\$ is a dollar sign", async () => {
  assert.equal(katexCount(await render("Power $x^n$ and $a+b$.")), 2);
  assert.equal(katexCount(await render("Inline \\(x^2\\) and $$y^2$$ here")), 2);
  assert.doesNotMatch(await render("Inline $$y^2$$ here"), /katex-display/, "$$ … $$ inside a line stays inline");
  const display = await render("Then\n\\[\na+b\n=c\n\\]\nDone");
  assert.match(display, /<p>Then<\/p>\s*<span class="katex-display">[\s\S]*<p>Done<\/p>/);
  const escaped = await render("Price \\$5 and \\$6.");
  assert.equal(katexCount(escaped), 0);
  assert.match(escaped, /<p>Price \$5 and \$6\.<\/p>/);
});

test("formula rule: \\[ … \\] inside a sentence around plain words is escaped brackets; with TeX in it, or on its own line, it is a formula", async () => {
  const brackets = await render("Array index \\[1\\] means the second item.");
  assert.equal(katexCount(brackets), 0);
  assert.match(brackets, /<p>Array index \[1\] means the second item\.<\/p>/);
  assert.match(await render("The interval \\[a, b\\] is closed."), /<p>The interval \[a, b\] is closed\.<\/p>/);
  assert.equal(tutorAnswerPlainText("Array index \\[1\\] here", "Sources"), "Array index [1] here");
  assert.match(await render("So \\[x=1\\] holds."), /katex-display/);
  assert.match(await render("So \\[\\alpha\\] holds."), /katex-display/);
  assert.match(await render("\\[1\\]"), /katex-display/);
  assert.match(await render("Value:\n\\[x\\]\nDone"), /<p>Value:<\/p>\s*<span class="katex-display">/);
});

test("formula rule: a $$ block keeps lines that look like a table or a list, and a formula may wrap a line", async () => {
  const { markdown } = tutorAnswerParts("Abs:\n$$\n|x| = -x\n- y\n$$\nEnd");
  assert.equal(markdown, "Abs:\n\n$$\n|x| = -x\n- y\n$$\n\nEnd");
  const html = await render("Abs:\n$$\n|x| = -x\n- y\n$$\nEnd");
  assert.doesNotMatch(html, /<table|<ul/);
  assert.equal(katexCount(await render("Sum \\(a +\nb\\) ok")), 1);
});

test("formula rule: code is never read as a formula, and a citation inside code stays", async () => {
  const html = await render("Run `echo $HOME` and $x$; `[Source: x]` [Source: Real]");
  assert.match(html, /<code>echo \$HOME<\/code>/);
  assert.match(html, /<code>\[Source: x\]<\/code>/);
  assert.equal(katexCount(html), 1);
  assert.match(html, /<p>Sources<\/p><p>Real<\/p>/);
  assert.deepEqual(tutorAnswerSegments("`$a$` $b$").segments.map((segment) => segment.kind), ["code", "prose", "math"]);
});

test("code rule: indentation never makes a code block (prose after an image, tabs, numbered lines, nested lists)", async () => {
  const cases: Array<[string, RegExp]> = [
    ["The answer is below.\n    This line is indented by four spaces.", /<p>The answer is below\.<\/p>\s*<p>This line is indented by four spaces\.<\/p>/],
    [`${IMAGE}\n    After the image the text is indented.\n    Second indented line.`, /<img [^>]*>[\s\S]*<p>After the image the text is indented\.<\/p>\s*<p>Second indented line\.<\/p>/],
    ["Intro\n\tTabbed line", /<p>Intro<\/p>\s*<p>Tabbed line<\/p>/],
    ["Intro\n    1. first\n    2. second", /<p>Intro<\/p>\s*<ol>\s*<li>first<\/li>\s*<li>second<\/li>\s*<\/ol>/],
    ["- a\n    - b\n- c", /<ul>\s*<li>a\s*<ul>\s*<li>b<\/li>/],
  ];
  for (const [text, shape] of cases) {
    const html = await render(text);
    assert.doesNotMatch(html, /<pre/, text);
    assert.match(html, shape, text);
  }
  // A fence is still code, with its spaces and blank lines.
  assert.match(await render("Code:\n~~~\n  x  \n\n\n~~~\nAfter"), /<p>Code:<\/p>\s*<pre><code> {2}x {2}\n\n\n<\/code><\/pre>\s*<p>After<\/p>/);
});

test("line rule: every line is its own paragraph, and bold, italics, links and formulas that wrap a line stay whole", async () => {
  assert.match(await render("One\nTwo\nThree"), /<p>One<\/p>\s*<p>Two<\/p>\s*<p>Three<\/p>/);
  assert.match(await render("Line one  \nLine two"), /<p>Line one<\/p>\s*<p>Line two<\/p>/);
  assert.match(await render("**Key\npoint** here"), /<p><strong>Key\npoint<\/strong> here<\/p>/);
  assert.match(await render("*a\nb*"), /<p><em>a\nb<\/em><\/p>/);
  assert.match(await render("[a\nb](https://x.test)"), /<p><a href="https:\/\/x\.test" target="_blank" rel="noopener noreferrer">a\nb<\/a><\/p>/);
  assert.doesNotMatch(await render("**Key\npoint**"), /\*\*/);
});

test("line rule: lists, tables, quotes and headings keep their own lines and do not swallow the prose after them", async () => {
  assert.match(await render("Rules:\n- sum\n- product\nDone"), /<p>Rules:<\/p>\s*<ul>\s*<li>sum<\/li>\s*<li>product<\/li>\s*<\/ul>\s*<p>Done<\/p>/);
  assert.match(await render("Intro\n2. two\n3. three"), /<ol start="2">/);
  assert.match(await render("Table:\n| a | b |\n|---|---|\n| 1 | 2 |\nAfter table"), /<p>Table:<\/p>\s*<table>[\s\S]*<\/table>\s*<p>After table<\/p>/);
  assert.match(await render("Said:\n> one\n> two\nAfter quote"), /<p>Said:<\/p>\s*<blockquote>\s*<p>one<\/p>\s*<p>two<\/p>\s*<\/blockquote>\s*<p>After quote<\/p>/);
  assert.match(await render("## Steps\nText"), /<h2>Steps<\/h2>\s*<p>Text<\/p>/);
  // A list item with a second line shows it on its own line.
  assert.match(await render("1. First\n   more\n2. Second\nDone"), /<li>\s*<p>First<\/p>\s*<p>more<\/p>\s*<\/li>[\s\S]*<\/ol>\s*<p>Done<\/p>/);
});

test("streaming: an answer cut inside a fence, a $$ block, \\( or $ still renders", async () => {
  assert.match(await render("Intro\n```js\nconst a = 1;"), /<pre><code class="language-js">const a = 1;/);
  assert.match(await render("Intro\n$$\nx^2"), /katex-display/);
  assert.match(await render("Consider $x^2 +"), /<p>Consider \$x\^2 \+<\/p>/);
  assert.equal(katexCount(await render("Consider \\(x^2 +")), 0);
});

test("sources: an indented or Chinese closing list is found, and nothing else changes", async () => {
  assert.deepEqual(tutorAnswerParts("Text\n\n    Sources\n    [1] L1\n    [2] L2"), { markdown: "Text", sources: ["[1] L1", "[2] L2"] });
  assert.deepEqual(tutorAnswerParts("正文\n来源：\n[1] 第一课"), { markdown: "正文", sources: ["[1] 第一课"] });
  assert.deepEqual(tutorAnswerParts("x [Source: L1] y [来源：L1]"), { markdown: "x y", sources: ["L1"] });
  assert.equal(tutorAnswerParts("See [1] in the text").markdown, "See [1] in the text");
});

test("arithmetic and identifiers: 2*3*4, x_1 and snake_case stay as written; raw HTML stays text", async () => {
  assert.match(await render("2*3*4 = 24 and **bold**"), /<p>2\*3\*4 = 24 and <strong>bold<\/strong><\/p>/);
  assert.match(await render("x_1 and snake_case and __bold__"), /<p>x_1 and snake_case and <strong>bold<\/strong><\/p>/);
  assert.match(await render("<b>x</b> & y"), /<p>&lt;b&gt;x&lt;\/b&gt; &amp; y<\/p>/);
  assert.match(await render("\n\n\nOnly\n\n\n"), /^<div class="tutor-answer" data-testid="tutor-answer"><p>Only<\/p><\/div>$/);
});

test("plain text copy reads the answer the same way: formulas as TeX, code as written, no Markdown marks, sources at the end", () => {
  assert.equal(tutorAnswerPlainText("2*3*4 = 24, x_1 and snake_case are **key**; *really*.", "Sources"), "2*3*4 = 24, x_1 and snake_case are key; really.");
  assert.equal(tutorAnswerPlainText("A book costs $5. Area \\(x^2\\) and $y_1$.", "Sources"), "A book costs $5. Area x^2 and y_1.");
  assert.equal(tutorAnswerPlainText(`${IMAGE}\n    Indented prose [link](https://x.test)`, "Sources"), "图\nIndented prose link");
  assert.equal(tutorAnswerPlainText("Code:\n```py\n  x = 1\n\n\ny = 2\n```\nDone", "Sources"), "Code:\n  x = 1\n\n\ny = 2\nDone");
  assert.equal(tutorAnswerPlainText("Run `a*b*c` now", "Sources"), "Run a*b*c now");
  assert.equal(tutorAnswerPlainText("Claim [Source: Lesson 1]\n\nSources\n[1] Lesson 2", "来源"), "Claim\n\n来源\n[1] Lesson 2\nLesson 1");
  assert.equal(tutorAnswerPlainText("Consider \\[\na+b\n\\] done", "Sources"), "Consider\na+b\ndone");
});

test("the lesson drawer's plain-text copy uses the shared reading, not its own regexes", () => {
  const chat = readFileSync("components/portal/TutorChat.tsx", "utf8");
  assert.match(chat, /tutorAnswerPlainText\(message\.content, actions\.tutorSources\)/);
  assert.doesNotMatch(chat, /replace\(\/\[\*_`\]\/g, ""\)/);
});
