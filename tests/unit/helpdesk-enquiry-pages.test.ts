// Learner enquiry pages rendered in Chromium: EnquiryDetail
// (components/helpdesk/EnquiryDetail.tsx) in every state the server can show
// (controls come from the real domain rules), the My enquiries list page and
// the AccountNav "Contact support" link, in en-GB and zh-CN. Each write is
// checked for its expectedSequence and Idempotency-Key, and each rejection
// (409 stale / window passed / already rated, 404, 429, 5xx) for its message
// and whether the ticket is reloaded.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import type { TicketDetail, TicketSummary } from "../../contracts/helpdesk";
import { getMessages } from "../../lib/i18n/messages";
import { fillTemplate, relativeTime } from "../../modules/helpdesk/learnerUi";
import { PNG } from "./helpdesk-fixtures";
import { LOCALES, TICKET_ID, mountDetail, mountList, mountNav, openHarness, ticketFixture, waitForCalls, type ApiCall, type Handler, type Harness, type Locale, type Reply } from "./helpers/helpdesk-browser";

let browser: Browser;
before(async () => { browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined }); });
after(async () => { await browser?.close(); });

const copyFor = (locale: Locale) => getMessages(locale).helpdesk;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ACTIONS = `/api/helpdesk/tickets/${TICKET_ID}/actions`;
const MESSAGES = `/api/helpdesk/tickets/${TICKET_ID}/messages`;
const TICKET = `/api/helpdesk/tickets/${TICKET_ID}`;
const isAction = (call: ApiCall) => call.method === "POST" && call.path === ACTIONS;
const isMessage = (call: ApiCall) => call.method === "POST" && call.path === MESSAGES;
const isReload = (call: ApiCall) => call.method === "GET" && call.path === TICKET;
const count = (calls: ApiCall[], predicate: (call: ApiCall) => boolean) => calls.filter(predicate).length;

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function api(handlers: { action?: Handler; message?: Handler; reload?: Handler }): Handler {
  return (call) => {
    if (isAction(call) && handlers.action) return handlers.action(call);
    if (isMessage(call) && handlers.message) return handlers.message(call);
    if (isReload(call) && handlers.reload) return handlers.reload(call);
    return { status: 500 };
  };
}

async function openDetail(locale: Locale, ticket: TicketDetail, handler: Handler): Promise<Harness> {
  const harness = await openHarness(browser, locale, handler, `/${locale}/account/my-learning/support/${ticket.id}`);
  await mountDetail(harness.page, locale, ticket);
  return harness;
}

function detail(page: Page, locale: Locale) {
  const copy = copyFor(locale);
  return {
    copy,
    notice: page.locator(".helpdesk-detail-notice"),
    status: page.locator(".helpdesk-detail-title .helpdesk-status-pill"),
    banner: page.locator(".helpdesk-confirm-banner"),
    composer: page.locator("form.helpdesk-composer"),
    reply: page.getByRole("textbox", { name: copy.detail.replyLabel, exact: true }),
    send: page.locator("form.helpdesk-composer button[type=submit]"),
    readonly: page.locator(".helpdesk-readonly-note"),
    rating: page.locator(".helpdesk-rating"),
    chips: page.locator(".helpdesk-attachments .helpdesk-file-chip"),
    button: (name: string) => page.getByRole("button", { name, exact: true })
  };
}

async function noticeIs(page: Page, text: string) {
  await page.waitForFunction((expected) => document.querySelector(".helpdesk-detail-notice")?.textContent === expected, text, { timeout: 5_000 });
}

