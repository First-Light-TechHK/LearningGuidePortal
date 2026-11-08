import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import React, { createElement } from "react";
import { tutorAnswerParts } from "../../lib/tutorAnswer";

// The component file uses the automatic JSX runtime under Next; the test
// loader compiles it with the classic one, which reads a global React.
(globalThis as { React?: typeof React }).React = React;
async function render(text: string, courseId?: string) {
  const { TutorAnswer } = await import("../../components/portal/TutorAnswer");
  return renderToStaticMarkup(createElement(TutorAnswer, { text, courseId, sourcesLabel: "Sources" }));
}

// Owner 2026-10-29: the room AI Tutor's LaTeX renders, and the answer stays tidy.

test("tutor answer keeps $ math, turns \\( \\) and \\[ \\] into $ and $$, one paragraph per line", () => {
  const { markdown, sources } = tutorAnswerParts("Derivative \\(f'(x)\\) of $x^n$ is:\n\\[\\frac{d}{dx}x^n = nx^{n-1}\\]\nNext line");
  assert.deepEqual(sources, []);
  assert.equal(markdown, "Derivative $f'(x)$ of $x^n$ is:\n\n$$\n\\frac{d}{dx}x^n = nx^{n-1}\n$$\n\nNext line");
});

test("tutor answer keeps list items together and closes an unterminated $$ block", () => {
  assert.equal(tutorAnswerParts("Rules:\n- sum\n- product\nDone").markdown, "Rules:\n\n- sum\n- product\n\nDone");
  assert.equal(tutorAnswerParts("$$\nx^2").markdown, "$$\nx^2\n$$");
});

test("tutor answer moves [Source: …] citations out of the prose, once each and in order", () => {
  const { markdown, sources } = tutorAnswerParts("A [Source: Modeling Life - 2.2] and B [Source: Modeling Life - 9]【来源：Modeling Life - 2.2】");
  assert.equal(markdown, "A and B");
  assert.deepEqual(sources, ["Modeling Life - 2.2", "Modeling Life - 9"]);
});

test("tutor answer splits numbered Sources on one line", async () => {
  const text = "Claim [1].\n\nSources\n[1] Lesson_1_0921 [2] Modeling Life 精华提炼";
  assert.deepEqual(tutorAnswerParts(text), { markdown: "Claim [1].", sources: ["[1] Lesson_1_0921", "[2] Modeling Life 精华提炼"] });
  const html = await render(text);
  assert.match(html, /<p>Sources<\/p><p>\[1\] Lesson_1_0921<\/p><p>\[2\] Modeling Life 精华提炼<\/p>/);
});

test("Group Study renders indented explanation after an image as prose", async () => {
  const asset = "22222222-2222-4222-8222-222222222222.png";
  const text = `![图](/api/user/courses/modeling-life/images/${asset})\n\n    **标量**是一个数。[1]\n    - 正数方向不变\n\n    Sources\n    [1] Lesson 1`;
  const html = await render(text, "course-1");
  assert.doesNotMatch(html, /<pre/);
  assert.match(html, /<strong>标量<\/strong>/);
  assert.match(html, /<p>Sources<\/p><p>\[1\] Lesson 1<\/p>/);
});

test("tutor answer splits bold Sources entries and removes encoded trailing space", () => {
  const text = "Claim.\n\n**Sources**\n**[1] Lesson_1_0921&#x20;** **[2] Modeling Life 精华提炼**";
  assert.deepEqual(tutorAnswerParts(text), {
    markdown: "Claim.",
    sources: ["[1] Lesson_1_0921", "[2] Modeling Life 精华提炼"],
  });
});

test("TutorAnswer renders KaTeX, no raw HTML and no arbitrary images", async () => {
  const html = await render("Power rule $(x^n)'=nx^{n-1}$ <img src=x onerror=alert(1)> ![t](https://e.x/i.png) [Source: Book]");
  assert.match(html, /class="katex"/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/, "raw HTML stays text");
  assert.match(html, /<p>Sources<\/p><p>Book<\/p>/);
});

test("TutorAnswer renders only course images through the Portal proxy", async () => {
  const asset = "22222222-2222-4222-8222-222222222222.png";
  const html = await render(`![diagram](/api/user/courses/modeling-life/images/${asset}) ![remote](https://example.test/a.png)`, "course-1");
  assert.match(html, new RegExp(`/api/ai-tutor/images/${asset}\\?courseId=course-1`));
  assert.equal((html.match(/<img/g) || []).length, 1);
  assert.doesNotMatch(html, /src="https:\/\/example\.test/);
});

test("Tutor copy action stays outside the answer bubble with an accessible icon", async () => {
  const { TutorAnswer, TutorCopyButton } = await import("../../components/portal/TutorAnswer");
  const html = renderToStaticMarkup(createElement("div", null,
    createElement("div", { className: "bubble" }, createElement(TutorAnswer, { text: "The answer.", sourcesLabel: "Sources" })),
    createElement(TutorCopyButton, { text: "The answer.", copyLabel: "Copy AI answer", copiedLabel: "Copied" })
  ));
  assert.match(html, /class="bubble"[^>]*>[\s\S]*The answer\.<\/p><\/div><\/div><button/);
  assert.match(html, /aria-label="Copy AI answer"/);
  assert.match(html, /class="lucide lucide-copy"/);
  assert.doesNotMatch(html, />Copy AI answer<\/button>/);
});

test("TutorAnswer keeps x_1, snake_case_name and 2*3*4, and renders only real emphasis (M22)", async () => {
  const html = await render("COURSE\nUse x_1 and snake_case_name; 2*3*4 = 24 is the **key** point.");
  assert.match(html, /Use x_1 and snake_case_name; 2\*3\*4 = 24 is the <strong>key<\/strong> point\./);
});
