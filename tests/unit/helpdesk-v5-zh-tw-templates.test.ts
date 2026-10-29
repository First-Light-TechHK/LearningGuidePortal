// Helpdesk v5 open issue: Portal's own fallback templates were zh-CN only, so a
// learner writing Traditional Chinese got Simplified copy whenever Portal
// refused one of Admin's short lines or framed a click. Portal now picks the
// template language exactly as Admin's guard does (workflow/guard.ts
// learnerOf): Chinese characters with a Traditional-only one -> zh-TW,
// Chinese -> zh-CN, Latin letters only -> English, neither (emoji, punctuation)
// -> the page's language. A click (no text) in the zh-CN chat follows the
// learner's own last words in the session. The zh-TW strings are Admin's.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { parseFaqRelease, parseSuggestTurn, type AdminSuggestReply, type AdminSuggestRequest, type AssistantTurnResponse, type FaqRelease } from "../../contracts/helpdesk";
import { createAssistantService } from "../../modules/helpdesk/assistant";
import { TURN_TEMPLATES, frameVariant, replyTemplate, screenTurnText, templateVariant } from "../../modules/helpdesk/assistantTurn";
import { createLocalHelpdeskRepository } from "../../repositories/helpdeskRepository";

let root = "";
before(async () => { root = await mkdtemp(path.join(tmpdir(), "lg-helpdesk-zhtw-")); });
after(async () => { if (root && path.dirname(root) === tmpdir()) await rm(root, { recursive: true, force: true }); });

const fixture = JSON.parse(readFileSync("tests/fixtures/helpdesk-contract.json", "utf8")) as { portalToAdmin: Record<string, Record<string, unknown>> };
const EN_RELEASE = parseFaqRelease(fixture.portalToAdmin.faqReleaseResponse) as FaqRelease;
const ZH_RELEASE: FaqRelease = { ...structuredClone(EN_RELEASE), locale: "zh-CN" };
const id = (n: number) => `01a18100-0000-7000-8000-${String(n).padStart(12, "0")}`;
const CHOICE = id(20), FAILED = id(21);
const learner = { id: "user-mei", email: "mei@example.com", name: "Chen Mei" };

/** Admin's zh-TW templates (learningguideadmin server/src/ai/helpdesk/workflow/guard.ts TEMPLATES), word for word. */
const ADMIN_ZH_TW = {
  greeting: "你好！遇到什麼問題了？可以直接告訴我，或者看看下面這些常見情況。",
  farewell: "不客氣！之後有問題隨時來問我。",
  offTopic: "這個我幫不上忙。關於 Learning Guide 的使用、課程或訂閱，隨時問我。",
  opening: "好的，這個問題可以這樣處理：",
  closing: "還有不清楚的，接著問我就好。"
};

test("the template language follows the learner's own text, as Admin's guard decides it", () => {
  assert.equal(templateVariant("你好，付款失败怎么办", "zh-CN"), "zh-CN");
  assert.equal(templateVariant("請問付款失敗怎麼辦", "zh-CN"), "zh-TW");
  assert.equal(templateVariant("謝謝", "en-GB"), "zh-TW", "Chinese in the English chat gets Chinese copy");
  assert.equal(templateVariant("你好", "en-GB"), "zh-CN");
  assert.equal(templateVariant("hello", "zh-CN"), "en-GB", "Latin letters only: English, like Admin");
  assert.equal(templateVariant("我的email收不到", "zh-CN"), "zh-CN", "mixed Chinese and English is Chinese");
  assert.equal(templateVariant("👍🙏", "zh-CN"), "zh-CN");
  assert.equal(templateVariant("？？", "en-GB"), "en-GB");
  assert.equal(templateVariant("什么时候著名的乾隆后来头发", "zh-CN"), "zh-CN", "characters both scripts use are not Traditional");
  // A click has no text: the zh-CN chat follows the learner's last words; the English chat stays English (its cards are English).
  assert.equal(frameVariant("zh-CN", ["你好", "我的帳號登不進去"]), "zh-TW");
  assert.equal(frameVariant("zh-CN", ["我的帳號登不進去", "好的谢谢"]), "zh-CN", "the newest words decide");
  assert.equal(frameVariant("zh-CN", ["ok", "👍"]), "zh-CN", "no Chinese at all: the page's language");
  assert.equal(frameVariant("zh-CN", []), "zh-CN");
  assert.equal(frameVariant("en-GB", ["請問"]), "en-GB");
});

