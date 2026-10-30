// Helpdesk Tickets v1 + v2, learner side (spec §6/§8, Figma addendum §B,
// tickets-v2-figma-addendum §4): AccountNav entry, Contact Support form and
// the AI Support Assistant chat panel (Figma 1216:6), the submit-time modal
// (Figma 1333:249) with its three outcomes, the public Help Centre (Figma
// 1387:2), the agent's view of the AI answers and the flag, My enquiries and
// every learner action on the ticket page, ownership, and attachment rejection.
// Admin is played by tests/e2e/helpdesk-admin-stub.mjs (see playwright.helpdesk.config.ts);
// agents act through Portal's integration API with a local test token.
import { expect, test, type APIRequestContext, type Browser, type Page } from "playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { crc32, deflateSync } from "node:zlib";
import { getMessages } from "../../lib/i18n/messages";
import { fillTemplate } from "../../modules/helpdesk/learnerUi";
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
  return await response.json() as { sequence: number; status: string; suggestionId: string | null; flagged: boolean; events: { type: string }[]; aiAssist: { id: string; source: string; question: string; faqId: string | null; faqQuestion: string | null; answer: string | null; feedback: string | null; rating: number | null }[] };
}

async function agentAction(request: APIRequestContext, id: string, action: "flag" | "unflag") {
  const { sequence } = await agentTicket(request, id);
  const response = await request.post(`/api/integration/helpdesk/tickets/${id}/actions`, { headers: { ...bearer, "Idempotency-Key": randomUUID() }, data: { action, agent: AGENT, expectedSequence: sequence } });
  expect(response.status()).toBe(200);
  return await response.json() as { flagged: boolean };
}

