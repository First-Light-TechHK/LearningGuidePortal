// Helpdesk Tickets v1, learner side (spec §6/§8 + Figma addendum §B):
// AccountNav entry, Contact Support form (Figma 1216:6), AI Support Assistant
// modal (Figma 1333:249) with its three outcomes, My enquiries and every
// learner action on the ticket page, ownership, and attachment rejection.
// Admin is played by tests/e2e/helpdesk-admin-stub.mjs (see playwright.helpdesk.config.ts);
// agents act through Portal's integration API with a local test token.
import { expect, test, type APIRequestContext, type Browser, type Page } from "playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { crc32, deflateSync } from "node:zlib";
import { getMessages } from "../../lib/i18n/messages";
import { HELPDESK_E2E, helpdeskAdminStubUrl } from "./helpdesk-e2e-env";

type Locale = "en-GB" | "zh-CN";
const PASSWORD = "Passw0rd!123";
const AGENT = { id: "agent-e2e-1", name: "Alex Support" };
// Screenshots for the visual check; HELPDESK_SHOTS_DIR keeps them out of Playwright's cleaned output folder.
const SHOTS = process.env.HELPDESK_SHOTS_DIR || "test-results/helpdesk-shots";
// 1×1 transparent PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

test.describe.configure({ timeout: 180_000 });

/** A small visible PNG (a blue-to-white gradient) for the screenshots. */
function gradientPng(width = 96, height = 64) {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const rows: number[] = [];
  for (let y = 0; y < height; y += 1) {
    rows.push(0);
    for (let x = 0; x < width; x += 1) { const t = x / width; rows.push(Math.round(37 + t * 200), Math.round(99 + t * 140), 235); }
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.from(rows))), chunk("IEND", Buffer.alloc(0))]);
}

function copy(locale: Locale) {
  return getMessages(locale).helpdesk;
}

