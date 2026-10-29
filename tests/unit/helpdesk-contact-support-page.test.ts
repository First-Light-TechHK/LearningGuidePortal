// Contact Support (components/helpdesk/ContactSupport.tsx) rendered in Chromium:
// form validation, the attachment drop zone, paste, the topic list, the AI
// Support Assistant modal (Yes / No / Edit / Close / Escape, focus trap), Cancel
// during the suggestion check, the never-blocking suggestion (null, error,
// 5 s timeout), Idempotency-Key reuse on a lost response, 429 / 4xx messages,
// the AI Support Assistant chat panel (Figma 1216:6: chips, ask, answer,
// Related FAQ, Helpful, fallback, errors, sessionStorage, Enter / Shift+Enter,
// assistIds on submit) and the success state, in en-GB and zh-CN.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser, type Locator, type Page } from "playwright";
import { parseCreateTicketInput } from "../../contracts/helpdesk";
import { getMessages } from "../../lib/i18n/messages";
import { fillTemplate } from "../../modules/helpdesk/learnerUi";
import { PNG } from "./helpdesk-fixtures";
import { ACCOUNT, LOCALES, isAssistant, isAssistantFeedback, isOutcome, isSuggestion, isTicketCreate, mountContact, openHarness, ticketFixture, waitForCalls, type ApiCall, type Handler, type Harness, type Locale, type Reply } from "./helpers/helpdesk-browser";

let browser: Browser;
before(async () => { browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined }); });
after(async () => { await browser?.close(); });

const copyFor = (locale: Locale) => getMessages(locale).helpdesk;
const SUGGESTION = { id: "01a18100-0000-7000-8000-0000000000aa", faqId: "01a18100-0000-7000-8000-0000000000fa", question: "How do I reset my password?", answer: "1. Reset your password\nOpen https://example.com/reset\n\n2. Still nothing?\nCheck your spam folder" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

/** Routes the Contact Support endpoints (suggestion, outcome, ticket, chat, chat feedback); anything else is a 500. */
function api(handlers: { suggestion?: Handler; ticket?: Handler; outcome?: Handler; assistant?: Handler; feedback?: Handler }): Handler {
  return (call) => {
    if (isAssistant(call)) return handlers.assistant ? handlers.assistant(call) : { json: { id: "01a18100-0000-7000-8000-0000000000c0", reply: null } };
    if (isAssistantFeedback(call)) return handlers.feedback ? handlers.feedback(call) : { json: { id: call.path.split("/")[4], feedback: (call.json as { helpful: boolean }).helpful ? "helpful" : "not_helpful" } };
    if (isSuggestion(call)) return handlers.suggestion ? handlers.suggestion(call) : { json: { suggestion: null } };
    if (isOutcome(call)) return handlers.outcome ? handlers.outcome(call) : { status: 204 };
    if (isTicketCreate(call)) return handlers.ticket ? handlers.ticket(call) : { status: 201, json: ticketFixture("OPEN") };
    return { status: 500 };
  };
}

/** Sets a field through the native setter, so control characters and long text arrive exactly as given. */
async function setValue(locator: Locator, value: string) {
  await locator.evaluate((element, next) => {
    const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, next);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

function form(page: Page, locale: Locale) {
  const copy = copyFor(locale);
  return {
    copy,
    topic: page.getByRole("combobox"),
    subject: page.getByRole("textbox", { name: copy.subject, exact: true }),
    message: page.getByRole("textbox", { name: copy.message, exact: true }),
    email: page.getByRole("textbox", { name: copy.email, exact: true }),
    submit: page.locator("button.helpdesk-submit-button[type=submit]"),
    cancel: page.getByRole("button", { name: copy.cancel, exact: true }),
    fileInput: page.locator(".helpdesk-dropzone input[type=file]"),
    chips: page.locator(".helpdesk-attachments .helpdesk-file-chip .helpdesk-file-name"),
    dialog: page.getByRole("dialog", { name: copy.assistant.title }),
    alert: page.locator(".helpdesk-form > p[role=alert]"),
    fileAlert: page.locator(".helpdesk-attachments p[role=alert]")
  };
}

async function chooseTopic(page: Page, locale: Locale, category: keyof ReturnType<typeof copyFor>["categories"] = "technical_support") {
  const f = form(page, locale);
  await f.topic.click();
  await page.getByRole("option", { name: f.copy.categories[category], exact: true }).click();
}

async function fillValid(page: Page, locale: Locale, withFile = true) {
  const f = form(page, locale);
  await chooseTopic(page, locale);
  await f.subject.fill("  Cannot reset my password  ");
  await f.message.fill("The reset email never arrives.\nI checked spam.");
  if (withFile) await f.fileInput.setInputFiles({ name: "screen.png", mimeType: "image/png", buffer: PNG });
}

async function activeIs(locator: Locator) {
  return locator.evaluate((element) => element === document.activeElement);
}

async function open(locale: Locale, handler: Handler, props: Parameters<typeof mountContact>[1] = { locale }): Promise<Harness> {
  const harness = await openHarness(browser, locale, handler);
  await mountContact(harness.page, props);
  return harness;
}

const count = (calls: ApiCall[], predicate: (call: ApiCall) => boolean) => calls.filter(predicate).length;

test("validation: required fields are announced, focus goes to the first invalid one and nothing is sent", async () => {
  for (const locale of LOCALES) {
    const harness = await open(locale, api({}));
    const { page } = harness;
    const f = form(page, locale);
    assert.equal(await f.email.inputValue(), "emily@example.com", "the account email is prefilled");
    assert.equal(await f.topic.textContent(), f.copy.selectTopic);
    for (const field of [f.topic, f.subject, f.message, f.email]) assert.equal(await field.getAttribute("aria-required"), "true");
    await f.submit.click();
    for (const text of [f.copy.validation.category, f.copy.validation.subject, f.copy.validation.message]) assert.equal(await page.getByText(text, { exact: true }).count(), 1, `${locale}: ${text}`);
    assert.equal(await page.getByText(f.copy.validation.email, { exact: true }).count(), 0, "the prefilled email is valid");
    assert.equal(await f.topic.getAttribute("aria-invalid"), "true");
    assert.ok(await activeIs(f.topic), "focus moves to the first invalid field (Enquiry Type)");
    const describedBy = await f.subject.getAttribute("aria-describedby");
    assert.equal(await page.locator(`[id="${describedBy}"]`).textContent(), f.copy.validation.subject, "the error is the field's description");
    await chooseTopic(page, locale, "payments_subscriptions");
    assert.equal(await f.topic.textContent(), f.copy.categories.payments_subscriptions);
    assert.equal(await page.getByText(f.copy.validation.category, { exact: true }).count(), 0, "choosing a topic clears its error at once");
    await f.subject.fill("Password");
    await f.message.fill("Help");
    for (const bad of ["two words@example.com", "a@b", "", "a@b.c\nBcc: x@y.z"]) {
      await setValue(f.email, bad);
      await f.submit.click();
      assert.equal(await page.getByText(f.copy.validation.email, { exact: true }).count(), 1, JSON.stringify(bad));
      assert.ok(await activeIs(f.email));
    }
    assert.equal(harness.calls.length, 0, "an invalid form never asks for a suggestion or creates a ticket");
    await page.close();
  }
});

test("validation: 120 / 5000 code-point limits, control characters and invisible-only text match the server", async () => {
  const locale: Locale = "en-GB";
  const harness = await open(locale, api({}));
  const { page } = harness;
  const f = form(page, locale);
  assert.equal(await f.subject.getAttribute("maxlength"), "240", "maxLength never cuts 120 emoji (240 UTF-16 units)");
  assert.equal(await f.message.getAttribute("maxlength"), "10000");
  assert.equal(await f.email.getAttribute("maxlength"), "254");
  const emoji = "\u{1F600}";
  // Topic left empty so a valid form still stops at validation.
  const subjects: Array<[string, boolean]> = [[emoji.repeat(120), true], ["x".repeat(120), true], ["中".repeat(120), true], ["中".repeat(121), false], ["x".repeat(121), false],
    ["   ", false], ["​⁠", false], ["a\u0007b", false], ["del\u007f", false], ["c1\u0085", false], ["  padded  ", true]];
  await f.message.fill("ok");
  for (const [subject, valid] of subjects) {
    await setValue(f.subject, subject);
    await f.submit.click();
    assert.equal(await page.getByText(f.copy.validation.subject, { exact: true }).count(), valid ? 0 : 1, JSON.stringify(subject.slice(0, 12)) + ` (${[...subject].length} code points)`);
  }
  await f.subject.fill("ok");
  const bodies: Array<[string, boolean]> = [[emoji.repeat(5000), true], ["中".repeat(5000), true], ["中".repeat(5001), false], ["tab\tand\nnew\r\nline", true], ["a\u0000b", false], [" \n\t ", false]];
  for (const [body, valid] of bodies) {
    await setValue(f.message, body);
    await f.submit.click();
    assert.equal(await page.getByText(f.copy.validation.message, { exact: true }).count(), valid ? 0 : 1, JSON.stringify(body.slice(0, 12)) + ` (${[...body].length} code points)`);
  }
  assert.equal(harness.calls.length, 0);
  await page.close();
});

test("the topic list works by mouse and keyboard and closes on Escape, Tab and an outside click", async () => {
  const locale: Locale = "zh-CN";
  const harness = await open(locale, api({}));
  const { page } = harness;
  const f = form(page, locale);
  await f.topic.focus();
  await page.keyboard.press("ArrowDown");
  assert.equal(await f.topic.getAttribute("aria-expanded"), "true");
  assert.deepEqual(await page.getByRole("option").allTextContents(), ["technical_support", "course_content", "payments_subscriptions", "other"].map((key) => f.copy.categories[key as "other"]));
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  assert.equal(await f.topic.getAttribute("aria-activedescendant"), await page.getByRole("option").nth(2).getAttribute("id"));
  await page.keyboard.press("Enter");
  assert.equal(await f.topic.getAttribute("aria-expanded"), "false");
  assert.equal(await f.topic.textContent(), f.copy.categories.payments_subscriptions);
  await page.keyboard.press("ArrowUp");
  assert.equal(await page.locator("[role=option][aria-selected=true]").textContent(), f.copy.categories.payments_subscriptions, "reopening starts at the chosen topic");
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("listbox").count(), 0);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Tab");
  assert.equal(await page.getByRole("listbox").count(), 0, "Tab out closes the list");
  await f.topic.click();
  await page.locator("h1").click();
  assert.equal(await page.getByRole("listbox").count(), 0, "a click outside closes the list");
  await page.close();
});

test("attachments: allowed types only, 10 MB each, 5 per enquiry, removable; errors name the file", async () => {
  for (const locale of LOCALES) {
    const harness = await open(locale, api({}));
    const { page } = harness;
    const f = form(page, locale);
    assert.equal(await f.fileInput.getAttribute("accept"), ".png,.jpg,.jpeg,.webp,.gif,.pdf,.txt,.csv,.docx,.xlsx");
    await f.fileInput.setInputFiles([
      { name: "a.png", mimeType: "image/png", buffer: PNG },
      { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("steps") },
      { name: "logo.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") },
      { name: "run.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") }
    ]);
    assert.deepEqual(await f.chips.allTextContents(), ["a.png", "notes.txt"]);
    assert.equal(await f.fileAlert.textContent(), `${fillTemplate(f.copy.fileErrors.type, { name: "logo.svg" })} ${fillTemplate(f.copy.fileErrors.type, { name: "run.exe" })}`);
    // Drop: exactly 10 MB is fine, one byte more is not.
    await page.locator(".helpdesk-dropzone").evaluate((zone) => {
      const data = new DataTransfer();
      data.items.add(new File([new Uint8Array(10 * 1024 * 1024)], "edge.pdf", { type: "application/pdf" }));
      data.items.add(new File([new Uint8Array(10 * 1024 * 1024 + 1)], "huge.pdf", { type: "application/pdf" }));
      zone.dispatchEvent(new DragEvent("dragover", { dataTransfer: data, bubbles: true, cancelable: true }));
      zone.dispatchEvent(new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true }));
    });
    assert.deepEqual(await f.chips.allTextContents(), ["a.png", "notes.txt", "edge.pdf"]);
    assert.equal(await f.fileAlert.textContent(), fillTemplate(f.copy.fileErrors.size, { name: "huge.pdf" }));
    assert.equal(await page.locator(".helpdesk-dropzone.is-dragging").count(), 0, "drop ends the drag highlight");
    await f.fileInput.setInputFiles(["b", "c", "d"].map((name) => ({ name: `${name}.png`, mimeType: "image/png", buffer: PNG })));
    assert.deepEqual(await f.chips.allTextContents(), ["a.png", "notes.txt", "edge.pdf", "b.png", "c.png"], "the sixth file is refused");
    assert.equal(await f.fileAlert.textContent(), f.copy.fileErrors.count);
    assert.equal(await f.fileInput.inputValue(), "", "the picker is reset so the same file can be chosen again");
    await page.getByRole("button", { name: fillTemplate(f.copy.removeFile, { name: "notes.txt" }), exact: true }).click();
    assert.deepEqual(await f.chips.allTextContents(), ["a.png", "edge.pdf", "b.png", "c.png"]);
    assert.equal(await f.fileAlert.count(), 0, "removing a file clears the error");
    await f.fileInput.setInputFiles({ name: "e.PNG", mimeType: "image/png", buffer: PNG });
    assert.equal(await f.chips.count(), 5, "extensions are matched case-insensitively");
    assert.equal(harness.calls.length, 0, "attaching sends nothing");
    await page.close();
  }
});

