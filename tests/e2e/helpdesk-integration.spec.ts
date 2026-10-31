// Helpdesk v2 end-to-end across both apps (tickets-v2-figma-addendum §1–§4), run locally only:
// the real BackOffice (Admin server + Vite client, PostgreSQL) and the real Portal dev server,
// wired to each other with local test tokens. Nothing is stubbed except the LLM, which the
// harness replaces with a local fake OpenRouter endpoint that picks the first candidate FAQ id
// (or null after GET /__mode?pick=null when HELPDESK_INT_FAKE_LLM_URL is set). With the Admin
// server started without a model key, run the null-path check alone:
//   HELPDESK_INT_NO_MODEL=1 … --grep "bilingual FAQs|model picks nothing"
//
// Start the stack first (see docs/phase1/helpdesk-tickets.md §14 and §16; scripts in the project folder lg-helpdesk/integration-harness/), then:
//   HELPDESK_INT_BACKOFFICE_URL=http://127.0.0.1:5173 npx playwright test --config=playwright.helpdesk-integration.config.ts
// Without HELPDESK_INT_BACKOFFICE_URL every test here is skipped.
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { getMessages } from "../../lib/i18n/messages";

type Locale = "en-GB" | "zh-CN";

const BACKOFFICE = process.env.HELPDESK_INT_BACKOFFICE_URL ?? "";
const FAKE_LLM = process.env.HELPDESK_INT_FAKE_LLM_URL ?? "";
// Set when the Admin server runs with no OPENROUTER_API_KEY: chat and submit answers are null, chips still answer.
const NO_MODEL = process.env.HELPDESK_INT_NO_MODEL === "1";
const STAFF = { email: process.env.HELPDESK_INT_ADMIN_EMAIL ?? "", password: process.env.HELPDESK_INT_ADMIN_PASSWORD ?? "" };
const VIEWER = { email: process.env.HELPDESK_INT_VIEW_EMAIL ?? "", password: process.env.HELPDESK_INT_VIEW_PASSWORD ?? STAFF.password };
const SHOTS = process.env.HELPDESK_SHOTS_DIR || "test-results/helpdesk-integration-shots";
const PASSWORD = "Passw0rd!123";
// 1×1 transparent PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
const RUN = randomUUID().slice(0, 6);

// BackOffice copy (learningguideadmin client/src/backoffice/messages/*.json).
const BO = {
  addFaq: "+ Add FAQ",
  save: "Save FAQ",
  claim: "Claim",
  markReviewed: "Mark as reviewed",
  emailStudent: "Email student",
  internalNotes: "Internal notes",
  flag: "Flag follow-up",
  helpful: "Student feedback: Yes, this solved my issue",
  notHelpful: "Student feedback: No, I still submit to support team",
  noAnswer: "No FAQ matched, so the assistant showed no answer.",
  zh: { tabs: ["工单", "常见问题"], addFaq: "+ 新增常见问题", helpful: "学生反馈：已解决", notHelpful: "学生反馈：仍提交给客服", claim: "接单" }
};

type FaqInput = { category: string; popular: boolean; questionEn: string; answerEn: string; questionZh: string; answerZh: string; keywords: string };
const FAQS: FaqInput[] = [
  {
    category: "account_technical",
    popular: true,
    questionEn: `How do I reset my password? (${RUN})`,
    answerEn: "1. **Check your spam folder**\nThe reset email can land there.\n2. **Request a new link**\nOpen [Forgot password](https://www.ilovelearningguide.com/en-GB/forgot-password) and try again.",
    questionZh: `如何重置密码？（${RUN}）`,
    answerZh: "1. **检查垃圾邮件文件夹**\n重置邮件可能在那里。\n2. **重新申请链接**\n打开忘记密码页面再试一次。",
    keywords: "password, reset, 密码"
  },
  {
    category: "payments_subscriptions",
    popular: true,
    questionEn: `Where can I find my invoice? (${RUN})`,
    answerEn: "Open **Subscription**, then Records, and choose Download.",
    questionZh: `在哪里下载发票？（${RUN}）`,
    answerZh: "打开**订阅**，进入记录，然后点击下载。",
    keywords: "invoice, receipt, 发票"
  },
  {
    category: "courses_learning",
    popular: false,
    questionEn: `Where are my course materials? (${RUN})`,
    answerEn: "Open My Learning and choose your course.\n- Videos\n- Worksheets",
    questionZh: `课程资料在哪里？（${RUN}）`,
    answerZh: "打开我的学习，选择你的课程。",
    keywords: "materials, worksheets, 资料"
  }
];
const faqIds: string[] = [];

test.skip(!BACKOFFICE, "Set HELPDESK_INT_BACKOFFICE_URL (and start both apps) to run the cross-app Helpdesk check.");
test.describe.configure({ mode: "serial", timeout: 240_000 });

const copy = (locale: Locale) => getMessages(locale).helpdesk;
const help = (locale: Locale) => getMessages(locale).helpCentre;

