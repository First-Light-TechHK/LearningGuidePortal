import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:net";
import { chromium } from "playwright";
import { getMessages } from "../lib/i18n/messages";

// Uses a production build and disposable local data; no external login or payment.
async function main() {
  const repo=process.cwd(), environment={...process.env}, dist=process.env.NEXT_DIST_DIR||".next-ui-check";
  await readFile(path.join(repo,dist,"BUILD_ID"));
  const probe=createServer();await new Promise<void>(resolve=>probe.listen(0,"127.0.0.1",resolve));
  const port=(probe.address() as {port:number}).port,origin=`http://127.0.0.1:${port}`;
  await new Promise<void>(resolve=>probe.close(()=>resolve()));
  const temporary=await mkdtemp(path.join(tmpdir(),"lg-course-sign-in-")),output=path.join(repo,"test-results/course-sign-in-return");
  await mkdir(output,{recursive:true});
  Object.assign(process.env,{STORAGE_BACKEND:"local",APP_ENV:"DEV",PAYMENT_MODE:"demo",LOCAL_EMAIL_PREVIEW:"1",LOCAL_SOCIAL_LOGIN:"0",NEXT_DIST_DIR:dist,NEXT_PUBLIC_APP_URL:origin,SESSION_SECRET:"course-sign-in-disposable-test-secret"});
  process.chdir(temporary);
  let server:ReturnType<typeof spawn>|undefined,browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
  try {
    const store=await import("../services/productStore");
    const email="course-owner@return.example.test",password="Local-only-password1";
    const owner=await store.registerUser({email,password,nickname:"Course Learner"});
    await store.verifyEmailToken(await store.issueEmailVerificationToken(owner.id));
    const {quote}=await store.createQuote(owner.id,"epicureanism-pc-6");await store.completeDemoCheckout(owner.id,quote.id);
    assert.equal((await store.getCoursePage("epicureanism",owner.id)).cta,"continue_learning");
    server=spawn(process.execPath,[path.join(repo,"node_modules/next/dist/bin/next"),"start",repo,"-p",String(port),"--hostname","127.0.0.1"],{cwd:temporary,env:process.env,windowsHide:true,stdio:"ignore"});
    let ready=false;
    for(let attempt=0;attempt<80;attempt++) {
      try {if((await fetch(`${origin}/en-GB/portal`,{signal:AbortSignal.timeout(2000)})).ok){ready=true;break;}}catch {/* Wait for the isolated server. */}
      if(server.exitCode!==null)throw new Error("Isolated Next server stopped");
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    assert.ok(ready,"production server starts");browser=await chromium.launch();
    for(const locale of ["en-GB","zh-CN"] as const) {
      const context=await browser.newContext(),page=await context.newPage(),copy=getMessages(locale),target=`${origin}/${locale}/portal/courses/epicureanism`;
      const preview=()=>page.locator('[data-course-cta-link="start_preview"],[data-course-cta-link="continue_preview"]');
      const start=()=>page.locator('[data-syllabus] [data-course-cta-link="continue_learning"]');
      await page.goto(target);await preview().waitFor();
      await preview().click();
      await page.locator('input[type="email"]').fill(email);await page.locator('.auth-entry-form button').click();
      await page.waitForURL(url=>url.searchParams.get("step")==="password");
      assert.equal(new URL(page.url()).searchParams.get("returnTo"),new URL(target).pathname);
      await page.locator('input[autocomplete="current-password"]').fill(password);await page.locator('button.auth-submit').click();
      await page.waitForURL(target);await start().waitFor();
      assert.equal(await start().textContent(),copy.courseDetailDesign.start);assert.equal(await preview().count(),0);
      assert.equal(await page.locator('[data-course-plan-status="included"]').count(),1);
      await page.screenshot({path:path.join(output,`${locale}-login-return.png`),fullPage:true});

      // Restore an anonymous client-router snapshot after Session changes elsewhere.
      await context.clearCookies();await page.goto(target);await preview().waitFor();
      await page.locator('header .portal-brand').click();await page.waitForURL(`${origin}/${locale}/portal`);
      await page.waitForLoadState("networkidle");
      const login=await context.request.post(`${origin}/api/auth/login`,{data:{email,password}});assert.equal(login.status(),200);
      await page.goBack();await start().waitFor();
      assert.equal(page.url(),target);assert.equal(await preview().count(),0);
      assert.equal(await page.locator('[data-course-plan-status="included"]').count(),1);
      await page.screenshot({path:path.join(output,`${locale}-restored-start.png`),fullPage:true});

      // The reverse transition must also discard cached access presentation.
      await page.locator('header .portal-brand').click();await page.waitForURL(`${origin}/${locale}/portal`);
      await page.waitForLoadState("networkidle");await context.clearCookies();
      await page.goBack();await preview().waitFor();
      assert.equal(await start().count(),0);assert.equal(await page.locator('[data-course-plan-status="purchase"]').count(),1);
      await context.close();
    }
    console.log("PASS: Preview login and cached course restoration immediately resolve current server access in both locales; logout restores Preview.");
  } finally {
    await browser?.close();
    if(server&&server.exitCode===null){const stopped=new Promise<void>(resolve=>server!.once("exit",()=>resolve()));server.kill();await stopped;}
    process.chdir(repo);process.env=environment;
    if(path.dirname(temporary)===tmpdir()&&path.basename(temporary).startsWith("lg-course-sign-in-"))await rm(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:100});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
