import { expect, test, type Page } from "playwright/test";
import {
  createGroup,
  entitle,
  expectConnected,
  joinGroup,
  newMember,
  roomPath,
  scheduleSession,
  sessionView,
  SMTP_SINK_MESSAGES,
  type Member,
} from "./study-group-helpers";

// SG deep links (confirmed with the product owner 2026-10-30): a link to a
// Live Session goes on in one click whenever the viewer may go on, and stops
// on one page only when they may not. Nobody enters the room before the Host
// starts: from T-10 a member's link opens the list's waiting dialog and the
// Host's opens the list with Start. Signed-out, failed-load and full links
// are locked in study-group-round2-room.spec.ts (M20, QA3 F7).

test.skip(Boolean(process.env.CI), "local-only Study Group E2E; CI does not run e2e");

function appOrigin(baseURL: string | undefined) {
  return baseURL || "http://127.0.0.1:3013";
}

function unique(label: string) {
  return `${label} ${Date.now().toString(36)}`;
}

// SG_DL_SHOTS=<dir> keeps a picture of each stop page for visual review.
async function shot(page: Page, name: string) {
  const dir = process.env.SG_DL_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

function listUrl(groupId: string) {
  return new RegExp(`/en-GB/portal/study-groups\\?group=${groupId}$`);
}

const WAITING = "Waiting for the host to start the session...";

async function mailTo(email: string) {
  const response = await fetch(SMTP_SINK_MESSAGES);
  const messages = await response.json() as Array<{ to: string[]; raw: string }>;
  // Quoted-printable soft line breaks would split a long link.
  return messages.filter((message) => message.to.includes(email.toLowerCase())).map((message) => message.raw.replace(/=\r?\n/g, "").replace(/=3D/g, "="));
}

test("DL-1: Starting Soon links take the member to the waiting dialog and the Host to Start; a live link goes straight in", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const origin = appOrigin(baseURL);
  const host = await newMember(browser, origin, "dl1-a", "Study Host");
  const member = await newMember(browser, origin, "dl1-b", "Study Guest");
  const late = await newMember(browser, origin, "dl1-c", "Late Member");
  try {
    const groupId = await createGroup(host, unique("E2E DL1"));
    await joinGroup(member, groupId);
    await joinGroup(late, groupId);
    const sessionId = await scheduleSession(host, groupId, { title: "Deep link session", startsInMs: 90_000 });

    // The member waits in the list's dialog, which holds the seat; the
    // address no longer carries the one-time hand-over.
    const pageB = await member.context.newPage();
    await pageB.goto(roomPath(sessionId));
    await expect(pageB.getByRole("dialog").getByText(WAITING)).toBeVisible();
    await expect(pageB).toHaveURL(listUrl(groupId));
    expect((await sessionView(host, sessionId)).occupancy).toBe(1);

    // The Host lands on the list with Start, and nothing else opens.
    const pageA = await host.context.newPage();
    await pageA.goto(roomPath(sessionId));
    await expect(pageA).toHaveURL(listUrl(groupId));
    await expect(pageA.getByRole("button", { name: "Start Live Session" })).toBeVisible();
    await expect(pageA.getByRole("dialog")).toHaveCount(0);
    expect((await sessionView(host, sessionId)).state).toBe("starting_soon");

    // Start moves the waiting member in.
    await pageA.getByRole("button", { name: "Start Live Session" }).click();
    await pageB.waitForURL(new RegExp(roomPath(sessionId)), { timeout: 30_000 });
    await expectConnected(pageA, 2);
    await expectConnected(pageB, 2);

    // Live: the link opens the room at once.
    const pageC = await late.context.newPage();
    await pageC.goto(roomPath(sessionId));
    await expectConnected(pageC, 3);
    await expect(pageC).toHaveURL(new RegExp(`${roomPath(sessionId)}$`));
  } finally {
    await host.context.close();
    await member.context.close();
    await late.context.close();
  }
});