async function newLearner(browser: Browser, locale: Locale = "en-GB", nickname = "Hana Learner") {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1024 }, locale });
  // Keep the cookie banner out of the way (and out of the screenshots).
  await context.addInitScript(() => { try { window.localStorage.setItem("learning-guide-cookie-preference", "essential"); } catch { /* ignore */ } });
  const email = `helpdesk-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
  const registered = await context.request.post("/api/auth/register", { data: { termsAccepted: true, email, password: PASSWORD, nickname, locale } });
  expect(registered.status()).toBe(200);
  const page = await context.newPage();
  return { context, page, email, nickname };
}

function origin(page: Page) {
  return new URL(page.url() === "about:blank" ? test.info().project.use.baseURL! : page.url()).origin;
}

/** Learner API create (used where the form itself is not under test). */
async function createTicketByApi(page: Page, subject: string, locale: Locale = "en-GB") {
  const response = await page.request.post("/api/helpdesk/tickets", {
    headers: { "Idempotency-Key": randomUUID(), Origin: origin(page) },
    multipart: { category: "technical_support", subject, body: `${subject} — details`, locale }
  });
  expect(response.status()).toBe(201);
  return await response.json() as { id: string; number: string; sequence: number };
}

const bearer = { Authorization: `Bearer ${HELPDESK_E2E.portalToken}` };

async function agentTicket(request: APIRequestContext, id: string) {
  const response = await request.get(`/api/integration/helpdesk/tickets/${id}`, { headers: bearer });
  expect(response.status()).toBe(200);
  return await response.json() as { sequence: number; status: string; suggestionId: string | null; events: { type: string }[] };
}

async function agentReply(request: APIRequestContext, id: string, body: string) {
  const { sequence } = await agentTicket(request, id);
  const response = await request.post(`/api/integration/helpdesk/tickets/${id}/messages`, { headers: { ...bearer, "Idempotency-Key": randomUUID() }, data: { body, internal: false, agent: AGENT, expectedSequence: sequence } });
  expect(response.status()).toBe(201);
}

async function agentPropose(request: APIRequestContext, id: string) {
  const { sequence } = await agentTicket(request, id);
  const response = await request.post(`/api/integration/helpdesk/tickets/${id}/actions`, { headers: { ...bearer, "Idempotency-Key": randomUUID() }, data: { action: "propose_resolution", agent: AGENT, expectedSequence: sequence } });
  expect(response.status()).toBe(200);
}

async function learnerTickets(page: Page) {
  const response = await page.request.get("/api/helpdesk/tickets");
  expect(response.status()).toBe(200);
  return (await response.json() as { tickets: { id: string; subject: string }[] }).tickets;
}

async function outcomeOf(request: APIRequestContext, suggestionId: string) {
  let outcome: string | null = null;
  await expect.poll(async () => {
    outcome = (await (await request.get(`${helpdeskAdminStubUrl()}/__outcomes/${suggestionId}`)).json() as { outcome: string | null }).outcome;
    return outcome;
  }, { timeout: 10_000 }).not.toBeNull();
  return outcome;
}

async function lastSuggestionId(request: APIRequestContext, subject: string) {
  const { suggestions } = await (await request.get(`${helpdeskAdminStubUrl()}/__suggestions`)).json() as { suggestions: { request: { subject: string }; suggestion: { id: string } | null }[] };
  const match = suggestions.filter((entry) => entry.request.subject === subject).at(-1);
  return match?.suggestion?.id ?? null;
}

async function openSupport(page: Page, locale: Locale = "en-GB") {
  await page.goto(`/${locale}/account/my-learning/support`);
  await expect(page.getByRole("heading", { level: 1, name: copy(locale).pageTitle })).toBeVisible();
}

async function fillEnquiry(page: Page, locale: Locale, input: { category: keyof ReturnType<typeof copy>["categories"]; subject: string; message: string }) {
  const text = copy(locale);
  await page.getByRole("combobox", { name: text.enquiryType }).click();
  await page.getByRole("option", { name: text.categories[input.category] }).click();
  await page.getByLabel(text.subject).fill(input.subject);
  await page.getByLabel(text.message).fill(input.message);
}

async function pasteImage(page: Page, name: string, png: Buffer = PNG) {
  await page.locator(".helpdesk-dropzone").evaluate((zone, payload) => {
    const bytes = Uint8Array.from(atob(payload.base64), (char) => char.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], payload.name, { type: "image/png" }));
    zone.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, { base64: png.toString("base64"), name });
}

test("AccountNav Contact support opens the support page with Common Questions", async ({ browser }) => {
  const { context, page, email } = await newLearner(browser);
  const text = copy("en-GB");
  await page.goto("/en-GB/account/my-learning/settings");
  const link = page.locator(".account-nav-support a");
  await expect(link).toHaveText(getMessages("en-GB").account.contactAction);
  await expect(link).toHaveAttribute("href", "/en-GB/account/my-learning/support");
  await link.click();
  await page.waitForURL("**/en-GB/account/my-learning/support");
  await expect(page.getByRole("heading", { level: 1, name: text.pageTitle })).toBeVisible();
  await expect(page.getByLabel(text.email)).toHaveValue(email);
  await expect(page.getByRole("heading", { name: text.commonQuestions })).toBeVisible();
  const question = page.getByRole("button", { name: "How do I access my course materials?" });
  await expect(question).toHaveAttribute("aria-expanded", "false");
  await question.click();
  await expect(question).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("Open My Learning and choose your course.")).toBeVisible();
  await expect(page.getByRole("link", { name: "https://www.ilovelearningguide.com/help" })).toHaveAttribute("href", "https://www.ilovelearningguide.com/help");
  await context.close();
});

test("submit without a suggestion creates a ticket with a pasted screenshot and lists it", async ({ browser }) => {
  const { context, page, email } = await newLearner(browser);
  const text = copy("en-GB");
  await openSupport(page);
  // Client validation first: nothing is sent while required fields are empty.
  await page.getByRole("button", { name: text.submit }).click();
  await expect(page.getByText(text.validation.category)).toBeVisible();
  const subject = `Video will not play ${randomUUID().slice(0, 6)}`;
  await fillEnquiry(page, "en-GB", { category: "technical_support", subject, message: "The lesson video stays black." });
  await pasteImage(page, "screenshot.png");
  await expect(page.locator(".helpdesk-file-chip")).toContainText("screenshot.png");
  await page.getByRole("button", { name: text.submit }).click();
  await expect(page.getByRole("heading", { name: text.success.title })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const number = (await page.locator(".helpdesk-success-number").textContent())?.trim() ?? "";
  expect(number).toMatch(/^LG-\d{6}-\d{4,}$/);
  await expect(page.getByText(email)).toBeVisible();
  expect(await lastSuggestionId(page.request, subject)).toBeNull();
  await page.getByRole("link", { name: text.success.view }).click();
  await expect(page.getByRole("heading", { level: 1, name: subject })).toBeVisible();
  await expect(page.locator(".helpdesk-status-pill")).toHaveText(text.status.OPEN);
  const image = page.locator(".helpdesk-attachment-image img");
  await expect(image).toHaveAttribute("alt", "screenshot.png");
  await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBe(1);
  await page.getByRole("link", { name: text.detail.back }).click();
  await page.waitForURL("**/en-GB/account/my-learning/support/enquiries");
  const card = page.locator(".helpdesk-enquiry-card", { hasText: subject });
  await expect(card).toContainText(number);
  await expect(card.locator(".helpdesk-status-pill")).toHaveText(text.status.OPEN);
  await context.close();
});

test("assistant suggestion: Yes reports solved and creates no ticket", async ({ browser }) => {
  const { context, page } = await newLearner(browser, "en-GB", "Emily Carter");
  const text = copy("en-GB");
  await openSupport(page);
  const subject = `Cannot reset my password ${randomUUID().slice(0, 6)}`;
  await fillEnquiry(page, "en-GB", { category: "technical_support", subject, message: "The reset email never arrives." });
  await page.getByRole("button", { name: text.submit }).click();
  const modal = page.getByRole("dialog", { name: text.assistant.title });
  await expect(modal).toBeVisible();
  await expect(modal).toContainText("Hi Emily! Here's a possible solution to your issue:");
  await expect(modal.locator(".helpdesk-answer-heading").first()).toHaveText("1. Check your spam folder");
  await expect(modal).toContainText(subject);
  await expect(modal).toContainText(text.categories.technical_support);
  await expect(modal.locator(".helpdesk-avatar")).toHaveText("EC");
  await modal.getByRole("button", { name: text.assistant.yes }).click();
  await expect(page.getByText(text.assistant.thanksTitle)).toBeVisible();
  await page.waitForURL("**/en-GB/account/my-learning", { timeout: 30_000 });
  const suggestionId = await lastSuggestionId(page.request, subject);
  expect(suggestionId).not.toBeNull();
  expect(await outcomeOf(page.request, suggestionId!)).toBe("solved");
  expect(await learnerTickets(page)).toEqual([]);
  await context.close();
});

test("assistant suggestion: No submits the ticket and records the declined suggestion", async ({ browser }) => {
  const { context, page } = await newLearner(browser);
  const text = copy("en-GB");
  await openSupport(page);
  const subject = `Password email missing ${randomUUID().slice(0, 6)}`;
  await fillEnquiry(page, "en-GB", { category: "technical_support", subject, message: "Still no password email." });
  await page.getByRole("button", { name: text.submit }).click();
  const modal = page.getByRole("dialog", { name: text.assistant.title });
  await modal.getByRole("button", { name: text.assistant.no }).click();
  await expect(page.getByRole("heading", { name: text.success.title })).toBeVisible();
  const suggestionId = await lastSuggestionId(page.request, subject);
  expect(await outcomeOf(page.request, suggestionId!)).toBe("declined");
  const [ticket] = await learnerTickets(page);
  expect(ticket.subject).toBe(subject);
  const agentView = await agentTicket(page.request, ticket.id);
  expect(agentView.suggestionId).toBe(suggestionId);
  expect(agentView.events.map((event) => event.type)).toContain("com.ilovelearningguide.helpdesk.ticket.suggestion_declined");
  await context.close();
});

test("assistant suggestion: Edit closes the modal and keeps the form", async ({ browser }) => {
  const { context, page } = await newLearner(browser);
  const text = copy("en-GB");
  await openSupport(page);
  const subject = `Password help ${randomUUID().slice(0, 6)}`;
  await fillEnquiry(page, "en-GB", { category: "course_content", subject, message: "Where do I change my password?" });
  await page.getByRole("button", { name: text.submit }).click();
  await page.getByRole("dialog", { name: text.assistant.title }).getByRole("button", { name: text.assistant.edit }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByLabel(text.subject)).toHaveValue(subject);
  await expect(page.getByLabel(text.message)).toHaveValue("Where do I change my password?");
  await expect(page.getByRole("combobox", { name: text.enquiryType })).toContainText(text.categories.course_content);
  expect(await outcomeOf(page.request, (await lastSuggestionId(page.request, subject))!)).toBe("edited");
  expect(await learnerTickets(page)).toEqual([]);
  await context.close();
});

test("agent reply, learner reply, resolution: not yet, solved, rating and follow-up", async ({ browser }) => {
  const { context, page } = await newLearner(browser);
  const text = copy("en-GB");
  await page.goto("/en-GB/account/my-learning/support");
  const ticket = await createTicketByApi(page, `Course access ${randomUUID().slice(0, 6)}`);
  await agentReply(page.request, ticket.id, "Could you tell us which course?");
  await page.goto(`/en-GB/account/my-learning/support/${ticket.id}`);
  await expect(page.locator(".helpdesk-status-pill")).toHaveText(text.status.WAITING_USER);
  const agentMessage = page.locator(".helpdesk-message-agent", { hasText: "Could you tell us which course?" });
  await expect(agentMessage).toContainText(AGENT.name);
  await page.getByLabel(text.detail.replyLabel).fill("Epicureanism, lesson 2.");
  await page.getByRole("button", { name: text.detail.send }).click();
  await expect(page.locator(".helpdesk-message-learner", { hasText: "Epicureanism, lesson 2." })).toBeVisible();
  await expect(page.locator(".helpdesk-status-pill")).toHaveText(text.status.ASSIGNED);
  await expect(page.getByLabel(text.detail.replyLabel)).toHaveValue("");

  await agentPropose(page.request, ticket.id);
  await page.reload();
  await expect(page.locator(".helpdesk-status-pill")).toHaveText(text.status.PENDING_CONFIRM);
  const banner = page.locator(".helpdesk-confirm-banner");
  await expect(banner).toContainText(text.detail.confirmPrompt);
  await banner.getByRole("button", { name: text.detail.confirmNo }).click();
  await expect(page.locator(".helpdesk-status-pill")).toHaveText(text.status.ASSIGNED);
  await expect(page.locator(".helpdesk-confirm-banner")).toHaveCount(0);

  await agentPropose(page.request, ticket.id);
  await page.reload();
  await page.locator(".helpdesk-confirm-banner").getByRole("button", { name: text.detail.confirmYes }).click();
  await expect(page.locator(".helpdesk-status-pill")).toHaveText(text.status.CLOSED);
  await page.getByRole("button", { name: "5 out of 5" }).click();
  await expect(page.getByText("You rated this 5 out of 5. Thank you!")).toBeVisible();

  await page.getByLabel(text.detail.replyLabel).fill("One more question about lesson 3.");
  await page.getByRole("button", { name: text.detail.followUp }).click();
  await expect(page.locator(".helpdesk-status-pill")).toHaveText(text.status.ASSIGNED);
  await expect(page.locator(".helpdesk-event", { hasText: text.detail.events.reopened })).toBeVisible();
  await context.close();
});

test("a stale page reloads the ticket and says it was updated; self-close then works", async ({ browser }) => {
  const { context, page } = await newLearner(browser);
  const text = copy("en-GB");
  await page.goto("/en-GB/account/my-learning/support");
  const ticket = await createTicketByApi(page, `Stale check ${randomUUID().slice(0, 6)}`);
  await agentReply(page.request, ticket.id, "First answer.");
  await page.goto(`/en-GB/account/my-learning/support/${ticket.id}`);
  await expect(page.locator(".helpdesk-status-pill")).toHaveText(text.status.WAITING_USER);
  await agentReply(page.request, ticket.id, "Second answer while the page was open.");
  await page.getByRole("button", { name: text.detail.solved }).click();
  await expect(page.locator("main").getByRole("alert")).toHaveText(text.detail.updated);
  await expect(page.getByText("Second answer while the page was open.")).toBeVisible();
  await page.getByRole("button", { name: text.detail.solved }).click();
  await expect(page.locator(".helpdesk-status-pill")).toHaveText(text.status.CLOSED);
  await context.close();
});

test("withdraw an open enquiry; it becomes read only", async ({ browser }) => {
  const { context, page } = await newLearner(browser);
  const text = copy("en-GB");
  await page.goto("/en-GB/account/my-learning/support");
  const ticket = await createTicketByApi(page, `Withdraw me ${randomUUID().slice(0, 6)}`);
  await page.goto(`/en-GB/account/my-learning/support/${ticket.id}`);
  await page.getByRole("button", { name: text.detail.withdraw, exact: true }).click();
  await page.getByRole("button", { name: text.detail.withdrawYes }).click();
  await expect(page.locator(".helpdesk-status-pill")).toHaveText(text.status.CANCELLED);
  await expect(page.getByText(text.detail.cancelledNote)).toBeVisible();
  await expect(page.getByLabel(text.detail.replyLabel)).toHaveCount(0);
  await context.close();
});

test("someone else's ticket is a 404 page and a 404 API answer", async ({ browser }) => {
  const owner = await newLearner(browser);
  await owner.page.goto("/en-GB/account/my-learning/support");
  const ticket = await createTicketByApi(owner.page, `Private ${randomUUID().slice(0, 6)}`);
  const other = await newLearner(browser);
  const response = await other.page.goto(`/en-GB/account/my-learning/support/${ticket.id}`);
  expect(response?.status()).toBe(404);
  await expect(other.page.getByText(ticket.number)).toHaveCount(0);
  expect((await other.page.request.get(`/api/helpdesk/tickets/${ticket.id}`)).status()).toBe(404);
  await owner.context.close();
  await other.context.close();
});

test("attachments: wrong type, over 10 MB and a sixth file are refused in the page; a disguised file gets the server's 415", async ({ browser }) => {
  const { context, page } = await newLearner(browser);
  const text = copy("en-GB");
  await openSupport(page);
  const input = page.locator(".helpdesk-dropzone input[type=file]");
  await input.setInputFiles({ name: "setup.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") });
  await expect(page.locator("main").getByRole("alert")).toContainText("setup.exe cannot be attached.");
  await input.setInputFiles({ name: "huge.png", mimeType: "image/png", buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 1) });
  await expect(page.locator("main").getByRole("alert")).toContainText("huge.png is larger than 10 MB.");
  await expect(page.locator(".helpdesk-file-chip")).toHaveCount(0);
  await input.setInputFiles(["a", "b", "c", "d", "e", "f"].map((name) => ({ name: `${name}.png`, mimeType: "image/png", buffer: PNG })));
  await expect(page.locator(".helpdesk-file-chip")).toHaveCount(5);
  await expect(page.locator("main").getByRole("alert")).toContainText(text.fileErrors.count);
  for (let index = 0; index < 5; index += 1) await page.locator(".helpdesk-file-chip button").first().click();
  await expect(page.locator(".helpdesk-file-chip")).toHaveCount(0);
  await input.setInputFiles({ name: "fake.png", mimeType: "image/png", buffer: Buffer.from("<html><script>alert(1)</script></html>") });
  await fillEnquiry(page, "en-GB", { category: "other", subject: `Disguised file ${randomUUID().slice(0, 6)}`, message: "See attachment." });
  await page.getByRole("button", { name: text.submit }).click();
  await expect(page.locator("main").getByRole("alert")).toHaveText(text.errors.unsupported);
  await expect(page.getByLabel(text.subject)).not.toHaveValue("");
  expect(await learnerTickets(page)).toEqual([]);
  await context.close();
});

test("visual capture for Figma comparison (en-GB and zh-CN)", async ({ browser }) => {
  await mkdir(SHOTS, { recursive: true });
  for (const locale of ["en-GB", "zh-CN"] as const) {
    const text = copy(locale);
    const { context, page } = await newLearner(browser, locale, locale === "en-GB" ? "Emily Carter" : "陈艾米");
    await openSupport(page, locale);
    await expect(page.getByRole("heading", { name: text.commonQuestions })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/portal-${locale}-contact-support.png` });
    await page.getByRole("combobox", { name: text.enquiryType }).click();
    await page.screenshot({ path: `${SHOTS}/portal-${locale}-contact-support-open-select.png` });
    await page.getByRole("option", { name: text.categories.technical_support }).click();
    await page.getByLabel(text.subject).fill(locale === "en-GB" ? "Cannot log in to my account" : "无法登录账号（密码）");
    await page.getByLabel(text.message).fill(locale === "en-GB"
      ? "I am unable to log in to my account. It keeps showing an error message saying \"Invalid email or password\" even though I am sure my details are correct. I have tried resetting my password but I did not receive the reset email in my inbox.\nCould you please help me resolve this issue? I need to access my course materials as soon as possible.\n\nThank you!"
      : "我无法登录账号，一直提示“邮箱或密码错误”。我尝试重置密码，但没有收到重置邮件。\n请帮我解决这个问题，我需要尽快访问课程资料。\n\n谢谢！");
    await pasteImage(page, "screenshot.png", gradientPng());
    await page.screenshot({ path: `${SHOTS}/portal-${locale}-contact-support-filled.png` });
    await page.getByRole("button", { name: text.submit }).click();
    await expect(page.getByRole("dialog", { name: text.assistant.title })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/portal-${locale}-assistant-modal.png` });
    await page.getByRole("button", { name: text.assistant.no }).click();
    await expect(page.getByRole("heading", { name: text.success.title })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/portal-${locale}-success.png` });
    const [ticket] = await learnerTickets(page);
    await createTicketByApi(page, locale === "en-GB" ? "Invoice for October" : "十月发票", locale);
    await agentReply(page.request, ticket.id, locale === "en-GB" ? "Please check your spam folder, then try again." : "请先检查垃圾邮件文件夹，然后再试一次。");
    await agentPropose(page.request, ticket.id);
    await page.goto(`/${locale}/account/my-learning/support/enquiries`);
    await expect(page.locator(".helpdesk-enquiry-card")).toHaveCount(2);
    await page.screenshot({ path: `${SHOTS}/portal-${locale}-my-enquiries.png`, fullPage: true });
    await page.goto(`/${locale}/account/my-learning/support/${ticket.id}`);
    await expect(page.locator(".helpdesk-confirm-banner")).toContainText(text.detail.confirmPrompt);
    await page.screenshot({ path: `${SHOTS}/portal-${locale}-pending-confirm.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/${locale}/account/my-learning/support`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    await page.screenshot({ path: `${SHOTS}/portal-${locale}-contact-support-mobile.png`, fullPage: true });
    await context.close();
  }
});
