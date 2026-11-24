import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";

// The real PortalHeader (with the bell) in Chromium, with fetch routed to fixture JSON.

type Row = Record<string, unknown>;
type State = { unreadCount: number; items: Row[]; fail: boolean };

let browser: Browser;
let js = "";
let css = "";
const TITLES = ["Subscription active", "New reply to your request", "Study group session cancelled", "New course published", "Announcement"];

before(async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {PortalHeader} from './components/portal/PortalHeader';const root=createRoot(document.getElementById('root'));window.mount=p=>{flushSync(()=>root.render(<main className="portal-page"><PortalHeader key={p.locale} {...p} signedIn active="courses" displayName="Guide"/></main>))};` },
    bundle: true, write: false, outfile: "bell.js", platform: "browser", jsx: "automatic", loader: { ".css": "local-css" }, define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "next", setup(builder) {
      builder.onResolve({ filter: /^next\// }, args => ({ path: args.path, namespace: "next" }));
      builder.onLoad({ filter: /.*/, namespace: "next" }, args => ({ loader: "tsx", resolveDir: process.cwd(), contents: args.path === "next/navigation" ? "const router={refresh(){}};export const useRouter=()=>router;export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search)" : "import React from 'react';export default function Component({prefetch,priority,...props}){return props.src?<img {...props}/>:<a {...props}/>}" }));
    } }],
  });
  js = bundle.outputFiles.find(file => file.path.endsWith("js"))!.text;
  css = bundle.outputFiles.find(file => file.path.endsWith("css"))!.text;
  browser = await chromium.launch();
});

after(async () => { await browser?.close(); });

function rows(unreadFrom = 3): Row[] {
  return TITLES.map((title, index) => ({
    id: `n${index + 1}`, category: ["subscription", "support", "study_group", "course", "announcement"][index], categoryLabel: ["Subscription", "Support", "Study group", "New course", "Announcement"][index],
    title, body: `${title} body`, buttonText: index === 1 ? null : "Open", buttonLink: index === 0 ? "/en-GB/my-learning/subscription" : null,
    read: index >= unreadFrom, unread: index < unreadFrom, isTest: false, displayTime: `${index + 1} hours ago`,
  }));
}

async function open(locale: "en-GB" | "zh-CN", state: State, width = 1440) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const log = { gets: 0, posts: [] as unknown[] };
  await page.route("http://header.test/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/auth/me") return route.fulfill({ json: { ok: true, user: { id: "user", nickname: "Guide" } } });
    if (url.pathname === "/api/my-learning/notifications/read") { log.posts.push(JSON.parse(route.request().postData() || "{}")); return route.fulfill({ json: { ok: true, notification: { id: "n1", read: true, readAt: "2026-11-20T00:00:00Z" }, unreadCount: 2 } }); }
    if (url.pathname === "/api/my-learning/notifications") {
      log.gets += 1;
      if (state.fail) return route.fulfill({ status: 500, json: { ok: false } });
      return route.fulfill({ json: { ok: true, items: state.items, unreadCount: state.unreadCount, total: state.items.length, nextCursor: null } });
    }
    if (url.pathname.endsWith(".svg")) return route.fulfill({ contentType: "image/svg+xml", body: await readFile("public/portal/figma-logo.svg") });
    // The running app sits inside the component library's wrapper, whose injected rule ".css-xxxx a { background: transparent }" (class + element) beats a single class; reproduce it so the unread colour is checked against it.
    return route.fulfill({ contentType: "text/html", body: '<!doctype html><style>.css-dev-only-do-not-override-test a { background: transparent }</style><body class="css-dev-only-do-not-override-test"><div id="root"></div></body>' });
  });
  await page.goto(`http://header.test/${locale}/portal/courses`);
  for (const file of ["app/styles.css", "app/portal-design.css"]) await page.addStyleTag({ content: await readFile(file, "utf8") });
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: js });
  await page.evaluate(props => (window as unknown as { mount: (p: unknown) => void }).mount(props), { locale });
  await page.locator(".account-menu-trigger").waitFor();
  return { page, log };
}

const bell = (page: Page) => page.locator("button[aria-haspopup='true']").first();
const settle = (page: Page) => page.waitForTimeout(150);

