import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "playwright/test";
import { getMessages } from "../../lib/i18n/messages";

type Mount = { kind: string; locale: "en-GB" | "zh-CN"; key: number };
type TestWindow = Window & { mountPortal(input: Mount): void };

test("Portal Ant Design supports pending/retry/reset, keyboard account menu and bilingual responsive controls", { timeout: 180_000 }, async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React from 'react';import {createRoot} from 'react-dom/client';
      import {PortalProvider} from './components/portal/ui/PortalProvider';
      import {AuthEntryForm} from './components/portal/AuthEntryForm';
      import {AuthForm} from './components/portal/AuthForm';
      import {PasswordResetRequestForm} from './components/portal/PasswordResetRequestForm';
      import {PasswordResetConfirmForm} from './components/portal/PasswordResetConfirmForm';
      import {PurchasePanel} from './components/portal/PurchasePanel';
      import {AccountMenu} from './components/portal/AccountMenu';
      import {CourseLearningModeDialog} from './components/portal/CourseLearningModeDialog';
      import {ContactForm} from './app/[locale]/contact/ContactForm';
      import {getMessages} from './lib/i18n/messages';
      const root=createRoot(document.getElementById('root'));
      window.mountPortal=p=>{const m=getMessages(p.locale);root.render(<PortalProvider key={p.key} locale={p.locale}><main className="portal-page" data-portal-kind={p.kind}>
        {p.kind==='entry'?<div className="portal-auth-entry-page"><div className="portal-auth-stage"><AuthEntryForm locale={p.locale} copy={m.auth} returnTo={'/'+p.locale+'/account/my-learning'}/></div></div>:
        p.kind==='login'||p.kind==='signup'?<div className="portal-auth-stage"><AuthForm locale={p.locale} mode={p.kind==='login'?'sign-in':'sign-up'} signupDesign={p.kind==='signup'} initialEmail="learner@fixture.test" returnTo={'/'+p.locale+'/account/my-learning'} copy={m.auth}/></div>:
        p.kind==='reset'?<PasswordResetRequestForm locale={p.locale} returnTo={'/'+p.locale+'/account/my-learning'}/>:
        p.kind==='confirm'?<PasswordResetConfirmForm locale={p.locale} token="fixture-token" signInPath={'/'+p.locale+'/portal/sign-in'} requestPath={'/'+p.locale+'/portal/forgot-password'}/>:
        p.kind==='purchase'?<PurchasePanel locale={p.locale} courseId="course" plans={[{id:'server-plan',name:'Course',amountMinor:3900,currency:'usd',termMonths:6,device:'pc'}]} copy={{startTrial:m.portal.startTrial,buy:m.portal.buy,choosePlan:m.pricingDesign.term}}/>:
        p.kind==='contact'?<ContactForm locale={p.locale} copy={m.contactPage}/>:
        p.kind==='mode'?<CourseLearningModeDialog locale={p.locale} courseId="course" signedIn/>:
        <header className="portal-header"><AccountMenu locale={p.locale} displayName="Learner" labels={{myLearning:m.portal.myLearning,settings:m.account.settings,notifications:m.portal.notifications,signOut:m.learning.signOut}}/></header>}
      </main></PortalProvider>)};
    ` }, bundle: true, write: false, outfile: "portal.js", format: "esm", platform: "browser", jsx: "automatic", loader: { ".css": "local-css" },
    plugins: [{ name: "next", setup(b) {
      b.onResolve({ filter: /^\/portal\// }, args => ({ path: args.path, external: true }));
      b.onResolve({ filter: /^next\/(image|link|navigation)$/ }, args => ({ path: args.path, namespace: "stub" }));
      b.onLoad({ filter: /.*/, namespace: "stub" }, args => ({ loader: "tsx", resolveDir: process.cwd(), contents: args.path === "next/navigation"
        ? "const router={push(url){window.location.assign(url)},replace(url){history.replaceState({},'',url)},refresh(){}};export const useRouter=()=>router,usePathname=()=>location.pathname;"
        : "import React from 'react';export default function Element({prefetch,priority,fill,unoptimized,...p}){return p.src?<img {...p}/>:<a {...p}/>}" }));
    } }],
  });
  const browser = await chromium.launch({ channel: existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? 'chrome' : undefined });
  const output = "test-results/portal-ant-design"; await mkdir(output, { recursive: true });
  try {
    for (const locale of ["en-GB", "zh-CN"] as const) {
      const m = getMessages(locale), errors: string[] = [], requests: Array<{ path: string; body: Record<string, unknown> }> = [];
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
      page.setDefaultTimeout(8000);
      page.on("pageerror", error => errors.push(error.message));
      page.on("console", message => { if (message.type() === "error" && !message.text().includes("Failed to load resource")) errors.push(message.text()); });
      let release: () => void = () => {}, successfulReset = false;
      await page.route("http://portal.test/**", async route => {
        const pathname = new URL(route.request().url()).pathname;
        if (pathname.startsWith("/api/")) {
          requests.push({ path: pathname, body: route.request().postDataJSON() });
          await new Promise<void>(resolve => { release = resolve; });
          return route.fulfill({ status: successfulReset ? 200 : 503, json: successfulReset ? { ok: true } : { ok: false, error: "Fixture unavailable" } });
        }
        if (pathname.startsWith("/portal/")) return route.fulfill({ body: await readFile(path.join("public", pathname)), contentType: pathname.endsWith("svg") ? "image/svg+xml" : "image/jpeg" });
        return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
      });
      await page.goto(`http://portal.test/${locale}/portal`);
      for (const file of ["app/styles.css", "app/portal-design.css"]) await page.addStyleTag({ content: await readFile(file, "utf8") });
      await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith(".css"))!.text });
      await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith(".js"))!.text, type: "module" });
      await page.waitForFunction(() => typeof (window as unknown as TestWindow).mountPortal === "function");
      let key = 0;
      const mount = async (kind: string) => {
        await page.evaluate(p => (window as unknown as TestWindow).mountPortal(p), { kind, locale, key: ++key });
        await expect(page.locator("main")).toHaveAttribute("data-portal-kind", kind);
      };
      const twice = async () => page.locator("form").evaluate(form => {
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      });
      await mount("reset"); await page.locator('input[type="email"]').fill("learner@fixture.test");
      await twice(); await expect.poll(() => requests.length).toBe(1);
      await expect(page.locator("button[aria-busy=true]")).toHaveCount(1);
      release(); await expect(page.getByRole("alert")).toContainText(m.auth.resetRequestError);
      await twice(); await expect.poll(() => requests.length).toBe(2); release(); await expect(page.getByRole("alert")).toBeVisible();
      assert.deepEqual(requests[0].body, { email: "learner@fixture.test", locale, returnTo: `/${locale}/account/my-learning` });
      await mount("confirm");
      await page.locator('input[type="password"]').nth(0).fill("ValidPassword123!");
      await page.locator('input[type="password"]').nth(1).fill("DifferentPassword123!");
      await twice(); await expect(page.getByRole("alert")).toHaveText(m.auth.resetMismatch); assert.equal(requests.length, 2);
      await page.locator('input[type="password"]').nth(1).fill("ValidPassword123!");
      await twice(); await expect.poll(() => requests.length).toBe(3); release(); await expect(page.getByRole("alert")).toHaveText(m.auth.resetConfirmError);
      successfulReset = true; await twice(); await expect.poll(() => requests.length).toBe(4); release(); await expect(page.getByRole("status")).toHaveText(m.auth.resetDone); successfulReset = false;
      assert.deepEqual(requests[3].body, { token: "fixture-token", newPassword: "ValidPassword123!" });
      await mount("purchase");
      // Click synchronously to exercise the handler lock, independently of visual disabled state.
      await page.locator(".purchase-actions").evaluate(actions => { const buttons = actions.querySelectorAll("button"); buttons[1].click(); buttons[0].click(); buttons[1].click(); });
      await expect.poll(() => requests.length).toBe(5);
      await expect(page.locator(".purchase-actions button").nth(1)).toHaveAttribute("aria-busy", "true");
      await expect(page.locator(".purchase-actions button").nth(0)).toBeDisabled();
      assert.deepEqual(requests[4].body, { planId: "server-plan", kind: "purchase" });
      release(); await expect(page.getByRole("alert")).toHaveText("Fixture unavailable");
      await page.locator(".purchase-actions button").nth(0).click(); await expect.poll(() => requests.length).toBe(6);
      assert.deepEqual(requests[5].body, { planId: "server-plan", kind: "trial" }); release(); await expect(page.getByRole("alert")).toBeVisible();
      await mount("menu"); const trigger = page.locator(".account-menu-trigger");
      await trigger.focus(); await page.keyboard.press("Enter"); await expect(page.getByRole("menu")).toBeVisible();
      await expect(page.getByRole("menuitem")).toHaveCount(4);
      await expect(page.getByRole("menu").getByRole("link").nth(0)).toHaveAttribute("href", `/${locale}/account/my-learning`);
      await page.keyboard.press("Escape"); await expect(page.getByRole("menu")).toBeHidden(); await expect(trigger).toBeFocused();
      for (const width of [1440, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        for (const kind of ["entry", "login", "signup", "contact", "purchase", "menu"]) {
          await mount(kind); await expect(page.locator("main")).toBeVisible();
          if (kind === "menu") { await page.locator(".account-menu-trigger").click(); await expect(page.getByRole("menu")).toBeVisible(); }
          const overflow = await page.evaluate(() => [...document.querySelectorAll("body *")].filter(el => el.getBoundingClientRect().right > innerWidth + 1).map(el => el.tagName + "." + el.className));
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${locale}/${kind}/${width}: ${overflow.join(",")}`);
          if (width === 390 || width === 1440) await page.screenshot({ path: `${output}/${locale}-${kind}-${width}.png`, fullPage: true });
        }
      }
      assert.deepEqual(errors, []); await page.close();
    }
  } finally { await browser.close(); }
});
