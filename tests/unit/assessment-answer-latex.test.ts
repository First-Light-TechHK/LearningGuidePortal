import assert from "node:assert/strict";
import { test } from "node:test";
import { answerDocument, documentAnswer, needsAnswerSource } from "../../lib/assessmentAnswerDocument";

test("existing LaTeX selects visual mode without changing its saved source", () => {
  for (const source of [String.raw`\frac{2}{3}`, String.raw`x = \frac{2}{3}`, "    \\[\\frac{2}{3}\\]\r\n", "$$\n    x_{__a} + |x|\n$$", "Answer:\r\n\\(x^2\\)", "\\begin{pmatrix}\n1&2\\\\\n3&4\n\\end{pmatrix}", String.raw`Before $$x^2$$ after`]) {
    assert.equal(needsAnswerSource(source), false, source);
    const doc = answerDocument(source);
    assert.equal(documentAnswer(doc), source);
    for (const node of doc.content || []) if (node.type === "paragraph") assert.ok(node.content?.every(child => child.type !== "blockMath"));
  }
  assert.equal(answerDocument(String.raw`\frac{2}{3}`).content![0].type, "blockMath");
  for (const source of ["$5 and $10", "A normal sentence", String.raw`Answer is \frac{2}{3}`, String.raw`\frac{2}{`, "x^2"]) {
    assert.ok(answerDocument(source).content!.every(node=>node.type === "paragraph" && node.content?.every(child=>child.type === "text")));
  }
  assert.equal(needsAnswerSource("**Important**\n\\(x^2\\)"), true);
});
