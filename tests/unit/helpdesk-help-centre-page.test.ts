// The public Help Centre, /{locale}/help (Figma 1387:2), rendered in Chromium:
// the real page (server component) against a stubbed Admin client. Popular
// articles with their summary line and category link, inline answers through
// the shared Markdown renderer, debounced ?q= search with results and an empty
// state, the box following ?q= on in-place navigation, the busy list and the
// result count, ?category=, the ?faq= deep link (listed, loaded by id, or
// missing; never added to search results or another topic), the static
// fallback when Admin is down, the Contact Support button signed-in and
// signed-out, and the 1387:2 measurements at 1440 px, in en-GB and zh-CN.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import { getMessages } from "../../lib/i18n/messages";
import { fillTemplate } from "../../modules/helpdesk/learnerUi";
import { LOCALES, mountHelp, openHarness, type Locale } from "./helpers/helpdesk-browser";

let browser: Browser;
before(async () => { browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined }); });
after(async () => { await browser?.close(); });

const copyFor = (locale: Locale) => getMessages(locale).helpCentre;
const id = (n: number) => `01a18100-0000-7000-8000-${String(n).padStart(12, "0")}`;
const FAQS = [
  { id: id(1), category: "account_technical", popular: true, question: "How do I reset my password?", answer: "Follow the steps to regain access to your **Learning Guide** account.\n\n1. Open [Reset](https://example.com/reset)\n2. Check your email", updatedAt: "2026-10-28T10:00:00.000Z" },
  { id: id(2), category: "courses_learning", popular: true, question: "How can I access my course materials?", answer: "Find your enrolled courses and open the available lessons and resources.", updatedAt: "2026-10-28T10:00:00.000Z" },
  { id: id(3), category: "payments_subscriptions", popular: true, question: "How do I change my subscription?", answer: "Learn where to review your plan and the available subscription options.", updatedAt: "2026-10-28T10:00:00.000Z" },
  { id: id(4), category: "payments_subscriptions", popular: true, question: "Where can I find my invoice?", answer: "See where you can access the billing records for your payments.", updatedAt: "2026-10-28T10:00:00.000Z" },
  { id: id(5), category: "payments_subscriptions", popular: true, question: "Why did my payment fail?", answer: "Check common payment issues and the next steps you can try.", updatedAt: "2026-10-28T10:00:00.000Z" },
  { id: id(6), category: "courses_learning", popular: true, question: "How do I join a live session?", answer: "Find your scheduled sessions and the information for joining them.", updatedAt: "2026-10-28T10:00:00.000Z" },
  { id: id(7), category: "other", popular: false, question: "Can I suggest a feature?", answer: "<script>alert(1)</script> Yes, [tell us](javascript:alert`1`).", updatedAt: "2026-10-28T10:00:00.000Z" }
];

async function open(locale: Locale, props: Omit<Parameters<typeof mountHelp>[1], "locale"> = {}) {
  const harness = await openHarness(browser, locale, () => ({ status: 500 }), `/${locale}/help`);
  const mounted = await mountHelp(harness.page, { locale, faqs: FAQS, ...props });
  assert.equal(mounted.result, "rendered");
  return { ...harness, requests: mounted.requests };
}

function view(page: Page, locale: Locale) {
  const copy = copyFor(locale);
  return {
    copy,
    articles: page.locator(".help-centre-article"),
    questions: page.locator(".help-centre-article-question"),
    search: page.getByRole("searchbox", { name: copy.searchLabel }),
    topics: page.getByRole("navigation", { name: copy.topicsTitle }).getByRole("link"),
    contact: page.getByRole("link", { name: copy.contactButton, exact: true })
  };
}

