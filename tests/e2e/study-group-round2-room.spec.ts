import { expect, test, type Page } from "playwright/test";
import {
  appAlerts,
  askTutor,
  createGroup,
  enterSession,
  expectConnected,
  joinGroup,
  leaveSession,
  MOCK_TUTOR_REPLY,
  newMember,
  openLiveRoom,
  roomPath,
  scheduleSession,
  sessionView,
  tutorLine,
  type Member,
} from "./study-group-helpers";

// One regression lock per room / AI Tutor client item of the SG QA round 2
// (lg-qa/sg-tutor-qa-2026-10-19.md section 二 and its final review): each test
// is named after the item it locks.

test.skip(Boolean(process.env.CI), "local-only Study Group E2E; CI does not run e2e");

// Seat lease (modules/group-study/presence.ts): a seat lapses 30 s after its last renewal.
const LEASE_MS = 30_000;
const FAILED = JSON.stringify({ ok: false, code: "error", message: "", data: null });

function appOrigin(baseURL: string | undefined) {
  return baseURL || "http://127.0.0.1:3013";
}

function unique(label: string) {
  return `${label} ${Date.now().toString(36)}`;
}

function refusal(code: string) {
  return JSON.stringify({ ok: false, code, message: "", data: null });
}

// The asker's own line of a question (the AI Tutor's answer quotes the
// question too, so its line is told apart by the tutor's name).
function questionLine(page: Page, question: string) {
  return page.locator("article").filter({ hasText: question }).filter({ hasNot: page.locator('strong:text-is("AI Tutor")') });
}

// The ask requests a page sends, in order.
function recordAsks(page: Page, sessionId: string) {
  const asks: Array<{ message: string; clientEventId?: string }> = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith(`/api/study-groups/sessions/${sessionId}/ai-tutor`)) asks.push(request.postDataJSON());
  });
  return asks;
}

// A live session with only its Host in the room, for checks that need a
// browser set up differently from the shared two-person room.
async function openSoloLiveRoom(host: Member, label: string) {
  const groupId = await createGroup(host, unique(`E2E ${label}`));
  const sessionId = await scheduleSession(host, groupId, { title: `E2E ${label} session`, startsInMs: 90_000 });
  const page = await host.context.newPage();
  await page.goto(roomPath(sessionId));
  await page.getByRole("button", { name: "Start Live Session" }).click();
  await expect(page.getByRole("button", { name: "Mic" })).toBeEnabled();
  return { page, sessionId };
}

async function displayCaptureAvailable(page: Page) {
  return page.evaluate(async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) return false;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      stream.getTracks().forEach((track) => track.stop());
      return true;
    } catch {
      return false;
    }
  });
}

async function noSidewaysScroll(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
}

// Holds media playback until the page has had a user gesture, as Safari and
// iOS do (same stand-in as the N13 check in study-group-qa-regressions.spec.ts).
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

// The browser reports the camera permission as denied (a site setting).
function denyCameraPermission() {
  const query = navigator.permissions.query.bind(navigator.permissions);
  navigator.permissions.query = (descriptor: PermissionDescriptor) => descriptor.name === "camera"
    ? Promise.resolve({ state: "denied", name: "camera", onchange: null } as unknown as PermissionStatus)
    : query(descriptor);
}

// A browser without screen capture (phones).
function removeScreenCapture() {
  Reflect.deleteProperty(MediaDevices.prototype, "getDisplayMedia");
}

// Screen capture that the browser refuses.
function refuseScreenCapture() {
  MediaDevices.prototype.getDisplayMedia = () => Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
}

test("r2-B4 / r1-F-4: the room renews its seat at once when the tab is visible again or back online", async ({ browser, baseURL }) => {
  const room = await openLiveRoom(browser, appOrigin(baseURL), "r2b4");
  try {
    const { pageB, sessionId } = room;
    const isHeartbeat = (url: string) => url.endsWith(`/api/study-groups/sessions/${sessionId}/heartbeat`);
    // Right after a regular heartbeat the next one is ten seconds away.
    await (await pageB.waitForRequest((request) => isHeartbeat(request.url()), { timeout: 20_000 })).response();
    const onVisible = pageB.waitForRequest((request) => isHeartbeat(request.url()), { timeout: 3_000 });
    await pageB.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await (await onVisible).response();
    const onOnline = pageB.waitForRequest((request) => isHeartbeat(request.url()), { timeout: 3_000 });
    await pageB.evaluate(() => window.dispatchEvent(new Event("online")));
    await (await onOnline).response();
    await expectConnected(pageB, 2);
  } finally {
    await room.close();
  }
});

