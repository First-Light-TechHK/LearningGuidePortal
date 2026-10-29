import { expect, test, type Page } from "playwright/test";
import { askTutor, createGroup, groupPath, newMember, openLiveRoom, tutorLine } from "./study-group-helpers";

// Owner requests 2026-10-29, after the KS review meeting ran in a Live Session:
// one regression lock each.
//   1. While the Host shares the screen, the others see the shared screen and,
//      under it, avatars only instead of the participant cards.
//   2. The Mic control's icon follows its on/off state.
//   3. Schedule Live Session offers 10, 20, 30 and 40 minutes.
//   4. The room AI Tutor's LaTeX renders, in a tidy layout.

test.skip(Boolean(process.env.CI), "local-only Study Group E2E; CI does not run e2e");

function appOrigin(baseURL: string | undefined) {
  return baseURL ?? "http://127.0.0.1:3013";
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

test("1029-1: while the Host shares, the others see avatars only under the shared screen", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const room = await openLiveRoom(browser, appOrigin(baseURL), "1029-share");
  try {
    test.skip(!(await displayCaptureAvailable(room.pageA)), "this machine cannot start getDisplayMedia");
    const tiles = room.pageB.locator('[class*="videos"] [class*="tile"][data-video]');
    await expect(tiles).toHaveCount(2);
    await room.pageA.getByRole("button", { name: "Share" }).click();
    await expect(room.pageB.locator('[class*="shareMain"]')).toBeVisible();
    const strip = room.pageB.getByRole("list", { name: "Participants" });
    await expect(strip.getByRole("listitem")).toHaveCount(2);
    await expect(tiles, "no participant cards under a shared screen").toHaveCount(0);
    const avatar = await strip.getByRole("listitem").first().boundingBox();
    expect(avatar && avatar.height <= 56, "an avatar, not a card").toBe(true);
    // The sharer keeps the cards (their own screen never fills their view).
    await expect(room.pageA.locator('[class*="videos"] [class*="tile"][data-video]')).toHaveCount(2);
    await room.pageA.getByRole("button", { name: "Share" }).click();
    await expect(room.pageB.locator('[class*="shareMain"]')).toHaveCount(0);
    await expect(tiles, "cards come back when the share ends").toHaveCount(2);
  } finally {
    await room.close();
  }
});

test("1029-2: the Mic control shows a crossed-out microphone while off and a microphone while on", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const room = await openLiveRoom(browser, appOrigin(baseURL), "1029-mic");
  try {
    const mic = room.pageA.getByRole("button", { name: "Mic" });
    await expect(mic).toHaveAttribute("aria-pressed", "false");
    await expect(mic.locator("svg")).toHaveAttribute("data-icon", "mic-off");
    await mic.click();
    await expect(mic).toHaveAttribute("aria-pressed", "true");
    await expect(mic.locator("svg")).toHaveAttribute("data-icon", "mic");
    await mic.click();
    await expect(mic).toHaveAttribute("aria-pressed", "false");
    await expect(mic.locator("svg")).toHaveAttribute("data-icon", "mic-off");
  } finally {
    await room.close();
  }
});

test("1029-3: Schedule Live Session offers 10, 20, 30 and 40 minutes, and a 10-minute Session is saved", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const host = await newMember(browser, appOrigin(baseURL), "1029-duration", "Duration Host");
  try {
    const groupId = await createGroup(host, `E2E 1029 duration ${Date.now().toString(36)}`);
    const page = await host.context.newPage();
    await page.goto(groupPath(groupId));
    await page.getByRole("button", { name: "Schedule Live Session" }).click();
    const dialog = page.getByRole("dialog");
    const duration = dialog.locator('select[name="durationMinutes"]');
    await expect(duration.locator("option")).toHaveText(["Select duration", "10 mins", "20 mins", "30 mins", "40 mins"]);
    const at = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const pad = (value: number) => String(value).padStart(2, "0");
    await dialog.locator('input[name="title"]').fill("Ten minute check");
    await dialog.locator('input[name="date"]').fill(`${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`);
    await dialog.locator('input[name="time"]').fill(`${pad(at.getHours())}:${pad(at.getMinutes())}`);
    await duration.selectOption("10");
    await dialog.locator('select[name="maxParticipants"]').selectOption("4");
    const saved = page.waitForResponse((response) => response.url().endsWith(`/api/study-groups/${groupId}/sessions`) && response.request().method() === "POST");
    await dialog.getByRole("button", { name: "Schedule Session" }).click();
    const body = await (await saved).json();
    expect(body.ok).toBe(true);
    expect(body.data.durationSeconds).toBe(600);
  } finally {
    await host.context.close();
  }
});