async function agentList(request: APIRequestContext, query: string) {
  const response = await request.get(`/api/integration/helpdesk/tickets?${query}`, { headers: bearer });
  expect(response.status()).toBe(200);
  return (await response.json() as { tickets: { id: string; flagged: boolean }[] }).tickets;
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

/** v3 §2: the learner's rating of one of their answers, as the rating card sends it. */
async function rateByApi(page: Page, id: string, rating: number) {
  return page.request.post(`/api/helpdesk/assistant/${id}/rating`, { headers: { "Idempotency-Key": randomUUID(), Origin: origin(page) }, data: { rating } });
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

test("AccountNav Contact support opens the support page with the AI Support Assistant; a chip answers from the FAQ", async ({ browser }) => {
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
  const panel = page.getByRole("region", { name: text.chat.title });
  // The greeting keeps the Figma title (1394:23; owner 2026-10-30).
  await expect(panel.locator(".helpdesk-chat-greeting-title")).toHaveText(text.chat.greetingTitle);
  // v5 Part A: the session's situation chips (up to 3 as Figma 1394:30 draws; no signal matched, so the popular ones).
  await expect(panel.getByRole("list", { name: text.chat.tryAsking }).locator(".helpdesk-chat-chip")).toHaveText(["How do I reset my password?", "How can I access my course materials?", "How do I change my subscription?"]);
  await panel.locator(".helpdesk-chat-chip").nth(1).click();
  const answer = panel.locator(".helpdesk-chat-answer").first();
  await expect(answer).toContainText("Find your enrolled courses and open the available lessons and resources.");
  await expect(answer.locator("strong")).toHaveText("My Learning");
  // v5 Part H: the card with the Figma "Related FAQ" link (1394:56) to the whole answer in the Help Centre.
  await expect(answer.getByRole("link", { name: fillTemplate(text.chat.relatedFaq, { question: "How can I access my course materials?" }), exact: true })).toHaveAttribute("href", "/en-GB/help?faq=0192f000-0000-7000-8000-000000000002");
  await answer.getByRole("button", { name: text.chat.yes, exact: true }).click();
  await expect(answer.getByRole("button", { name: text.chat.yes, exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(answer.getByRole("button", { name: text.chat.no, exact: true })).toBeDisabled();
  const { suggestions } = await (await page.request.get(`${helpdeskAdminStubUrl()}/__suggestions`)).json() as { suggestions: { request: { source: string; faqId?: string; learnerId: string }; suggestion: { id: string } | null }[] };
  const chip = suggestions.filter((entry) => entry.request.source === "chip").at(-1)!;
  expect(chip.request.faqId).toBe("0192f000-0000-7000-8000-000000000002");
  expect(await outcomeOf(page.request, chip.suggestion!.id)).toBe("helpful");
  await page.reload();
  await expect(panel.locator(".helpdesk-chat-question")).toHaveText(["How can I access my course materials?"]);
  await context.close();
});

test("chat answers and the declined suggestion reach the agent as AI blocks; the agent flags and unflags the enquiry", async ({ browser }) => {
  const { context, page } = await newLearner(browser, "en-GB", "Daniel Wu");
  const text = copy("en-GB");
  await openSupport(page);
  const panel = page.getByRole("region", { name: text.chat.title });
  const input = panel.getByRole("textbox", { name: text.chat.inputLabel });
  await input.fill("Where can I find my invoice?");
  await input.press("Enter");
  await expect(panel.locator(".helpdesk-chat-answer").first().locator("li")).toHaveText(["Open My Subscription", "Choose Records"]);
  await input.fill("Can I pay with crypto?");
  await input.press("Enter");
  await expect(panel.locator(".helpdesk-chat-answer").nth(1)).toHaveText(text.chat.fallback);
  const subject = `Password and invoice ${randomUUID().slice(0, 6)}`;
  await fillEnquiry(page, "en-GB", { category: "payments_subscriptions", subject, message: "The password reset email never arrives." });
  await page.getByRole("button", { name: text.submit }).click();
  await page.getByRole("dialog", { name: text.assistant.title }).getByRole("button", { name: text.assistant.no }).click();
  await expect(page.getByRole("heading", { name: text.success.title })).toBeVisible();
  const [ticket] = await learnerTickets(page);
  const seen = await agentTicket(page.request, ticket.id);
  expect(seen.aiAssist.map((item) => [item.source, item.question, item.faqQuestion, item.feedback])).toEqual([
    ["chat", "Where can I find my invoice?", "Where can I find my invoice?", null],
    ["chat", "Can I pay with crypto?", null, null],
    ["submit", subject, "How do I reset my password?", "declined"]
  ]);
  expect(seen.aiAssist[0].answer).toContain("Open **My Subscription**");
  // Admin tracing: every call names its run (the row the agent sees), chains the conversation to its first row, and carries a W3C traceparent.
  const { suggestions } = await (await page.request.get(`${helpdeskAdminStubUrl()}/__suggestions`)).json() as { suggestions: { request: { learnerId: string; runId: string; parentRunId: string | null }; traceparent: string | null }[] };
  const runs = suggestions.filter((entry) => seen.aiAssist.some((item) => item.id === entry.request.runId));
  expect(runs.map((entry) => entry.request.runId)).toEqual(seen.aiAssist.map((item) => item.id));
  expect(runs.map((entry) => entry.request.parentRunId)).toEqual([null, seen.aiAssist[0].id, seen.aiAssist[0].id]);
  for (const entry of runs) expect(entry.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/);
  expect(seen.flagged).toBe(false);
  expect((await agentAction(page.request, ticket.id, "flag")).flagged).toBe(true);
  expect((await agentList(page.request, "flagged=true")).map((item) => item.id)).toContain(ticket.id);
  const learnerId = (await (await page.request.get("/api/auth/me")).json() as { user: { id: string } }).user.id;
  expect((await agentList(page.request, `learnerId=${encodeURIComponent(learnerId)}`)).map((item) => item.id), "the student timeline lists this learner's enquiries only").toEqual([ticket.id]);
  expect((await agentAction(page.request, ticket.id, "unflag")).flagged).toBe(false);
  expect((await agentList(page.request, "flagged=true")).map((item) => item.id)).not.toContain(ticket.id);
  const events = (await agentTicket(page.request, ticket.id)).events.map((event) => event.type);
  expect(events.filter((type) => type.endsWith("flagged"))).toEqual(["com.ilovelearningguide.helpdesk.ticket.flagged", "com.ilovelearningguide.helpdesk.ticket.unflagged"]);
  await context.close();
});

test("Help Centre: public, searchable, by topic, deep-linkable; Contact Support goes through sign-in; old help URLs redirect", async ({ browser }) => {
  const visitor = await browser.newContext({ viewport: { width: 1440, height: 1024 }, locale: "en-GB" });
  const page = await visitor.newPage();
  const help = getMessages("en-GB").helpCentre;
  await page.goto("/en-GB/help");
  await expect(page.getByRole("heading", { level: 1, name: help.title })).toBeVisible();
  const questions = page.locator(".help-centre-article-question");
  await expect(questions).toHaveText(["How do I reset my password?", "How can I access my course materials?", "How do I change my subscription?", "Where can I find my invoice?", "Why did my payment fail?", "How do I join a live session?"]);
  await expect(page.locator(".help-centre-article-summary").first()).toHaveText("Follow the steps to regain access to your Learning Guide account.");
  await questions.first().click();
  await expect(page.locator(".help-centre-answer ol > li")).toHaveCount(3);
  await page.getByRole("searchbox", { name: help.searchLabel }).fill("invoice");
  await page.waitForURL("**/en-GB/help?q=invoice");
  await expect(page.getByRole("heading", { level: 2, name: help.searchTitle })).toBeVisible();
  await expect(questions).toHaveText(["Where can I find my invoice?"]);
  await page.getByRole("searchbox", { name: help.searchLabel }).fill("zzzz");
  await page.waitForURL("**/en-GB/help?q=zzzz");
  await expect(page.locator(".help-centre-empty")).toHaveText(fillTemplate(help.searchEmpty, { q: "zzzz" }));
  await page.getByRole("navigation", { name: help.topicsTitle }).getByRole("link", { name: help.categories.courses_learning }).click();
  await page.waitForURL("**/en-GB/help?category=courses_learning");
  await expect(page.getByRole("heading", { level: 2, name: help.categories.courses_learning })).toBeVisible();
  await expect(questions).toHaveText(["How can I access my course materials?", "How do I join a live session?", "How do I access my courses?"]);
  await page.goto("/en-GB/help?faq=0192f000-0000-7000-8000-000000000008");
  await expect(questions.first()).toHaveText("Can I suggest a new feature?");
  await expect(questions.first()).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("link", { name: help.contactButton, exact: true }).click();
  await page.waitForURL(/\/en-GB\/portal\/sign-in\?returnTo=/);
  expect(new URL(page.url()).searchParams.get("returnTo")).toBe("/en-GB/account/my-learning/support");
  await visitor.close();

  const { context, page: learnerPage } = await newLearner(browser, "zh-CN");
  await learnerPage.goto("/zh-CN/account/my-learning/settings");
  const nav = learnerPage.locator("nav.account-nav").getByRole("link", { name: getMessages("zh-CN").account.help });
  await expect(nav).toHaveAttribute("href", "/zh-CN/help");
  await learnerPage.goto("/zh-CN/account/my-learning/help");
  await learnerPage.waitForURL("**/zh-CN/help");
  await learnerPage.goto("/zh-CN/my-learning/help");
  await learnerPage.waitForURL("**/zh-CN/help");
  await expect(learnerPage.locator(".help-centre-article-question").first()).toHaveText("如何重置密码？");
  await learnerPage.getByRole("link", { name: getMessages("zh-CN").helpCentre.contactButton, exact: true }).click();
  await learnerPage.waitForURL("**/zh-CN/account/my-learning/support");
  await context.close();
});

test("submit without a suggestion creates a ticket with a pasted screenshot and lists it", async ({ browser }) => {
  const { context, page, email } = await newLearner(browser);
  const text = copy("en-GB");
  await openSupport(page);
  // Client validation first: nothing is sent while required fields are empty.
  await page.getByRole("button", { name: text.submit }).click();
  await expect(page.getByText(text.validation.subject)).toBeVisible();
  // Figma 1.2 Help Page: Enquiry Type starts on Technical Support, so it is never the missing field
  await expect(page.getByText(text.validation.category)).toHaveCount(0);
  await expect(page.locator(".helpdesk-select-trigger")).toHaveText(text.categories.technical_support);
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

test("assistant suggestion: Yes reports solved, creates no ticket and asks for a rating before going back", async ({ browser }) => {
  const { context, page } = await newLearner(browser, "en-GB", "Emily Carter");
  const text = copy("en-GB");
  await openSupport(page);
  const subject = `Cannot reset my password ${randomUUID().slice(0, 6)}`;
  await fillEnquiry(page, "en-GB", { category: "technical_support", subject, message: "The reset email never arrives." });
  await page.getByRole("button", { name: text.submit }).click();
  const modal = page.getByRole("dialog", { name: text.assistant.title });
  await expect(modal).toBeVisible();
  await expect(modal).toContainText("Hi Emily! Here's a possible solution to your issue:");
  await expect(modal.locator(".helpdesk-answer-markdown ol > li strong").first()).toHaveText("Check your spam folder");
  await expect(modal.getByRole("link", { name: "sign-in page" })).toHaveAttribute("rel", "noopener noreferrer");
  await expect(modal).toContainText(subject);
  await expect(modal).toContainText(text.categories.technical_support);
  await expect(modal.locator(".helpdesk-avatar")).toHaveText("EC");
  await modal.getByRole("button", { name: text.assistant.yes }).click();
  await expect(page.getByText(text.assistant.thanksTitle)).toBeVisible();
  // v3 §2: the rating card (5 stars, Skip) comes before going back to the account.
  const card = modal.getByRole("group", { name: text.assistant.rateTitle });
  await expect(card).toBeFocused();
  await card.getByRole("button", { name: fillTemplate(text.assistant.rateStar, { n: 4 }) }).click();
  await expect(modal.getByText(text.assistant.rated)).toBeVisible();
  await page.waitForURL("**/en-GB/account/my-learning", { timeout: 30_000 });
  const suggestionId = await lastSuggestionId(page.request, subject);
  expect(suggestionId).not.toBeNull();
  expect(await outcomeOf(page.request, suggestionId!)).toBe("solved");
  expect(await learnerTickets(page)).toEqual([]);
  // One rating per answer: the same value again is fine, another is 409 answer_already_rated.
  expect((await rateByApi(page, suggestionId!, 4)).status()).toBe(200);
  const refused = await rateByApi(page, suggestionId!, 1);
  expect(refused.status()).toBe(409);
  expect(refused.headers()["content-type"]).toContain("application/problem+json");
  expect(await refused.json()).toMatchObject({ code: "answer_already_rated", status: 409, rating: 4 });
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

test("Cancel while the suggestion check is running leaves the page and creates no ticket", async ({ browser }) => {
  const { context, page } = await newLearner(browser);
  const text = copy("en-GB");
  await page.goto("/en-GB/account/my-learning/settings");
  await openSupport(page);
  const posts: string[] = [];
  page.on("request", (request) => { if (request.method() === "POST" && new URL(request.url()).pathname === "/api/helpdesk/tickets") posts.push(request.url()); });
  await page.route("**/api/helpdesk/suggestions", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ suggestion: null }) }).catch(() => undefined);
  });
  await fillEnquiry(page, "en-GB", { category: "other", subject: `Changed my mind ${randomUUID().slice(0, 6)}`, message: "Never mind." });
  await page.getByRole("button", { name: text.submit }).click();
  await expect(page.getByRole("button", { name: text.assistant.checking })).toBeVisible();
  await page.getByRole("button", { name: text.cancel }).click();
  await page.waitForURL("**/en-GB/account/my-learning/settings");
  await page.waitForTimeout(3_500);
  expect(posts).toEqual([]);
  expect(await learnerTickets(page)).toEqual([]);
  await context.close();
});

test("a submit whose response was lost is retried with the same Idempotency-Key and declined suggestion: one ticket", async ({ browser }) => {
  const { context, page } = await newLearner(browser);
  const text = copy("en-GB");
  await openSupport(page);
  const subject = `Password reset lost ${randomUUID().slice(0, 6)}`;
  const sent: Array<{ key: string; suggestionId: string | null }> = [];
  await page.route("**/api/helpdesk/tickets", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const body = route.request().postData() || "";
    sent.push({ key: route.request().headers()["idempotency-key"], suggestionId: /name="suggestionId"\r\n\r\n([0-9a-f-]{36})/.exec(body)?.[1] ?? null });
    if (sent.length === 1) {
      // The ticket is created, but the browser never hears back.
      await route.fetch();
      await route.abort("connectionreset");
      return;
    }
    await route.continue();
  });
  await fillEnquiry(page, "en-GB", { category: "technical_support", subject, message: "The reset email never came." });
  await page.getByRole("button", { name: text.submit }).click();
  await page.getByRole("dialog", { name: text.assistant.title }).getByRole("button", { name: text.assistant.no }).click();
  await expect(page.locator("main").getByRole("alert")).toHaveText(text.errors.unavailable);
  await page.getByRole("button", { name: text.submit }).click();
  await expect(page.getByRole("heading", { name: text.success.title })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(sent.length).toBe(2);
  expect(sent[1].key).toBe(sent[0].key);
  const suggestionId = await lastSuggestionId(page.request, subject);
  expect(sent.map((item) => item.suggestionId)).toEqual([suggestionId, suggestionId]);
  const { suggestions } = await (await page.request.get(`${helpdeskAdminStubUrl()}/__suggestions`)).json() as { suggestions: { request: { subject: string } }[] };
  expect(suggestions.filter((entry) => entry.request.subject === subject).length, "the retry does not ask for a new suggestion").toBe(1);
  const tickets = await learnerTickets(page);
  expect(tickets.length).toBe(1);
  expect((await agentTicket(page.request, tickets[0].id)).suggestionId).toBe(suggestionId);
  await context.close();
});

test("assistant modal: Tab stays inside, Escape works after a click on the backdrop and focus returns to Submit", async ({ browser }) => {
  const { context, page } = await newLearner(browser);
  const text = copy("en-GB");
  await openSupport(page);
  const subject = `Password focus ${randomUUID().slice(0, 6)}`;
  await fillEnquiry(page, "en-GB", { category: "technical_support", subject, message: "Where is my password email?" });
  const submit = page.getByRole("button", { name: text.submit });
  await submit.click();
  const modal = page.getByRole("dialog", { name: text.assistant.title });
  await expect(modal).toBeVisible();
  const inside = () => modal.evaluate((dialog) => dialog.contains(document.activeElement));
  for (let index = 0; index < 6; index += 1) { await page.keyboard.press("Tab"); expect(await inside()).toBe(true); }
  for (let index = 0; index < 6; index += 1) { await page.keyboard.press("Shift+Tab"); expect(await inside()).toBe(true); }
  await page.mouse.click(4, 4);
  await page.keyboard.press("Tab");
  expect(await inside(), "focus does not escape to the page behind").toBe(true);
  await page.mouse.click(4, 4);
  await page.keyboard.press("Escape");
  await expect(modal).toHaveCount(0);
  await expect(submit).toBeFocused();
  expect(await outcomeOf(page.request, (await lastSuggestionId(page.request, subject))!)).toBe("edited");
  expect(await learnerTickets(page)).toEqual([]);
  await context.close();
});

test("form accessibility: required fields are announced, the drop zone is no extra tab stop, the topic list closes on Tab, Office pastes stay text", async ({ browser }) => {
  const { context, page } = await newLearner(browser);
  const text = copy("en-GB");
  await openSupport(page);
  const combobox = page.getByRole("combobox", { name: text.enquiryType });
  for (const field of [combobox, page.getByLabel(text.subject), page.getByLabel(text.message), page.getByLabel(text.email)]) await expect(field).toHaveAttribute("aria-required", "true");
  expect(await page.locator(".helpdesk-dropzone").getAttribute("tabindex")).toBeNull();
  await combobox.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  // Copying cells from Excel puts the text and a picture of the cells on the clipboard.
  await page.getByLabel(text.subject).evaluate((input, base64) => {
    const data = new DataTransfer();
    data.setData("text/plain", "A1\tB1");
    data.items.add(new File([Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))], "image.png", { type: "image/png" }));
    input.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, PNG.toString("base64"));
  await expect(page.locator(".helpdesk-file-chip")).toHaveCount(0);
  await context.close();
});

test("an image copied from a web page (text/html and the image, no text/plain) pasted into Message attaches", async ({ browser }) => {
  const { context, page } = await newLearner(browser);
  const text = copy("en-GB");
  await openSupport(page);
  // Chrome "Copy image": the clipboard holds an <img> tag and the image file, but no plain text.
  await page.getByLabel(text.message).evaluate((textarea, base64) => {
    const data = new DataTransfer();
    data.setData("text/html", "<img src=\"https://example.test/diagram.png\">");
    data.items.add(new File([Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))], "image.png", { type: "image/png" }));
    textarea.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, PNG.toString("base64"));
  await expect(page.locator(".helpdesk-file-chip")).toHaveCount(1);
  await expect(page.locator(".helpdesk-file-chip")).toContainText(/screenshot-\d+\.png/);
  await expect(page.getByLabel(text.message)).toHaveValue("");
  await context.close();
});

test("Cancel whose page comes back (back-forward cache) does not block the next Submit", async ({ browser }) => {
  const { context, page } = await newLearner(browser);
  const text = copy("en-GB");
  await page.goto("/en-GB/account/my-learning/settings");
  await openSupport(page);
  await page.route("**/api/helpdesk/suggestions", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ suggestion: null }) }));
  // Cancel goes back to another document; the browser later restores this page as it was (React state included).
  // Keep the page in place to stand in for that restore.
  await page.evaluate(() => { window.history.back = () => undefined; });
  await page.getByRole("button", { name: text.cancel }).click();
  const subject = `Back again ${randomUUID().slice(0, 6)}`;
  await fillEnquiry(page, "en-GB", { category: "other", subject, message: "I came back to send it after all." });
  await page.getByRole("button", { name: text.submit }).click();
  await expect(page.getByRole("heading", { name: text.success.title })).toBeVisible();
  expect((await learnerTickets(page)).map((ticket) => ticket.subject)).toEqual([subject]);
  await context.close();
});

