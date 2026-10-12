import assert from "node:assert/strict";
import { test } from "node:test";
import { courseQuestionTerms, retrieveCourseKnowledge } from "../../modules/group-study/tutorAnswer";

// PRD v0.10 conformance for the tutor's lexical retrieval:
// - TC-042: a participant supplies a topic in text and the tutor can respond,
//   in both locales. A contiguous Chinese sentence carries no spaces, so it
//   must be expanded into overlapping bigrams — matching the whole sentence as
//   one term can never be found in the course text.
// - 6.11 / TC-040: an understanding-check request must reach the grounded
//   pipeline instead of being refused because of its framing words.
// - The refusal rule stays intact: a topic the course text does not cover must
//   still produce no context.

const CORPUS = [
  "Aristotle was a student of Plato and founded the Lyceum. His lectures on ethics describe eudaimonia as the highest good.",
  "亚里士多德是古希腊哲学家，师从柏拉图，并创立了吕克昂学园。他的伦理学讲座把幸福描述为最高的善。"
].join("\n\n");

test("an unspaced Chinese question retrieves the covered context", () => {
  const terms = courseQuestionTerms("亚里士多德是谁？");
  assert.equal(terms.some((term) => term.length === 1), false);
  assert.notEqual(retrieveCourseKnowledge(CORPUS, "亚里士多德是谁？"), "");
});

test("a polite Chinese request retrieves the covered context", () => {
  assert.notEqual(retrieveCourseKnowledge(CORPUS, "请介绍一下亚里士多德"), "");
});

test("a Chinese topic the course text does not cover is refused", () => {
  assert.equal(retrieveCourseKnowledge(CORPUS, "量子力学是什么？"), "");
});

test("an English understanding-check request reaches the grounded context", () => {
  const context = retrieveCourseKnowledge(CORPUS, "give us an understanding check question about Aristotle");
  assert.notEqual(context, "");
  assert.equal(context.includes("Aristotle"), true);
});

test("an English topic the course text does not cover is still refused", () => {
  assert.equal(retrieveCourseKnowledge(CORPUS, "what does the course say about quantum mechanics"), "");
});
