import { expect, test, type Browser, type Page } from "playwright/test";
import {
  appAlerts,
  askTutor,
  createGroup,
  enterSession,
  expectConnected,
  groupPath,
  joinGroup,
  newMember,
  openLiveRoom,
  roomPath,
  scheduleSession,
  sessionView,
  type Member,
} from "./study-group-helpers";

// One regression lock per user-visible server item of the second SG / AI
// Tutor QA round (2026-10-20): F-1, F-2, F-5, X-2, N9-a / M10-a, X-3, X-4,
// M12, M17 and X-5. B6, M7, M11-a and M21 need a long wait, a Course
// unpublish or injected faults and are locked by the unit and PG io tests.
// Each test is named after the item it locks.

test.skip(Boolean(process.env.CI), "local-only Study Group E2E; CI does not run e2e");

// Seat lease (modules/group-study/presence.ts): 30 s lease, 10 s heartbeat,
// and the dev server sweeps every 15 s.
const LEASE_MS = 30_000;
const LEASE_SLACK_MS = 15_000;

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

async function remindersFor(member: Member) {
  const response = await member.context.request.get("/api/study-groups?view=reminders");
  expect(response.status(), "reminders view").toBe(200);
  return ((await response.json()).data as Array<{ body: string }>).map((item) => item.body);
}

async function seatsOpen(member: Member, sessionId: string) {
  const response = await member.context.request.get(`/api/study-groups/sessions/${encodeURIComponent(sessionId)}`);
  expect(response.status(), "session view").toBe(200);
  return (await response.json()).data.seatsOpen as number;
}

function heartbeat(member: Member, sessionId: string) {
  return member.context.request.post(`/api/study-groups/sessions/${encodeURIComponent(sessionId)}/heartbeat`, { data: {} });
}

// Stops a page's seat heartbeats (the request never reaches the server)
// while its LiveKit connection stays up.
async function blockHeartbeat(page: Page, sessionId: string) {
  await page.route(`**/api/study-groups/sessions/${sessionId}/heartbeat`, (route) => route.abort());
}

// openLiveRoom with a room of two seats, so the Host and one member fill it.
async function openFullRoom(browser: Browser, origin: string, label: string) {
  const host = await newMember(browser, origin, `${label}-a`, "Study Host");
  const member = await newMember(browser, origin, `${label}-b`, "Study Guest");
  const groupId = await createGroup(host, unique(`E2E ${label}`));
  await joinGroup(member, groupId);
  const sessionId = await scheduleSession(host, groupId, { title: `E2E ${label} session`, startsInMs: 90_000, maxParticipants: 2 });
  expect((await enterSession(member, sessionId)).status(), "enter b").toBe(200);
  const pageB = await member.context.newPage();
  const pageA = await host.context.newPage();
  // The member waits in the list's waiting dialog, the Host starts from the
  // list (deep links 2026-10-30).
  await pageB.goto(roomPath(sessionId));
  await expect(pageB.getByRole("dialog").getByText("Waiting for the host to start the session...")).toBeVisible();
  await pageA.goto(roomPath(sessionId));
  await pageA.getByRole("button", { name: "Start Live Session" }).click();
  await pageB.waitForURL(new RegExp(roomPath(sessionId)), { timeout: 30_000 });
  await expectConnected(pageA, 2);
  await expectConnected(pageB, 2);
  return { host, member, pageA, pageB, groupId, sessionId };
}

test("F-1: starting the session seats the Host at once, so a member cannot take that seat first", async ({ browser, baseURL }) => {
  const origin = appOrigin(baseURL);
  const host = await newMember(browser, origin, "f1-a", "Study Host");
  const first = await newMember(browser, origin, "f1-b", "First Member");
  const second = await newMember(browser, origin, "f1-c", "Second Member");
  try {
    const groupId = await createGroup(host, unique("E2E F-1"));
    await joinGroup(first, groupId);
    await joinGroup(second, groupId);
    const sessionId = await scheduleSession(host, groupId, { title: "Two seats", startsInMs: 90_000, maxParticipants: 2 });
    expect((await enterSession(first, sessionId)).status(), "first member waits").toBe(200);

    // The Host starts but has not entered yet: the second seat is already the Host's.
    const started = await host.context.request.post(`/api/study-groups/sessions/${sessionId}/start`, { data: {} });
    expect(started.status(), "start").toBe(200);
    expect((await sessionView(host, sessionId)).occupancy).toBe(2);
    const refused = await enterSession(second, sessionId);
    expect(refused.status(), "Join Now between start and the Host's entry").toBe(409);
    expect((await refused.json()).code).toBe("session_full");
    expect((await enterSession(host, sessionId)).status(), "the Host enters the seat the start kept").toBe(200);
    expect((await sessionView(host, sessionId)).occupancy).toBe(2);
  } finally {
    await host.context.close();
    await first.context.close();
    await second.context.close();
  }
});