test("a follow-up refused because the window has passed reloads the ticket, so the stale composer goes away", async ({ browser }) => {
  const { context, page } = await newLearner(browser);
  const text = copy("en-GB");
  await page.goto("/en-GB/account/my-learning/support");
  const ticket = await createTicketByApi(page, `Window passed ${randomUUID().slice(0, 6)}`);
  await agentReply(page.request, ticket.id, "Done on our side.");
  const { sequence } = await agentTicket(page.request, ticket.id);
  expect((await page.request.post(`/api/helpdesk/tickets/${ticket.id}/actions`, { headers: { "Idempotency-Key": randomUUID(), Origin: origin(page) }, data: { action: "close", expectedSequence: sequence } })).status()).toBe(200);
  await page.goto(`/en-GB/account/my-learning/support/${ticket.id}`);
  await expect(page.getByRole("button", { name: text.detail.followUp })).toBeVisible();
  // As if the 7 days ran out while the page was open.
  await page.route(`**/api/helpdesk/tickets/${ticket.id}/messages`, (route) => route.fulfill({ status: 409, contentType: "application/problem+json", body: JSON.stringify({ type: "https://www.ilovelearningguide.com/problems/reopen_window_passed", title: "The follow-up window has passed", status: 409, detail: "The follow-up window has passed", code: "reopen_window_passed" }) }));
  await page.route(`**/api/helpdesk/tickets/${ticket.id}`, async (route) => {
    const response = await route.fetch();
    const body = await response.json() as { allowedActions: string[]; followUpUntil: string | null };
    await route.fulfill({ response, json: { ...body, allowedActions: [], followUpUntil: null } });
  });
  await page.getByLabel(text.detail.replyLabel).fill("One more thing.");
  await page.getByRole("button", { name: text.detail.followUp }).click();
  await expect(page.locator("main").getByRole("alert")).toHaveText(text.errors.reopenWindow);
  await expect(page.getByLabel(text.detail.replyLabel)).toHaveCount(0);
  await expect(page.locator(".helpdesk-stars")).toHaveCount(0);
  await expect(page.getByText(text.detail.closedNote)).toBeVisible();
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

// ---------------------------------------------------------------- v3: alternatives and the rating card (helpdesk-v3-alternatives-rating)
// No Figma frame for these states (待视觉验收); the stub Admin offers the account FAQs for an "account" question with no answer.

test("no answer: the modal offers “You might be asking”; a picked question answers, Yes creates no ticket and the rating card rates that answer", async ({ browser }) => {
  const { context, page } = await newLearner(browser, "zh-CN", "陈艾米");
  const text = copy("zh-CN");
  await openSupport(page, "zh-CN");
  const subject = `账号打不开 ${randomUUID().slice(0, 6)}`;
  await fillEnquiry(page, "zh-CN", { category: "technical_support", subject, message: "我的账号一直在转圈。" });
  await page.getByRole("button", { name: text.submit }).click();
  const modal = page.getByRole("dialog", { name: text.assistant.title });
  const list = modal.getByRole("list", { name: text.assistant.alternativesTitle });
  await expect(list.getByRole("button")).toHaveText(["如何重置密码？", "如何访问我的课程？", "如何访问我的课程资料？"]);
  await expect(modal.getByRole("button", { name: text.assistant.noneOfThese })).toBeVisible();
  await expect(modal).toContainText(subject);
  expect(await learnerTickets(page)).toEqual([]);
  // 待视觉验收: screenshots of the states that have no Figma frame.
  await mkdir(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/portal-zh-CN-v3-alternatives.png` });
  await list.getByRole("button", { name: "如何访问我的课程？" }).click();
  const heading = modal.getByRole("heading", { name: "如何访问我的课程？" });
  await expect(heading).toBeFocused();
  await expect(modal.locator(".helpdesk-modal-answer-content")).toContainText("你可以在“我的学习”中找到已报名的课程");
  const { suggestions } = await (await page.request.get(`${helpdeskAdminStubUrl()}/__suggestions`)).json() as { suggestions: { request: { source: string; faqId?: string; subject?: string }; suggestion: { id: string } | null }[] };
  const chip = suggestions.filter((entry) => entry.request.source === "chip").at(-1)!;
  expect(chip.request.faqId).toBe("0192f000-0000-7000-8000-000000000007");
  await modal.getByRole("button", { name: text.assistant.yes }).click();
  const card = modal.getByRole("group", { name: text.assistant.rateTitle });
  await expect(card).toBeFocused();
  await page.screenshot({ path: `${SHOTS}/portal-zh-CN-v3-rating-card.png` });
  await card.getByRole("button", { name: fillTemplate(text.assistant.rateStar, { n: 5 }) }).click();
  await expect(modal.getByText(text.assistant.rated)).toBeVisible();
  await page.waitForURL("**/zh-CN/account/my-learning", { timeout: 30_000 });
  expect(await learnerTickets(page)).toEqual([]);
  expect(await outcomeOf(page.request, chip.suggestion!.id)).toBe("helpful");
  expect((await rateByApi(page, chip.suggestion!.id, 3)).status(), "the chip answer was rated 5 by the card").toBe(409);
  // The learner comes back in this tab with a new enquiry: the answer they rated goes with it, so the agent sees it
  // with its feedback and rating, and Admin is told it was shown (shownFaqIds), so it is not offered again.
  await openSupport(page, "zh-CN");
  const again = `账号还是打不开 ${randomUUID().slice(0, 6)}`;
  await fillEnquiry(page, "zh-CN", { category: "technical_support", subject: again, message: "我的账号还是一直在转圈。" });
  await page.getByRole("button", { name: text.submit }).click();
  await expect(list.getByRole("button")).toHaveText(["如何重置密码？", "如何访问我的课程资料？"]);
  const { suggestions: later } = await (await page.request.get(`${helpdeskAdminStubUrl()}/__suggestions`)).json() as { suggestions: { request: { subject?: string; shownFaqIds?: string[] } }[] };
  expect(later.filter((entry) => entry.request.subject === again).at(-1)!.request.shownFaqIds).toEqual(["0192f000-0000-7000-8000-000000000007"]);
  await modal.getByRole("button", { name: text.assistant.noneOfThese }).click();
  await expect(page.getByRole("heading", { name: text.success.title })).toBeVisible();
  const [ticket] = await learnerTickets(page);
  const agentView = await agentTicket(page.request, ticket.id);
  expect(agentView.aiAssist.map((item) => [item.id, item.source, item.faqQuestion, item.feedback, item.rating])).toEqual([[chip.suggestion!.id, "chip", "如何访问我的课程？", "helpful", 5]]);
  await context.close();
});

test("no answer: “None of these” submits at once, and No after a picked answer submits with that answer; the agent sees what the learner tried", async ({ browser }) => {
  const { context, page } = await newLearner(browser);
  const text = copy("en-GB");
  await openSupport(page);
  const first = `Account locked ${randomUUID().slice(0, 6)}`;
  await fillEnquiry(page, "en-GB", { category: "technical_support", subject: first, message: "My account will not open." });
  await page.getByRole("button", { name: text.submit }).click();
  const modal = page.getByRole("dialog", { name: text.assistant.title });
  await modal.getByRole("button", { name: text.assistant.noneOfThese }).click();
  await expect(page.getByRole("heading", { name: text.success.title })).toBeVisible();
  const [direct] = await learnerTickets(page);
  const directView = await agentTicket(page.request, direct.id);
  expect(directView.suggestionId).toBeNull();
  expect(directView.events.map((event) => event.type)).not.toContain("com.ilovelearningguide.helpdesk.ticket.suggestion_declined");

  await openSupport(page);
  const second = `Account still locked ${randomUUID().slice(0, 6)}`;
  await fillEnquiry(page, "en-GB", { category: "technical_support", subject: second, message: "My account will not open again." });
  await page.getByRole("button", { name: text.submit }).click();
  await modal.getByRole("list", { name: text.assistant.alternativesTitle }).getByRole("button", { name: "How do I reset my password?" }).click();
  await expect(modal.locator(".helpdesk-modal-answer-content strong").first()).toHaveText("Check your spam folder");
  await mkdir(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/portal-en-GB-v3-alternative-answer.png` });
  await modal.getByRole("button", { name: text.assistant.no }).click();
  await expect(page.getByRole("heading", { name: text.success.title })).toBeVisible();
  const ticket = (await learnerTickets(page)).find((item) => item.subject === second)!;
  const seen = await agentTicket(page.request, ticket.id);
  expect(seen.aiAssist.map((item) => [item.source, item.faqQuestion, item.feedback, item.rating])).toEqual([["chip", "How do I reset my password?", "not_helpful", null]]);
  expect(seen.aiAssist[0].answer).toContain("Check your spam folder");
  await context.close();
});

test("chat: a fallback reply shows the alternatives as chips; one asks like a starter chip and answers from the FAQ", async ({ browser }) => {
  const { context, page } = await newLearner(browser);
  const text = copy("en-GB");
  await openSupport(page);
  const panel = page.getByRole("region", { name: text.chat.title });
  const input = panel.getByRole("textbox", { name: text.chat.inputLabel });
  await input.fill("Something is wrong with my account");
  await input.press("Enter");
  const fallback = panel.locator(".helpdesk-chat-answer").first();
  // v5 Part B §3 (spec change): the softened copy that points at the alternatives.
  await expect(fallback.locator(".helpdesk-chat-fallback")).toHaveText(text.chat.fallbackAlternatives);
  const chips = fallback.getByRole("list", { name: text.chat.alternativesTitle }).getByRole("button");
  await expect(chips).toHaveText(["How do I reset my password?", "How do I access my courses?", "How can I access my course materials?"]);
  await chips.nth(1).click();
  const answer = panel.locator(".helpdesk-chat-answer").nth(1);
  await expect(answer).toContainText("You can find your enrolled courses in My Learning");
  await expect(panel.locator(".helpdesk-chat-question")).toHaveText(["Something is wrong with my account", "How do I access my courses?"]);
  await mkdir(SHOTS, { recursive: true });
  await panel.screenshot({ path: `${SHOTS}/portal-en-GB-v3-chat-alternatives.png` });
  await page.reload();
  await expect(panel.locator(".helpdesk-chat-answer").first().getByRole("list", { name: text.chat.alternativesTitle }).getByRole("button")).toHaveCount(3);
  await context.close();
});

test("rating API: the learner's own answered runs only, RFC 9457 errors; the agent's AI block carries the rating", async ({ browser }) => {
  const { context, page } = await newLearner(browser);
  const other = await newLearner(browser);
  const ask = async (data: Record<string, string>) => {
    const response = await page.request.post("/api/helpdesk/assistant", { headers: { "Idempotency-Key": randomUUID(), Origin: origin(page) }, data: { locale: "en-GB", ...data } });
    expect(response.status()).toBe(200);
    return await response.json() as { id: string; reply: unknown; alternatives: { faqId: string; question: string }[] };
  };
  const fallback = await ask({ message: "My account is acting up" });
  expect(fallback.reply).toBeNull();
  expect(fallback.alternatives.length).toBe(3);
  const answered = await ask({ message: fallback.alternatives[0].question, faqId: fallback.alternatives[0].faqId });
  expect((await rateByApi(other.page, answered.id, 5)).status(), "someone else's answer").toBe(404);
  expect((await rateByApi(page, fallback.id, 5)).status(), "a fallback has no answer to rate").toBe(404);
  const invalid = await rateByApi(page, answered.id, 9);
  expect(invalid.status()).toBe(400);
  expect(await invalid.json()).toMatchObject({ code: "validation_failed", field: "rating" });
  const unsigned = await page.request.post(`/api/helpdesk/assistant/${answered.id}/rating`, { headers: { Origin: origin(page) }, data: { rating: 5 } });
  expect(unsigned.status()).toBe(400);
  expect((await unsigned.json()).code).toBe("idempotency_key_required");
  const rated = await rateByApi(page, answered.id, 5);
  expect(rated.status()).toBe(200);
  expect(await rated.json()).toEqual({ id: answered.id, rating: 5 });
  const response = await page.request.post("/api/helpdesk/tickets", {
    headers: { "Idempotency-Key": randomUUID(), Origin: origin(page) },
    multipart: { category: "technical_support", subject: "Rated answer", body: "Linking the rated answer.", locale: "en-GB", assistIds: answered.id }
  });
  expect(response.status()).toBe(201);
  const { id } = await response.json() as { id: string };
  const seen = await agentTicket(page.request, id);
  expect(seen.aiAssist.map((item) => [item.id, item.rating])).toEqual([[answered.id, 5]]);
  await other.context.close();
  await context.close();
});

/** v4 Part A: a paid demo order of the signed-in learner (the payment module's own demo checkout; nothing about payment changes). */
async function demoOrder(page: Page) {
  const consents = { renewal: true, terms: true, refund: true };
  const quote = await page.request.post("/api/purchase/quote", { data: { planId: "epicureanism-pc-6", kind: "purchase" } });
  expect(quote.status()).toBe(200);
  const checkout = await page.request.post("/api/purchase/checkout", { headers: { Origin: origin(page) }, data: { quoteId: (await quote.json()).quote.id, locale: "en-GB", consents } });
  expect(checkout.status(), await checkout.text()).toBe(200);
  const orderId = (await checkout.json()).order.id as string;
  const completed = await page.request.post("/api/purchase/demo/confirm", { headers: { Origin: origin(page) }, data: { orderId, action: "complete" } });
  expect(completed.status()).toBe(200);
  return orderId;
}

test("v4 order entry: Contact support on a payment record carries the order; the agent sees the order projection; another learner's order is refused", async ({ browser }) => {
  for (const locale of ["en-GB", "zh-CN"] as const) {
    const { context, page } = await newLearner(browser, locale);
    await page.goto(`/${locale}/account/my-learning`);
    const orderId = await demoOrder(page);
    const records = getMessages(locale).subscriptionDesign;
    const text = copy(locale);
    // My Learning > Subscription: every payment record shown has "Contact support" for its order.
    await page.goto(`/${locale}/account/my-learning/subscription`);
    await page.getByRole("button", { name: records.paymentHistory }).first().click();
    const link = page.getByRole("link", { name: records.contactSupportLabel.replace("{number}", orderId), exact: true });
    await expect(link).toHaveText(records.contactSupport);
    await expect(page.locator("a[data-contact-support]")).toHaveCount(await page.locator("table tbody tr").count());
    await link.click();
    await page.waitForURL(`**/${locale}/account/my-learning/support?orderId=${orderId}`);
    // Contact Support: Payments & Subscriptions preset, the read-only order line above Subject with Remove.
    await expect(page.locator(".helpdesk-select-trigger")).toHaveText(text.categories.payments_subscriptions);
    const line = page.getByRole("group", { name: text.order.label, exact: true });
    await expect(line).toContainText(orderId);
    await expect(line.getByRole("button", { name: fillTemplate(text.order.removeLabel, { number: orderId }), exact: true })).toBeVisible();
    await mkdir(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/v4-order-line-${locale}.png`, fullPage: true });
    const subject = `Refund please ${randomUUID().slice(0, 6)}`;
    await page.getByLabel(text.subject).fill(subject);
    await page.getByLabel(text.message).fill("I was charged twice for the same plan.");
    await page.getByRole("button", { name: text.submit }).click();
    await expect(page.getByRole("heading", { name: text.success.title })).toBeVisible();
    // The AI check never saw the order.
    const { suggestions } = await (await page.request.get(`${helpdeskAdminStubUrl()}/__suggestions`)).json() as { suggestions: { request: Record<string, unknown> }[] };
    const asked = suggestions.filter((entry) => entry.request.subject === subject);
    expect(asked).toHaveLength(1);
    expect(JSON.stringify(asked[0].request)).not.toContain(orderId);
    expect(JSON.stringify(asked[0].request)).not.toMatch(/order/i);
    // BackOffice (integration API): orderId on the list, the projection with only the listed fields on the detail.
    const ticket = (await learnerTickets(page)).find((item) => item.subject === subject)!;
    const listed = (await (await page.request.get(`/api/integration/helpdesk/tickets?q=${encodeURIComponent(subject)}`, { headers: bearer })).json() as { tickets: { id: string; orderId: string | null }[] }).tickets;
    expect(listed.find((item) => item.id === ticket.id)?.orderId).toBe(orderId);
    const detail = await (await page.request.get(`/api/integration/helpdesk/tickets/${ticket.id}`, { headers: bearer })).json() as { orderId: string; order: Record<string, unknown>; category: string };
    expect(detail.category).toBe("payments_subscriptions");
    expect(detail.orderId).toBe(orderId);
    expect(Object.keys(detail.order)).toEqual(["id", "status", "amount", "currency", "planName", "kind", "createdAt", "paymentMode"]);
    expect(detail.order).toMatchObject({ id: orderId, status: "paid", kind: "purchase", paymentMode: "demo", currency: "usd" });
    expect(typeof detail.order.amount).toBe("number");

    // Another learner can neither see nor attach this order. (Final review: the page says the order could not be
    // attached, never why, and keeps Payments & Subscriptions; before, it opened a silent plain form on Technical Support.)
    const other = await newLearner(browser, locale, "Other Learner");
    await other.page.goto(`/${locale}/account/my-learning/support?orderId=${orderId}`);
    await expect(other.page.getByRole("heading", { level: 1, name: text.pageTitle })).toBeVisible();
    const notice = other.page.getByRole("group", { name: text.order.label, exact: true });
    await expect(notice).toHaveText(`${text.order.label}${text.order.unavailable}`);
    await expect(notice.getByRole("button")).toHaveCount(0);
    await expect(other.page.getByText(orderId)).toHaveCount(0);
    await expect(other.page.locator(".helpdesk-select-trigger")).toHaveText(text.categories.payments_subscriptions);
    const refused = await other.page.request.post("/api/helpdesk/tickets", {
      headers: { "Idempotency-Key": randomUUID(), Origin: origin(other.page) },
      multipart: { category: "payments_subscriptions", subject: "Not my order", body: "Trying someone else's order.", locale, orderId }
    });
    expect(refused.status()).toBe(400);
    expect(await refused.json()).toMatchObject({ code: "validation_failed", field: "orderId" });
    expect(await learnerTickets(other.page)).toHaveLength(0);
    await other.context.close();
    await context.close();
  }
});

test("v4 order entry: signed out, Contact support for an order goes through sign-in and back to the same order", async ({ browser }) => {
  const visitor = await browser.newContext({ locale: "zh-CN" });
  const page = await visitor.newPage();
  const orderId = "order_1761720000000_a1b2c3d4";
  await page.goto(`/zh-CN/account/my-learning/support?orderId=${orderId}`);
  await page.waitForURL(/\/zh-CN\/portal\/sign-in\?returnTo=/);
  expect(new URL(page.url()).searchParams.get("returnTo")).toBe(`/zh-CN/account/my-learning/support?orderId=${orderId}`);
  await page.goto("/en-GB/account/my-learning/support?orderId=%3Cscript%3E");
  await page.waitForURL(/\/en-GB\/portal\/sign-in\?returnTo=/);
  expect(new URL(page.url()).searchParams.get("returnTo")).toBe("/en-GB/account/my-learning/support");
  await visitor.close();
});

test("v4 order entry: Remove sends the enquiry without the order", async ({ browser }) => {
  const { context, page } = await newLearner(browser);
  await page.goto("/en-GB/account/my-learning");
  const orderId = await demoOrder(page);
  const text = copy("en-GB");
  await page.goto(`/en-GB/account/my-learning/support?orderId=${orderId}`);
  await page.getByRole("button", { name: fillTemplate(text.order.removeLabel, { number: orderId }), exact: true }).click();
  await expect(page.getByRole("group", { name: text.order.label, exact: true })).toHaveCount(0);
  await expect(page.getByLabel(text.subject)).toBeFocused();
  const subject = `No order after all ${randomUUID().slice(0, 6)}`;
  await page.getByLabel(text.subject).fill(subject);
  await page.getByLabel(text.message).fill("Something else.");
  await page.getByRole("button", { name: text.submit }).click();
  await expect(page.getByRole("heading", { name: text.success.title })).toBeVisible();
  const ticket = (await learnerTickets(page)).find((item) => item.subject === subject)!;
  const detail = await (await page.request.get(`/api/integration/helpdesk/tickets/${ticket.id}`, { headers: bearer })).json() as { orderId: string | null; order: unknown };
  expect(detail.orderId).toBeNull();
  expect(detail.order).toBeNull();
  await context.close();
});

test("visual capture for Figma comparison (en-GB and zh-CN)", async ({ browser }) => {
  await mkdir(SHOTS, { recursive: true });
  for (const locale of ["en-GB", "zh-CN"] as const) {
    const text = copy(locale);
    const { context, page } = await newLearner(browser, locale, locale === "en-GB" ? "Emily Carter" : "陈艾米");
    await openSupport(page, locale);
    await expect(page.getByRole("region", { name: text.chat.title })).toBeVisible();
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

test("visual capture v2: Contact Support with the chat panel (1216:6) and the Help Centre (1387:2), en-GB and zh-CN", async ({ browser }) => {
  await mkdir(SHOTS, { recursive: true });
  for (const locale of ["en-GB", "zh-CN"] as const) {
    const text = copy(locale);
    // Figma example data: the learner Daniel Wu asks how to access course materials and finds the answer helpful.
    const { context, page } = await newLearner(browser, locale, locale === "en-GB" ? "Daniel Wu" : "吴丹尼");
    await openSupport(page, locale);
    await page.getByLabel(text.email).fill("daniel.wu@example.com");
    const panel = page.getByRole("region", { name: text.chat.title });
    const input = panel.getByRole("textbox", { name: text.chat.inputLabel });
    await input.fill(locale === "en-GB" ? "How can I access course materials?" : "如何访问课程资料？");
    await input.press("Enter");
    const answer = panel.locator(".helpdesk-chat-answer").first();
    await answer.getByRole("button", { name: text.chat.yes, exact: true }).click();
    await expect(answer.getByRole("button", { name: text.chat.yes, exact: true })).toHaveAttribute("aria-pressed", "true");
    // v5 Part C / H (待视觉验收): the panel with the three-part answer and the polish, for the visual check.
    await panel.screenshot({ path: `${SHOTS}/v5-chat-panel-${locale}.png` });
    await page.getByRole("combobox", { name: text.enquiryType }).click();
    await page.mouse.move(0, 0);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${SHOTS}/app-1216-6-${locale}.png` });
    await page.goto(`/${locale}/help`);
    await expect(page.locator(".help-centre-article")).toHaveCount(6);
    await page.screenshot({ path: `${SHOTS}/app-1387-2-${locale}.png` });
    await context.close();
  }
});

