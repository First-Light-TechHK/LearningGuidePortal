// Helpdesk v4 Part B in Chromium: the chat panel (components/helpdesk/AssistantChat.tsx)
// ends or hands over a long AI chat by code (modules/helpdesk/chatSession.ts),
// never by asking the model:
// 1. a message asking for a person shows the handover card at once, with no AI call;
// 2. two unsolved turns in a row show the same card after the reply, next to the alternatives;
// 3. the reply to the 8th question is followed by "Still need help?" (End chat: the rating
//    card for the last answered assist, or thanks; Contact a person: as the handover card);
// 4. 10 minutes with no learner input after an AI answer end the session with the rating
//    card (fake clock); the next message starts a new session with the counters reset.
// The handover opens Contact Support (the form on this page) and the enquiry carries the
// chat's assistIds. The human entry stays visible, nothing blocks typing. New states have
// no Figma frame: 待视觉验收.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import { getMessages } from "../../lib/i18n/messages";
import { CHAT_SESSION_RULES } from "../../modules/helpdesk/chatSession";
import { fillTemplate } from "../../modules/helpdesk/learnerUi";
import { ACCOUNT, LOCALES, isAssistant, isAssistantFeedback, isAssistantRating, isSuggestion, isTicketCreate, mountContact, openHarness, ticketFixture, waitForCalls, type ApiCall, type Handler, type Harness, type Locale, type Reply } from "./helpers/helpdesk-browser";

let browser: Browser;
before(async () => { browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined }); });
after(async () => { await browser?.close(); });

const id = (n: number) => `01a18100-0000-7000-8000-${String(n).padStart(12, "0")}`;
const FAQ_ID = "01a18100-0000-7000-8000-0000000000f1";
const ALTERNATIVES = [{ faqId: "01a18100-0000-7000-8000-0000000000d1", question: "How do I reset my password?" }];

/**
 * The chat endpoints: each question gets a new assist id; a question starting
 * with "?" gets the fallback (with alternatives), anything else an FAQ answer.
 */
function api(extra: { ticket?: (call: ApiCall) => Reply; rating?: (call: ApiCall) => Reply } = {}): Handler {
  let n = 0;
  return (call) => {
    if (isAssistant(call)) {
      const assist = id(++n);
      const message = (call.json as { message: string }).message;
      if (message.startsWith("?")) return { json: { id: assist, reply: null, alternatives: ALTERNATIVES } };
      return { json: { id: assist, reply: { id: assist, faqId: FAQ_ID, question: `About ${message}`, answer: `Answer to ${message}.` }, alternatives: [] } };
    }
    if (isAssistantFeedback(call)) return { json: { id: call.path.split("/")[4], feedback: (call.json as { helpful: boolean }).helpful ? "helpful" : "not_helpful" } };
    if (isAssistantRating(call)) return extra.rating ? extra.rating(call) : { json: { id: call.path.split("/")[4], rating: (call.json as { rating: number }).rating } };
    if (isSuggestion(call)) return { json: { suggestion: null, alternatives: [] } };
    if (isTicketCreate(call)) return extra.ticket ? extra.ticket(call) : { status: 201, json: ticketFixture("OPEN") };
    return { status: 500 };
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
    questions: panel.locator(".helpdesk-chat-question"),
    answers: panel.locator(".helpdesk-chat-answer"),
    live: panel.locator(".helpdesk-chat-live"),
    handovers: panel.getByRole("group", { name: copy.handoverTitle, exact: true }),
    checkins: panel.getByRole("group", { name: copy.checkinTitle, exact: true }),
    ratingCards: panel.getByRole("group", { name: all.assistant.rateTitle, exact: true }),
    ended: panel.locator(".helpdesk-chat-ended"),
    info: panel.locator(".helpdesk-chat-info"),
    subject: page.getByRole("textbox", { name: all.subject, exact: true }),
    message: page.getByRole("textbox", { name: all.message, exact: true }),
    submit: page.locator("button.helpdesk-submit-button[type=submit]")
  };
}

const count = (calls: ApiCall[], predicate: (call: ApiCall) => boolean) => calls.filter(predicate).length;

