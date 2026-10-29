import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import React, { createElement } from "react";
import { tutorAnswerParts } from "../../modules/group-study/tutorAnswerText";

// The component file uses the automatic JSX runtime under Next; the test
// loader compiles it with the classic one, which reads a global React.
(globalThis as { React?: typeof React }).React = React;
async function render(text: string) {
  const { TutorAnswer } = await import("../../components/portal/TutorAnswer");
  return renderToStaticMarkup(createElement(TutorAnswer, { text, sourcesLabel: "Sources:" }));
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

test("TutorAnswer renders KaTeX, no raw HTML and no images", async () => {
  const html = await render("Power rule $(x^n)'=nx^{n-1}$ <img src=x onerror=alert(1)> ![t](https://e.x/i.png) [Source: Book]");
  assert.match(html, /class="katex"/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/, "raw HTML stays text");
  assert.match(html, /Sources: Book/);
});

test("TutorAnswer keeps x_1, snake_case_name and 2*3*4, and renders only real emphasis (M22)", async () => {
  const html = await render("COURSE\nUse x_1 and snake_case_name; 2*3*4 = 24 is the **key** point.");
  assert.match(html, /Use x_1 and snake_case_name; 2\*3\*4 = 24 is the <strong>key<\/strong> point\./);
});
