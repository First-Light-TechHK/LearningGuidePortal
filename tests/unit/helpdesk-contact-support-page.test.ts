// Contact Support (components/helpdesk/ContactSupport.tsx) rendered in Chromium:
// form validation, the attachment drop zone, paste, the topic list, the AI
// Support Assistant modal (Yes / No / Edit / Close / Escape, focus trap), Cancel
// during the suggestion check, the never-blocking suggestion (null, error,
// 5 s timeout), Idempotency-Key reuse on a lost response, 429 / 4xx messages,
// Common Questions and the success state, in en-GB and zh-CN.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser, type Locator, type Page } from "playwright";
import { parseCreateTicketInput } from "../../contracts/helpdesk";
import { getMessages } from "../../lib/i18n/messages";
import { fillTemplate } from "../../modules/helpdesk/learnerUi";
import { PNG } from "./helpdesk-fixtures";
import { LOCALES, isOutcome, isSuggestion, isTicketCreate, mountContact, openHarness, ticketFixture, waitForCalls, type ApiCall, type Handler, type Harness, type Locale, type Reply } from "./helpers/helpdesk-browser";

let browser: Browser;
before(async () => { browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined }); });
after(async () => { await browser?.close(); });

const copyFor = (locale: Locale) => getMessages(locale).helpdesk;
const SUGGESTION = { id: "sug-1", qaId: "qa-1", question: "How do I reset my password?", answer: "1. Reset your password\nOpen https://example.com/reset\n\n2. Still nothing?\nCheck your spam folder" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

/** Routes the three Contact Support endpoints; anything else is a 500. */
function api(handlers: { suggestion?: Handler; ticket?: Handler; outcome?: Handler }): Handler {
  return (call) => {
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
  assert.equal(await paste("textarea", { name: "image.png", type: "image/png" }, "A1\tB1"), false, "Excel / Word cells: the browser pastes the text");
  assert.equal(await f.chips.count(), 1, "the picture Office puts next to the text is not attached");
  assert.equal(await paste("textarea", { name: "image.png", type: "image/png" }, null, '<img src="https://example.com/x.png">'), true, "an image copied from a web page attaches");
  assert.equal(await f.chips.count(), 2);
  assert.equal(await paste("textarea", { name: "image.jpeg", type: "image/jpeg" }, " \n\t"), true, "blank text/plain is no text");
  assert.equal(await f.chips.count(), 3);
  assert.equal(await paste("input[aria-required]:not([type=email])", { name: "report.png", type: "image/png" }, null), true);
  assert.equal((await f.chips.allTextContents())[3], "report.png", "a named file keeps its name");
  assert.equal(await paste("textarea", null, "just text"), false, "plain text paste is left to the browser");
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
    assert.deepEqual(await f.dialog.locator(".helpdesk-answer-heading").allTextContents(), ["1. Reset your password", "2. Still nothing?"], "numbered paragraphs show their first line as a heading");
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

test("Common Questions: one answer open at a time, links open safely, the section is left out when Admin has none", async () => {
  for (const locale of LOCALES) {
    const questions = [
      { id: "q-1", category: "technical_support", question: locale === "zh-CN" ? "如何重置密码？" : "How do I reset my password?", answer: "Open https://example.com/reset\n\nThen sign in again." },
      { id: "q-2", category: "payments_subscriptions", question: locale === "zh-CN" ? "如何取消订阅？" : "How do I cancel?", answer: "Go to Subscription." }
    ];
    const harness = await open(locale, api({}), { locale, questions });
    const { page } = harness;
    const copy = copyFor(locale);
    const section = page.getByRole("region", { name: copy.commonQuestions });
    const first = section.getByRole("button", { name: questions[0].question });
    const second = section.getByRole("button", { name: questions[1].question });
    const answer = (button: Locator) => button.evaluate((element) => { const panel = document.getElementById(element.getAttribute("aria-controls")!)!; return { hidden: panel.hidden, text: panel.textContent, paragraphs: panel.querySelectorAll("p").length }; });
    assert.equal(await first.getAttribute("aria-expanded"), "false");
    assert.equal((await answer(first)).hidden, true);
    await first.click();
    assert.equal(await first.getAttribute("aria-expanded"), "true");
    assert.deepEqual(await answer(first), { hidden: false, text: "Open https://example.com/resetThen sign in again.", paragraphs: 2 }, "blank lines are dropped");
    const link = section.getByRole("link", { name: "https://example.com/reset" });
    assert.equal(await link.getAttribute("target"), "_blank");
    assert.equal(await link.getAttribute("rel"), "noopener noreferrer");
    await second.click();
    assert.equal(await second.getAttribute("aria-expanded"), "true");
    assert.equal(await first.getAttribute("aria-expanded"), "false", "opening one closes the other");
    assert.equal((await answer(first)).hidden, true);
    await second.click();
    assert.equal(await second.getAttribute("aria-expanded"), "false", "a second click closes it");
    assert.equal(await page.locator(".helpdesk-card-single").count(), 0);
    assert.equal(harness.calls.length, 0);
    await mountContact(page, { locale, questions: [] });
    assert.equal(await page.getByRole("region", { name: copy.commonQuestions }).count(), 0);
    assert.equal(await page.locator(".helpdesk-card-content.helpdesk-card-single").count(), 1, "the form takes the whole card");
    assert.equal(await page.getByRole("link", { name: copy.myEnquiries }).getAttribute("href"), `/${locale}/account/my-learning/support/enquiries`);
    assert.equal(await page.getByRole("heading", { level: 1 }).textContent(), copy.pageTitle);
    await page.close();
  }
});

test("the greeting falls back when the account has no name", async () => {
  const locale: Locale = "zh-CN";
  const harness = await open(locale, api({ suggestion: () => ({ json: { suggestion: SUGGESTION } }) }), { locale, account: { name: "  ", email: "learner@example.com" } });
  const { page } = harness;
  const f = form(page, locale);
  await fillValid(page, locale, false);
  await f.submit.click();
  await f.dialog.waitFor();
  assert.equal(await f.dialog.locator(".helpdesk-answer-greeting").textContent(), f.copy.assistant.greetingNoName);
  assert.ok((await f.dialog.locator(".helpdesk-modal-meta").textContent())?.startsWith("learner@example.com · "));
  await page.close();
});