test("v4 chat handover: asking for a person is still asked; the answer card comes first and the handover card ends the reply; its button opens the form and the enquiry links the chat", async ({ browser }) => {
  for (const locale of ["en-GB", "zh-CN"] as const) {
    const { context, page } = await newLearner(browser, locale);
    const text = copy(locale);
    await openSupport(page, locale);
    const learnerId = (await (await page.request.get("/api/auth/me")).json() as { user: { id: string } }).user.id;
    const panel = page.getByRole("region", { name: text.chat.title });
    const input = panel.getByRole("textbox", { name: text.chat.inputLabel });
    const first = locale === "zh-CN" ? "在哪里可以找到发票？" : "Where can I find my invoice?";
    await input.fill(first);
    await input.press("Enter");
    await expect(panel.locator(".helpdesk-chat-answer .helpdesk-chat-answer-text")).toHaveCount(1);
    // The request also names the invoice: owner 2026-10-30, the handover card only adds, so the invoice answer shows too.
    const request = locale === "zh-CN" ? "我要投诉，发票不对" : "I want to SPEAK TO SOMEONE about my invoice";
    await input.fill(request);
    await input.press("Enter");
    const card = panel.getByRole("group", { name: text.chat.handoverTitle, exact: true });
    await expect(card).toBeVisible();
    await expect(card).toContainText(text.chat.handoverBody);
    await expect(panel.locator(".helpdesk-chat-question")).toHaveText([first, request]);
    await expect(panel.locator(".helpdesk-chat-answer .helpdesk-chat-answer-text")).toHaveCount(2);
    await expect(panel.locator("[data-entry]").last().locator(".helpdesk-chat-card-handover"), "the handover card ends the reply").toHaveCount(1);
    const { suggestions } = await (await page.request.get(`${helpdeskAdminStubUrl()}/__suggestions`)).json() as { suggestions: { request: { learnerId?: string; message?: string } }[] };
    expect(suggestions.filter((entry) => entry.request.learnerId === learnerId).map((entry) => entry.request.message), "the request for a person is still asked").toEqual([first, request]);
    await expect(input).toBeEnabled();
    await expect(panel.locator(".helpdesk-chat-info")).toBeVisible();
    await mkdir(SHOTS, { recursive: true });
    await panel.screenshot({ path: `${SHOTS}/v4-chat-handover-${locale}.png` });
    // The card opens Contact Support (the form on this page); the enquiry carries the chat's history.
    await card.getByRole("button", { name: text.chat.handoverButton, exact: true }).click();
    await expect(page.getByLabel(text.subject)).toBeFocused();
    const subject = `Need a person ${randomUUID().slice(0, 6)}`;
    await fillEnquiry(page, locale, { category: "other", subject, message: "Please call me back." });
    await page.getByRole("button", { name: text.submit }).click();
    await expect(page.getByRole("heading", { name: text.success.title })).toBeVisible();
    const ticket = (await learnerTickets(page)).find((item) => item.subject === subject)!;
    const seen = await agentTicket(page.request, ticket.id);
    expect(seen.aiAssist.map((item) => [item.source, item.question])).toEqual([["chat", first], ["chat", request]]);
    await context.close();
  }
});