test("popular articles: question, summary line and category link per row; answers open inline, rendered safely", async () => {
  for (const locale of LOCALES) {
    const harness = await open(locale);
    const { page } = harness;
    const v = view(page, locale);
    assert.deepEqual(harness.requests, [{ kind: "faqs", locale, filter: { popular: true, limit: 10 } }]);
    assert.equal(await page.getByRole("heading", { level: 1 }).textContent(), v.copy.title);
    assert.ok((await page.locator(".help-centre-hero").textContent())?.includes(v.copy.subtitle));
    assert.equal(await v.search.getAttribute("placeholder"), v.copy.searchPlaceholder);
    assert.equal(await page.getByRole("heading", { level: 2, name: v.copy.popularTitle }).count(), 1);
    assert.ok((await page.locator(".help-centre-list-header").textContent())?.includes(v.copy.popularSubtitle));
    assert.deepEqual(await v.questions.allTextContents(), FAQS.slice(0, 6).map((faq) => faq.question), "popular FAQs in Admin's order");
    const first = v.articles.first();
    assert.equal(await first.locator(".help-centre-article-summary").textContent(), "Follow the steps to regain access to your Learning Guide account.", "the summary is the first line, Markdown stripped");
    const category = first.getByRole("link", { name: v.copy.categories.account_technical });
    assert.equal(await category.getAttribute("href"), `/${locale}/help?category=account_technical`);
    const question = first.getByRole("button", { name: FAQS[0].question });
    assert.equal(await question.getAttribute("aria-expanded"), "false");
    assert.equal(await first.locator(".help-centre-answer").count(), 0);
    await question.click();
    assert.equal(await question.getAttribute("aria-expanded"), "true");
    const answer = first.locator(".help-centre-answer");
    assert.deepEqual(await answer.locator("ol > li").allTextContents(), ["Open Reset", "Check your email"]);
    assert.equal(await answer.getByRole("link", { name: "Reset" }).getAttribute("rel"), "noopener noreferrer");
    await question.click();
    assert.equal(await question.getAttribute("aria-expanded"), "false", "a second click closes it");
    assert.deepEqual(await v.topics.allTextContents(), Object.values(v.copy.categories));
    assert.deepEqual(await v.topics.evaluateAll((links) => links.map((link) => link.getAttribute("href"))), ["account_technical", "courses_learning", "payments_subscriptions", "other"].map((value) => `/${locale}/help?category=${value}`));
    assert.ok((await page.locator(".help-centre-contact").textContent())?.includes(v.copy.contactBody));
    await page.close();
  }
});

test("search is debounced into ?q=, answered by Admin's search, with results or an empty state", async () => {
  for (const locale of LOCALES) {
    const harness = await open(locale);
    const { page } = harness;
    const v = view(page, locale);
    await v.search.pressSequentially("invo", { delay: 20 });
    await v.search.pressSequentially("ice ", { delay: 20 });
    await page.waitForFunction(() => (window as unknown as { __nav: unknown[] }).__nav.length > 0, null, { timeout: 3_000 });
    await page.waitForTimeout(500);
    assert.deepEqual(await harness.nav(), [["replace", `/${locale}/help?q=invoice`]], "one navigation after typing stops, with the trimmed words");
    await v.search.fill("");
    await page.waitForFunction(() => (window as unknown as { __nav: unknown[] }).__nav.length > 1, null, { timeout: 3_000 });
    assert.deepEqual((await harness.nav())[1], ["replace", `/${locale}/help`], "clearing the search goes back to popular articles");

    const found = await mountHelp(page, { locale, faqs: FAQS, searchParams: { q: "invoice", category: "other" }, search: { invoice: [FAQS[3]] } });
    assert.deepEqual(found.requests, [{ kind: "faqs", locale, filter: { q: "invoice", limit: 50 } }], "the search goes to Admin (q), ignoring the category");
    assert.equal(await v.search.inputValue(), "invoice", "the box shows the current search");
    assert.equal(await page.getByRole("heading", { level: 2 }).first().textContent(), v.copy.searchTitle);
    assert.ok((await page.locator(".help-centre-list-header").textContent())?.includes(fillTemplate(v.copy.searchSubtitle, { q: "invoice" })));
    assert.deepEqual(await v.questions.allTextContents(), [FAQS[3].question]);
    assert.equal(await page.getByRole("link", { name: v.copy.allArticles }).getAttribute("href"), `/${locale}/help`);

    await mountHelp(page, { locale, faqs: FAQS, searchParams: { q: "zzz" } });
    assert.equal(await v.articles.count(), 0);
    assert.equal(await page.locator(".help-centre-empty").textContent(), fillTemplate(v.copy.searchEmpty, { q: "zzz" }));
    await page.close();
  }
});