async function open(locale: Locale, handler: Handler = api(), clock = false): Promise<Harness> {
  const harness = await openHarness(browser, locale, handler);
  if (clock) await harness.page.clock.install({ time: new Date("2026-10-29T12:00:00.000Z") });
  await mountContact(harness.page, { locale, chips: [{ id: FAQ_ID, question: locale === "zh-CN" ? "如何联系客服投诉？" : "How do I make a complaint to an agent?" }] });
  return harness;
}

/** Types one question and waits until its reply (or its handover card) is in. */
async function ask(harness: Harness, locale: Locale, message: string) {
  const c = ui(harness.page, locale);
  const before = await c.panel.locator("[data-entry]").count();
  await c.input.fill(message);
  await c.input.press("Enter");
  await harness.page.waitForFunction((n) => document.querySelectorAll(".helpdesk-chat-messages [data-entry]").length >= n + 2 && !document.querySelector(".helpdesk-chat-typing"), before);
}

test("v4 Part B: asking for a person shows the handover card at once, with no AI call; its button opens Contact Support and the enquiry links the chat", async () => {
  for (const locale of LOCALES) {
    const harness = await open(locale);
    const { page } = harness;
    const c = ui(page, locale);
    await ask(harness, locale, "first question");
    assert.equal(count(harness.calls, isAssistant), 1);
    const request = locale === "zh-CN" ? "我要轉人工" : "Can I SPEAK to someone please";
    await c.input.fill(request);
    await c.input.press("Enter");
    await c.handovers.first().waitFor();
    assert.equal(count(harness.calls, isAssistant), 1, "no AI answer is attempted for an explicit request");
    assert.deepEqual(await c.questions.allTextContents(), ["first question", request], "the request shows as the learner's message");
    const card = c.handovers.first();
    assert.ok((await card.textContent())?.includes(c.copy.handoverBody), "it says the chat goes with the enquiry");
    const button = card.getByRole("button", { name: c.copy.handoverButton, exact: true });
    assert.equal(await button.getAttribute("class"), "helpdesk-submit-button", "the primary button style");
    await page.waitForFunction((title) => document.querySelector(".helpdesk-chat-live")?.textContent?.startsWith(title) ?? false, c.copy.handoverTitle);
    assert.equal(await c.input.isDisabled(), false, "typing is never blocked");
    assert.equal(await c.input.evaluate((node) => node === document.activeElement), true, "focus stays in the input");
    assert.equal(await c.info.isVisible(), true, "the human entry stays visible");
    // A starter chip is the FAQ's own question: it is asked even when it names a person.
    await c.panel.locator(".helpdesk-chat-chip").first().click();
    await waitForCalls(harness, (calls) => count(calls, isAssistant) === 2);
    assert.equal(harness.calls.filter(isAssistant)[1].json?.faqId, FAQ_ID);
    await page.waitForFunction(() => document.querySelectorAll(".helpdesk-chat-answer").length === 2);
    // The card's button opens Contact Support: focus moves to the form, and the enquiry links every chat answer.
    await button.press("Enter");
    assert.equal(await c.subject.evaluate((node) => node === document.activeElement), true, "focus moves to the enquiry form");
    await c.subject.fill("Need a person");
    await c.message.fill("Please help me with my account.");
    await c.submit.click();
    await waitForCalls(harness, (calls) => count(calls, isTicketCreate) === 1);
    assert.deepEqual(harness.calls.find(isTicketCreate)!.fields.assistIds, [id(1), id(2)], "the chat's assistIds go with the ticket");
    await page.close();
  }
});