// ---- Helpdesk v5 (helpdesk-v5-context-chips-and-smalltalk.md, helpdesk-v5-faq-graph-design.md). The stub Admin has a
// published release for zh-CN (a choice node, a 3-level follow-up chain, a shared node) and none for en-GB, so both the
// release path (clicks answered by Portal from its cached copy) and the per-FAQ path run. New states: 待视觉验收.

async function learnerIdOf(page: Page) {
  return (await (await page.request.get("/api/auth/me")).json() as { user: { id: string } }).user.id;
}

/** What Admin's suggest was asked for this learner (the stub records every request). */
async function suggestCalls(page: Page, learnerId: string) {
  const { suggestions } = await (await page.request.get(`${helpdeskAdminStubUrl()}/__suggestions`)).json() as { suggestions: { request: { learnerId?: string; message?: string; source?: string; context?: unknown } }[] };
  return suggestions.filter((entry) => entry.request.learnerId === learnerId);
}

test("v5 small talk: “你好” shows a reply bubble and the situation chips, never the fallback; “谢谢” after an answer shows the rating card", async ({ browser }) => {
  const { context, page } = await newLearner(browser, "zh-CN");
  const text = copy("zh-CN");
  await openSupport(page, "zh-CN");
  const panel = page.getByRole("region", { name: text.chat.title });
  await expect(panel.locator(".helpdesk-chat-greeting-title")).toHaveText(text.chat.greetingTitle);
  await expect(panel.getByRole("list", { name: text.chat.tryAsking }).locator(".helpdesk-chat-chip")).toHaveText(["如何重置密码？", "如何访问我的课程资料？", "如何更改我的订阅？"]);
  const input = panel.getByRole("textbox", { name: text.chat.inputLabel });
  await input.fill("你好");
  await input.press("Enter");
  const hello = panel.locator(".helpdesk-chat-answer").first();
  await expect(hello.locator(".helpdesk-chat-reply")).toHaveText("你好呀！想了解哪方面的问题？");
  await expect(hello.getByRole("list", { name: text.chat.tryAsking }).locator(".helpdesk-chat-chip")).toHaveCount(3);
  await expect(hello.locator(".helpdesk-chat-fallback")).toHaveCount(0);
  await expect(panel).not.toContainText(text.chat.fallback);
  await expect(panel).not.toContainText(text.chat.fallbackAlternatives);
  const learnerId = await learnerIdOf(page);
  const [greeting] = await suggestCalls(page, learnerId);
  expect(greeting.request.context, "the context goes with every typed question").toMatchObject({ sessionId: expect.any(String) });
  // The session's signals and order data never go to Admin; contract v7 adds only the coarse learner state (no ids, no contact data).
  const { learnerState, ...rest } = greeting.request.context as { learnerState?: unknown } & Record<string, unknown>;
  expect(JSON.stringify(rest)).not.toMatch(/order|signal|payment/i);
  expect(JSON.stringify(learnerState ?? {})).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-|@|signal/i);
  await input.fill("在哪里可以找到发票？");
  await input.press("Enter");
  await expect(panel.locator(".helpdesk-chat-answer").nth(1).locator(".helpdesk-chat-excerpt li")).toHaveText(["打开我的订阅", "选择记录"]);
  await input.fill("谢谢");
  await input.press("Enter");
  await expect(panel.locator(".helpdesk-chat-answer").nth(2).locator(".helpdesk-chat-reply")).toHaveText("不客气！有问题随时再来问我。");
  const card = panel.getByRole("group", { name: text.assistant.rateTitle, exact: true });
  await expect(card).toBeVisible();
  await expect(panel.locator(".helpdesk-chat-ended")).toHaveCount(0);
  await mkdir(SHOTS, { recursive: true });
  await panel.screenshot({ path: `${SHOTS}/v5-chat-smalltalk-rating-zh-CN.png` });
  await card.getByRole("button", { name: fillTemplate(text.assistant.rateStar, { n: 5 }), exact: true }).click();
  await expect(panel.locator(".helpdesk-chat-rated")).toHaveText(text.assistant.rated);
  await context.close();
});

