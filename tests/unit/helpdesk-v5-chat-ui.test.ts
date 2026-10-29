// Helpdesk v5 in Chromium: the chat panel (components/helpdesk/AssistantChat.tsx) renders the
// server's turn (helpdesk-v5-context-chips-and-smalltalk.md Parts A, B, C, D, H and
// helpdesk-v5-faq-graph-design.md §1, §4). The panel never asks the model and never shows model
// text as Markdown:
// 1. the greeting is personal and shows the session's situation chips ("You might be running into"
//    when a signal matched, else "Try asking"), and the fixed card for an enquiry waiting for the
//    learner; a chip of the release is a click (no model), without a release the per-FAQ ask;
// 2. an answer is opening, the quoted excerpt (verbatim blocks, source line, "Show the full answer"
//    in place, reported once, "Open in Help Centre"), closing, follow-up chips, vote, in that order
//    for screen readers too; a short answer is shown whole with no expand;
// 3. a choice card shows its prompt and A/B/C/D options; options and follow-ups are clicks with the
//    card they sit on (a 3-level chain);
// 4. small talk is a reply line (hello: the chips follow; thanks after an answer: the rating card);
// 5. an explanation shows "Explained from <question>", which shows the card again, and votes; one the
//    card does not cover is the fixed line and the handover card;
// 6. the Part C polish (accent outline pills, glow, lift, soft shadows, the send button inside the
//    box) with sizes unchanged and no lift or transition under reduced motion;
// 7. an end tells the server and starts the next session, whose chips replace the greeting's.
// No Figma frame for any of these: 待视觉验收.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import type { AssistantTurn } from "../../contracts/helpdesk";
import { getMessages } from "../../lib/i18n/messages";
import { CHAT_SESSION_RULES } from "../../modules/helpdesk/chatSession";
import { fillTemplate } from "../../modules/helpdesk/learnerUi";
import { LOCALES, isAssistant, isAssistantClick, isAssistantFeedback, isAssistantRating, isExpanded, isSessionEnd, isSessionStart, mountContact, mountHelp, openHarness, waitForCalls, type ApiCall, type ChatSessionProp, type Handler, type Harness, type Locale, type Reply } from "./helpers/helpdesk-browser";

let browser: Browser;
before(async () => { browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined }); });
after(async () => { await browser?.close(); });

const id = (n: number) => `01a18500-0000-7000-8000-${String(n).padStart(12, "0")}`;
const SESSION = id(900);
const ROLLED = id(901);
const NEXT_SESSION = id(902);
const TICKET = id(950);
const NODE = { payment: id(101), reset: id(102), choice: id(103), failed: id(104), charged: id(105), twice: id(106), wait: id(107), stillNot: id(108), contact: id(109) };
const BLOCKS = [
  { id: "b1", text: "If you were charged but cannot open the course, it is usually still being confirmed." },
  { id: "b2", text: "1. Sign out and sign in again\n2. Open **My Learning**" },
  { id: "b3", text: "Still nothing after ten minutes? Check **Payment records**." },
  { id: "b4", text: "If it shows paid and you still have no access, contact support with the order." }
];
const LONG_ANSWER = BLOCKS.map((block) => block.text).join("\n\n");

const count = (calls: ApiCall[], predicate: (call: ApiCall) => boolean) => calls.filter(predicate).length;

function turn(kind: AssistantTurn["kind"], extra: Partial<AssistantTurn> = {}): AssistantTurn {
  return {
    kind, intent: kind === "answer" ? "question" : null, via: "typed", nodeId: null, nodeType: null, opening: null, closing: null, reply: null, explanation: null, covered: null,
    excerpt: null, next: null, source: null, releaseVersion: 2, sessionId: SESSION, turnIndex: 1, unsolved: kind === "no_match", countsAsQuestion: kind === "answer" || kind === "no_match", ...extra
  };
}

/** A server answer: the v3 fields plus the v5 turn. */
function answer(assist: string, node: string, question: string, text: string, extra: Partial<AssistantTurn> = {}): Reply {
  return { json: { id: assist, reply: { id: assist, faqId: node, question, answer: text }, alternatives: [], turn: turn("answer", { nodeId: node, nodeType: "answer", opening: "Don't worry, here's how:", closing: "Try that and tell me how it goes.", ...extra }) } };
}