test("paste: a screenshot attaches anywhere in the form, text pasted into a field stays text", async () => {
  const locale: Locale = "en-GB";
  const harness = await open(locale, api({}));
  const { page } = harness;
  const f = form(page, locale);
  const paste = (selector: string, file: { name: string; type: string } | null, text: string | null, html: string | null = null) => page.locator(selector).evaluate((target, input) => {
    const data = new DataTransfer();
    if (input.file) data.items.add(new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], input.file.name, { type: input.file.type }));
    if (input.text !== null) data.setData("text/plain", input.text);
    if (input.html !== null) data.setData("text/html", input.html);
    const event = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  }, { file, text, html });
  assert.equal(await paste(".helpdesk-dropzone", { name: "image.png", type: "image/png" }, null), true, "the pasted image is taken over by the page");
  assert.match((await f.chips.allTextContents())[0], /^screenshot-\d+\.png$/, "a clipboard image without a real name gets a screenshot name");
  assert.equal(await paste(".helpdesk-form textarea", { name: "image.png", type: "image/png" }, "A1\tB1"), false, "Excel / Word cells: the browser pastes the text");
  assert.equal(await f.chips.count(), 1, "the picture Office puts next to the text is not attached");
  assert.equal(await paste(".helpdesk-form textarea", { name: "image.png", type: "image/png" }, null, '<img src="https://example.com/x.png">'), true, "an image copied from a web page attaches");
  assert.equal(await f.chips.count(), 2);
  assert.equal(await paste(".helpdesk-form textarea", { name: "image.jpeg", type: "image/jpeg" }, " \n\t"), true, "blank text/plain is no text");
  assert.equal(await f.chips.count(), 3);
  assert.equal(await paste("input[aria-required]:not([type=email])", { name: "report.png", type: "image/png" }, null), true);
  assert.equal((await f.chips.allTextContents())[3], "report.png", "a named file keeps its name");
  assert.equal(await paste(".helpdesk-form textarea", null, "just text"), false, "plain text paste is left to the browser");
  assert.equal(await f.chips.count(), 4);
  assert.equal(await paste(".helpdesk-chat-input", { name: "chat.png", type: "image/png" }, null), false, "a paste into the chat panel is the chat's, never an attachment");
  assert.equal(await f.chips.count(), 4);
  await paste(".helpdesk-dropzone", { name: "logo.svg", type: "image/svg+xml" }, null);
  assert.equal(await f.fileAlert.textContent(), fillTemplate(f.copy.fileErrors.type, { name: "logo.svg" }), "pasted files get the same checks");
  await page.close();
});