test("v4 Part B: two unsolved turns in a row (no answer, or a No vote) show the handover card after the reply, next to the alternatives", async () => {
  for (const locale of LOCALES) {
    const harness = await open(locale);
    const { page } = harness;
    const c = ui(page, locale);
    await ask(harness, locale, "?one");
    assert.equal(await c.handovers.count(), 0, "one unsolved turn is not enough");
    await ask(harness, locale, "?two");
    await c.handovers.first().waitFor();
    assert.equal(await c.answers.nth(1).getByRole("list", { name: c.copy.alternativesTitle }).getByRole("button").count(), 1, "the fallback keeps its alternatives");
    const order = await c.panel.locator("[data-entry]").evaluateAll((nodes) => nodes.map((node) => node.className));
    assert.match(order.at(-1) ?? "", /helpdesk-chat-row/);
    assert.equal(await c.panel.locator("[data-entry]").last().getByRole("group", { name: c.copy.handoverTitle }).count(), 1, "the card follows the reply");
    await page.waitForFunction((title) => document.querySelector(".helpdesk-chat-live")?.textContent?.includes(title) ?? false, c.copy.handoverTitle);
    // The run restarts after the card; an answered turn voted No and a fallback complete the next pair.
    await ask(harness, locale, "three");
    await c.answers.nth(2).getByRole("button", { name: c.copy.no, exact: true }).click();
    await waitForCalls(harness, (calls) => count(calls, isAssistantFeedback) === 1);
    await page.waitForTimeout(100);
    assert.equal(await c.handovers.count(), 1, "one unsolved since the card");
    await ask(harness, locale, "?four");
    await page.waitForFunction(() => document.querySelectorAll(".helpdesk-chat-card-handover").length === 2);
    // A No vote on the newest answer after a fallback shows it too.
    await ask(harness, locale, "?five");
    await ask(harness, locale, "six");
    assert.equal(await c.handovers.count(), 2);
    await c.answers.nth(5).getByRole("button", { name: c.copy.no, exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll(".helpdesk-chat-card-handover").length === 3);
    await page.close();
  }
});

test("v4 Part B: after the 8th question “Still need help?” follows the reply; End chat shows the rating card for the last answered assist", async () => {
  for (const locale of LOCALES) {
    const harness = await open(locale);
    const { page } = harness;
    const c = ui(page, locale);
    for (let n = 1; n < CHAT_SESSION_RULES.checkInAfterQuestions; n += 1) await ask(harness, locale, `question ${n}`);
    assert.equal(await c.checkins.count(), 0, "not before the 8th");
    await ask(harness, locale, "question 8");
    await c.checkins.first().waitFor();
    assert.equal(await c.panel.locator("[data-entry]").last().getByRole("group", { name: c.copy.checkinTitle }).count(), 1, "right after the 8th reply");
    await page.waitForFunction((title) => document.querySelector(".helpdesk-chat-live")?.textContent?.endsWith(title) ?? false, c.copy.checkinTitle);
    const card = c.checkins.first();
    const end = card.getByRole("button", { name: c.copy.endChat, exact: true });
    const person = card.getByRole("button", { name: c.copy.contactPerson, exact: true });
    assert.equal(await end.getAttribute("class"), "helpdesk-secondary-button");
    assert.equal(await person.getAttribute("class"), "helpdesk-submit-button");
    await ask(harness, locale, "question 9");
    assert.equal(await c.checkins.count(), 1, "once per session");
    await end.focus();
    await page.keyboard.press("Enter");
    const rating = c.ratingCards.first();
    await rating.waitFor();
    assert.equal(await rating.evaluate((node) => node === document.activeElement), true, "the rating card takes focus, so it is read out");
    assert.equal(await c.ended.first().textContent(), c.copy.ended);
    assert.equal(await card.getByRole("button", { name: c.copy.endChat }).count(), 0, "an ended session cannot be ended again");
    assert.equal(await person.isVisible(), true, "the way to a person stays");
    await rating.getByRole("button", { name: fillTemplate(c.all.assistant.rateStar, { n: 4 }), exact: true }).click();
    await waitForCalls(harness, (calls) => count(calls, isAssistantRating) === 1);
    const rated = harness.calls.find(isAssistantRating)!;
    assert.equal(rated.path, `/api/helpdesk/assistant/${id(9)}/rating`, "the v3 endpoint, for the last answered assist");
    assert.deepEqual(rated.json, { rating: 4 });
    await c.panel.locator(".helpdesk-chat-rated").waitFor();
    assert.equal(await c.panel.locator(".helpdesk-chat-rated").textContent(), c.all.assistant.rated);
    assert.equal(await c.ratingCards.count(), 0, "rated once");
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains("helpdesk-chat-ended-card") ?? false), true, "focus stays on the end line, not lost with the star");
    // The next message starts a new session: 8 more questions before the next check-in.
    for (let n = 1; n < CHAT_SESSION_RULES.checkInAfterQuestions; n += 1) await ask(harness, locale, `again ${n}`);
    assert.equal(await c.checkins.count(), 1, "the counter restarted");
    await ask(harness, locale, "again 8");
    await page.waitForFunction(() => document.querySelectorAll(".helpdesk-chat-card-checkin").length === 2);
    // Contact a person works like the handover card.
    await c.checkins.nth(1).getByRole("button", { name: c.copy.contactPerson, exact: true }).click();
    assert.equal(await c.subject.evaluate((node) => node === document.activeElement), true);
    await page.close();
  }
});