test("the page shows the ticket and only the controls the server allows in each state", async () => {
  for (const locale of LOCALES) {
    const copy = copyFor(locale);
    const cases: Array<{ ticket: TicketDetail; buttons: string[]; absent: string[]; composer: boolean; banner: boolean; rating: boolean; note?: string }> = [
      { ticket: ticketFixture("OPEN"), buttons: [copy.detail.withdraw, copy.detail.send], absent: [copy.detail.solved, copy.detail.confirmYes, copy.detail.followUp], composer: true, banner: false, rating: false },
      { ticket: ticketFixture("ASSIGNED"), buttons: [copy.detail.solved, copy.detail.send], absent: [copy.detail.withdraw, copy.detail.confirmYes], composer: true, banner: false, rating: false },
      { ticket: ticketFixture("WAITING_USER"), buttons: [copy.detail.solved, copy.detail.send], absent: [copy.detail.withdraw, copy.detail.confirmYes], composer: true, banner: false, rating: false },
      { ticket: ticketFixture("PENDING_CONFIRM"), buttons: [copy.detail.confirmYes, copy.detail.confirmNo, copy.detail.send], absent: [copy.detail.withdraw, copy.detail.solved], composer: true, banner: true, rating: false },
      { ticket: ticketFixture("CLOSED", { closedDaysAgo: 2 }), buttons: [copy.detail.followUp, fillTemplate(copy.detail.rateStar, { n: 1 })], absent: [copy.detail.withdraw, copy.detail.solved, copy.detail.send], composer: true, banner: false, rating: true },
      { ticket: ticketFixture("CLOSED", { closedDaysAgo: 8 }), buttons: [], absent: [copy.detail.followUp, fillTemplate(copy.detail.rateStar, { n: 1 })], composer: false, banner: false, rating: false, note: copy.detail.closedNote },
      { ticket: ticketFixture("CANCELLED"), buttons: [], absent: [copy.detail.followUp, copy.detail.send, copy.detail.withdraw], composer: false, banner: false, rating: false, note: copy.detail.cancelledNote }
    ];
    const harness = await openHarness(browser, locale, () => ({ status: 500 }), `/${locale}/account/my-learning/support/${TICKET_ID}`);
    const { page } = harness;
    const d = detail(page, locale);
    for (const item of cases) {
      const label = `${locale} ${item.ticket.status}${item.ticket.closedAt ? ` closed ${item.ticket.allowedActions.join("+") || "no actions"}` : ""}`;
      await mountDetail(page, locale, item.ticket);
      assert.equal(await d.status.textContent(), copy.status[item.ticket.status], label);
      assert.equal(await page.locator(".helpdesk-detail-number").textContent(), `LG-261025-0007 · ${copy.categories.technical_support}`);
      assert.equal(await page.getByRole("heading", { level: 1 }).textContent(), "Cannot reset my password");
      for (const name of item.buttons) assert.equal(await d.button(name).count(), 1, `${label}: shows ${name}`);
      for (const name of item.absent) assert.equal(await d.button(name).count(), 0, `${label}: hides ${name}`);
      assert.equal(await d.composer.count(), item.composer ? 1 : 0, `${label}: composer`);
      assert.equal(await d.banner.count(), item.banner ? 1 : 0, `${label}: confirm banner`);
      assert.equal(await d.rating.count(), item.rating ? 1 : 0, `${label}: rating`);
      if (item.note) assert.equal(await d.readonly.textContent(), item.note, label);
    }
    assert.equal(await page.getByRole("link", { name: copy.detail.back }).getAttribute("href"), `/${locale}/account/my-learning/support/enquiries`);
    assert.equal(harness.calls.length, 0, "showing a ticket sends nothing");
    await page.close();
  }
});