function session(locale: Locale, extra: Partial<ChatSessionProp> = {}): ChatSessionProp {
  return {
    sessionId: SESSION, situational: true, waitingTicket: null, releaseVersion: 2,
    chips: [
      { id: NODE.payment, question: locale === "zh-CN" ? "付款失败怎么办？" : "What if my payment failed?", reason: "signal" },
      { id: NODE.reset, question: locale === "zh-CN" ? "如何重置密码？" : "How do I reset my password?", reason: "popular" }
    ],
    ...extra
  };
}

function ui(page: Page, locale: Locale) {
  const all = getMessages(locale).helpdesk;
  const copy = all.chat;
  const panel = page.getByRole("region", { name: copy.title });
  return {
    all, copy, panel,
    input: panel.getByRole("textbox", { name: copy.inputLabel }),
    send: panel.getByRole("button", { name: copy.send, exact: true }),
    answers: panel.locator(".helpdesk-chat-answer"),
    live: panel.locator(".helpdesk-chat-live"),
    handovers: panel.getByRole("group", { name: copy.handoverTitle, exact: true }),
    ratingCards: panel.getByRole("group", { name: all.assistant.rateTitle, exact: true })
  };
}

async function open(locale: Locale, handler: Handler, props: Partial<Parameters<typeof mountContact>[1]> = {}): Promise<Harness> {
  const harness = await openHarness(browser, locale, handler);
  await mountContact(harness.page, { locale, session: session(locale), ...props });
  return harness;
}

/** Types one message and waits until its reply is in. */
async function say(harness: Harness, locale: Locale, message: string) {
  const c = ui(harness.page, locale);
  const before = await c.panel.locator("[data-entry]").count();
  await c.input.fill(message);
  await c.input.press("Enter");
  await harness.page.waitForFunction((n) => document.querySelectorAll(".helpdesk-chat-messages [data-entry]").length >= n + 2 && !document.querySelector(".helpdesk-chat-typing"), before);
}

async function settled(page: Page, answers: number) {
  await page.waitForFunction((n) => document.querySelectorAll(".helpdesk-chat-answer").length >= n && !document.querySelector(".helpdesk-chat-typing"), answers);
}

test("v5 greeting: personal title, the session's situation chips under their title, the waiting-enquiry card; a release chip is a click, a per-FAQ chip asks with the session", async () => {
  for (const locale of LOCALES) {
    const harness = await open(locale, (call) => (isAssistantClick(call) ? answer(id(1), NODE.payment, "Q", "A.", { via: "signal", opening: null, closing: null }) : isAssistant(call) ? answer(id(2), NODE.reset, "Q", "A.", { via: "starter", releaseVersion: null }) : { status: 500 }),
      { session: session(locale, { waitingTicket: { id: TICKET, number: "LG-261030-0001" } }) });
    const { page } = harness;
    const c = ui(page, locale);
    assert.equal(await c.panel.locator(".helpdesk-chat-greeting-title").textContent(), fillTemplate(c.copy.greetingTitleNamed, { name: "Emily" }), "the learner's first name");
    const chips = c.panel.getByRole("list", { name: c.copy.situationTitle, exact: true }).getByRole("button");
    assert.deepEqual(await chips.allTextContents(), session(locale).chips.map((chip) => chip.question), "a signal matched: “You might be running into”");
    const waiting = c.panel.getByRole("group", { name: c.copy.waitingTitle, exact: true });
    assert.equal(await waiting.getByRole("link", { name: c.copy.waitingLink }).getAttribute("href"), `/${locale}/account/my-learning/support/${TICKET}`, "the fixed card links the enquiry");
    assert.equal(await waiting.textContent().then((value) => value?.includes("LG-261030-0001")), false, "the card is fixed copy");
    assert.equal(harness.calls.length, 0, "the page started the session: nothing is asked on load");
    await chips.first().click();
    await waitForCalls(harness, (calls) => count(calls, isAssistantClick) === 1);
    assert.deepEqual(harness.calls.find(isAssistantClick)!.json, { locale, nodeId: NODE.payment, fromNodeId: null, via: "signal", sessionId: SESSION, label: session(locale).chips[0].question }, "a release chip is a click, never the model");
    assert.equal(count(harness.calls, isAssistant), 0);
    await page.close();

    // No name, no signal, no release: "Try asking", and the chip asks Admin's per-FAQ way with the session.
    const plain = await open(locale, (call) => (isAssistant(call) ? answer(id(2), NODE.reset, "Q", "A.", { via: "starter", releaseVersion: null }) : { status: 500 }),
      { account: { id: "user_anon", name: "", email: "anon@example.com" }, session: session(locale, { situational: false, releaseVersion: null, chips: [{ ...session(locale).chips[1] }] }) });
    const p = ui(plain.page, locale);
    assert.equal(await p.panel.locator(".helpdesk-chat-greeting-title").textContent(), p.copy.greetingTitle, "no name: the greeting without one");
    assert.equal(await p.panel.getByRole("list", { name: p.copy.tryAsking, exact: true }).getByRole("button").count(), 1);
    assert.equal(await p.panel.getByRole("group", { name: p.copy.waitingTitle }).count(), 0);
    await p.panel.locator(".helpdesk-chat-chip").first().click();
    await waitForCalls(plain, (calls) => count(calls, isAssistant) === 1);
    assert.deepEqual(plain.calls.find(isAssistant)!.json, { message: session(locale).chips[1].question, locale, faqId: NODE.reset, sessionId: SESSION, via: "starter" });
    assert.equal(count(plain.calls, isAssistantClick), 0);
    await plain.page.close();
  }
});

