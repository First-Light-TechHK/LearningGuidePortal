// Helpdesk v1 end-to-end across both apps (Figma addendum §A–§E), run locally only:
// the real BackOffice (Admin server + Vite client) and the real Portal dev server,
// wired to each other with local test tokens. Nothing is stubbed except the LLM,
// which the harness replaces with a local fake OpenRouter endpoint.
//
// Start the stack first (see docs/phase1/helpdesk-tickets.md §14), then:
//   HELPDESK_INT_BACKOFFICE_URL=http://127.0.0.1:5173 npx playwright test --config=playwright.helpdesk-integration.config.ts
// Without HELPDESK_INT_BACKOFFICE_URL every test here is skipped.
import { expect, test, type Browser, type BrowserContext, type Page } from "playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { getMessages } from "../../lib/i18n/messages";

type Locale = "en-GB" | "zh-CN";

const BACKOFFICE = process.env.HELPDESK_INT_BACKOFFICE_URL ?? "";
const STAFF = { email: process.env.HELPDESK_INT_ADMIN_EMAIL ?? "", password: process.env.HELPDESK_INT_ADMIN_PASSWORD ?? "" };
const VIEWER = { email: process.env.HELPDESK_INT_VIEW_EMAIL ?? "", password: process.env.HELPDESK_INT_VIEW_PASSWORD ?? STAFF.password };
const SHOTS = process.env.HELPDESK_SHOTS_DIR || "test-results/helpdesk-integration-shots";
const PASSWORD = "Passw0rd!123";
// 1×1 transparent PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
const RUN = randomUUID().slice(0, 6);

const QUESTIONS = [
  {
    category: "Technical Support",
    question: `How do I reset my password? (${RUN})`,
    answer: "1. Check your spam folder\nThe reset email can land there.\n2. Request a new link\nOpen https://www.ilovelearningguide.com/en-GB/forgot-password and try again.",
    keywords: ["password", "reset"],
    featured: true
  },
  { category: "Payments & Subscriptions", question: `Where can I download my invoice? (${RUN})`, answer: "Open Subscription, then Records, and choose Download.", keywords: ["invoice"], featured: false },
  { category: "Course Content", question: `Where are my course materials? (${RUN})`, answer: "Open My Learning and choose your course.", keywords: ["materials"], featured: false }
];

test.skip(!BACKOFFICE, "Set HELPDESK_INT_BACKOFFICE_URL (and start both apps) to run the cross-app Helpdesk check.");
test.describe.configure({ mode: "serial", timeout: 240_000 });

const copy = (locale: Locale) => getMessages(locale).helpdesk;

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

async function learner(browser: Browser, nickname: string, locale: Locale = "en-GB") {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1024 }, locale });
  await context.addInitScript(() => { try { window.localStorage.setItem("learning-guide-cookie-preference", "essential"); } catch { /* ignore */ } });
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

async function questionStats(context: BrowserContext, question: string) {
  const response = await context.request.get("/api/helpdesk/questions?locale=en-GB");
  const body = await response.json() as { data: { questions: { question: string; stats: { shown: number; solved: number; declined: number } }[] } };
  return body.data.questions.find((item) => item.question === question)?.stats ?? null;
}

const enquiry = { subject: `Cannot reset my password ${RUN}`, id: "" };
// The enquiry owner's signed-in session, kept from the test that creates the enquiry.
let ownerState: Awaited<ReturnType<BrowserContext["storageState"]>> | undefined;

async function ownerSession(browser: Browser) {
  expect(ownerState, "the enquiry test must run first").toBeDefined();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1024 }, storageState: ownerState });
  return { context, page: await context.newPage() };
}

