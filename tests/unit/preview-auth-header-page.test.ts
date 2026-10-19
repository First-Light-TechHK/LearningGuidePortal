import assert from "node:assert/strict";
import { test, after } from "node:test";
import { createServer } from "node:http";
import { build, stop } from "esbuild";
import { chromium } from "playwright";
import { isolate, setCookie, clearCookies, SESSION_COOKIE } from "../io/harness";
import { getMessages } from "../../lib/i18n/messages";
import { verifiedUser } from "./helpers/my-learning";

after(() => stop());

test("one Preview login returns to its course with current account navigation even from a stale visitor render", async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React from 'react';import {createRoot} from 'react-dom/client';
      import {PortalHeader} from './components/portal/PortalHeader';
      import {AuthForm} from './components/portal/AuthForm';import {AuthEntryForm} from './components/portal/AuthEntryForm';
      import {getMessages} from './lib/i18n/messages';
      const locale=location.pathname.split('/')[1],copy=getMessages(locale),target='/'+locale+'/portal/courses/epicureanism',query=new URLSearchParams(location.search);
      createRoot(document.getElementById('root')).render(<><PortalHeader locale={locale}/>{location.pathname.endsWith('/sign-in')?
        query.get('step')==='password'?<AuthForm locale={locale} mode="sign-in" initialEmail={query.get('email')} copy={copy.auth} returnTo={query.get('returnTo')}/>:<AuthEntryForm locale={locale} copy={copy.auth} returnTo={query.get('returnTo')}/>:
        <><h1>Course detail</h1><a data-preview href={'/'+locale+'/portal/sign-in?returnTo='+encodeURIComponent(target)}>Preview</a></>}</>);` },
    bundle: true, write: false, platform: "browser", jsx: "automatic",
    plugins: [{ name: "next", setup(b) {
      b.onResolve({ filter: /^next\// }, args => ({ path: args.path, namespace: "next" }));
      b.onResolve({ filter: /AuthProviders$/ }, () => ({ path: "providers", namespace: "next" }));
      b.onLoad({ filter: /.*/, namespace: "next" }, a => ({ loader: "tsx", resolveDir: process.cwd(), contents:
        a.path === "providers" ? "export const AuthProviders=()=>null" : a.path === "next/navigation" ? "export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search)"
          : "import React from 'react';export default function Component({prefetch,priority,...props}){return props.src?<img {...props}/>:<a {...props}/>}" }));
    } }],
  });
  const { restore } = await isolate("lg-preview-header-");
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let loginCount = 0, rejectMe = false;
  const server = createServer(async (req, res) => {
    try {
      if (req.url === "/bundle.js") { res.setHeader("Content-Type", "text/javascript"); res.end(bundle.outputFiles[0].text); return; }
      if (req.url?.startsWith("/api/auth/")) {
        clearCookies();
        const cookie = req.headers.cookie?.split(";").map(item => item.trim()).find(item => item.startsWith(SESSION_COOKIE + "="))?.slice(SESSION_COOKIE.length + 1);
        if (cookie) setCookie(SESSION_COOKIE, cookie);
        let response: Response;
        if (req.url === "/api/auth/me") {
          response = rejectMe ? new Response("unavailable", { status: 503 }) : await (await import("../../app/api/auth/me/route")).GET();
        } else {
          const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
          const request = new Request("http://localhost" + req.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: Buffer.concat(chunks).toString() });
          if (req.url === "/api/auth/check-email") response = await (await import("../../app/api/auth/check-email/route")).POST(request);
          else if (req.url === "/api/auth/login") { loginCount++; response = await (await import("../../app/api/auth/login/route")).POST(request); }
          else throw new Error("Unexpected API");
        }
        res.statusCode = response.status;
        response.headers.forEach((value, key) => res.setHeader(key, value));
        res.end(await response.text()); return;
      }
      res.setHeader("Content-Type", "text/html");
      res.end('<!doctype html><div id="root"></div><script src="/bundle.js"></script>');
    } catch { res.statusCode = 500; res.end("Test server failed"); }
  });
  try {
    const store = await import("../../services/productStore");
    const user = await verifiedUser(store, "preview@example.test");
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    browser = await chromium.launch({ channel: "msedge" });
    for (const locale of ["en-GB", "zh-CN"] as const) {
      const context = await browser.newContext(); const page = await context.newPage();
      const copy = getMessages(locale), target = `/${locale}/portal/courses/epicureanism`;
      const loggedInBefore = loginCount;
      await page.goto(origin + target);
      await page.locator(".portal-header-link").waitFor();
      await page.locator("[data-preview]").click();
      await page.locator('input[type="email"]').fill("preview@example.test");
      await page.locator(".auth-entry-form button").click();
      await page.waitForURL(url => url.searchParams.get("step") === "password");
      assert.equal(new URL(page.url()).searchParams.get("returnTo"), target);
      await page.locator('input[autocomplete="current-password"]').fill("password1");
      await page.locator("button.auth-submit").click();
      await page.waitForURL(origin + target);
      await page.locator(".account-menu-trigger").waitFor();
      assert.equal(await page.locator(".portal-header-link").count(), 0);
      assert.equal(loginCount, loggedInBefore + 1);
      await page.locator(".account-menu-trigger").click();
      assert.equal(await page.locator(".account-menu-identity strong").textContent(), user.nickname);
      assert.equal(await page.getByRole("menuitem").first().textContent(), copy.portal.myLearning);
      assert.equal(await page.locator(".account-menu-identity div span").count(), 0);
      const me = await context.request.get(origin + "/api/auth/me");
      assert.equal(me.headers()["cache-control"], "private, no-store");
      assert.equal(me.headers().vary, "Cookie");
      // A failed reconciliation preserves the currently rendered account.
      rejectMe = true;
      await Promise.all([
        page.waitForResponse(response => response.url().endsWith("/api/auth/me") && response.status() === 503),
        page.evaluate(() => dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }))),
      ]);
      assert.equal(await page.locator(".account-menu-trigger").count(), 1);
      rejectMe = false;
      // Browser history may restore a stale signed-in header after logout.
      await context.clearCookies();
      await page.evaluate(() => dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
      await page.locator(".portal-header-link").waitFor();
      assert.equal(await page.locator(".account-menu-trigger").count(), 0);
      await context.close();
    }
  } finally {
    await browser?.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await restore();
  }
});