test("v5 Part H: opening, the quoted excerpt with its source, closing, follow-ups and the vote, in that order; Show the full answer opens it in place and is reported once; a short answer is whole", async () => {
  for (const locale of LOCALES) {
    const replies: Reply[] = [
      answer(id(1), NODE.payment, "Paid but no access?", LONG_ANSWER, { sessionId: ROLLED, excerpt: [BLOCKS[1], BLOCKS[2]], next: { kind: "follow_up", steps: [{ nodeId: NODE.wait, label: "How long does it take?" }, { nodeId: NODE.stillNot, label: "Still no access?" }] } }),
      answer(id(2), NODE.reset, "How do I reset my password?", "Open **Settings** and choose Reset.", { sessionId: ROLLED })
    ];
    const harness = await open(locale, (call) => (isAssistant(call) ? replies.shift() ?? { status: 500 } : isExpanded(call) ? { json: { id: id(1), expanded: true } } : { status: 500 }));
    const { page } = harness;
    const c = ui(page, locale);
    await say(harness, locale, "I paid but can't open the course");
    assert.deepEqual(harness.calls.find(isAssistant)!.json, { message: "I paid but can't open the course", locale, sessionId: SESSION }, "a typed question carries the page's session");
    const bubble = c.answers.first();
    const parts = await bubble.evaluate((node) => [...node.children].map((child) => child.className || child.tagName.toLowerCase()));
    assert.deepEqual(parts, ["helpdesk-chat-opening", "helpdesk-chat-excerpt", "helpdesk-chat-closing", "helpdesk-chat-try", "helpdesk-chat-chips helpdesk-chat-alternatives helpdesk-chat-followups", "helpdesk-chat-feedback"], "one message: opening, card, closing, follow-ups, vote (the reading order too)");
    assert.equal(await bubble.locator(".helpdesk-chat-opening").textContent(), "Don't worry, here's how:");
    assert.equal(await bubble.locator(".helpdesk-chat-closing").textContent(), "Try that and tell me how it goes.");
    const card = bubble.locator("blockquote.helpdesk-chat-excerpt");
    const shown = card.locator(".helpdesk-chat-answer-text");
    assert.deepEqual(await shown.locator("ol > li").allTextContents(), ["Sign out and sign in again", "Open My Learning"], "the picked blocks, rendered as the approved card");
    assert.equal(await shown.locator("strong").first().textContent(), "My Learning");
    assert.ok((await shown.textContent())?.includes("Still nothing after ten minutes?"));
    assert.equal((await shown.textContent())?.includes("usually still being confirmed"), false, "only the picked blocks");
    assert.equal(await card.locator(".helpdesk-chat-source").textContent(), fillTemplate(c.copy.excerptSource, { question: "Paid but no access?" }));
    assert.equal(await card.getByRole("link", { name: c.copy.openInHelpCentre }).getAttribute("href"), `/${locale}/help?faq=${NODE.payment}`);
    const style = await card.evaluate((node) => { const s = getComputedStyle(node); return { bar: s.borderLeftWidth, color: s.borderLeftColor, fill: s.backgroundColor }; });
    assert.deepEqual(style, { bar: "3px", color: "rgb(36, 104, 245)", fill: "rgb(243, 247, 255)" }, "light fill and the 3 px brand-blue bar");
    await page.waitForFunction((opening) => document.querySelector(".helpdesk-chat-live")?.textContent?.startsWith(opening) ?? false, "Don't worry, here's how:");
    const said = (await c.live.textContent()) ?? "";
    const order = ["Don't worry, here's how:", "Sign out and sign in again", "Still nothing after ten minutes?", "Try that and tell me how it goes.", c.copy.followUpsTitle, "Still no access?"].map((part) => said.indexOf(part));
    assert.ok(order.every((at, index) => at >= 0 && (index === 0 || at > order[index - 1])), `announced in reading order: ${said}`);
    assert.equal(said.includes("usually still being confirmed"), false, "the excerpt is what is read");
    // Show the full answer, in place.
    const expand = card.getByRole("button", { name: c.copy.showFull, exact: true });
    assert.equal(await expand.getAttribute("aria-expanded"), "false");
    assert.equal(await expand.getAttribute("aria-controls"), await shown.getAttribute("id"));
    await expand.click();
    await page.waitForFunction(() => document.querySelector(".helpdesk-chat-excerpt .helpdesk-chat-answer-text")?.textContent?.includes("usually still being confirmed") ?? false);
    const less = card.getByRole("button", { name: c.copy.showLess, exact: true });
    assert.equal(await less.getAttribute("aria-expanded"), "true");
    assert.ok((await shown.textContent())?.includes("contact support with the order"), "the whole card");
    await waitForCalls(harness, (calls) => count(calls, isExpanded) === 1);
    assert.equal(harness.calls.find(isExpanded)!.path, `/api/helpdesk/assistant/${id(1)}/expanded`);
    await less.click();
    await card.getByRole("button", { name: c.copy.showFull, exact: true }).click();
    await page.waitForTimeout(150);
    assert.equal(count(harness.calls, isExpanded), 1, "reported once");
    // The next typed question carries the server's session (it rolled over).
    await say(harness, locale, "And my password?");
    assert.equal((harness.calls.filter(isAssistant)[1].json as { sessionId?: string }).sessionId, ROLLED);
    const short = c.answers.nth(1);
    assert.equal(await short.getByRole("button", { name: c.copy.showFull }).count(), 0, "a short answer is shown whole, with no expand");
    assert.equal(await short.locator(".helpdesk-chat-excerpt strong").textContent(), "Settings");
    assert.equal(await short.locator(".helpdesk-chat-try").count(), 0, "no follow-ups: no title");
    await page.close();
  }
});

