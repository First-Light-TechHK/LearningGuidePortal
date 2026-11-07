import { expect, test } from "playwright/test";
import {
  appAlerts,
  askTutor,
  createGroup,
  expectConnected,
  joinGroup,
  newMember,
  openLiveRoom,
  roomPath,
  scheduleSession,
  sessionView,
} from "./study-group-helpers";

// SG fixes 2026-11-02, found while the Helpdesk SOP tree v2 was rebuilt from
// the code (deviation keys in brackets):
//   SGX-1 Enter now whose entry check fails says why, with Try again
//         (group.reminders.enter-now-does-nothing).
//   SGX-2 A started session opens the room for its Host even when the next
//         entry fails; the room offers its own retry
//         (group.start.started-but-not-in-room).
//   SGX-3 A Withdraw the server refuses because the AI Tutor already started
//         says so on the asker's line (group.tutor.tutor-withdraw-too-late).

test.skip(Boolean(process.env.CI), "local-only Study Group E2E; CI does not run e2e");

const origin = (baseURL: string | undefined) => baseURL || "http://127.0.0.1:3013";
const unique = (label: string) => `${label} ${Date.now().toString(36)}`;
const FAILED = JSON.stringify({ ok: false, code: "error", message: "Study Group request failed.", data: null });
const WAITING = "Waiting for the host to start the session...";

test("SGX-1: Enter now on a reminder whose entry check fails shows the error with Try again, and Try again goes on", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const host = await newMember(browser, origin(baseURL), "sgx1-a", "Study Host");
  const member = await newMember(browser, origin(baseURL), "sgx1-b", "Study Guest");
  try {
    const groupId = await createGroup(host, unique("E2E SGX1"));
    await joinGroup(member, groupId);
    const title = unique("Reminder entry");
    const sessionId = await scheduleSession(host, groupId, { title, startsInMs: 8 * 60_000 });
    expect((await member.context.request.post(`/api/study-groups/sessions/${sessionId}/plan`, { data: {} })).status()).toBe(200);
    // The T-10 reminder reaches the site.
    await expect.poll(async () => {
      const response = await member.context.request.get("/api/study-groups?view=reminders");
      const body = await response.json() as { data?: Array<{ sessionId?: string }> };
      return (body.data || []).some((item) => item.sessionId === sessionId);
    }, { timeout: 90_000, intervals: [3_000] }).toBe(true);

    const page = await member.context.newPage();
    let fail = true;
    await page.route(`**/api/study-groups/sessions/${sessionId}/entry`, (route) => fail
      ? route.fulfill({ status: 500, contentType: "application/json", body: FAILED })
      : route.continue());
    await page.goto("/en-GB/portal/study-groups");
    const reminder = page.getByRole("status").filter({ hasText: `${title} in the Study Group` });
    await expect(reminder).toBeVisible();
    await reminder.getByRole("button", { name: "Enter now" }).click();
    // No group is open, yet the failure is said, once, with a way on.
    const alert = appAlerts(page);
    await expect(alert).toHaveCount(1);
    await expect(alert).toContainText("Something went wrong. Try again.");
    await expect(page).toHaveURL(/\/en-GB\/portal\/study-groups$/);
    await expect(reminder.getByRole("button", { name: "Enter now" })).toBeEnabled();

    fail = false;
    await alert.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("dialog").getByText(WAITING)).toBeVisible();
    await expect(appAlerts(page)).toHaveCount(0);
    expect((await sessionView(host, sessionId)).occupancy).toBe(1);
  } finally {
    await host.context.close();
    await member.context.close();
  }
});

test("SGX-2: the Host's Start opens the room even when the entry after it fails, and the room's Reconnect connects", async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const host = await newMember(browser, origin(baseURL), "sgx2", "Study Host");
  try {
    const groupId = await createGroup(host, unique("E2E SGX2"));
    const sessionId = await scheduleSession(host, groupId, { title: "Started but blocked", startsInMs: 90_000 });
    const page = await host.context.newPage();
    await page.goto(roomPath(sessionId));
    await page.waitForURL(new RegExp(`/en-GB/portal/study-groups\\?group=${groupId}$`));
    // The first entry after Start fails (a network blip, a server error).
    let failed = 0;
    await page.route(`**/api/study-groups/sessions/${sessionId}/enter`, (route) => {
      if (failed > 0) return route.continue();
      failed += 1;
      return route.fulfill({ status: 500, contentType: "application/json", body: FAILED });
    });
    await page.getByRole("button", { name: "Start Live Session" }).click();
    // The session is Live and the Host's seat is held: the Host is in the room,
    // never left on the list with an error.
    await page.waitForURL(new RegExp(roomPath(sessionId)), { timeout: 30_000 });
    expect((await sessionView(host, sessionId)).state).toBe("live");
    // The room's own entry met the failure: it says so and offers Reconnect.
    await expect.poll(() => failed).toBe(1);
    await expect(appAlerts(page)).toContainText("Something went wrong. Try again.");
    await page.getByRole("button", { name: "Reconnect" }).click();
    await expectConnected(page, 1);
    await expect(appAlerts(page)).toHaveCount(0);
  } finally {
    await host.context.close();
  }
});

test("SGX-3: Withdraw refused because the AI Tutor already started says so and stops offering Withdraw", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const room = await openLiveRoom(browser, origin(baseURL), "sgx3");
  try {
    const { pageB, sessionId } = room;
    const tutorRoute = `**/api/study-groups/sessions/${sessionId}/ai-tutor`;
    // The question is queued behind another one, then the Tutor starts on it
    // before the asker's Withdraw arrives.
    await pageB.route(tutorRoute, (route) => {
      const method = route.request().method();
      if (method === "POST") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, code: "ok", message: "", data: { id: "sgx3-question", position: 2 } }) });
      if (method === "DELETE") return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ ok: false, code: "tutor_answering", message: "The AI Tutor is already answering that question.", data: null }) });
      return route.continue();
    });
    await pageB.getByRole("tab", { name: "Chat" }).click();
    await askTutor(pageB, "What does the course say about pleasure?");
    const withdraw = pageB.getByRole("button", { name: "Withdraw" });
    await expect(withdraw).toBeVisible();
    await withdraw.click();
    await expect(pageB.getByRole("alert").filter({ hasText: "The AI Tutor is already answering that question." })).toBeVisible();
    await expect(withdraw).toHaveCount(0);
    await expect(pageB.getByText("AI Tutor is answering…")).toBeVisible();
    // The question line is not marked withdrawn.
    await expect(pageB.getByText("Question withdrawn.")).toHaveCount(0);
  } finally {
    await room.close();
  }
});
