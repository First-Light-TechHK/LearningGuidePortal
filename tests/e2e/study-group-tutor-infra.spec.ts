import { expect, test, type Page } from "playwright/test";
import { askTutor, MOCK_TUTOR_REPLY, openLiveRoom, tutorLine } from "./study-group-helpers";

// One regression lock per AI Tutor infra item (tutor infra 2026-10-20,
// lg-tutor/sg-ai-tutor-assessment-2026-10-20.md): the room's Tutor remembers
// the conversation, can look further back with a tool, marks an
// understanding check, falls back to the next model when one is retired,
// tells the asker where a question stands and lets them take it back, and
// greys itself out while the provider is failing. The mock tutor
// (scripts/studygroup-tutor-mock.mjs) drives each case by a marker in the
// question.

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

test("tutor infra: a follow-up is answered with the room's earlier exchange in context", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const room = await openLiveRoom(browser, appOrigin(baseURL), "ti-followup");
  try {
    const { pageA, pageB } = room;
    await pageB.getByRole("tab", { name: "Chat" }).click();
    await askTutor(pageB, "What is ataraxia?");
    await expect(answerTo(pageB, "What is ataraxia?").filter({ hasText: MOCK_TUTOR_REPLY })).toHaveCount(1, { timeout: 60_000 });
    await askTutor(pageB, "[followup] Explain that again");
    await expect(tutorLine(pageB).filter({ hasText: 'Follow-up reply: you asked earlier "What is ataraxia?".' })).toHaveCount(1, { timeout: 60_000 });
    await expect(tutorLine(pageA).filter({ hasText: 'Follow-up reply: you asked earlier "What is ataraxia?".' })).toHaveCount(1, { timeout: 30_000 });
  } finally {
    await room.close();
  }
});

test("tutor infra: the Tutor calls the room history tool and answers from its result", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const room = await openLiveRoom(browser, appOrigin(baseURL), "ti-tool");
  try {
    const { pageB } = room;
    await pageB.getByRole("tab", { name: "Chat" }).click();
    await askTutor(pageB, "What is a katastematic pleasure?");
    await expect(answerTo(pageB, "What is a katastematic pleasure?").filter({ hasText: MOCK_TUTOR_REPLY })).toHaveCount(1, { timeout: 60_000 });
    await askTutor(pageB, "[tool] What have we covered?");
    await expect(tutorLine(pageB).filter({ hasText: 'Tool reply: the room history has 1 exchange(s), first "What is a katastematic pleasure?".' })).toHaveCount(1, { timeout: 60_000 });
  } finally {
    await room.close();
  }
});

test("tutor infra: an understanding check is labelled as one in every browser", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const room = await openLiveRoom(browser, appOrigin(baseURL), "ti-quiz");
  try {
    const { pageA, pageB } = room;
    await pageB.getByRole("tab", { name: "Chat" }).click();
    await pageA.getByRole("tab", { name: "Chat" }).click();
    await askTutor(pageB, "[quiz] Check our understanding");
    for (const page of [pageB, pageA]) {
      const answer = answerTo(page, "[quiz] Check our understanding");
      await expect(answer.filter({ hasText: "Quick check: what does the course text say about pleasure?" })).toHaveCount(1, { timeout: 60_000 });
      await expect(answer.getByText("Understanding check", { exact: true })).toBeVisible();
    }
    // An ordinary answer carries no such label.
    await askTutor(pageB, "What is ataraxia?");
    const plain = answerTo(pageB, "What is ataraxia?").filter({ hasText: MOCK_TUTOR_REPLY });
    await expect(plain).toHaveCount(1, { timeout: 60_000 });
    await expect(plain.getByText("Understanding check", { exact: true })).toHaveCount(0);
  } finally {
    await room.close();
  }
});

test("tutor infra: a retired model is skipped and the next model of the list answers", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const room = await openLiveRoom(browser, appOrigin(baseURL), "ti-gone");
  try {
    const { pageB } = room;
    await pageB.getByRole("tab", { name: "Chat" }).click();
    await askTutor(pageB, "[gone] Which model answers?");
    await expect(tutorLine(pageB).filter({ hasText: "Fallback model reply: the course text explains this topic." })).toHaveCount(1, { timeout: 60_000 });
    await expect(tutorLine(pageB).filter({ hasText: "AI Tutor is temporarily unavailable" })).toHaveCount(0);
  } finally {
    await room.close();
  }
});

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

// Runs last in this file: it trips the per-process circuit breaker on
// purpose and waits for it to close again before it ends, so no later test
// meets a paused Tutor.
test("tutor infra: after repeated provider failures the Tutor is greyed out with the reason, then comes back", async ({ browser, baseURL }) => {
  test.setTimeout(300_000);
  const room = await openLiveRoom(browser, appOrigin(baseURL), "ti-offline");
  try {
    const { pageB } = room;
    await pageB.getByRole("tab", { name: "Chat" }).click();
    for (let index = 1; index <= 3; index += 1) {
      await askTutor(pageB, `[fail] provider failure ${index}`);
      await expect(answerTo(pageB, `[fail] provider failure ${index}`).filter({ hasText: "AI Tutor is temporarily unavailable" })).toHaveCount(1, { timeout: 60_000 });
    }
    const offline = pageB.getByTestId("tutor-offline");
    await expect(offline).toHaveText("AI Tutor is having trouble. Try again in a minute.", { timeout: 45_000 });
    await expect(pageB.getByRole("button", { name: "@AI Tutor", exact: true })).toBeDisabled();
    // The pause ends on its own and the room offers the Tutor again.
    await expect(offline).toHaveCount(0, { timeout: 120_000 });
    await expect(pageB.getByRole("button", { name: "@AI Tutor", exact: true })).toBeEnabled();
    await askTutor(pageB, "Are you back?");
    await expect(answerTo(pageB, "Are you back?").filter({ hasText: MOCK_TUTOR_REPLY })).toHaveCount(1, { timeout: 60_000 });
  } finally {
    await room.close();
  }
});
