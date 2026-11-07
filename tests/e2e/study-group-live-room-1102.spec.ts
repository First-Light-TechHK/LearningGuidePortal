import { expect, test, type Page } from "playwright/test";
import { newMember, openLiveRoom } from "./study-group-helpers";

// Feishu Study Group defects filed 2026-11-02: one regression lock each.
//   BUG-0284: the room chat input wraps what is typed or pasted.
//   BUG-0285: the join page of a Chinese link, and the room behind it, hold no
//             English interface words.
//   BUG-0286: outside full screen no people card floats over the shared screen;
//             the Participants tab beside it already lists them.
// 2026-11-06: an @AI Tutor entry that cannot be used looks disabled (1106-1).

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

// A Course has one title, in the language it was written in, and people pick
// their own names; what is left once those and the fixed product terms are out
// is interface text, and on zh-CN it must be Chinese.
async function expectNoEnglishInterface(page: Page) {
  const text = (await page.locator("main").innerText()).replace(/Learning Guide|Cookie|@?AI Tutor|Enter|Epicureanism|Study Host|Study Guest/g, "");
  expect(text.match(/[A-Za-z]{2,}/g), text).toBeNull();
}

test("1102-1 (BUG-0284): the chat input wraps long text, grows to a limit, and Enter still sends", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const room = await openLiveRoom(browser, appOrigin(baseURL), "1102-wrap");
  try {
    const { pageA, pageB } = room;
    await pageB.setViewportSize({ width: 1440, height: 900 });
    await pageB.getByRole("tab", { name: /Chat/ }).click();
    const input = pageB.getByRole("textbox", { name: "Chat" });
    const empty = (await input.boundingBox())!;

    // A long message wraps in the box: nothing runs off to the side, and the box grows.
    await input.fill("the quick brown fox jumps over the lazy dog ".repeat(4).trim());
    const wrapped = (await input.boundingBox())!;
    expect(wrapped.height, "wrapped text makes the box taller").toBeGreaterThan(empty.height);
    expect(await input.evaluate((element) => element.scrollWidth <= element.clientWidth), "no sideways scrolling").toBe(true);

    // A pasted address with no spaces wraps too (the report's own case).
    await input.fill(`${pageB.url()}${pageB.url()}${pageB.url()}`);
    expect((await input.boundingBox())!.height).toBeGreaterThan(empty.height);
    expect(await input.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

    // It stops growing and scrolls inside; the send control stays in the panel.
    await input.fill("line ".repeat(400).trim());
    const tall = (await input.boundingBox())!;
    expect(tall.height).toBeLessThanOrEqual(120);
    expect(await input.evaluate((element) => element.scrollHeight > element.clientHeight), "the rest scrolls inside the box").toBe(true);
    const aside = (await pageB.getByRole("complementary", { name: "Chat" }).boundingBox())!;
    const send = (await pageB.getByRole("button", { name: "Send", exact: true }).boundingBox())!;
    expect(send.y + send.height).toBeLessThanOrEqual(aside.y + aside.height);

    // Shift+Enter starts a new line, Enter sends, and the sent line keeps its lines.
    await input.fill("");
    await input.click();
    await pageB.keyboard.type("first line");
    await pageB.keyboard.press("Shift+Enter");
    await pageB.keyboard.type("second line");
    await expect(input).toHaveValue("first line\nsecond line");
    await pageB.keyboard.press("Enter");
    await expect(input).toHaveValue("");
    await expect.poll(async () => Math.round((await input.boundingBox())!.height), "the box shrinks back once sent").toBe(Math.round(empty.height));
    await pageA.getByRole("tab", { name: /Chat/ }).click();
    const received = pageA.locator("article").filter({ hasText: "second line" }).locator('[class*="chatBody"]').first();
    await expect(received).toBeVisible();
    const lineBox = await received.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return new Set(Array.from(range.getClientRects()).map((rect) => Math.round(rect.top))).size;
    });
    expect(lineBox, "the receiver sees two lines").toBe(2);

    // The mention list also opens at the start of a new line.
    await input.click();
    await pageB.keyboard.type("hello");
    await pageB.keyboard.press("Shift+Enter");
    await pageB.keyboard.type("@");
    await expect(pageB.getByRole("listbox", { name: /mention/i })).toBeVisible();
    await pageB.keyboard.press("Escape");
  } finally {
    await room.close();
  }
});