test("the conversation: messages in time order with authors, auto-linked text, attachments and the learner-visible state lines", async () => {
  const locale: Locale = "en-GB";
  const copy = copyFor(locale);
  const base = ticketFixture("WAITING_USER");
  const created = Date.parse(base.createdAt);
  const ticket = ticketFixture("WAITING_USER", {
    messages: [
      { ...base.messages[1], createdAt: new Date(created + 2_000).toISOString(), attachments: [
        { id: "a-1", fileName: "steps.pdf", contentType: "application/pdf", sizeBytes: 2048, url: "/api/helpdesk/attachments/a-1" },
        { id: "a-2", fileName: "shot.png", contentType: "image/png", sizeBytes: 100, url: "/api/helpdesk/attachments/a-2" }
      ] },
      base.messages[0],
      { id: "m-4", authorKind: "agent", authorName: null, body: "Any luck?", createdAt: new Date(created + 4_000).toISOString(), attachments: [] }
    ],
    timeline: [
      { id: "e-1", type: "claimed", time: new Date(created + 1_000).toISOString(), fromStatus: "OPEN", toStatus: "ASSIGNED", actor: { kind: "agent", name: "Alex" } },
      { id: "e-2", type: "tag_added", time: new Date(created + 1_500).toISOString(), fromStatus: "ASSIGNED", toStatus: "ASSIGNED", actor: { kind: "agent", name: "Alex" } },
      { id: "e-3", type: "claimed", time: new Date(created + 3_000).toISOString(), fromStatus: "ASSIGNED", toStatus: "ASSIGNED", actor: { kind: "agent", name: null } }
    ]
  });
  const harness = await openDetail(locale, ticket, api({}));
  const { page } = harness;
  const items = await page.locator(".helpdesk-conversation > li").evaluateAll((elements) => elements.map((element) => element.className + "|" + (element.querySelector(".helpdesk-message-author strong, span")?.textContent ?? "")));
  assert.deepEqual(items, ["helpdesk-message helpdesk-message-learner|" + copy.detail.you, "helpdesk-event|" + fillTemplate(copy.detail.events.claimed, { name: "Alex" }), "helpdesk-message helpdesk-message-agent|Alex", "helpdesk-event|" + copy.detail.events.claimedNoName, "helpdesk-message helpdesk-message-agent|" + copy.detail.supportTeam], "time order; tag changes stay private; unnamed agents read as the support team");
  assert.equal(await page.locator(".helpdesk-message-learner .helpdesk-message-body p").count(), 2, "each line is a paragraph");
  const link = page.locator(".helpdesk-message-agent").getByRole("link", { name: "https://example.com/reset" });
  assert.equal(await link.getAttribute("target"), "_blank");
  assert.equal(await link.getAttribute("rel"), "noopener noreferrer");
  const download = page.getByRole("link", { name: fillTemplate(copy.detail.download, { name: "steps.pdf" }) });
  assert.equal(await download.getAttribute("href"), "/api/helpdesk/attachments/a-1");
  assert.equal(await download.getAttribute("download"), "steps.pdf");
  assert.equal(await page.locator(".helpdesk-attachment-image img").getAttribute("alt"), "shot.png", "images show inline");
  await page.close();
});

test("OPEN: Withdraw asks first; Keep it backs out; Withdraw enquiry sends cancel with the shown sequence and shows the withdrawn state", async () => {
  for (const locale of LOCALES) {
    const harness = await openDetail(locale, ticketFixture("OPEN"), api({ action: () => ({ json: ticketFixture("CANCELLED", { sequence: 5 }) }) }));
    const { page } = harness;
    const d = detail(page, locale);
    await d.button(d.copy.detail.withdraw).click();
    const confirm = page.getByRole("group", { name: d.copy.detail.withdrawConfirm });
    await confirm.waitFor();
    assert.equal(await d.button(d.copy.detail.withdraw).count(), 0, "the Withdraw button gives way to the question");
    await confirm.getByRole("button", { name: d.copy.detail.keep }).click();
    assert.equal(await confirm.count(), 0);
    assert.equal(harness.calls.length, 0, "asking sends nothing");
    await d.button(d.copy.detail.withdraw).click();
    await confirm.getByRole("button", { name: d.copy.detail.withdrawYes }).click();
    await d.readonly.waitFor();
    const sent = harness.calls.filter(isAction);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].json, { action: "cancel", expectedSequence: 4 });
    assert.match(sent[0].key ?? "", UUID);
    assert.equal(await d.readonly.textContent(), d.copy.detail.cancelledNote);
    assert.equal(await d.status.textContent(), d.copy.status.CANCELLED);
    assert.equal(await d.composer.count(), 0);
    await page.close();
  }
});