test("v5 situation chips: a learner whose latest payment failed sees the payment chip first, in both locales", async ({ browser }) => {
  for (const locale of ["en-GB", "zh-CN"] as const) {
    const { context, page } = await newLearner(browser, locale);
    const text = copy(locale);
    await page.goto(`/${locale}/account/my-learning`);
    const quote = await page.request.post("/api/purchase/quote", { data: { planId: "epicureanism-pc-6", kind: "purchase" } });
    const checkout = await page.request.post("/api/purchase/checkout", { headers: { Origin: origin(page) }, data: { quoteId: (await quote.json()).quote.id, locale, consents: { renewal: true, terms: true, refund: true } } });
    expect(checkout.status()).toBe(200);
    const failed = await page.request.post("/api/purchase/demo/confirm", { headers: { Origin: origin(page) }, data: { orderId: (await checkout.json()).order.id, action: "fail" } });
    expect((await failed.json()).status).toBe("failed");
    await openSupport(page, locale);
    const panel = page.getByRole("region", { name: text.chat.title });
    const chips = panel.getByRole("list", { name: text.chat.situationTitle }).locator(".helpdesk-chat-chip");
    await expect(chips.first()).toHaveText(locale === "zh-CN" ? "为什么我的付款失败了？" : "Why did my payment fail?");
    await expect(chips).toHaveCount(3);
    // The chip text is the FAQ question: no amount, order number or date of the learner's.
    await expect(panel.locator(".helpdesk-chat-chips")).not.toContainText(/\d/);
    await mkdir(SHOTS, { recursive: true });
    await panel.screenshot({ path: `${SHOTS}/v5-chat-situation-chips-${locale}.png` });
    await chips.first().click();
    await expect(panel.locator(".helpdesk-chat-answer").first().locator(".helpdesk-chat-excerpt")).toContainText(locale === "zh-CN" ? "查看常见的付款问题" : "Check common payment issues");
    await context.close();
  }
});