test("?category= lists that topic under its name and marks the topic link", async () => {
  for (const locale of LOCALES) {
    const harness = await open(locale, { searchParams: { category: "payments_subscriptions" } });
    const { page } = harness;
    const v = view(page, locale);
    assert.deepEqual(harness.requests, [{ kind: "faqs", locale, filter: { category: "payments_subscriptions", limit: 50 } }]);
    assert.equal(await page.getByRole("heading", { level: 2 }).first().textContent(), v.copy.categories.payments_subscriptions);
    assert.deepEqual(await v.questions.allTextContents(), [FAQS[2], FAQS[3], FAQS[4]].map((faq) => faq.question));
    assert.equal(await v.topics.nth(2).getAttribute("aria-current"), "page");
    assert.equal(await v.topics.nth(0).getAttribute("aria-current"), null);
    await mountHelp(page, { locale, faqs: FAQS, searchParams: { category: "unknown" } });
    assert.equal(await page.getByRole("heading", { level: 2 }).first().textContent(), v.copy.popularTitle, "an unknown category is the popular list");
    await page.close();
  }
});

test("?faq= opens and scrolls to the article, loading it by id when it is not listed; Markdown stays safe", async () => {
  for (const locale of LOCALES) {
    const harness = await open(locale);
    const { page } = harness;
    const v = view(page, locale);
    await page.setViewportSize({ width: 1280, height: 500 });
    const listed = await mountHelp(page, { locale, faqs: FAQS, searchParams: { faq: id(6) } });
    assert.equal(listed.requests.length, 1, "listed: no extra request");
    const sixth = page.getByRole("button", { name: FAQS[5].question });
    assert.equal(await sixth.getAttribute("aria-expanded"), "true");
    await page.waitForFunction((question) => { const node = [...document.querySelectorAll(".help-centre-article-question")].find((item) => item.textContent === question)!; const box = node.getBoundingClientRect(); return scrollY > 0 && box.top >= 0 && box.bottom <= innerHeight; }, FAQS[5].question, { timeout: 3_000 });

    const loaded = await mountHelp(page, { locale, faqs: FAQS.slice(0, 6), extra: [FAQS[6]], searchParams: { faq: id(7) } });
    assert.deepEqual(loaded.requests[1], { kind: "faq", locale, id: id(7) });
    assert.equal(await v.questions.first().textContent(), FAQS[6].question, "loaded by id and shown first");
    const answer = v.articles.first().locator(".help-centre-answer");
    assert.equal(await answer.locator("script").count(), 0);
    assert.ok((await answer.textContent())?.includes("<script>alert(1)</script> Yes, tell us."), "raw HTML stays text and a javascript: link keeps its label");
    assert.equal(await answer.locator("a").count(), 0);
    await page.close();
  }
});

test("the search box follows ?q= when the page changes in place: a topic link, All articles, browser Back", async () => {
  for (const locale of LOCALES) {
    const harness = await open(locale);
    const { page } = harness;
    const v = view(page, locale);
    const searchFaqs = { invoice: [FAQS[3]], inv: [FAQS[3], FAQS[4]] };
    const go = (searchParams: Record<string, string>) => mountHelp(page, { locale, faqs: FAQS, search: searchFaqs, searchParams, inPlace: true });
    // root.render commits asynchronously, so the box is read once React has applied the new page (bounded).
    const box = async (want: string, message?: string) => {
      for (let i = 0; i < 100 && (await v.search.inputValue()) !== want; i++) await page.waitForTimeout(20);
      assert.equal(await v.search.inputValue(), want, message);
    };
    await v.search.pressSequentially("invoice", { delay: 20 });
    await page.waitForFunction(() => (window as unknown as { __nav: unknown[] }).__nav.length > 0, null, { timeout: 3_000 });
    await go({ q: "invoice" });
    await box("invoice");
    await go({ category: "courses_learning" });
    assert.equal(await page.getByRole("heading", { level: 2 }).first().textContent(), v.copy.categories.courses_learning);
    await box("", "a topic link clears the box");
    await go({ q: "inv" });
    await box("inv", "Back to an older search shows its words");
    await go({});
    await box("", "All articles clears the box");
    await page.waitForTimeout(400);
    assert.deepEqual(await harness.nav(), [["replace", `/${locale}/help?q=invoice`]], "following the URL does not start a search of its own");
    await v.search.pressSequentially("invoice", { delay: 20 });
    await page.waitForFunction(() => (window as unknown as { __nav: unknown[] }).__nav.length > 1, null, { timeout: 3_000 });
    assert.deepEqual((await harness.nav())[1], ["replace", `/${locale}/help?q=invoice`], "the same words can be searched again");
    await page.close();
  }
});