test("Yes on the suggestion records 'solved', creates no ticket and returns to the account", async () => {
  for (const locale of LOCALES) {
    const release = deferred();
    const harness = await open(locale, api({ suggestion: async () => { await release.promise; return { json: { suggestion: SUGGESTION } }; } }));
    const { page } = harness;
    const f = form(page, locale);
    await fillValid(page, locale);
    await f.submit.click();
    await waitForCalls(harness, (calls) => count(calls, isSuggestion) === 1);
    assert.equal(await f.submit.textContent(), f.copy.assistant.checking);
    assert.equal(await f.submit.isDisabled(), true);
    assert.equal(await f.subject.isDisabled(), true, "the form is locked while checking");
    assert.equal(await f.cancel.isDisabled(), false, "Cancel stays available during the check");
    const asked = harness.calls.find(isSuggestion)!;
    assert.deepEqual(asked.json, { category: "technical_support", subject: "Cannot reset my password", message: "The reset email never arrives.\nI checked spam.", locale });
    release.resolve();
    await f.dialog.waitFor();
    assert.equal(await f.dialog.getAttribute("aria-modal"), "true");
    const text = await f.dialog.textContent();
    for (const part of [fillTemplate(f.copy.assistant.greeting, { name: "Emily" }), "Cannot reset my password", f.copy.categories.technical_support, "emily@example.com", "screen.png", "Check your spam folder", f.copy.assistant.helpful]) assert.ok(text?.includes(part), `${locale}: modal shows ${part}`);
    assert.deepEqual(await f.dialog.locator(".helpdesk-modal-answer ol > li").allTextContents(), ["Reset your passwordOpen https://example.com/reset", "Still nothing?Check your spam folder"], "the answer goes through the shared Markdown renderer: one numbered list");
    assert.equal(await f.dialog.locator(".helpdesk-modal-answer ol > li").first().evaluate((li) => getComputedStyle(li, "::first-line").fontWeight), "600", "each item's first line is its heading (1333:249)");
    const link = f.dialog.getByRole("link", { name: "https://example.com/reset" });
    assert.equal(await link.getAttribute("target"), "_blank");
    assert.equal(await link.getAttribute("rel"), "noopener noreferrer");
    await f.dialog.getByRole("button", { name: f.copy.assistant.yes }).click();
    await f.dialog.getByRole("status").getByText(f.copy.assistant.thanksTitle).waitFor();
    await waitForCalls(harness, (calls) => count(calls, isOutcome) === 1);
    const outcome = harness.calls.find(isOutcome)!;
    assert.equal(outcome.path, `/api/helpdesk/suggestions/${SUGGESTION.id}/outcome`);
    assert.deepEqual(outcome.json, { outcome: "solved" });
    assert.equal(await f.dialog.getByRole("button", { name: f.copy.assistant.close }).count(), 0, "the thanks step has no close button");
    await page.keyboard.press("Escape");
    assert.equal(await f.dialog.getByText(f.copy.assistant.thanksTitle).count(), 1, "Escape does not leave the thanks step");
    assert.equal(await f.dialog.getByRole("link", { name: f.copy.assistant.backToAccount }).getAttribute("href"), `/${locale}/account/my-learning`);
    await page.waitForFunction(() => (window as unknown as { __nav: unknown[] }).__nav.length > 0, null, { timeout: 5_000 });
    assert.deepEqual(await harness.nav(), [["push", `/${locale}/account/my-learning`]], "after the thanks the page goes back to the account");
    assert.equal(count(harness.calls, isTicketCreate), 0, "solved by the suggestion: no ticket");
    await page.close();
  }
});

test("No on the suggestion submits with its suggestionId; a lost response is resent with the same Idempotency-Key; success shows the ticket number", async () => {
  for (const locale of LOCALES) {
    let creates = 0;
    const ticket = ticketFixture("OPEN", { number: "LG-261028-0042", contactEmail: "emily@example.com" });
    const harness = await open(locale, api({
      suggestion: () => ({ json: { suggestion: SUGGESTION } }),
      ticket: () => (++creates === 1 ? { status: 503, json: { code: "helpdesk_unavailable" } } : { status: 201, json: ticket })
    }));
    const { page } = harness;
    const f = form(page, locale);
    await fillValid(page, locale);
    await f.email.fill(" emily@example.com ");
    await f.submit.click();
    await f.dialog.waitFor();
    await f.dialog.getByRole("button", { name: f.copy.assistant.no }).click();
    await waitForCalls(harness, (calls) => count(calls, isTicketCreate) === 1);
    assert.deepEqual(harness.calls.find(isOutcome)!.json, { outcome: "declined" });
    const first = harness.calls.find(isTicketCreate)!;
    assert.deepEqual(first.fields, { category: "technical_support", subject: "Cannot reset my password", body: "The reset email never arrives.\nI checked spam.", locale, contactEmail: "emily@example.com", suggestionId: SUGGESTION.id });
    assert.deepEqual(first.files, [{ name: "screen.png", size: PNG.length, type: "image/png" }]);
    assert.match(first.key ?? "", UUID);
    await f.alert.waitFor();
    assert.equal(await f.alert.textContent(), f.copy.errors.unavailable);
    assert.equal(await f.dialog.count(), 0, "the modal closes back to the form");
    assert.equal(await f.subject.inputValue(), "  Cannot reset my password  ", "the form is kept");
    assert.equal(await f.chips.count(), 1);
    await f.submit.click();
    await waitForCalls(harness, (calls) => count(calls, isTicketCreate) === 2);
    const second = harness.calls.filter(isTicketCreate)[1];
    assert.equal(second.key, first.key, "the retry replays the same logical submit");
    assert.equal(second.fields.suggestionId, SUGGESTION.id, "and still names the declined suggestion");
    assert.equal(count(harness.calls, isSuggestion), 1, "no second suggestion check for a resend");
    const success = page.locator(".helpdesk-success");
    await success.waitFor();
    assert.ok(await activeIs(success.getByRole("heading", { name: f.copy.success.title })), "focus moves to the success heading");
    assert.equal(await success.locator(".helpdesk-success-number").textContent(), "LG-261028-0042");
    assert.equal(await success.locator("p").first().textContent(), fillTemplate(f.copy.success.reference, { number: "LG-261028-0042" }));
    assert.ok((await success.textContent())?.includes(fillTemplate(f.copy.success.reply, { email: "emily@example.com" })));
    assert.equal(await success.getByRole("link", { name: f.copy.success.view }).getAttribute("href"), `/${locale}/account/my-learning/support/${ticket.id}`);
    assert.equal(await success.getByRole("link", { name: f.copy.success.list }).getAttribute("href"), `/${locale}/account/my-learning/support/enquiries`);
    assert.equal(await page.locator("form.helpdesk-form").count(), 0, "the form is replaced by the success state");
    await page.close();
  }
});