test("v5 graph: a choice card shows A/B/C/D options; an option and a 3-level follow-up chain are clicks with the card they sit on, never the model", async () => {
  for (const locale of LOCALES) {
    const replies: Record<string, Reply> = {
      [NODE.charged]: answer(id(2), NODE.charged, "Charged but no access", "It is being confirmed.", { via: "option", opening: "Here's how to sort this out:", next: { kind: "follow_up", steps: [{ nodeId: NODE.wait, label: "How long does it take?" }] } }),
      [NODE.wait]: answer(id(3), NODE.wait, "How long does it take?", "Usually a few minutes.", { via: "follow_up", next: { kind: "follow_up", steps: [{ nodeId: NODE.stillNot, label: "Still no access after that?" }] } }),
      [NODE.stillNot]: answer(id(4), NODE.stillNot, "Still no access after that?", "Sign out and in again.", { via: "follow_up", next: { kind: "follow_up", steps: [{ nodeId: NODE.contact, label: "How do I contact support?" }] } }),
      [NODE.contact]: answer(id(5), NODE.contact, "How do I contact support?", "Use the form on this page.", { via: "follow_up" })
    };
    const options = [{ nodeId: NODE.failed, label: "The payment failed" }, { nodeId: NODE.charged, label: "Charged but no access" }, { nodeId: NODE.twice, label: "Charged twice" }];
    const harness = await open(locale, (call) => {
      if (isAssistant(call)) return { json: { id: id(1), reply: { id: id(1), faqId: NODE.choice, question: "Payment problem?", answer: "Which one is it?" }, alternatives: [], turn: turn("answer", { nodeId: NODE.choice, nodeType: "choice", next: { kind: "option", steps: options } }) } };
      if (isAssistantClick(call)) return replies[(call.json as { nodeId: string }).nodeId] ?? { status: 400, json: { code: "invalid_request" } };
      return { status: 500 };
    });
    const { page } = harness;
    const c = ui(page, locale);
    await say(harness, locale, "payment problem");
    const choice = c.answers.first();
    assert.equal(await choice.locator(".helpdesk-chat-choice-prompt").textContent(), "Which one is it?");
    const group = choice.getByRole("list", { name: "Which one is it?" });
    assert.deepEqual(await group.locator(".helpdesk-chat-option-letter").allTextContents(), ["A", "B", "C"], "lettered options");
    assert.deepEqual(await group.getByRole("button").allTextContents(), ["AThe payment failed", "BCharged but no access", "CCharged twice"]);
    assert.equal(await group.getByRole("button", { name: "Charged but no access", exact: true }).count(), 1, "the letter is not part of the button's name");
    assert.equal(await choice.getByRole("button", { name: c.copy.yes }).count(), 0, "a choice card has no vote");
    assert.equal(await choice.locator(".helpdesk-chat-opening, .helpdesk-chat-excerpt").count(), 0, "nor an opening or a quoted card");
    await page.waitForFunction(() => document.querySelector(".helpdesk-chat-live")?.textContent?.includes("B. Charged but no access") ?? false);
    await group.getByRole("button", { name: "Charged but no access", exact: true }).click();
    await settled(page, 2);
    // The chain: three follow-ups deep, each from the card it was clicked on.
    for (const [index, label] of ["How long does it take?", "Still no access after that?", "How do I contact support?"].entries()) {
      const chips = c.answers.nth(index + 1).getByRole("list", { name: c.copy.followUpsTitle, exact: true }).getByRole("button");
      assert.deepEqual(await chips.allTextContents(), [label]);
      await chips.first().click();
      await settled(page, index + 3);
    }
    const clicks = harness.calls.filter(isAssistantClick).map((call) => call.json as Record<string, unknown>);
    assert.deepEqual(clicks.map((json) => [json.via, json.fromNodeId, json.nodeId]), [["option", NODE.choice, NODE.charged], ["follow_up", NODE.charged, NODE.wait], ["follow_up", NODE.wait, NODE.stillNot], ["follow_up", NODE.stillNot, NODE.contact]]);
    assert.deepEqual(clicks.map((json) => json.label), ["Charged but no access", "How long does it take?", "Still no access after that?", "How do I contact support?"]);
    assert.ok(clicks.every((json) => json.sessionId === SESSION && json.locale === locale));
    assert.equal(count(harness.calls, isAssistant), 1, "only the typed question went to the assistant");
    assert.deepEqual(await c.panel.locator(".helpdesk-chat-question").allTextContents(), ["payment problem", "Charged but no access", "How long does it take?", "Still no access after that?", "How do I contact support?"], "each click shows as asked");
    assert.equal(await c.answers.last().locator(".helpdesk-chat-excerpt .helpdesk-chat-answer-text").textContent(), "Use the form on this page.");
    await page.close();
  }
});

