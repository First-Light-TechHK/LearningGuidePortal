import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from 'playwright/test';

// Portal controls: real Next.js SSR, authentication, Contact, quotes and mobile navigation. Disposable data only.
// Run after: NEXT_DIST_DIR=.next-backoffice-check npm run build
// node --import tsx --require ./scripts/register-tsconfig-paths.cjs scripts/verify-backoffice-ant-design.mjs
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const temporary=await mkdtemp(path.join(tmpdir(),'lg-portal-antd-'));
const output=path.join(repo,'test-results/portal-ant-design-live');await mkdir(output,{recursive:true});
const port=Number(process.env.PORTAL_CHECK_PORT||3043),admin=`http://127.0.0.1:${port}`,learner=`http://localhost:${port}`;
const password='Local-fixture-pass-2026';
const env={...process.env,APP_ENV:'DEV',STORAGE_BACKEND:'local',PAYMENT_MODE:'demo',LOCAL_SOCIAL_LOGIN:'0',EMAIL_VERIFICATION_REQUIRED:'0',ADMIN_HOSTS:'127.0.0.1',DATABASE_URL:'',DATA_S3_BUCKET:'',KS_TUTOR_BASE_URL:'',OPENROUTER_API_KEY:'',SES_FROM_EMAIL:'',SMTP_HOST:'',BACKOFFICE_OPERATOR_EMAIL:'operator@antd-fixture.test',SESSION_SECRET:'local-isolated-backoffice-test-secret-only',NEXT_PUBLIC_APP_URL:learner,NEXT_DIST_DIR:process.env.NEXT_DIST_DIR||'.next-backoffice-check',NEXT_TELEMETRY_DISABLED:'1'};
let server,browser,page,log='';
const receipt={checks:[],errors:[]};
try {
  Object.assign(process.env,env);process.chdir(temporary);
  const store=await import('../services/productStore.ts');
  const operator=await store.registerUser({email:'operator@antd-fixture.test',password,nickname:'Operator',role:'operator'});
  await store.verifyEmailToken(await store.issueEmailVerificationToken(operator.id));
  const file=path.join(temporary,'data/knowledge_system/learning_guide/product.json');
  const data=JSON.parse(await readFile(file,'utf8'));
  for(const course of data.courses)for(const field of ['cover','thumbnailPath'])if(course[field]?.startsWith('https://aitutor-data-'))course[field]='/portal/course-book.jpg';
  await writeFile(file,JSON.stringify(data));
  process.chdir(repo);
  server=spawn(process.execPath,[path.join(repo,'node_modules/next/dist/bin/next'),'start',repo,'--hostname','127.0.0.1','-p',String(port)],{cwd:temporary,env,stdio:['ignore','pipe','pipe']});
  server.stdout.on('data',chunk=>{log+=chunk;});server.stderr.on('data',chunk=>{log+=chunk;});
  let ready=false;
  for(let attempt=0;attempt<80;attempt++){
    try{if((await fetch(`${admin}/api/health`)).ok){ready=true;break;}}catch{}
    if(server.exitCode!==null)throw new Error('Preview exited: '+log);
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  assert(ready,'Preview did not become ready');
  const {getMessages}=await import('../lib/i18n/messages.ts');
  const html=await(await fetch(`${learner}/en-GB/portal/sign-in`)).text();
  assert(html.includes('id="antd-cssinjs"')&&html.includes('lg-ant-btn'),'Portal SSR must emit button styles before hydration');
  receipt.checks.push('Portal SSR emits Ant Design registry styles');
  browser=await chromium.launch({channel:existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')?'chrome':undefined,headless:true});
  for(const locale of ['en-GB','zh-CN']) {
    const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    await context.addInitScript(()=>localStorage.setItem('learning-guide-cookie-preference','essential'));
    page=await context.newPage();page.setDefaultTimeout(12000);
    page.on('pageerror',error=>receipt.errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error'&&!message.text().includes('Failed to load resource'))receipt.errors.push(message.text());});
    const m=getMessages(locale);
    await page.goto(`${learner}/${locale}/portal/sign-in?returnTo=${encodeURIComponent('/'+locale+'/subscription')}`,{waitUntil:'networkidle'});
    await page.getByRole('textbox').fill('operator@antd-fixture.test');
    await page.getByRole('textbox').press('Enter');
    await expect(page.locator('input[autocomplete="current-password"]')).toBeVisible();
    await page.locator('input[autocomplete="current-password"]').fill(password);
    await page.locator('input[autocomplete="current-password"]').press('Enter');
    await page.waitForURL(`${learner}/${locale}/subscription`);
    await expect(page.locator('.pricing-design-card')).toHaveCount(2);
    await page.getByRole('button',{name:m.pricingDesign.year,exact:true}).click();
    await expect(page.getByRole('button',{name:m.pricingDesign.year,exact:true})).toHaveAttribute('aria-pressed','true');
    await page.locator('.pricing-design-card--category .pricing-category-switch button').last().click();
    await expect(page.locator('.pricing-design-card--category')).toHaveAttribute('data-selected','true');
    await page.locator('.pricing-design-card--category .purchase-actions button').click();
    await page.waitForURL('**/portal/subscription/confirmation?quoteId=*');
    const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
    const submit=dialog.locator('.confirmation-actions button');await expect(submit).toBeDisabled();
    await dialog.locator('input[type="checkbox"]').nth(0).check();
    await dialog.locator('input[type="checkbox"]').nth(1).check();
    await expect(submit).toBeDisabled();
    await dialog.locator('input[type="checkbox"]').nth(2).check();await expect(submit).toBeEnabled();
    await page.screenshot({path:path.join(output,`${locale}-confirmation-desktop.png`),fullPage:true});
    await page.keyboard.press('Escape');await page.waitForURL('**/subscription?planId=*');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    receipt.checks.push(`${locale}: real email/password Enter submission and returnTo; period/category selection; server quote and confirmation consent gates; Escape dismissal`);
    for(const width of [1440,390]){
      await page.setViewportSize({width,height:1000});
      await page.goto(`${learner}/${locale}/contact`,{waitUntil:'networkidle'});
      for(const [name,value] of Object.entries({firstName:'Local',lastName:'Fixture',email:'local@fixture.test',subject:'Portal controls test',message:'Disposable local validation only.'}))await page.locator(`[name="${name}"]`).fill(value);
      await page.locator('[name="consent"]').check();
      await page.locator('.contact-submit').click();
      await expect(page.getByRole('status')).toHaveText(m.contactPage.success);
      await expect(page.locator('[name="message"]')).toHaveValue('');
      await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth);
      await page.screenshot({path:path.join(output,`${locale}-contact-${width}.png`),fullPage:true});
      await page.goto(`${learner}/${locale}/subscription`,{waitUntil:'networkidle'});
      await page.locator('.account-menu-trigger').click();await expect(page.getByRole('menu')).toBeVisible();
      await expect(page.getByRole('menuitem')).toHaveCount(4);
      await page.screenshot({path:path.join(output,`${locale}-pricing-menu-${width}.png`),fullPage:true});
      await page.keyboard.press('Escape');await expect(page.getByRole('menu')).toBeHidden();await expect(page.locator('.account-menu-trigger')).toBeFocused();
      await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth);
    }
    await page.locator('.account-menu-trigger').click();
    await page.getByRole('menuitem',{name:m.learning.signOut,exact:true}).click();
    await page.waitForURL(`${learner}/${locale}/portal`);
    assert.equal((await page.request.get(`${learner}/api/auth/me`)).status(),200);
    assert.equal((await(await page.request.get(`${learner}/api/auth/me`)).json()).user,null);
    await page.goto(`${learner}/${locale}/account/my-learning`,{waitUntil:'networkidle'});
    await expect(page).toHaveURL(/portal\/sign-in/);
    receipt.checks.push(`${locale}: real Contact POST/reset; desktop/mobile dropdown keyboard focus, no overflow; logout revokes learner access`);
    await context.close();page=null;
  }
  assert.deepEqual(receipt.errors,[],'No hydration or uncaught browser errors');
  console.log(JSON.stringify(receipt,null,2));
}catch(error){receipt.errors.push(error.message);if(page)await page.screenshot({path:path.join(output,'failure.png'),fullPage:true});await writeFile(path.join(output,'server.log'),log);throw error;}
finally{
  await writeFile(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2));
  if(browser)await browser.close();if(server){server.kill('SIGTERM');await new Promise(resolve=>{server.once('exit',resolve);setTimeout(resolve,3000).unref();});}
  process.chdir(repo);await rm(temporary,{recursive:true,force:true});
}