test("Edit keeps the form and focuses Subject; Close and Escape return focus to Submit; each resubmit asks again", async () => {
  const locale: Locale = "zh-CN";
  const harness = await open(locale, api({ suggestion: () => ({ json: { suggestion: SUGGESTION } }) }));
  const { page } = harness;
  const f = form(page, locale);
  await fillValid(page, locale);
  await f.submit.click();
  await f.dialog.waitFor();
  await f.dialog.getByRole("button", { name: f.copy.assistant.edit }).click();
  await f.dialog.waitFor({ state: "detached" });
  await page.waitForFunction(() => document.activeElement?.tagName === "INPUT");
  assert.ok(await activeIs(f.subject), "Edit goes to Subject");
  assert.equal(await f.subject.inputValue(), "  Cannot reset my password  ");
  assert.equal(await f.message.inputValue(), "The reset email never arrives.\nI checked spam.");
  assert.equal(await f.topic.textContent(), f.copy.categories.technical_support);
  assert.deepEqual(await f.chips.allTextContents(), ["screen.png"]);
  await f.submit.click();
  await f.dialog.waitFor();
  await page.keyboard.press("Escape");
  await f.dialog.waitFor({ state: "detached" });
  await page.waitForFunction(() => document.activeElement?.getAttribute("type") === "submit");
  await f.submit.click();
  await f.dialog.waitFor();
  await f.dialog.getByRole("button", { name: f.copy.assistant.close, exact: true }).click();
  await f.dialog.waitFor({ state: "detached" });
  await page.waitForFunction(() => document.activeElement?.getAttribute("type") === "submit");
  await waitForCalls(harness, (calls) => count(calls, isOutcome) === 3);
  assert.deepEqual(harness.calls.filter(isOutcome).map((call) => call.json?.outcome), ["edited", "edited", "edited"]);
  assert.equal(count(harness.calls, isSuggestion), 3, "every new Submit after Edit asks for a suggestion again");
  assert.equal(count(harness.calls, isTicketCreate), 0, "Edit / Close / Escape never create a ticket");
  await page.close();
});

test("the assistant modal traps Tab, takes focus, locks page scroll and ignores backdrop presses", async () => {
  const locale: Locale = "en-GB";
  const harness = await open(locale, api({ suggestion: () => ({ json: { suggestion: SUGGESTION } }) }));
  const { page } = harness;
  const f = form(page, locale);
  await fillValid(page, locale);
  await f.submit.click();
  await f.dialog.waitFor();
  assert.ok(await activeIs(f.dialog), "the dialog itself takes focus");
  assert.equal(await page.evaluate(() => document.body.style.overflow), "hidden");
  const focusables = f.dialog.locator("a[href], button:not([disabled])");
  const total = await focusables.count();
  assert.ok(total >= 4, "close, the answer link and the three choices");
  const close = f.dialog.getByRole("button", { name: f.copy.assistant.close, exact: true });
  const edit = f.dialog.getByRole("button", { name: f.copy.assistant.edit });
  await page.keyboard.press("Shift+Tab");
  assert.ok(await activeIs(edit), "Shift+Tab from the dialog goes to the last control");
  await page.keyboard.press("Tab");
  assert.ok(await activeIs(close), "Tab from the last control wraps to the first");
  await page.keyboard.press("Shift+Tab");
  assert.ok(await activeIs(edit), "Shift+Tab from the first wraps to the last");
  for (let index = 0; index < total * 2 + 1; index++) {
    await page.keyboard.press("Tab");
    assert.ok(await f.dialog.evaluate((dialog) => dialog.contains(document.activeElement)), `Tab ${index} stays inside`);
  }
  await page.mouse.click(5, 5);
  assert.ok(await f.dialog.evaluate((dialog) => dialog.contains(document.activeElement)), "a press on the backdrop keeps focus in the modal");
  assert.equal(await f.dialog.count(), 1, "and does not close it");
  await page.keyboard.press("Escape");
  await f.dialog.waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => document.body.style.overflow), "", "page scroll is restored");
  await page.close();
});

test("Cancel during the suggestion check leaves without a ticket even when the answer arrives; a later Submit works again", async () => {
  const locale: Locale = "en-GB";
  const release = deferred();
  let checks = 0;
  const harness = await open(locale, api({ suggestion: async () => { if (++checks === 1) await release.promise; return { json: { suggestion: checks === 1 ? SUGGESTION : null } }; } }));
  const { page } = harness;
  const f = form(page, locale);
  await fillValid(page, locale);
  await f.submit.click();
  await waitForCalls(harness, (calls) => count(calls, isSuggestion) === 1);
  await f.cancel.click();
  const nav = await harness.nav();
  assert.equal(nav.length, 1);
  assert.ok(nav[0][0] === "back" || (nav[0][0] === "push" && nav[0][1] === `/${locale}/account/my-learning`), JSON.stringify(nav));
  release.resolve();
  await page.waitForTimeout(300);
  assert.equal(await f.dialog.count(), 0, "a suggestion that arrives after Cancel is not shown");
  assert.equal(count(harness.calls, isTicketCreate), 0, "Cancel never creates a ticket");
  assert.equal(count(harness.calls, isOutcome), 0);
  // The browser may restore this page from the back-forward cache: Submit must work again.
  await f.submit.click();
  await waitForCalls(harness, (calls) => count(calls, isTicketCreate) === 1);
  await page.locator(".helpdesk-success").waitFor();
  await page.close();
});

test("the suggestion never blocks: no suggestion, an error or no answer within 5 s submits directly", async () => {
  const locale: Locale = "zh-CN";
  for (const reply of [{ json: { suggestion: null } }, { status: 500, json: { code: "internal" } }, "abort"] as Reply[]) {
    const harness = await open(locale, api({ suggestion: () => reply }));
    const { page } = harness;
    await fillValid(page, locale, false);
    await form(page, locale).submit.click();
    await waitForCalls(harness, (calls) => count(calls, isTicketCreate) === 1);
    const create = harness.calls.find(isTicketCreate)!;
    assert.equal("suggestionId" in create.fields, false, `${JSON.stringify(reply)}: a direct submit names no suggestion`);
    await page.locator(".helpdesk-success").waitFor();
    assert.equal(count(harness.calls, isOutcome), 0);
    await page.close();
  }
  const hang = deferred<Reply>();
  const harness = await open(locale, api({ suggestion: () => hang.promise }));
  const { page } = harness;
  await page.clock.install();
  await fillValid(page, locale, false);
  await form(page, locale).submit.click();
  await waitForCalls(harness, (calls) => count(calls, isSuggestion) === 1);
  await page.clock.runFor(4_800);
  await page.waitForTimeout(100);
  assert.equal(count(harness.calls, isTicketCreate), 0, "still waiting before 5 s");
  await page.clock.runFor(400);
  await waitForCalls(harness, (calls) => count(calls, isTicketCreate) === 1);
  assert.equal("suggestionId" in harness.calls.find(isTicketCreate)!.fields, false);
  await page.locator(".helpdesk-success").waitFor();
  hang.resolve({ json: { suggestion: SUGGESTION } });
  await page.waitForTimeout(100);
  assert.equal(await form(page, locale).dialog.count(), 0, "a late suggestion is ignored");
  await page.close();
});

