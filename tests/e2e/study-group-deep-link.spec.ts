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
    await expect(pageA.getByRole("button", { name: "Start Live Session" })).toBeEnabled();
    // Once the list has settled, still no dialog: the Host's way in is Start.
    await pageA.waitForLoadState("networkidle");
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
    await expect(page.getByRole("heading", { name: /^This Live Session opens at \d{2}:\d{2}$/ })).toBeVisible();
    await shot(page, "dl-not-open");
    await page.getByRole("button", { name: "Plan to Attend" }).click();
    await expect(page.getByText("You’re planning to attend. We’ll remind you 10 minutes before it starts.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Plan to Attend" })).toHaveCount(0);
    await shot(page, "dl-not-open-planned");

    const hostPage = await host.context.newPage();
    await hostPage.goto(roomPath(sessionId));
    await expect(hostPage.getByText(/^You’re hosting this Live Session\. From .+ you can start it on the Study Group page\.$/)).toBeVisible();
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

    // The Host's reminder: Enter now opens the group with Start, and Start
    // moves the waiting member in.
    const hostPage = await host.context.newPage();
    await hostPage.goto("/en-GB/portal/study-groups");
    const hostReminder = hostPage.getByRole("status").filter({ hasText: `${title} in the Study Group` });
    await hostReminder.getByRole("button", { name: "Enter now" }).click();
    const start = hostPage.getByRole("button", { name: "Start Live Session" });
    await expect(start).toBeEnabled();
    await expect(hostPage.getByRole("dialog")).toHaveCount(0);
    await start.click();
    await hostPage.waitForURL(new RegExp(roomPath(sessionId)), { timeout: 30_000 });
    await page.waitForURL(new RegExp(roomPath(sessionId)), { timeout: 30_000 });
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

    // Edit Session shows the stored focus whole, read-only (only the time moves).
    await page.getByRole("button", { name: "Edit Session" }).click();
    const edit = page.getByRole("dialog");
    await expect(edit.locator('textarea[name="focus"]')).toHaveValue("f".repeat(300));
    await expect(edit.locator('textarea[name="focus"]')).toBeDisabled();
    await expect(edit.getByText("300/300")).toBeVisible();

    // The server holds the same limit.
    const tooLong = await host.context.request.post(`/api/study-groups/${groupId}/sessions`, {
      data: { title: "Too long", startsAt: at.toISOString(), durationSeconds: 1800, maxParticipants: 4, aiTutorEnabled: true, focus: "f".repeat(301) },
    });
    expect(tooLong.status()).toBe(400);
  } finally {
    await host.context.close();
  }
});

test("DL-8: a member left on the not-yet-open page is taken to the waiting dialog when the room opens at T-10", async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const origin = appOrigin(baseURL);
  const host = await newMember(browser, origin, "dl8-a", "Study Host");
  const member = await newMember(browser, origin, "dl8-b", "Study Guest");
  try {
    const groupId = await createGroup(host, unique("E2E DL8"));
    await joinGroup(member, groupId);
    // T-10 is 20 seconds away.
    const sessionId = await scheduleSession(host, groupId, { title: "Opens shortly", startsInMs: 10 * 60_000 + 20_000 });
    const page = await member.context.newPage();
    await page.goto(roomPath(sessionId));
    await expect(page.getByRole("heading", { name: /^This Live Session opens at / })).toBeVisible();
    // Nothing to click: the page asks again at T-10 and goes on.
    await expect(page.getByRole("dialog").getByText(WAITING)).toBeVisible({ timeout: 45_000 });
    await expect(page).toHaveURL(listUrl(groupId));
    expect((await sessionView(host, sessionId)).occupancy).toBe(1);
  } finally {
    await host.context.close();
    await member.context.close();
  }
});

test("DL-9: an ended session's link says so and offers the group and the Course", async ({ browser, baseURL }) => {
  const origin = appOrigin(baseURL);
  const host = await newMember(browser, origin, "dl9-a", "Study Host");
  const member = await newMember(browser, origin, "dl9-b", "Study Guest");
  try {
    const groupId = await createGroup(host, unique("E2E DL9"));
    await joinGroup(member, groupId);
    const sessionId = await scheduleSession(host, groupId, { title: "Over now", startsInMs: 90_000 });
    // The Host starts and leaves: the last one out ends it.
    expect((await host.context.request.post(`/api/study-groups/sessions/${sessionId}/start`, { data: {} })).status()).toBe(200);
    expect((await host.context.request.post(`/api/study-groups/sessions/${sessionId}/leave`, { data: {} })).status()).toBe(200);
    expect((await sessionView(host, sessionId)).state).toBe("completed");
    const page = await member.context.newPage();
    await page.goto(roomPath(sessionId));
    await expect(page.getByRole("heading", { name: "This Live Session has ended" })).toBeVisible();
    await expect(page.getByText("Completed", { exact: true })).toBeVisible();
    await expect(page.getByText(/currently in session/)).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Open Study Group" })).toHaveAttribute("href", `/en-GB/portal/study-groups?group=${groupId}`);
    await expect(page.getByRole("link", { name: "Return to Course" })).toHaveAttribute("href", /^\/en-GB\/portal\/courses\/[^/]+$/);
    await shot(page, "dl-ended");
  } finally {
    await host.context.close();
    await member.context.close();
  }
});

