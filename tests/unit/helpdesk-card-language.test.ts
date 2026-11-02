// Owner 2026-10-31 (DEV): on the English page a learner asked "我如何取消订阅"; the opening and closing came back in
// Chinese, but the FAQ card and its "Related FAQ" title were English, because Portal asked Admin for the card in the
// page's language and read the cached release in that language too. The card now speaks the learner's language: a
// typed question's own words (Chinese -> zh-CN, Latin letters -> en-GB, neither -> the page's), a click the learner's
// newest words in the chat. The chat session, buttons and labels stay in the page's language. When the release in the
// learner's language is not cached, a click falls back to the page's card and frame.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { parseFaqRelease, parseSuggestTurn, type AdminSuggestReply, type AdminSuggestRequest, type AssistantResponse, type AssistantTurnResponse, type FaqRelease, type HelpdeskLocale } from "../../contracts/helpdesk";
import { createAssistantService } from "../../modules/helpdesk/assistant";
import { TURN_TEMPLATES } from "../../modules/helpdesk/assistantTurn";
import { createLocalHelpdeskRepository } from "../../repositories/helpdeskRepository";

let root = "";
before(async () => { root = await mkdtemp(path.join(tmpdir(), "lg-helpdesk-cardlang-")); });
after(async () => { if (root && path.dirname(root) === tmpdir()) await rm(root, { recursive: true, force: true }); });

const fixture = JSON.parse(readFileSync("tests/fixtures/helpdesk-contract.json", "utf8")) as { portalToAdmin: Record<string, Record<string, unknown>> };
const EN_RELEASE = parseFaqRelease(fixture.portalToAdmin.faqReleaseResponse) as FaqRelease;
const id = (n: number) => `01a18100-0000-7000-8000-${String(n).padStart(12, "0")}`;
const PAID = id(22), SUPPORT = id(24);

/** The same release in Chinese: same ids and edges, every learner-facing string translated. */
const ZH_TEXT: Record<string, { question: string; answer: string }> = {
  [id(20)]: { question: "付款遇到问题了？", answer: "是哪一种情况？" },
  [id(21)]: { question: "付款失败了怎么办？", answer: "1. 检查卡片信息和余额\n2. 换一张卡再试" },
  [PAID]: { question: "付了款但会员没有开通", answer: "付款确认可能要几分钟。\n\n1. 刷新**我的学习**\n2. 退出后重新登录" },
  [id(23)]: { question: "再付一次会被扣两次钱吗？", answer: "不会。失败的付款不会从你的账户扣款。" },
  [SUPPORT]: { question: "怎么联系客服？", answer: "打开**联系客服**，选择问题类型后发送。" }
};
const ZH_LABEL: Record<string, string> = {
  [id(21)]: "付款失败了", [PAID]: "付了款但没有开通", [id(23)]: "再付一次会被扣两次钱吗？", [SUPPORT]: "怎么联系客服？"
};
const ZH_RELEASE: FaqRelease = {
  ...structuredClone(EN_RELEASE),
  locale: "zh-CN",
  nodes: EN_RELEASE.nodes.map((node) => ({ ...structuredClone(node), ...ZH_TEXT[node.id], blocks: [{ id: "b1", text: ZH_TEXT[node.id].answer }] })),
  edges: EN_RELEASE.edges.map((edge) => ({ ...edge, label: ZH_LABEL[edge.childId] }))
};
const RELEASES: Record<HelpdeskLocale, FaqRelease> = { "en-GB": EN_RELEASE, "zh-CN": ZH_RELEASE };
const learner = { id: "user-lin", email: "lin@example.com", name: "Lin" };

/** Admin as it behaves: the card in the language it is asked for; no opening or closing of its own (Portal frames it). */
function adminAnswer(input: AdminSuggestRequest): AdminSuggestReply {
  const node = RELEASES[input.locale].nodes.find((one) => one.id === PAID)!;
  const body = { ...structuredClone(fixture.portalToAdmin.suggestAnswerContextResponse), blocks: [], opening: null, closing: null };
  const turn = parseSuggestTurn(body);
  return { suggestion: { id: input.runId, faqId: PAID, question: node.question, answer: node.answer }, alternatives: [], ...(turn ? { turn } : {}) };
}

function harness(cached: FaqRelease[] = [EN_RELEASE, ZH_RELEASE]) {
  const asked: AdminSuggestRequest[] = [];
  const repository = createLocalHelpdeskRepository(path.join(root, randomUUID()));
  const assistant = createAssistantService({
    repository,
    admin: { async suggest() { return null; }, async suggestReply(input: AdminSuggestRequest) { asked.push(input); return adminAnswer(input); }, async reportOutcome() { return true; }, async faqs() { return []; }, async faq() { return null; } },
    now: () => new Date("2026-10-31T16:30:00.000Z"),
    log: () => undefined,
    release: { async current(locale) { return cached.find((one) => one.locale === locale) ?? null; } },
    learnerRecords: async () => ({ user: { email: learner.email, emailVerifiedAt: "2026-01-01T00:00:00.000Z" }, orders: [], subscriptions: [] })
  });
  return { assistant, repository, asked };
}

const card = (response: AssistantResponse) => response.reply;
const turnOf = (response: AssistantResponse) => (response as AssistantTurnResponse).turn;