test("the badge shows the count, 99+ for more, and nothing at zero; the status text follows", async () => {
  for (const [count, badge] of [[0, null], [3, "3"], [120, "99+"]] as const) {
    const { page } = await open("en-GB", { unreadCount: count, items: rows(), fail: false });
    await settle(page);
    const button = bell(page);
    assert.equal(await page.locator("[class*='badge']").count(), badge ? 1 : 0);
    if (badge) assert.equal((await page.locator("[class*='badge']").textContent()), badge);
    assert.equal(await button.getAttribute("aria-label"), count ? `Notifications, ${count} unread` : "Notifications");
    assert.equal((await page.getByRole("status").textContent())?.trim(), count ? `${count} unread` : "");
    await page.close();
  }
});

test("opening sends a second GET and shows five rows, the title and the unread count", async () => {
  const { page, log } = await open("en-GB", { unreadCount: 3, items: rows(), fail: false });
  await settle(page);
  assert.equal(log.gets, 1);
  await bell(page).click();
  const panel = page.getByRole("region", { name: "Notifications" });
  await panel.waitFor();
  await panel.locator("[class*='itemTitle']", { hasText: TITLES[4] }).waitFor();
  assert.equal(log.gets, 2);
  assert.equal(await panel.locator("li").count(), 5);
  assert.equal(await panel.getByRole("heading", { name: "Notifications" }).count(), 1);
  assert.ok(await panel.getByText("3 unread").count());
  const unreadBg = await panel.locator("li a").first().evaluate(element => getComputedStyle(element).backgroundColor);
  assert.equal(unreadBg, "rgb(245, 248, 255)");
  const readBg = await panel.locator("li a").nth(4).evaluate(element => getComputedStyle(element).backgroundColor);
  assert.notEqual(readBg, unreadBg);
  assert.equal(await page.evaluate(() => document.activeElement?.tagName), "A", "focus moves to the first item");
  await page.close();
});

test("clicking a row marks it read and follows its link; a row without a link goes to the centre", async () => {
  const first = await open("en-GB", { unreadCount: 3, items: rows(), fail: false });
  await bell(first.page).click();
  await first.page.locator("[class*='itemTitle']", { hasText: TITLES[0] }).click();
  await first.page.waitForURL(url => url.pathname === "/en-GB/my-learning/subscription");
  assert.deepEqual(first.log.posts, [{ notificationId: "n1", read: true }]);
  await first.page.close();

  const second = await open("en-GB", { unreadCount: 3, items: rows(), fail: false });
  await bell(second.page).click();
  await second.page.locator("[class*='itemTitle']", { hasText: TITLES[2] }).click();
  await second.page.waitForURL(url => url.pathname === "/en-GB/account/my-learning/notifications" && url.hash === "#n-n3");
  assert.deepEqual(second.log.posts, [{ notificationId: "n3", read: true }]);
  await second.page.close();
});