test("v5 Part B: hello is a reply line followed by the situation chips, never the fallback; thanks after an answer brings the rating card once; small talk has no vote", async () => {
  for (const locale of LOCALES) {
    const greet = locale === "zh-CN" ? "你好呀！想问点什么？" : "Hi there! What can I help with?";
    const thanks = locale === "zh-CN" ? "不客气，随时来问我！" : "You're welcome, ask any time!";
    const harness = await open(locale, (call) => {
      if (isAssistantRating(call)) return { json: { id: call.path.split("/")[4], rating: (call.json as { rating: number }).rating } };
      if (!isAssistant(call)) return { status: 500 };
      const message = (call.json as { message: string }).message;
      if (/^(你好|hi)/i.test(message)) return { json: { id: id(10), reply: null, alternatives: [], turn: turn("smalltalk", { intent: "greeting", reply: greet }) } };
      if (/^(谢谢|thanks)/i.test(message)) return { json: { id: id(11 + message.length), reply: null, alternatives: [], turn: turn("smalltalk", { intent: "farewell", reply: thanks }) } };
      return answer(id(20), NODE.reset, "How do I reset my password?", "Open **Settings**.");
    });
    const { page } = harness;
    const c = ui(page, locale);
    await say(harness, locale, locale === "zh-CN" ? "你好" : "hi");
    const bubble = c.answers.first();
    assert.equal(await bubble.locator(".helpdesk-chat-reply").textContent(), greet, "the reply line, as plain text");
    assert.equal(await bubble.locator(".helpdesk-chat-fallback").count(), 0, "never the fallback");
    assert.equal((await bubble.textContent())?.includes(c.copy.fallback), false);
    assert.deepEqual(await bubble.getByRole("list", { name: c.copy.situationTitle, exact: true }).getByRole("button").allTextContents(), session(locale).chips.map((chip) => chip.question), "then the situation chips");
    assert.equal(await bubble.getByRole("button", { name: c.copy.yes }).count(), 0, "small talk has no vote");
    await page.waitForFunction((reply) => document.querySelector(".helpdesk-chat-live")?.textContent?.startsWith(reply) ?? false, greet);
    // Thanks with nothing answered yet: the reply alone.
    await say(harness, locale, locale === "zh-CN" ? "谢谢" : "thanks");
    assert.equal(await c.answers.nth(1).locator(".helpdesk-chat-reply").textContent(), thanks);
    assert.equal(await c.ratingCards.count(), 0, "nothing answered: no rating card");
    assert.equal(await c.answers.nth(1).getByRole("list").count(), 0, "a farewell brings no chips");
    // An answer, then thanks: the rating card follows the reply.
    await say(harness, locale, "password");
    await say(harness, locale, locale === "zh-CN" ? "谢谢你" : "thanks a lot");
    const card = c.ratingCards.first();
    await card.waitFor();
    assert.equal(await c.panel.locator("[data-entry]").last().getByRole("group", { name: c.all.assistant.rateTitle }).count(), 1, "right after the reply");
    assert.equal(await c.panel.getByText(c.copy.ended).count(), 0, "the chat goes on: no end line");
    await page.waitForFunction((title) => document.querySelector(".helpdesk-chat-live")?.textContent?.endsWith(title) ?? false, c.all.assistant.rateTitle);
    await card.getByRole("button", { name: fillTemplate(c.all.assistant.rateStar, { n: 5 }), exact: true }).click();
    await waitForCalls(harness, (calls) => count(calls, isAssistantRating) === 1);
    assert.equal(harness.calls.find(isAssistantRating)!.path, `/api/helpdesk/assistant/${id(20)}/rating`, "it rates the answered assist");
    await c.panel.locator(".helpdesk-chat-rated").waitFor();
    await say(harness, locale, locale === "zh-CN" ? "谢谢啦" : "thanks again");
    assert.equal(await c.ratingCards.count(), 0, "rated: not asked again");
    await page.close();
  }
});