test("r4-N13-a: the 'turn sound on' button goes away with the call", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const room = await openLiveRoom(browser, appOrigin(baseURL), "n13a", { memberInitScript: blockAutoplayUntilGesture });
  try {
    await room.pageA.getByRole("button", { name: "Mic" }).click();
    const enable = room.pageB.getByRole("button", { name: "Sound is blocked by your browser. Click to turn it on." });
    await expect(enable).toBeVisible();
    // A second tab of the same account takes the place: the first tab's call ends for good.
    const secondTab = await room.member.context.newPage();
    await secondTab.goto(roomPath(room.sessionId));
    await expect(room.pageB.getByText("This account joined the Live Session elsewhere. Close the other session and reconnect.")).toBeVisible();
    await expect(enable).toHaveCount(0);
  } finally {
    await room.close();
  }
});

test("r3-B2: an answer that came back unavailable offers Ask again under a new client event id", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const room = await openLiveRoom(browser, appOrigin(baseURL), "r3b2");
  try {
    const { pageB, sessionId } = room;
    const asks = recordAsks(pageB, sessionId);
    await pageB.getByRole("tab", { name: "Chat" }).click();
    const question = "[fail] Why is the model down?";
    await askTutor(pageB, question);
    const unavailable = tutorLine(pageB).filter({ hasText: "AI Tutor is temporarily unavailable. Please try again." });
    await expect(unavailable).toHaveCount(1, { timeout: 60_000 });
    const line = questionLine(pageB, question);
    await line.getByRole("button", { name: "Ask again" }).click();
    await expect.poll(() => asks.length).toBe(2);
    expect(asks[1].message).toBe(asks[0].message);
    expect(asks[1].clientEventId, "a new ask, not a replay of the settled one").not.toBe(asks[0].clientEventId);
    await expect(unavailable).toHaveCount(2, { timeout: 60_000 });
    await expect(line.getByRole("button", { name: "Ask again" })).toBeVisible();
  } finally {
    await room.close();
  }
});

test("M21: a retried question keeps its client event id and is answered once", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const room = await openLiveRoom(browser, appOrigin(baseURL), "m21");
  try {
    const { pageA, pageB, sessionId } = room;
    const asks = recordAsks(pageB, sessionId);
    await pageB.getByRole("tab", { name: "Chat" }).click();
    // The server takes the question, but the answer to the request is lost.
    let loseResponse = true;
    await pageB.route(`**/api/study-groups/sessions/${sessionId}/ai-tutor`, async (route) => {
      if (!loseResponse) return route.continue();
      loseResponse = false;
      await route.fetch();
      await route.fulfill({ status: 500, contentType: "application/json", body: FAILED });
    });
    const question = "What is a katastematic pleasure?";
    await askTutor(pageB, question);
    const line = questionLine(pageB, question);
    await expect(line.getByRole("alert")).toContainText("Not sent to AI Tutor");
    await line.getByRole("button", { name: "Ask again" }).click();
    await expect.poll(() => asks.length).toBe(2);
    expect(asks[0].clientEventId, "every ask carries a client event id").toBeTruthy();
    expect(asks[1].clientEventId, "the retry is the same question").toBe(asks[0].clientEventId);
    await expect(tutorLine(pageB).filter({ hasText: MOCK_TUTOR_REPLY })).toHaveCount(1, { timeout: 60_000 });
    await expect(tutorLine(pageA).filter({ hasText: MOCK_TUTOR_REPLY })).toHaveCount(1, { timeout: 30_000 });
    await pageB.waitForTimeout(5_000);
    await expect(tutorLine(pageB).filter({ hasText: MOCK_TUTOR_REPLY }), "answered once").toHaveCount(1);
    await expect(tutorLine(pageA).filter({ hasText: MOCK_TUTOR_REPLY })).toHaveCount(1);
  } finally {
    await room.close();
  }
});

test("X-5: a refused question is marked Not sent to AI Tutor, with the reason", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const room = await openLiveRoom(browser, appOrigin(baseURL), "x5");
  try {
    const { pageB, sessionId } = room;
    await pageB.getByRole("tab", { name: "Chat" }).click();
    // The server refuses a third waiting question.
    await askTutor(pageB, "[slow] first waiting question");
    await askTutor(pageB, "[slow] second waiting question");
    await askTutor(pageB, "third question");
    await expect(questionLine(pageB, "third question").getByRole("alert")).toContainText("Not sent to AI Tutor: Wait for the AI Tutor to answer your earlier questions first.");

    // Every other refusal the server names has its own reason.
    const askRoute = `**/api/study-groups/sessions/${sessionId}/ai-tutor`;
    const cases = [
      { code: "tutor_rate_limited", status: 429, reason: "Too many questions in a short time. Try again in a minute." },
      { code: "seat_lapsed", status: 409, reason: "Your place in the Live Session lapsed while the connection was down. Wait until you are back in, then ask again." },
      { code: "session_not_open", status: 409, reason: "AI Tutor answers only while the Live Session is live." },
      { code: "error", status: 500, reason: "Something went wrong. Try again." },
    ];
    for (const item of cases) {
      await pageB.route(askRoute, (route) => route.fulfill({ status: item.status, contentType: "application/json", body: refusal(item.code) }));
      const question = `refused as ${item.code}`;
      await askTutor(pageB, question);
      await expect(questionLine(pageB, question).getByRole("alert")).toContainText(`Not sent to AI Tutor: ${item.reason}`);
      await pageB.unroute(askRoute);
    }
    // None of it touches the call.
    await expect(pageB.getByRole("button", { name: "Reconnect" })).toHaveCount(0);
    await expectConnected(pageB, 2);
  } finally {
    await room.close();
  }
});