test("Escape closes the panel and returns focus to the bell; the unread event updates the badge", async () => {
  const { page } = await open("en-GB", { unreadCount: 3, items: rows(), fail: false });
  await bell(page).click();
  await page.getByRole("region", { name: "Notifications" }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("region", { name: "Notifications" }).waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-haspopup")), "true");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("lg:notifications-unread", { detail: 1 })));
  assert.equal((await page.locator("[class*='badge']").textContent()), "1");
  await page.close();
});

test("the 99+ badge does not cover the avatar at width 390 (R-07)", async () => {
  for (const width of [390, 1440]) {
    const { page } = await open("en-GB", { unreadCount: 120, items: rows(), fail: false }, width);
    await settle(page);
    const box = await page.evaluate(() => {
      const badge = document.querySelector("[class*='badge']")!.getBoundingClientRect();
      const avatar = document.querySelector(".account-menu-trigger")!.getBoundingClientRect();
      return { badgeRight: badge.right, avatarLeft: avatar.left, badgeLeft: badge.left, width: innerWidth };
    });
    assert.ok(box.badgeRight <= box.avatarLeft, `badge clears the avatar at ${width} ${JSON.stringify(box)}`);
    assert.ok(box.badgeRight <= box.width, `badge stays on screen at ${width}`);
    await page.close();
  }
});

test("five rows show in full when a title wraps to two lines, and the panel stays within the viewport (R-06)", async () => {
  const body = "A body that runs on for more than one line so that the two-line preview is used in every row of the dropdown panel.";
  const wrapped = rows().map((row, index) => ({ ...row, body, ...(index === 1 ? { title: "A title that is long enough to wrap onto a second line inside the dropdown panel" } : {}) }));
  for (const height of [900, 600]) {
    const { page } = await open("en-GB", { unreadCount: 3, items: wrapped, fail: false });
    await page.setViewportSize({ width: 1440, height });
    await bell(page).click();
    const panel = page.getByRole("region", { name: "Notifications" });
    await panel.locator("li").nth(4).waitFor();
    await settle(page);
    const metrics = await page.evaluate(() => {
      const list = document.querySelector("section[aria-label] ul")!;
      const box = document.querySelector("section[aria-label]")!.getBoundingClientRect();
      return { hidden: list.scrollHeight - list.clientHeight, bottom: box.bottom, height: innerHeight };
    });
    assert.ok(metrics.bottom <= metrics.height, `the panel fits the viewport ${JSON.stringify(metrics)}`);
    if (height === 900) assert.equal(metrics.hidden, 0, `all five rows are fully visible ${JSON.stringify(metrics)}`);
    await page.close();
  }
});

test("keyboard: Enter opens, focus enters the first row, Tab walks the rows and View all, Escape returns to the bell (R-03)", async () => {
  const { page } = await open("en-GB", { unreadCount: 3, items: rows(), fail: false });
  await settle(page);
  await bell(page).focus();
  await page.keyboard.press("Enter");
  const panel = page.getByRole("region", { name: "Notifications" });
  await panel.locator("li").nth(4).waitFor();
  await settle(page);
  const active = () => page.evaluate(() => { const element = document.activeElement; return { inPanel: Boolean(element?.closest("section[aria-label]")), text: element?.textContent ?? "" }; });
  const first = await active();
  assert.ok(first.inPanel && first.text.includes(TITLES[0]), `focus is in the first row ${JSON.stringify(first)}`);
  for (let index = 1; index < 5; index += 1) {
    await page.keyboard.press("Tab");
    const row = await active();
    assert.ok(row.inPanel && row.text.includes(TITLES[index]), `Tab reaches row ${index + 1} ${JSON.stringify(row)}`);
  }
  await page.keyboard.press("Tab");
  const footer = await active();
  assert.ok(footer.inPanel && footer.text.includes("View all notifications"), `Tab reaches View all ${JSON.stringify(footer)}`);
  assert.equal(await panel.count(), 1, "the panel is still open while focus is inside it");
  await page.keyboard.press("Escape");
  await panel.waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-haspopup")), "true");

  // Tab past the last stop closes the panel and hands focus back to the bell.
  await page.keyboard.press("Enter");
  await panel.locator("li").nth(4).waitFor();
  await settle(page);
  for (let index = 0; index < 5; index += 1) await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await panel.waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-haspopup")), "true");
  await page.close();
});

test("empty and error states render their texts in both locales, and nothing scrolls sideways at 390", async () => {
  for (const [locale, empty, error, retry] of [["en-GB", "You have no notifications yet.", "Notifications could not be loaded.", "Try again"], ["zh-CN", "你还没有通知。", "通知加载失败。", "重试"]] as const) {
    const none = await open(locale, { unreadCount: 0, items: [], fail: false }, 390);
    await bell(none.page).click();
    await none.page.getByText(empty).waitFor();
    await none.page.close();

    const broken = await open(locale, { unreadCount: 0, items: [], fail: true }, 390);
    await bell(broken.page).click();
    await broken.page.getByRole("alert").getByText(error).waitFor();
    await broken.page.getByRole("button", { name: retry }).waitFor();
    assert.equal(await broken.page.locator("[class*='badge']").count(), 0, "a failed fetch keeps the badge as it was");
    await broken.page.close();
  }
  const long = "https://example.org/" + "a".repeat(200);
  const wide = await open("en-GB", { unreadCount: 3, items: rows().map(row => ({ ...row, title: long, body: long })), fail: false }, 390);
  await bell(wide.page).click();
  await wide.page.getByRole("region", { name: "Notifications" }).waitFor();
  await settle(wide.page);
  const metrics = await wide.page.evaluate(() => {
    const panel = document.querySelector("section[aria-label]")!.getBoundingClientRect();
    return { scroll: document.documentElement.scrollWidth, width: innerWidth, left: panel.left, right: innerWidth - panel.right };
  });
  assert.ok(metrics.scroll <= metrics.width, `no horizontal scroll with the dropdown open ${JSON.stringify(metrics)}`);
  assert.ok(metrics.left >= 10 && metrics.right >= 10, `12px gutter within 2px (${metrics.left}, ${metrics.right})`);
  await wide.page.close();
});