test("v4 Part B: End chat with nothing answered thanks the learner; Skip on the rating card stores nothing; a failed save can be retried", async () => {
  const locale: Locale = "en-GB";
  const harness = await open(locale);
  const { page } = harness;
  const c = ui(page, locale);
  // Fallbacks with requests for a person in between: 8 questions, no answer, no unsolved pair.
  for (let n = 1; n <= 4; n += 1) { await ask(harness, locale, `?q${n}`); await ask(harness, locale, "human please"); }
  assert.equal(await c.checkins.count(), 0, "the 8th question asked for a person: no reply yet");
  await ask(harness, locale, "?q9");
  await c.checkins.first().waitFor();
  await c.checkins.first().getByRole("button", { name: c.copy.endChat }).click();
  await c.panel.getByText(c.copy.endThanks, { exact: true }).waitFor();
  assert.equal(await c.ratingCards.count(), 0, "nothing answered: a short thanks, no rating card");
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains("helpdesk-chat-ended-card") ?? false), true, "focus moves to the thanks, so it is read out");

  let fail = true;
  const second = await open(locale, api({ rating: (call) => (fail ? { status: 503 } : { json: { id: call.path.split("/")[4], rating: 5 } }) }));
  const s = ui(second.page, locale);
  for (let n = 1; n <= 8; n += 1) await ask(second, locale, `q${n}`);
  await s.checkins.first().getByRole("button", { name: s.copy.endChat }).click();
  const card = s.ratingCards.first();
  await card.getByRole("button", { name: "5 out of 5", exact: true }).click();
  await card.getByRole("alert").waitFor();
  assert.equal(await card.getByRole("alert").textContent(), s.all.assistant.rateError);
  fail = false;
  await card.getByRole("button", { name: "5 out of 5", exact: true }).click();
  await s.panel.locator(".helpdesk-chat-rated").waitFor();
  assert.equal(count(second.calls, isAssistantRating), 2);
  await second.page.close();

  const third = await open(locale);
  const t = ui(third.page, locale);
  for (let n = 1; n <= 8; n += 1) await ask(third, locale, `q${n}`);
  await t.checkins.first().getByRole("button", { name: t.copy.endChat }).click();
  await t.ratingCards.first().getByRole("button", { name: t.all.assistant.skip, exact: true }).click();
  assert.equal(await t.ratingCards.count(), 0);
  assert.equal(count(third.calls, isAssistantRating), 0, "Skip stores nothing");
  assert.equal(await t.ended.first().textContent(), t.copy.ended);
  await page.close();
  await third.page.close();
});