test("words typed while a search is on its way are kept when its results land, and searched next", async () => {
  const locale: Locale = "en-GB";
  const harness = await open(locale);
  const { page } = harness;
  const v = view(page, locale);
  await v.search.pressSequentially("invoice", { delay: 20 });
  await page.waitForFunction(() => (window as unknown as { __nav: unknown[] }).__nav.length > 0, null, { timeout: 3_000 });
  await v.search.pressSequentially(" fee", { delay: 20 });
  await mountHelp(page, { locale, faqs: FAQS, search: { invoice: [FAQS[3]] }, searchParams: { q: "invoice" }, inPlace: true });
  assert.equal(await v.search.inputValue(), "invoice fee");
  await page.waitForFunction(() => (window as unknown as { __nav: unknown[] }).__nav.length > 1, null, { timeout: 3_000 });
  assert.deepEqual((await harness.nav())[1], ["replace", `/${locale}/help?q=invoice+fee`]);
  await page.close();
});

test("a search marks the list busy until its results land, and announces how many it found", async () => {
  for (const locale of LOCALES) {
    const harness = await open(locale);
    const { page } = harness;
    const v = view(page, locale);
    const list = page.locator(".help-centre-list");
    const status = page.locator(".help-centre-status");
    assert.equal(await list.getAttribute("aria-busy"), "false");
    assert.equal(await status.getAttribute("role"), "status");
    assert.equal(await status.textContent(), "");
    await v.search.pressSequentially("invoice", { delay: 20 });
    await page.waitForFunction(() => (window as unknown as { __nav: unknown[] }).__nav.length > 0, null, { timeout: 3_000 });
    assert.equal(await list.getAttribute("aria-busy"), "true", "busy while the server answers");
    await mountHelp(page, { locale, faqs: FAQS, search: { invoice: [FAQS[3]] }, searchParams: { q: "invoice" }, inPlace: true });
    assert.equal(await list.getAttribute("aria-busy"), "false");
    assert.equal(await status.textContent(), fillTemplate(v.copy.searchCount, { count: "1" }));
    await mountHelp(page, { locale, faqs: FAQS, searchParams: { q: "zzz" }, inPlace: true });
    assert.equal(await status.textContent(), fillTemplate(v.copy.searchCount, { count: "0" }));
    await page.close();
  }
});

test("?faq= for an archived or unknown FAQ says so above the list; it never joins search results or another topic", async () => {
  for (const locale of LOCALES) {
    const harness = await open(locale, { searchParams: { faq: id(99) } });
    const { page } = harness;
    const v = view(page, locale);
    const notice = page.locator(".help-centre-notice");
    assert.equal(await notice.textContent(), v.copy.faqMissing);
    assert.equal(await notice.getAttribute("role"), "status");
    assert.deepEqual(await v.questions.allTextContents(), FAQS.slice(0, 6).map((faq) => faq.question), "the popular list is still there");
    await mountHelp(page, { locale, faqs: FAQS.slice(0, 6), extra: [FAQS[6]], search: { password: [FAQS[0]] }, searchParams: { q: "password", faq: id(7) } });
    assert.deepEqual(await v.questions.allTextContents(), [FAQS[0].question], "search results are Admin's matches only");
    assert.equal(await notice.count(), 0);
    await mountHelp(page, { locale, faqs: FAQS.slice(0, 6), extra: [FAQS[6]], searchParams: { category: "account_technical", faq: id(7) } });
    assert.deepEqual(await v.questions.allTextContents(), [FAQS[0].question], "an FAQ of another topic is not listed under this one");
    await page.close();
  }
});