test("X-4: a seat lost under a working call comes back to its holder, even from a full session", async ({ browser, baseURL }) => {
  test.setTimeout(300_000);
  const origin = appOrigin(baseURL);
  const room = await openLiveRoom(browser, origin, "x4", { maxParticipants: 2 });
  const third = await newMember(browser, origin, "x4-c", "Third Member");
  try {
    const { pageB, sessionId } = room;
    await joinGroup(third, room.groupId);
    // The member's heartbeats fail for longer than the lease; the call itself is fine.
    const heartbeat = `**/api/study-groups/sessions/${sessionId}/heartbeat`;
    await pageB.route(heartbeat, (route) => route.fulfill({ status: 503, contentType: "application/json", body: FAILED }));
    await expect.poll(async () => (await sessionView(room.host, sessionId)).occupancy, { timeout: LEASE_MS + 40_000, intervals: [3_000] }).toBe(1);
    expect((await enterSession(third, sessionId)).status(), "the lapsed seat goes to someone else").toBe(200);

    // The server asks LiveKit who is in the call (QA round two X-4): the
    // member still in it gets the seat back from the newcomer who never
    // connected, and the call never drops.
    const reentry = pageB.waitForResponse((response) => response.url().endsWith(`/api/study-groups/sessions/${sessionId}/enter`) && response.request().method() === "POST", { timeout: 30_000 });
    await pageB.unroute(heartbeat);
    expect((await (await reentry).json()).code).toBe("ok");
    const view = await sessionView(room.host, sessionId);
    expect(view.occupancy).toBe(2);
    expect(view.attendees.map((person) => person.displayName).sort()).toEqual(["Study Guest", "Study Host"]);
    await pageB.waitForTimeout(12_000);
    await expectConnected(pageB, 2);
    await expect(pageB.getByRole("heading", { name: "Session full." })).toHaveCount(0);
  } finally {
    await third.context.close();
    await room.close();
  }
});

test("M12: LiveKit briefly unavailable says so, and blocked-camera advice fits any browser", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const room = await openLiveRoom(browser, appOrigin(baseURL), "m12", { memberInitScript: denyCameraPermission });
  try {
    const { pageB, sessionId } = room;
    // Camera blocked in the browser's site settings.
    await pageB.getByRole("button", { name: "Camera" }).click();
    const notice = appAlerts(pageB).filter({ hasText: "camera access" });
    await expect(notice).toContainText("Your browser is blocking camera access for this site.");
    await expect(notice).not.toContainText("Chrome");
    await expect(notice).not.toContainText("macOS");

    // The LiveKit service is busy for a moment: not "not configured".
    const tokenRoute = `**/api/study-groups/sessions/${sessionId}/token`;
    await pageB.route(tokenRoute, (route) => route.fulfill({ status: 503, contentType: "application/json", body: refusal("livekit_temporarily_unavailable") }));
    await pageB.reload();
    await expect(pageB.getByText("The Live Session connection is temporarily unavailable. Try again in a moment.")).toBeVisible({ timeout: 30_000 });
    await expect(pageB.getByText("Live Session connection is not configured.")).toHaveCount(0);
    await pageB.unroute(tokenRoute);
    await expectConnected(pageB, 2);
  } finally {
    await room.close();
  }
});

test("M13: the Host's Start shows progress, shows its failure, and the failure is gone once live", async ({ browser, baseURL }) => {
  const host = await newMember(browser, appOrigin(baseURL), "m13", "Study Host");
  try {
    const groupId = await createGroup(host, unique("E2E M13"));
    const sessionId = await scheduleSession(host, groupId, { title: "Start once it works", startsInMs: 90_000 });
    const page = await host.context.newPage();
    await page.goto(roomPath(sessionId));
    let failStart = true;
    await page.route(`**/api/study-groups/sessions/${sessionId}/start`, async (route) => {
      if (!failStart) return route.continue();
      failStart = false;
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      await route.fulfill({ status: 500, contentType: "application/json", body: FAILED });
    });
    await page.getByRole("button", { name: "Start Live Session" }).click();
    await expect(page.getByRole("button", { name: "Starting…" })).toBeDisabled();
    await expect(appAlerts(page)).toHaveText("Something went wrong. Try again.");
    await page.getByRole("button", { name: "Start Live Session" }).click();
    await expect(page.getByRole("button", { name: "Mic" })).toBeEnabled();
    await expect(page.locator('[data-participants="1"]')).toBeVisible();
    await expect(appAlerts(page)).toHaveCount(0);
    expect((await sessionView(host, sessionId)).state).toBe("live");
  } finally {
    await host.context.close();
  }
});