test("employee creates and publishes three Common Questions; the learner sees only the featured one", async ({ browser }) => {
  const { context, page } = await staff(browser);
  await page.goto("/en-GB/help-desk?tab=questions");
  await expect(page.getByRole("heading", { name: "Help Desk" })).toBeVisible();
  for (const item of QUESTIONS) {
    await page.locator(".hdPrimaryButton").click();
    const modal = page.locator(".ant-modal");
    await expect(modal).toBeVisible();
    await modal.locator("#hd-q-category").click();
    await page.locator(".ant-select-item-option", { hasText: item.category }).click();
    await modal.locator("#hd-q-question").fill(item.question);
    await modal.locator("#hd-q-answer").fill(item.answer);
    await modal.locator("#hd-q-keywords").click();
    for (const keyword of item.keywords) { await page.keyboard.type(keyword); await page.keyboard.press("Enter"); }
    const switches = modal.locator(".hdSwitch .ant-switch");
    if (item.featured) await switches.nth(0).click();
    await switches.nth(1).click();
    await expect(switches.nth(1)).toHaveAttribute("aria-checked", "true");
    await modal.locator(".ant-btn-primary").click();
    await expect(modal).toHaveCount(0);
    await expect(page.locator(".hdQuestions .ant-table-row", { hasText: item.question })).toContainText("Published");
  }
  await shot(page, "backoffice-questions-en-GB");
  await context.close();

  const { context: learnerContext, page: learnerPage } = await learner(browser, "Emily Carter");
  await learnerPage.goto("/en-GB/account/my-learning/support");
  // v2: popular FAQs are the chat panel's starter chips (tickets-v2-figma-addendum §4c).
  const chat = learnerPage.getByRole("region", { name: copy("en-GB").chat.title });
  await expect(chat.getByRole("button", { name: QUESTIONS[0].question })).toBeVisible();
  for (const hidden of QUESTIONS.slice(1)) await expect(learnerPage.getByText(hidden.question)).toHaveCount(0);
  await learnerContext.close();
});

test("learner: matching enquiry → assistant modal → No, still submit with a screenshot → BackOffice row is unread", async ({ browser }) => {
  const { context, page } = await learner(browser, "Emily Carter");
  const text = copy("en-GB");
  await page.goto("/en-GB/account/my-learning/support");
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
  const [ticket] = await learnerTickets(page);
  expect(ticket.subject).toBe(enquiry.subject);
  enquiry.id = ticket.id;
  ownerState = await context.storageState();

  const office = await staff(browser);
  await office.page.goto("/en-GB/help-desk");
  const row = office.page.locator(".hdRow", { hasText: enquiry.subject });
  await expect(row).toBeVisible();
  await expect(row.locator(".hdUnreadDot")).toBeVisible();
  await expect(row).toContainText("Emily Carter");
  await shot(office.page, "backoffice-enquiries-unread-en-GB");
  // The declined suggestion counts on the Common Questions tab.
  await expect.poll(() => questionStats(office.context, QUESTIONS[0].question)).toEqual({ shown: 1, solved: 0, declined: 1 });
  await office.context.close();
  await context.close();
});

test("BackOffice: open clears the dot, student info and plan, tag, internal note, reply; learner sees the reply only", async ({ browser }) => {
  const office = await staff(browser);
  const page = office.page;
  await page.goto("/en-GB/help-desk");
  const row = page.locator(".hdRow", { hasText: enquiry.subject });
  await row.click();
  await expect(page.locator(".hdEnquiryCard")).toContainText(enquiry.subject);
  await expect(row.locator(".hdUnreadDot")).toHaveCount(0);
  const side = page.locator(".hdSide");
  await expect(side.locator(".hdStudentName")).toHaveText("Emily Carter");
  await expect(side.locator(".hdFact", { hasText: "Total Enquiries" })).toContainText("1");
  await expect(side.locator(".hdPlanRow", { hasText: "Plan Name" }).locator("dd")).toHaveText("—");
  await expect(page.locator(".hdFileChip")).toContainText("screenshot.png");

  await page.locator(".hdAddTag").click();
  await page.locator(".hdTagEditor input").fill("Password Reset");
  await page.locator(".hdTagEditor input").press("Enter");
  await expect(side.locator(".hdTag", { hasText: "password reset" })).toBeVisible();

  await page.locator(".hdMode", { hasText: "Internal note" }).click();
  await page.locator(".hdTextarea").fill("Checked the mail logs: delivered to spam.");
  await page.locator(".hdComposer button[type=submit]").click();
  await expect(page.locator(".hdMsgCardInternal", { hasText: "Checked the mail logs" })).toBeVisible();
  await page.locator(".hdMode", { hasText: "Reply to learner" }).click();
  await page.locator(".hdTextarea").fill("Hi Emily, I have re-sent the reset email. Please check your spam folder.");
  await page.locator(".hdComposer button[type=submit]").click();
  await expect(page.locator(".hdMsgCardAgent:not(.hdMsgCardInternal)", { hasText: "re-sent the reset email" })).toBeVisible();
  await shot(page, "backoffice-enquiry-thread-en-GB");
  await office.context.close();

  // A page reload in a fresh session must still show it as read.
  const again = await staff(browser);
  await again.page.goto("/en-GB/help-desk");
  await expect(again.page.locator(".hdRow", { hasText: enquiry.subject }).locator(".hdUnreadDot")).toHaveCount(0);
  await again.context.close();
});