test("v5 Part D: an explanation says which card it explains and shows it again, with the vote; one the card does not cover is the fixed line and the handover card", async () => {
  for (const locale of LOCALES) {
    const question = "How do I reset my password?";
    const replies: Reply[] = [
      answer(id(1), NODE.reset, question, "Open **Settings** and choose Reset."),
      { json: { id: id(2), reply: null, alternatives: [], turn: turn("clarify", { intent: "clarify", nodeId: NODE.reset, covered: true, explanation: "It's in Settings, at the top.", source: { faqId: NODE.reset, question }, countsAsQuestion: false }) } },
      { json: { id: id(3), reply: null, alternatives: [], turn: turn("clarify", { intent: "clarify", nodeId: NODE.reset, covered: false, source: { faqId: NODE.reset, question }, unsolved: true, countsAsQuestion: false }) } }
    ];
    const harness = await open(locale, (call) => (isAssistant(call) ? replies.shift() ?? { status: 500 } : isAssistantFeedback(call) ? { json: { id: id(2), feedback: "helpful" } } : { status: 500 }));
    const { page } = harness;
    const c = ui(page, locale);
    await say(harness, locale, "reset password");
    await say(harness, locale, "what does that mean?");
    const explained = c.answers.nth(1);
    assert.equal(await explained.locator(".helpdesk-chat-reply").textContent(), "It's in Settings, at the top.");
    const again = explained.getByRole("button", { name: fillTemplate(c.copy.clarifySource, { question }), exact: true });
    assert.equal(await again.getAttribute("aria-expanded"), "false");
    await again.click();
    assert.equal(await explained.locator("blockquote.helpdesk-chat-excerpt strong").textContent(), "Settings", "the original card again");
    assert.equal(await again.getAttribute("aria-expanded"), "true");
    await explained.getByRole("button", { name: c.copy.yes, exact: true }).click();
    await waitForCalls(harness, (calls) => count(calls, isAssistantFeedback) === 1);
    assert.equal(harness.calls.find(isAssistantFeedback)!.path, `/api/helpdesk/assistant/${id(2)}/feedback`, "the explanation is voted on like an answer");
    await say(harness, locale, "and if I changed my email?");
    const uncovered = c.answers.nth(2);
    assert.equal(await uncovered.textContent(), c.copy.clarifyNotCovered, "the fixed line, never model text");
    assert.equal(await uncovered.getByRole("button").count(), 0);
    assert.equal(await c.handovers.count(), 1, "and the handover card at once");
    assert.equal(await c.panel.locator("[data-entry]").last().getByRole("group", { name: c.copy.handoverTitle }).count(), 1);
    await page.waitForFunction((line) => document.querySelector(".helpdesk-chat-live")?.textContent?.startsWith(line) ?? false, c.copy.clarifyNotCovered);
    await page.close();
  }
});

