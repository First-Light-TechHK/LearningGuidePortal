import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build, stop } from "esbuild";
import { chromium } from "playwright";
import nodemailer from "nodemailer";
import "sanitize-html";
import * as store from "../../services/productStore";
import { POST as send } from "../../app/api/auth/email-binding/request/route";
import { POST as confirm } from "../../app/api/auth/email-binding/confirm/route";
import { getMessages } from "../../lib/i18n/messages";

test("bilingual WeChat binding uses real email/API/session persistence and requires explicit confirmation", async () => {
  const cwd = process.cwd(), environment = { ...process.env }, transport = nodemailer.createTransport;
  const directory = await mkdtemp(path.join(tmpdir(), "lg-binding-browser-"));
  const mails: Array<{ text: string }> = [];
  const bundle = await build({ stdin: { resolveDir: cwd, loader: "tsx", contents: `import React from 'react';import{createRoot}from'react-dom/client';import{EmailBindingVerification}from'./components/portal/EmailBindingVerification';import{EmailBindingForm}from'./components/portal/EmailBindingForm';const query=new URLSearchParams(location.search);const locale=location.pathname.includes('zh-CN')?'zh-CN':'en-GB';const props={locale,returnTo:query.get('returnTo')||'/'+locale+'/account/my-learning'};createRoot(document.getElementById('root')).render(<main className="portal-page portal-auth-page"><div className="portal-auth-stage"><div className="portal-auth-card">{location.pathname.endsWith('/verify')?<EmailBindingVerification {...props} token={query.get('token')||''}/>:<EmailBindingForm {...props}/>}</div></div></main>);` }, bundle: true, write: false, platform: "browser", jsx: "automatic", plugins: [{ name: "navigation", setup(b) {
    b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export const useRouter=()=>({refresh(){}})", loader: "js" }));
  } }] });
  const css = (await Promise.all(["app/styles.css", "app/portal-design.css"].map(file => readFile(file, "utf8")))).join("\n");
  let origin = "", confirmations = 0;
  const server = createServer(async (req, res) => {
    try {
      if (req.url?.startsWith("/api/auth/email-binding/")) {
        const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const headers = new Headers(); for (const [name, value] of Object.entries(req.headers)) if (value) headers.set(name, Array.isArray(value) ? value.join(",") : value);
        const request = new Request(origin + req.url, { method: "POST", headers, body: Buffer.concat(chunks).toString() });
        if (req.url.endsWith("/confirm")) confirmations++;
        const response = await (req.url.endsWith("/confirm") ? confirm(request) : send(request));
        res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text());
      } else if (req.url === "/bundle.js") { res.setHeader("Content-Type", "text/javascript"); res.end(bundle.outputFiles[0].text); }
      else { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style><div id="root"></div><script src="/bundle.js"></script>`); }
    } catch (error) { res.statusCode = 500; res.end(String(error)); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  nodemailer.createTransport = (() => ({ sendMail: async (mail: { text: string }) => { mails.push(mail); } })) as unknown as typeof nodemailer.createTransport;
  process.chdir(directory);
  Object.assign(process.env, { APP_ENV: "DEV", STORAGE_BACKEND: "local", SMTP_HOST: "smtp.example.test", SMTP_USER: "fake", SMTP_PASS: "fake", NEXT_PUBLIC_APP_URL: origin });
  const browser = await chromium.launch();
  try {
    await mkdir(path.join(cwd, "test-results/email-binding"), { recursive: true });
    for (const locale of ["en-GB", "zh-CN"] as const) {
      for (const provider of ["email", "google"] as const) {
        const email = `${locale.toLowerCase()}-${provider}@example.test`, copy = getMessages(locale).auth;
        const target = provider === "google" ? await store.getOrCreateSocialUser({ provider: "google", providerSubject: email, email }) : await store.registerUser({ email, password: "Original-password-123" });
        if (!target.emailVerifiedAt) await store.verifyEmailToken(await store.issueEmailVerificationToken(target.id));
        const source = await store.getOrCreateSocialUser({ provider: "wechat", providerSubject: `wx:${email}` });
        const session = await store.createSession(source.id);
        const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
        await context.addCookies([{ name: "learning_guide_session", value: session.token, url: origin }]);
        const page = await context.newPage(), returnTo = `/${locale}/subscription?term=6#plans`;
        await page.goto(`${origin}/${locale}/portal/bind-email?returnTo=${encodeURIComponent(returnTo)}`);
        await page.locator('input[type="email"]').fill(email);
        await page.getByRole("button", { name: copy.bindingSend, exact: true }).click();
        await page.getByText(email, { exact: true }).waitFor();
        const link = mails.at(-1)!.text.match(/http[^\s]+/)![0];
        await page.goto(link);
        await page.getByRole("button", { name: copy.bindingVerifyAction }).waitFor();
        const count = confirmations;
        await page.waitForTimeout(100);
        assert.equal(confirmations, count, "opening the email must not bind an account");
        assert.equal((await store.getOrCreateSocialUser({ provider: "wechat", providerSubject: `wx:${email}` })).id, source.id);
        await page.screenshot({ path: path.join(cwd, `test-results/email-binding/${locale}-${provider}-confirm.png`), fullPage: true });
        await page.locator("section button").evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
        await page.getByRole("status").waitFor();
        assert.equal(confirmations, count + 1);
        assert.equal(await page.getByRole("status").textContent(), copy.bindingMerged);
        assert.equal(await page.getByRole("link", { name: copy.bindingContinue, exact: true }).getAttribute("href"), returnTo);
        const cookie = (await context.cookies()).find(item => item.name === "learning_guide_session")!;
        assert.equal((await store.getUserBySessionToken(cookie.value))?.id, target.id);
        assert.equal(await store.getUserBySessionToken(session.token, true), null);
        assert.equal(new URL(page.url()).searchParams.has("token"), false);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.screenshot({ path: path.join(cwd, `test-results/email-binding/${locale}-${provider}-success.png`), fullPage: true });
        await page.goto(`${origin}/${locale}/portal/bind-email/verify?token=expired`);
        await page.getByRole("button", { name: copy.bindingVerifyAction }).click();
        await page.getByRole("alert").waitFor();
        assert.equal(await page.getByRole("alert").textContent(), copy.bindingInvalid);
        await context.close();
      }
    }
  } finally {
    await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); stop();
    nodemailer.createTransport = transport; process.chdir(cwd); process.env = environment;
    if (path.dirname(directory) === tmpdir()) await rm(directory, { recursive: true, force: true });
  }
});
