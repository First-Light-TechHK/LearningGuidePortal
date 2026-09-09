import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSystemPrompt } from "../../lib/chatSystemPrompt";

// Break: /api/chat treating client knowledgePack as trusted prompt input
// (LEARN-05 / SEC-KS-001). Phase 1: browser must not upload a pack.

test("LEARN-05: client knowledgePack is not copied into the system prompt", async () => {
  const prompt = await buildSystemPrompt({
    topic: "Epicureanism",
    mode: "lecture",
    prompts: { base: "base", lecture: "lecture", socratic: "socratic" },
    knowledgePack: { evil: "ATTACK_PACK_MUST_NOT_APPEAR" },
    sources: "ATTACK_SOURCE_MUST_NOT_APPEAR",
  });
  assert.equal(prompt.includes("ATTACK_PACK_MUST_NOT_APPEAR"), false);
  assert.equal(prompt.includes("ATTACK_SOURCE_MUST_NOT_APPEAR"), false);
});