test("DL-2: a learner with the Course but not in the group joins from the link and carries on to the waiting dialog", async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const origin = appOrigin(baseURL);
  const host = await newMember(browser, origin, "dl2-a", "Study Host");
  const outsider = await newMember(browser, origin, "dl2-b", "Course Learner");
  try {
    const groupId = await createGroup(host, unique("E2E DL2"));
    const sessionId = await scheduleSession(host, groupId, { title: "Join from the link", startsInMs: 90_000, focus: "Read chapter two before we meet." });
    const page = await outsider.context.newPage();
    await page.goto(roomPath(sessionId));
    await expect(page.getByRole("heading", { name: "Join the Study Group to attend this Live Session" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Join from the link" })).toBeVisible();
    await expect(page.getByText("Read chapter two before we meet.")).toBeVisible();
    await shot(page, "dl02-join-group");
    await page.getByRole("button", { name: "Join Study Group & Continue" }).click();
    await expect(page.getByRole("dialog").getByText(WAITING)).toBeVisible();
    await expect(page).toHaveURL(listUrl(groupId));
    expect((await sessionView(host, sessionId)).occupancy).toBe(1);
  } finally {
    await host.context.close();
    await outsider.context.close();
  }
});

test("DL-3: without the Course the link asks for access in a new tab, hides who is there, and carries on once access is gained", async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const origin = appOrigin(baseURL);
  const host = await newMember(browser, origin, "dl3-a", "Study Host");
  const learner = await newMember(browser, origin, "dl3-b", "New Learner", { entitle: false });
  try {
    const groupId = await createGroup(host, unique("E2E DL3"));
    const sessionId = await scheduleSession(host, groupId, { title: "Access first", startsInMs: 90_000, maxParticipants: 6, focus: "Bring one question." });
    expect((await host.context.request.post(`/api/study-groups/sessions/${sessionId}/enter`, { data: {} })).status()).toBe(200);
    const page = await learner.context.newPage();
    await page.goto(roomPath(sessionId));
    await expect(page.getByRole("heading", { name: "Course access required" })).toBeVisible();
    const access = page.getByRole("link", { name: "Get Course Access" });
    await expect(access).toHaveAttribute("href", "/en-GB/subscription?courseId=epicureanism");
    await expect(access).toHaveAttribute("target", "_blank");
    // Title, focus, time, duration, the cap and the Course; not who is there.
    await expect(page.getByRole("heading", { name: "Access first" })).toBeVisible();
    await expect(page.getByText("Bring one question.")).toBeVisible();
    await expect(page.getByText("Up to 6 participants")).toBeVisible();
    await expect(page.getByText(/currently in session/)).toHaveCount(0);
    await shot(page, "dl03-course-access");

    // Back from the purchase tab: the page asks again by itself.
    await entitle(learner.context, origin);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByText(/^You now have access to /)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Join the Study Group to attend this Live Session" })).toBeVisible();
    await shot(page, "dl03-access-gained");
  } finally {
    await host.context.close();
    await learner.context.close();
  }
});

test("DL-4: before T-10 the link says when it opens: members plan to attend, the Host is pointed to the list", async ({ browser, baseURL }) => {
  const origin = appOrigin(baseURL);
  const host = await newMember(browser, origin, "dl4-a", "Study Host");
  const member = await newMember(browser, origin, "dl4-b", "Study Guest");
  try {
    const groupId = await createGroup(host, unique("E2E DL4"));
    await joinGroup(member, groupId);
    const sessionId = await scheduleSession(host, groupId, { title: "Later today", startsInMs: 3 * 60 * 60_000 });
    const page = await member.context.newPage();
    await page.goto(roomPath(sessionId));
    await expect(page.getByRole("heading", { name: /^This session opens at / })).toBeVisible();
    await shot(page, "dl-not-open");
    await page.getByRole("button", { name: "Plan to Attend" }).click();
    await expect(page.getByText("You’re planning to attend. We’ll remind you 10 minutes before it starts.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Plan to Attend" })).toHaveCount(0);
    await shot(page, "dl-not-open-planned");

    const hostPage = await host.context.newPage();
    await hostPage.goto(roomPath(sessionId));
    await expect(hostPage.getByText(/^You’re hosting this Live Session\. From .+ you can start it from the session list\.$/)).toBeVisible();
    await expect(hostPage.getByRole("link", { name: "Open Study Group" })).toHaveAttribute("href", `/en-GB/portal/study-groups?group=${groupId}`);
  } finally {
    await host.context.close();
    await member.context.close();
  }
});

