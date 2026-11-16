import assert from "node:assert/strict";
import { test } from "node:test";
import { answerDocument, documentAnswer, needsAnswerSource } from "../../lib/assessmentAnswerDocument";

test("answer document preserves prose, blank lines, delimiters, currency and multiline equations", () => {
  for (const text of ["", "中文 answer\n\nNext line\n", String.raw`The result is \(\frac{2}{3}\).`, "$x^2$ and $5 and $10", "Before\n\\[\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}\\]\nAfter", "Before\n$$\nx^2\n$$\nAfter"]) {
    assert.equal(documentAnswer(answerDocument(text)), text);
  }
});
test("editing math replaces its original source and retains surrounding prose", () => {
  const doc = answerDocument(String.raw`Answer: $x^2$.`);
  const math = doc.content![0].content!.find(node => node.type === "inlineMath")!;
  math.attrs!.latex = "x^3";
  assert.equal(documentAnswer(doc), String.raw`Answer: \(x^3\).`);
  assert.ok(needsAnswerSource("| A | B |\n|---|---|"));
  assert.ok(needsAnswerSource("`$x$`"));
  assert.ok(needsAnswerSource("**important**"));
  assert.equal(needsAnswerSource(String.raw`Answer: \(x^2\).`), false);
});