test("learner sees the reply but not the internal note; Mark as reviewed → learner confirms → BackOffice shows Closed", async ({ browser }) => {
  const text = copy("en-GB");
  const owner = await ownerSession(browser);
  await owner.page.goto(`/en-GB/account/my-learning/support/${enquiry.id}`);
  await expect(owner.page.locator(".helpdesk-message-agent", { hasText: "re-sent the reset email" })).toBeVisible();
  await expect(owner.page.getByText("Checked the mail logs")).toHaveCount(0);
  await expect(owner.page.locator(".helpdesk-status-pill")).toHaveText(text.status.WAITING_USER);

  // The learner answers: the enquiry is unread for staff again, and opening it clears that.
  await owner.page.getByLabel(text.detail.replyLabel).fill("Found it in spam, but the link has expired.");
  await owner.page.getByRole("button", { name: text.detail.send }).click();
  await expect(owner.page.locator(".helpdesk-status-pill")).toHaveText(text.status.ASSIGNED);
  const office = await staff(browser);
  await office.page.goto("/en-GB/help-desk");
  const row = office.page.locator(".hdRow", { hasText: enquiry.subject });
  await expect(row.locator(".hdUnreadDot")).toBeVisible();
  await row.click();
  await expect(office.page.locator(".hdMsgCard", { hasText: "Found it in spam, but the link has expired." })).toBeVisible();
  await expect(row.locator(".hdUnreadDot")).toHaveCount(0);
  await office.page.locator(".hdTextarea").fill("I have sent a fresh link that is valid for 24 hours.");
  await office.page.locator(".hdComposer button[type=submit]").click();
  await expect(office.page.locator(".hdMsgCardAgent", { hasText: "fresh link" })).toBeVisible();
  await office.page.locator(".hdMarkReviewed").click();
  await expect(office.page.locator(".hdStatusPENDING_CONFIRM")).toBeVisible();
  await expect(office.page.locator(".hdMarkReviewed")).toHaveCount(0);

  await owner.page.reload();
  const banner = owner.page.locator(".helpdesk-confirm-banner");
  await expect(banner).toContainText(text.detail.confirmPrompt);
  await shot(owner.page, "portal-pending-confirm-en-GB");
  await banner.getByRole("button", { name: text.detail.confirmYes }).click();
  await expect(owner.page.locator(".helpdesk-status-pill")).toHaveText(text.status.CLOSED);

  await office.page.reload();
  await expect(office.page.locator(".hdStatusCLOSED")).toBeVisible();
  await office.page.goto("/en-GB/help-desk?status=CLOSED");
  await expect(office.page.locator(".hdRow", { hasText: enquiry.subject })).toBeVisible();
  await shot(office.page, "backoffice-enquiry-closed-en-GB");
  await office.context.close();
  await owner.context.close();
});

test("Yes, this solved my issue creates no ticket and the counter shows solved", async ({ browser }) => {
  const { context, page } = await learner(browser, "Noah Green");
  const text = copy("en-GB");
  await page.goto("/en-GB/account/my-learning/support");
  await fillEnquiry(page, `Password reset email ${RUN}`, "Where is my password reset email?");
  await page.getByRole("button", { name: text.submit }).click();
  const modal = page.getByRole("dialog", { name: text.assistant.title });
  await expect(modal).toContainText("Hi Noah!");
  await modal.getByRole("button", { name: text.assistant.yes }).click();
  await expect(page.getByText(text.assistant.thanksTitle)).toBeVisible();
  await page.waitForURL("**/en-GB/account/my-learning", { timeout: 30_000 });
  expect(await learnerTickets(page)).toEqual([]);
  const office = await staff(browser);
  await expect.poll(() => questionStats(office.context, QUESTIONS[0].question)).toEqual({ shown: 2, solved: 1, declined: 1 });
  await office.page.goto("/en-GB/help-desk?tab=questions");
  await expect(office.page.locator(".hdQuestions .ant-table-row", { hasText: QUESTIONS[0].question }).locator(".hdStats")).toContainText("2");
  await office.context.close();
  await context.close();
});

