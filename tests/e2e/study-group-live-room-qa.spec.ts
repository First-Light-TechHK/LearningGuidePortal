import { expect, test, type Page } from "playwright/test";
import { openLiveRoom } from "./study-group-helpers";

// Regression locks for the SIT live-room bugs BUG-0196 … BUG-0199
// (Feishu bug list, 2026-10-22), checked in a real two-browser room.

test.skip(Boolean(process.env.CI), "local-only Study Group E2E; CI does not run e2e");

function appOrigin(baseURL: string | undefined) {
  return baseURL || "http://127.0.0.1:3013";
}

async function rejectScreenPicker(page: Page, message: string) {
  await page.evaluate((reason) => {
    navigator.mediaDevices.getDisplayMedia = () => Promise.reject(new DOMException(reason, "NotAllowedError"));
  }, message);
}

async function sendChat(page: Page, text: string) {
  const input = page.getByRole("textbox", { name: "Chat" });
  await input.fill(text);
  await input.press("Enter");
}

test("live room: Session Focus is labelled, closing the screen picker is silent, the chat matches 599:1276 and scrolls inside its panel", async ({ browser, baseURL }) => {
  test.setTimeout(300_000);
  const focus = "Why did the Weimar coalition break down?";
  const room = await openLiveRoom(browser, appOrigin(baseURL), "lr-qa", { sessionTitle: "Live room QA", focus });
  try {
    const { pageA, pageB } = room;

    // BUG-0196: the focus sits under its own "Session Focus" label in 12px
    // body type, well apart from the 30px session title.
    const focusBlock = pageA.getByRole("region", { name: "Session Focus" });
    await expect(focusBlock.getByRole("heading", { name: "Session Focus" })).toBeVisible();
    await expect(focusBlock.getByText(focus, { exact: true })).toBeVisible();
    const titleSize = await pageA.getByRole("heading", { level: 1, name: "Live room QA" }).evaluate((title) => parseFloat(getComputedStyle(title).fontSize));
    const bodySize = await focusBlock.getByText(focus, { exact: true }).evaluate((body) => parseFloat(getComputedStyle(body).fontSize));
    const sizes = { title: titleSize, body: bodySize };
    expect(sizes.body).toBe(12);
    expect(sizes.title).toBeGreaterThan(sizes.body * 2);

    // BUG-0199: closing the browser's screen picker is the person's own
    // choice: no failure strip, Share stays off.
    const share = pageA.getByRole("button", { name: "Share", exact: true });
    const shareFailed = pageA.getByText("Screen sharing did not start.", { exact: false });
    await rejectScreenPicker(pageA, "Permission denied");
    await share.click();
    await expect(share).toHaveAttribute("aria-pressed", "false");
    await pageA.waitForTimeout(500);
    await expect(shareFailed).toHaveCount(0);
    // A denial by the operating system still explains what to check.
    await rejectScreenPicker(pageA, "Permission denied by system");
    await share.click();
    await expect(shareFailed).toBeVisible();
    await pageA.getByRole("button", { name: "Close", exact: true }).click();
    await expect(shareFailed).toHaveCount(0);

    // BUG-0197: chat lines follow 599:1366-1390.
    await pageA.getByRole("tab", { name: "Chat" }).click();
    await pageB.getByRole("tab", { name: "Chat" }).click();
    await sendChat(pageA, "First line");
    const firstLine = pageA.locator("article").filter({ hasText: "First line" });
    await expect(firstLine).toBeVisible();
    const look = await firstLine.evaluate((line) => {
      const avatar = line.querySelector("span")!;
      const name = line.querySelector("strong")!;
      const body = line.querySelector("p")!;
      return {
        avatar: avatar.getBoundingClientRect().height,
        name: getComputedStyle(name).fontSize,
        body: getComputedStyle(body).fontSize,
        bodyColor: getComputedStyle(body).color,
      };
    });
    expect(look).toEqual({ avatar: 20, name: "12px", body: "12px", bodyColor: "rgba(0, 0, 0, 0.4)" });
    // The @AI Tutor entry sits inside the input box below the text, not as a
    // label above it.
    const input = await pageA.getByRole("textbox", { name: "Chat" }).boundingBox();
    const tutor = await pageA.getByRole("button", { name: "@AI Tutor", exact: true }).boundingBox();
    expect(tutor!.y).toBeGreaterThan(input!.y + input!.height);

    // BUG-0198: many lines scroll inside the panel; the page does not grow.
    const side = pageA.getByRole("complementary", { name: "Chat" });
    const before = await side.boundingBox();
    const pageHeight = await pageA.evaluate(() => document.documentElement.scrollHeight);
    for (let index = 1; index <= 18; index += 1) await sendChat(pageA, `Line ${index}`);
    await expect(pageA.locator("article").filter({ hasText: "Line 18" })).toBeVisible();
    expect((await side.boundingBox())!.height).toBe(before!.height);
    expect(before!.height).toBeLessThanOrEqual(771);
    expect(await pageA.evaluate(() => document.documentElement.scrollHeight)).toBe(pageHeight);
    const log = side.getByRole("tabpanel");
    const metrics = () => log.evaluate((element) => ({ top: element.scrollTop, height: element.scrollHeight, view: element.clientHeight }));
    const filled = await metrics();
    expect(filled.height).toBeGreaterThan(filled.view);
    // The rules between lines reach the panel edge without a sideways scroll.
    expect(await log.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    // The newest line is in view: the log follows the bottom.
    expect(filled.height - filled.top - filled.view).toBeLessThan(2);
    // Someone reading back up is not pulled down by a new line from another person.
    await log.evaluate((element) => { element.scrollTop = 0; element.dispatchEvent(new Event("scroll")); });
    await sendChat(pageB, "From the guest");
    await expect(pageA.locator("article").filter({ hasText: "From the guest" })).toHaveCount(1);
    expect((await metrics()).top).toBe(0);
    // Sending one's own line brings the reader back to the newest line.
    await sendChat(pageA, "Back to the bottom");
    await expect.poll(async () => { const now = await metrics(); return now.height - now.top - now.view < 2; }).toBe(true);
  } finally {
    await room.close();
  }
});
