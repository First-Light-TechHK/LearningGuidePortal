// v7 (2026-10-30, owner: a "thinking" wait state with CoT-like progress lines): while the server works on a typed
// question, the chat shows the Thinking card and one fixed line per workflow step the server streamed (never model
// text); finished steps get a check, the current one a spinner, and the live region reads the current line. No Figma
// frame: 待视觉验收. The stream is fed by hand here (a stubbed fetch), so each step can be checked as it arrives.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import { getMessages } from "../../lib/i18n/messages";
import { LOCALES, mountContact, openHarness, type Locale } from "./helpers/helpdesk-browser";

let browser: Browser;
before(async () => { browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined }); });
after(async () => { await browser?.close(); });

const id = (n: number) => `01a18700-0000-7000-8000-${String(n).padStart(12, "0")}`;
const SESSION = id(900);
const ANSWER = { id: id(1), reply: { id: id(1), faqId: id(101), question: "How do I reset my password?", answer: "Open **Settings** and choose Reset." }, alternatives: [] };

/**
 * The page's fetch for POST /api/helpdesk/assistant answers with a stream the test writes to (window.__stream).
 * A plain script string: tsx would wrap the functions of a page.evaluate callback in its own name helper.
 */
const STUB = `(() => {
  const original = window.fetch.bind(window);
  window.__accept = [];
  window.fetch = async (input, init) => {
    const url = new URL(String(input instanceof Request ? input.url : input), location.href);
    if (url.pathname !== "/api/helpdesk/assistant" || !init || init.method !== "POST") return original(input, init);
    window.__accept.push(new Headers(init.headers).get("accept") || "");
    const encoder = new TextEncoder();
    const body = new ReadableStream({ start(controller) { window.__stream = { push: (text) => controller.enqueue(encoder.encode(text)), close: () => controller.close() }; } });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
})()`;

async function stubStream(page: Page) {
  await page.evaluate(STUB);
}

const push = (page: Page, event: string, data: unknown) => page.evaluate(`window.__stream.push(${JSON.stringify(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)})`);

async function open(locale: Locale) {
  const harness = await openHarness(browser, locale, () => ({ status: 500 }));
  await mountContact(harness.page, { locale, session: { sessionId: SESSION, chips: [], situational: false, waitingTicket: null, releaseVersion: 2 } });
  await stubStream(harness.page);
  const copy = getMessages(locale).helpdesk.chat;
  const panel = harness.page.getByRole("region", { name: copy.title });
  return { page: harness.page, copy, panel, card: panel.locator(".helpdesk-chat-thinking"), live: panel.locator(".helpdesk-chat-live"), input: panel.getByRole("textbox", { name: copy.inputLabel }) };
}

test("v7 Thinking card: 'Thinking' at once, then one fixed line per streamed step (check when done, spinner on the current one), read out by the live region; the answer replaces it", async () => {
  for (const locale of LOCALES) {
    const { page, copy, panel, card, live, input } = await open(locale);
    await input.fill("reset password");
    await input.press("Enter");
    await card.waitFor();
    assert.equal(await card.locator(".helpdesk-chat-thinking-title").textContent(), copy.thinking);
    assert.equal(await card.locator(".helpdesk-chat-thinking-step").count(), 0, "no line before the server says what it is doing");
    assert.equal(await live.textContent(), copy.typing);
    assert.equal(await card.getAttribute("aria-hidden"), "true", "screen readers get the live region, not the card twice");
    assert.match((await page.evaluate<string[]>("window.__accept"))[0], /text\/event-stream/, "the chat asks for the stream");

    await push(page, "step", { step: "retrieve" });
    await page.waitForFunction((line) => document.querySelector(".helpdesk-chat-live")?.textContent === line, copy.thinkingRetrieve);
    const steps = card.locator(".helpdesk-chat-thinking-step");
    assert.deepEqual(await steps.allTextContents(), [copy.thinkingRetrieve]);
    assert.equal(await steps.nth(0).locator(".helpdesk-chat-thinking-spinner").count(), 1, "the current step spins");

    await push(page, "step", { step: "pick" });
    await push(page, "step", { step: "pick" });
    await push(page, "step", { step: "not_a_step" });
    await push(page, "step", { step: "ground" });
    await page.waitForFunction((n) => document.querySelectorAll(".helpdesk-chat-thinking-step").length === n, 3);
    assert.deepEqual(await steps.allTextContents(), [copy.thinkingRetrieve, copy.thinkingPick, copy.thinkingGround], "each step once, in order; an unknown name is ignored");
    assert.deepEqual(await steps.evaluateAll((items) => items.map((item) => item.getAttribute("data-done"))), ["true", "true", null]);
    assert.equal(await steps.nth(0).locator("svg").count(), 1, "a finished step has a check");
    assert.equal(await live.textContent(), copy.thinkingGround);
    assert.equal(await panel.getByRole("button", { name: copy.send, exact: true }).isDisabled(), true, "one question at a time");

    await push(page, "result", ANSWER);
    await page.waitForFunction(() => !document.querySelector(".helpdesk-chat-thinking") && document.querySelectorAll(".helpdesk-chat-answer").length === 1);
    assert.match((await panel.locator(".helpdesk-chat-answer").textContent()) ?? "", /Settings/);
    assert.notEqual(await live.textContent(), copy.thinkingGround);
    await page.close();
  }
});

test("v7 Thinking card: an error event shows the same message as the plain error (rate limit), and the card goes", async () => {
  const { page, copy, panel, card, input } = await open("en-GB");
  await input.fill("reset password");
  await input.press("Enter");
  await card.waitFor();
  await push(page, "step", { step: "retrieve" });
  await push(page, "error", { status: 429, code: "rate_limited", retryAfter: 60 });
  await page.waitForFunction(() => !document.querySelector(".helpdesk-chat-thinking"));
  assert.equal(await panel.locator(".helpdesk-chat-error").textContent(), copy.rateLimited);
  await page.close();
});

test("v7 Thinking card: no spinner, dot or slide-in animation under reduced motion", async () => {
  const { page, card, input } = await open("en-GB");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await input.fill("reset password");
  await input.press("Enter");
  await card.waitFor();
  await push(page, "step", { step: "retrieve" });
  await card.locator(".helpdesk-chat-thinking-spinner").waitFor();
  const names = await card.evaluate((node) => [".helpdesk-chat-dots > span", ".helpdesk-chat-thinking-spinner", ".helpdesk-chat-thinking-step"].map((selector) => getComputedStyle(node.querySelector(selector)!).animationName));
  assert.deepEqual(names, ["none", "none", "none"]);
  await page.close();
});