async function shot(page: Page, name: string) {
  await mkdir(SHOTS, { recursive: true });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/integration-${name}.png` });
}

async function staff(browser: Browser, who = STAFF, locale: Locale = "en-GB") {
  const context = await browser.newContext({ baseURL: BACKOFFICE, viewport: { width: 1672, height: 941 }, locale });
  const signedIn = await context.request.post("/api/auth/sign-in", { data: { email: who.email, password: who.password } });
  expect(signedIn.status(), await signedIn.text()).toBe(200);
  return { context, page: await context.newPage() };
}

async function visitor(browser: Browser, locale: Locale = "en-GB") {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1024 }, locale });
  await context.addInitScript(() => { try { window.localStorage.setItem("learning-guide-cookie-preference", "essential"); } catch { /* ignore */ } });
  return context;
}

async function learner(browser: Browser, nickname: string, locale: Locale = "en-GB") {
  const context = await visitor(browser, locale);
  const email = `hd-int-${Date.now()}-${randomUUID().slice(0, 6)}@example.test`;
  const registered = await context.request.post("/api/auth/register", { data: { termsAccepted: true, email, password: PASSWORD, nickname, locale } });
  expect(registered.status()).toBe(200);
  return { context, page: await context.newPage(), email };
}

async function pasteImage(page: Page, name: string) {
  await page.locator(".helpdesk-dropzone").evaluate((zone, payload) => {
    const bytes = Uint8Array.from(atob(payload.base64), (char) => char.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], payload.name, { type: "image/png" }));
    zone.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, { base64: PNG.toString("base64"), name });
}

async function fillEnquiry(page: Page, subject: string, message: string) {
  const text = copy("en-GB");
  await page.getByRole("combobox", { name: text.enquiryType }).click();
  await page.getByRole("option", { name: text.categories.technical_support }).click();
  await page.getByLabel(text.subject).fill(subject);
  await page.getByLabel(text.message).fill(message);
}

async function learnerTickets(page: Page) {
  const response = await page.request.get("/api/helpdesk/tickets");
  expect(response.status()).toBe(200);
  return (await response.json() as { tickets: { id: string; subject: string; status: string }[] }).tickets;
}

async function fillDrawer(drawer: Locator, faq: FaqInput) {
  await drawer.getByLabel("Category").selectOption(faq.category);
  if (faq.popular) await drawer.getByLabel("Popular FAQ").check();
  await drawer.getByLabel("Question (English)").fill(faq.questionEn);
  await drawer.getByLabel("Answer (English)").fill(faq.answerEn);
  await drawer.getByLabel("Question (Chinese)").fill(faq.questionZh);
  await drawer.getByLabel("Answer (Chinese)").fill(faq.answerZh);
  await drawer.getByLabel("Keywords (for search & AI)").fill(faq.keywords);
}

/** The BackOffice's own FAQ list (browser → Admin), used to read the ids the drawer created. */
async function backOfficeFaqs(context: BrowserContext, q: string) {
  const response = await context.request.get(`/api/helpdesk/faqs?${new URLSearchParams({ q, pageSize: "50" })}`);
  expect(response.status()).toBe(200);
  return (await response.json() as { data: { faqs: { id: string; questionEn: string; version: number }[]; total: number } }).data;
}

const enquiry = { subject: `Cannot reset my password ${RUN}`, id: "", olderSubject: `Older question about my course ${RUN}`, olderId: "" };
// The enquiry owner's signed-in session, kept from the test that creates the enquiry.
let ownerState: Awaited<ReturnType<BrowserContext["storageState"]>> | undefined;

async function ownerSession(browser: Browser, locale: Locale = "en-GB") {
  expect(ownerState, "the enquiry test must run first").toBeDefined();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1024 }, storageState: ownerState, locale });
  return { context, page: await context.newPage() };
}

test("employee creates bilingual FAQs (two popular) in the BackOffice drawer; the FAQs tab lists and filters them", async ({ browser }) => {
  const { context, page } = await staff(browser);
  await page.goto("/en-GB/help-desk?tab=faqs");
  await expect(page.getByRole("heading", { name: "Help Desk" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "FAQs" })).toHaveAttribute("aria-selected", "true");
  for (const faq of FAQS) {
    await page.getByRole("button", { name: BO.addFaq }).click();
    const drawer = page.getByRole("dialog", { name: "Add FAQ" });
    await expect(drawer).toBeVisible();
    await fillDrawer(drawer, faq);
    await drawer.getByRole("button", { name: BO.save }).click();
    await expect(drawer).toHaveCount(0);
    const row = page.locator(".hdFaqTable tbody tr", { hasText: faq.questionEn });
    await expect(row).toBeVisible();
    await expect(row.locator(".hdFaqChip").last()).toHaveText(faq.popular ? "Yes" : "No");
  }
  await expect(page.locator(".hdFaqCount")).toHaveText("3 FAQs");
  await shot(page, "backoffice-faqs-en-GB");

  // Search and the popular filter are answered by the Admin server and kept in the URL.
  await page.getByLabel("Search questions, answers or keywords...").fill("worksheets");
  await expect(page).toHaveURL(/[?&]q=worksheets/);
  await expect(page.locator(".hdFaqTable tbody tr")).toHaveCount(1);
  await expect(page.locator(".hdFaqTable tbody tr")).toContainText(FAQS[2].questionEn);
  await page.getByLabel("Search questions, answers or keywords...").fill("");
  await page.getByLabel("Popular", { exact: true }).selectOption("popular");
  await expect(page.locator(".hdFaqTable tbody tr")).toHaveCount(2);
  await page.getByLabel("Popular", { exact: true }).selectOption("all");

  // Preview renders through the shared renderer, EN and 中文.
  await page.getByRole("button", { name: `Preview ${FAQS[0].questionEn}` }).click();
  const preview = page.getByRole("dialog", { name: "Preview FAQ" });
  await expect(preview.locator("strong", { hasText: "Check your spam folder" })).toBeVisible();
  await expect(preview.getByRole("link", { name: "Forgot password" })).toHaveAttribute("rel", "noopener noreferrer");
  await preview.getByRole("radio", { name: "中文" }).or(preview.getByRole("button", { name: "中文" })).first().click();
  await expect(preview).toContainText(FAQS[0].questionZh);
  await page.keyboard.press("Escape");
  await expect(preview).toHaveCount(0);

  // Edit: the drawer sends the version; Portal's integration read sees the new text at once.
  await page.getByRole("button", { name: `Edit ${FAQS[1].questionEn}` }).click();
  const edit = page.getByRole("dialog", { name: "Edit FAQ" });
  await expect(edit.getByLabel("Question (English)")).toHaveValue(FAQS[1].questionEn);
  FAQS[1].answerEn = "Open **Subscription**, then Records, and choose Download. Invoices are PDFs.";
  await edit.getByLabel("Answer (English)").fill(FAQS[1].answerEn);
  await edit.getByRole("button", { name: BO.save }).click();
  await expect(edit).toHaveCount(0);
  await expect(page.locator(".hdFaqTable tbody tr", { hasText: FAQS[1].questionEn }).locator(".hdFaqSummary")).toHaveText("Open Subscription, then Records, and choose Download. Invoices are PDFs.");

  // Delete (archive) a fourth FAQ: it leaves the list and the integration API.
  const doomed = `Temporary FAQ to delete (${RUN})`;
  await page.getByRole("button", { name: BO.addFaq }).click();
  const add = page.getByRole("dialog", { name: "Add FAQ" });
  await fillDrawer(add, { ...FAQS[2], questionEn: doomed, questionZh: `临时问题（${RUN}）`, keywords: "" });
  await add.getByRole("button", { name: BO.save }).click();
  await expect(add).toHaveCount(0);
  await expect(page.locator(".hdFaqCount")).toHaveText("4 FAQs");
  const doomedId = (await backOfficeFaqs(context, doomed)).faqs[0].id;
  await page.getByRole("button", { name: `Edit ${doomed}` }).click();
  const remove = page.getByRole("dialog", { name: "Edit FAQ" });
  await remove.getByRole("button", { name: "Delete FAQ" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(remove).toHaveCount(0);
  await expect(page.locator(".hdFaqTable tbody tr", { hasText: doomed })).toHaveCount(0);
  await expect(page.locator(".hdFaqCount")).toHaveText("3 FAQs");

  const listed = await backOfficeFaqs(context, RUN);
  expect(listed.total).toBe(3);
  for (const faq of FAQS) faqIds.push(listed.faqs.find((item) => item.questionEn === faq.questionEn)!.id);
  expect(listed.faqs.find((item) => item.id === faqIds[1])!.version).toBe(2);
  await context.close();

  // Portal → Admin integration contract, as Portal reads it (no cache in between here).
  const portal = await visitor(browser);
  const article = await portal.request.get(`/en-GB/help?faq=${doomedId}`);
  expect(article.status()).toBe(200);
  expect(await article.text()).not.toContain(doomed);
  await portal.close();
});

test("the public Help Centre shows the FAQs: popular list, search, topic, ?faq= deep link, zh-CN, Contact Support returnTo", async ({ browser }) => {
  const context = await visitor(browser);
  const page = await context.newPage();
  const text = help("en-GB");
  await page.goto("/en-GB/help");
  const list = page.locator(".help-centre-articles");
  await expect(list.getByRole("button", { name: FAQS[0].questionEn })).toBeVisible();
  await expect(list.getByRole("button", { name: FAQS[1].questionEn })).toBeVisible();
  await expect(list.getByRole("button", { name: FAQS[2].questionEn })).toHaveCount(0);
  // Summary line = the first plain line of the answer.
  await expect(list.locator(".help-centre-article", { hasText: FAQS[0].questionEn }).locator(".help-centre-article-summary")).toHaveText("Check your spam folder");
  await list.getByRole("button", { name: FAQS[0].questionEn }).click();
  await expect(list.locator(".help-centre-answer strong", { hasText: "Request a new link" })).toBeVisible();
  await shot(page, "portal-help-centre-en-GB");

  await page.getByRole("searchbox", { name: text.searchLabel }).fill("worksheets");
  await expect(page).toHaveURL(/[?&]q=worksheets/);
  await expect(list.getByRole("button", { name: FAQS[2].questionEn })).toBeVisible();
  await expect(list.getByRole("button", { name: FAQS[0].questionEn })).toHaveCount(0);

  await page.goto("/en-GB/help?category=courses_learning");
  await expect(page.getByRole("navigation", { name: text.topicsTitle }).getByRole("link", { name: text.categories.courses_learning })).toHaveAttribute("aria-current", "page");
  await expect(list.getByRole("button", { name: FAQS[2].questionEn })).toBeVisible();

  await page.goto(`/en-GB/help?faq=${faqIds[2]}`);
  const opened = list.getByRole("button", { name: FAQS[2].questionEn });
  await expect(opened).toHaveAttribute("aria-expanded", "true");
  await expect(list.locator(".help-centre-answer li", { hasText: "Worksheets" })).toBeVisible();

  const contact = page.getByRole("link", { name: text.contactButton });
  await expect(contact).toHaveAttribute("href", /sign-in\?returnTo=%2Fen-GB%2Faccount%2Fmy-learning%2Fsupport/);

  await page.goto("/zh-CN/help");
  await expect(list.getByRole("button", { name: FAQS[0].questionZh })).toBeVisible();
  await page.getByRole("searchbox", { name: help("zh-CN").searchLabel }).fill("发票");
  await expect(list.getByRole("button", { name: FAQS[1].questionZh })).toBeVisible();
  await shot(page, "portal-help-centre-zh-CN");
  await context.close();
});

test("learner: chips and chat answers with Helpful Yes / No, a no-match fallback, then a submit-time No → BackOffice row is unread", async ({ browser }) => {
  const { context, page } = await learner(browser, "Emily Carter");
  const text = copy("en-GB");
  const origin = new URL(test.info().project.use.baseURL!).origin;
  // An older enquiry from the same learner, for the BackOffice student timeline.
  const older = await page.request.post("/api/helpdesk/tickets", {
    headers: { "Idempotency-Key": randomUUID(), Origin: origin },
    multipart: { category: "course_content", subject: enquiry.olderSubject, body: "Where do I find the worksheets?", locale: "en-GB" }
  });
  expect(older.status(), await older.text()).toBe(201);
  enquiry.olderId = (await older.json() as { id: string }).id;

  await page.goto("/en-GB/account/my-learning/support");
  const chat = page.getByRole("region", { name: text.chat.title });
  // Starter chips: the popular FAQs only.
  await expect(chat.getByRole("button", { name: FAQS[0].questionEn })).toBeVisible();
  await expect(chat.getByRole("button", { name: FAQS[1].questionEn })).toBeVisible();
  await expect(chat.getByRole("button", { name: FAQS[2].questionEn })).toHaveCount(0);

  // 1. A typed question: retrieval → the (fake) model picks a candidate id → the answer verbatim.
  await chat.getByLabel(text.chat.inputLabel).fill("I forgot my password, how can I reset it?");
  await chat.getByLabel(text.chat.inputLabel).press("Enter");
  const answers = chat.locator(".helpdesk-chat-answer");
  await expect(answers.nth(0).locator("strong", { hasText: "Check your spam folder" })).toBeVisible();
  await expect(answers.nth(0).getByRole("link", { name: `Related FAQ: ${FAQS[0].questionEn}` })).toHaveAttribute("href", `/en-GB/help?faq=${faqIds[0]}`);
  await answers.nth(0).getByRole("button", { name: text.chat.no }).click();
  await expect(answers.nth(0).getByRole("button", { name: text.chat.no })).toHaveAttribute("aria-pressed", "true");
  await expect(answers.nth(0).getByRole("button", { name: text.chat.yes })).toBeDisabled();

  // 2. A chip: Admin returns that FAQ directly (no model call).
  await chat.getByRole("button", { name: FAQS[1].questionEn }).click();
  await expect(answers.nth(1)).toContainText("then Records, and choose Download.");
  await answers.nth(1).getByRole("button", { name: text.chat.yes }).click();
  await expect(answers.nth(1).getByRole("button", { name: text.chat.yes })).toHaveAttribute("aria-pressed", "true");

  // 3. Nothing matches: no candidates, null reply, the fallback bubble.
  await chat.getByLabel(text.chat.inputLabel).fill("qwxz vlorp fnord");
  await chat.getByLabel(text.chat.inputLabel).press("Enter");
  await expect(answers.nth(2).locator(".helpdesk-chat-fallback")).toHaveText(text.chat.fallback);
  await shot(page, "portal-chat-en-GB");

  // The transcript survives a reload (sessionStorage).
  await page.reload();
  await expect(chat.locator(".helpdesk-chat-answer")).toHaveCount(3);
  await expect(chat.locator(".helpdesk-chat-answer").nth(0).getByRole("button", { name: text.chat.no })).toHaveAttribute("aria-pressed", "true");

  // 4. Submit: the submit-time modal (1333:249) → No, still submit.
  await fillEnquiry(page, enquiry.subject, "I asked for a password reset but the email never arrives.");
  await pasteImage(page, "screenshot.png");
  await page.getByRole("button", { name: text.submit }).click();
  const modal = page.getByRole("dialog", { name: text.assistant.title });
  await expect(modal).toBeVisible();
  await expect(modal).toContainText("Hi Emily! Here's a possible solution to your issue:");
  await expect(modal).toContainText("The reset email can land there.");
  await shot(page, "portal-assistant-modal-en-GB");
  await modal.getByRole("button", { name: text.assistant.no }).click();
  await expect(page.getByRole("heading", { name: text.success.title })).toBeVisible();
  const tickets = await learnerTickets(page);
  const created = tickets.find((ticket) => ticket.subject === enquiry.subject)!;
  expect(created).toBeTruthy();
  enquiry.id = created.id;
  ownerState = await context.storageState();

  const office = await staff(browser);
  await office.page.goto("/en-GB/help-desk");
  const row = office.page.locator(".hdRow", { hasText: enquiry.subject });
  await expect(row).toBeVisible();
  await expect(row.locator(".hdUnreadDot")).toBeVisible();
  await expect(row).toContainText("Emily Carter");
  await shot(office.page, "backoffice-enquiries-unread-en-GB");
  await office.context.close();
  await context.close();
});

test("BackOffice: student timeline with AI blocks and feedback lines; Claim, Email student, Internal note, Flag / unflag, Mark as reviewed", async ({ browser }) => {
  const office = await staff(browser);
  const page = office.page;
  await page.goto("/en-GB/help-desk");
  const row = page.locator(".hdRow", { hasText: enquiry.subject });
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/help-desk/${enquiry.id}`));
  await expect(row.locator(".hdUnreadDot")).toHaveCount(0);

  // The timeline: both of the learner's enquiries, newest first, the selected one current.
  const timeline = page.locator(".hdTimeline");
  const cards = timeline.locator(".hdEnquiryCard");
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toHaveAttribute("aria-label", enquiry.subject);
  await expect(cards.nth(0)).toHaveAttribute("aria-current", "true");
  await expect(cards.nth(1)).toHaveAttribute("aria-label", enquiry.olderSubject);
  // Selecting scrolls the card, not its tall AI log, so the date separator above it stays in view.
  await expect(timeline.locator(".hdDateSep").first()).toBeInViewport({ ratio: 1 });
  const current = timeline.locator(".hdTimelineItemCurrent");
  await expect(current.locator(".hdFileChip")).toContainText("screenshot.png");
  // The chip downloads the learner's bytes through the BackOffice proxy.
  const download = await office.context.request.get((await current.locator(".hdFileChip").getAttribute("href"))!);
  expect(download.status()).toBe(200);
  expect(Buffer.compare(await download.body(), PNG)).toBe(0);

  // AI blocks, oldest first: chat (No), chip (Yes), chat with no match, submit (declined).
  const blocks = current.locator(".hdAiBlock");
  await expect(blocks).toHaveCount(4);
  await expect(blocks.nth(0).locator(".hdAiFeedbackNegative")).toHaveText(`✕ ${BO.notHelpful}`);
  await expect(blocks.nth(0).locator(".hdAiAnswer strong", { hasText: "Check your spam folder" })).toBeVisible();
  await expect(blocks.nth(1).locator(".hdAiFeedbackPositive")).toHaveText(`✓ ${BO.helpful}`);
  await expect(blocks.nth(1)).toContainText("then Records, and choose Download.");
  await expect(blocks.nth(2).locator(".hdAiEmpty")).toHaveText(BO.noAnswer);
  await expect(blocks.nth(2).locator(".hdAiFeedback")).toHaveCount(0);
  await expect(blocks.nth(3).locator(".hdAiFeedbackNegative")).toHaveText(`✕ ${BO.notHelpful}`);
  await expect(blocks.nth(3)).toContainText("The reset email can land there.");
  // The other card's AI log is its own (none were linked to it).
  await expect(timeline.locator(".hdTimelineItem").nth(1).locator(".hdAiBlock")).toHaveCount(0);
  await shot(page, "backoffice-timeline-en-GB");

  const side = page.locator(".hdSide");
  await expect(side.locator(".hdStudentName")).toHaveText("Emily Carter");
  await expect(side.locator(".hdFact", { hasText: "Total Enquiries" })).toContainText("2");
  await expect(side.locator(".hdPlanRow", { hasText: "Plan Name" }).locator("dd")).toHaveText("—");
  // Tags (normalised to lower case by Portal) stay in the right column.
  await page.locator(".hdAddTag").click();
  await page.locator(".hdTagEditor input").fill("Password Reset");
  await page.locator(".hdTagEditor input").press("Enter");
  await expect(side.locator(".hdTag", { hasText: "password reset" })).toBeVisible();

  const bar = current.locator(".hdActionBar");
  // OPEN: Claim sits where Mark as reviewed is.
  await bar.getByRole("button", { name: BO.claim }).click();
  await expect(current.locator(".hdStatusASSIGNED")).toBeVisible();
  await expect(bar.getByRole("button", { name: BO.markReviewed })).toBeVisible();

  // Email student → this card's reply composer.
  await bar.getByRole("button", { name: BO.emailStudent }).click();
  await current.getByLabel("Reply to learner").fill("Hi Emily, I have re-sent the reset email. Please check your spam folder.");
  await current.locator(".hdComposer button[type=submit]").click();
  await expect(current.locator(".hdMsgCardAgent:not(.hdMsgCardInternal)", { hasText: "re-sent the reset email" })).toBeVisible();
  await expect(current.locator(".hdStatusWAITING_USER")).toBeVisible();

  // Internal notes → the notes panel and its composer.
  await bar.getByRole("button", { name: BO.internalNotes }).click();
  const notes = current.getByRole("region", { name: "Internal notes" });
  await expect(notes).toBeVisible();
  await notes.locator(".hdTextarea").fill("Checked the mail logs: delivered to spam.");
  await notes.locator(".hdComposer button[type=submit]").click();
  await expect(notes.locator(".hdMsgCardInternal", { hasText: "Checked the mail logs" })).toBeVisible();

  // Flag follow-up toggles; the left list shows the flag and the Flagged filter finds it.
  const flag = bar.getByRole("button", { name: BO.flag });
  await expect(flag).toHaveAttribute("aria-pressed", "false");
  await flag.click();
  await expect(flag).toHaveAttribute("aria-pressed", "true");
  await expect(row.locator(".hdRowFlag")).toBeVisible();
  await page.locator(".hdFilterButton").click();
  const flaggedFilter = page.getByRole("dialog", { name: "Filter enquiries" }).getByLabel("Flagged");
  // A controlled checkbox driven by the URL (the router commits it in a transition): click, then wait.
  await flaggedFilter.click();
  await expect(flaggedFilter).toBeChecked();
  await expect(page).toHaveURL(/[?&]flagged=true/);
  await expect(page.locator(".hdRow")).toHaveCount(1);
  await expect(page.locator(".hdRow")).toContainText(enquiry.subject);
  await shot(page, "backoffice-flagged-en-GB");
  await flaggedFilter.click();
  await expect(flaggedFilter).not.toBeChecked();
  await expect(page.locator(".hdRow", { hasText: enquiry.olderSubject })).toBeVisible();
  await page.keyboard.press("Escape");
  await flag.click();
  await expect(flag).toHaveAttribute("aria-pressed", "false");
  await expect(row.locator(".hdRowFlag")).toHaveCount(0);

  // Mark as reviewed → the learner is asked to confirm.
  await bar.getByRole("button", { name: BO.markReviewed }).click();
  await expect(current.locator(".hdStatusPENDING_CONFIRM")).toBeVisible();

  // Another card of the timeline is selectable and keeps its own Claim.
  await timeline.getByRole("button", { name: enquiry.olderSubject }).click();
  await expect(page).toHaveURL(new RegExp(`/help-desk/${enquiry.olderId}`));
  await expect(timeline.locator(".hdTimelineItemCurrent .hdEnquiryCard")).toHaveAttribute("aria-label", enquiry.olderSubject);
  await expect(timeline.locator(".hdTimelineItemCurrent .hdActionBar").getByRole("button", { name: BO.claim })).toBeVisible();
  await office.context.close();

  // A fresh session still shows it as read and unflagged.
  const again = await staff(browser);
  await again.page.goto("/en-GB/help-desk");
  const fresh = again.page.locator(".hdRow", { hasText: enquiry.subject });
  await expect(fresh.locator(".hdUnreadDot")).toHaveCount(0);
  await expect(fresh.locator(".hdRowFlag")).toHaveCount(0);
  await again.context.close();
});

