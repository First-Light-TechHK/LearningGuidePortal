import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "playwright/test";
import {
  appAlerts,
  createGroup,
  enterSession,
  groupPath,
  joinGroup,
  newMember,
  openLiveRoom,
  scheduleSession,
  sessionView,
  type Member,
} from "./study-group-helpers";

// One regression lock per groups-page item of the second SG QA round
// (lg-qa/sg-tutor-qa-2026-10-19.md section 二 M1-M27 and the final review's
// r1-F-3, r2-B4 / r1-F-4, r4-N10 and r4-N12-a). Each test is named after the
// item it locks.

test.skip(Boolean(process.env.CI), "local-only Study Group E2E; CI does not run e2e");

const HOUR = 60 * 60_000;
// Starts within the 10 minute window, so members can wait for the Host.
const SOON_MS = 90_000;

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

async function noHorizontalScroll(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
}

function apiFailure(code: string) {
  return { status: code === "unauthenticated" ? 401 : 500, contentType: "application/json", body: JSON.stringify({ ok: false, code, message: "", data: null }) };
}

// A member of the Host's group, waiting in the dialog for a session that starts soon.
async function waitInDialog(member: Member, groupId: string, sessionTitle: string) {
  const page = await openGroupPage(member, groupId);
  const card = page.locator("article article").filter({ hasText: sessionTitle });
  await card.getByRole("button", { name: "Join now" }).click();
  await expect(page.getByRole("dialog").getByText("Waiting for the host to start the session...")).toBeVisible();
  return page;
}

test("r2-B4 / r1-F-4: the waiting dialog renews when visible or online, and a full re-enter closes it with the error", async ({ browser, baseURL }) => {
  const origin = appOrigin(baseURL);
  const host = await newMember(browser, origin, "b4-a", "Study Host");
  const member = await newMember(browser, origin, "b4-b", "Study Guest");
  try {
    const groupId = await createGroup(host, unique("E2E r2-B4"));
    await joinGroup(member, groupId);
    await scheduleSession(host, groupId, { title: "Waiting room", startsInMs: SOON_MS });
    const page = await waitInDialog(member, groupId, "Waiting room");
    const beats: string[] = [];
    page.on("request", (request) => { if (request.url().endsWith("/heartbeat")) beats.push(request.url()); });

    // Well inside the 10 s interval: only the events can send these.
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect.poll(() => beats.length, { timeout: 2_000 }).toBe(1);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(() => beats.length, { timeout: 2_000 }).toBe(2);

    // The seat lapsed and someone took the last place meanwhile.
    await page.route("**/api/study-groups/sessions/*/heartbeat", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, code: "ok", message: "", data: { seated: false, occupancy: 2, state: "starting_soon" } }) }));
    await page.route("**/api/study-groups/sessions/*/enter", (route) => route.fulfill({ ...apiFailure("session_full"), status: 409 }));
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(appAlerts(page)).toHaveText("Session full.");
  } finally {
    await host.context.close();
    await member.context.close();
  }
});

