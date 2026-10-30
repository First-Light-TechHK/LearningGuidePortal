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

// Owner 2026-10-30 (screenshots from DEV): the chat input was a box inside a box
// and stopped mid-panel, and the floating people were plain circles that vanished
// on the shared screen's dark edge. These lock the look, not only the behaviour.
async function chatFormLooksRight(page: Page, panel: string) {
  const aside = page.locator(panel);
  const form = aside.locator("form");
  const panelBox = (await aside.boundingBox())!;
  const formBox = (await form.boundingBox())!;
  const gap = panelBox.y + panelBox.height - (formBox.y + formBox.height);
  expect(gap, "599:1392: the input sits 12px above the panel's bottom edge").toBeGreaterThanOrEqual(8);
  expect(gap).toBeLessThanOrEqual(16);
  const input = form.getByRole("textbox");
  expect(await input.evaluate((element) => getComputedStyle(element).borderTopWidth), "one frame only: the field draws no border of its own").toBe("0px");
  const entry = form.getByRole("button", { name: "@AI Tutor" });
  expect(await entry.evaluate((element) => [getComputedStyle(element).backgroundColor, getComputedStyle(element).color]), "a light-blue chip, not a grey system button").toEqual(["rgb(238, 244, 255)", "rgb(29, 107, 255)"]);
}

test("1030-1: the chat input is one frame on the panel's bottom edge, in the room and in full screen", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const room = await openLiveRoom(browser, appOrigin(baseURL), "1030-chat");
  try {
    test.skip(!(await displayCaptureAvailable(room.pageA)), "this machine cannot start getDisplayMedia");
    const { pageA, pageB } = room;
    await pageB.setViewportSize({ width: 1440, height: 900 });
    await pageB.getByRole("tab", { name: /Chat/ }).click();
    await chatFormLooksRight(pageB, "section[data-focus] > aside");
    await pageA.getByRole("button", { name: "Share" }).click();
    await expect(pageB.getByTestId("share-stage")).toBeVisible();
    await pageB.getByRole("button", { name: "Full screen" }).click();
    await pageB.getByRole("button", { name: "Chat", exact: true }).first().click();
    await chatFormLooksRight(pageB, 'section[data-focus="true"] > aside');
  } finally {
    await room.close();
  }
});

test("1030-2: the floating people are a light card with names, and the share buttons stand out on a dark screen", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const room = await openLiveRoom(browser, appOrigin(baseURL), "1030-float");
  try {
    test.skip(!(await displayCaptureAvailable(room.pageA)), "this machine cannot start getDisplayMedia");
    const { pageA, pageB } = room;
    await pageB.setViewportSize({ width: 1440, height: 900 });
    await pageA.getByRole("button", { name: "Share" }).click();
    await expect(pageB.getByTestId("share-stage")).toBeVisible();
    const people = pageB.getByRole("list", { name: "Participants" });
    await expect(people.getByRole("listitem")).toHaveCount(2);
    const card = pageB.locator('[class*="avatarFloat"]');
    expect(await card.evaluate((element) => getComputedStyle(element).backgroundColor), "an opaque light card, not a see-through strip").toBe("rgba(255, 255, 255, 0.96)");
    expect(await card.evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe("none");
    // Every avatar carries its name; the header says what the card is and folds it.
    await expect(people).toContainText("Study Host");
    await expect(people).toContainText("Study Guest");
    const toggle = pageB.getByRole("button", { name: /Hide participants/ });
    await expect(toggle).toContainText("Participants");
    await toggle.click();
    await expect(people).toHaveCount(0);
    await expect(pageB.getByRole("button", { name: /Show participants/ })).toBeVisible();
    // Full screen and Chat are light pills over the screen.
    const full = pageB.getByRole("button", { name: "Full screen" });
    expect(await full.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgba(255, 255, 255, 0.95)");
  } finally {
    await room.close();
  }
});

test("1030-3: full screen keeps people in order, previews new lines while the chat is folded, and the sharer can stop from a banner", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const room = await openLiveRoom(browser, appOrigin(baseURL), "1030-focus");
  try {
    test.skip(!(await displayCaptureAvailable(room.pageA)), "this machine cannot start getDisplayMedia");
    const { pageA, pageB } = room;
    await pageB.setViewportSize({ width: 1440, height: 900 });
    await pageA.getByRole("button", { name: "Share" }).click();
    // The sharer sees a banner with its own Stop sharing; the viewer sees who shares.
    await expect(pageA.getByRole("status").filter({ hasText: "You are sharing your screen." }).getByRole("button", { name: "Stop sharing" })).toBeVisible();
    const stage = pageB.getByTestId("share-stage");
    await expect(stage).toBeVisible();
    await expect(stage).toContainText("Study Host is sharing their screen");
    // The Host is listed first; a raised hand moves its owner above the Host.
    const rows = pageB.getByRole("list", { name: "Participants" }).getByRole("listitem");
    await expect(rows.first()).toContainText("Study Host");
    await pageB.getByRole("button", { name: "Raise Hand" }).click();
    await expect(rows.first()).toContainText("Study Guest");
    await pageB.getByRole("button", { name: "Raise Hand" }).click();
    await expect(rows.first()).toContainText("Study Host");

    // Double-click on the shared screen enters full screen; the top bar names the sharer and offers the way out.
    await stage.locator("video").dblclick();
    await expect(pageB.locator('section[data-focus="true"]')).toBeVisible();
    await expect(pageB.getByText("Press Esc to exit")).toBeVisible();
    await expect(pageB.locator('section[data-focus] > aside')).toBeHidden();
    // A line arriving while the chat is folded shows as a preview and a count on Chat.
    await pageA.getByRole("tab", { name: /Chat/ }).click();
    await pageA.getByRole("textbox", { name: "Chat" }).fill("Look at the tangent line");
    await pageA.getByRole("button", { name: "Send", exact: true }).click();
    const previewBox = pageB.getByTestId("chat-preview");
    await expect(previewBox).toContainText("Look at the tangent line");
    await expect(previewBox).toContainText("Study Host");
    await expect(pageB.getByRole("button", { name: /1 unread/ })).toBeVisible();
    await previewBox.getByRole("button").click();
    await expect(pageB.locator('section[data-focus] > aside')).toBeVisible();
    await expect(previewBox).toHaveCount(0);
    await expect(pageB.getByRole("button", { name: /unread/ })).toHaveCount(0);
    // The float has its own header and folds from it; the choice survives a reload.
    await pageB.getByRole("button", { name: "Hide chat" }).click();
    await expect(pageB.locator('section[data-focus] > aside')).toBeHidden();
    await pageB.getByRole("button", { name: /Hide participants/ }).click();
    await pageB.getByRole("button", { name: "Exit full screen" }).click();
    await expect(pageB.locator('section[data-focus="false"]')).toBeVisible();
    await pageB.reload();
    await expect(pageB.getByTestId("share-stage")).toBeVisible({ timeout: 60_000 });
    await expect(pageB.getByRole("button", { name: /Show participants/ })).toBeVisible();
    // The sharer stops from the banner and everyone's stage goes back to the cards.
    await pageA.getByRole("button", { name: "Stop sharing" }).click();
    await expect(pageB.getByTestId("share-stage")).toHaveCount(0);
  } finally {
    await room.close();
  }
});