test("WAITING_USER: a reply with a file is sent once, kept after a lost response and resent with the same key, then cleared", async () => {
  for (const locale of LOCALES) {
    const hold = deferred();
    let sends = 0;
    const replied = ticketFixture("ASSIGNED", { sequence: 5, messages: [...ticketFixture("WAITING_USER").messages, { id: "m-3", authorKind: "learner", authorName: "Emily Chen", body: "Still broken", createdAt: new Date().toISOString(), attachments: [] }] });
    const harness = await openDetail(locale, ticketFixture("WAITING_USER"), api({ message: async () => { await hold.promise; return ++sends === 1 ? { status: 503, json: { code: "helpdesk_unavailable" } } : { json: replied }; } }));
    const { page } = harness;
    const d = detail(page, locale);
    await d.send.click();
    await noticeIs(page, d.copy.validation.message);
    assert.equal(harness.calls.length, 0, "an empty reply is not sent");
    await d.reply.fill("  Still broken\nsee the screenshot  ");
    await page.locator(".helpdesk-composer input[type=file]").setInputFiles({ name: "again.png", mimeType: "image/png", buffer: PNG });
    await d.send.click();
    await waitForCalls(harness, (calls) => count(calls, isMessage) === 1);
    assert.equal(await d.send.textContent(), d.copy.detail.sending);
    for (const name of [d.copy.detail.sending, d.copy.detail.solved]) assert.equal(await d.button(name).isDisabled(), true, `${name} is disabled while sending`);
    await d.send.evaluate((button) => (button as HTMLButtonElement).form!.requestSubmit());
    hold.resolve();
    await noticeIs(page, d.copy.errors.unavailable);
    const first = harness.calls.find(isMessage)!;
    assert.deepEqual(first.fields, { body: "Still broken\nsee the screenshot", expectedSequence: "4" });
    assert.deepEqual(first.files, [{ name: "again.png", size: PNG.length, type: "image/png" }]);
    assert.match(first.key ?? "", UUID);
    assert.equal(count(harness.calls, isReload), 0, "a 5xx does not reload");
    assert.equal(await d.reply.inputValue(), "  Still broken\nsee the screenshot  ", "the reply is kept");
    assert.equal(await d.chips.count(), 1, "and its file");
    await d.send.click();
    await waitForCalls(harness, (calls) => count(calls, isMessage) === 2);
    assert.equal(harness.calls.filter(isMessage)[1].key, first.key, "the resend is the same logical submit");
    await page.waitForFunction(() => (document.querySelector(".helpdesk-composer textarea") as HTMLTextAreaElement).value === "");
    assert.equal(await d.chips.count(), 0, "a sent reply clears the files");
    assert.equal(await d.status.textContent(), d.copy.status.ASSIGNED);
    assert.equal(await page.locator(".helpdesk-message-learner").last().locator(".helpdesk-message-body").textContent(), "Still broken");
    assert.equal(await d.notice.count(), 0);
    await page.close();
  }
});

test("429 rate_limited and other 4xx on a reply: one message, no reload, the text stays, the next Send gets a new key", async () => {
  for (const locale of LOCALES) {
    const replies: Reply[] = [{ status: 429, json: { code: "rate_limited" } }, { status: 413, json: { code: "attachment_too_large" } }, { status: 400, json: { code: "validation_failed" } }];
    const expected = ["rateLimited", "tooLarge", "invalid"] as const;
    let index = 0;
    const harness = await openDetail(locale, ticketFixture("WAITING_USER"), api({ message: () => replies[index++] }));
    const { page } = harness;
    const d = detail(page, locale);
    await d.reply.fill("Any news?");
    for (let attempt = 0; attempt < replies.length; attempt++) {
      await d.send.click();
      await noticeIs(page, d.copy.errors[expected[attempt]]);
    }
    assert.equal(count(harness.calls, isReload), 0, "4xx other than 404 / 409 never reload");
    const keys = harness.calls.filter(isMessage).map((call) => call.key);
    assert.equal(new Set(keys).size, 3);
    assert.equal(await d.reply.inputValue(), "Any news?");
    await page.close();
  }
});

test("PENDING_CONFIRM asks 问题解决了吗？ / Is it solved?: 已解决 / Solved sends confirm, 没解决 / Not yet sends reject", async () => {
  const words = { "zh-CN": ["问题解决了吗？", "已解决", "没解决"], "en-GB": ["Is it solved?", "Solved", "Not yet"] } as const;
  for (const locale of LOCALES) {
    const [prompt, yes, no] = words[locale];
    for (const [button, action, next] of [[yes, "confirm", ticketFixture("CLOSED", { sequence: 5, closedDaysAgo: 0 })], [no, "reject", ticketFixture("ASSIGNED", { sequence: 5 })]] as const) {
      const pending = ticketFixture("PENDING_CONFIRM");
      const harness = await openDetail(locale, pending, api({ action: () => ({ json: next }) }));
      const { page } = harness;
      const d = detail(page, locale);
      assert.equal(await d.banner.getByRole("heading", { level: 2 }).textContent(), prompt);
      assert.equal(await page.getByRole("region", { name: prompt }).count(), 1, "the banner is named by its question");
      assert.deepEqual(await d.banner.getByRole("button").allTextContents(), [yes, no]);
      const [before] = d.copy.detail.autoConfirm.split("{time}");
      await page.waitForFunction((text) => document.querySelector(".helpdesk-confirm-banner p")?.textContent?.startsWith(text), before);
      assert.equal(await d.banner.locator("p").textContent(), fillTemplate(d.copy.detail.autoConfirm, { time: relativeTime(pending.confirmDueAt!, Date.now(), locale) }), "auto-close time is relative, in the page's language");
      await d.banner.getByRole("button", { name: button, exact: true }).click();
      await waitForCalls(harness, (calls) => count(calls, isAction) === 1);
      assert.deepEqual(harness.calls.find(isAction)!.json, { action, expectedSequence: 4 });
      await d.banner.waitFor({ state: "detached" });
      assert.equal(await d.status.textContent(), d.copy.status[next.status]);
      if (action === "confirm") assert.equal(await d.rating.count(), 1, "a confirmed enquiry can be rated");
      await page.close();
    }
  }
});