test("DL-10: a Course that is no longer offered is said so, with no purchase or join offered", async ({ browser, baseURL }) => {
  const origin = appOrigin(baseURL);
  const host = await newMember(browser, origin, "dl10-a", "Study Host");
  const learner = await newMember(browser, origin, "dl10-b", "New Learner", { entitle: false });
  try {
    const groupId = await createGroup(host, unique("E2E DL10"));
    const sessionId = await scheduleSession(host, groupId, { title: "Course withdrawn", startsInMs: 90_000 });
    // Unpublishing a Course is outside the Study Group: the server's answer
    // for that case (unit-tested) is played back here.
    const page = await learner.context.newPage();
    await page.route(`**/api/study-groups/sessions/${sessionId}/entry`, (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, code: "ok", data: {
        next: "course_unavailable", now: new Date().toISOString(), opensAt: null, viewer: { host: false, planned: false },
        session: { id: sessionId, title: "Course withdrawn", focus: null, startsAt: new Date(Date.now() + 90_000).toISOString(), durationSeconds: 1800, maxParticipants: 4, occupancy: null, state: "starting_soon" },
        group: null, course: null,
      } }),
    }));
    await page.goto(roomPath(sessionId));
    await expect(page.getByRole("heading", { name: "This Course is no longer available" })).toBeVisible();
    await expect(page.getByText("The Course this Live Session belongs to is no longer offered, so it can’t be joined.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to Study Groups" })).toHaveAttribute("href", "/en-GB/portal/study-groups");
    await expect(page.getByRole("link", { name: "Get Course Access" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Join Study Group & Continue" })).toHaveCount(0);
    await shot(page, "dl-course-gone");
  } finally {
    await host.context.close();
    await learner.context.close();
  }
});

test("DL-11: the hand-over to the waiting dialog happens once: closing it and reloading the list takes no seat", async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const origin = appOrigin(baseURL);
  const host = await newMember(browser, origin, "dl11-a", "Study Host");
  const member = await newMember(browser, origin, "dl11-b", "Study Guest");
  try {
    const groupId = await createGroup(host, unique("E2E DL11"));
    await joinGroup(member, groupId);
    const sessionId = await scheduleSession(host, groupId, { title: "Changed my mind", startsInMs: 90_000 });
    const page = await member.context.newPage();
    await page.goto(roomPath(sessionId));
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(WAITING)).toBeVisible();
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toHaveCount(0);
    await page.reload();
    await expect(page).toHaveURL(listUrl(groupId));
    await expect(page.getByText("Changed my mind").first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // The closed dialog's seat runs out (30 s lease) and nothing takes it again.
    await expect.poll(async () => (await sessionView(host, sessionId)).occupancy, { timeout: 60_000, intervals: [5_000] }).toBe(0);
  } finally {
    await host.context.close();
    await member.context.close();
  }
});

test("DL-12: a Chinese link stops in Chinese", async ({ browser, baseURL }) => {
  const origin = appOrigin(baseURL);
  const host = await newMember(browser, origin, "dl12-a", "Study Host");
  const member = await newMember(browser, origin, "dl12-b", "Study Guest");
  try {
    const groupId = await createGroup(host, unique("E2E DL12"));
    await joinGroup(member, groupId);
    const sessionId = await scheduleSession(host, groupId, { title: "晚上的直播课", startsInMs: 3 * 60 * 60_000 });
    const page = await member.context.newPage();
    await page.goto(`/zh-CN/portal/study-groups/sessions/${sessionId}`);
    await expect(page.getByRole("heading", { name: /^这节直播课将于 .+ 开放进入$/ })).toBeVisible();
    await expect(page.getByText("你是这个学习小组的成员。开始前 10 分钟可以进入。")).toBeVisible();
    await expect(page.getByRole("button", { name: "计划参加" })).toBeVisible();
    await expect(page.getByText("计划参加会在开始前提醒你，不保留座位。")).toBeVisible();
    await shot(page, "dl-not-open-zh");
  } finally {
    await host.context.close();
    await member.context.close();
  }
});
