import { expect, test, type Page } from "playwright/test";
import { askTutor, MOCK_TUTOR_REPLY, openLiveRoom } from "./study-group-helpers";

// Room AI Tutor queue lock (tutor infra 2026-10-20): the asker sees where a
// waiting question stands and can take it back. The mock tutor
// (scripts/studygroup-tutor-mock.mjs) answers "[slow]" late.
//
// The other infra locks that lived here (room memory follow-up, the
// get_room_history tool, the understanding-check label, model fallback and the
// provider circuit breaker) tested Portal's own answer engine
// (modules/group-study/tutorEngine.ts, tutorHealth.ts, tutorTools.ts). That
// engine was removed when the room Tutor moved to KnowledgeSystem (8b5f17e,
// 2026-10-23); answering, memory, tools, model choice and failure handling are
// KnowledgeSystem's now, and Portal only reports "offline" (see the
// KS offline locks in study-group-bug-regressions.spec.ts and study-group-ai-tutor-switch-1104.spec.ts).

test.skip(Boolean(process.env.CI), "local-only Study Group E2E; CI does not run e2e");

function appOrigin(baseURL: string | undefined) {
  return baseURL || "http://127.0.0.1:3013";
}

function answerTo(page: Page, question: string) {
  return page.locator("article").filter({ has: page.locator('strong:text-is("AI Tutor")') }).filter({ hasText: question });
}

function questionLine(page: Page, question: string) {
  return page.locator("article").filter({ hasText: question }).filter({ hasNot: page.locator('strong:text-is("AI Tutor")') });
}

test("tutor infra: a waiting question shows how many come first and can be withdrawn", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const room = await openLiveRoom(browser, appOrigin(baseURL), "ti-withdraw");
  try {
    const { pageA, pageB } = room;
    await pageB.getByRole("tab", { name: "Chat" }).click();
    await askTutor(pageB, "[slow] first slow question");
    await expect(pageB.getByText("AI Tutor is answering…")).toBeVisible({ timeout: 30_000 });
    await askTutor(pageB, "second waiting question");
    // The question being answered has no Withdraw; the waiting one has.
    await expect(pageB.getByText("Waiting for AI Tutor — 1 ahead")).toBeVisible({ timeout: 30_000 });
    const withdraw = pageB.getByRole("button", { name: "Withdraw" });
    await expect(withdraw).toHaveCount(1);
    await withdraw.click();
    await expect(questionLine(pageB, "second waiting question").getByText("Question withdrawn.")).toBeVisible();
    await expect(answerTo(pageB, "[slow] first slow question").filter({ hasText: MOCK_TUTOR_REPLY })).toHaveCount(1, { timeout: 60_000 });
    await pageB.waitForTimeout(5_000);
    await expect(answerTo(pageB, "second waiting question").filter({ hasText: MOCK_TUTOR_REPLY }), "a withdrawn question is never answered").toHaveCount(0);
    await expect(answerTo(pageA, "second waiting question").filter({ hasText: MOCK_TUTOR_REPLY })).toHaveCount(0);
  } finally {
    await room.close();
  }
});
