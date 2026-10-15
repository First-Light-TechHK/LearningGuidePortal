import assert from "node:assert/strict";
import { test } from "node:test";
import { applicationEvaluationProgress, canSubmitApplicationAnswer, getApplicationTestSample, resolveApplicationAttempt } from "../../services/applicationTestSample";
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
    assert.ok(sample.reference.join("\n").includes("2/3"));
    assert.ok(canSubmitApplicationAnswer(sample.sampleAnswer));
  }
});

test("reopening a sample review preserves the submitted response and uses elapsed time", () => {
  const attempt = { answer:"My original answer", phase:"evaluating" as const, startedAt:1000 };
  assert.equal(resolveApplicationAttempt(attempt, 3999), attempt);
  assert.deepEqual(resolveApplicationAttempt(attempt, 4000), { ...attempt, phase:"result" });
  const draft = { answer:"Draft", phase:"answer" as const, startedAt:null };
  assert.equal(resolveApplicationAttempt(draft, 10000), draft);
});
