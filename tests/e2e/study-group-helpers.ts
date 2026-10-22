import { expect, type Browser, type BrowserContext, type Page } from "playwright/test";

// Shared setup for the Study Group E2E specs (local only: docker LiveKit,
// tutor mock and SMTP sink from playwright.studygroup.config.ts).

export const PASSWORD = "Passw0rd!123";
export const PLAN_ID = "epicureanism-pc-6";
export const COURSE_ID = "epicureanism";
const CONSENTS = { renewal: true, terms: true, refund: true };
// The mock model answers "COURSE\nMock tutor reply: ..."; the tutor pipeline
// strips the mode-tag line, so the chat shows the remaining text.
export const MOCK_TUTOR_REPLY = "Mock tutor reply: the course text explains this topic.";
export const SMTP_SINK_MESSAGES = "http://127.0.0.1:8789/messages";

export type Member = { context: BrowserContext; email: string; nickname: string };

function freshEmail(side: string) {
  return `e2e-sg-${side}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
}

export async function register(context: BrowserContext, side: string, nickname: string) {
  const email = freshEmail(side);
  const registered = await context.request.post("/api/auth/register", {
    data: { termsAccepted: true, email, password: PASSWORD, nickname, locale: "en-GB" },
  });
  expect(registered.status(), "register").toBe(200);
  const loggedIn = await context.request.post("/api/auth/login", {
    data: { email, password: PASSWORD, rememberMe: false },
  });
  expect(loggedIn.status(), "login").toBe(200);
  return email;
}

export async function registerAndEntitle(context: BrowserContext, side: string, nickname: string, appOrigin: string) {
  const email = await register(context, side, nickname);
  const quote = await context.request.post("/api/subscription/quote", {
    data: { planId: PLAN_ID, kind: "trial" },
  });
  expect(quote.status(), "trial quote").toBe(200);
  // startPayment (services/paymentService.ts) requires the Origin header to
  // equal the request host origin; APIRequestContext does not send one.
  const trial = await context.request.post("/api/trial", {
    headers: { origin: appOrigin },
    data: { quoteId: (await quote.json()).quote.id, locale: "en-GB", consents: CONSENTS },
  });
  expect(trial.status(), "trial checkout").toBe(200);
  const confirmed = await context.request.post("/api/purchase/demo/confirm", {
    data: { orderId: (await trial.json()).order.id, action: "complete" },
  });
  expect(confirmed.status(), "demo confirm").toBe(200);
  return email;
}

// A signed-in learner with Course access (entitle: false leaves them without).
export async function newMember(browser: Browser, appOrigin: string, side: string, nickname: string, options: { initScript?: () => void; entitle?: boolean } = {}): Promise<Member> {
  const context = await browser.newContext({ baseURL: appOrigin, ignoreHTTPSErrors: true });
  if (options.initScript) await context.addInitScript(options.initScript);
  const email = options.entitle === false ? await register(context, side, nickname) : await registerAndEntitle(context, side, nickname, appOrigin);
  return { context, email, nickname };
}

export async function createGroup(member: Member, title: string, about = "Study Group QA regression E2E.") {
  const created = await member.context.request.post("/api/study-groups", { data: { title, courseId: COURSE_ID, about } });
  expect(created.status(), "create group").toBe(200);
  return (await created.json()).data.id as string;
}

export async function joinGroup(member: Member, groupId: string) {
  const joined = await member.context.request.post(`/api/study-groups/${encodeURIComponent(groupId)}/join`, { data: {} });
  expect(joined.status(), "join group").toBe(200);
}

export async function scheduleSession(host: Member, groupId: string, input: { title: string; startsInMs: number; maxParticipants?: number; aiTutorEnabled?: boolean; focus?: string }) {
  const scheduled = await host.context.request.post(`/api/study-groups/${encodeURIComponent(groupId)}/sessions`, {
    data: {
      title: input.title,
      startsAt: new Date(Date.now() + input.startsInMs).toISOString(),
      durationSeconds: 1800,
      maxParticipants: input.maxParticipants ?? 4,
      aiTutorEnabled: input.aiTutorEnabled ?? true,
      ...(input.focus ? { focus: input.focus } : {}),
    },
  });
  expect(scheduled.status(), "schedule session").toBe(200);
  return (await scheduled.json()).data.id as string;
}

export function enterSession(member: Member, sessionId: string) {
  return member.context.request.post(`/api/study-groups/sessions/${encodeURIComponent(sessionId)}/enter`, { data: {} });
}

export async function sessionView(member: Member, sessionId: string) {
  const response = await member.context.request.get(`/api/study-groups/sessions/${encodeURIComponent(sessionId)}`);
  expect(response.status(), "session view").toBe(200);
  return (await response.json()).data as { state: string; occupancy: number; completedAt?: string | null; startsAt: string; attendees: Array<{ userId: string; displayName: string }> };
}

export async function groupView(member: Member, groupId: string) {
  const response = await member.context.request.get(`/api/study-groups/${encodeURIComponent(groupId)}`);
  expect(response.status(), "group view").toBe(200);
  return (await response.json()).data as { sessions?: Array<{ id: string; title: string; state: string }>; memberCount: number };
}

// The page's own alerts. Next.js also renders a route announcer with
// role="alert" (empty, or the page title after a client navigation), which
// is not part of the app and must not count.
export function appAlerts(page: Page) {
  return page.locator('[role="alert"]:not(#__next-route-announcer__)');
}

export const roomPath = (sessionId: string) => `/en-GB/portal/study-groups/sessions/${sessionId}`;
export const groupPath = (groupId: string) => `/en-GB/portal/study-groups?group=${groupId}`;

// The tutor line renders as <article><div><strong>AI Tutor</strong>...</div><p>{reply}</p></article>.
// A user's own chat line uses a <span> for the "@AI Tutor" mention, so an exact
// <strong>AI Tutor</strong> identifies the tutor's line only.
export function tutorLine(page: Page) {
  return page.locator("article").filter({ has: page.locator('strong:text-is("AI Tutor")') }).locator("p");
}

// Asks the AI Tutor from the room's chat, the way a member does.
export async function askTutor(page: Page, question: string) {
  await page.getByRole("button", { name: "@AI Tutor", exact: true }).click();
  await page.getByRole("textbox", { name: "Chat" }).fill(question);
  await page.getByRole("button", { name: "Send", exact: true }).click();
}

export async function expectConnected(page: Page, participants: number) {
  await expect(page.getByRole("button", { name: "Share" })).toBeEnabled();
  await expect(page.locator(`[data-participants="${participants}"]`)).toBeVisible();
}

// Leave Session asks first (QA 2026-10-19 M15): click it, then confirm.
export async function leaveSession(page: Page) {
  await page.getByRole("button", { name: "Leave Session" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Yes, leave" }).click();
}

export type LiveRoom = { host: Member; member: Member; pageA: Page; pageB: Page; groupId: string; sessionId: string; close: () => Promise<void> };

// A live session with the Host (A) and one member (B) both connected to the
// LiveKit room: the starting point of every in-room regression.
export async function openLiveRoom(browser: Browser, appOrigin: string, label: string, options: { memberInitScript?: () => void; maxParticipants?: number; sessionTitle?: string; focus?: string } = {}): Promise<LiveRoom> {
  const host = await newMember(browser, appOrigin, `${label}-a`, "Study Host");
  const member = await newMember(browser, appOrigin, `${label}-b`, "Study Guest", { initScript: options.memberInitScript });
  const groupId = await createGroup(host, `E2E ${label}`);
  await joinGroup(member, groupId);
  const sessionId = await scheduleSession(host, groupId, { title: options.sessionTitle ?? `E2E ${label} session`, startsInMs: 90_000, maxParticipants: options.maxParticipants, focus: options.focus });
  for (const [who, person] of [["b", member], ["a", host]] as const) {
    expect((await enterSession(person, sessionId)).status(), `enter ${who}`).toBe(200);
  }
  const pageB = await member.context.newPage();
  const pageA = await host.context.newPage();
  await pageB.goto(roomPath(sessionId));
  await expect(pageB.getByText("Waiting for the host to start the session...")).toBeVisible();
  await pageA.goto(roomPath(sessionId));
  await pageA.getByRole("button", { name: "Start Live Session" }).click();
  await expectConnected(pageA, 2);
  await expectConnected(pageB, 2);
  return {
    host, member, pageA, pageB, groupId, sessionId,
    close: async () => {
      await host.context.close();
      await member.context.close();
    },
  };
}