test("the zh-TW templates are Admin's, every template passes Portal's own check, and each intent has its line", () => {
  assert.deepEqual(TURN_TEMPLATES["zh-TW"], ADMIN_ZH_TW);
  for (const variant of ["en-GB", "zh-CN", "zh-TW"] as const) {
    const copy = TURN_TEMPLATES[variant];
    assert.equal(screenTurnText("opening", copy.opening).text, copy.opening);
    assert.equal(screenTurnText("closing", copy.closing).text, copy.closing);
    for (const line of [copy.greeting, copy.farewell, copy.offTopic]) assert.equal(screenTurnText("reply", line).text, line, `${variant}: ${line}`);
  }
  assert.equal(replyTemplate("zh-TW", "farewell"), ADMIN_ZH_TW.farewell);
  assert.equal(replyTemplate("zh-TW", "off_topic"), ADMIN_ZH_TW.offTopic);
  assert.equal(replyTemplate("zh-TW", "vague"), ADMIN_ZH_TW.greeting);
  assert.equal(replyTemplate("zh-CN", "greeting"), TURN_TEMPLATES["zh-CN"].greeting, "zh-CN unchanged");
  assert.ok(Object.values(ADMIN_ZH_TW).every((line) => templateVariant(line, "zh-CN") === "zh-TW"), "the zh-TW copy is itself Traditional");
  assert.ok([TURN_TEMPLATES["zh-CN"].greeting, TURN_TEMPLATES["zh-CN"].farewell, TURN_TEMPLATES["zh-CN"].offTopic, TURN_TEMPLATES["zh-CN"].opening, TURN_TEMPLATES["zh-CN"].closing].every((line) => templateVariant(line, "zh-CN") === "zh-CN"));
});

function reply(name: string, input: AdminSuggestRequest, patch: Record<string, unknown> = {}): AdminSuggestReply {
  const body = { ...structuredClone(fixture.portalToAdmin[name]), ...patch };
  const suggestion = body.suggestion as Record<string, unknown> | null;
  if (suggestion) suggestion.id = input.runId;
  const turn = parseSuggestTurn(body);
  return { suggestion: suggestion as AdminSuggestReply["suggestion"], alternatives: (body.alternatives as AdminSuggestReply["alternatives"]) ?? [], ...(turn ? { turn } : {}) };
}

function harness(answer: (input: AdminSuggestRequest) => AdminSuggestReply, release: FaqRelease | null = ZH_RELEASE) {
  const repository = createLocalHelpdeskRepository(path.join(root, randomUUID()));
  const assistant = createAssistantService({
    repository,
    admin: { async suggest() { return null; }, async suggestReply(input: AdminSuggestRequest) { return answer(input); }, async reportOutcome() { return true; }, async faqs() { return []; }, async faq() { return null; } },
    now: () => new Date("2026-10-30T09:00:00.000Z"),
    log: () => undefined,
    release: { async current(locale) { return release && release.locale === locale ? release : null; } },
    learnerRecords: async () => ({ user: { email: learner.email, emailVerifiedAt: "2026-01-01T00:00:00.000Z" }, orders: [], subscriptions: [] })
  });
  return { assistant, repository };
}

const turnOf = (response: unknown) => (response as AssistantTurnResponse).turn;
const ask = (message: string, sessionId: string | null = null) => ({ message, locale: "zh-CN" as const, faqId: null, sessionId });