test("r1-F-3: an empty title is reported before a Start Time in the past", async ({ browser, baseURL }) => {
  const now = new Date();
  test.skip(now.getHours() === 0 && now.getMinutes() < 2, "needs a time earlier today");
  const host = await newMember(browser, appOrigin(baseURL), "f3", "Study Host");
  try {
    const groupId = await createGroup(host, unique("E2E r1-F-3"));
    const page = await openGroupPage(host, groupId);
    await page.getByRole("button", { name: "Schedule Live Session" }).click();
    const dialog = page.getByRole("dialog");
    const pad = (value: number) => String(value).padStart(2, "0");
    await dialog.locator('input[name="date"]').fill(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`);
    await dialog.locator('input[name="time"]').fill("00:00");
    await dialog.getByRole("button", { name: "Schedule Session" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("Check the required fields and try again.");
    await dialog.locator('input[name="title"]').fill("Morning review");
    await dialog.locator('select[name="durationMinutes"]').selectOption({ index: 1 });
    await dialog.locator('select[name="maxParticipants"]').selectOption("4");
    await dialog.getByRole("button", { name: "Schedule Session" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("Start Time must be in the future.");
  } finally {
    await host.context.close();
  }
});

test("r4-N10: a refresh clears the group error, a lost sign-in shows, a failed search shows, a healed page has no stale error", async ({ browser, baseURL }) => {
  const origin = appOrigin(baseURL);
  const host = await newMember(browser, origin, "n10r-a", "Study Host");
  const member = await newMember(browser, origin, "n10r-b", "Study Guest");
  try {
    const title = unique("E2E r4-N10");
    const groupId = await createGroup(host, title);
    await joinGroup(member, groupId);

    // N10-d: the first lists load fails, then a poll heals it: no error stays behind.
    const page = await member.context.newPage();
    const mineRoute = "**/api/study-groups?view=mine*";
    await page.route(mineRoute, (route) => route.fulfill(apiFailure("error")));
    await page.goto(groupPath(groupId));
    await expect(appAlerts(page)).toHaveText(/Something went wrong/);
    await page.unroute(mineRoute);
    await expect(page.getByRole("heading", { level: 2, name: title })).toBeVisible({ timeout: 10_000 });
    await expect(appAlerts(page)).toHaveCount(0);

    // N10-a: opening the group fails, then the 3 s refresh loads it and the panel goes.
    const groupRoute = `**/api/study-groups/${groupId}`;
    await page.route(groupRoute, (route) => route.fulfill(apiFailure("error")));
    await page.reload();
    const failed = appAlerts(page).filter({ has: page.getByRole("button", { name: "Try again" }) });
    await expect(failed).toBeVisible();
    await page.unroute(groupRoute);
    await expect(page.getByRole("heading", { level: 2, name: title })).toBeVisible({ timeout: 10_000 });
    await expect(failed).toHaveCount(0);

    // N10-b: the sign-in expires; the poll puts up the sign-in link.
    const listsRoute = "**/api/study-groups?view=*";
    await page.route(listsRoute, (route) => route.fulfill(apiFailure("unauthenticated")));
    const expired = appAlerts(page).filter({ hasText: "Sign in is required." });
    await expect(expired).toBeVisible({ timeout: 10_000 });
    await expect(expired.getByRole("link", { name: "Sign In" })).toHaveAttribute("href", /returnTo=/);
    await page.unroute(listsRoute);

    // N10-c: a signed-out visitor's search fails: it says so.
    const visitor = await browser.newContext({ baseURL: origin });
    const visitorPage = await visitor.newPage();
    await visitorPage.goto("/en-GB/portal/study-groups");
    await expect(visitorPage.getByRole("heading", { level: 3, name: title })).toBeVisible();
    await visitorPage.route("**/api/study-groups?view=discover*", (route) => route.fulfill(apiFailure("error")));
    await visitorPage.getByRole("textbox", { name: "Keyword search..." }).fill("anything");
    await expect(appAlerts(visitorPage).filter({ has: visitorPage.getByRole("button", { name: "Try again" }) })).toBeVisible();
    await visitor.close();
  } finally {
    await host.context.close();
    await member.context.close();
  }
});

test("r4-N12-a: on a phone, the details pane is in view while the group is still loading", async ({ browser, baseURL }) => {
  const host = await newMember(browser, appOrigin(baseURL), "n12a", "Study Host");
  try {
    const titles = [] as string[];
    for (let index = 0; index < 6; index += 1) {
      const title = unique(`E2E N12-a ${index}`);
      await createGroup(host, title);
      titles.push(title);
    }
    const page = await host.context.newPage();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/en-GB/portal/study-groups");
    await page.route("**/api/study-groups/*", async (route) => {
      if (route.request().method() === "GET" && !route.request().url().includes("view=")) await new Promise((resolve) => setTimeout(resolve, 4_000));
      await route.continue().catch(() => undefined);
    });
    const card = page.getByRole("button", { name: new RegExp(titles[0]) }).first();
    await card.scrollIntoViewIfNeeded();
    await card.click();
    await expect(page.getByRole("status").filter({ hasText: "Loading Study Groups" })).toBeInViewport({ timeout: 3_000 });
  } finally {
    await host.context.close();
  }
});

test("M1: a 50-character unbroken title wraps everywhere on a phone and About keeps its line breaks", async ({ browser, baseURL }) => {
  const host = await newMember(browser, appOrigin(baseURL), "m1", "Study Host");
  try {
    const title = `${"W".repeat(40)}${Date.now().toString(36)}`.slice(0, 50);
    const groupId = await createGroup(host, title, "First line\nSecond line");
    await scheduleSession(host, groupId, { title: "S".repeat(50), startsInMs: 3 * HOUR });
    const page = await host.context.newPage();
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(groupPath(groupId));
    await expect(page.getByRole("heading", { level: 2, name: title })).toBeVisible();
    await expect(page.getByRole("heading", { level: 3, name: title })).toBeVisible();
    await expect(page.getByRole("heading", { level: 3, name: "S".repeat(50) })).toBeVisible();
    expect(await noHorizontalScroll(page), "no sideways scroll at 375px").toBe(true);
    const about = page.getByText("First line");
    expect(await about.evaluate((element) => getComputedStyle(element).whiteSpace)).toBe("pre-line");
    expect(await about.evaluate((element) => (element as HTMLElement).innerText)).toBe("First line\nSecond line");
  } finally {
    await host.context.close();
  }
});

test("M2: Hosted by Me has its own empty line, and nothing says 'no groups' while the lists load", async ({ browser, baseURL }) => {
  const origin = appOrigin(baseURL);
  const host = await newMember(browser, origin, "m2-a", "Study Host");
  const member = await newMember(browser, origin, "m2-b", "Study Guest");
  try {
    const title = unique("E2E M2");
    const groupId = await createGroup(host, title);
    await joinGroup(member, groupId);
    const page = await member.context.newPage();
    await page.route("**/api/study-groups?view=mine*", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      await route.continue().catch(() => undefined);
    });
    await page.goto("/en-GB/portal/study-groups");
    await page.waitForTimeout(1_000);
    await expect(page.getByText("You haven't joined any Study Group yet.")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 3, name: title }).first()).toBeVisible();
    await expect(page.getByText("You haven't joined any Study Group yet.")).toHaveCount(0);
    await page.getByRole("button", { name: "Hosted by Me" }).click();
    await expect(page.getByText("You aren't hosting any Study Group yet.")).toBeVisible();
  } finally {
    await host.context.close();
    await member.context.close();
  }
});

test("M3: the search waits for typing to stop, asks for Discover only, and says when nothing matches", async ({ browser, baseURL }) => {
  const host = await newMember(browser, appOrigin(baseURL), "m3", "Study Host");
  try {
    const title = unique("E2E M3");
    await createGroup(host, title);
    const page = await host.context.newPage();
    await page.goto("/en-GB/portal/study-groups");
    await expect(page.getByRole("heading", { level: 3, name: title })).toBeVisible();
    // Hold the next 3 s poll in flight: a poll never starts while another
    // load runs (until the 15 s request timeout, QA3 #1), so every request
    // from here on comes from the search.
    let heldPolls = 0;
    await page.route("**/api/study-groups?view=mine*", () => { heldPolls += 1; });
    await expect.poll(() => heldPolls, { timeout: 10_000 }).toBeGreaterThan(0);
    const requests: URL[] = [];
    page.on("request", (request) => { if (request.url().includes("/api/study-groups?view=")) requests.push(new URL(request.url())); });
    const needle = `zz${Date.now().toString(36)}`;
    await page.getByRole("textbox", { name: "Keyword search..." }).pressSequentially(needle, { delay: 60 });
    await expect(page.getByText("No Study Groups match your search.")).toBeVisible();
    expect(requests.map((url) => [url.searchParams.get("view"), url.searchParams.get("q")]), "one Discover request, once the typing stopped").toEqual([["discover", needle]]);
  } finally {
    await host.context.close();
  }
});

test("M4: without Course access, Create explains it, links to Courses and cannot be pressed", async ({ browser, baseURL }) => {
  const learner = await newMember(browser, appOrigin(baseURL), "m4", "No Access", { entitle: false });
  try {
    const page = await learner.context.newPage();
    await page.goto("/en-GB/portal/study-groups");
    await page.getByRole("button", { name: "+ Create Study Group" }).click();
    const form = page.getByRole("dialog").locator("form");
    await expect(form.getByText("You need access to a Course before you can create a Study Group for it.")).toBeVisible();
    await expect(form.getByRole("link", { name: "View Courses" })).toHaveAttribute("href", "/en-GB/portal/courses");
    await expect(form.getByRole("button", { name: "Create Study Group" })).toBeDisabled();
  } finally {
    await learner.context.close();
  }
});

test("M5: a group's join gate shows no Live Sessions count; members see it", async ({ browser, baseURL }) => {
  const origin = appOrigin(baseURL);
  const host = await newMember(browser, origin, "m5-a", "Study Host");
  const learner = await newMember(browser, origin, "m5-b", "Study Guest");
  try {
    const groupId = await createGroup(host, unique("E2E M5"));
    await scheduleSession(host, groupId, { title: "Counted session", startsInMs: 3 * HOUR });
    const page = await openGroupPage(learner, groupId);
    await expect(page.getByText("Join this Study Group to view its Live Sessions")).toBeVisible();
    const badge = page.locator('span:text-is("Live Sessions") + span');
    await expect(badge).toHaveCount(0);
    await page.getByRole("button", { name: "Join Now" }).click();
    await expect(page.getByRole("heading", { level: 3, name: "Counted session" })).toBeVisible();
    await expect(badge).toHaveText("1");
  } finally {
    await host.context.close();
    await learner.context.close();
  }
});

test("M6: a signed-out visitor is asked to sign in to join, and every Sign In comes back to the open group", async ({ browser, baseURL }) => {
  const origin = appOrigin(baseURL);
  const host = await newMember(browser, origin, "m6", "Study Host");
  const visitor = await browser.newContext({ baseURL: origin });
  try {
    const title = unique("E2E M6");
    const groupId = await createGroup(host, title);
    const page = await visitor.newPage();
    await page.goto("/en-GB/portal/study-groups");
    const header = page.locator("header");
    const emptyPane = page.locator("section").filter({ hasText: "Learn together, not alone." });
    await expect(emptyPane.getByRole("link", { name: "Sign In" })).toHaveAttribute("href", `/en-GB/portal/sign-in?returnTo=${encodeURIComponent("/en-GB/portal/study-groups")}`);
    await page.getByRole("button", { name: new RegExp(title) }).first().click();
    await expect(page.getByRole("heading", { level: 2, name: title })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`[?&]group=${groupId}`));
    await expect(page.getByText("Sign in to join this Study Group.")).toBeVisible();
    await expect(page.getByText(/You don't currently have access/)).toHaveCount(0);
    const returnTo = `returnTo=/en-GB/portal/study-groups?group=${groupId}`;
    await expect.poll(async () => decodeURIComponent((await header.getByRole("link", { name: "Sign In" }).getAttribute("href")) || "")).toContain(returnTo);
    const links = await page.getByRole("link", { name: "Sign In" }).all();
    expect(links.length, "the header and the join gate").toBeGreaterThanOrEqual(2);
    for (const link of links) expect(decodeURIComponent((await link.getAttribute("href")) || "")).toContain(returnTo);
  } finally {
    await visitor.close();
    await host.context.close();
  }
});

test("M8: the English copy reads correctly and a count of one is singular", async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const host = await newMember(browser, appOrigin(baseURL), "m8", "Study Host");
  try {
    const title = unique("E2E M8");
    const groupId = await createGroup(host, title);
    const page = await openGroupPage(host, groupId);
    await expect(page.getByText("There are no Live Sessions yet.")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Keyword search..." })).toHaveAttribute("placeholder", "Keyword search...");
    const card = page.getByRole("button", { name: new RegExp(title) }).first();
    await expect(card.getByText("1 learner", { exact: true })).toBeVisible();

    // One attendee: the Host starts, enters and leaves; the session ends.
    const sessionId = await scheduleSession(host, groupId, { title: "Attended once", startsInMs: 5 * 60_000 });
    expect((await host.context.request.post(`/api/study-groups/sessions/${sessionId}/start`, { data: {} })).status()).toBe(200);
    expect((await enterSession(host, sessionId)).status()).toBe(200);
    expect((await host.context.request.post(`/api/study-groups/sessions/${sessionId}/leave`, { data: {} })).status()).toBe(200);
    await expect.poll(async () => (await sessionView(host, sessionId)).state, { timeout: 120_000 }).toBe("completed");
    await page.reload();
    await expect(page.locator("article article").filter({ hasText: "Attended once" }).getByText("1 member attended")).toBeVisible();
  } finally {
    await host.context.close();
  }
});

test("M9: a cancelled group, a cancelled or moved session closes with a notice; a moved one releases the seat", async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const origin = appOrigin(baseURL);
  const host = await newMember(browser, origin, "m9-a", "Study Host");
  const member = await newMember(browser, origin, "m9-b", "Study Guest");
  try {
    const title = unique("E2E M9");
    const groupId = await createGroup(host, title);
    await joinGroup(member, groupId);

    // The waiting dialog's session moves two hours later: notice, and leave is sent.
    const movedId = await scheduleSession(host, groupId, { title: "Moved session", startsInMs: SOON_MS });
    const page = await waitInDialog(member, groupId, "Moved session");
    const leaves: string[] = [];
    page.on("request", (request) => { if (request.method() === "POST" && request.url().endsWith(`/sessions/${movedId}/leave`)) leaves.push(request.url()); });
    const moved = await host.context.request.patch(`/api/study-groups/sessions/${movedId}`, { data: { groupId, startsAt: new Date(Date.now() + 2 * HOUR).toISOString() } });
    expect(moved.status(), "move the session").toBe(200);
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByRole("status").filter({ hasText: "This Live Session has moved to a later time, so your place was released." })).toBeVisible();
    await expect.poll(() => leaves.length).toBeGreaterThanOrEqual(1);
    await page.close();

    // The waiting dialog's session is cancelled.
    const cancelledId = await scheduleSession(host, groupId, { title: "Cancelled session", startsInMs: SOON_MS });
    const waiting = await waitInDialog(member, groupId, "Cancelled session");
    expect((await host.context.request.post(`/api/study-groups/sessions/${cancelledId}/cancel`, { data: {} })).status()).toBe(200);
    await expect(waiting.getByRole("dialog")).toHaveCount(0, { timeout: 10_000 });
    await expect(waiting.getByRole("status").filter({ hasText: "This Live Session has been cancelled." })).toBeVisible();

    // The Host's own Edit Session dialog: the session is cancelled elsewhere.
    const editedId = await scheduleSession(host, groupId, { title: "Edited session", startsInMs: 3 * HOUR });
    const hostPage = await openGroupPage(host, groupId);
    await hostPage.locator("article article").filter({ hasText: "Edited session" }).getByRole("button", { name: "Edit Session" }).click();
    await expect(hostPage.getByRole("dialog")).toBeVisible();
    expect((await host.context.request.post(`/api/study-groups/sessions/${editedId}/cancel`, { data: {} })).status()).toBe(200);
    await expect(hostPage.getByRole("dialog")).toHaveCount(0, { timeout: 10_000 });
    await expect(hostPage.getByRole("status").filter({ hasText: "This Live Session has been cancelled." })).toBeVisible();

    // The group open on the member's screen is cancelled.
    expect((await host.context.request.post(`/api/study-groups/${groupId}/cancel`, { data: {} })).status()).toBe(200);
    await expect(waiting.getByRole("status").filter({ hasText: "This Study Group has been cancelled." })).toBeVisible({ timeout: 10_000 });
    await expect(waiting.getByRole("heading", { level: 2, name: title })).toHaveCount(0);
  } finally {
    await host.context.close();
    await member.context.close();
  }
});

test("M23: at 375px the session card is one column, the member column has no fixed height, and a menu leads back to Courses and Subscription", async ({ browser, baseURL }) => {
  const host = await newMember(browser, appOrigin(baseURL), "m23", "Study Host");
  try {
    const groupId = await createGroup(host, unique("E2E M23"));
    await scheduleSession(host, groupId, { title: "Phone session", startsInMs: 3 * HOUR });
    const page = await host.context.newPage();
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(groupPath(groupId));
    const session = page.locator("article article").filter({ hasText: "Phone session" });
    await expect(session).toBeVisible();
    expect((await session.evaluate((element) => getComputedStyle(element).gridTemplateColumns)).trim().split(/\s+/), "one column").toHaveLength(1);
    expect(await page.getByRole("complementary", { name: "Members" }).evaluate((element) => getComputedStyle(element).minHeight)).toBe("0px");
    expect(await noHorizontalScroll(page)).toBe(true);
    const menu = page.locator("header details");
    await expect(menu.locator("summary")).toHaveAttribute("aria-label", "Menu");
    await menu.locator("summary").click();
    await expect(menu.getByRole("link", { name: "Courses" })).toBeVisible();
    await expect(menu.getByRole("link", { name: "Subscription" })).toBeVisible();
    await menu.getByRole("link", { name: "Courses" }).click();
    await expect(page).toHaveURL(/\/en-GB\/portal\/courses/);
  } finally {
    await host.context.close();
  }
});

test("M24: the attendees dialog says Nobody yet and closes with Close", async ({ browser, baseURL }) => {
  const host = await newMember(browser, appOrigin(baseURL), "m24", "Study Host");
  try {
    const groupId = await createGroup(host, unique("E2E M24"));
    await scheduleSession(host, groupId, { title: "Nobody here", startsInMs: 3 * HOUR });
    const page = await openGroupPage(host, groupId);
    await page.getByRole("button", { name: "View attendees" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Nobody yet")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Cancel" })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toHaveCount(0);
  } finally {
    await host.context.close();
  }
});

test("M25: Edit Group has the create form's fields and title counter; Session Focus has its own placeholder", async ({ browser, baseURL }) => {
  const host = await newMember(browser, appOrigin(baseURL), "m25", "Study Host");
  try {
    const title = unique("E2E M25");
    const groupId = await createGroup(host, title);
    const page = await openGroupPage(host, groupId);
    const dialog = page.getByRole("dialog");
    await page.getByRole("button", { name: "Edit Group" }).click();
    const input = dialog.locator('input[name="title"]');
    await expect(input).toHaveValue(title);
    await expect(dialog.getByText(`${title.length}/50`)).toBeVisible();
    expect(await input.evaluate((element) => getComputedStyle(element).minHeight), "the create form's field").toBe("42px");
    await input.fill("Renamed");
    await expect(dialog.getByText("7/50")).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("button", { name: "Schedule Live Session" }).click();
    await expect(dialog.locator('textarea[name="focus"]')).toHaveAttribute("placeholder", "Enter the session focus...");
  } finally {
    await host.context.close();
  }
});

test("M26: the created card names the group and Course; Cancel waits while the create request runs", async ({ browser, baseURL }) => {
  const host = await newMember(browser, appOrigin(baseURL), "m26", "Study Host");
  try {
    const page = await host.context.newPage();
    await page.goto("/en-GB/portal/study-groups");
    await page.route("**/api/study-groups", async (route) => {
      if (route.request().method() === "POST") await new Promise((resolve) => setTimeout(resolve, 2_000));
      await route.continue().catch(() => undefined);
    });
    await page.getByRole("button", { name: "+ Create Study Group" }).click();
    const form = page.getByRole("dialog").locator("form");
    const title = unique("E2E M26");
    await form.locator('input[name="title"]').fill(title);
    const course = form.locator('select[name="courseId"]');
    await expect(course.locator("option")).not.toHaveCount(1);
    await course.selectOption({ index: 1 });
    const courseTitle = ((await course.locator("option").nth(1).textContent()) || "").trim();
    await form.locator('textarea[name="about"]').fill("Created from the dialog.");
    await form.getByRole("button", { name: "Create Study Group" }).click();
    await expect(form.getByRole("button", { name: "Cancel" })).toBeDisabled();
    const created = page.getByRole("status").filter({ hasText: "Study Group Created" });
    await expect(created).toBeVisible();
    await expect(created.getByText(title)).toBeVisible();
    await expect(created.getByText(courseTitle, { exact: true })).toBeVisible();
  } finally {
    await host.context.close();
  }
});

test("M27: the header speaks Chinese on zh-CN, the avatar has a name, the chip is right at first paint, chat shows keyboard focus", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const origin = appOrigin(baseURL);
  const learner = await newMember(browser, origin, "m27", "Study Guest");
  try {
    const page = await learner.context.newPage();
    await page.goto("/zh-CN/portal/study-groups");
    await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();
    await expect(page.locator("header").getByRole("link", { name: "我的学习" })).toBeVisible();
    // The first paint, before any script: the server's HTML.
    const html = await (await learner.context.request.get("/zh-CN/portal/study-groups")).text();
    const chip = html.match(/(?:class="[^"]*__lang"|class="portal-language"[^>]*)>(?:<span>)?([^<]+)</);
    expect(chip?.[1]?.toLowerCase(), "the language chip").toBe("zh");
  } finally {
    await learner.context.close();
  }

  const room = await openLiveRoom(browser, origin, "m27");
  try {
    await room.pageB.getByRole("tab", { name: "Chat" }).click();
    const chat = room.pageB.getByRole("textbox", { name: "Chat" });
    await chat.focus();
    expect(await chat.evaluate((element) => getComputedStyle(element.closest("form") as HTMLFormElement).boxShadow)).not.toBe("none");
  } finally {
    await room.close();
  }
});

// QA3 review of the groups page (scratchpad qa3/groups.md). A Course cannot be
// unpublished from a test, so #3 and #8 rewrite the group's answer the way the
// server sends it for such a group.

async function patchGroupAnswer(page: Page, groupId: string, patch: Record<string, unknown>) {
  await page.route(`**/api/study-groups/${groupId}`, async (route) => {
    if (route.request().method() !== "GET") return route.continue().catch(() => undefined);
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, data: body.data ? { ...body.data, ...patch } : body.data } }).catch(() => undefined);
  });
}

const COURSE_GONE = { courseAvailable: false, courseTitle: "", courseSlug: "" };

test("QA3 #1: a list request that never answers stops holding the 3 s poll back", async ({ browser, baseURL }) => {
  test.setTimeout(90_000);
  const host = await newMember(browser, appOrigin(baseURL), "qa3-1", "Study Host");
  try {
    const page = await host.context.newPage();
    await page.goto("/en-GB/portal/study-groups");
    await expect(page.getByText("You haven't joined any Study Group yet.")).toBeVisible();
    // The next poll's My list stalls: no answer, no reset (a phone changing networks).
    let stalled = 0;
    await page.route("**/api/study-groups?view=mine*", async (route) => {
      if (stalled === 0) {
        stalled += 1;
        return;
      }
      await route.continue().catch(() => undefined);
    });
    await expect.poll(() => stalled, { timeout: 10_000 }).toBe(1);
    const title = unique("E2E QA3-1");
    await createGroup(host, title);
    // The stalled request times out after 15 s and the next poll shows the new group.
    await expect(page.getByRole("heading", { level: 3, name: title }).first()).toBeVisible({ timeout: 30_000 });
  } finally {
    await host.context.close();
  }
});

test("QA3 #2: a member whose seat is still held can go back to waiting; another member sees Session full", async ({ browser, baseURL }) => {
  const origin = appOrigin(baseURL);
  const host = await newMember(browser, origin, "qa3-2-a", "Study Host");
  const member = await newMember(browser, origin, "qa3-2-b", "Study Guest");
  const other = await newMember(browser, origin, "qa3-2-c", "Study Other");
  try {
    const groupId = await createGroup(host, unique("E2E QA3-2"));
    await joinGroup(member, groupId);
    await joinGroup(other, groupId);
    // Max 2: the member's seat plus the one kept for the Host.
    const sessionId = await scheduleSession(host, groupId, { title: "Held seat", startsInMs: SOON_MS, maxParticipants: 2 });
    expect((await enterSession(member, sessionId)).status(), "the member holds a seat").toBe(200);

    // The member reloads the page (or opens a second tab) while the seat is held.
    const page = await openGroupPage(member, groupId);
    const card = page.locator("article article").filter({ hasText: "Held seat" });
    await expect(card.getByRole("button", { name: "Join now" })).toBeEnabled();
    await card.getByRole("button", { name: "Join now" }).click();
    await expect(page.getByRole("dialog").getByText("Waiting for the host to start the session...")).toBeVisible();

    const otherPage = await openGroupPage(other, groupId);
    await expect(otherPage.locator("article article").filter({ hasText: "Held seat" }).getByRole("button", { name: "Session full" })).toBeDisabled();
  } finally {
    await host.context.close();
    await member.context.close();
    await other.context.close();
  }
});

test("QA3 #3: a group whose Course is gone only says so, with no Join Now", async ({ browser, baseURL }) => {
  const origin = appOrigin(baseURL);
  const host = await newMember(browser, origin, "qa3-3-a", "Study Host");
  const learner = await newMember(browser, origin, "qa3-3-b", "Study Guest");
  try {
    const title = unique("E2E QA3-3");
    const groupId = await createGroup(host, title);
    const page = await learner.context.newPage();
    // canJoin true as well: the page must not offer joining whatever it says.
    await patchGroupAnswer(page, groupId, { ...COURSE_GONE, canJoin: true });
    await page.goto(groupPath(groupId));
    await expect(page.getByRole("heading", { level: 2, name: title })).toBeVisible();
    await expect(page.getByText("Join this Study Group to view its Live Sessions")).toBeVisible();
    await expect(page.getByText("This Course is no longer available.")).toHaveCount(2);
    await expect(page.getByText(/You have access to this Course/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Join Now" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "View Course", exact: true })).toHaveCount(0);
  } finally {
    await host.context.close();
    await learner.context.close();
  }
});

test("QA3 #4: a group that loads after the lists failed leaves the error pane and its Try again", async ({ browser, baseURL }) => {
  const origin = appOrigin(baseURL);
  const host = await newMember(browser, origin, "qa3-4", "Study Host");
  const visitor = await browser.newContext({ baseURL: origin });
  try {
    const title = unique("E2E QA3-4");
    const groupId = await createGroup(host, title);
    const page = await visitor.newPage();
    await page.route("**/api/study-groups?view=discover*", (route) => route.fulfill(apiFailure("error")));
    let groupAnswered = false;
    await page.route(`**/api/study-groups/${groupId}`, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      await route.continue().catch(() => undefined);
      groupAnswered = true;
    });
    await page.goto(groupPath(groupId));
    const failed = appAlerts(page).filter({ has: page.getByRole("button", { name: "Try again" }) });
    await expect(failed).toBeVisible();
    await expect.poll(() => groupAnswered, { timeout: 10_000 }).toBe(true);
    await page.waitForTimeout(500);
    await expect(failed).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: title })).toHaveCount(0);
  } finally {
    await visitor.close();
    await host.context.close();
  }
});

test("QA3 #5: a refresh sent before Plan to Attend and answered after it does not bring the old button back", async ({ browser, baseURL }) => {
  const origin = appOrigin(baseURL);
  const host = await newMember(browser, origin, "qa3-5-a", "Study Host");
  const member = await newMember(browser, origin, "qa3-5-b", "Study Guest");
  try {
    const groupId = await createGroup(host, unique("E2E QA3-5"));
    await joinGroup(member, groupId);
    await scheduleSession(host, groupId, { title: "Planned later", startsInMs: 3 * HOUR });
    const page = await openGroupPage(member, groupId);
    const card = page.locator("article article").filter({ hasText: "Planned later" });
    await expect(card.getByRole("button", { name: "Plan to Attend" })).toBeVisible();
    // Hold the next 3 s refresh: its answer is read now (not planned yet) and delivered late.
    let holdNext = true;
    let held = 0;
    let release = () => undefined as void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    await page.route(`**/api/study-groups/${groupId}`, async (route) => {
      if (route.request().method() !== "GET" || !holdNext) return route.continue().catch(() => undefined);
      holdNext = false;
      const response = await route.fetch();
      held += 1;
      await released;
      await route.fulfill({ response }).catch(() => undefined);
    });
    await expect.poll(() => held, { timeout: 10_000 }).toBe(1);
    await card.getByRole("button", { name: "Plan to Attend" }).click();
    await expect(card.getByRole("button", { name: "Cancel Attendance" })).toBeVisible();
    release();
    await page.waitForTimeout(300);
    await expect(card.getByRole("button", { name: "Plan to Attend" })).toHaveCount(0);
    await expect(card.getByRole("button", { name: "Cancel Attendance" })).toBeVisible();
  } finally {
    await host.context.close();
    await member.context.close();
  }
});

test("QA3 #6: on a phone, the notice for a session cancelled while waiting is brought into view", async ({ browser, baseURL }) => {
  const origin = appOrigin(baseURL);
  const host = await newMember(browser, origin, "qa3-6-a", "Study Host");
  const member = await newMember(browser, origin, "qa3-6-b", "Study Guest");
  try {
    const groupId = await createGroup(host, unique("E2E QA3-6"));
    // Enough Discover cards that the details start below the first screen.
    for (let index = 0; index < 5; index += 1) await createGroup(host, unique(`E2E QA3-6 other ${index}`));
    await joinGroup(member, groupId);
    const sessionId = await scheduleSession(host, groupId, { title: "Cancelled while waiting", startsInMs: SOON_MS });
    const page = await member.context.newPage();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(groupPath(groupId));
    await page.locator("article article").filter({ hasText: "Cancelled while waiting" }).getByRole("button", { name: "Join now" }).click();
    await expect(page.getByRole("dialog").getByText("Waiting for the host to start the session...")).toBeVisible();
    // The viewer is back up in the sidebar.
    await page.evaluate(() => window.scrollTo(0, 0));
    const details = page.locator("section[aria-live]");
    expect(await details.evaluate((element) => element.getBoundingClientRect().top > window.innerHeight), "the details start below the screen").toBe(true);
    expect((await host.context.request.post(`/api/study-groups/sessions/${sessionId}/cancel`, { data: {} })).status()).toBe(200);
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByRole("status").filter({ hasText: "This Live Session has been cancelled." })).toBeInViewport({ timeout: 5_000 });
  } finally {
    await host.context.close();
    await member.context.close();
  }
});

test("QA3 #7: a ?group= value that is not a Study Group id is not opened", async ({ browser, baseURL }) => {
  const learner = await newMember(browser, appOrigin(baseURL), "qa3-7", "Study Guest");
  try {
    const page = await learner.context.newPage();
    // Unencoded, these reached the My list and the API root as if they were groups.
    for (const value of ["../../api/study-groups?view=mine", ".."]) {
      await page.goto(`/en-GB/portal/study-groups?group=${encodeURIComponent(value)}`);
      await expect(page.getByRole("heading", { level: 2, name: "Learn together, not alone." })).toBeVisible();
      await page.waitForTimeout(3_500);
      await expect(page.getByRole("heading", { level: 2, name: "Learn together, not alone." }), value).toBeVisible();
      await expect(appAlerts(page), value).toHaveCount(0);
    }
  } finally {
    await learner.context.close();
  }
});

test("QA3 #8: Edit Group names an unavailable Course instead of an empty box", async ({ browser, baseURL }) => {
  const host = await newMember(browser, appOrigin(baseURL), "qa3-8", "Study Host");
  try {
    const title = unique("E2E QA3-8");
    const groupId = await createGroup(host, title);
    const page = await host.context.newPage();
    await patchGroupAnswer(page, groupId, COURSE_GONE);
    await page.goto(groupPath(groupId));
    await expect(page.getByRole("heading", { level: 2, name: title })).toBeVisible();
    await page.getByRole("button", { name: "Edit Group" }).click();
    await expect(page.getByRole("dialog").getByText("This Course is no longer available.")).toBeVisible();
  } finally {
    await host.context.close();
  }
});

test("QA3 #9: an unknown group id keeps its not-found panel and is never called cancelled", async ({ browser, baseURL }) => {
  const learner = await newMember(browser, appOrigin(baseURL), "qa3-9", "Study Guest");
  try {
    const page = await learner.context.newPage();
    await page.goto(groupPath(randomUUID()));
    const failed = appAlerts(page).filter({ hasText: "That Study Group or Live Session was not found." });
    await expect(failed).toBeVisible();
    // Past at least one 3 s refresh.
    await page.waitForTimeout(4_500);
    await expect(failed.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(page.getByText("This Study Group has been cancelled.")).toHaveCount(0);
  } finally {
    await learner.context.close();
  }
});

test("QA3 N-a / N-b: a search's outcome is announced, and a failed search shows under the search box while the group stays", async ({ browser, baseURL }) => {
  const host = await newMember(browser, appOrigin(baseURL), "qa3-nb", "Study Host");
  try {
    const title = unique("E2E QA3-Nb");
    const groupId = await createGroup(host, title);
    const page = await openGroupPage(host, groupId);
    await expect(page.getByRole("heading", { level: 2, name: title })).toBeVisible();
    const search = page.getByRole("textbox", { name: "Keyword search..." });
    await search.fill(`zz${Date.now().toString(36)}`);
    await expect(page.getByRole("status").filter({ hasText: "No Study Groups match your search." })).toBeVisible();

    const discoverRoute = "**/api/study-groups?view=discover*";
    await page.route(discoverRoute, (route) => route.fulfill(apiFailure("error")));
    await search.fill(`yy${Date.now().toString(36)}`);
    const sidebar = page.getByRole("complementary", { name: "Study Groups" });
    const failed = sidebar.getByRole("alert").filter({ hasText: "Something went wrong" });
    await expect(failed).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: title })).toBeVisible();
    await expect(failed.getByRole("button", { name: "Try again" })).toBeVisible();
    // Healed by the next load (the 3 s poll, or Try again).
    await page.unroute(discoverRoute);
    await expect(failed).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByRole("status").filter({ hasText: "No Study Groups match your search." })).toBeVisible();
  } finally {
    await host.context.close();
  }
});