test("learner sees the reply but not the internal note, and confirms 问题解决了吗？→ 已解决; the BackOffice shows Closed", async ({ browser }) => {
  const en = copy("en-GB");
  const zh = copy("zh-CN");
  const owner = await ownerSession(browser);
  await owner.page.goto(`/en-GB/account/my-learning/support/${enquiry.id}`);
  await expect(owner.page.locator(".helpdesk-message-agent", { hasText: "re-sent the reset email" })).toBeVisible();
  await expect(owner.page.getByText("Checked the mail logs")).toHaveCount(0);
  await expect(owner.page.locator(".helpdesk-confirm-banner")).toContainText(en.detail.confirmPrompt);
  expect(en.detail.confirmPrompt).toBe("Is it solved?");

  await owner.page.goto(`/zh-CN/account/my-learning/support/${enquiry.id}`);
  const banner = owner.page.locator(".helpdesk-confirm-banner");
  await expect(banner).toContainText("问题解决了吗？");
  await expect(banner.getByRole("button", { name: "没解决" })).toBeVisible();
  await shot(owner.page, "portal-pending-confirm-zh-CN");
  await banner.getByRole("button", { name: "已解决" }).click();
  await expect(owner.page.locator(".helpdesk-status-pill")).toHaveText(zh.status.CLOSED);
  await owner.context.close();

  const office = await staff(browser);
  await office.page.goto(`/en-GB/help-desk/${enquiry.id}`);
  await expect(office.page.locator(".hdTimelineItemCurrent .hdStatusCLOSED")).toBeVisible();
  await office.page.goto("/en-GB/help-desk?status=CLOSED");
  await expect(office.page.locator(".hdRow", { hasText: enquiry.subject })).toBeVisible();
  await shot(office.page, "backoffice-enquiry-closed-en-GB");
  await office.context.close();
});