test("a refused small-talk line becomes the zh-TW template when the learner writes Traditional Chinese (zh-CN for Simplified, as before)", async () => {
  const h = harness((input) => reply("suggestSmalltalkResponse", input, { intent: "farewell", reply: "謝謝！**再見** 1" }));
  assert.equal(turnOf((await h.assistant.ask(learner, ask("謝謝你的幫忙"), randomUUID())).response).reply, ADMIN_ZH_TW.farewell);
  assert.equal(turnOf((await h.assistant.ask(learner, ask("谢谢你的帮忙"), randomUUID())).response).reply, TURN_TEMPLATES["zh-CN"].farewell);
  const offTopic = harness((input) => reply("suggestSmalltalkResponse", input, { intent: "off_topic", reply: "Visit https://evil.example" }));
  assert.equal(turnOf((await offTopic.assistant.ask(learner, ask("今天天氣怎麼樣"), randomUUID())).response).reply, ADMIN_ZH_TW.offTopic);
  const stored = await offTopic.repository.findAssist((await offTopic.assistant.ask(learner, ask("講個笑話"), randomUUID())).response.id);
  assert.equal(stored?.texts?.reply, ADMIN_ZH_TW.offTopic, "the replay shows the same line");
});

test("a refused opening or closing of a typed answer is framed in zh-TW for a Traditional question", async () => {
  const h = harness((input) => {
    const answer = reply("suggestAnswerContextResponse", input);
    return { ...answer, turn: { ...answer.turn!, opening: "請看 https://evil.example", closing: "三天內處理。" } };
  });
  const turn = turnOf((await h.assistant.ask(learner, ask("我付款了但是沒有開通"), randomUUID())).response);
  assert.equal(turn.opening, ADMIN_ZH_TW.opening);
  assert.equal(turn.closing, ADMIN_ZH_TW.closing);
});

test("a click is framed in zh-TW after the learner wrote Traditional Chinese in this session, in zh-CN otherwise; the English chat stays English", async () => {
  const h = harness((input) => reply("suggestChoiceResponse", input));
  const { sessionId } = await h.assistant.startSession(learner, { locale: "zh-CN", orderId: null });
  const fresh = await h.assistant.click(learner, { locale: "zh-CN", nodeId: FAILED, fromNodeId: null, via: "signal", sessionId, label: null }, randomUUID());
  assert.equal(turnOf(fresh.response).opening, TURN_TEMPLATES["zh-CN"].opening, "no words yet: the page's language");
  await h.assistant.ask(learner, ask("付款有問題", sessionId), randomUUID());
  const option = await h.assistant.click(learner, { locale: "zh-CN", nodeId: FAILED, fromNodeId: CHOICE, via: "option", sessionId, label: null }, randomUUID());
  assert.equal(turnOf(option.response).opening, ADMIN_ZH_TW.opening);
  assert.equal(turnOf(option.response).closing, ADMIN_ZH_TW.closing);
  const english = harness((input) => reply("suggestChoiceResponse", input), EN_RELEASE);
  const en = await english.assistant.startSession(learner, { locale: "en-GB", orderId: null });
  await english.assistant.ask(learner, { message: "付款有問題", locale: "en-GB", faqId: null, sessionId: en.sessionId }, randomUUID());
  const enOption = await english.assistant.click(learner, { locale: "en-GB", nodeId: FAILED, fromNodeId: CHOICE, via: "option", sessionId: en.sessionId, label: null }, randomUUID());
  assert.equal(turnOf(enOption.response).opening, TURN_TEMPLATES["en-GB"].opening);
});

test("a chip through Admin's per-FAQ path (no release yet) is framed in zh-TW after Traditional words in the session", async () => {
  const h = harness((input) => (input.faqId ? { suggestion: { id: input.runId, faqId: input.faqId, question: "付款失敗怎麼辦", answer: "請更換付款方式。" }, alternatives: [] } : { suggestion: null, alternatives: [] }), null);
  const { sessionId } = await h.assistant.startSession(learner, { locale: "zh-CN", orderId: null });
  await h.assistant.ask(learner, ask("請問怎麼付款", sessionId), randomUUID());
  const chip = await h.assistant.ask(learner, { message: "付款失敗怎麼辦", locale: "zh-CN", faqId: FAILED, sessionId, via: "starter" }, randomUUID());
  assert.equal(turnOf(chip.response).opening, ADMIN_ZH_TW.opening);
});