test("v5 three-part answer: opening, the picked blocks quoted with their source, closing and a follow-up; “查看完整答案” opens the whole card in place and is logged", async ({ browser }) => {
  const { context, page } = await newLearner(browser, "zh-CN");
  const text = copy("zh-CN");
  await openSupport(page, "zh-CN");
  const panel = page.getByRole("region", { name: text.chat.title });
  const input = panel.getByRole("textbox", { name: text.chat.inputLabel });
  await input.fill("我付款成功了，但是课程没开通");
  await input.press("Enter");
  const answer = panel.locator(".helpdesk-chat-answer").first();
  await expect(answer.locator(".helpdesk-chat-opening")).toHaveText("别着急，这个问题可以这样处理：");
  const quoted = answer.locator("blockquote.helpdesk-chat-excerpt");
  await expect(quoted.locator("li")).toHaveText(["退出登录后重新登录，让账号重新读取你的订阅状态", "打开我的学习，查看课程是否已经出现在你的课程列表里"]);
  await expect(quoted).toContainText("仍然没有开通？");
  await expect(quoted).not.toContainText("银行确认扣款");
  await expect(quoted.getByRole("link", { name: fillTemplate(text.chat.relatedFaq, { question: "付款成功但没有开通" }), exact: true })).toBeVisible();
  await expect(answer.locator(".helpdesk-chat-closing")).toHaveText("按上面试一下，还不行就告诉我。");
  await expect(answer.getByRole("list", { name: text.chat.followUpsTitle }).getByRole("button")).toHaveText(["还是不行，怎么联系客服？"]);
  const order = await answer.evaluate((node) => [...node.children].map((child) => child.className.split(" ")[0]));
  expect(order.slice(0, 3)).toEqual(["helpdesk-chat-opening", "helpdesk-chat-excerpt", "helpdesk-chat-closing"]);
  await mkdir(SHOTS, { recursive: true });
  await panel.screenshot({ path: `${SHOTS}/v5-chat-three-part-zh-CN.png` });
  const logged = page.waitForResponse((response) => /\/api\/helpdesk\/assistant\/[^/]+\/expanded$/.test(new URL(response.url()).pathname));
  await quoted.getByRole("button", { name: text.chat.showFull }).click();
  expect((await logged).status()).toBe(200);
  await expect(quoted).toContainText("银行确认扣款");
  await expect(quoted).toContainText("请联系客服并附上订单号");
  await expect(quoted.getByRole("button", { name: text.chat.showLess })).toHaveAttribute("aria-expanded", "true");
  await panel.screenshot({ path: `${SHOTS}/v5-chat-three-part-expanded-zh-CN.png` });
  await context.close();
});

