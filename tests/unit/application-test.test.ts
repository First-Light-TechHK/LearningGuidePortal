import assert from "node:assert/strict";
import { test } from "node:test";
import { applicationEvaluationProgress, canSubmitApplicationAnswer, getApplicationTestSample } from "../../services/applicationTestSample";
test("sample application assessment requires a nonblank bounded answer and reaches 100% in three seconds", () => {
  assert.equal(canSubmitApplicationAnswer(" \n "),false);
  assert.equal(canSubmitApplicationAnswer("x".repeat(2000)),true);
  assert.equal(canSubmitApplicationAnswer("x".repeat(2001)),false);
  assert.equal(applicationEvaluationProgress(-10),0);
  assert.equal(applicationEvaluationProgress(1500),50);
  assert.equal(applicationEvaluationProgress(2999)<100,true);
  assert.equal(applicationEvaluationProgress(3000),100);
  assert.equal(applicationEvaluationProgress(10000),100);
  for(const locale of ["en-GB","zh-CN"] as const) {
    const sample=getApplicationTestSample(locale);
    assert.equal(sample.id,"sample-hawks-doves");assert.equal(sample.paragraphs.length,4);
    assert.ok(sample.strengths);assert.ok(sample.improvement);
  }
});
