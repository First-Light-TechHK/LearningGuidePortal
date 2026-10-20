import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "playwright/test";
import {
  appAlerts,
  askTutor,
  createGroup,
  enterSession,
  expectConnected,
  groupPath,
  groupView,
  joinGroup,
  leaveSession,
  MOCK_TUTOR_REPLY,
  newMember,
  openLiveRoom,
  roomPath,
  scheduleSession,
  sessionView,
  SMTP_SINK_MESSAGES,
  tutorLine,
  type Member,
} from "./study-group-helpers";

// One regression lock per problem in the SG / AI Tutor QA report of
// 2026-10-19 (lg-qa/sg-tutor-qa-2026-10-19.md): section 一 (BUG-0125,
// BUG-0108's side effects, BUG-0099) and the important items N1-N13, plus the
// minor items fixed with them (M6, M10, M15, M16, M21). Each test is named
// after the item it locks.

test.skip(Boolean(process.env.CI), "local-only Study Group E2E; CI does not run e2e");

// Seat lease (modules/group-study/presence.ts): 30 s lease, a live session
// empty for 60 s ends, and the dev server sweeps every 15 s.
const LEASE_MS = 30_000;
const LEASE_SLACK_MS = 25_000;

function appOrigin(baseURL: string | undefined) {
  return baseURL || "http://127.0.0.1:3013";
}

function unique(label: string) {
  return `${label} ${Date.now().toString(36)}`;
}

async function openGroupPage(member: Member, groupId: string) {
  const page = await member.context.newPage();
  await page.goto(groupPath(groupId));
  return page;
}