test("409 stale_ticket reloads the ticket and says it was updated; a failed reload says support is unavailable", async () => {
  for (const locale of LOCALES) {
    const fresh = ticketFixture("ASSIGNED", { sequence: 6 });
    let reloadOk = true;
    const harness = await openDetail(locale, ticketFixture("PENDING_CONFIRM"), api({ action: () => ({ status: 409, json: { code: "stale_ticket" } }), reload: () => (reloadOk ? { json: fresh } : { status: 503 }) }));
    const { page } = harness;
    const d = detail(page, locale);
    await d.button(d.copy.detail.confirmYes).click();
    await noticeIs(page, d.copy.detail.updated);
    assert.equal(count(harness.calls, isReload), 1);
    assert.equal(await d.banner.count(), 0, "the stale confirm question goes away");
    assert.equal(await d.status.textContent(), d.copy.status.ASSIGNED);
    // The next write carries the reloaded sequence.
    reloadOk = false;
    await d.button(d.copy.detail.solved).click();
    await waitForCalls(harness, (calls) => count(calls, isAction) === 2);
    assert.deepEqual(harness.calls.filter(isAction)[1].json, { action: "close", expectedSequence: 6 });
    await noticeIs(page, d.copy.errors.unavailable);
    assert.equal(await d.status.textContent(), d.copy.status.ASSIGNED, "a failed reload leaves the page as it was");
    const keys = harness.calls.filter(isAction).map((call) => call.key);
    assert.notEqual(keys[0], keys[1]);
    await page.close();
  }
});

test("CLOSED within 7 days: follow up with the window shown, and rate 1-5 once", async () => {
  for (const locale of LOCALES) {
    const closed = ticketFixture("CLOSED", { closedDaysAgo: 2 });
    const harness = await openDetail(locale, closed, api({
      action: (call) => ({ json: ticketFixture("CLOSED", { closedDaysAgo: 2, sequence: 5, rating: Number(call.json?.rating) }) }),
      message: () => ({ json: ticketFixture("ASSIGNED", { sequence: 6 }) })
    }));
    const { page } = harness;
    const d = detail(page, locale);
    const [before] = d.copy.detail.followUpHint.split("{time}");
    await page.waitForFunction((text) => document.querySelector(".helpdesk-composer-hint")?.textContent?.startsWith(text), before);
    assert.equal(await page.locator(".helpdesk-composer-hint time").getAttribute("datetime"), closed.followUpUntil);
    assert.equal(await d.send.textContent(), d.copy.detail.followUp);
    assert.equal(await d.rating.getByRole("heading").textContent(), d.copy.detail.rateTitle);
    const stars = d.rating.getByRole("button");
    assert.deepEqual(await stars.evaluateAll((elements) => elements.map((element) => element.getAttribute("aria-label"))), [1, 2, 3, 4, 5].map((n) => fillTemplate(d.copy.detail.rateStar, { n })));
    await d.button(fillTemplate(d.copy.detail.rateStar, { n: 4 })).click();
    await d.rating.getByRole("status").waitFor();
    assert.deepEqual(harness.calls.find(isAction)!.json, { action: "rate", expectedSequence: 4, rating: 4 });
    assert.equal(await d.rating.getByRole("status").textContent(), fillTemplate(d.copy.detail.rated, { n: 4 }));
    assert.equal(await stars.count(), 0, "rated once: the stars go");
    await d.reply.fill("It broke again");
    await d.send.click();
    await waitForCalls(harness, (calls) => count(calls, isMessage) === 1);
    assert.deepEqual(harness.calls.find(isMessage)!.fields, { body: "It broke again", expectedSequence: "5" });
    await page.waitForFunction((text) => document.querySelector(".helpdesk-detail-title .helpdesk-status-pill")?.textContent === text, d.copy.status.ASSIGNED);
    assert.equal(await d.send.textContent(), d.copy.detail.send, "reopened: Follow up becomes Send");
    await page.close();
  }
});

