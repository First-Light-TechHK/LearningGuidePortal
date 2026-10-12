import assert from "node:assert/strict";
import { test } from "node:test";
import { reviewKnowledgeResponses } from "../../lib/knowledgeTest";
import { getKnowledgeTestSamples } from "../../lib/knowledgeTestSamples";
test("self-assessment groups six distinct cards, computes actual score and detects unanswered ratings", () => {
  for (const locale of ["en-GB", "zh-CN"] as const) {
    const questions = getKnowledgeTestSamples(locale);
    assert.equal(questions.length, 6); assert.equal(new Set(questions.map(q => q.id)).size, 6);
    const result = reviewKnowledgeResponses(questions.map((_, i) => ({ answer: "", rating: i % 2 ? "wrong" : "right" })));
    assert.deepEqual(result, { strong: [0,2,4], needsReview: [1,3,5], percent: 50, complete: true });
  }
  assert.equal(reviewKnowledgeResponses([{ answer:"test", rating:null }]).complete, false);
  assert.deepEqual(reviewKnowledgeResponses([]), { strong:[], needsReview:[], percent:0, complete:false });
  assert.equal(reviewKnowledgeResponses([{answer:"",rating:"right"}]).percent,100);
  assert.equal(reviewKnowledgeResponses([{answer:"",rating:"wrong"}]).percent,0);
});