test("VIEW role sees everything but no write controls and leaves the enquiry untouched", async ({ browser }) => {
  test.skip(!VIEWER.email, "Set HELPDESK_INT_VIEW_EMAIL for a helpDesk VIEW employee.");
  const view = await staff(browser, VIEWER);
  const writes: string[] = [];
  view.page.on("request", (request) => { if (request.method() !== "GET" && request.url().includes("/api/helpdesk/")) writes.push(request.url()); });
  await view.page.goto(`/en-GB/help-desk/${enquiry.id}`);
  await expect(view.page.locator(".hdEnquiryCard")).toContainText(enquiry.subject);
  for (const selector of [".hdPrimaryButton", ".hdMarkReviewed", ".hdComposer", ".hdAddTag", ".hdTagRemove"]) await expect(view.page.locator(selector)).toHaveCount(0);
  await shot(view.page, "backoffice-view-role-en-GB");
  await view.page.goto("/en-GB/help-desk?tab=questions");
  await expect(view.page.locator(".hdQuestions .ant-table-row").first()).toBeVisible();
  await expect(view.page.locator(".hdQuestions .hdLinkButton")).toHaveCount(0);
  expect(writes).toEqual([]);
  const denied = await view.context.request.post("/api/helpdesk/questions", { data: { locale: "en-GB", category: "other", question: "x", answer: "y", keywords: [], featured: false, publish: false } });
  expect(denied.status()).toBe(403);
  await view.context.close();
});

test("zh-CN pages render on both sides, with a zh-CN question and a learner who has a plan", async ({ browser }) => {
  const zh = copy("zh-CN");
  const office = await staff(browser, STAFF, "zh-CN");
  const question = `如何重置密码？（${RUN}）`;
  const created = await office.context.request.post("/api/helpdesk/questions", {
    data: { locale: "zh-CN", category: "technical_support", question, answer: "1. 检查垃圾邮件文件夹\n重置邮件可能在那里。", keywords: ["密码"], featured: true, publish: true }
  });
  expect(created.status(), await created.text()).toBe(201);

  const { context, page } = await learner(browser, "陈艾米", "zh-CN");
  const origin = new URL(test.info().project.use.baseURL!).origin;
  const post = (url: string, data: unknown) => page.request.post(url, { data, headers: { Origin: origin } });
  const quote = await (await post("/api/purchase/quote", { planId: "epicureanism-pc-6", kind: "purchase" })).json() as { quote: { id: string } };
  const checkout = await (await post("/api/purchase/checkout", { quoteId: quote.quote.id, locale: "zh-CN", consents: { renewal: true, terms: true, refund: true } })).json() as { order: { id: string } };
  expect((await post("/api/purchase/demo/confirm", { orderId: checkout.order.id, action: "complete" })).status()).toBe(200);
  await page.goto("/zh-CN/account/my-learning/support");
  await expect(page.getByRole("heading", { level: 1, name: zh.pageTitle })).toBeVisible();
  await expect(page.getByRole("button", { name: question })).toBeVisible();
  await shot(page, "portal-contact-support-zh-CN");
  const ticket = await page.request.post("/api/helpdesk/tickets", {
    headers: { "Idempotency-Key": randomUUID(), Origin: origin },
    multipart: { category: "payments_subscriptions", subject: `发票问题 ${RUN}`, body: "我需要十月的发票。", locale: "zh-CN" }
  });
  expect(ticket.status()).toBe(201);
  const { id } = await ticket.json() as { id: string };
  await context.close();

  await office.page.goto(`/zh-CN/help-desk/${id}`);
  await expect(office.page.locator(".hdEnquiryCard")).toContainText(`发票问题 ${RUN}`);
  const side = office.page.locator(".hdSide");
  await expect(side).toContainText("学员信息");
  await expect(side.locator(".hdPlanRow", { hasText: "方案名称" }).locator("dd")).toContainText("Epicureanism");
  await expect(side.locator(".hdPlanRow", { hasText: "计费周期" }).locator("dd")).toHaveText("按半年");
  await expect(side.locator(".hdPlanRow", { hasText: "状态" }).locator(".hdPill-success")).toHaveText("生效中");
  await shot(office.page, "backoffice-enquiry-zh-CN");
  await office.context.close();
});