test("DL-5: a cancelled session's link says it is not available and tells nothing about it", async ({ browser, baseURL }) => {
  const origin = appOrigin(baseURL);
  const host = await newMember(browser, origin, "dl5-a", "Study Host");
  const member = await newMember(browser, origin, "dl5-b", "Study Guest");
  try {
    const groupId = await createGroup(host, unique("E2E DL5"));
    await joinGroup(member, groupId);
    const sessionId = await scheduleSession(host, groupId, { title: "Called off", startsInMs: 60 * 60_000 });
    expect((await host.context.request.post(`/api/study-groups/sessions/${sessionId}/cancel`, { data: {} })).status()).toBe(200);
    const page = await member.context.newPage();
    await page.goto(roomPath(sessionId));
    await expect(page.getByRole("heading", { name: "This Live Session isn’t available" })).toBeVisible();
    await expect(page.getByText("Called off")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Back to Study Groups" })).toHaveAttribute("href", "/en-GB/portal/study-groups");
    await shot(page, "dl-unavailable");
  } finally {
    await host.context.close();
    await member.context.close();
  }
});

test("DL-6: the T-10 reminder carries the session link, by mail and in the site, and Enter now opens the waiting dialog", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const origin = appOrigin(baseURL);
  const host = await newMember(browser, origin, "dl6-a", "Study Host");
  const member = await newMember(browser, origin, "dl6-b", "Study Guest");
  try {
    const groupId = await createGroup(host, unique("E2E DL6"));
    await joinGroup(member, groupId);
    const title = unique("Reminder link");
    const sessionId = await scheduleSession(host, groupId, { title, startsInMs: 8 * 60_000 });
    expect((await member.context.request.post(`/api/study-groups/sessions/${sessionId}/plan`, { data: {} })).status()).toBe(200);
    const link = `/en-GB/portal/study-groups/sessions/${sessionId}`;
    await expect.poll(async () => (await mailTo(member.email)).filter((raw) => raw.includes("Live Session reminder") && raw.includes(link)).length, { timeout: 90_000, intervals: [3_000] }).toBe(1);

    const page = await member.context.newPage();
    await page.goto("/en-GB/portal/study-groups");
    const reminder = page.getByRole("status").filter({ hasText: `${title} in the Study Group` });
    await expect(reminder).toBeVisible();
    await reminder.getByRole("button", { name: "Enter now" }).click();
    await expect(page.getByRole("dialog").getByText(WAITING)).toBeVisible();
    expect((await sessionView(host, sessionId)).occupancy).toBe(1);
  } finally {
    await host.context.close();
    await member.context.close();
  }
});

test("DL-7: Session Focus takes up to 300 characters when scheduling (owner request 2026-10-30)", async ({ browser, baseURL }) => {
  const host: Member = await newMember(browser, appOrigin(baseURL), "dl7", "Focus Host");
  try {
    const groupId = await createGroup(host, unique("E2E DL7"));
    const page = await host.context.newPage();
    await page.goto(`/en-GB/portal/study-groups?group=${groupId}`);
    await page.getByRole("button", { name: "Schedule Live Session" }).click();
    const dialog = page.getByRole("dialog");
    const at = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const pad = (value: number) => String(value).padStart(2, "0");
    await dialog.locator('input[name="title"]').fill("Long focus");
    await dialog.locator('input[name="date"]').fill(`${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`);
    await dialog.locator('input[name="time"]').fill(`${pad(at.getHours())}:${pad(at.getMinutes())}`);
    await dialog.locator('select[name="durationMinutes"]').selectOption("30");
    await dialog.locator('select[name="maxParticipants"]').selectOption("4");
    const focus = dialog.locator('textarea[name="focus"]');
    await focus.fill("f".repeat(320));
    await expect(focus).toHaveValue("f".repeat(300));
    await expect(dialog.getByText("300/300")).toBeVisible();
    const saved = page.waitForResponse((response) => response.url().endsWith(`/api/study-groups/${groupId}/sessions`) && response.request().method() === "POST");
    await dialog.getByRole("button", { name: "Schedule Session" }).click();
    const body = await (await saved).json();
    expect(body.ok).toBe(true);
    expect(body.data.focus).toBe("f".repeat(300));

    // The server holds the same limit.
    const tooLong = await host.context.request.post(`/api/study-groups/${groupId}/sessions`, {
      data: { title: "Too long", startsAt: at.toISOString(), durationSeconds: 1800, maxParticipants: 4, aiTutorEnabled: true, focus: "f".repeat(301) },
    });
    expect(tooLong.status()).toBe(400);
  } finally {
    await host.context.close();
  }
});