test("VIEW role sees the timeline, AI blocks and FAQs but no write controls, and sends no writes", async ({ browser }) => {
  test.skip(!VIEWER.email, "Set HELPDESK_INT_VIEW_EMAIL for a helpDesk VIEW employee.");
  const view = await staff(browser, VIEWER);
  const writes: string[] = [];
  view.page.on("request", (request) => { if (request.method() !== "GET" && request.url().includes("/api/helpdesk/")) writes.push(request.url()); });
  await view.page.goto(`/en-GB/help-desk/${enquiry.olderId}`);
  const timeline = view.page.locator(".hdTimeline");
  await expect(timeline.locator(".hdEnquiryCard")).toHaveCount(2);
  await expect(timeline.locator(".hdAiBlock")).toHaveCount(4);
  // A deep link to an older card scrolls that card into view once it has loaded.
  await expect(timeline.locator(".hdTimelineItemCurrent .hdEnquiryCard")).toHaveAttribute("aria-label", enquiry.olderSubject);
  await expect(timeline.locator(".hdTimelineItemCurrent .hdEnquiryCard")).toBeInViewport({ ratio: 1 });
  for (const selector of [".hdActionBar", ".hdComposer", ".hdAddTag", ".hdTagRemove"]) await expect(view.page.locator(selector)).toHaveCount(0);
  await expect(view.page.getByRole("button", { name: BO.addFaq })).toHaveCount(0);
  await shot(view.page, "backoffice-view-role-en-GB");
  await view.page.goto("/en-GB/help-desk?tab=faqs");
  await expect(view.page.locator(".hdFaqTable tbody tr").first()).toBeVisible();
  await expect(view.page.locator(".hdFaqEdit")).toHaveCount(0);
  await expect(view.page.locator(".hdFaqPreview").first()).toBeVisible();
  expect(writes).toEqual([]);
  const denied = await view.context.request.post("/api/helpdesk/faqs", {
    data: { category: "other", popular: false, questionEn: "x", answerEn: "y", questionZh: "x", answerZh: "y", keywords: [] }
  });
  expect(denied.status()).toBe(403);
  const flag = await view.context.request.post(`/api/helpdesk/tickets/${enquiry.olderId}/actions`, { data: { action: "flag", expectedSequence: 1 } });
  expect(flag.status()).toBe(403);
  await view.context.close();
});