test("M15: Leave asks first, a failed leave keeps the call, the left page rejoins, the last one is told it ends", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const room = await openLiveRoom(browser, appOrigin(baseURL), "m15-rest");
  try {
    const { pageA, pageB, sessionId } = room;
    const dialogB = pageB.getByRole("dialog");

    // Asking first: Go back keeps the call.
    await pageB.getByRole("button", { name: "Leave Session" }).click();
    await expect(dialogB.getByRole("heading", { name: "Leave this Live Session?" })).toBeVisible();
    await expect(dialogB).toContainText("You can rejoin while the session is still live.");
    await dialogB.getByRole("button", { name: "Go back" }).click();
    await expect(dialogB).toHaveCount(0);
    await expectConnected(pageB, 2);

    // A leave the server did not take: no "You left", the call stays, the leave is offered again.
    const leaveRoute = `**/api/study-groups/sessions/${sessionId}/leave`;
    await pageB.route(leaveRoute, (route) => route.fulfill({ status: 500, contentType: "application/json", body: FAILED }));
    await pageB.getByRole("button", { name: "Leave Session" }).click();
    await dialogB.getByRole("button", { name: "Yes, leave" }).click();
    await expect(dialogB.getByRole("alert")).toContainText("You have not left yet");
    await expect(pageB.getByRole("heading", { name: "You left the Live Session." })).toHaveCount(0);
    await expect(pageB.locator('[data-participants="2"]')).toBeVisible();
    expect((await sessionView(room.host, sessionId)).occupancy).toBe(2);
    await pageB.unroute(leaveRoute);
    await dialogB.getByRole("button", { name: "Try again" }).click();
    await expect(pageB.getByRole("heading", { name: "You left the Live Session." })).toBeVisible();
    await expect(pageA.locator('[data-participants="1"]')).toBeVisible();

    // The left page rejoins while the session is live.
    await pageB.getByRole("button", { name: "Rejoin" }).click();
    await expectConnected(pageB, 2);
    await expectConnected(pageA, 2);

    // The last one is told that leaving ends the session.
    await leaveSession(pageB);
    await expect(pageA.locator('[data-participants="1"]')).toBeVisible();
    // The left page holds no seat: dropping the call must not enter again.
    await expect.poll(async () => (await sessionView(room.host, sessionId)).occupancy, { timeout: 10_000 }).toBe(1);
    await pageB.waitForTimeout(3_000);
    expect((await sessionView(room.host, sessionId)).occupancy).toBe(1);
    await pageA.getByRole("button", { name: "Leave Session" }).click();
    await expect(pageA.getByRole("dialog")).toContainText("You are the last one here, so leaving ends the Live Session.", { timeout: 10_000 });
    await pageA.getByRole("dialog").getByRole("button", { name: "Yes, leave" }).click();
    await expect(pageA.getByRole("heading", { name: "Thanks for studying together" })).toBeVisible();
    await expect(pageA.getByRole("button", { name: "Rejoin" })).toHaveCount(0);
    expect((await sessionView(room.host, sessionId)).state).toBe("completed");
  } finally {
    await room.close();
  }
});

test("M17: leaving the Study Group in another tab drops the call and shows the way back", async ({ browser, baseURL }) => {
  const room = await openLiveRoom(browser, appOrigin(baseURL), "m17");
  try {
    const { pageA, pageB, member, groupId } = room;
    expect((await member.context.request.post(`/api/study-groups/${encodeURIComponent(groupId)}/leave`, { data: {} })).status()).toBe(200);
    await expect(pageB.getByRole("heading", { name: "You do not have access to this Live Session. Only members of its Study Group can join." })).toBeVisible();
    await expect(pageA.locator('[data-participants="1"]')).toBeVisible();
    await expect(pageB.getByRole("button", { name: "Mic" })).toHaveCount(0);
    const back = appAlerts(pageB).getByRole("link", { name: "Back to Study Groups" });
    await expect(back).toHaveAttribute("href", "/en-GB/portal/study-groups");
    await back.click();
    await pageB.waitForURL(/\/en-GB\/portal\/study-groups$/);
  } finally {
    await room.close();
  }
});