test("F-2: Join Now reads Session full when the only seat left is the Host's", async ({ browser, baseURL }) => {
  const origin = appOrigin(baseURL);
  const host = await newMember(browser, origin, "f2-a", "Study Host");
  const first = await newMember(browser, origin, "f2-b", "First Member");
  const second = await newMember(browser, origin, "f2-c", "Second Member");
  try {
    const groupId = await createGroup(host, unique("E2E F-2"));
    await joinGroup(first, groupId);
    await joinGroup(second, groupId);
    const sessionId = await scheduleSession(host, groupId, { title: "Two seats", startsInMs: 90_000, maxParticipants: 2 });
    expect(await seatsOpen(second, sessionId), "one of two is the Host's").toBe(1);
    expect((await enterSession(first, sessionId)).status(), "first member waits").toBe(200);
    const waiting = await first.context.newPage();
    await waiting.goto(roomPath(sessionId));
    await expect(waiting.getByText("Waiting for the host to start the session...")).toBeVisible();

    // 1/2 seated, yet nothing is left for a member.
    expect((await sessionView(second, sessionId)).occupancy).toBe(1);
    expect(await seatsOpen(second, sessionId)).toBe(0);
    const page = await openGroupPage(second, groupId);
    await expect(page.getByRole("button", { name: "Session full" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Join Now" })).toHaveCount(0);
  } finally {
    await host.context.close();
    await first.context.close();
    await second.context.close();
  }
});

test("F-5: two schedules for the same slot with a different Focus are two sessions", async ({ browser, baseURL }) => {
  const host = await newMember(browser, appOrigin(baseURL), "f5-a", "Study Host");
  try {
    const groupId = await createGroup(host, unique("E2E F-5"));
    const startsAt = new Date(Date.now() + 3 * 60 * 60_000).toISOString();
    const schedule = async (focus: string) => {
      const response = await host.context.request.post(`/api/study-groups/${groupId}/sessions`, {
        data: { title: "Same slot", startsAt, durationSeconds: 1800, maxParticipants: 4, aiTutorEnabled: true, focus },
      });
      expect(response.status(), `schedule ${focus}`).toBe(200);
      return (await response.json()).data.id as string;
    };
    const weimar = await schedule("Weimar");
    const versailles = await schedule("Versailles");
    expect(versailles, "a different Focus is not a duplicate").not.toBe(weimar);
    expect(await schedule("Weimar"), "the same request again is the same session").toBe(weimar);
  } finally {
    await host.context.close();
  }
});

test("X-2: a session moved out of Starting Soon releases the waiting seat at the next heartbeat", async ({ browser, baseURL }) => {
  const origin = appOrigin(baseURL);
  const host = await newMember(browser, origin, "x2-a", "Study Host");
  const member = await newMember(browser, origin, "x2-b", "Study Guest");
  try {
    const groupId = await createGroup(host, unique("E2E X-2"));
    await joinGroup(member, groupId);
    const sessionId = await scheduleSession(host, groupId, { title: "Moved away", startsInMs: 90_000 });
    expect((await enterSession(member, sessionId)).status(), "member waits").toBe(200);
    const moved = await host.context.request.patch(`/api/study-groups/sessions/${sessionId}`, { data: { groupId, startsAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString() } });
    expect(moved.status(), "reschedule").toBe(200);

    const beat = await heartbeat(member, sessionId);
    expect(beat.status()).toBe(200);
    expect((await beat.json()).data).toMatchObject({ seated: false, state: "scheduled" });
    expect((await sessionView(host, sessionId)).occupancy).toBe(0);
  } finally {
    await host.context.close();
    await member.context.close();
  }
});

test("N9-a / M10-a: a reminded session moved later inside the window is reminded again, with the group and the real minutes", async ({ browser, baseURL }) => {
  test.setTimeout(150_000);
  const origin = appOrigin(baseURL);
  const host = await newMember(browser, origin, "n9a-a", "Study Host");
  const member = await newMember(browser, origin, "n9a-b", "Study Guest");
  try {
    const title = unique("Moved inside the window");
    const groupTitle = unique("E2E N9-a");
    const groupId = await createGroup(host, groupTitle);
    await joinGroup(member, groupId);
    const sessionId = await scheduleSession(host, groupId, { title, startsInMs: 6 * 60_000 });
    expect((await member.context.request.post(`/api/study-groups/sessions/${sessionId}/plan`, { data: {} })).status()).toBe(200);
    // "<title> in the Study Group "<group>" starts in N minutes."
    const prefix = `${title} in the Study Group "${groupTitle}" starts in `;
    const minutes = async () => {
      const body = (await remindersFor(member)).find((item) => item.startsWith(prefix));
      const match = body?.slice(prefix.length).match(/^(\d+) minutes?\.$/);
      return match ? Number(match[1]) : null;
    };
    await expect.poll(minutes, { timeout: 60_000, intervals: [3_000] }).not.toBeNull();
    const before = (await minutes())!;
    expect(before).toBeLessThanOrEqual(6);

    // Still inside the 10-minute window, but three minutes later.
    const moved = await host.context.request.patch(`/api/study-groups/sessions/${sessionId}`, { data: { groupId, startsAt: new Date(Date.now() + 9 * 60_000).toISOString() } });
    expect(moved.status(), "reschedule").toBe(200);
    await expect.poll(minutes, { timeout: 60_000, intervals: [3_000] }).toBeGreaterThanOrEqual(8);
    expect((await remindersFor(member)).filter((item) => item.startsWith(prefix)), "one reminder, for the new time").toHaveLength(1);
  } finally {
    await host.context.close();
    await member.context.close();
  }
});

test("X-3: a live room whose heartbeats all stop stays live while everyone is still in the call", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const room = await openLiveRoom(browser, appOrigin(baseURL), "x3-live");
  try {
    await blockHeartbeat(room.pageA, room.sessionId);
    await blockHeartbeat(room.pageB, room.sessionId);
    // Lease (30 s) + empty-room grace (60 s) + a sweep or two.
    await room.pageA.waitForTimeout(LEASE_MS + 60_000 + 2 * LEASE_SLACK_MS);
    expect((await sessionView(room.host, room.sessionId)).state, "the provider still sees both in the room").toBe("live");
    await expectConnected(room.pageA, 2);
    await expectConnected(room.pageB, 2);
  } finally {
    await room.close();
  }
});

test("X-4: a member still in the call gets the seat back from a newcomer who took it while heartbeats failed", async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const origin = appOrigin(baseURL);
  const room = await openFullRoom(browser, origin, "x4-full");
  const newcomer = await newMember(browser, origin, "x4-c", "Newcomer");
  try {
    await joinGroup(newcomer, room.groupId);
    expect((await enterSession(newcomer, room.sessionId)).status(), "the room is full").toBe(409);

    await blockHeartbeat(room.pageB, room.sessionId);
    await room.pageB.waitForTimeout(LEASE_MS + LEASE_SLACK_MS);
    expect((await enterSession(newcomer, room.sessionId)).status(), "the lapsed seat is taken").toBe(200);

    // The member, still in the call, enters again and keeps the seat.
    expect((await enterSession(room.member, room.sessionId)).status(), "the member's re-entry").toBe(200);
    expect((await (await heartbeat(newcomer, room.sessionId)).json()).data.seated, "the newcomer's seat went back").toBe(false);
    const refused = await enterSession(newcomer, room.sessionId);
    expect(refused.status()).toBe(409);
    expect((await refused.json()).code).toBe("session_full");
    await expectConnected(room.pageB, 2);
  } finally {
    await room.host.context.close();
    await room.member.context.close();
    await newcomer.context.close();
  }
});

test("M12: a blocked camera points at the browser's site settings, not one browser on one OS", async ({ browser, baseURL }) => {
  const room = await openLiveRoom(browser, appOrigin(baseURL), "m12-camera", {
    memberInitScript: () => {
      const permissions = navigator.permissions;
      const query = permissions.query.bind(permissions);
      permissions.query = (descriptor: PermissionDescriptor) => descriptor.name === "camera"
        ? Promise.resolve({ name: "camera", state: "denied", onchange: null } as unknown as PermissionStatus)
        : query(descriptor);
    },
  });
  try {
    await room.pageB.getByRole("button", { name: "Camera", exact: true }).click();
    const notice = appAlerts(room.pageB).filter({ hasText: "camera" });
    await expect(notice).toContainText("Allow the camera in the browser's site settings");
    await expect(notice).not.toContainText("Chrome");
    await expect(notice).not.toContainText("macOS");
    await expect(notice).not.toContainText("System Settings");
  } finally {
    await room.close();
  }
});

test("M12: a temporary LiveKit failure on start says try again, not not configured", async ({ browser, baseURL }) => {
  const host = await newMember(browser, appOrigin(baseURL), "m12-start", "Study Host");
  try {
    const groupId = await createGroup(host, unique("E2E M12"));
    const sessionId = await scheduleSession(host, groupId, { title: "Start later", startsInMs: 90_000 });
    const page = await openGroupPage(host, groupId);
    await page.route(`**/api/study-groups/sessions/${sessionId}/start`, (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, code: "livekit_temporarily_unavailable", message: "", data: null }) }));
    await page.getByRole("button", { name: "Start Live Session" }).click();
    await expect(page.getByText("The Live Session connection is temporarily unavailable. Try again in a moment.")).toBeVisible();
    await expect(page.getByText("not configured")).toHaveCount(0);
  } finally {
    await host.context.close();
  }
});