test("429 rate_limited and other 4xx answers show one message, are final and get a fresh key on the next Submit", async () => {
  for (const locale of LOCALES) {
    const replies: Reply[] = [{ status: 429, json: { code: "rate_limited" } }, { status: 413 }, { status: 415, json: { code: "attachment_type_unsupported" } }, { status: 401, json: { code: "unauthenticated" } }];
    const expected = ["rateLimited", "tooLarge", "unsupported", "unauthenticated"] as const;
    let index = 0;
    const harness = await open(locale, api({ ticket: () => replies[index++] }));
    const { page } = harness;
    const f = form(page, locale);
    await fillValid(page, locale);
    for (let attempt = 0; attempt < replies.length; attempt++) {
      await f.submit.click();
      await waitForCalls(harness, (calls) => count(calls, isTicketCreate) === attempt + 1);
      await page.waitForFunction((text) => document.querySelector(".helpdesk-form > p[role=alert]")?.textContent === text, f.copy.errors[expected[attempt]]);
      assert.equal(await f.submit.isDisabled(), false);
    }
    const keys = harness.calls.filter(isTicketCreate).map((call) => call.key);
    assert.equal(new Set(keys).size, keys.length, "a 4xx ends the logical submit: every new Submit has a new key");
    assert.equal(count(harness.calls, isSuggestion), replies.length, "and asks for a suggestion again");
    assert.equal(await f.chips.count(), 1, "the form keeps its attachments");
    await page.close();
  }
});

test("line breaks count once: a 5000-code-point message with line breaks passes the page's check and the server's", async () => {
  const locale: Locale = "zh-CN";
  const harness = await open(locale, api({}));
  const { page } = harness;
  const f = form(page, locale);
  await chooseTopic(page, locale);
  await f.subject.fill("登录问题");
  const message = `${"中".repeat(99)}\n`.repeat(49) + "中".repeat(100);
  assert.equal([...message].length, 5000);
  await setValue(f.message, message);
  await f.submit.click();
  await waitForCalls(harness, (calls) => count(calls, isTicketCreate) === 1);
  const fields = harness.calls.find(isTicketCreate)!.fields;
  assert.equal(fields.body, message, "the server reads the message as typed (the browser sends each line break as CRLF)");
  assert.doesNotThrow(() => parseCreateTicketInput(fields, []), "the server accepts what the page accepted");
  await page.close();
});

test("a double Submit sends one suggestion check and one ticket", async () => {
  const locale: Locale = "en-GB";
  const harness = await open(locale, api({}));
  const { page } = harness;
  await fillValid(page, locale);
  await page.locator("form.helpdesk-form").evaluate((element) => {
    element.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    element.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await page.locator(".helpdesk-success").waitFor();
  await page.waitForTimeout(100);
  assert.equal(count(harness.calls, isSuggestion), 1);
  assert.equal(count(harness.calls, isTicketCreate), 1);
  await page.close();
});

const FAQ = ["01a18100-0000-7000-8000-0000000000f1", "01a18100-0000-7000-8000-0000000000f2", "01a18100-0000-7000-8000-0000000000f3"];
const CHIPS = [
  { id: FAQ[0], question: "How do I reset my password?" },
  { id: FAQ[1], question: "How can I change my subscription?" },
  { id: FAQ[2], question: "Where can I find my invoice?" }
];
const ASSIST = ["01a18100-0000-7000-8000-0000000000a1", "01a18100-0000-7000-8000-0000000000a2", "01a18100-0000-7000-8000-0000000000a3"];
const ANSWER = "1. Open **Settings**\n2. Choose [Reset password](https://example.com/reset)\n\n<b>not html</b> [bad](javascript:alert(1))";

function chat(page: Page, locale: Locale) {
  const copy = copyFor(locale).chat;
  const panel = page.getByRole("region", { name: copy.title });
  return {
    copy, panel,
    log: panel.locator(".helpdesk-chat-messages"),
    input: panel.getByRole("textbox", { name: copy.inputLabel }),
    send: panel.getByRole("button", { name: copy.send, exact: true }),
    chips: panel.locator(".helpdesk-chat-chip"),
    questions: panel.locator(".helpdesk-chat-question"),
    answers: panel.locator(".helpdesk-chat-answer")
  };
}

test("chat panel: greeting, starter chips, a chip asks with its FAQ id; the answer is rendered safely with Related FAQ and Helpful", async () => {
  for (const locale of LOCALES) {
    const release = deferred();
    const harness = await open(locale, api({
      assistant: async (call) => { await release.promise; const faqId = (call.json as { faqId?: string }).faqId!; return { json: { id: ASSIST[0], reply: { id: ASSIST[0], faqId, question: CHIPS[0].question, answer: ANSWER } } }; },
      feedback: () => ({ json: { id: ASSIST[0], feedback: "helpful" } })
    }), { locale, chips: CHIPS });
    const { page } = harness;
    const c = chat(page, locale);
    assert.equal(await c.panel.getByRole("heading", { level: 2 }).textContent(), c.copy.title);
    const text = await c.panel.textContent();
    for (const part of [c.copy.subtitle, c.copy.greetingTitle, c.copy.greetingBody, c.copy.greetingLimit, c.copy.ideas, c.copy.tryAsking, c.copy.info]) assert.ok(text?.includes(part), `${locale}: panel shows ${part}`);
    assert.equal(await c.input.getAttribute("placeholder"), c.copy.placeholder);
    assert.deepEqual(await c.chips.allTextContents(), CHIPS.map((chip) => chip.question));
    assert.equal(harness.calls.length, 0, "nothing is asked until the learner asks");
    await c.chips.first().click();
    await waitForCalls(harness, (calls) => count(calls, isAssistant) === 1);
    const asked = harness.calls.find(isAssistant)!;
    assert.deepEqual(asked.json, { message: CHIPS[0].question, locale, faqId: FAQ[0] }, "a chip sends its question and FAQ id");
    assert.match(asked.key ?? "", UUID);
    assert.deepEqual(await c.questions.allTextContents(), [CHIPS[0].question], "the question shows at once");
    assert.equal(await c.panel.getByRole("status").textContent(), c.copy.typing, "a typing state while the answer is pending");
    assert.equal(await c.send.isDisabled(), true, "send is disabled while a reply is pending");
    assert.equal(await c.chips.first().isDisabled(), true, "and so are the chips");
    release.resolve();
    await c.answers.first().waitFor();
    const answer = c.answers.first();
    assert.deepEqual(await answer.locator("ol > li").allTextContents(), ["Open Settings", "Choose Reset password"]);
    assert.equal(await answer.locator("strong").textContent(), "Settings");
    const link = answer.getByRole("link", { name: "Reset password" });
    assert.equal(await link.getAttribute("href"), "https://example.com/reset");
    assert.equal(await link.getAttribute("target"), "_blank");
    assert.equal(await link.getAttribute("rel"), "noopener noreferrer");
    assert.equal(await answer.locator("b").count(), 0, "raw HTML stays text");
    assert.ok((await answer.textContent())?.includes("<b>not html</b> bad"), "and a javascript: link keeps only its label");
    assert.equal(await answer.locator('a[href^="javascript"]').count(), 0);
    const related = answer.getByRole("link", { name: fillTemplate(c.copy.relatedFaq, { question: CHIPS[0].question }) });
    assert.equal(await related.getAttribute("href"), `/${locale}/help?faq=${FAQ[0]}`, "Related FAQ opens that FAQ in the Help Centre");
    const yes = answer.getByRole("button", { name: c.copy.yes, exact: true });
    const no = answer.getByRole("button", { name: c.copy.no, exact: true });
    assert.ok((await answer.textContent())?.includes(c.copy.helpful));
    assert.equal(await yes.getAttribute("aria-pressed"), "false");
    await yes.click();
    await waitForCalls(harness, (calls) => count(calls, isAssistantFeedback) === 1);
    const feedback = harness.calls.find(isAssistantFeedback)!;
    assert.equal(feedback.path, `/api/helpdesk/assistant/${ASSIST[0]}/feedback`);
    assert.deepEqual(feedback.json, { helpful: true });
    assert.match(feedback.key ?? "", UUID);
    await page.waitForFunction(() => document.querySelector(".helpdesk-chat-answer button[aria-pressed=true]") !== null);
    assert.equal(await yes.getAttribute("aria-pressed"), "true", "the chosen answer shows as pressed");
    assert.equal(await no.isDisabled(), true, "and the other is disabled");
    assert.equal(await yes.isDisabled(), true, "feedback is given once");
    assert.equal(await c.send.isDisabled(), true, "send stays disabled with an empty input");
    await page.close();
  }
});

test("chat: Enter sends, Shift+Enter adds a line, blank never sends; null shows the fallback; 429 and network errors show an inline error", async () => {
  for (const locale of LOCALES) {
    const replies: Reply[] = [{ json: { id: ASSIST[1], reply: null } }, { status: 429, json: { code: "rate_limited" } }, "abort"];
    const harness = await open(locale, api({ assistant: () => replies.shift() ?? { status: 500 } }), { locale, chips: [] });
    const { page } = harness;
    const c = chat(page, locale);
    assert.equal(await c.chips.count(), 0, "no chips without popular FAQs");
    assert.equal(await c.panel.getByText(c.copy.tryAsking).count(), 0, "and no heading for them");
    await c.input.click();
    await page.keyboard.press("Enter");
    await c.input.fill("   ");
    await page.keyboard.press("Enter");
    assert.equal(count(harness.calls, isAssistant), 0, "a blank question is never sent");
    await c.input.fill("");
    await page.keyboard.type("Line one");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("line two");
    assert.equal(await c.input.inputValue(), "Line one\nline two", "Shift+Enter makes a new line");
    assert.equal(count(harness.calls, isAssistant), 0);
    await page.keyboard.press("Enter");
    await waitForCalls(harness, (calls) => count(calls, isAssistant) === 1);
    assert.deepEqual(harness.calls.find(isAssistant)!.json, { message: "Line one\nline two", locale }, "Enter sends the typed question");
    assert.equal(await c.input.inputValue(), "", "the input clears");
    await c.answers.first().waitFor();
    assert.equal((await c.answers.first().textContent())?.trim(), c.copy.fallback, "a null reply shows the fallback");
    assert.equal(await c.answers.first().getByRole("button").count(), 0, "with no Helpful buttons");
    assert.equal(await c.answers.first().getByRole("link").count(), 0, "and no Related FAQ");
    await c.input.fill("How much is it?");
    await c.send.click();
    const error = c.panel.locator(".helpdesk-chat-error[role=alert]");
    await error.waitFor();
    assert.equal(await error.textContent(), c.copy.rateLimited, "429 rate_limited");
    await c.input.fill("Again?");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelectorAll(".helpdesk-chat-error").length === 2);
    assert.equal(await error.nth(1).textContent(), c.copy.error, "a network failure");
    assert.deepEqual(await c.questions.allTextContents(), ["Line one\nline two", "How much is it?", "Again?"]);
    assert.equal(await c.questions.first().evaluate((node) => getComputedStyle(node).whiteSpace), "pre-wrap", "line breaks in a question show");
    assert.equal(await c.input.inputValue(), "Again?", "the unanswered question is back in the input");
    assert.equal(await c.send.isDisabled(), false, "nothing pending: it can be sent again");
    const atBottom = await c.log.evaluate((node) => Math.abs(node.scrollHeight - node.clientHeight - node.scrollTop) < 2);
    assert.ok(atBottom, "the conversation scrolls to the newest message");
    const keys = harness.calls.filter(isAssistant).map((call) => call.key);
    assert.equal(new Set(keys).size, 3, "each question is its own Idempotency-Key");
    await page.close();
  }
});

test("chat transcript is kept in sessionStorage per account; the enquiry sends the chat's assistIds with the suggestionId", async () => {
  const locale: Locale = "en-GB";
  let asked = 0;
  const harness = await open(locale, api({
    assistant: () => (++asked === 1 ? { json: { id: ASSIST[0], reply: { id: ASSIST[0], faqId: FAQ[0], question: CHIPS[0].question, answer: "Use **Reset**." } } } : { json: { id: ASSIST[1], reply: null } }),
    suggestion: () => ({ json: { suggestion: SUGGESTION } })
  }), { locale, chips: CHIPS });
  const { page } = harness;
  let c = chat(page, locale);
  await c.chips.first().click();
  await c.answers.first().waitFor();
  await c.input.fill("Something else");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelectorAll(".helpdesk-chat-answer").length === 2);
  await c.answers.first().getByRole("button", { name: c.copy.no, exact: true }).click();
  await waitForCalls(harness, (calls) => count(calls, isAssistantFeedback) === 1);
  await page.waitForFunction(() => document.querySelector(".helpdesk-chat-answer button[aria-pressed=true]") !== null);
  await mountContact(page, { locale, chips: CHIPS });
  c = chat(page, locale);
  await c.panel.locator(".helpdesk-chat-messages[aria-busy=false]").waitFor();
  assert.deepEqual(await c.questions.allTextContents(), [CHIPS[0].question, "Something else"], "the transcript comes back after a reload");
  assert.equal(await c.answers.count(), 2);
  assert.equal(await c.answers.first().getByRole("button", { name: c.copy.no, exact: true }).getAttribute("aria-pressed"), "true", "with the feedback given");
  await mountContact(page, { locale, chips: CHIPS, account: { id: "user_other", name: "Other", email: "other@example.com" } });
  await c.panel.locator(".helpdesk-chat-messages[aria-busy=false]").waitFor();
  assert.equal(await chat(page, locale).questions.count(), 0, "another account on this browser does not see it");
  await mountContact(page, { locale, chips: CHIPS });
  const f = form(page, locale);
  await fillValid(page, locale, false);
  await f.submit.click();
  await f.dialog.waitFor();
  await f.dialog.getByRole("button", { name: f.copy.assistant.no }).click();
  await waitForCalls(harness, (calls) => count(calls, isTicketCreate) === 1);
  const create = harness.calls.find(isTicketCreate)!;
  assert.deepEqual(create.fields.assistIds, [ASSIST[0], ASSIST[1]], "the chat's answers are linked to the enquiry");
  assert.equal(create.fields.suggestionId, SUGGESTION.id);
  await page.close();
});

