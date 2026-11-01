// The AI Support Assistant panel's Gemini-style look (owner 2026-10-31: "像 Gemini 的设计和动效", colour and motion
// in depth; original work, our own spark mark and palette). UI only: these tests lock what the look adds and that
// it never gets in the way:
// 1. only what arrives in this view animates (a sent question rises, a reply reveals top-down); a transcript
//    restored from the tab never replays, and the reveal leaves no mask behind that could clip a focus ring;
// 2. while the assistant works the spark turns with its halo, skeleton lines flow and the composer's ring runs;
//    all of it goes with the reply;
// 3. the header hairline shows only once the log scrolls;
// 4. the marks are decoration (hidden from screen readers, never focusable) and the text colours read at
//    WCAG AA (4.5:1) on the surfaces they sit on;
// 5. the panel's own glow (owner 2026-10-31: "四边都有的荧光，有散射"): a crisp spectrum edge on all four sides and a
//    blurred scatter round it; it spreads, pulses and runs a comet while the assistant works, flares once when the
//    reply lands, and stays under the panel's content;
// 6. under prefers-reduced-motion nothing animates.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import { getMessages } from "../../lib/i18n/messages";
import { isAssistant, mountContact, openHarness, type Handler, type Locale } from "./helpers/helpdesk-browser";

let browser: Browser;
before(async () => { browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined }); });
after(async () => { await browser?.close(); });

const id = (n: number) => `01a18800-0000-7000-8000-${String(n).padStart(12, "0")}`;
const SESSION = id(900);
const CHIPS = [{ id: id(101), question: "How do I reset my password?", reason: "popular" as const }, { id: id(102), question: "How can I access my course materials?", reason: "popular" as const }];
const LONG = Array.from({ length: 14 }, (_, n) => `${n + 1}. Step ${n + 1}: open **Settings**, then follow the line on screen.`).join("\n");

function reply(n: number, text = "Open **Settings** and choose Reset.") {
  return { json: { id: id(n), reply: { id: id(n), faqId: id(101), question: "How do I reset my password?", answer: text }, alternatives: [] } };
}

async function open(locale: Locale, handler: Handler, reducedMotion: "reduce" | "no-preference" = "no-preference") {
  const harness = await openHarness(browser, locale, handler);
  await harness.page.emulateMedia({ reducedMotion });
  await harness.page.setViewportSize({ width: 1440, height: 1024 });
  const mount = () => mountContact(harness.page, { locale, session: { sessionId: SESSION, chips: CHIPS, situational: false, waitingTicket: null, releaseVersion: null } });
  await mount();
  const copy = getMessages(locale).helpdesk.chat;
  const panel = harness.page.getByRole("region", { name: copy.title });
  return { ...harness, mount, copy, panel, input: panel.getByRole("textbox", { name: copy.inputLabel }) };
}

async function ask(page: Page, input: ReturnType<Page["locator"]>, message: string, answers: number) {
  await input.fill(message);
  await input.press("Enter");
  await page.waitForFunction((n) => document.querySelectorAll(".helpdesk-chat-answer").length === n && !document.querySelector(".helpdesk-chat-typing"), answers);
}

const animationOf = (page: Page, selector: string) => page.locator(selector).last().evaluate((node) => getComputedStyle(node).animationName);