test("v5 FAQ tree: a 3-level follow-up chain and an A/B/C/D choice are walked by clicks that never reach Admin's suggest", async ({ browser }) => {
  const { context, page } = await newLearner(browser, "zh-CN");
  const text = copy("zh-CN");
  await openSupport(page, "zh-CN");
  const learnerId = await learnerIdOf(page);
  const panel = page.getByRole("region", { name: text.chat.title });
  const answers = panel.locator(".helpdesk-chat-answer");
  // The chain: a chip, then three follow-ups deep (the last one a shared node).
  await panel.getByRole("list", { name: text.chat.tryAsking }).getByRole("button", { name: "如何重置密码？" }).click();
  await expect(answers.first().locator(".helpdesk-chat-excerpt")).toContainText("检查垃圾邮件文件夹");
  for (const [index, label, body] of [[0, "收不到重置邮件怎么办？", "请先检查垃圾邮件文件夹"], [1, "换了邮箱还能找回账号吗？", "说明注册时使用的邮箱"], [2, "如何联系客服？", "客服团队会通过邮件回复你"]] as const) {
    const followUps = answers.nth(index).getByRole("list", { name: text.chat.followUpsTitle }).getByRole("button");
    await expect(followUps).toHaveText([label]);
    await followUps.first().click();
    await expect(answers.nth(index + 1).locator(".helpdesk-chat-excerpt")).toContainText(body);
  }
  await expect(panel.locator(".helpdesk-chat-question")).toHaveText(["如何重置密码？", "收不到重置邮件怎么办？", "换了邮箱还能找回账号吗？", "如何联系客服？"]);
  // Clicks use the fixed frame (no model line).
  await expect(answers.nth(3).locator(".helpdesk-chat-opening")).toHaveText("好的，这个问题可以这样处理：");
  await mkdir(SHOTS, { recursive: true });
  await panel.screenshot({ path: `${SHOTS}/v5-chat-follow-up-chain-zh-CN.png` });
  expect(await suggestCalls(page, learnerId), "every click was answered by Portal from the release").toHaveLength(0);
  // The choice: typed, unsure, so Admin shows the A/B/C/D node; the learner picks B.
  const input = panel.getByRole("textbox", { name: text.chat.inputLabel });
  await input.fill("付款有问题");
  await input.press("Enter");
  const choice = answers.nth(4);
  await expect(choice.locator(".helpdesk-chat-choice-prompt")).toHaveText("你遇到的是哪种情况？");
  const options = choice.getByRole("list", { name: "你遇到的是哪种情况？" }).getByRole("button");
  await expect(options).toHaveText(["A付款失败", "B扣款了但没开通", "C被重复扣款"]);
  await expect(choice.getByRole("button", { name: text.chat.yes })).toHaveCount(0);
  await panel.screenshot({ path: `${SHOTS}/v5-chat-choice-zh-CN.png` });
  await options.nth(1).click();
  const picked = answers.nth(5);
  await expect(picked.locator(".helpdesk-chat-excerpt")).toContainText("银行确认扣款");
  await expect(picked.getByRole("list", { name: text.chat.followUpsTitle }).getByRole("button")).toHaveText(["还是不行，怎么联系客服？"]);
  const asked = await suggestCalls(page, learnerId);
  expect(asked.map((entry) => entry.request.message), "only the typed question asked Admin").toEqual(["付款有问题"]);
  await context.close();
});
