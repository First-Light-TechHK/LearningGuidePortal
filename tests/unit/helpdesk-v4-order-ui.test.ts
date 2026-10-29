// Helpdesk v4 Part A, learner side in Chromium: Contact Support opened for one
// of the learner's orders (components/helpdesk/ContactSupport.tsx, order prop
// from ?orderId=). Enquiry Type starts on Payments & Subscriptions and can be
// changed; a read-only "Order: <number>" line sits above Subject with Remove
// (keyboard and screen reader); the number goes with the ticket as orderId and
// never with the AI suggestion check; a 400 field orderId says so and Remove
// lets the learner submit. New states are 待视觉验收 (no Figma frame).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import { getMessages } from "../../lib/i18n/messages";
import { fillTemplate } from "../../modules/helpdesk/learnerUi";
import { LOCALES, isSuggestion, isTicketCreate, mountContact, openHarness, ticketFixture, waitForCalls, type ApiCall, type Handler, type Locale, type Reply } from "./helpers/helpdesk-browser";

let browser: Browser;
before(async () => { browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined }); });
after(async () => { await browser?.close(); });

const ORDER_ID = "order_1761640741859_9f3a2c1d";

function api(ticket: (call: ApiCall) => Reply = () => ({ status: 201, json: ticketFixture("OPEN") })): Handler {
  return (call) => {
    if (isSuggestion(call)) return { json: { suggestion: null, alternatives: [] } };
    if (isTicketCreate(call)) return ticket(call);
    return { status: 500 };
  };
}

function ui(page: Page, locale: Locale) {
  const copy = getMessages(locale).helpdesk;
  return {
    copy,
    topic: page.getByRole("combobox"),
    subject: page.getByRole("textbox", { name: copy.subject, exact: true }),
    message: page.getByRole("textbox", { name: copy.message, exact: true }),
    submit: page.locator("button.helpdesk-submit-button[type=submit]"),
    orderGroup: page.getByRole("group", { name: copy.order.label, exact: true }),
    remove: page.getByRole("button", { name: fillTemplate(copy.order.removeLabel, { number: ORDER_ID }), exact: true }),
    alert: page.locator(".helpdesk-form > p[role=alert]")
  };
}

async function fill(page: Page, locale: Locale) {
  const f = ui(page, locale);
  await f.subject.fill("Paid but no access");
  await f.message.fill("I paid but the course is still locked.");
}

test("opened for an order: Payments & Subscriptions preset (still changeable), a read-only Order line above Subject, and orderId goes with the ticket but never with the AI check", async () => {
  for (const locale of LOCALES) {
    const harness = await openHarness(browser, locale, api());
    const { page } = harness;
    await mountContact(page, { locale, order: { id: ORDER_ID } });
    const f = ui(page, locale);
    assert.equal(await f.topic.textContent(), f.copy.categories.payments_subscriptions, "preset from the payment record");
    await f.orderGroup.waitFor();
    assert.ok((await f.orderGroup.textContent())?.includes(ORDER_ID), "the order number exactly as on the receipt");
    assert.equal(await f.orderGroup.locator("input, textarea, [contenteditable]").count(), 0, "read-only: nothing to type into");
    assert.equal(await f.remove.textContent(), f.copy.order.remove);
    // The line sits above Subject (document order).
    assert.equal(await f.orderGroup.evaluate((group, subjectId) => Boolean(group.compareDocumentPosition(document.getElementById(subjectId)!) & Node.DOCUMENT_POSITION_FOLLOWING), (await f.subject.getAttribute("id"))!), true);
    // The learner can still change the Enquiry Type.
    await f.topic.click();
    await page.getByRole("option", { name: f.copy.categories.technical_support, exact: true }).click();
    assert.equal(await f.topic.textContent(), f.copy.categories.technical_support);
    await fill(page, locale);
    await f.submit.click();
    await waitForCalls(harness, (calls) => calls.some(isTicketCreate));
    const suggestion = harness.calls.find(isSuggestion)!;
    assert.deepEqual(Object.keys(suggestion.json!).sort(), ["category", "locale", "message", "subject"], "the AI check gets only what the learner typed");
    assert.doesNotMatch(JSON.stringify(suggestion.json), /order/i);
    const created = harness.calls.find(isTicketCreate)!;
    assert.equal(created.fields.orderId, ORDER_ID);
    assert.equal(created.fields.category, "technical_support");
    await page.close();
  }
});

test("Remove drops the order (by keyboard too): focus moves to Subject, the change is announced, and the ticket is sent without orderId", async () => {
  for (const locale of LOCALES) {
    const harness = await openHarness(browser, locale, api());
    const { page } = harness;
    await mountContact(page, { locale, order: { id: ORDER_ID } });
    const f = ui(page, locale);
    await f.remove.focus();
    await page.keyboard.press("Enter");
    await f.orderGroup.waitFor({ state: "detached" });
    assert.ok(await f.subject.evaluate((element) => element === document.activeElement), "focus goes on to Subject");
    assert.equal(await page.locator(".helpdesk-form p[role=status]").textContent(), f.copy.order.removed);
    assert.equal(await f.topic.textContent(), f.copy.categories.payments_subscriptions, "Remove leaves the Enquiry Type alone");
    await fill(page, locale);
    await f.submit.click();
    await waitForCalls(harness, (calls) => calls.some(isTicketCreate));
    assert.equal("orderId" in harness.calls.find(isTicketCreate)!.fields, false);
    await page.close();
  }
});

test("the server refuses the order (400 field orderId): the learner is told, the order line stays, and after Remove the enquiry goes through with a new key", async () => {
  for (const locale of LOCALES) {
    let refuse = true;
    const harness = await openHarness(browser, locale, api(() => (refuse ? { status: 400, json: { code: "validation_failed", field: "orderId", status: 400 } } : { status: 201, json: ticketFixture("OPEN") })));
    const { page } = harness;
    await mountContact(page, { locale, order: { id: ORDER_ID } });
    const f = ui(page, locale);
    await fill(page, locale);
    await f.submit.click();
    await f.alert.waitFor();
    assert.equal(await f.alert.textContent(), f.copy.order.invalid);
    await f.orderGroup.waitFor();
    refuse = false;
    await f.remove.click();
    assert.equal(await f.alert.count(), 0, "the message goes with the order");
    await f.submit.click();
    await waitForCalls(harness, (calls) => calls.filter(isTicketCreate).length === 2);
    const [first, second] = harness.calls.filter(isTicketCreate);
    assert.equal(first.fields.orderId, ORDER_ID);
    assert.equal("orderId" in second.fields, false);
    assert.notEqual(first.key, second.key, "a different request gets a new Idempotency-Key");
    await page.getByRole("heading", { name: f.copy.success.title }).waitFor();
    await page.close();
  }
});

test("without an order nothing changes: Technical Support preset, no order line, no orderId", async () => {
  const locale: Locale = "en-GB";
  const harness = await openHarness(browser, locale, api());
  const { page } = harness;
  await mountContact(page, { locale });
  const f = ui(page, locale);
  assert.equal(await f.topic.textContent(), f.copy.categories.technical_support);
  assert.equal(await f.orderGroup.count(), 0);
  assert.equal(await page.locator(".helpdesk-form p[role=status]").count(), 0);
  await fill(page, locale);
  await f.submit.click();
  await waitForCalls(harness, (calls) => calls.some(isTicketCreate));
  assert.equal("orderId" in harness.calls.find(isTicketCreate)!.fields, false);
  await page.close();
});