test("a window that passed while the page was open: the 409 reloads the ticket, the controls go and the reason is shown", async () => {
  for (const locale of LOCALES) {
    const passed = ticketFixture("CLOSED", { closedDaysAgo: 8, sequence: 4 });
    const rated = ticketFixture("CLOSED", { closedDaysAgo: 2, sequence: 5, rating: 5 });
    const cases: Array<{ code: string; send: "reply" | "rate"; key: "reopenWindow" | "ratingWindow" | "alreadyRated"; fresh: TicketDetail }> = [
      { code: "reopen_window_passed", send: "reply", key: "reopenWindow", fresh: passed },
      { code: "rating_window_passed", send: "rate", key: "ratingWindow", fresh: passed },
      { code: "already_rated", send: "rate", key: "alreadyRated", fresh: rated }
    ];
    for (const item of cases) {
      const harness = await openDetail(locale, ticketFixture("CLOSED", { closedDaysAgo: 2 }), api({ action: () => ({ status: 409, json: { code: item.code } }), message: () => ({ status: 409, json: { code: item.code } }), reload: () => ({ json: item.fresh }) }));
      const { page } = harness;
      const d = detail(page, locale);
      if (item.send === "reply") { await d.reply.fill("One more thing"); await d.send.click(); }
      else await d.button(fillTemplate(d.copy.detail.rateStar, { n: 2 })).click();
      await noticeIs(page, d.copy.errors[item.key]);
      assert.equal(count(harness.calls, isReload), 1, `${item.code} reloads`);
      if (item.fresh === passed) {
        assert.equal(await d.composer.count(), 0, `${item.code}: no more follow-up`);
        assert.equal(await d.readonly.textContent(), d.copy.detail.closedNote);
        assert.equal(await d.rating.count(), 0);
      } else assert.equal(await d.rating.getByRole("status").textContent(), fillTemplate(d.copy.detail.rated, { n: 5 }));
      await page.close();
    }
  }
});

test("404 on an action reloads too, and an enquiry that is gone says so", async () => {
  const locale: Locale = "zh-CN";
  const harness = await openDetail(locale, ticketFixture("WAITING_USER"), api({ action: () => ({ status: 404, json: { code: "not_found" } }), reload: () => ({ status: 404, json: { code: "not_found" } }) }));
  const { page } = harness;
  const d = detail(page, locale);
  await d.button(d.copy.detail.solved).click();
  await noticeIs(page, d.copy.errors.notFound);
  assert.equal(count(harness.calls, isReload), 1);
  await page.close();
});