test("M18: the sharer's own screen stays out of their main view; a failed share says so; no Share without screen capture", async ({ browser, baseURL }) => {
  test.setTimeout(300_000);
  const origin = appOrigin(baseURL);
  // A phone-like browser: no Share control at all.
  const phone = await newMember(browser, origin, "m18-phone", "Phone Host", { initScript: removeScreenCapture });
  // A browser that refuses the capture.
  const refused = await newMember(browser, origin, "m18-refused", "Refused Host", { initScript: refuseScreenCapture });
  const room = await openLiveRoom(browser, origin, "m18");
  try {
    const phoneRoom = await openSoloLiveRoom(phone, "M18 phone");
    await expect(phoneRoom.page.getByRole("button", { name: "Share" })).toHaveCount(0);

    const refusedRoom = await openSoloLiveRoom(refused, "M18 refused");
    await refusedRoom.page.getByRole("button", { name: "Share" }).click();
    await expect(appAlerts(refusedRoom.page)).toContainText("Screen sharing did not start.");
    await expect(refusedRoom.page.getByRole("button", { name: "Share" })).toHaveAttribute("aria-pressed", "false");

    if (await displayCaptureAvailable(room.pageA)) {
      await room.pageA.getByRole("button", { name: "Share" }).click();
      await expect(room.pageB.locator('[class*="shareMain"]')).toBeVisible();
      await expect(room.pageA.getByText("You are sharing your screen.")).toBeVisible();
      await expect(room.pageA.locator('[class*="shareMain"]'), "no picture of one's own screen").toHaveCount(0);
    } else {
      test.info().annotations.push({ type: "skip", description: "Own-share leg skipped: this machine cannot start getDisplayMedia (see study-group-two-browser.spec.ts)." });
    }
  } finally {
    await room.close();
    await phone.context.close();
    await refused.context.close();
  }
});

test("M19: a raised hand reaches late joiners and goes down with the person who leaves", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const room = await openLiveRoom(browser, appOrigin(baseURL), "m19");
  try {
    const { pageA, pageB } = room;
    const raisedHand = (page: Page) => page.getByRole("img", { name: "Raise Hand" });
    await pageA.getByRole("button", { name: "Raise Hand" }).click();
    await expect(pageA.getByRole("button", { name: "Raise Hand" })).toHaveAttribute("aria-pressed", "true");
    await expect(raisedHand(pageB)).toHaveCount(1);

    // A late joiner (here: the member coming back after a reload) sees the hand already raised.
    await pageB.reload();
    await expectConnected(pageB, 2);
    await expect(raisedHand(pageB)).toHaveCount(1);

    // The hand goes down with the person who leaves.
    await pageA.close();
    await expect(pageB.locator('[data-participants="1"]')).toBeVisible();
    await expect(raisedHand(pageB)).toHaveCount(0);
  } finally {
    await room.close();
  }
});

test("M20: the room link shows sign-in, the way back, or a retry instead of a dead end", async ({ browser, baseURL }) => {
  const origin = appOrigin(baseURL);
  const host = await newMember(browser, origin, "m20-a", "Study Host");
  const outsider = await newMember(browser, origin, "m20-b", "Outsider");
  const visitor = await browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  try {
    const groupId = await createGroup(host, unique("E2E M20"));
    const sessionId = await scheduleSession(host, groupId, { title: "Gate session", startsInMs: 3 * 60 * 60_000 });

    // Signed out: sign in and come back here.
    const signedOut = await visitor.newPage();
    await signedOut.goto(roomPath(sessionId));
    await expect(signedOut.getByRole("heading", { name: "Sign in is required." })).toBeVisible();
    await expect(appAlerts(signedOut).getByRole("link", { name: "Sign In" })).toHaveAttribute("href", `/en-GB/portal/sign-in?returnTo=${encodeURIComponent(roomPath(sessionId))}`);

    // Not a member: back to Study Groups.
    const notMember = await outsider.context.newPage();
    await notMember.goto(roomPath(sessionId));
    await expect(notMember.getByRole("heading", { name: "You do not have access to this Live Session. Only members of its Study Group can join." })).toBeVisible();
    await expect(appAlerts(notMember).getByRole("link", { name: "Back to Study Groups" })).toHaveAttribute("href", "/en-GB/portal/study-groups");

    // Any other failure: try again.
    const page = await host.context.newPage();
    let failing = true;
    await page.route(`**/api/study-groups/sessions/${sessionId}`, (route) => failing && route.request().method() === "GET" ? route.fulfill({ status: 500, contentType: "application/json", body: FAILED }) : route.continue());
    await page.goto(roomPath(sessionId));
    await expect(page.getByRole("heading", { name: "Something went wrong. Try again." })).toBeVisible();
    const retry = appAlerts(page).getByRole("button", { name: "Try again" });
    await expect(retry).toBeVisible();
    failing = false;
    // The 3 s poll may heal the page a moment before the click lands; either way it must heal.
    await retry.click({ timeout: 3_000 }).catch(() => undefined);
    await expect(page.getByRole("heading", { name: "This Live Session is not open yet." })).toBeVisible();
  } finally {
    await visitor.close();
    await host.context.close();
    await outsider.context.close();
  }
});