test("only what arrives in this view animates: the question rises, the reply reveals; a restored transcript never replays and no mask is left behind", async () => {
  let n = 0;
  const { page, panel, input, mount } = await open("en-GB", (call) => (isAssistant(call) ? reply(++n) : { status: 500 }));
  await ask(page, input, "reset password", 1);
  assert.match(await page.locator(".helpdesk-chat-mine").last().getAttribute("class") ?? "", /\bis-new\b/);
  assert.match(await page.locator(".helpdesk-chat-row[data-entry]").last().getAttribute("class") ?? "", /\bis-new\b/);
  assert.equal(await animationOf(page, ".helpdesk-chat-mine .helpdesk-chat-question"), "hc-send", "the question rises from the composer");
  assert.equal(await animationOf(page, ".helpdesk-chat-answer"), "hc-reveal", "the reply reveals top-down");
  // Once the reveal ends no mask is left on the reply, so nothing clips the vote's focus ring.
  await page.waitForTimeout(1300);
  assert.equal(await page.locator(".helpdesk-chat-answer").last().evaluate((node) => getComputedStyle(node).maskImage || getComputedStyle(node).webkitMaskImage), "none");
  await panel.getByRole("button", { name: getMessages("en-GB").helpdesk.chat.yes, exact: true }).focus();
  // A remount reads the transcript from the tab: nothing replays.
  await mount();
  await page.waitForFunction(() => document.querySelectorAll(".helpdesk-chat-answer").length === 1);
  assert.equal(await page.locator(".is-new").count(), 0, "restored entries are not new");
  assert.equal(await animationOf(page, ".helpdesk-chat-answer"), "none");
  assert.equal(await animationOf(page, ".helpdesk-chat-question"), "none");
  // The next one is new again.
  await ask(page, input, "and again", 2);
  assert.deepEqual(await page.locator("[data-entry].is-new").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-entry"))), ["2", "3"]);
  await page.close();
});

test("while the assistant works the spark turns with its halo, skeleton lines flow and the composer ring runs; all of it goes with the reply", async () => {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const { page, panel, input } = await open("zh-CN", async (call) => {
    if (!isAssistant(call)) return { status: 500 };
    await held;
    return reply(1);
  });
  await input.fill("重置密码");
  await input.press("Enter");
  const thinking = page.locator(".helpdesk-chat-avatar[data-state=thinking]");
  await thinking.waitFor();
  assert.equal(await thinking.locator(".helpdesk-chat-spark").evaluate((node) => getComputedStyle(node).animationName), "hc-spin");
  assert.match(await thinking.evaluate((node) => getComputedStyle(node, "::before").animationName), /hc-halo/);
  assert.equal(await page.locator(".helpdesk-chat-skeleton > span").count(), 3);
  assert.equal(await page.locator(".helpdesk-chat-skeleton > span").first().evaluate((node) => getComputedStyle(node).animationName), "hc-flow");
  assert.equal(await page.locator(".helpdesk-chat-composer").getAttribute("data-busy"), "true");
  await page.waitForTimeout(400);
  assert.equal(await page.locator(".helpdesk-chat-composer").evaluate((node) => getComputedStyle(node, "::before").opacity), "1", "the ring runs while the assistant works");
  release();
  await page.waitForFunction(() => document.querySelectorAll(".helpdesk-chat-answer").length === 1);
  assert.equal(await thinking.count(), 0);
  assert.equal(await page.locator(".helpdesk-chat-skeleton").count(), 0);
  assert.equal(await page.locator(".helpdesk-chat-composer").getAttribute("data-busy"), null);
  assert.equal(await panel.locator(".helpdesk-chat-row.is-new .helpdesk-chat-spark").last().evaluate((node) => getComputedStyle(node).animationName), "hc-land", "the spark lands on the reply");
  await page.close();
});

test("the header hairline shows only once the log scrolls", async () => {
  let n = 0;
  const { page, input } = await open("en-GB", (call) => (isAssistant(call) ? reply(++n, LONG) : { status: 500 }));
  const divider = page.locator(".helpdesk-chat-divider");
  assert.equal(await divider.evaluate((node) => getComputedStyle(node).opacity), "0", "at the top: no line");
  await ask(page, input, "steps", 1);
  await ask(page, input, "more steps", 2);
  await page.waitForFunction(() => document.querySelector(".helpdesk-chat")?.getAttribute("data-scrolled") === "true");
  await page.waitForTimeout(400);
  assert.equal(await divider.evaluate((node) => getComputedStyle(node).opacity), "1");
  await page.locator(".helpdesk-chat-messages").evaluate((node) => { node.scrollTop = 0; });
  await page.waitForFunction(() => !document.querySelector(".helpdesk-chat")?.hasAttribute("data-scrolled"));
  await page.close();
});

/** WCAG relative-luminance contrast of two rgb() colours. */
function contrast(a: string, b: string) {
  const lum = (value: string) => {
    const [r, g, bl] = (value.match(/[\d.]+/g) ?? []).slice(0, 3).map((part) => Number(part) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test("the marks are decoration and every text colour reads at WCAG AA on its surface", async () => {
  let n = 0;
  const { page, panel, input, copy } = await open("en-GB", (call) => (isAssistant(call) ? (++n === 1 ? reply(n) : { json: { id: id(n), reply: null, alternatives: [] } }) : { status: 500 }));
  await ask(page, input, "reset password", 1);
  await ask(page, input, "something odd", 2);
  const sparks = page.locator(".helpdesk-chat-spark");
  assert.ok(await sparks.count() >= 3);
  assert.deepEqual([...new Set(await sparks.evaluateAll((nodes) => nodes.map((node) => `${node.getAttribute("aria-hidden")}/${node.getAttribute("focusable")}`)))], ["true/false"]);
  assert.equal(await panel.locator(".helpdesk-chat-avatar:not([aria-hidden=true])").count(), 0);
  const ids = await sparks.evaluateAll((nodes) => nodes.map((node) => node.querySelector("linearGradient")!.id));
  assert.equal(new Set(ids).size, ids.length, "each spark has its own gradient id");
  const pairs: Array<[string, string]> = [
    [".helpdesk-chat-header h2", ".helpdesk-chat-header"], [".helpdesk-chat-header p", ".helpdesk-chat-header"],
    [".helpdesk-chat-greeting-body", ".helpdesk-chat"], [".helpdesk-chat-greeting-limit", ".helpdesk-chat"], [".helpdesk-chat-ideas", ".helpdesk-chat"],
    [".helpdesk-chat-try", ".helpdesk-chat"], [".helpdesk-chat-chip", ".helpdesk-chat-chip"], [".helpdesk-chat-question", ".helpdesk-chat-question"],
    [".helpdesk-chat-answer-text", ".helpdesk-chat"], [".helpdesk-chat-feedback > span", ".helpdesk-chat"], [".helpdesk-chat-vote", ".helpdesk-chat"],
    [".helpdesk-chat-fallback", ".helpdesk-chat"], [".helpdesk-chat-info p", ".helpdesk-chat-info"], [".helpdesk-chat-input", ".helpdesk-chat-composer"]
  ];
  await page.waitForTimeout(1300);
  for (const [text, surface] of pairs) {
    const ink = await page.locator(text).first().evaluate((node) => getComputedStyle(node).color);
    const fill = await page.locator(surface).first().evaluate((node) => {
      const own = getComputedStyle(node).backgroundColor;
      // The question bubble's fill is a gradient: take its lighter (worse) end.
      const image = getComputedStyle(node).backgroundImage;
      return image.startsWith("linear-gradient") ? (image.match(/rgb\([^)]+\)/g) ?? [own]).sort().pop()! : own === "rgba(0, 0, 0, 0)" ? "rgb(255, 255, 255)" : own;
    });
    assert.ok(contrast(ink, fill) >= 4.5, `${text} on ${surface}: ${ink} on ${fill} is ${contrast(ink, fill).toFixed(2)}:1`);
  }
  // The placeholder too.
  const placeholder = await input.evaluate((node) => getComputedStyle(node, "::placeholder").color);
  assert.ok(contrast(placeholder, "rgb(240, 244, 249)") >= 4.5, `placeholder ${placeholder}`);
  assert.equal(copy.title.length > 0, true);
  await page.close();
});

test("under prefers-reduced-motion nothing animates: no rise, reveal, stagger, sweep or ring", async () => {
  let n = 0;
  const { page, input } = await open("en-GB", (call) => (isAssistant(call) ? reply(++n) : { status: 500 }), "reduce");
  await ask(page, input, "reset password", 1);
  const names = await page.evaluate(() => [...document.querySelectorAll(".helpdesk-chat *")].map((node) => getComputedStyle(node).animationName).filter((name) => name !== "none"));
  assert.deepEqual(names, [], "no element animates");
  const pseudo = await page.evaluate(() => [...document.querySelectorAll(".helpdesk-chat, .helpdesk-chat-composer, .helpdesk-chat-avatar")].map((node) => getComputedStyle(node, "::before").animationName).filter((name) => name !== "none"));
  assert.deepEqual(pseudo, []);
  await page.close();
});

test("the panel glows on all four sides with a scatter; it wakes up while the assistant works, runs a comet, flares once on the reply, and never covers the content", async () => {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const { page, panel, input } = await open("en-GB", async (call) => {
    if (!isAssistant(call)) return { status: 500 };
    await held;
    return reply(1);
  });
  const pseudo = (which: "::before" | "::after", property: string) => panel.evaluate((node, [after, name]) => getComputedStyle(node, after).getPropertyValue(name), [which, property] as const);
  // The edge: 2 px of the spectrum on every side, the white surface inside it, just outside the panel's box.
  assert.deepEqual(await Promise.all(["border-top-width", "border-right-width", "border-bottom-width", "border-left-width"].map((side) => pseudo("::after", side))), ["2px", "2px", "2px", "2px"]);
  assert.match(await pseudo("::after", "background-image"), /conic-gradient/);
  assert.equal(await pseudo("::after", "top"), "-1px");
  // The scatter: the same spectrum, blurred, a little larger than the panel on every side.
  assert.match(await pseudo("::before", "background-image"), /conic-gradient/);
  assert.match(await pseudo("::before", "filter"), /^blur\(1[4-8]px\)$/);
  assert.ok(Number.parseFloat(await pseudo("::before", "top")) < 0 && Number.parseFloat(await pseudo("::before", "left")) < 0);
  assert.match(await pseudo("::before", "animation-name"), /^hc-angle, hc-breathe$/, "idle: it turns and breathes");
  // Both sit under the content: the panel is its own stacking context.
  assert.equal(await panel.evaluate((node) => getComputedStyle(node).isolation), "isolate");
  assert.deepEqual([await pseudo("::before", "z-index"), await pseudo("::after", "z-index")], ["-2", "-1"]);
  assert.equal(await panel.locator(".helpdesk-chat-chip").first().evaluate((node) => { const box = node.getBoundingClientRect(); return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === node || node.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)); }), true, "the chips stay clickable");
  // Thinking: it spreads, pulses faster and a comet runs round the edge; the colours keep turning.
  await input.fill("reset password");
  await input.press("Enter");
  await page.waitForFunction(() => document.querySelector(".helpdesk-chat")?.getAttribute("data-state") === "thinking");
  assert.equal(await pseudo("::before", "animation-name"), "hc-angle, hc-breathe-fast");
  assert.equal(await pseudo("::after", "animation-name"), "hc-angle, hc-comet");
  release();
  // The reply lands: one flare, then back to breathing.
  await page.waitForFunction(() => document.querySelector(".helpdesk-chat")?.getAttribute("data-flare") === "true");
  assert.equal(await panel.getAttribute("data-state"), null);
  assert.equal(await pseudo("::before", "animation-name"), "hc-angle, hc-flare");
  await page.waitForFunction(() => !document.querySelector(".helpdesk-chat")?.hasAttribute("data-flare"), undefined, { timeout: 3000 });
  assert.equal(await pseudo("::before", "animation-name"), "hc-angle, hc-breathe");
  await page.close();
});
