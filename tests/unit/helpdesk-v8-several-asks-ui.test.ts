// Helpdesk contract v8 in Chromium (2026-11-06, owner: "可以给多个 和排序卡片"): one message that asked several
// things is one reply with a quoted card per ask, in the order the user asked (at most 3), each with its own
// "Related FAQ" link and "Show the full answer"; the asks with no card get a fixed line and the handover card
// follows the reply. The first card's follow-up chips are left out (one card's chips under three would mislead).
// Screen readers get the cards in the order shown. No Figma frame: the quoted-card style stacked, 待视觉验收.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import type { AssistantTurn } from "../../contracts/helpdesk";
import { getMessages } from "../../lib/i18n/messages";
import { fillTemplate } from "../../modules/helpdesk/learnerUi";
import { LOCALES, isAssistant, isExpanded, mountContact, openHarness, waitForCalls, type ApiCall, type ChatSessionProp, type Handler, type Harness, type Locale, type Reply } from "./helpers/helpdesk-browser";

let browser: Browser;
before(async () => { browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined }); });
after(async () => { await browser?.close(); });

const id = (n: number) => `01a18800-0000-7000-8000-${String(n).padStart(12, "0")}`;
const SESSION = id(900);
const NODE = { paid: id(101), twice: id(102), refund: id(103), wait: id(104) };
const BLOCKS = [
  { id: "b1", text: "If you were charged but cannot open the course, it is usually still being confirmed." },
  { id: "b2", text: "1. Sign out and sign in again\n2. Open **My Learning**" },
  { id: "b3", text: "Still nothing after ten minutes? Check **Payment records**." },
  { id: "b4", text: "If it shows paid and you still have no access, contact support with the order." }
];
const LONG = BLOCKS.map((block) => block.text).join("\n\n");
const TWICE = "No. A failed payment is not taken from your account.";
const REFUND_BLOCKS = [
  { id: "b1", text: "Refunds follow the plan you bought." },
  { id: "b2", text: "Open **My Subscription** and choose **Request a refund**." },
  { id: "b3", text: "The money goes back to the card you paid with." },
  { id: "b4", text: "Banks can take up to ten working days to show it." }
];
const REFUND = REFUND_BLOCKS.map((block) => block.text).join("\n\n");
const count = (calls: ApiCall[], predicate: (call: ApiCall) => boolean) => calls.filter(predicate).length;

function turn(extra: Partial<AssistantTurn>): AssistantTurn {
  return {
    kind: "answer", intent: "question", via: "typed", nodeId: NODE.paid, nodeType: "answer", opening: "Don't worry, here's how:", closing: "Try that and tell me how it goes.", reply: null, explanation: null, covered: null,
    excerpt: [BLOCKS[1], BLOCKS[2]], next: { kind: "follow_up", steps: [{ nodeId: NODE.wait, label: "How long does it take?" }] }, source: null, releaseVersion: 2, sessionId: SESSION, turnIndex: 1, unsolved: false, countsAsQuestion: true, ...extra
  };
}

function answer(assist: string, extra: Partial<AssistantTurn>): Reply {
  return { json: { id: assist, reply: { id: assist, faqId: NODE.paid, question: "Paid but no access?", answer: LONG }, alternatives: [], turn: turn(extra) } };
}

function session(): ChatSessionProp {
  return { sessionId: SESSION, situational: false, waitingTicket: null, releaseVersion: 2, chips: [] };
}

function ui(page: Page, locale: Locale) {
  const all = getMessages(locale).helpdesk;
  const copy = all.chat;
  const panel = page.getByRole("region", { name: copy.title });
  return { copy, panel, input: panel.getByRole("textbox", { name: copy.inputLabel }), answers: panel.locator(".helpdesk-chat-answer"), live: panel.locator(".helpdesk-chat-live"), handovers: panel.getByRole("group", { name: copy.handoverTitle, exact: true }) };
}

async function open(locale: Locale, handler: Handler): Promise<Harness> {
  const harness = await openHarness(browser, locale, handler);
  await mountContact(harness.page, { locale, session: session() });
  return harness;
}

async function say(harness: Harness, locale: Locale, message: string) {
  const c = ui(harness.page, locale);
  const before = await c.panel.locator("[data-entry]").count();
  await c.input.fill(message);
  await c.input.press("Enter");
  await harness.page.waitForFunction((n) => document.querySelectorAll(".helpdesk-chat-messages [data-entry]").length >= n + 2 && !document.querySelector(".helpdesk-chat-typing"), before);
}