test("M22: the tutor answer keeps x_1, snake_case_name and 2*3*4, and drops only real emphasis", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const room = await openLiveRoom(browser, appOrigin(baseURL), "m22");
  try {
    await room.pageB.getByRole("tab", { name: "Chat" }).click();
    await askTutor(room.pageB, "[markdown] Explain the notation.");
    await expect(tutorLine(room.pageB)).toContainText("Use x_1 and snake_case_name; 2*3*4 = 24 is the key point.", { timeout: 60_000 });
    await expect(tutorLine(room.pageB)).not.toContainText("**");
  } finally {
    await room.close();
  }
});

test("M1: a long unbroken session title wraps inside the room", async ({ browser, baseURL }) => {
  const title = `${"Ataraxia".repeat(6)}Ab`;
  const room = await openLiveRoom(browser, appOrigin(baseURL), "m1", { sessionTitle: title });
  try {
    const heading = room.pageB.getByRole("heading", { level: 1, name: title });
    await expect(heading).toBeVisible();
    const fits = () => heading.evaluate((element) => element.scrollWidth <= element.clientWidth + 1 && element.getBoundingClientRect().right <= document.documentElement.clientWidth);
    expect(await fits(), "desktop").toBe(true);
    await room.pageB.setViewportSize({ width: 375, height: 812 });
    expect(await fits(), "phone").toBe(true);
    expect(await noSidewaysScroll(room.pageB)).toBe(true);
  } finally {
    await room.close();
  }
});

test("M23: the room is usable at 375 px: no sideways scroll, the controls wrap on screen", async ({ browser, baseURL }) => {
  const room = await openLiveRoom(browser, appOrigin(baseURL), "m23");
  try {
    const { pageB } = room;
    await pageB.setViewportSize({ width: 375, height: 812 });
    await expectConnected(pageB, 2);
    expect(await noSidewaysScroll(pageB), "live room").toBe(true);
    const boxes = await pageB.locator('[class*="controls"] > button').evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect()).map((box) => ({ left: box.left, right: box.right, top: box.top })));
    expect(boxes.length).toBeGreaterThanOrEqual(5);
    for (const box of boxes) {
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(375);
    }
    expect(new Set(boxes.map((box) => Math.round(box.top))).size, "the controls wrap onto more than one row").toBeGreaterThan(1);
    await pageB.getByRole("tab", { name: "Chat" }).click();
    const chatBox = pageB.getByRole("textbox", { name: "Chat" });
    await chatBox.scrollIntoViewIfNeeded();
    await expect(chatBox).toBeInViewport();
    expect(await noSidewaysScroll(pageB), "chat open").toBe(true);
    // The left page fits as well.
    await leaveSession(pageB);
    await expect(pageB.getByRole("heading", { name: "You left the Live Session." })).toBeVisible();
    expect(await noSidewaysScroll(pageB), "left page").toBe(true);
  } finally {
    await room.close();
  }
});

// The third QA review of the room client (QA3, 2026-10-20): the room's seat
// intents and call lifecycle, one test per finding a browser can show.

const JOINED_ELSEWHERE = "This account joined the Live Session elsewhere. Close the other session and reconnect.";

function seatIntentUrl(sessionId: string, url: string) {
  return /\/(enter|heartbeat|leave)$/.test(url) && url.includes(`/api/study-groups/sessions/${sessionId}/`);
}

// The page's seat intents (enter, heartbeat, leave) as it sends them.
function recordSeatIntents(page: Page, sessionId: string) {
  const sent: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && seatIntentUrl(sessionId, request.url())) sent.push(request.url().split("/").pop() || "");
  });
  return sent;
}

// The back/forward cache, as far as a page can tell: pagehide on the way out,
// pageshow with persisted on the way back.
function pageTransition(page: Page, type: "pagehide" | "pageshow") {
  return page.evaluate((name) => {
    setTimeout(() => window.dispatchEvent(new PageTransitionEvent(name, { persisted: true })), 0);
  }, type);
}

function markDocument(page: Page) {
  return page.evaluate(() => { (window as unknown as { qa3Mark?: boolean }).qa3Mark = true; });
}

function documentMarked(page: Page) {
  return page.evaluate(() => Boolean((window as unknown as { qa3Mark?: boolean }).qa3Mark));
}