test("M17: a member who leaves the Study Group mid-call is removed from its live room", async ({ browser, baseURL }) => {
  const room = await openLiveRoom(browser, appOrigin(baseURL), "m17-leave");
  try {
    expect((await room.member.context.request.post(`/api/study-groups/${room.groupId}/leave`, { data: {} })).status(), "leave group").toBe(200);
    await expect(room.pageB.getByText("You were removed from this Live Session.")).toBeVisible({ timeout: 15_000 });
    await expect(room.pageA.locator('[data-participants="1"]')).toBeVisible({ timeout: 15_000 });
  } finally {
    await room.close();
  }
});

test("X-5: asking the AI Tutor after the seat lapsed says why instead of a bare error", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const room = await openLiveRoom(browser, appOrigin(baseURL), "x5-lapsed");
  try {
    await blockHeartbeat(room.pageB, room.sessionId);
    await room.pageB.waitForTimeout(LEASE_MS + 5_000);
    await room.pageB.getByRole("tab", { name: "Chat" }).click();
    await askTutor(room.pageB, "Are you still there?");
    await expect(room.pageB.getByText("Your place in the Live Session lapsed while the connection was down. Wait until you are back in, then ask again.")).toBeVisible();
    await expect(room.pageB.getByRole("button", { name: "Reconnect" })).toHaveCount(0);
  } finally {
    await room.close();
  }
});