test("1030-4: the people card and the full-screen chat drag by their headers and stay on the screen", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const room = await openLiveRoom(browser, appOrigin(baseURL), "1030-drag");
  try {
    test.skip(!(await displayCaptureAvailable(room.pageA)), "this machine cannot start getDisplayMedia");
    const { pageA, pageB } = room;
    await pageB.setViewportSize({ width: 1440, height: 900 });
    await pageA.getByRole("button", { name: "Share" }).click();
    const stage = pageB.getByTestId("share-stage");
    await expect(stage).toBeVisible();
    const card = pageB.locator('[class*="avatarFloat"]');
    const header = pageB.getByRole("button", { name: /Hide participants/ });
    const drag = async (from: { x: number; y: number }, dx: number, dy: number) => {
      await pageB.mouse.move(from.x, from.y);
      await pageB.mouse.down();
      await pageB.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
      await pageB.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
      await pageB.mouse.up();
    };
    const before = (await card.boundingBox())!;
    const grip = (await header.boundingBox())!;
    await drag({ x: grip.x + 30, y: grip.y + grip.height / 2 }, -300, 200);
    const after = (await card.boundingBox())!;
    expect(Math.round(after.x - before.x)).toBe(-300);
    expect(Math.round(after.y - before.y)).toBe(200);
    // The drag did not fold the card.
    await expect(pageB.getByRole("list", { name: "Participants" })).toBeVisible();
    // Thrown far away it stops at the shared screen's edge.
    const moved = (await header.boundingBox())!;
    await drag({ x: moved.x + 30, y: moved.y + moved.height / 2 }, -3000, -3000);
    const box = (await stage.boundingBox())!;
    const pinned = (await card.boundingBox())!;
    expect(Math.round(pinned.x - box.x)).toBe(8);
    expect(Math.round(pinned.y - box.y)).toBe(8);
    // A plain click on the header still folds and opens it.
    await header.click();
    await expect(pageB.getByRole("list", { name: "Participants" })).toHaveCount(0);
    await pageB.getByRole("button", { name: /Show participants/ }).click();

    // Full screen starts with the card back at rest; the chat float drags by its header.
    await pageB.getByRole("button", { name: "Full screen" }).click();
    await expect(pageB.locator('section[data-focus="true"]')).toBeVisible();
    const rest = (await card.boundingBox())!;
    expect(Math.round(1440 - (rest.x + rest.width))).toBe(20);
    await pageB.getByRole("button", { name: "Chat", exact: true }).click();
    const chat = pageB.locator('section[data-focus] > aside');
    await expect(chat).toBeVisible();
    const chatBefore = (await chat.boundingBox())!;
    const chatHead = (await pageB.getByText("Ask the AI Tutor with @AI Tutor").boundingBox())!;
    await drag({ x: chatHead.x + 10, y: chatHead.y + chatHead.height / 2 }, -500, -150);
    const chatAfter = (await chat.boundingBox())!;
    expect(Math.round(chatAfter.x - chatBefore.x)).toBe(-500);
    expect(Math.round(chatAfter.y - chatBefore.y)).toBe(-150);
    await chatDragStillTypes(pageB);
  } finally {
    await room.close();
  }
});

// A dragged chat is still the same chat: its input takes text.
async function chatDragStillTypes(page: Page) {
  const input = page.locator('section[data-focus] > aside').getByRole("textbox", { name: "Chat" });
  await input.fill("still here");
  await expect(input).toHaveValue("still here");
}