test("v8: several asks are one reply: opening, a card per ask in the order asked, the missed line, closing, vote; no follow-ups; the handover card follows; each card opens on its own", async () => {
  for (const locale of LOCALES) {
    const replies: Reply[] = [answer(id(1), {
      more: [{ faqId: NODE.twice, question: "Will I be charged twice?", answer: TWICE, excerpt: null }, { faqId: NODE.refund, question: "Can I get a refund?", answer: REFUND, excerpt: [REFUND_BLOCKS[1]] }],
      missed: 1
    })];
    const harness = await open(locale, (call) => (isAssistant(call) ? replies.shift() ?? { status: 500 } : isExpanded(call) ? { json: { id: id(1), expanded: true } } : { status: 500 }));
    const { page } = harness;
    const c = ui(page, locale);
    await say(harness, locale, "I paid but can't open the course. Will I be charged twice? Can I get a refund? And can I change my email?");
    const bubble = c.answers.first();
    const parts = await bubble.evaluate((node) => [...node.children].map((child) => child.className || child.tagName.toLowerCase()));
    assert.deepEqual(parts, ["helpdesk-chat-opening", "helpdesk-chat-excerpt", "helpdesk-chat-excerpt", "helpdesk-chat-excerpt", "helpdesk-chat-missed", "helpdesk-chat-closing", "helpdesk-chat-feedback"], "one message, the cards in the order asked; no follow-up chips");
    assert.equal(await bubble.getAttribute("class"), "helpdesk-chat-answer helpdesk-chat-three-part helpdesk-chat-several");
    const cards = bubble.locator("blockquote.helpdesk-chat-excerpt");
    const links = await cards.evaluateAll((nodes) => nodes.map((node) => node.querySelector("a.helpdesk-chat-related")?.getAttribute("href")));
    assert.deepEqual(links, [NODE.paid, NODE.twice, NODE.refund].map((faq) => `/${locale}/help?faq=${faq}`), "each card links its own FAQ in the Help Centre");
    assert.equal(await cards.nth(0).getByRole("link").textContent(), fillTemplate(c.copy.relatedFaq, { question: "Paid but no access?" }));
    assert.equal(await cards.nth(1).getByRole("link").textContent(), fillTemplate(c.copy.relatedFaq, { question: "Will I be charged twice?" }));
    assert.equal(await cards.nth(1).locator(".helpdesk-chat-answer-text").textContent(), TWICE, "a short card is whole");
    assert.equal(await cards.nth(1).getByRole("button").count(), 0, "and has no expand");
    assert.equal(await cards.nth(2).locator(".helpdesk-chat-answer-text").textContent(), "Open My Subscription and choose Request a refund.", "the picked block");
    assert.equal(await bubble.locator(".helpdesk-chat-missed").textContent(), c.copy.missedOne);
    assert.equal(await bubble.locator(".helpdesk-chat-try").count(), 0, "no follow-up title");
    // The handover card follows the reply: the ask with no card can go to a person at once.
    assert.equal(await c.handovers.count(), 1);
    const order = await c.panel.locator("[data-entry]").evaluateAll((nodes) => nodes.map((node) => (node.querySelector(".helpdesk-chat-answer") ? "answer" : node.querySelector(".helpdesk-chat-card-handover") ? "handover" : "other")));
    assert.deepEqual(order.slice(-2), ["answer", "handover"]);
    // Read in the order shown: opening, the three cards, the missed line, closing, then the handover card.
    await page.waitForFunction((opening) => document.querySelector(".helpdesk-chat-live")?.textContent?.startsWith(opening) ?? false, "Don't worry, here's how:");
    const said = (await c.live.textContent()) ?? "";
    const at = ["Don't worry, here's how:", "Sign out and sign in again", TWICE, "Request a refund", c.copy.missedOne, "Try that and tell me how it goes.", c.copy.handoverTitle].map((part) => said.indexOf(part));
    assert.ok(at.every((position, index) => position >= 0 && (index === 0 || position > at[index - 1])), `announced in reading order: ${said}`);
    assert.equal(said.includes("How long does it take?"), false, "no follow-ups read");
    // Each card's "Show the full answer" opens that card only; the turn's expand is reported once.
    const [firstExpand, refundExpand] = [cards.nth(0).getByRole("button", { name: c.copy.showFull, exact: true }), cards.nth(2).getByRole("button", { name: c.copy.showFull, exact: true })];
    assert.notEqual(await firstExpand.getAttribute("aria-controls"), await refundExpand.getAttribute("aria-controls"), "each controls its own card");
    assert.equal(await refundExpand.getAttribute("aria-controls"), await cards.nth(2).locator(".helpdesk-chat-answer-text").getAttribute("id"));
    await refundExpand.click();
    await page.waitForFunction(() => document.querySelectorAll("blockquote.helpdesk-chat-excerpt")[2]?.textContent?.includes("ten working days") ?? false);
    assert.equal(await cards.nth(2).getByRole("button", { name: c.copy.showLess, exact: true }).getAttribute("aria-expanded"), "true");
    assert.equal(await firstExpand.getAttribute("aria-expanded"), "false", "the first card stays as it was");
    assert.equal((await cards.nth(0).textContent())?.includes("usually still being confirmed"), false);
    await firstExpand.click();
    await page.waitForFunction(() => document.querySelector("blockquote.helpdesk-chat-excerpt")?.textContent?.includes("usually still being confirmed") ?? false);
    await waitForCalls(harness, (calls) => count(calls, isExpanded) === 1);
    await page.waitForTimeout(150);
    assert.equal(count(harness.calls, isExpanded), 1, "one report for the turn");
    await page.close();
  }
});

test("v8: two missed asks say how many; a reply with further cards and none missed has no missed line and no handover card", async () => {
  for (const locale of LOCALES) {
    const replies: Reply[] = [
      answer(id(1), { missed: 2, next: null }),
      answer(id(2), { more: [{ faqId: NODE.twice, question: "Will I be charged twice?", answer: TWICE, excerpt: null }] })
    ];
    const harness = await open(locale, (call) => (isAssistant(call) ? replies.shift() ?? { status: 500 } : { status: 500 }));
    const c = ui(harness.page, locale);
    await say(harness, locale, "Paid but no access? Can I get a refund? And change my email?");
    assert.equal(await c.answers.first().locator(".helpdesk-chat-missed").textContent(), fillTemplate(c.copy.missedMany, { n: 2 }));
    assert.equal(await c.answers.first().locator("blockquote").count(), 1);
    assert.equal(await c.handovers.count(), 1);
    await say(harness, locale, "Paid but no access? Will I be charged twice?");
    const second = c.answers.nth(1);
    assert.equal(await second.locator("blockquote").count(), 2);
    assert.equal(await second.locator(".helpdesk-chat-missed").count(), 0);
    assert.equal(await c.handovers.count(), 1, "no new handover card");
    await harness.page.close();
  }
});
