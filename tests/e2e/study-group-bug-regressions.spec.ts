import { expect, test, type Page } from "playwright/test";
import {
  appAlerts,
  createGroup,
  groupPath,
  groupView,
  joinGroup,
  newMember,
  roomPath,
  scheduleSession,
  sessionView,
  type Member,
} from "./study-group-helpers";

// One regression lock per Study Group bug fixed from the Feishu bug list
// (BUG-0096 … BUG-0157). BUG-0099, BUG-0108 and BUG-0125 are locked in
// study-group-qa-regressions.spec.ts and study-group-two-browser.spec.ts.

test.skip(Boolean(process.env.CI), "local-only Study Group E2E; CI does not run e2e");

const HOUR = 60 * 60_000;

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

async function openStudyGroups(member: Member) {
  const page = await member.context.newPage();
  await page.goto("/en-GB/portal/study-groups");
  return page;
}

async function noHorizontalScroll(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
}

function localParts(at: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return { date: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`, time: `${pad(at.getHours())}:${pad(at.getMinutes())}` };
}

async function fillSchedule(page: Page, input: { title: string; startsAt: Date }) {
  const dialog = page.getByRole("dialog");
  const { date, time } = localParts(input.startsAt);
  await dialog.locator('input[name="title"]').fill(input.title);
  await dialog.locator('input[name="date"]').fill(date);
  await dialog.locator('input[name="time"]').fill(time);
  await dialog.locator('select[name="durationMinutes"]').selectOption({ index: 1 });
  await dialog.locator('select[name="maxParticipants"]').selectOption("4");
}

async function remindersFor(member: Member) {
  const response = await member.context.request.get("/api/study-groups?view=reminders");
  expect(response.status(), "reminders view").toBe(200);
  return ((await response.json()).data as Array<{ body: string }>).map((item) => item.body);
}

const failure = (code: string) => ({ status: code === "validation" ? 400 : 500, contentType: "application/json", body: JSON.stringify({ ok: false, code, message: "", data: null }) });

test("BUG-0096: the Create dialog is centred in the viewport at every width and holds during a request", async ({ browser, baseURL }) => {
  const host = await newMember(browser, appOrigin(baseURL), "0096", "Study Host");
  try {
    const page = await openStudyGroups(host);
    for (const [width, height] of [[1440, 900], [1024, 768], [768, 1024], [375, 812]]) {
      await page.setViewportSize({ width, height });
      await page.getByRole("button", { name: "+ Create Study Group" }).click();
      const form = page.getByRole("dialog").locator("form");
      const box = await form.boundingBox();
      expect(box, `form box at ${width}`).not.toBeNull();
      expect(Math.abs(box!.x + box!.width / 2 - width / 2), `horizontally centred at ${width}`).toBeLessThanOrEqual(2);
      expect(Math.abs(box!.y + box!.height / 2 - height / 2), `vertically centred at ${width}`).toBeLessThanOrEqual(2);
      // The overlay covers the whole viewport, header and sidebar included.
      const overlay = await page.getByRole("dialog").boundingBox();
      expect(overlay).toMatchObject({ x: 0, y: 0, width, height });
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
    // A short window scrolls inside the form.
    await page.setViewportSize({ width: 1440, height: 500 });
    await page.getByRole("button", { name: "+ Create Study Group" }).click();
    const form = page.getByRole("dialog").locator("form");
    expect(await form.evaluate((element) => element.scrollHeight > element.clientHeight && getComputedStyle(element).overflowY !== "visible")).toBe(true);
    // Escape while the create request is in flight does not close it.
    await page.setViewportSize({ width: 1440, height: 900 });
    await form.locator('input[name="title"]').fill(unique("E2E 0096"));
    await form.locator('select[name="courseId"]').selectOption({ index: 1 });
    await form.locator('textarea[name="about"]').fill("Escape during the request.");
    await page.route("**/api/study-groups", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      await route.continue();
    });
    await form.getByRole("button", { name: "Create Study Group" }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByText("Study Group Created")).toBeVisible();
  } finally {
    await host.context.close();
  }
});

test("BUG-0097 / BUG-0110: a created group closes the form, opens as Host, and the next form starts empty; a double click creates one", async ({ browser, baseURL }) => {
  const host = await newMember(browser, appOrigin(baseURL), "0097", "Study Host");
  try {
    const page = await openStudyGroups(host);
    const title = unique("E2E 0097");
    await page.getByRole("button", { name: "+ Create Study Group" }).click();
    const form = page.getByRole("dialog").locator("form");
    await form.locator('input[name="title"]').fill(title);
    await form.locator('select[name="courseId"]').selectOption({ index: 1 });
    await form.locator('textarea[name="about"]').fill("Created from the E2E.");
    await form.getByRole("button", { name: "Create Study Group" }).dblclick();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText("Study Group Created")).toBeVisible();
    const mine = await (await host.context.request.get("/api/study-groups?view=mine")).json();
    expect((mine.data as Array<{ title: string }>).filter((group) => group.title === title), "one group for a double click").toHaveLength(1);
    await page.getByRole("button", { name: "Open Group" }).click();
    await expect(page.getByRole("heading", { level: 2, name: title })).toBeVisible();
    await expect(page.getByText("Hosting", { exact: true })).toBeVisible();

    // The next Create form is empty.
    await page.getByRole("button", { name: "+ Create Study Group" }).click();
    await expect(form.locator('input[name="title"]')).toHaveValue("");
    await expect(form.locator('textarea[name="about"]')).toHaveValue("");

    // A network failure keeps the form open with the network message.
    await form.locator('input[name="title"]').fill(unique("E2E 0097 offline"));
    await form.locator('select[name="courseId"]').selectOption({ index: 1 });
    await form.locator('textarea[name="about"]').fill("This one fails.");
    await page.route("**/api/study-groups", (route) => route.request().method() === "POST" ? route.abort() : route.continue());
    await form.getByRole("button", { name: "Create Study Group" }).click();
    await expect(page.getByRole("dialog").getByRole("alert")).toHaveText("The connection failed. Check your network and try again.");
    await expect(page.getByRole("dialog")).toBeVisible();
  } finally {
    await host.context.close();
  }
});

test("BUG-0120: a new group is first under All and Hosted by Me, and stays first", async ({ browser, baseURL }) => {
  const host = await newMember(browser, appOrigin(baseURL), "0120", "Study Host");
  try {
    for (let index = 0; index < 3; index += 1) await createGroup(host, unique(`E2E 0120 old ${index}`));
    const newest = unique("E2E 0120 newest");
    await createGroup(host, newest);
    const page = await openStudyGroups(host);
    const myCards = page.getByRole("complementary", { name: "Study Groups" }).locator("button h3");
    await expect(myCards.first()).toHaveText(newest);
    await page.getByRole("button", { name: "Hosted by Me" }).click();
    await expect(myCards.first()).toHaveText(newest);
    await page.waitForTimeout(7_000);
    await expect(myCards.first(), "a poll does not reorder").toHaveText(newest);
    await page.reload();
    await expect(myCards.first()).toHaveText(newest);
  } finally {
    await host.context.close();
  }
});

test("BUG-0116 / BUG-0101: About stops at 200 characters, keeps emoji and lines, and long words wrap", async ({ browser, baseURL }) => {
  const host = await newMember(browser, appOrigin(baseURL), "0116", "Study Host");
  try {
    const page = await openStudyGroups(host);
    await page.getByRole("button", { name: "+ Create Study Group" }).click();
    const form = page.getByRole("dialog").locator("form");
    await form.locator('textarea[name="about"]').fill("a".repeat(300));
    await expect(form.locator('textarea[name="about"]')).toHaveValue("a".repeat(200));
    await expect(form.getByText("200/200")).toBeVisible();
    await page.keyboard.press("Escape");

    // The API refuses 201 characters.
    const tooLong = await host.context.request.post("/api/study-groups", { data: { title: unique("E2E 0116"), courseId: "epicureanism", about: "b".repeat(201) } });
    expect(tooLong.status()).toBe(400);
    expect((await tooLong.json()).code).toBe("validation");

    // Emoji and several lines save; the edit dialog clamps the same way.
    const groupId = await createGroup(host, unique("E2E 0116"), "第一行 🙂\nsecond line");
    expect((await (await host.context.request.get(`/api/study-groups/${groupId}`)).json()).data.about).toBe("第一行 🙂\nsecond line");
    const groupPage = await openGroupPage(host, groupId);
    await groupPage.getByRole("button", { name: "Edit Group" }).click();
    const about = groupPage.getByRole("dialog").locator('textarea[name="about"]');
    await about.fill("c".repeat(300));
    await expect(about).toHaveValue("c".repeat(200));

    // BUG-0101: 200 letters without a space wrap inside the column, on a phone too.
    const longWord = await createGroup(host, unique("E2E 0101"), "x".repeat(200));
    const longPage = await openGroupPage(host, longWord);
    for (const width of [1440, 375]) {
      await longPage.setViewportSize({ width, height: 900 });
      await expect(longPage.getByText("x".repeat(200)).first()).toBeVisible();
      expect(await noHorizontalScroll(longPage), `no sideways scroll at ${width}`).toBe(true);
    }
    await longPage.setViewportSize({ width: 1440, height: 900 });
    await longPage.getByRole("button", { name: "Schedule Live Session" }).click();
    expect(await longPage.getByRole("dialog").locator("form").evaluate((element) => element.scrollWidth <= element.clientWidth), "the schedule dialog wraps the About").toBe(true);
  } finally {
    await host.context.close();
  }
});

test("BUG-0129: many groups scroll inside the sidebar on a desktop, down to the last one", async ({ browser, baseURL }) => {
  const host = await newMember(browser, appOrigin(baseURL), "0129", "Study Host");
  try {
    const titles: string[] = [];
    for (let index = 0; index < 11; index += 1) {
      const title = unique(`E2E 0129 ${index}`);
      await createGroup(host, title);
      titles.push(title);
    }
    const page = await host.context.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/en-GB/portal/study-groups");
    const sidebar = page.getByRole("complementary", { name: "Study Groups" });
    await expect(sidebar.getByRole("heading", { name: titles[0] })).toBeVisible();
    expect(await sidebar.evaluate((element) => element.scrollHeight > element.clientHeight), "the sidebar scrolls").toBe(true);
    // The sidebar is capped to the viewport below the 68px header, so the
    // groups no longer stretch the page.
    expect(await sidebar.evaluate((element) => element.getBoundingClientRect().height <= window.innerHeight - 68 + 1), "the sidebar fits the viewport").toBe(true);
    const oldest = sidebar.getByRole("button", { name: new RegExp(titles[0]) }).first();
    await oldest.scrollIntoViewIfNeeded();
    await oldest.click();
    await expect(page.getByRole("heading", { level: 2, name: titles[0] })).toBeVisible();
  } finally {
    await host.context.close();
  }
});

test("BUG-0130: a signed-out visitor sees no My Study Groups, Create or tabs, in English and Chinese", async ({ browser, baseURL }) => {
  const origin = appOrigin(baseURL);
  const visitor = await browser.newContext({ baseURL: origin });
  const host = await newMember(browser, origin, "0130", "Study Host");
  try {
    const page = await visitor.newPage();
    // The controls a visitor cannot use: the My Study Groups heading, the
    // Create button and the All / Hosted by Me tabs. (The empty pane's own
    // "Select a Study Group or Create Study Group" line is design copy.)
    for (const [locale, words] of [["en-GB", ["My Study Groups", "Create Study Group", "Hosted by Me"]], ["zh-CN", ["我的学习小组", "创建学习小组", "我主持的"]]] as const) {
      await page.goto(`/${locale}/portal/study-groups`);
      await expect(page.locator("aside h1")).toBeVisible();
      const [mine, create, hosted] = words;
      await expect(page.getByRole("heading", { name: mine })).toHaveCount(0);
      await expect(page.getByRole("button", { name: create })).toHaveCount(0);
      await expect(page.getByRole("button", { name: hosted })).toHaveCount(0);
    }
    const signedIn = await openStudyGroups(host);
    await expect(signedIn.getByRole("heading", { name: "My Study Groups" })).toBeVisible();
    await expect(signedIn.getByRole("button", { name: "+ Create Study Group" })).toBeVisible();
    await expect(signedIn.getByRole("button", { name: "Hosted by Me" })).toBeVisible();
  } finally {
    await visitor.close();
    await host.context.close();
  }
});

test("BUG-0102 / BUG-0128: long titles wrap in the schedule and edit dialogs; Session Title stops at 50", async ({ browser, baseURL }) => {
  const host = await newMember(browser, appOrigin(baseURL), "0102", "Study Host");
  try {
    const groupId = await createGroup(host, "T".repeat(50), "A".repeat(200));
    await scheduleSession(host, groupId, { title: "S".repeat(50), startsInMs: 3 * HOUR });
    const page = await openGroupPage(host, groupId);
    const form = page.getByRole("dialog").locator("form");
    for (const opener of ["Schedule Live Session", "Edit Session"]) {
      await page.getByRole("button", { name: opener }).click();
      expect(await form.evaluate((element) => element.scrollWidth <= element.clientWidth), `${opener} wraps`).toBe(true);
      if (opener === "Schedule Live Session") {
        await form.locator('input[name="title"]').fill("Q".repeat(60));
        await expect(form.locator('input[name="title"]')).toHaveValue("Q".repeat(50));
        await expect(form.getByText("50/50")).toBeVisible();
      }
      await form.getByRole("button", { name: "Cancel" }).click();
    }
    const tooLong = await host.context.request.post(`/api/study-groups/${groupId}/sessions`, { data: { title: "L".repeat(51), startsAt: new Date(Date.now() + 5 * HOUR).toISOString(), durationSeconds: 1800, maxParticipants: 4, aiTutorEnabled: true } });
    expect(tooLong.status()).toBe(400);
    expect((await tooLong.json()).code).toBe("validation");
  } finally {
    await host.context.close();
  }
});

test("BUG-0106 / BUG-0100: an error shows once, inside the dialog, and is gone after a success", async ({ browser, baseURL }) => {
  const origin = appOrigin(baseURL);
  const host = await newMember(browser, origin, "0106-a", "Study Host");
  const member = await newMember(browser, origin, "0106-b", "Study Guest");
  try {
    const groupId = await createGroup(host, unique("E2E 0106"));
    await joinGroup(member, groupId);
    const page = await openGroupPage(host, groupId);
    await page.getByRole("button", { name: "Schedule Live Session" }).click();
    await fillSchedule(page, { title: "Fails then works", startsAt: new Date(Date.now() + 3 * HOUR) });
    let failNext = true;
    await page.route(`**/api/study-groups/${groupId}/sessions`, (route) => {
      if (route.request().method() === "POST" && failNext) {
        failNext = false;
        return route.fulfill(failure("validation"));
      }
      return route.continue();
    });
    await page.getByRole("dialog").getByRole("button", { name: "Schedule Session" }).click();
    await expect(appAlerts(page)).toHaveCount(1);
    await expect(page.getByRole("dialog").getByRole("alert")).toHaveText("Check the required fields and try again.");
    await page.getByRole("dialog").getByRole("button", { name: "Schedule Session" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Fails then works" })).toBeVisible();
    await expect(appAlerts(page)).toHaveCount(0);

    // Plan to Attend: fails once, then works, and no red text stays behind.
    const memberPage = await openGroupPage(member, groupId);
    let planFails = true;
    await memberPage.route("**/api/study-groups/sessions/*/plan", (route) => {
      if (planFails) {
        planFails = false;
        return route.fulfill(failure("error"));
      }
      return route.continue();
    });
    await memberPage.getByRole("button", { name: "Plan to Attend" }).click();
    await expect(appAlerts(memberPage)).toHaveText("Something went wrong. Try again.");
    await memberPage.getByRole("button", { name: "Plan to Attend" }).click();
    await expect(memberPage.getByText("You are planning to attend this session.")).toBeVisible();
    await expect(appAlerts(memberPage)).toHaveCount(0);
  } finally {
    await host.context.close();
    await member.context.close();
  }
});

test("BUG-0157: an upcoming session lets only its date and start time change", async ({ browser, baseURL }) => {
  const origin = appOrigin(baseURL);
  const host = await newMember(browser, origin, "0157-a", "Study Host");
  const member = await newMember(browser, origin, "0157-b", "Study Guest");
  try {
    const groupId = await createGroup(host, unique("E2E 0157"));
    await joinGroup(member, groupId);
    const sessionId = await scheduleSession(host, groupId, { title: "Time only", startsInMs: 3 * HOUR });
    const page = await openGroupPage(host, groupId);
    await page.getByRole("button", { name: "Edit Session" }).click();
    const form = page.getByRole("dialog").locator("form");
    for (const name of ["title", "lesson", "durationMinutes", "maxParticipants", "focus", "aiTutor"]) {
      await expect(form.locator(`[name="${name}"]`), `${name} is locked`).toBeDisabled();
    }
    await expect(form.locator('[name="date"]')).toBeEnabled();
    await expect(form.locator('[name="time"]')).toBeEnabled();
    const later = new Date(Date.now() + 5 * HOUR);
    const { date, time } = localParts(later);
    await form.locator('[name="date"]').fill(date);
    await form.locator('[name="time"]').fill(time);
    await form.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(Date.parse((await sessionView(host, sessionId)).startsAt)).toBe(Date.parse(new Date(`${date}T${time}`).toISOString()));

    const patch = (who: Member, data: Record<string, unknown>) => who.context.request.patch(`/api/study-groups/sessions/${sessionId}`, { data: { groupId, ...data } });
    const otherTitle = await patch(host, { title: "Another title" });
    expect(otherTitle.status()).toBe(403);
    expect((await otherTitle.json()).code).toBe("session_time_only");
    expect((await patch(host, { title: "Time only", maxParticipants: 4 })).status(), "unchanged values are accepted").toBe(200);
    const notHost = await patch(member, { startsAt: new Date(Date.now() + 6 * HOUR).toISOString() });
    expect(notHost.status()).toBe(403);
    expect((await notHost.json()).code).toBe("forbidden");
  } finally {
    await host.context.close();
    await member.context.close();
  }
});

test("BUG-0107: Close and Escape leave the waiting dialog and free the seat; the Host's start brings the member in", async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const origin = appOrigin(baseURL);
  const host = await newMember(browser, origin, "0107-a", "Study Host");
  const member = await newMember(browser, origin, "0107-b", "Study Guest");
  try {
    const groupId = await createGroup(host, unique("E2E 0107"));
    await joinGroup(member, groupId);
    const sessionId = await scheduleSession(host, groupId, { title: "Waiting room", startsInMs: 5 * 60_000 });
    const page = await openGroupPage(member, groupId);
    const waiting = page.getByText("Waiting for the host to start the session...");

    await page.getByRole("button", { name: "Join now" }).click();
    await expect(waiting).toBeVisible();
    expect((await sessionView(host, sessionId)).occupancy).toBe(1);
    await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
    await expect(waiting).toHaveCount(0);
    await expect.poll(async () => (await sessionView(host, sessionId)).occupancy).toBe(0);

    await page.getByRole("button", { name: "Join now" }).click();
    await expect(waiting).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(waiting).toHaveCount(0);
    await expect.poll(async () => (await sessionView(host, sessionId)).occupancy).toBe(0);

    await page.getByRole("button", { name: "Join now" }).click();
    await expect(waiting).toBeVisible();
    const hostPage = await openGroupPage(host, groupId);
    await hostPage.getByRole("button", { name: "Start Live Session" }).click();
    await page.waitForURL(new RegExp(roomPath(sessionId)), { timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Share" })).toBeEnabled();
  } finally {
    await host.context.close();
    await member.context.close();
  }
});

test("BUG-0109: a reminder goes away when its session is cancelled, unplanned, left, its group cancelled or it starts", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const origin = appOrigin(baseURL);
  const host = await newMember(browser, origin, "0109-a", "Study Host");
  const member = await newMember(browser, origin, "0109-b", "Study Guest");
  try {
    const main = await createGroup(host, unique("E2E 0109 main"));
    const toLeave = await createGroup(host, unique("E2E 0109 leave"));
    const toCancel = await createGroup(host, unique("E2E 0109 cancel"));
    for (const id of [main, toLeave, toCancel]) await joinGroup(member, id);
    const titles = { cancelled: unique("Session cancelled"), unplanned: unique("Unplanned"), started: unique("Started"), left: unique("Left"), groupCancelled: unique("Group cancelled") };
    const ids = {
      cancelled: await scheduleSession(host, main, { title: titles.cancelled, startsInMs: 8 * 60_000 }),
      unplanned: await scheduleSession(host, main, { title: titles.unplanned, startsInMs: 8 * 60_000 }),
      started: await scheduleSession(host, main, { title: titles.started, startsInMs: 8 * 60_000 }),
      left: await scheduleSession(host, toLeave, { title: titles.left, startsInMs: 8 * 60_000 }),
      groupCancelled: await scheduleSession(host, toCancel, { title: titles.groupCancelled, startsInMs: 8 * 60_000 }),
    };
    for (const id of Object.values(ids)) expect((await member.context.request.post(`/api/study-groups/sessions/${id}/plan`, { data: {} })).status()).toBe(200);
    const reminder = (title: string) => `${title} starts in 10 minutes.`;
    await expect.poll(async () => {
      const shown = await remindersFor(member);
      return Object.values(titles).every((title) => shown.includes(reminder(title)));
    }, { timeout: 60_000, intervals: [3_000] }).toBe(true);
    // The Host is reminded as well, and the page shows the strip.
    expect(await remindersFor(host)).toContain(reminder(titles.cancelled));
    const page = await openStudyGroups(member);
    await expect(page.getByRole("status").filter({ hasText: reminder(titles.cancelled) })).toBeVisible();

    const gone = async (title: string) => expect.poll(async () => (await remindersFor(member)).includes(reminder(title)), { timeout: 5_000 }).toBe(false);
    expect((await host.context.request.post(`/api/study-groups/sessions/${ids.cancelled}/cancel`, { data: {} })).status()).toBe(200);
    await gone(titles.cancelled);
    expect((await member.context.request.post(`/api/study-groups/sessions/${ids.unplanned}/cancel-attendance`, { data: {} })).status()).toBe(200);
    await gone(titles.unplanned);
    expect((await host.context.request.post(`/api/study-groups/sessions/${ids.started}/start`, { data: {} })).status()).toBe(200);
    await gone(titles.started);
    expect((await member.context.request.post(`/api/study-groups/${toLeave}/leave`, { data: {} })).status()).toBe(200);
    await gone(titles.left);
    expect((await host.context.request.post(`/api/study-groups/${toCancel}/cancel`, { data: {} })).status()).toBe(200);
    await gone(titles.groupCancelled);
    await expect(page.getByRole("status").filter({ hasText: reminder(titles.cancelled) })).toHaveCount(0, { timeout: 8_000 });
  } finally {
    await host.context.close();
    await member.context.close();
  }
});

test("BUG-0119: a learner without access reaches the Course and Subscription pages from Study Groups without an error page", async ({ browser, baseURL }) => {
  const origin = appOrigin(baseURL);
  const host = await newMember(browser, origin, "0119-a", "Study Host");
  const learner = await newMember(browser, origin, "0119-b", "New Learner", { entitle: false });
  try {
    const groupId = await createGroup(host, unique("E2E 0119"));
    const page = await openGroupPage(learner, groupId);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.getByRole("link", { name: "View Course" }).click();
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("Application error")).toHaveCount(0);
    await page.goto(groupPath(groupId));
    await page.getByRole("link", { name: "Subscription" }).first().click();
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("Application error")).toHaveCount(0);
    expect(errors.filter((message) => /RangeError/.test(message))).toEqual([]);
    expect((await groupView(host, groupId)).memberCount).toBe(1);
  } finally {
    await host.context.close();
    await learner.context.close();
  }
});