test("QA3 F1: a page put in the back/forward cache holds no seat; restored, it reloads, or stays left", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const room = await openLiveRoom(browser, appOrigin(baseURL), "qa3f1");
  try {
    const { pageA, pageB, sessionId } = room;
    const intents = recordSeatIntents(pageB, sessionId);
    await markDocument(pageB);
    // Hidden for the cache: no renewal goes out, not even on the wake-up triggers.
    await pageTransition(pageB, "pagehide");
    await expect(pageA.locator('[data-participants="1"]')).toBeVisible();
    intents.length = 0;
    await pageB.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("online"));
    });
    await pageB.waitForTimeout(12_000);
    expect(intents, "a hidden page sends no seat intent").toEqual([]);
    // Restored: the dead call is not passed off as connected; the page reloads and enters by the normal rules.
    const reloaded = pageB.waitForEvent("load");
    await pageTransition(pageB, "pageshow");
    await reloaded;
    expect(await documentMarked(pageB)).toBe(false);
    await expectConnected(pageB, 2);
    await expectConnected(pageA, 2);

    // A page that had left stays left when it comes back, and takes no seat.
    await leaveSession(pageB);
    await expect(pageB.getByRole("heading", { name: "You left the Live Session." })).toBeVisible();
    await expect.poll(async () => (await sessionView(room.host, sessionId)).occupancy, { timeout: 10_000 }).toBe(1);
    await markDocument(pageB);
    intents.length = 0;
    await pageTransition(pageB, "pagehide");
    await pageTransition(pageB, "pageshow");
    await pageB.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await pageB.waitForTimeout(4_000);
    expect(await documentMarked(pageB), "no reload").toBe(true);
    await expect(pageB.getByRole("heading", { name: "You left the Live Session." })).toBeVisible();
    expect(intents).toEqual([]);
    expect((await sessionView(room.host, sessionId)).occupancy).toBe(1);
  } finally {
    await room.close();
  }
});

test("QA3 F2: a dropped call leaves no tile of the dead room behind, poll after poll", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const room = await openLiveRoom(browser, appOrigin(baseURL), "qa3f2");
  try {
    const { pageB, member, sessionId } = room;
    // A second tab of the same account takes the place: the first tab's call ends for good.
    const secondTab = await member.context.newPage();
    await secondTab.goto(roomPath(sessionId));
    await expect(pageB.getByText(JOINED_ELSEWHERE)).toBeVisible();
    // Two group polls later the stage still says it is not connected, with no tile of its own.
    await pageB.waitForTimeout(7_000);
    await expect(pageB.getByText("The Live Session could not connect. Check the connection and try again.")).toBeVisible();
    await expect(pageB.getByRole("button", { name: "Mic" })).toBeDisabled();
  } finally {
    await room.close();
  }
});

test("QA3 F3: a heartbeat stalled by a sleeping device does not hold back the renewal on wake", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const room = await openLiveRoom(browser, appOrigin(baseURL), "qa3f3");
  let wake = () => undefined as void;
  try {
    const { pageB, sessionId } = room;
    const isHeartbeat = (url: string) => url.endsWith(`/api/study-groups/sessions/${sessionId}/heartbeat`);
    const asleep = new Promise<void>((resolve) => { wake = resolve; });
    let stall = true;
    await pageB.route(`**/api/study-groups/sessions/${sessionId}/heartbeat`, async (route) => {
      if (!stall) return route.continue();
      stall = false;
      await asleep;
      await route.abort().catch(() => undefined);
    });
    // A heartbeat goes out and never comes back.
    await pageB.waitForRequest((request) => isHeartbeat(request.url()), { timeout: 20_000 });
    // Back in front of the user after the stalled request gave up: the renewal goes out at once.
    await pageB.waitForTimeout(9_500);
    const renewal = pageB.waitForRequest((request) => isHeartbeat(request.url()), { timeout: 3_000 });
    await pageB.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    expect((await (await renewal).response())?.status()).toBe(200);
    await expectConnected(pageB, 2);
  } finally {
    wake();
    await room.close();
  }
});

test("QA3 F4: a call that drops while the leave is on its way is not left marked connected when the leave fails", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const room = await openLiveRoom(browser, appOrigin(baseURL), "qa3f4");
  let failLeave = () => undefined as void;
  let releaseToken = () => undefined as void;
  try {
    const { pageB, member, sessionId } = room;
    const leaveHeld = new Promise<void>((resolve) => { failLeave = resolve; });
    await pageB.route(`**/api/study-groups/sessions/${sessionId}/leave`, async (route) => {
      await leaveHeld;
      await route.fulfill({ status: 500, contentType: "application/json", body: FAILED }).catch(() => undefined);
    });
    // A second tab of this account, held just before it joins the call.
    const secondTab = await member.context.newPage();
    const tokenHeld = new Promise<void>((resolve) => { releaseToken = resolve; });
    let tokenAsked = () => undefined as void;
    const tokenSeen = new Promise<void>((resolve) => { tokenAsked = resolve; });
    await secondTab.route(`**/api/study-groups/sessions/${sessionId}/token`, async (route) => {
      tokenAsked();
      await tokenHeld;
      await route.continue();
    });
    await secondTab.goto(roomPath(sessionId));
    await tokenSeen;
    // Leave is confirmed; while it is on its way the second tab takes the place.
    await pageB.getByRole("button", { name: "Leave Session" }).click();
    await pageB.getByRole("dialog").getByRole("button", { name: "Yes, leave" }).click();
    releaseToken();
    // The confirmation dialog is modal, so the controls behind it are found by their text.
    const mic = pageB.locator("button", { hasText: /^Mic$/ });
    await expect(mic).toBeDisabled({ timeout: 6_000 });
    failLeave();
    await expect(pageB.getByRole("dialog").getByRole("alert")).toContainText("You have not left yet");
    await expect(pageB.getByRole("heading", { name: "You left the Live Session." })).toHaveCount(0);
    // The page knows its call is gone and why; it does not claim to be connected.
    await expect(mic).toBeDisabled();
    await expect(pageB.getByText(JOINED_ELSEWHERE)).toBeVisible();
  } finally {
    failLeave();
    releaseToken();
    await room.close();
  }
});