test("zh-CN: BackOffice tabs, Claim (接单), AI feedback lines and Add FAQ copy; a zh-CN learner chip", async ({ browser }) => {
  const office = await staff(browser, STAFF, "zh-CN");
  await office.page.goto(`/zh-CN/help-desk/${enquiry.id}`);
  await expect(office.page.getByRole("tab")).toHaveText(BO.zh.tabs);
  await expect(office.page.getByRole("button", { name: BO.zh.addFaq })).toBeVisible();
  const current = office.page.locator(".hdTimelineItemCurrent");
  await expect(current.locator(".hdAiFeedbackPositive")).toHaveText(`✓ ${BO.zh.helpful}`);
  await expect(current.locator(".hdAiFeedbackNegative")).toHaveText([`✕ ${BO.zh.notHelpful}`, `✕ ${BO.zh.notHelpful}`]);
  await office.page.locator(".hdTimeline").getByRole("button", { name: enquiry.olderSubject }).click();
  await expect(office.page.locator(".hdTimelineItemCurrent .hdActionBar").getByRole("button", { name: BO.zh.claim })).toBeVisible();
  await shot(office.page, "backoffice-timeline-zh-CN");
  await office.context.close();

  // A zh-CN learner gets the zh-CN chip and the zh-CN answer, with the zh-CN Related FAQ link.
  const zhLearner = await learner(browser, "陈艾米", "zh-CN");
  const chatText = copy("zh-CN").chat;
  await zhLearner.page.goto("/zh-CN/account/my-learning/support");
  const chat = zhLearner.page.getByRole("region", { name: chatText.title });
  await chat.getByRole("button", { name: FAQS[0].questionZh }).click();
  const answer = chat.locator(".helpdesk-chat-answer").first();
  await expect(answer.locator("strong", { hasText: "检查垃圾邮件文件夹" })).toBeVisible();
  await expect(answer.getByRole("link", { name: chatText.relatedFaq.replace("{question}", FAQS[0].questionZh) })).toHaveAttribute("href", `/zh-CN/help?faq=${faqIds[0]}`);
  await answer.getByRole("button", { name: chatText.yes }).click();
  await expect(answer.getByRole("button", { name: chatText.yes })).toHaveAttribute("aria-pressed", "true");
  await shot(zhLearner.page, "portal-chat-zh-CN");
  await zhLearner.context.close();
});