test("v4 Part B: 10 minutes with no learner input after an AI answer end the session with the rating card (fake clock); the next message starts afresh", async () => {
  for (const locale of LOCALES) {
    const harness = await open(locale, api(), true);
    const { page } = harness;
    const c = ui(page, locale);
    await ask(harness, locale, "?first");
    await ask(harness, locale, "second");
    await page.clock.runFor(CHAT_SESSION_RULES.idleMs - 60_000);
    await c.input.fill("typing counts as input");
    await page.clock.runFor(CHAT_SESSION_RULES.idleMs - 1_000);
    assert.equal(await c.ended.count(), 0, "still open: the learner typed 9 minutes in");
    await page.clock.runFor(2_000);
    await c.ended.first().waitFor();
    assert.equal(await c.ended.first().textContent(), c.copy.ended);
    const rating = c.ratingCards.first();
    await rating.waitFor();
    assert.equal(await rating.evaluate((node) => node === document.activeElement), false, "an idle end does not move focus");
    await page.waitForFunction((text) => document.querySelector(".helpdesk-chat-live")?.textContent?.startsWith(text) ?? false, c.copy.ended);
    await rating.getByRole("button", { name: fillTemplate(c.all.assistant.rateStar, { n: 3 }), exact: true }).click();
    await waitForCalls(harness, (calls) => count(calls, isAssistantRating) === 1);
    assert.equal(harness.calls.find(isAssistantRating)!.path, `/api/helpdesk/assistant/${id(2)}/rating`, "the last answered assist (not the fallback)");
    // A new session: the fallback before the end does not pair with one after it.
    await ask(harness, locale, "?third");
    assert.equal(await c.handovers.count(), 0, "the unsolved count restarted");
    assert.equal(await c.input.isDisabled(), false);
    // A session with only a fallback ends with the line and no rating card.
    await page.clock.runFor(CHAT_SESSION_RULES.idleMs + 1_000);
    await page.waitForFunction(() => document.querySelectorAll(".helpdesk-chat-ended").length === 2);
    assert.equal(await c.ratingCards.count(), 0, "nothing answered in that session");
    await page.clock.runFor(CHAT_SESSION_RULES.idleMs * 3);
    assert.equal(await c.ended.count(), 2, "an ended session does not end again");
    await page.close();
  }
});

test("v4 Part B: the cards and the end come back after a reload; a chat left idle while the page was away ends when it loads; no timer before an answer", async () => {
  const locale: Locale = "en-GB";
  const harness = await open(locale, api(), true);
  const { page } = harness;
  let c = ui(page, locale);
  await ask(harness, locale, "agent");
  await page.clock.runFor(CHAT_SESSION_RULES.idleMs * 2);
  assert.equal(await c.ended.count(), 0, "a request for a person alone starts no idle timer");
  await ask(harness, locale, "?one");
  await ask(harness, locale, "?two");
  await c.handovers.nth(1).waitFor();
  // Another account takes the tab; the first comes back 11 minutes later.
  await mountContact(page, { locale, chips: [], account: { id: "user_other", name: "Other", email: "other@example.com" } });
  await page.clock.runFor(CHAT_SESSION_RULES.idleMs + 60_000);
  await mountContact(page, { locale, chips: [], account: ACCOUNT });
  c = ui(page, locale);
  await c.ended.first().waitFor();
  assert.equal(await c.handovers.count(), 2, "both handover cards come back");
  assert.equal(await c.ratingCards.count(), 0, "nothing answered in that session");
  await c.handovers.first().getByRole("button", { name: c.copy.handoverButton }).click();
  assert.equal(await c.subject.evaluate((node) => node === document.activeElement), true, "a card from a reloaded chat still opens the form");
  await page.close();
});

test("v4 Part B: after an enquiry was sent, the handover card opens a fresh form; the chat answers go with that enquiry too", async () => {
  const locale: Locale = "en-GB";
  const harness = await open(locale);
  const { page } = harness;
  const c = ui(page, locale);
  await ask(harness, locale, "first");
  await c.subject.fill("First enquiry");
  await c.message.fill("Something went wrong.");
  await c.submit.click();
  await page.getByRole("heading", { name: c.all.success.title }).waitFor();
  await ask(harness, locale, "real person");
  await c.handovers.first().getByRole("button", { name: c.copy.handoverButton }).click();
  await c.subject.waitFor();
  assert.equal(await c.subject.inputValue(), "", "a fresh form");
  assert.equal(await c.subject.evaluate((node) => node === document.activeElement), true);
  await c.subject.fill("Second enquiry");
  await c.message.fill("Still wrong.");
  await c.submit.click();
  await waitForCalls(harness, (calls) => count(calls, isTicketCreate) === 2);
  assert.deepEqual(harness.calls.filter(isTicketCreate)[1].fields.assistIds, [id(1)]);
  await page.close();
});