test("a Chinese question on the English page gets the Chinese card, its Chinese follow-ups and a Chinese frame; the chat stays English", async () => {
  const h = harness();
  const { sessionId } = await h.assistant.startSession(learner, { locale: "en-GB", orderId: null });
  const key = randomUUID();
  const { response } = await h.assistant.ask(learner, { message: "我付款了但是会员没有开通", locale: "en-GB", faqId: null, sessionId }, key);
  assert.equal(h.asked[0].locale, "zh-CN", "Admin is asked for the card in the learner's language");
  assert.equal(card(response)?.question, ZH_TEXT[PAID].question);
  assert.equal(card(response)?.answer, ZH_TEXT[PAID].answer);
  const turn = turnOf(response);
  assert.equal(turn.opening, TURN_TEMPLATES["zh-CN"].opening);
  assert.equal(turn.closing, TURN_TEMPLATES["zh-CN"].closing);
  assert.deepEqual(turn.next?.steps.map((step) => step.label), [ZH_LABEL[SUPPORT]], "the follow-ups come from the Chinese release");
  assert.equal(turn.sessionId, sessionId, "the same chat");
  assert.equal((await h.repository.findChatSession(sessionId))?.locale, "en-GB", "the session keeps the page's language");
  // The Idempotency-Key replay is the same Chinese card
  const again = await h.assistant.ask(learner, { message: "我付款了但是会员没有开通", locale: "en-GB", faqId: null, sessionId }, key);
  assert.equal(again.replayed, true);
  assert.equal(card(again.response)?.question, ZH_TEXT[PAID].question);
  assert.deepEqual(turnOf(again.response).next?.steps.map((step) => step.label), [ZH_LABEL[SUPPORT]]);
});

test("an English question on the Chinese page gets the English card; emoji alone keep the page's language", async () => {
  const h = harness();
  const { sessionId } = await h.assistant.startSession(learner, { locale: "zh-CN", orderId: null });
  const english = await h.assistant.ask(learner, { message: "I paid but my plan is not active", locale: "zh-CN", faqId: null, sessionId }, randomUUID());
  assert.equal(h.asked[0].locale, "en-GB");
  assert.equal(card(english.response)?.question, EN_RELEASE.nodes.find((node) => node.id === PAID)!.question);
  assert.equal(turnOf(english.response).opening, TURN_TEMPLATES["en-GB"].opening);
  const emoji = await h.assistant.ask(learner, { message: "🙏🙏", locale: "zh-CN", faqId: null, sessionId }, randomUUID());
  assert.equal(h.asked[1].locale, "zh-CN");
  assert.equal(card(emoji.response)?.question, ZH_TEXT[PAID].question);
});

test("a click follows the learner's newest words: before any, the page's language; after Chinese on the English page, the Chinese card", async () => {
  const h = harness();
  const { sessionId } = await h.assistant.startSession(learner, { locale: "en-GB", orderId: null });
  const starter = await h.assistant.click(learner, { locale: "en-GB", nodeId: PAID, fromNodeId: null, via: "starter", sessionId, label: null }, randomUUID());
  assert.equal(card(starter.response)?.question, EN_RELEASE.nodes.find((node) => node.id === PAID)!.question, "no words yet: the page's language");
  assert.equal(turnOf(starter.response).opening, TURN_TEMPLATES["en-GB"].opening);
  await h.assistant.ask(learner, { message: "我付款了但是会员没有开通", locale: "en-GB", faqId: null, sessionId }, randomUUID());
  const followUp = await h.assistant.click(learner, { locale: "en-GB", nodeId: SUPPORT, fromNodeId: PAID, via: "follow_up", sessionId, label: null }, randomUUID());
  assert.equal(card(followUp.response)?.question, ZH_TEXT[SUPPORT].question);
  assert.equal(card(followUp.response)?.answer, ZH_TEXT[SUPPORT].answer);
  assert.equal(turnOf(followUp.response).opening, TURN_TEMPLATES["zh-CN"].opening);
});

test("a click falls back to the page's card and frame when the release in the learner's language is not cached", async () => {
  const h = harness([EN_RELEASE]);
  const { sessionId } = await h.assistant.startSession(learner, { locale: "en-GB", orderId: null });
  await h.assistant.ask(learner, { message: "我付款了但是会员没有开通", locale: "en-GB", faqId: null, sessionId }, randomUUID());
  const followUp = await h.assistant.click(learner, { locale: "en-GB", nodeId: SUPPORT, fromNodeId: PAID, via: "follow_up", sessionId, label: null }, randomUUID());
  assert.equal(card(followUp.response)?.question, EN_RELEASE.nodes.find((node) => node.id === SUPPORT)!.question);
  assert.equal(turnOf(followUp.response).opening, TURN_TEMPLATES["en-GB"].opening);
});

test("another learner's chat never decides the language of a click", async () => {
  const h = harness();
  const other = { id: "user-other", email: "other@example.com", name: "Other" };
  const theirs = await h.assistant.startSession(other, { locale: "en-GB", orderId: null });
  await h.assistant.ask(other, { message: "我付款了但是会员没有开通", locale: "en-GB", faqId: null, sessionId: theirs.sessionId }, randomUUID());
  const mine = await h.assistant.click(learner, { locale: "en-GB", nodeId: PAID, fromNodeId: null, via: "starter", sessionId: theirs.sessionId, label: null }, randomUUID());
  assert.equal(card(mine.response)?.question, EN_RELEASE.nodes.find((node) => node.id === PAID)!.question);
});