test("zh-CN learner with a plan: the BackOffice shows the plan labels; a learner reply makes the enquiry unread again", async ({ browser }) => {
  const zh = copy("zh-CN");
  const { context, page } = await learner(browser, "王小明", "zh-CN");
  const origin = new URL(test.info().project.use.baseURL!).origin;
  const post = (url: string, data: unknown) => page.request.post(url, { data, headers: { Origin: origin } });
  const quote = await (await post("/api/purchase/quote", { planId: "epicureanism-pc-6", kind: "purchase" })).json() as { quote: { id: string } };
  const checkout = await (await post("/api/purchase/checkout", { quoteId: quote.quote.id, locale: "zh-CN", consents: { renewal: true, terms: true, refund: true } })).json() as { order: { id: string } };
  expect((await post("/api/purchase/demo/confirm", { orderId: checkout.order.id, action: "complete" })).status()).toBe(200);
  const subject = `发票问题 ${RUN}`;
  const ticket = await page.request.post("/api/helpdesk/tickets", {
    headers: { "Idempotency-Key": randomUUID(), Origin: origin },
    multipart: { category: "payments_subscriptions", subject, body: "我需要十月的发票。", locale: "zh-CN" }
  });
  expect(ticket.status(), await ticket.text()).toBe(201);
  const { id } = await ticket.json() as { id: string };

  const office = await staff(browser, STAFF, "zh-CN");
  await office.page.goto(`/zh-CN/help-desk/${id}`);
  const side = office.page.locator(".hdSide");
  await expect(side).toContainText("学员信息");
  await expect(side.locator(".hdPlanRow", { hasText: "方案名称" }).locator("dd")).toContainText("Epicureanism");
  await expect(side.locator(".hdPlanRow", { hasText: "计费周期" }).locator("dd")).toHaveText("按半年");
  await expect(side.locator(".hdPlanRow", { hasText: "状态" }).locator(".hdPill-success")).toHaveText("生效中");
  const current = office.page.locator(".hdTimelineItemCurrent");
  const bar = current.locator(".hdActionBar");
  await bar.getByRole("button", { name: BO.zh.claim }).click();
  await expect(current.locator(".hdStatusASSIGNED")).toBeVisible();
  await bar.locator("button").nth(1).click();
  await current.locator(".hdComposer .hdTextarea").fill("已为你重新开具十月发票，请查收邮件。");
  await current.locator(".hdComposer button[type=submit]").click();
  await expect(current.locator(".hdStatusWAITING_USER")).toBeVisible();
  await shot(office.page, "backoffice-enquiry-plan-zh-CN");

  // The learner answers: the row is unread for staff again, and opening it clears that.
  await page.goto(`/zh-CN/account/my-learning/support/${id}`);
  await expect(page.locator(".helpdesk-message-agent", { hasText: "重新开具十月发票" })).toBeVisible();
  await page.getByLabel(zh.detail.replyLabel).fill("收到了，但金额不对。");
  await page.getByRole("button", { name: zh.detail.send }).click();
  await expect(page.locator(".helpdesk-status-pill")).toHaveText(zh.status.ASSIGNED);
  await context.close();
  await office.page.goto("/zh-CN/help-desk");
  const row = office.page.locator(".hdRow", { hasText: subject });
  await expect(row.locator(".hdUnreadDot")).toBeVisible();
  await row.click();
  await expect(office.page.locator(".hdTimelineItemCurrent")).toContainText("收到了，但金额不对。");
  await expect(row.locator(".hdUnreadDot")).toHaveCount(0);
  await office.context.close();
});