test("a double click on an action sends one request", async () => {
  const locale: Locale = "en-GB";
  const harness = await openDetail(locale, ticketFixture("PENDING_CONFIRM"), api({ action: () => ({ json: ticketFixture("CLOSED", { sequence: 5, closedDaysAgo: 0 }) }) }));
  const { page } = harness;
  const d = detail(page, locale);
  await d.button(d.copy.detail.confirmYes).evaluate((button) => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await d.banner.waitFor({ state: "detached" });
  await page.waitForTimeout(100);
  assert.equal(count(harness.calls, isAction), 1);
  await page.close();
});

function summary(ticket: TicketDetail, overrides: Partial<TicketSummary>): TicketSummary {
  const { id, number, subject, category, status, createdAt, updatedAt, lastMessageAt, lastMessageBy, confirmDueAt, closedAt, sequence } = ticket;
  return { id, number, subject, category, status, createdAt, updatedAt, lastMessageAt, lastMessageBy, confirmDueAt, closedAt, sequence, ...overrides };
}

test("My enquiries: the signed-in learner's tickets (by Portal user id) as cards, an empty state, an unavailable state and the sign-in redirect", async () => {
  for (const locale of LOCALES) {
    const copy = copyFor(locale);
    const harness = await openHarness(browser, locale, () => ({ status: 500 }), `/${locale}/account/my-learning/support/enquiries`);
    const { page } = harness;
    const user = { id: "user-42", email: "emily@example.com", nickname: "Emily" };
    const tickets = [
      summary(ticketFixture("WAITING_USER"), { id: "11111111-1111-4111-8111-111111111111", number: "LG-261028-0002", subject: "Second", category: "payments_subscriptions", updatedAt: "2026-10-28T09:30:00.000Z" }),
      summary(ticketFixture("CLOSED"), { id: "22222222-2222-4222-8222-222222222222", number: "LG-261020-0001", subject: "First", category: "other" })
    ];
    const listed = await mountList(page, { locale, user, tickets });
    assert.equal(listed.result, "rendered");
    assert.deepEqual(listed.identities, [{ id: "user-42", email: "emily@example.com", name: "Emily" }], "Student ID is the Portal user id");
    assert.equal(await page.getByRole("heading", { level: 1 }).textContent(), copy.list.title);
    const cards = page.locator(".helpdesk-enquiry-card");
    assert.deepEqual(await cards.evaluateAll((elements) => elements.map((element) => element.getAttribute("href"))), tickets.map((ticket) => `/${locale}/account/my-learning/support/${ticket.id}`));
    assert.equal(await cards.nth(0).locator(".helpdesk-enquiry-number").textContent(), `LG-261028-0002 · ${copy.categories.payments_subscriptions}`);
    assert.equal(await cards.nth(0).locator("strong").textContent(), "Second");
    assert.deepEqual(await cards.locator(".helpdesk-status-pill").allTextContents(), [copy.status.WAITING_USER, copy.status.CLOSED]);
    assert.equal(await cards.nth(0).locator("time").getAttribute("datetime"), "2026-10-28T09:30:00.000Z");
    const [before, afterTime] = copy.list.updated.split("{time}");
    const updated = await cards.nth(0).locator(".helpdesk-enquiry-updated").textContent();
    assert.ok(updated?.startsWith(before) && updated.endsWith(afterTime), updated ?? "");
    assert.equal(await page.getByRole("link", { name: copy.list.newEnquiry, exact: true }).first().getAttribute("href"), `/${locale}/account/my-learning/support`);
    assert.equal(await page.getByRole("navigation", { name: getMessages(locale).account.menu }).getByRole("link", { name: getMessages(locale).account.contactAction }).getAttribute("href"), `/${locale}/account/my-learning/support`);
    assert.equal((await mountList(page, { locale, user, tickets: [] })).result, "rendered");
    assert.equal(await page.locator(".helpdesk-empty p").textContent(), copy.list.empty);
    assert.equal(await page.locator(".helpdesk-empty a").getAttribute("href"), `/${locale}/account/my-learning/support`);
    assert.equal((await mountList(page, { locale, user, fail: true })).result, "rendered");
    assert.equal(await page.getByRole("alert").textContent(), copy.errors.unavailable);
    assert.equal(await cards.count(), 0);
    const signedOut = await mountList(page, { locale, user: null });
    assert.equal(signedOut.result, `redirect:/${locale}/portal/sign-in?returnTo=/${locale}/account/my-learning/support/enquiries`);
    assert.deepEqual(signedOut.identities, [], "signed out: nothing is listed");
    await page.close();
  }
});

test("AccountNav: Contact support links to the signed-in support form in both languages", async () => {
  for (const locale of LOCALES) {
    const account = getMessages(locale).account;
    const harness = await openHarness(browser, locale, () => ({ status: 500 }), `/${locale}/account/my-learning`);
    const { page } = harness;
    await mountNav(page, locale);
    const nav = page.getByRole("navigation", { name: account.menu });
    const contact = nav.getByRole("link", { name: account.contactAction, exact: true });
    assert.equal(await contact.getAttribute("href"), `/${locale}/account/my-learning/support`);
    assert.equal(await nav.locator(".account-nav-support strong").textContent(), account.contact);
    assert.equal(await nav.locator(".account-nav-support p").textContent(), account.supportDescription);
    assert.equal(await nav.locator("[aria-current=page]").getAttribute("href"), `/${locale}/account/my-learning`);
    await page.close();
  }
});