test("chat: “We’d love to hear your ideas” picks Other Enquiries and focuses Subject; the panel matches 1216:6 at 1440 × 1024", async () => {
  for (const locale of LOCALES) {
    const harness = await open(locale, api({}), { locale, chips: CHIPS });
    const { page } = harness;
    await page.setViewportSize({ width: 1440, height: 1024 });
    // As in the app (globals.css): no body margin; and Figma frames have no scrollbar, so measure at the full 1440 px.
    await page.addStyleTag({ content: "html { scrollbar-width: none; } body { margin: 0; }" });
    const c = chat(page, locale);
    const f = form(page, locale);
    await c.panel.getByRole("button", { name: c.copy.ideas }).click();
    assert.equal(await f.topic.textContent(), f.copy.categories.other);
    assert.ok(await activeIs(f.subject), "focus moves to Subject");
    const box = async (selector: string) => (await c.panel.locator(selector).first().boundingBox())!;
    const card = (await page.locator(".helpdesk-card").boundingBox())!;
    const panel = (await c.panel.boundingBox())!;
    assert.deepEqual([panel.width, panel.height], [455, 800], "panel 455 × 800");
    assert.equal(panel.x - card.x, 925, "the panel starts 925 px into the card");
    assert.equal(card.width, 1399);
    assert.equal(card.x, 20, "the card starts at x = 20 as in Figma (not 20.5 from centring)");
    assert.equal((await box(".helpdesk-chat-header h2")).y - panel.y, 8, "the title sits 7 px under the header top (1394:9)");
    const chips = c.panel.locator(".helpdesk-chat-chips");
    assert.equal((await box(".helpdesk-chat-chips")).height + Number.parseFloat(await chips.evaluate((node) => getComputedStyle(node).marginBottom)), 124, "the chips block takes 124 px (1394:30)");
    assert.equal((await box(".helpdesk-chat-header")).height, 51);
    assert.equal((await box(".helpdesk-chat-messages")).height, 664);
    assert.equal((await box(".helpdesk-chat-chip")).width, 404);
    assert.equal((await box(".helpdesk-chat-chip")).height, 36);
    assert.equal((await box(".helpdesk-chat-greeting")).width, 365);
    assert.equal((await box(".helpdesk-chat-input")).height, 70);
    assert.deepEqual([(await box(".helpdesk-chat-send")).width, (await box(".helpdesk-chat-send")).height], [43, 43]);
    assert.equal((await box(".helpdesk-chat-info")).width, 404);
    await page.setViewportSize({ width: 800, height: 1024 });
    const narrowForm = (await page.locator("form.helpdesk-form").boundingBox())!;
    const narrowPanel = (await c.panel.boundingBox())!;
    assert.ok(narrowPanel.y >= narrowForm.y + narrowForm.height, "on narrow screens the panel stacks under the form");
    assert.ok(narrowPanel.x + narrowPanel.width <= 800, "without overflowing");
    await page.close();
  }
});

