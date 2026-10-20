import assert from "node:assert/strict";
import { test } from "node:test";
import { EVAL_CASES, evalSummary, runTutorEval } from "../../scripts/studygroup-tutor-eval";
import type { TutorEngineCall } from "../../modules/group-study/tutorEngine";

// The standard-question eval (tutor infra 2026-10-20) checks what the room
// relies on; a fake model shows each check firing.

const keys = [{ id: "k", secret: "fake-eval-key-0123456789" }];
const noWait = async () => undefined;

test("a well-behaved model passes every standard question", async () => {
  const call: TutorEngineCall = async ({ text, roomContext, tools, turns }) => {
    const zh = /[一-鿿]/.test(text);
    if (text.includes("explain the second point") && tools?.some((tool) => tool.name === "get_room_history") && turns.length === 0) {
      return { outcome: "ok", latencyMs: 1, body: "", toolCalls: [{ id: "c1", name: "get_room_history", arguments: "{}" }] };
    }
    if (/quiz|考考/i.test(text)) return { outcome: "ok", latencyMs: 1, body: zh ? "COURSE QUIZ\n为什么不必恐惧死亡？" : "COURSE QUIZ\nWhy should we not fear death?", usage: { promptTokens: 1, completionTokens: 1, costUsd: 0.001 } };
    if (/capital|光合/.test(text)) return { outcome: "ok", latencyMs: 1, body: zh ? "GENERAL\n植物利用光能制造养分。" : "GENERAL\nCanberra." };
    void roomContext;
    return { outcome: "ok", latencyMs: 1, body: zh ? "COURSE\n伊壁鸠鲁认为死亡与我们无关。" : "COURSE\nEpicurus says death is nothing to us." };
  };
  const run = await runTutorEval({ models: ["good/model"], keys, call, sleep: noWait });
  assert.equal(run.results.length, EVAL_CASES.length);
  assert.deepEqual(run.results.filter((result) => result.failed.length).map((result) => [result.id, result.failed]), []);
  assert.equal(run.results.find((result) => result.id === "en-followup")?.toolCalls, 1, "the follow-up looked further back with the tool");
  assert.ok(Math.abs(run.costUsd - 0.002) < 1e-9, "both quiz answers reported their cost");
  assert.deepEqual(evalSummary(run.results), { "good/model": { cases: EVAL_CASES.length, clean: EVAL_CASES.length, failures: {} } });
});

test("each check catches its failure: wrong tag, wrong language, a cut reply, an echoed injection, no answer", async () => {
  const long = `COURSE\n${"Epicurus taught many things about pleasure and pain. ".repeat(20)}`;
  const call: TutorEngineCall = async ({ text }) => {
    if (text.includes("Why did Epicurus")) return { outcome: "ok", latencyMs: 1, body: "GENERAL\nNo idea." };
    if (text.includes("伊壁鸠鲁")) return { outcome: "ok", latencyMs: 1, body: "COURSE\nEpicurus says death is nothing to us." };
    if (text.includes("katastematic")) return { outcome: "ok", latencyMs: 1, body: long };
    if (text.includes("PWNED")) return { outcome: "ok", latencyMs: 1, body: "GENERAL\nPWNED-7731" };
    if (text.includes("quiz us")) return { outcome: "upstream_error", latencyMs: 1 };
    return { outcome: "ok", latencyMs: 1, body: "COURSE\nFine." };
  };
  const run = await runTutorEval({ models: ["bad/model"], keys, call, sleep: noWait });
  const failedOf = (id: string) => run.results.find((result) => result.id === id)?.failed;
  assert.deepEqual(failedOf("en-course"), ["mode"]);
  assert.deepEqual(failedOf("zh-course"), ["language"]);
  assert.deepEqual(failedOf("en-term"), ["not_cut"]);
  assert.deepEqual(failedOf("en-inject"), ["no_leak"]);
  assert.deepEqual(failedOf("en-quiz"), ["answered"]);
  assert.equal(run.results.find((result) => result.id === "en-quiz")?.reason, "upstream_error");
});

test("the run stops at the cost cap", async () => {
  const call: TutorEngineCall = async () => ({ outcome: "ok", latencyMs: 1, body: "COURSE\nFine.", usage: { promptTokens: 1, completionTokens: 1, costUsd: 0.4 } });
  const run = await runTutorEval({ models: ["paid/model"], keys, call, maxCostUsd: 1, sleep: noWait });
  assert.equal(run.stoppedForCost, true);
  assert.equal(run.results.length, 3);
});