test("model picks nothing (or no model key): chat and submit get no answer, a chip still returns its FAQ", async ({ browser }) => {
  test.skip(!FAKE_LLM && !NO_MODEL, "Set HELPDESK_INT_FAKE_LLM_URL (fake model answers null) or HELPDESK_INT_NO_MODEL=1 (Admin has no model key).");
  if (!NO_MODEL) expect((await (await fetch(`${FAKE_LLM}/__mode?pick=null`)).text())).toBe("null");
  try {
    const { context, page } = await learner(browser, "Noah Green");
    const text = copy("en-GB");
    await page.goto("/en-GB/account/my-learning/support");
    const chat = page.getByRole("region", { name: text.chat.title });
    await chat.getByLabel(text.chat.inputLabel).fill("How do I reset my password?");
    await chat.getByLabel(text.chat.inputLabel).press("Enter");
    const answers = chat.locator(".helpdesk-chat-answer");
    await expect(answers.nth(0).locator(".helpdesk-chat-fallback")).toHaveText(text.chat.fallback);
    await chat.getByRole("button", { name: FAQS[0].questionEn }).click();
    await expect(answers.nth(1)).toContainText("The reset email can land there.");
    // Submit with no suggestion goes straight through (no modal).
    await fillEnquiry(page, `Password again ${RUN}`, "How do I reset my password?");
    await page.getByRole("button", { name: text.submit }).click();
    await expect(page.getByRole("heading", { name: text.success.title })).toBeVisible();
    await expect(page.getByRole("dialog", { name: text.assistant.title })).toHaveCount(0);
    await context.close();
  } finally {
    if (!NO_MODEL) await fetch(`${FAKE_LLM}/__mode?pick=first`);
  }
});

test("Yes, this solved my issue creates no ticket", async ({ browser }) => {
  const { context, page } = await learner(browser, "Ava Brown");
  const text = copy("en-GB");
  await page.goto("/en-GB/account/my-learning/support");
  await fillEnquiry(page, `Password reset email ${RUN}`, "Where is my password reset email?");
  await page.getByRole("button", { name: text.submit }).click();
  const modal = page.getByRole("dialog", { name: text.assistant.title });
  await expect(modal).toContainText("Hi Ava!");
  await modal.getByRole("button", { name: text.assistant.yes }).click();
  await expect(page.getByText(text.assistant.thanksTitle)).toBeVisible();
  await page.waitForURL("**/en-GB/account/my-learning", { timeout: 30_000 });
  expect(await learnerTickets(page)).toEqual([]);
  await context.close();
});