test("v5 Part C: accent pill chips with glow and a 1 px lift, the glowing input with the round send button inside, soft shadows, the same sizes; no lift or transition under reduced motion", async () => {
  const locale: Locale = "en-GB";
  const harness = await open(locale, () => ({ status: 500 }));
  const { page } = harness;
  await page.setViewportSize({ width: 1440, height: 1024 });
  const c = ui(page, locale);
  const chip = c.panel.locator(".helpdesk-chat-chip").first();
  const css = (selector: string, property: string) => c.panel.locator(selector).first().evaluate((node, name) => getComputedStyle(node).getPropertyValue(name), property);
  assert.equal(await chip.evaluate((node) => getComputedStyle(node).borderTopLeftRadius), "999px", "pill");
  assert.deepEqual(await chip.evaluate((node) => [node.getBoundingClientRect().width, node.getBoundingClientRect().height]), [404, 36], "the chip size is unchanged");
  assert.equal(await css(".helpdesk-chat-chip", "border-top-color"), "rgb(157, 188, 246)", "an accent outline");
  await chip.hover();
  await page.waitForTimeout(250);
  assert.equal(await css(".helpdesk-chat-chip", "transform"), "matrix(1, 0, 0, 1, 0, -1)", "a 1 px lift on hover");
  assert.equal(await css(".helpdesk-chat-chip", "box-shadow"), "rgba(37, 99, 235, 0.15) 0px 0px 0px 3px", "the glow");
  assert.equal(await css(".helpdesk-chat-chip", "background-color"), "rgb(239, 245, 255)", "a light fill");
  await page.mouse.move(0, 0);
  assert.equal(await c.panel.evaluate((node) => getComputedStyle(node).boxShadow), "rgba(15, 23, 42, 0.06) 0px 8px 24px 0px", "the panel's soft shadow");
  assert.equal(await css(".helpdesk-chat-greeting", "box-shadow"), "rgba(15, 23, 42, 0.04) 0px 1px 2px 0px", "cards: a subtle shadow");
  await c.input.focus();
  await page.waitForTimeout(250);
  assert.equal(await css(".helpdesk-chat-input", "box-shadow"), "rgba(37, 99, 235, 0.15) 0px 0px 0px 3px", "the input's 3 px soft glow");
  assert.equal(await css(".helpdesk-chat-input", "border-top-color"), "rgb(36, 104, 245)", "and its accent border");
  const box = (await c.input.boundingBox())!;
  const send = (await c.send.boundingBox())!;
  assert.deepEqual([send.width, send.height, box.height], [43, 43, 70], "sizes unchanged");
  assert.ok(send.x > box.x && send.x + send.width < box.x + box.width && send.y > box.y && send.y + send.height < box.y + box.height, "the send button sits inside the box");
  assert.equal(await css(".helpdesk-chat-send", "border-top-left-radius"), "50%", "round");
  assert.equal(await css(".helpdesk-chat-send", "background-color"), "rgb(36, 104, 245)", "accent");
  // The text never runs under the button.
  assert.ok(Number.parseFloat(await css(".helpdesk-chat-input", "padding-right")) >= box.x + box.width - send.x, "the input keeps room for the button");
  // Contact Support's inputs and select get the same glow.
  const subject = page.getByRole("textbox", { name: getMessages(locale).helpdesk.subject, exact: true });
  await subject.focus();
  await page.waitForTimeout(250);
  assert.equal(await subject.evaluate((node) => getComputedStyle(node).boxShadow), "rgba(37, 99, 235, 0.15) 0px 0px 0px 3px");
  // Reduced motion: no lift and no transition.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await chip.hover();
  assert.equal(await css(".helpdesk-chat-chip", "transform"), "none", "no lift");
  assert.equal(await css(".helpdesk-chat-chip", "transition-duration"), "0s", "no transition");
  assert.equal(await css(".helpdesk-chat-input", "transition-duration"), "0s");
  await page.close();

  // The Help Centre search gets the focus ring too (white on the blue hero, where a blue glow would not show).
  const help = await openHarness(browser, locale, () => ({ status: 500 }), `/${locale}/help`);
  assert.equal((await mountHelp(help.page, { locale, faqs: [] })).result, "rendered");
  const search = help.page.getByRole("searchbox", { name: getMessages(locale).helpCentre.searchLabel });
  await search.focus();
  await help.page.waitForTimeout(250);
  assert.equal(await help.page.locator(".help-centre-search").evaluate((node) => getComputedStyle(node).boxShadow), "rgba(255, 255, 255, 0.45) 0px 0px 0px 3px");
  await help.page.close();
});