test("the submit-time modal matches 1333:249 at 1440 × 1024: 1032 × 900 at (204, 40), the enquiry card, the blue answer box with the bot on its right, one helpful row", async () => {
  const locale: Locale = "en-GB";
  const harness = await open(locale, api({ suggestion: () => ({ json: { suggestion: SUGGESTION } }) }));
  const { page } = harness;
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.addStyleTag({ content: "html { scrollbar-width: none; } body { margin: 0; }" });
  const f = form(page, locale);
  await fillValid(page, locale);
  await f.submit.click();
  await f.dialog.waitFor();
  const box = async (selector: string) => (await f.dialog.locator(selector).first().boundingBox())!;
  const dialog = (await f.dialog.boundingBox())!;
  assert.deepEqual([dialog.x, dialog.y, dialog.width, dialog.height], [204, 40, 1032, 900], "1341:6 is 1032 × 900, 40 px from the top");
  assert.equal((await box(".helpdesk-modal-header")).height, 73);
  const lines = await f.dialog.locator(".helpdesk-modal-text p").evaluateAll((nodes) => nodes.map((node) => [node.getBoundingClientRect().top, node.getBoundingClientRect().bottom]));
  assert.equal(lines.length, 2);
  assert.equal(lines[1][0] - lines[0][1], 6, "message lines are 6 px apart (1341:27 / 1341:28)");
  const card = f.dialog.locator(".helpdesk-modal-query-content");
  assert.equal(await card.evaluate((node) => getComputedStyle(node).borderTopColor), "rgb(227, 232, 240)", "the enquiry sits in a bordered card (1341:21)");
  const answer = await box(".helpdesk-modal-answer-content");
  const bot = await box(".helpdesk-modal-answer .helpdesk-bot-avatar");
  assert.equal(answer.width, 924, "the answer box is 924 px wide");
  assert.equal(await f.dialog.locator(".helpdesk-modal-answer-content").evaluate((node) => getComputedStyle(node).backgroundColor), "rgb(232, 242, 255)");
  assert.equal(bot.x, answer.x + 924 + 20, "the bot avatar sits 20 px to the right of the answer box");
  const steps = await f.dialog.locator(".helpdesk-modal-answer ol > li").first().evaluate((li) => [...li.querySelectorAll(".md-line")].map((line) => line.getBoundingClientRect().top - li.getBoundingClientRect().top));
  assert.deepEqual(steps, [28], "a step's text starts 4 px under its 24 px title line (1341:39)");
  const helpful = await box(".helpdesk-modal-helpful");
  const footer = await box(".helpdesk-modal-footer");
  assert.equal(helpful.y + helpful.height - footer.y, 64, "the helpful row is 64 px with the footer's top border");
  assert.equal(footer.height, 132, "the footer is 132 px (1341:49)");
  const yes = await box(".helpdesk-feedback-yes");
  const no = await box(".helpdesk-feedback-no");
  const edit = (await f.dialog.getByRole("button", { name: f.copy.assistant.edit }).boundingBox())!;
  assert.deepEqual([yes.height, no.height, edit.height], [40, 40, 40], "40 px buttons");
  assert.equal(yes.y, no.y, "Yes and No share one row");
  assert.equal(edit.x + edit.width, dialog.x + dialog.width - 20, "Edit my enquiry sits at the right edge");
  assert.ok(yes.x > helpful.x + 200 && edit.x - (no.x + no.width) > 100, "Yes / No sit in the middle, apart from Edit");
  await page.close();
});

test("the greeting falls back when the account has no name", async () => {
  const locale: Locale = "zh-CN";
  const harness = await open(locale, api({ suggestion: () => ({ json: { suggestion: SUGGESTION } }) }), { locale, account: { id: "user_noname", name: "  ", email: "learner@example.com" } });
  const { page } = harness;
  const f = form(page, locale);
  await fillValid(page, locale, false);
  await f.submit.click();
  await f.dialog.waitFor();
  assert.equal(await f.dialog.locator(".helpdesk-answer-greeting").textContent(), f.copy.assistant.greetingNoName);
  assert.ok((await f.dialog.locator(".helpdesk-modal-meta").textContent())?.startsWith("learner@example.com · "));
  await page.close();
});

// ---------------------------------------------------------------- final verification (2026-10-29)

const LONG_ANSWER = Array.from({ length: 40 }, (_, index) => `Step ${index + 1}: follow the instructions on this line.`).join("\n\n");
const answerReply = (id: string, answer: string, question = CHIPS[0].question) => ({ json: { id, reply: { id, faqId: FAQ[0], question, answer } } });

test("chat scrolling: a long answer opens at its start, a short one shows the newest; a vote never moves the view", async () => {
  const replies: Reply[] = [answerReply(ASSIST[0], "Short **one**."), answerReply(ASSIST[1], "Short two."), answerReply(ASSIST[2], LONG_ANSWER)];
  const harness = await open("en-GB", api({ assistant: () => replies.shift() ?? { status: 500 } }), { locale: "en-GB", chips: [] });
  const { page } = harness;
  const c = chat(page, "en-GB");
  for (const question of ["one", "two"]) {
    await c.input.fill(question);
    await page.keyboard.press("Enter");
    await page.waitForFunction((n) => document.querySelectorAll(".helpdesk-chat-answer").length === n, question === "one" ? 1 : 2);
  }
  await c.input.fill("long");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelectorAll(".helpdesk-chat-answer").length === 3);
  const long = c.answers.nth(2);
  const box = (await c.log.boundingBox())!;
  const top = (await long.boundingBox())!;
  assert.ok(top.y >= box.y - 1 && top.y <= box.y + 40, `the long answer starts at the top of the panel (answer ${top.y}, panel ${box.y})`);
  assert.ok(top.height > box.height, "it is taller than the panel");
  // Scroll up to the first answer and rate it: the view stays where the learner is.
  await c.log.evaluate((node) => { node.scrollTop = 0; });
  await c.answers.first().getByRole("button", { name: c.copy.yes, exact: true }).click();
  await waitForCalls(harness, (calls) => count(calls, isAssistantFeedback) === 1);
  await page.waitForFunction(() => document.querySelector(".helpdesk-chat-answer button[aria-pressed=true]") !== null);
  assert.equal(await c.log.evaluate((node) => node.scrollTop), 0, "the vote did not scroll the panel");
  await page.close();
});