test("1102-2 (BUG-0286): outside full screen no people card floats over the shared screen; in full screen it does", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const room = await openLiveRoom(browser, appOrigin(baseURL), "1102-float");
  try {
    test.skip(!(await displayCaptureAvailable(room.pageA)), "this machine cannot start getDisplayMedia");
    const { pageA, pageB } = room;
    await pageB.setViewportSize({ width: 1440, height: 900 });
    await pageA.getByRole("button", { name: "Share" }).click();
    await expect(pageB.getByTestId("share-stage")).toBeVisible();
    const card = pageB.locator('[class*="avatarFloat"]');
    await expect(card, "the Participants tab beside the screen lists them").toHaveCount(0);
    await pageB.getByRole("tab", { name: /Participants/ }).click();
    await expect(pageB.getByRole("complementary", { name: "Participants" }).getByText("Study Host")).toBeVisible();
    await expect(pageB.getByRole("complementary", { name: "Participants" }).getByText("Study Guest")).toBeVisible();

    // Full screen hides that tab, so the card comes back there, and goes again on the way out.
    await pageB.getByRole("button", { name: "Full screen" }).click();
    await expect(pageB.locator('section[data-focus="true"]')).toBeVisible();
    await expect(card).toBeVisible();
    await expect(pageB.getByRole("list", { name: "Participants" }).getByRole("listitem")).toHaveCount(2);
    await pageB.getByRole("button", { name: "Exit full screen" }).click();
    await expect(pageB.locator('section[data-focus="false"]')).toBeVisible();
    await expect(card).toHaveCount(0);
  } finally {
    await room.close();
  }
});

test("1102-3 (BUG-0285): the join page of a Chinese link has no English interface words", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const room = await openLiveRoom(browser, appOrigin(baseURL), "1102-zh", { sessionTitle: "晚上的直播课", focus: "第一章重点" });
  const visitor = await newMember(browser, appOrigin(baseURL), "1102-zh-c", "访客");
  try {
    const page = await visitor.context.newPage();
    await page.goto(`/zh-CN/portal/study-groups/sessions/${room.sessionId}`);
    await expect(page.getByRole("heading", { name: "加入学习小组即可参加这节直播课" })).toBeVisible();
    await expectNoEnglishInterface(page);
    await page.getByRole("button", { name: "加入学习小组并继续" }).click();
    await expect(page.getByRole("button", { name: "离开本节" })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("tab", { name: /聊天/ }).click();
    await expectNoEnglishInterface(page);
  } finally {
    await visitor.context.close();
    await room.close();
  }
});

// 2026-11-06 (shared AI Tutor layer review): while the course's Tutor is off,
// the room's @AI Tutor entry is disabled and must also look it: grey, not the
// faded brand blue that read as clickable. The room says why above it.
test("1106-1: an @AI Tutor entry that cannot be used looks disabled and the room says why", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const room = await openLiveRoom(browser, appOrigin(baseURL), "1106-off");
  const setKsOnline = (online: boolean) => room.host.context.request.post("http://127.0.0.1:8788/__control/ks-online", { data: { online } });
  try {
    const { pageB } = room;
    await pageB.getByRole("tab", { name: /Chat/ }).click();
    const entry = pageB.getByRole("button", { name: "@AI Tutor", exact: true });
    await expect(entry).toBeEnabled();
    const look = () => entry.evaluate((element) => { const style = getComputedStyle(element); return [style.backgroundColor, style.color, style.borderTopColor, style.opacity]; });
    expect(await look()).toEqual(["rgb(255, 255, 255)", "rgb(0, 92, 255)", "rgb(209, 220, 255)", "1"]);

    // The room polls every 3 s and the server keeps the KS status for 10 s.
    expect((await setKsOnline(false)).status()).toBe(200);
    await expect(pageB.getByTestId("tutor-offline")).toHaveText("AI Tutor is offline for this course.", { timeout: 30_000 });
    await expect(entry).toBeDisabled();
    expect(await look()).toEqual(["rgb(242, 244, 247)", "rgb(152, 162, 179)", "rgb(228, 231, 236)", "1"]);

    expect((await setKsOnline(true)).status()).toBe(200);
    await expect(entry).toBeEnabled({ timeout: 30_000 });
    await expect(pageB.getByTestId("tutor-offline")).toHaveCount(0);
  } finally {
    await setKsOnline(true);
    await room.close();
  }
});