// The in-app notifications the dev server stored for a user (local file
// store: data/knowledge_system/learning_guide/product.json).
async function notificationsFor(email: string) {
  const file = path.join(process.cwd(), "data", "knowledge_system", "learning_guide", "product.json");
  for (let attempt = 0; ; attempt += 1) {
    try {
      const data = JSON.parse(await readFile(file, "utf8")) as { users: Array<{ id: string; email: string }>; notifications: Array<{ userId: string; title: string; body: string }> };
      const user = data.users.find((item) => item.email === email);
      return user ? data.notifications.filter((item) => item.userId === user.id) : [];
    } catch (error) {
      // The server may be rewriting the file at this moment.
      if (attempt >= 5) throw error;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
}

async function mailTo(email: string) {
  const response = await fetch(SMTP_SINK_MESSAGES);
  const messages = await response.json() as Array<{ to: string[]; raw: string }>;
  return messages.filter((message) => message.to.includes(email.toLowerCase()));
}

async function remindersFor(member: Member) {
  const response = await member.context.request.get("/api/study-groups?view=reminders");
  expect(response.status(), "reminders view").toBe(200);
  return ((await response.json()).data as Array<{ body: string }>).map((item) => item.body);
}

// Fails if the room shows its connection banner (the one with Reconnect):
// an AI Tutor or poll failure must never put it up (QA N4).
async function expectNoRoomBanner(page: Page) {
  await expect(page.getByRole("button", { name: "Reconnect" })).toHaveCount(0);
}

test("BUG-0125: edit group, schedule and edit session show the page's own message, never the browser bubble", async ({ browser, baseURL }) => {
  const origin = appOrigin(baseURL);
  const host = await newMember(browser, origin, "0125", "Study Host");
  try {
    const groupId = await createGroup(host, unique("E2E BUG-0125"));
    await scheduleSession(host, groupId, { title: "Upcoming session", startsInMs: 3 * 60 * 60_000 });
    const page = await openGroupPage(host, groupId);
    const writes: string[] = [];
    page.on("request", (request) => { if (request.method() !== "GET" && request.url().includes("/api/study-groups")) writes.push(`${request.method()} ${request.url()}`); });
    const dialog = page.getByRole("dialog");

    // Edit Group with an empty title.
    await page.getByRole("button", { name: "Edit Group" }).click();
    await dialog.locator('input[name="title"]').fill("");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("Check the required fields and try again.");
    expect(await dialog.locator("form").evaluate((form: HTMLFormElement) => form.noValidate), "the form never asks the browser to validate").toBe(true);
    await dialog.getByRole("button", { name: "Cancel" }).click();

    // Schedule Live Session with nothing filled in.
    await page.getByRole("button", { name: "Schedule Live Session" }).click();
    await dialog.getByRole("button", { name: "Schedule Session" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("Check the required fields and try again.");
    await dialog.getByRole("button", { name: "Cancel" }).click();

    // Edit Session: an empty Start Time, then a Start Time already past.
    await page.getByRole("button", { name: "Edit Session" }).click();
    await dialog.locator('input[name="time"]').fill("");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("Check the required fields and try again.");
    const now = new Date();
    if (now.getHours() > 0 || now.getMinutes() > 1) {
      const pad = (value: number) => String(value).padStart(2, "0");
      await dialog.locator('input[name="date"]').fill(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`);
      await dialog.locator('input[name="time"]').fill("00:00");
      await dialog.getByRole("button", { name: "Save" }).click();
      await expect(dialog.getByRole("alert")).toHaveText("Start Time must be in the future.");
    }
    expect(writes, "an invalid form is never sent").toEqual([]);
  } finally {
    await host.context.close();
  }
});

test("BUG-0099 / M16: cancel group, cancel session and leave group ask with Go back / Yes, …", async ({ browser, baseURL }) => {
  const origin = appOrigin(baseURL);
  const host = await newMember(browser, origin, "0099-a", "Study Host");
  const member = await newMember(browser, origin, "0099-b", "Study Guest");
  try {
    const title = unique("E2E BUG-0099");
    const groupId = await createGroup(host, title);
    await joinGroup(member, groupId);
    await scheduleSession(host, groupId, { title: "Session to cancel", startsInMs: 3 * 60 * 60_000 });
    const page = await openGroupPage(host, groupId);
    const dialog = page.getByRole("dialog");

    // Cancel Session: Go back keeps it, Yes removes it.
    await page.getByRole("button", { name: "Cancel Session" }).click();
    await expect(dialog.getByRole("heading")).toHaveText("Cancel this Live Session?");
    await dialog.getByRole("button", { name: "Go back" }).click();
    await expect(page.getByRole("heading", { name: "Session to cancel" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel Session" }).click();
    await dialog.getByRole("button", { name: "Yes, cancel session" }).click();
    await expect(page.getByRole("heading", { name: "Session to cancel" })).toHaveCount(0);

    // Leave Study Group (member side) asks first as well.
    const memberPage = await openGroupPage(member, groupId);
    await memberPage.getByRole("button", { name: "Leave Study Group" }).click();
    await expect(memberPage.getByRole("dialog").getByRole("heading")).toHaveText("Leave this Study Group?");
    await memberPage.getByRole("dialog").getByRole("button", { name: "Go back" }).click();
    await expect(memberPage.getByRole("button", { name: "Leave Study Group" })).toBeVisible();

    // Cancel Group: the two buttons can no longer be mistaken for each other.
    await page.getByRole("button", { name: "Cancel Group" }).click();
    await expect(dialog.getByRole("heading")).toHaveText("Cancel this Study Group?");
    await expect(dialog.getByRole("button")).toHaveText(["Go back", "Yes, cancel group"]);
    await dialog.getByRole("button", { name: "Go back" }).click();
    await expect(page.getByRole("heading", { level: 2, name: title })).toBeVisible();
    await page.getByRole("button", { name: "Cancel Group" }).click();
    await dialog.getByRole("button", { name: "Yes, cancel group" }).click();
    await expect(page.getByRole("heading", { name: title })).toHaveCount(0);
    // A few list and group polls later it has not come back.
    await page.waitForTimeout(7_000);
    await expect(page.getByRole("button", { name: new RegExp(title) })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: title })).toHaveCount(0);
  } finally {
    await host.context.close();
    await member.context.close();
  }
});

test("BUG-0108 side effect: the last person closing the page ends the live session, dated to when it emptied", async ({ browser, baseURL }) => {
  test.setTimeout(300_000);
  const room = await openLiveRoom(browser, appOrigin(baseURL), "0108-live");
  try {
    await leaveSession(room.pageA);
    await expect(room.pageB.locator('[data-participants="1"]')).toBeVisible();
    const closedAt = Date.now();
    await room.pageB.close();
    // Right after the close the session is still live (a refresh must come back to it).
    expect((await sessionView(room.host, room.sessionId)).state).toBe("live");
    await expect.poll(async () => (await sessionView(room.host, room.sessionId)).state, { timeout: 200_000, intervals: [5_000] }).toBe("completed");
    const completedAt = (await sessionView(room.host, room.sessionId)).completedAt;
    if (completedAt) {
      const ended = Date.parse(completedAt);
      expect(ended, "ended when the last seat lapsed, not when the sweep noticed").toBeLessThanOrEqual(closedAt + LEASE_MS + LEASE_SLACK_MS);
      expect(ended).toBeGreaterThanOrEqual(closedAt - 1_000);
    }
  } finally {
    await room.close();
  }
});

test("BUG-0108 side effect: a seat taken while Starting Soon is freed one lease after the page closes", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const origin = appOrigin(baseURL);
  const host = await newMember(browser, origin, "0108-soon-a", "Study Host");
  const member = await newMember(browser, origin, "0108-soon-b", "Study Guest");
  try {
    const groupId = await createGroup(host, unique("E2E 0108 soon"));
    await joinGroup(member, groupId);
    const sessionId = await scheduleSession(host, groupId, { title: "Starting soon seat", startsInMs: 5 * 60_000 });
    const page = await openGroupPage(member, groupId);
    await page.getByRole("button", { name: "Join now" }).click();
    await expect(page.getByText("Waiting for the host to start the session...")).toBeVisible();
    expect((await sessionView(host, sessionId)).occupancy).toBe(1);
    // While the waiting dialog is open its heartbeat keeps the seat past one lease.
    await page.waitForTimeout(LEASE_MS + 10_000);
    expect((await sessionView(host, sessionId)).occupancy, "an open waiting dialog keeps its seat").toBe(1);
    await page.close();
    await expect.poll(async () => (await sessionView(host, sessionId)).occupancy, { timeout: LEASE_MS + 40_000, intervals: [3_000] }).toBe(0);
  } finally {
    await host.context.close();
    await member.context.close();
  }
});

test("N3: closing a tab frees that seat for everyone else; the session stays live while someone remains", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const room = await openLiveRoom(browser, appOrigin(baseURL), "n3");
  try {
    await room.pageB.close();
    await expect(room.pageA.locator('[data-participants="1"]')).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => (await sessionView(room.host, room.sessionId)).occupancy, { timeout: LEASE_MS + 40_000, intervals: [3_000] }).toBe(1);
    // Well past the empty-session grace: still live, because the Host is there.
    await room.pageA.waitForTimeout(70_000);
    expect((await sessionView(room.host, room.sessionId)).state).toBe("live");
    await expectConnected(room.pageA, 1);
  } finally {
    await room.close();
  }
});

test("M15: following the breadcrumb out of the room does not end the session on the spot", async ({ browser, baseURL }) => {
  const room = await openLiveRoom(browser, appOrigin(baseURL), "m15");
  try {
    await leaveSession(room.pageA);
    await expect(room.pageB.locator('[data-participants="1"]')).toBeVisible();
    await room.pageB.getByRole("navigation", { name: "Study Group" }).getByRole("button", { name: "Study Group Info" }).click();
    await room.pageB.waitForURL(/\/portal\/study-groups\?group=/);
    expect((await sessionView(room.host, room.sessionId)).state).toBe("live");
    // Coming back inside the lease lands in the same live session.
    await room.pageB.goto(roomPath(room.sessionId));
    await expectConnected(room.pageB, 1);
  } finally {
    await room.close();
  }
});

test("N1: a network drop recovers on its own, also when it outlasts the seat lease", async ({ browser, baseURL }) => {
  test.setTimeout(300_000);
  const room = await openLiveRoom(browser, appOrigin(baseURL), "n1");
  try {
    // A short drop: the SDK rides it out.
    await room.member.context.setOffline(true);
    await room.pageB.waitForTimeout(4_000);
    await room.member.context.setOffline(false);
    await expectConnected(room.pageB, 2);
    await expectConnected(room.pageA, 2);

    // A drop longer than the lease: the seat lapses, the page enters again and reconnects.
    await room.member.context.setOffline(true);
    await expect.poll(async () => (await sessionView(room.host, room.sessionId)).occupancy, { timeout: LEASE_MS + 40_000, intervals: [3_000] }).toBe(1);
    await room.member.context.setOffline(false);
    await expectConnected(room.pageB, 2);
    await expectConnected(room.pageA, 2);
    await expect.poll(async () => (await sessionView(room.host, room.sessionId)).occupancy, { timeout: 30_000 }).toBe(2);
    await expectNoRoomBanner(room.pageB);
    await room.pageB.getByRole("tab", { name: "Chat" }).click();
    await expect(room.pageB.getByRole("textbox", { name: "Chat" })).toBeEnabled();
  } finally {
    await room.close();
  }
});

test("N2: a second tab of the same account takes the place once; the first stops and says why", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const room = await openLiveRoom(browser, appOrigin(baseURL), "n2");
  try {
    const secondTab = await room.member.context.newPage();
    await secondTab.goto(roomPath(room.sessionId));
    await expectConnected(secondTab, 2);
    await expect(room.pageB.getByText("This account joined the Live Session elsewhere. Close the other session and reconnect.")).toBeVisible();
    // No tug of war: for a while the first tab stays out and the second stays in.
    for (let check = 0; check < 5; check += 1) {
      await room.pageB.waitForTimeout(3_000);
      await expect(room.pageB.getByRole("button", { name: "Share" })).toBeDisabled();
      await expect(secondTab.getByRole("button", { name: "Share" })).toBeEnabled();
      await expect(room.pageA.locator('[data-participants="2"]')).toBeVisible();
    }
  } finally {
    await room.close();
  }
});

test("N4: an AI Tutor or poll failure stays on its own line and never drops the call", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const room = await openLiveRoom(browser, appOrigin(baseURL), "n4");
  try {
    const { pageB, sessionId } = room;
    await pageB.getByRole("tab", { name: "Chat" }).click();

    // The ask request fails: the error and "Ask again" sit on the question.
    const askRoute = `**/api/study-groups/sessions/${sessionId}/ai-tutor`;
    await pageB.route(askRoute, (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ ok: false, code: "error", message: "", data: null }) }));
    await askTutor(pageB, "What is ataraxia?");
    const question = pageB.locator("article").filter({ hasText: "What is ataraxia?" });
    await expect(question.getByRole("alert")).toContainText("Something went wrong. Try again.");
    await expectNoRoomBanner(pageB);
    await expect(pageB.getByRole("button", { name: "Share" })).toBeEnabled();
    await pageB.unroute(askRoute);
    await question.getByRole("button", { name: "Ask again" }).click();
    await expect(tutorLine(pageB)).toContainText(MOCK_TUTOR_REPLY, { timeout: 60_000 });
    await expect(question.getByRole("alert")).toHaveCount(0);

    // The model fails: the answer says the tutor is unavailable, the call stays up.
    await askTutor(pageB, "[fail] Why does the model fail?");
    await expect(tutorLine(pageB).filter({ hasText: "AI Tutor is temporarily unavailable. Please try again." })).toBeVisible({ timeout: 60_000 });
    await expectNoRoomBanner(pageB);

    // The session poll fails for a while: nothing shows, nothing reconnects.
    const pollRoute = `**/api/study-groups/sessions/${sessionId}`;
    await pageB.route(pollRoute, (route) => route.request().method() === "GET" ? route.fulfill({ status: 500, contentType: "application/json", body: "{}" }) : route.continue());
    await pageB.waitForTimeout(8_000);
    await expect(appAlerts(pageB)).toHaveCount(0);
    await expectNoRoomBanner(pageB);
    await pageB.unroute(pollRoute);
    await expectConnected(pageB, 2);
  } finally {
    await room.close();
  }
});

test("N5 / M21: two waiting questions per person and five a minute; asking returns at once", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const room = await openLiveRoom(browser, appOrigin(baseURL), "n5");
  try {
    const { pageB, sessionId, member } = room;
    await pageB.getByRole("tab", { name: "Chat" }).click();

    // M21: a slow answer does not hold the ask request.
    const started = Date.now();
    const first = await member.context.request.post(`/api/study-groups/sessions/${sessionId}/ai-tutor`, { data: { message: "[slow] first question", clientEventId: `e2e-${Date.now()}-1` } });
    expect(first.status()).toBe(200);
    expect(Date.now() - started, "the ask returns before the answer").toBeLessThan(4_000);

    // A second waiting question is fine; a third waits its turn.
    await askTutor(pageB, "[slow] second question");
    await expect(pageB.getByText("AI Tutor is answering…")).toBeVisible();
    await askTutor(pageB, "third question");
    const third = pageB.locator("article").filter({ hasText: "third question" });
    await expect(third.getByRole("alert")).toContainText("Wait for the AI Tutor to answer your earlier questions first.");
    await expectNoRoomBanner(pageB);

    // Once those are answered, asking works again until five in a minute.
    await expect(tutorLine(pageB).filter({ hasText: MOCK_TUTOR_REPLY })).toHaveCount(2, { timeout: 60_000 });
    let accepted = 2;
    let refused: { status: number; code: string } | null = null;
    for (let index = 0; index < 6 && !refused; index += 1) {
      const response = await member.context.request.post(`/api/study-groups/sessions/${sessionId}/ai-tutor`, { data: { message: `quick question ${index}`, clientEventId: `e2e-${Date.now()}-q${index}` } });
      if (response.status() === 200) accepted += 1;
      else refused = { status: response.status(), code: (await response.json()).code };
      await pageB.waitForTimeout(1_500);
    }
    expect(refused, "the sixth question in a minute is refused").toEqual({ status: 429, code: "tutor_rate_limited" });
    expect(accepted).toBe(5);
  } finally {
    await room.close();
  }
});

test("N6: the asker sees 'answering', the answer names whom it answers, and Chat counts unread messages", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const room = await openLiveRoom(browser, appOrigin(baseURL), "n6");
  try {
    const { pageA, pageB } = room;
    // Unread: A stays on Participants while B chats.
    await pageB.getByRole("tab", { name: "Chat" }).click();
    for (const text of ["hello from B", "second line from B"]) {
      await pageB.getByRole("textbox", { name: "Chat" }).fill(text);
      await pageB.getByRole("button", { name: "Send", exact: true }).click();
    }
    const chatTab = pageA.getByRole("tab", { name: /Chat/ });
    await expect(chatTab.getByLabel("2 unread")).toBeVisible();
    await chatTab.click();
    await expect(chatTab.getByLabel(/unread/)).toHaveCount(0);
    await expect(pageA.getByText("second line from B")).toBeVisible();
    await pageB.getByRole("textbox", { name: "Chat" }).fill("while A reads");
    await pageB.getByRole("button", { name: "Send", exact: true }).click();
    await expect(pageA.getByText("while A reads")).toBeVisible();
    await expect(chatTab.getByLabel(/unread/), "no count while Chat is open").toHaveCount(0);

    // Answering: only the asker sees the placeholder, and the answer takes its place.
    await askTutor(pageB, "[slow] What is a katastematic pleasure?");
    await expect(pageB.getByText("AI Tutor is answering…")).toBeVisible();
    await expect(pageA.getByText("AI Tutor is answering…")).toHaveCount(0);
    await expect(tutorLine(pageB)).toContainText(MOCK_TUTOR_REPLY, { timeout: 60_000 });
    await expect(pageB.getByText("AI Tutor is answering…")).toHaveCount(0);
    await expect(tutorLine(pageB)).toHaveCount(1);
    for (const page of [pageA, pageB]) {
      await expect(tutorLine(page)).toContainText("Replying to Study Guest: [slow] What is a katastematic pleasure?");
    }
  } finally {
    await room.close();
  }
});

test("N7: a full waiting room keeps the Host's seat, so the Host can start and enter", async ({ browser, baseURL }) => {
  const origin = appOrigin(baseURL);
  const host = await newMember(browser, origin, "n7-a", "Study Host");
  const first = await newMember(browser, origin, "n7-b", "First Member");
  const second = await newMember(browser, origin, "n7-c", "Second Member");
  try {
    const groupId = await createGroup(host, unique("E2E N7"));
    await joinGroup(first, groupId);
    await joinGroup(second, groupId);
    const sessionId = await scheduleSession(host, groupId, { title: "Two seats", startsInMs: 90_000, maxParticipants: 2 });
    expect((await enterSession(first, sessionId)).status(), "first member waits").toBe(200);
    const refused = await enterSession(second, sessionId);
    expect(refused.status(), "the last seat is the Host's").toBe(409);
    expect((await refused.json()).code).toBe("session_full");

    const page = await openGroupPage(host, groupId);
    await page.getByRole("button", { name: "Start Live Session" }).click();
    await page.waitForURL(new RegExp(`/sessions/${sessionId}`));
    await expect(page.getByRole("button", { name: "Share" })).toBeEnabled();
    const view = await sessionView(host, sessionId);
    expect(view.state).toBe("live");
    expect(view.occupancy).toBe(2);
  } finally {
    await host.context.close();
    await first.context.close();
    await second.context.close();
  }
});

test("N8: a double click schedules one session and joins once; the server folds a repeat", async ({ browser, baseURL }) => {
  const origin = appOrigin(baseURL);
  const host = await newMember(browser, origin, "n8-a", "Study Host");
  const member = await newMember(browser, origin, "n8-b", "Study Guest");
  try {
    const groupId = await createGroup(host, unique("E2E N8"));
    const page = await openGroupPage(host, groupId);
    await page.getByRole("button", { name: "Schedule Live Session" }).click();
    const dialog = page.getByRole("dialog");
    const start = new Date(Date.now() + 3 * 60 * 60_000);
    const pad = (value: number) => String(value).padStart(2, "0");
    await dialog.locator('input[name="title"]').fill("Double click session");
    await dialog.locator('input[name="date"]').fill(`${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`);
    await dialog.locator('input[name="time"]').fill(`${pad(start.getHours())}:${pad(start.getMinutes())}`);
    await dialog.locator('select[name="durationMinutes"]').selectOption({ index: 1 });
    await dialog.locator('select[name="maxParticipants"]').selectOption("4");
    await dialog.getByRole("button", { name: "Schedule Session" }).dblclick();
    await expect(page.getByRole("heading", { name: "Double click session" })).toHaveCount(1);
    await page.waitForTimeout(3_000);
    expect((await groupView(host, groupId)).sessions?.filter((session) => session.title === "Double click session")).toHaveLength(1);

    // The server's own guard: the same schedule twice within 10 s is one session.
    const body = { title: "Repeated request", startsAt: new Date(Date.now() + 4 * 60 * 60_000).toISOString(), durationSeconds: 1800, maxParticipants: 4, aiTutorEnabled: true };
    const [one, two] = await Promise.all([0, 1].map(() => host.context.request.post(`/api/study-groups/${groupId}/sessions`, { data: body })));
    expect((await one.json()).data.id).toBe((await two.json()).data.id);

    // Join Now double clicked by a member.
    const memberPage = await openGroupPage(member, groupId);
    await memberPage.getByRole("button", { name: "Join Now" }).dblclick();
    await expect(memberPage.getByRole("button", { name: "Leave Study Group" })).toBeVisible();
    expect((await groupView(host, groupId)).memberCount).toBe(2);
  } finally {
    await host.context.close();
    await member.context.close();
  }
});

test("N9: a moved Start Time withdraws the old reminder, tells planned members, and reminds again for the new time", async ({ browser, baseURL }) => {
  test.setTimeout(330_000);
  const origin = appOrigin(baseURL);
  const host = await newMember(browser, origin, "n9-a", "Study Host");
  const member = await newMember(browser, origin, "n9-b", "Study Guest");
  try {
    const title = unique("Rescheduled session");
    const groupId = await createGroup(host, unique("E2E N9"));
    await joinGroup(member, groupId);
    const sessionId = await scheduleSession(host, groupId, { title, startsInMs: 8 * 60_000 });
    expect((await member.context.request.post(`/api/study-groups/sessions/${sessionId}/plan`, { data: {} })).status()).toBe(200);
    // "<title> in the Study Group "<group>" starts in N minutes." (QA M10-a).
    const reminded = async () => (await remindersFor(member)).some((body) => body.startsWith(`${title} in the Study Group`));
    await expect.poll(reminded, { timeout: 60_000, intervals: [3_000] }).toBe(true);

    // The Host moves the start to just outside the reminder window.
    const moved = await host.context.request.patch(`/api/study-groups/sessions/${sessionId}`, { data: { groupId, startsAt: new Date(Date.now() + 10 * 60_000 + 40_000).toISOString() } });
    expect(moved.status(), "reschedule").toBe(200);
    await expect.poll(reminded, { timeout: 15_000 }).toBe(false);
    await expect.poll(async () => (await notificationsFor(member.email)).filter((item) => item.title === "Live Session rescheduled" && item.body.includes(title)).length, { timeout: 15_000 }).toBe(1);
    expect((await notificationsFor(host.email)).filter((item) => item.title === "Live Session rescheduled"), "the Host who moved it is not told").toHaveLength(0);
    await expect.poll(async () => (await mailTo(member.email)).filter((message) => message.raw.includes("Live Session rescheduled")).length, { timeout: 15_000 }).toBe(1);

    // When the new time enters the window, the reminder comes again.
    await expect.poll(reminded, { timeout: 150_000, intervals: [5_000] }).toBe(true);
    await expect.poll(async () => (await mailTo(member.email)).filter((message) => message.raw.includes("Live Session reminder")).length, { timeout: 30_000 }).toBe(2);
  } finally {
    await host.context.close();
    await member.context.close();
  }
});

test("M10: cancelling a group tells the members by group name, not the Host", async ({ browser, baseURL }) => {
  const origin = appOrigin(baseURL);
  const host = await newMember(browser, origin, "m10-a", "Study Host");
  const member = await newMember(browser, origin, "m10-b", "Study Guest");
  try {
    const title = unique("E2E M10");
    const groupId = await createGroup(host, title);
    await joinGroup(member, groupId);
    expect((await host.context.request.post(`/api/study-groups/${groupId}/cancel`, { data: {} })).status()).toBe(200);
    await expect.poll(async () => (await notificationsFor(member.email)).filter((item) => item.title === "Study Group cancelled" && item.body.includes(`"${title}"`)).length, { timeout: 15_000 }).toBe(1);
    expect((await notificationsFor(host.email)).filter((item) => item.title === "Study Group cancelled")).toHaveLength(0);
  } finally {
    await host.context.close();
    await member.context.close();
  }
});

test("N10 / M6: a failed poll keeps the page, a failed group has its own retry, errors stay with their group", async ({ browser, baseURL }) => {
  const origin = appOrigin(baseURL);
  const host = await newMember(browser, origin, "n10-a", "Study Host");
  const member = await newMember(browser, origin, "n10-b", "Study Guest");
  try {
    const firstTitle = unique("E2E N10 first");
    const secondTitle = unique("E2E N10 second");
    const first = await createGroup(host, firstTitle);
    const second = await createGroup(host, secondTitle);
    await joinGroup(member, first);
    await joinGroup(member, second);
    await scheduleSession(host, first, { title: "Plan me", startsInMs: 3 * 60 * 60_000 });
    const page = await openGroupPage(member, first);
    await expect(page.getByRole("heading", { level: 2, name: firstTitle })).toBeVisible();

    // The list polls fail for a while: what is on screen stays.
    const listRoute = "**/api/study-groups?view=mine*";
    await page.route(listRoute, (route) => route.fulfill({ status: 500, contentType: "application/json", body: "{}" }));
    await page.waitForTimeout(8_000);
    await expect(page.getByRole("heading", { level: 2, name: firstTitle })).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
    await page.unroute(listRoute);

    // A failed action's error belongs to its group.
    const planRoute = "**/api/study-groups/sessions/*/plan";
    await page.route(planRoute, (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ ok: false, code: "error", message: "", data: null }) }));
    await page.getByRole("button", { name: "Plan to Attend" }).click();
    await expect(appAlerts(page)).toHaveText("Something went wrong. Try again.");
    await page.unroute(planRoute);

    // Opening the other group fails: its own error and a Retry that opens it.
    const groupRoute = `**/api/study-groups/${second}`;
    await page.route(groupRoute, (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ ok: false, code: "error", message: "", data: null }) }));
    await page.getByRole("button", { name: new RegExp(secondTitle) }).first().click();
    const failed = appAlerts(page).filter({ has: page.getByRole("button", { name: "Try again" }) });
    await expect(failed).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: firstTitle }), "the old group does not stand in for the failed one").toHaveCount(0);
    await page.unroute(groupRoute);
    await failed.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("heading", { level: 2, name: secondTitle })).toBeVisible();
    await expect(page.getByText("Something went wrong. Try again."), "the first group's error stayed behind").toHaveCount(0);

    // M6: signed out, the sign-in link brings the visitor back to this group.
    const visitor = await browser.newContext({ baseURL: origin });
    const visitorPage = await visitor.newPage();
    await visitorPage.goto(groupPath(second));
    await expect(visitorPage.getByRole("heading", { level: 2, name: secondTitle })).toBeVisible();
    const signIn = visitorPage.getByRole("link", { name: "Sign In" }).last();
    expect(decodeURIComponent((await signIn.getAttribute("href")) || "")).toContain(`returnTo=/en-GB/portal/study-groups?group=${second}`);
    await visitor.close();
  } finally {
    await host.context.close();
    await member.context.close();
  }
});

test("N11: sessions run live, then soonest upcoming, then the latest ended; Discover shows the newest group first", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const origin = appOrigin(baseURL);
  const host = await newMember(browser, origin, "n11", "Study Host");
  try {
    const olderTitle = unique("E2E N11 older");
    await createGroup(host, olderTitle);
    const title = unique("E2E N11");
    const groupId = await createGroup(host, title);
    const hour = 60 * 60_000;
    await scheduleSession(host, groupId, { title: "In three days", startsInMs: 72 * hour });
    await scheduleSession(host, groupId, { title: "Tomorrow", startsInMs: 24 * hour });
    await scheduleSession(host, groupId, { title: "In two hours", startsInMs: 2 * hour });
    const ended = [] as string[];
    for (const [label, startsInMs] of [["Ended earlier", 5 * 60_000], ["Ended later", 7 * 60_000]] as const) {
      const id = await scheduleSession(host, groupId, { title: label, startsInMs });
      expect((await host.context.request.post(`/api/study-groups/sessions/${id}/start`, { data: {} })).status()).toBe(200);
      expect((await enterSession(host, id)).status()).toBe(200);
      expect((await host.context.request.post(`/api/study-groups/sessions/${id}/leave`, { data: {} })).status()).toBe(200);
      ended.push(id);
    }
    const liveId = await scheduleSession(host, groupId, { title: "Live one", startsInMs: 3 * 60_000 });
    expect((await host.context.request.post(`/api/study-groups/sessions/${liveId}/start`, { data: {} })).status()).toBe(200);
    expect((await enterSession(host, liveId)).status()).toBe(200);
    for (const id of ended) await expect.poll(async () => (await sessionView(host, id)).state).toBe("completed");

    const expected = ["Live one", "In two hours", "Tomorrow", "In three days", "Ended later", "Ended earlier"];
    expect((await groupView(host, groupId)).sessions?.map((session) => session.title)).toEqual(expected);
    const page = await openGroupPage(host, groupId);
    await expect(page.locator("article article h3")).toHaveText(expected);

    // Discover lists groups the viewer is not in, so a signed-out visitor looks.
    const visitor = await browser.newContext({ baseURL: origin });
    const discover = await visitor.request.get("/api/study-groups?view=discover");
    const titles = ((await discover.json()).data as Array<{ title: string }>).map((group) => group.title);
    await visitor.close();
    expect(titles.indexOf(title), "the newer group comes first").toBeLessThan(titles.indexOf(olderTitle));
    expect(titles.indexOf(title)).toBeGreaterThanOrEqual(0);
  } finally {
    await host.context.close();
  }
});

test("N12: on a phone, opening a group brings its details into view", async ({ browser, baseURL }) => {
  const origin = appOrigin(baseURL);
  const host = await newMember(browser, origin, "n12", "Study Host");
  try {
    const titles = [] as string[];
    for (let index = 0; index < 6; index += 1) {
      const title = unique(`E2E N12 ${index}`);
      await createGroup(host, title);
      titles.push(title);
    }
    const page = await host.context.newPage();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/en-GB/portal/study-groups");
    const card = page.getByRole("button", { name: new RegExp(titles[0]) }).first();
    await card.scrollIntoViewIfNeeded();
    const details = page.getByRole("heading", { level: 2, name: titles[0] });
    await card.click();
    await expect(details).toBeInViewport();
  } finally {
    await host.context.close();
  }
});

// Holds media playback until the page has had a user gesture, as Safari and
// iOS do: audio from the room cannot play until the member clicks something.
// Headless Chromium plays everything (and reports the page as already
// activated), so both media elements and the AudioContext, which LiveKit also
// checks, are held here until the first real click or key press.
function blockAutoplayUntilGesture() {
  let gestured = false;
  const gesture = (event: Event) => { if (event.isTrusted) gestured = true; };
  window.addEventListener("pointerdown", gesture, true);
  window.addEventListener("keydown", gesture, true);
  const allowed = () => gestured;
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function playAfterGesture(this: HTMLMediaElement) {
    if (!allowed()) return Promise.reject(new DOMException("play() needs a user gesture", "NotAllowedError"));
    return play.call(this);
  };
  class GestureAudioContext extends window.AudioContext {
    get state(): AudioContextState {
      return allowed() ? super.state : "suspended";
    }
    resume() {
      return allowed() ? super.resume() : Promise.resolve();
    }
  }
  window.AudioContext = GestureAudioContext;
}

test("N13: sound blocked by the browser shows a button that turns it on", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const room = await openLiveRoom(browser, appOrigin(baseURL), "n13", { memberInitScript: blockAutoplayUntilGesture });
  try {
    // The Host speaks: the member's browser receives audio it may not play yet.
    await room.pageA.getByRole("button", { name: "Mic" }).click();
    await expect(room.pageA.getByRole("button", { name: "Mic" })).toHaveAttribute("aria-pressed", "true");
    const enable = room.pageB.getByRole("button", { name: "Sound is blocked by your browser. Click to turn it on." });
    await expect(enable).toBeVisible();
    await enable.click();
    await expect(enable).toHaveCount(0);
    await expect(room.pageB.locator("audio")).toHaveCount(1);
    expect(await room.pageB.locator("audio").evaluate((element: HTMLAudioElement) => element.paused), "the Host's audio plays").toBe(false);
  } finally {
    await room.close();
  }
});