test("Contact Support goes to the form when signed in and through sign-in when not; Admin down shows the static copy", async () => {
  for (const locale of LOCALES) {
    const harness = await open(locale, { user: { id: "user_1", email: "emily@example.com", nickname: "Emily" } });
    const { page } = harness;
    const v = view(page, locale);
    assert.equal(await v.contact.getAttribute("href"), `/${locale}/account/my-learning/support`);
    await mountHelp(page, { locale, faqs: FAQS, user: null });
    assert.equal(await v.contact.getAttribute("href"), `/${locale}/portal/sign-in?returnTo=${encodeURIComponent(`/${locale}/account/my-learning/support`)}`);
    await mountHelp(page, { locale, fail: true });
    const design = getMessages(locale).helpPage.design;
    assert.deepEqual(await v.questions.allTextContents(), design.faqItems.map((item) => item.question), "the static copy keeps the page useful");
    assert.equal(await page.locator(".help-centre-notice").textContent(), v.copy.unavailable);
    assert.equal(await v.articles.first().locator(".help-centre-article-category").count(), 0, "static items have no category");
    await mountHelp(page, { locale, fail: true, searchParams: { category: "other" } });
    assert.equal(await page.getByRole("heading", { level: 2 }).first().textContent(), v.copy.popularTitle, "the static copy is not shown under a topic's name");
    assert.equal(await v.topics.nth(3).getAttribute("aria-current"), null);
    await page.close();
  }
});

test("the page matches 1387:2 at 1440 px", async () => {
  const locale: Locale = "en-GB";
  const harness = await open(locale);
  const { page } = harness;
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.addStyleTag({ content: "html { scrollbar-width: none; } body { margin: 0; }" });
  const box = async (selector: string) => (await page.locator(selector).first().boundingBox())!;
  const hero = await box(".help-centre-hero");
  assert.deepEqual([hero.width, hero.height], [1440, 255], "hero 1440 × 255");
  const search = await box(".help-centre-search");
  assert.deepEqual([search.width, search.height, search.x], [830, 61, 305]);
  assert.equal(search.y - hero.y, 130, "26 + title + 11 + subtitle + 11 + 2 + 11 (1388:2)");
  const list = await box(".help-centre-list");
  assert.deepEqual([list.x, list.width], [85, 826]);
  assert.equal(list.y - (hero.y + hero.height), 41);
  const card = await box(".help-centre-side");
  assert.deepEqual([card.x, card.width], [984, 371]);
  assert.ok(card.height >= 542);
  assert.equal((await box(".help-centre-article")).height, 87);
  assert.deepEqual([(await box(".help-centre-article-question")).height, (await box(".help-centre-article-summary")).height, (await box(".help-centre-article-category")).height], [21, 16, 15], "Figma text boxes 21 / 16 / 15 (1388:24-26)");
  assert.equal((await box(".help-centre-side h2")).height + 21, 44, "Popular topics then 22 px to the first topic (1388:78-79)");
  assert.equal((await box(".help-centre-topic")).height, 51);
  const button = await box(".help-centre-contact-button");
  assert.deepEqual([button.width, button.height], [316, 42]);
  // A row that wraps keeps the 25 px gap under its text block instead of running into the next row.
  await page.setViewportSize({ width: 390, height: 844 });
  const gaps = await page.locator(".help-centre-article").evaluateAll((rows) => rows.slice(0, -1).map((row, index) => rows[index + 1].getBoundingClientRect().top - row.querySelector(".help-centre-article-text")!.getBoundingClientRect().bottom));
  assert.ok(gaps.length > 0 && gaps.every((gap) => gap === 25), `25 px between rows at 390 px: ${gaps}`);
  await page.close();
});