test("v5 sessions: End chat ends the session on the server and starts the next one, whose chips replace the greeting's; a handover ends it as handover", async () => {
  const locale: Locale = "zh-CN";
  let n = 0;
  const fresh = { sessionId: NEXT_SESSION, situational: false, waitingTicket: null, releaseVersion: 2, chips: [{ id: NODE.contact, question: "如何联系客服？", reason: "popular" }] };
  const harness = await open(locale, (call) => {
    if (isAssistant(call)) { n += 1; return answer(id(n), NODE.reset, `Q${n}`, "A.", { sessionId: (call.json as { sessionId?: string }).sessionId ?? SESSION }); }
    if (isSessionEnd(call)) return { json: { sessionId: SESSION, endedAt: new Date().toISOString(), endReason: "ended_by_learner" } };
    if (isSessionStart(call)) return { status: 201, json: fresh };
    if (isAssistantRating(call)) return { json: { id: call.path.split("/")[4], rating: 3 } };
    return { status: 500 };
  });
  const { page } = harness;
  const c = ui(page, locale);
  for (let k = 1; k <= CHAT_SESSION_RULES.checkInAfterQuestions; k += 1) await say(harness, locale, `问题 ${k}`);
  const checkin = c.panel.getByRole("group", { name: c.copy.checkinTitle, exact: true });
  await checkin.getByRole("button", { name: c.copy.endChat, exact: true }).click();
  await waitForCalls(harness, (calls) => count(calls, isSessionEnd) === 1 && count(calls, isSessionStart) === 1);
  const end = harness.calls.find(isSessionEnd)!;
  assert.equal(end.path, `/api/helpdesk/assistant/sessions/${SESSION}/end`);
  assert.deepEqual(end.json, { reason: "ended_by_learner" });
  assert.deepEqual(harness.calls.find(isSessionStart)!.json, { locale });
  await page.waitForFunction(() => document.querySelector(".helpdesk-chat-chips .helpdesk-chat-chip")?.textContent === "如何联系客服？");
  assert.equal(await c.panel.getByRole("list", { name: c.copy.tryAsking, exact: true }).getByRole("button").count(), 1, "the new session's chips, under their title");
  await say(harness, locale, "新问题");
  assert.equal((harness.calls.filter(isAssistant).at(-1)!.json as { sessionId?: string }).sessionId, NEXT_SESSION, "the next turn belongs to the new session");
  await say(harness, locale, "转人工");
  await c.handovers.first().getByRole("button", { name: c.copy.handoverButton }).click();
  await waitForCalls(harness, (calls) => count(calls, isSessionEnd) === 2);
  const handover = harness.calls.filter(isSessionEnd)[1];
  assert.equal(handover.path, `/api/helpdesk/assistant/sessions/${NEXT_SESSION}/end`);
  assert.deepEqual(handover.json, { reason: "handover" });
  await page.close();
});