test("1029-4: the room AI Tutor's LaTeX renders as math, one point per line, with its sources under it", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const room = await openLiveRoom(browser, appOrigin(baseURL), "1029-latex");
  try {
    await room.pageB.getByRole("tab", { name: "Chat" }).click();
    await askTutor(room.pageB, "[latex] What are the basic derivatives?");
    const answer = tutorLine(room.pageB);
    await expect(answer.locator(".katex").first()).toBeVisible({ timeout: 60_000 });
    await expect(answer.locator(".katex-display")).toHaveCount(1);
    // Inline \( \) and $ $ both render; no raw delimiter is left in the text.
    expect(await answer.locator(".katex").count()).toBeGreaterThanOrEqual(4);
    const visible = await answer.evaluate((element) => {
      const copy = element.cloneNode(true) as HTMLElement;
      copy.querySelectorAll(".katex").forEach((node) => node.remove());
      return copy.textContent || "";
    });
    expect(visible).not.toMatch(/\$|\\\(|\\\)|\\frac|\[Source:/);
    await expect(answer.locator("li")).toHaveCount(2);
    await expect(answer).toContainText("Sources: Modeling Life - 2.2");
    // A wide formula scrolls inside the chat panel instead of widening it.
    const fits = await answer.evaluate((element) => element.scrollWidth <= element.clientWidth + 1);
    expect(fits).toBe(true);
  } finally {
    await room.close();
  }
});

test("1029-5: a shared screen goes full screen with the people, the chat (AI Tutor) and the controls floating over it", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const room = await openLiveRoom(browser, appOrigin(baseURL), "1029-focus");
  try {
    test.skip(!(await displayCaptureAvailable(room.pageA)), "this machine cannot start getDisplayMedia");
    const { pageA, pageB } = room;
    await pageB.setViewportSize({ width: 1440, height: 900 });
    await pageA.getByRole("button", { name: "Share" }).click();
    const stage = pageB.getByTestId("share-stage");
    await expect(stage).toBeVisible();
    // Out of full screen the shared screen already takes most of the window's height.
    expect((await stage.boundingBox())!.height).toBeGreaterThanOrEqual(560);
    // The people float over the screen and fold away.
    const people = pageB.getByRole("list", { name: "Participants" });
    await expect(people.getByRole("listitem")).toHaveCount(2);
    await pageB.getByRole("button", { name: /Hide participants/ }).click();
    await expect(people).toHaveCount(0);
    await pageB.getByRole("button", { name: /Show participants/ }).click();
    await expect(people.getByRole("listitem")).toHaveCount(2);

    await pageB.getByRole("button", { name: "Full screen" }).click();
    const room1 = pageB.locator('section[data-focus="true"]');
    await expect(room1).toBeVisible();
    const box = (await stage.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(1430);
    expect(box.height).toBeGreaterThanOrEqual(890);
    // Controls float over the screen; the chat panel starts folded and opens on demand.
    await expect(pageB.getByRole("button", { name: "Mic" })).toBeVisible();
    await expect(pageB.locator('section[data-focus] > aside')).toBeHidden();
    await pageB.getByRole("button", { name: "Chat", exact: true }).first().click();
    await expect(pageB.locator('section[data-focus] > aside')).toBeVisible();
    await askTutor(pageB, "[latex] derivatives in full screen");
    await expect(tutorLine(pageB).locator(".katex").first()).toBeVisible({ timeout: 60_000 });

    // Left alone, the controls fade out; any pointer move brings them back.
    await pageB.mouse.move(700, 450);
    await expect(pageB.locator('section[data-idle="true"]')).toBeVisible({ timeout: 8_000 });
    await expect.poll(() => pageB.locator('[class*="controls"]').first().evaluate((element) => getComputedStyle(element).opacity), { timeout: 5_000 }).toBe("0");
    await pageB.mouse.move(720, 460);
    await expect(pageB.locator('section[data-idle="false"]')).toBeVisible();
    await expect.poll(() => pageB.locator('[class*="controls"]').first().evaluate((element) => getComputedStyle(element).opacity), { timeout: 5_000 }).toBe("1");

    await pageB.getByRole("button", { name: "Exit full screen" }).click();
    await expect(pageB.locator('section[data-focus="false"]')).toBeVisible();
    await expect(pageB.locator('section[data-focus] > aside')).toBeVisible();
    // A share that ends takes full screen with it.
    await pageB.getByRole("button", { name: "Full screen" }).click();
    await expect(room1).toBeVisible();
    await pageA.getByRole("button", { name: "Share" }).click();
    await expect(pageB.locator('section[data-focus="false"]')).toBeVisible();
    await expect(pageB.getByTestId("share-stage")).toHaveCount(0);
  } finally {
    await room.close();
  }
});