test("QA3 F5: a Leave sent while a re-entry is on its way leaves no seat behind", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const room = await openLiveRoom(browser, appOrigin(baseURL), "qa3f5");
  try {
    const { pageB, sessionId } = room;
    // The server reads the member's seat as lapsed, so the page enters again...
    await pageB.route(`**/api/study-groups/sessions/${sessionId}/heartbeat`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, code: "ok", message: "", data: { seated: false, occupancy: 1, state: "live" } }) }));
    // ...and that entry is slow on its way to the server.
    let entryAsked = () => undefined as void;
    const entrySeen = new Promise<void>((resolve) => { entryAsked = resolve; });
    await pageB.route(`**/api/study-groups/sessions/${sessionId}/enter`, async (route) => {
      entryAsked();
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      await route.continue();
    });
    const events: string[] = [];
    pageB.on("request", (request) => { if (request.method() === "POST" && seatIntentUrl(sessionId, request.url())) events.push(`${request.url().split("/").pop()} sent`); });
    pageB.on("response", (response) => { if (response.request().method() === "POST" && seatIntentUrl(sessionId, response.url())) events.push(`${response.url().split("/").pop()} answered`); });
    await pageB.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await entrySeen;
    await leaveSession(pageB);
    await expect(pageB.getByRole("heading", { name: "You left the Live Session." })).toBeVisible();
    // The leave went out only once the entry had its answer, so the server took the entry first.
    const leaveSent = events.indexOf("leave sent");
    expect(leaveSent, events.join(", ")).toBeGreaterThan(events.lastIndexOf("enter answered"));
    expect(events.slice(leaveSent), "nothing after the leave").toEqual(["leave sent", "leave answered"]);
    await expect.poll(async () => (await sessionView(room.host, sessionId)).occupancy, { timeout: 10_000 }).toBe(1);
    await pageB.waitForTimeout(4_000);
    expect((await sessionView(room.host, sessionId)).occupancy).toBe(1);
  } finally {
    await room.close();
  }
});

test("QA3 F7: a full session offers Try again, and enters once a seat is free", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const origin = appOrigin(baseURL);
  const room = await openLiveRoom(browser, origin, "qa3f7", { maxParticipants: 2 });
  const third = await newMember(browser, origin, "qa3f7-c", "Third Member");
  try {
    await joinGroup(third, room.groupId);
    const page = await third.context.newPage();
    await page.goto(roomPath(room.sessionId));
    await expect(page.getByRole("heading", { name: "Session full" })).toBeVisible();
    const retry = appAlerts(page).getByRole("button", { name: "Try again" });
    // Still full: the page says so again, with the same offer.
    await retry.click();
    await expect(page.getByRole("heading", { name: "Session full" })).toBeVisible();
    await expect(retry).toBeVisible();
    // A seat frees up: trying again enters the room.
    await leaveSession(room.pageB);
    await expect(room.pageB.getByRole("heading", { name: "You left the Live Session." })).toBeVisible();
    await retry.click();
    await expectConnected(page, 2);
    await expect(page.getByRole("heading", { name: "Session full" })).toHaveCount(0);
  } finally {
    await third.context.close();
    await room.close();
  }
});

test("QA3 F8: coming back online while the call is connecting starts no second connect", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const room = await openLiveRoom(browser, appOrigin(baseURL), "qa3f8");
  try {
    const { pageB, sessionId } = room;
    let tokens = 0;
    await pageB.route(`**/api/study-groups/sessions/${sessionId}/token`, async (route) => {
      tokens += 1;
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      await route.continue();
    });
    await pageB.reload();
    await expect.poll(() => tokens).toBe(1);
    for (let index = 0; index < 3; index += 1) await pageB.evaluate(() => window.dispatchEvent(new Event("online")));
    await expectConnected(pageB, 2);
    await pageB.waitForTimeout(3_000);
    expect(tokens, "one connect").toBe(1);
    await expect(pageB.getByText(JOINED_ELSEWHERE)).toHaveCount(0);
    await expectConnected(pageB, 2);
  } finally {
    await room.close();
  }
});