test("chat answers, the fallback and the typing state are announced through one live region that is always there", async () => {
  for (const locale of LOCALES) {
    const release = deferred();
    const replies: Reply[] = [answerReply(ASSIST[0], "Open **Settings**, then [Reset](https://example.com/reset)."), { json: { id: ASSIST[1], reply: null } }];
    const harness = await open(locale, api({ assistant: async () => { await release.promise; return replies.shift() ?? { status: 500 }; } }), { locale, chips: [] });
    const { page } = harness;
    const c = chat(page, locale);
    const live = c.panel.locator(".helpdesk-chat-live");
    assert.equal(await live.getAttribute("role"), "status");
    assert.equal(await live.getAttribute("aria-live"), "polite");
    assert.equal(await live.textContent(), "", "silent until something happens");
    await c.input.fill("reset");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector(".helpdesk-chat-live")?.textContent !== "");
    assert.equal(await live.textContent(), c.copy.typing);
    release.resolve();
    await c.answers.first().waitFor();
    await page.waitForFunction((typing) => document.querySelector(".helpdesk-chat-live")?.textContent !== typing, c.copy.typing);
    assert.equal(await live.textContent(), "Open Settings, then Reset.", "the answer as plain text");
    await c.input.fill("refund");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelectorAll(".helpdesk-chat-answer").length === 2);
    await page.waitForFunction((fallback) => document.querySelector(".helpdesk-chat-live")?.textContent === fallback, c.copy.fallback);
    assert.equal(await c.panel.getByRole("status").count(), 1, "one status region");
    await page.close();
  }
});

test("chat: Enter while an IME is composing (isComposing, or keyCode 229 as Safari sends it) never sends", async () => {
  const harness = await open("zh-CN", api({}), { locale: "zh-CN", chips: [] });
  const { page } = harness;
  const c = chat(page, "zh-CN");
  await c.input.fill("怎么重置密码");
  for (const init of [{ isComposing: true }, { keyCode: 229 }]) {
    await c.input.evaluate((node, extra) => {
      const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, isComposing: Boolean((extra as { isComposing?: boolean }).isComposing) });
      if ((extra as { keyCode?: number }).keyCode) Object.defineProperty(event, "keyCode", { value: (extra as { keyCode: number }).keyCode });
      node.dispatchEvent(event);
    }, init);
  }
  await page.waitForTimeout(100);
  assert.equal(count(harness.calls, isAssistant), 0, "the candidate confirmation is not a send");
  assert.equal(await c.input.inputValue(), "怎么重置密码");
  await page.keyboard.press("Enter");
  await waitForCalls(harness, (calls) => count(calls, isAssistant) === 1);
  await page.close();
});

test("chat: a failed question goes back into the input; a failed vote says so and can be retried; the server's first value is shown", async () => {
  for (const locale of LOCALES) {
    const feedbackReplies: Reply[] = ["abort", { status: 429, json: { code: "rate_limited" } }, { json: { id: ASSIST[0], feedback: "not_helpful" } }];
    const replies: Reply[] = ["abort", answerReply(ASSIST[0], "Answer.")];
    const harness = await open(locale, api({ assistant: () => replies.shift() ?? { status: 500 }, feedback: () => feedbackReplies.shift() ?? { status: 500 } }), { locale, chips: [] });
    const { page } = harness;
    const c = chat(page, locale);
    await c.input.fill("Where is my invoice?");
    await page.keyboard.press("Enter");
    await c.panel.locator(".helpdesk-chat-error").waitFor();
    assert.equal(await c.input.inputValue(), "Where is my invoice?", "the learner does not retype it");
    await page.keyboard.press("Enter");
    await c.answers.first().waitFor();
    assert.equal(await c.input.inputValue(), "");
    const answer = c.answers.first();
    const yes = answer.getByRole("button", { name: c.copy.yes, exact: true });
    const no = answer.getByRole("button", { name: c.copy.no, exact: true });
    const voteError = answer.locator(".helpdesk-chat-vote-error[role=alert]");
    await yes.click();
    await voteError.waitFor();
    assert.equal(await voteError.textContent(), c.copy.voteError);
    assert.equal(await yes.isDisabled(), false, "it can be tried again");
    await yes.click();
    await waitForCalls(harness, (calls) => count(calls, isAssistantFeedback) === 2);
    await page.waitForFunction(() => document.querySelector(".helpdesk-chat-vote-error") !== null);
    await yes.click();
    await page.waitForFunction(() => document.querySelector(".helpdesk-chat-answer button[aria-pressed=true]") !== null);
    assert.equal(await no.getAttribute("aria-pressed"), "true", "the server kept an earlier No: that is what shows");
    assert.equal(await yes.getAttribute("aria-pressed"), "false");
    assert.equal(await voteError.count(), 0, "the error goes once the vote is stored");
    await page.close();
  }
});

test("chat: a question with no reply after 15 s shows the error; a reload during a question does not leave it unanswered; blocked storage still works", async () => {
  const harness = await open("en-GB", api({ assistant: () => new Promise<Reply>(() => undefined) }), { locale: "en-GB", chips: [] });
  const { page } = harness;
  await page.clock.install();
  const c = chat(page, "en-GB");
  await c.input.fill("Hello?");
  await page.keyboard.press("Enter");
  await waitForCalls(harness, (calls) => count(calls, isAssistant) === 1);
  assert.equal(await c.send.isDisabled(), true);
  await page.clock.runFor(15_100);
  await c.panel.locator(".helpdesk-chat-error").waitFor();
  assert.equal(await c.panel.locator(".helpdesk-chat-error").textContent(), c.copy.error);
  assert.equal(await c.input.inputValue(), "Hello?");
  await page.close();

  const reload = await open("en-GB", api({ assistant: () => new Promise<Reply>(() => undefined) }), { locale: "en-GB", chips: [] });
  let r = chat(reload.page, "en-GB");
  await r.input.fill("Asked just before a reload");
  await reload.page.keyboard.press("Enter");
  await waitForCalls(reload, (calls) => count(calls, isAssistant) === 1);
  await mountContact(reload.page, { locale: "en-GB", chips: [] });
  r = chat(reload.page, "en-GB");
  await r.panel.locator(".helpdesk-chat-messages[aria-busy=false]").waitFor();
  assert.deepEqual(await r.questions.allTextContents(), ["Asked just before a reload"]);
  assert.equal(await r.panel.locator(".helpdesk-chat-error").textContent(), r.copy.error, "the unanswered question gets the error, so the learner can ask again");
  await reload.page.close();

  const blocked = await openHarness(browser, "en-GB", api({ assistant: () => answerReply(ASSIST[0], "Works.") }));
  await blocked.page.evaluate("Object.defineProperty(window, 'sessionStorage', { configurable: true, get() { throw new DOMException('blocked', 'SecurityError'); } })");
  await mountContact(blocked.page, { locale: "en-GB", chips: [] });
  const b = chat(blocked.page, "en-GB");
  await b.input.fill("Storage blocked");
  await blocked.page.keyboard.press("Enter");
  await b.answers.first().waitFor();
  assert.equal((await b.answers.first().locator(".helpdesk-chat-answer-text").textContent())?.trim(), "Works.");
  await blocked.page.close();
});

test("chat chips show the full question on hover when it is cut off", async () => {
  const longChip = { id: FAQ[2], question: `How do I ${"really ".repeat(30)}change my plan?` };
  const harness = await open("en-GB", api({}), { locale: "en-GB", chips: [longChip] });
  const chip = chat(harness.page, "en-GB").chips.first();
  assert.equal(await chip.getAttribute("title"), longChip.question);
  await harness.page.close();
});

test("the info box points at the form above when the chat is stacked under it", async () => {
  for (const locale of LOCALES) {
    const harness = await open(locale, api({}), { locale, chips: [] });
    const { page } = harness;
    const c = chat(page, locale);
    const info = c.panel.locator(".helpdesk-chat-info p");
    await page.setViewportSize({ width: 1440, height: 1024 });
    assert.equal(await info.innerText(), c.copy.info, "Figma copy beside the form");
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await info.innerText(), c.copy.infoStacked, "the stacked layout says where the form is");
    await page.close();
  }
});