// QA round three (r3 server 4, 7c and r3 groups 2): the session view and
// the entry, as the server answers them. X-4's queue, the sweep's strays,
// the Course-gone join and the tutor deadline need a provider fault, a
// Course unpublish or injected timing and are locked by unit tests.

test("r3 server 4 / r3 groups 2: seatsOpen is 0 before Starting Soon, and a seated viewer is told they hold a seat", async ({ browser, baseURL }) => {
  const origin = appOrigin(baseURL);
  const host = await newMember(browser, origin, "r3s4-a", "Study Host");
  const first = await newMember(browser, origin, "r3s4-b", "First Member");
  const second = await newMember(browser, origin, "r3s4-c", "Second Member");
  try {
    const groupId = await createGroup(host, unique("E2E r3 seats"));
    await joinGroup(first, groupId);
    await joinGroup(second, groupId);
    const later = await scheduleSession(host, groupId, { title: "Later today", startsInMs: 3 * 60 * 60_000 });
    expect(await seatsOpen(second, later), "nobody can enter yet").toBe(0);
    expect((await enterSession(second, later)).status()).toBe(409);

    const soon = await scheduleSession(host, groupId, { title: "Two seats", startsInMs: 90_000, maxParticipants: 2 });
    const viewer = async (member: Member) => {
      const response = await member.context.request.get(`/api/study-groups/sessions/${encodeURIComponent(soon)}`);
      expect(response.status(), "session view").toBe(200);
      const data = (await response.json()).data as { seatsOpen: number; viewerSeated: boolean };
      return [data.seatsOpen, data.viewerSeated];
    };
    expect(await viewer(first)).toEqual([1, false]);
    expect((await enterSession(first, soon)).status(), "first member waits").toBe(200);
    expect(await viewer(first), "full for a member, yet the first member holds a seat").toEqual([0, true]);
    expect(await viewer(second)).toEqual([0, false]);
    expect((await enterSession(first, soon)).status(), "entering again renews the same seat").toBe(200);
    expect((await sessionView(first, soon)).occupancy).toBe(1);
  } finally {
    await host.context.close();
    await first.context.close();
    await second.context.close();
  }
});

test("r3 server 7c: entering a session moved out of Starting Soon releases the waiting seat at once", async ({ browser, baseURL }) => {
  const origin = appOrigin(baseURL);
  const host = await newMember(browser, origin, "r3s7c-a", "Study Host");
  const member = await newMember(browser, origin, "r3s7c-b", "Study Guest");
  try {
    const groupId = await createGroup(host, unique("E2E r3 7c"));
    await joinGroup(member, groupId);
    const sessionId = await scheduleSession(host, groupId, { title: "Moved away", startsInMs: 90_000 });
    expect((await enterSession(member, sessionId)).status(), "member waits").toBe(200);
    const moved = await host.context.request.patch(`/api/study-groups/sessions/${sessionId}`, { data: { groupId, startsAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString() } });
    expect(moved.status(), "reschedule").toBe(200);
    const refused = await enterSession(member, sessionId);
    expect(refused.status()).toBe(409);
    expect((await refused.json()).code).toBe("session_not_open");
    expect((await sessionView(member, sessionId)).occupancy, "the seat is released, not left to lapse").toBe(0);
  } finally {
    await host.context.close();
    await member.context.close();
  }
});
