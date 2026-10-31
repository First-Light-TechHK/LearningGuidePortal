import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from 'playwright/test';

// Real Next.js SSR/navigation and APIs, disposable local product data only.
// Run after: NEXT_DIST_DIR=.next-backoffice-check npm run build
// node --import tsx --require ./scripts/register-tsconfig-paths.cjs scripts/verify-backoffice-ant-design.mjs
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const temporary=await mkdtemp(path.join(tmpdir(),'lg-backoffice-antd-'));
const output=path.join(repo,'test-results/backoffice-ant-design-live');await mkdir(output,{recursive:true});
const port=Number(process.env.BACKOFFICE_CHECK_PORT||3041),admin=`http://127.0.0.1:${port}`,learner=`http://localhost:${port}`;
const password='Local-fixture-pass-2026';
const env={...process.env,APP_ENV:'DEV',STORAGE_BACKEND:'local',PAYMENT_MODE:'demo',LOCAL_SOCIAL_LOGIN:'0',EMAIL_VERIFICATION_REQUIRED:'0',ADMIN_HOSTS:'127.0.0.1',DATABASE_URL:'',DATA_S3_BUCKET:'',KS_TUTOR_BASE_URL:'',OPENROUTER_API_KEY:'',SES_FROM_EMAIL:'',SMTP_HOST:'',BACKOFFICE_OPERATOR_EMAIL:'operator@antd-fixture.test',SESSION_SECRET:'local-isolated-backoffice-test-secret-only',NEXT_PUBLIC_APP_URL:learner,NEXT_DIST_DIR:process.env.NEXT_DIST_DIR||'.next-backoffice-check',NEXT_TELEMETRY_DISABLED:'1'};
let server,browser,page,log='';
const receipt={checks:[],errors:[]};
try {
  Object.assign(process.env,env);process.chdir(temporary);
  const store=await import('../services/productStore.ts');
  const operator=await store.registerUser({email:'operator@antd-fixture.test',password,nickname:'Operator',role:'operator'});
  await store.verifyEmailToken(await store.issueEmailVerificationToken(operator.id));
  const teacher=await store.registerUser({email:'teacher@antd-fixture.test',password,nickname:'Teacher',role:'teacher'});
  await store.verifyEmailToken(await store.issueEmailVerificationToken(teacher.id));
  const teacherSession=await store.createSession(teacher.id);
  const quote=await store.createQuote(operator.id,'epicureanism-pc-6');
  await store.completeDemoCheckout(operator.id,quote.quote.id);
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
  const html=await(await fetch(`${admin}/en-GB/backoffice/sign-in`)).text();
  assert(html.includes('id="antd-cssinjs"')&&html.includes('lg-ant'),'SSR must include Ant Design styles before hydration');
  receipt.checks.push('SSR registry emits backend styles');
  browser=await chromium.launch({channel:existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')?'chrome':undefined,headless:true});
  page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  page.setDefaultTimeout(10000);
  page.on('pageerror',error=>receipt.errors.push(error.message));
  const {getMessages}=await import('../lib/i18n/messages.ts');
  const {getCourseManagementMessages}=await import('../lib/i18n/courseManagementMessages.ts');
  for(const locale of ['en-GB','zh-CN']){
    const m=getMessages(locale),cm=getCourseManagementMessages(locale);
    if(locale==='en-GB'){
      await page.goto(`${admin}/${locale}/backoffice/sign-in`,{waitUntil:'networkidle'});
      await page.getByLabel(m.auth.email,{exact:true}).fill('operator@antd-fixture.test');
      await page.getByLabel(m.auth.password,{exact:true}).fill(password);
      await page.getByRole('button',{name:m.auth.submitSignIn,exact:true}).click();
      await page.waitForURL(`**/${locale}/backoffice/courses`);
    }else await page.goto(`${admin}/${locale}/backoffice/courses`,{waitUntil:'networkidle'});
    await expect(page.locator('aside nav a')).toHaveCount(5);
    await expect(page.locator('.bo-desktop .lg-ant-table-content > table')).toContainText('Epicureanism');
    await page.screenshot({path:path.join(output,`${locale}-courses-desktop.png`),fullPage:true});
    await page.goto(`${admin}/${locale}/backoffice/orders`,{waitUntil:'networkidle'});
    await expect(page.locator('.bo-desktop .lg-ant-table-content > table')).toContainText(m.backoffice.orders.paymentStatus.paid);
    if(!await page.locator('.bo-desktop .bo-detail').isVisible()) await page.locator('.lg-ant-table-row-expand-icon').first().click();
    await page.locator('.bo-desktop').getByRole('button',{name:m.backoffice.orders.refund,exact:true}).click();
    await expect(page.getByRole('dialog')).toContainText(m.backoffice.orders.confirmRefund);
    await page.getByRole('dialog').getByRole('button',{name:cm.cancel,exact:true}).click();
    await page.goto(`${admin}/${locale}/backoffice/payment`,{waitUntil:'networkidle'});
    await page.getByLabel(m.backoffice.payment.name,{exact:true}).fill('Local Stripe');
    await page.getByRole('button',{name:m.backoffice.payment.save,exact:true}).click();
    await expect(page.locator('.backoffice-ui .lg-ant-alert')).toContainText(m.backoffice.payment.saved);
    await page.goto(`${admin}/${locale}/backoffice/portal`,{waitUntil:'networkidle'});
    await page.getByRole('button',{name:m.portalEditor.chooseImage,exact:true}).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toBeHidden();
    await page.setViewportSize({width:390,height:844});
    for(const route of ['courses','orders','payment','portal']){
      await page.goto(`${admin}/${locale}/backoffice/${route}`,{waitUntil:'networkidle'});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${locale} ${route} overflows`);
      if(route==='courses'||route==='orders')await expect(page.locator('.bo-mobile-cards')).toBeVisible();
      await page.screenshot({path:path.join(output,`${locale}-${route}-mobile.png`),fullPage:true});
    }
    await page.getByRole('button',{name:cm.menu,exact:true}).click();await expect(page.getByRole('dialog').getByRole('link')).toHaveCount(5);
    await page.keyboard.press('Escape');
    await page.setViewportSize({width:1440,height:1000});
    receipt.checks.push(`${locale}: real admin login/navigation, course/order data, refund cancellation, payment save, CMS dialog, mobile cards/menu and no overflow`);
  }
  const teacherPage=await browser.newPage({viewport:{width:390,height:844}});
  await teacherPage.context().addCookies([{name:'learning_guide_admin_session',value:teacherSession.token,url:admin}]);
  await teacherPage.goto(`${admin}/en-GB/backoffice/courses`,{waitUntil:'networkidle'});
  await teacherPage.getByRole('button',{name:getCourseManagementMessages('en-GB').menu,exact:true}).click();
  await expect(teacherPage.getByRole('dialog').getByRole('link')).toHaveCount(1);
  const denied=await teacherPage.request.get(`${admin}/api/backoffice/orders`);assert.equal(denied.status(),403);
  receipt.checks.push('Teacher retains only Courses; Orders API rejects with 403');await teacherPage.close();
  let baseline=[];try{baseline=JSON.parse(await readFile('/private/tmp/lg-frontend-style-baseline.json','utf8'));}catch{}
  for(const locale of ['en-GB','zh-CN'])for(const width of [390,1440]){
    await page.setViewportSize({width,height:1000});await page.goto(`${learner}/${locale}/portal`,{waitUntil:'domcontentloaded',timeout:30000});
    await expect(page.locator('h1')).toBeVisible();
    await page.evaluate(()=>document.fonts.ready);
    assert.equal(await page.locator('[class*="lg-ant-"]').count(),0);
    const styles=await page.locator('h1').evaluate(el=>{const s=getComputedStyle(el),b=el.getBoundingClientRect();return{font:s.fontFamily,size:s.fontSize,weight:s.fontWeight,color:s.color,x:b.x,y:b.y,width:b.width,height:b.height}});
    const before=baseline.find(item=>item.locale===locale&&item.width===width);if(before)assert.deepEqual(styles,before.styles);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:path.join(output,`${locale}-portal-${width}.png`),fullPage:true});
  }
  receipt.checks.push('Portal both locales at 390/1440: no Ant Design nodes, no overflow; heading typography/geometry matches pre-migration baseline when available');
  assert.deepEqual(receipt.errors,[],'No hydration or uncaught browser errors');
  console.log(JSON.stringify(receipt,null,2));
}catch(error){receipt.errors.push(error.message);if(page)await page.screenshot({path:path.join(output,'failure.png'),fullPage:true});await writeFile(path.join(output,'server.log'),log);throw error;}
finally{
  await writeFile(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2));
  if(browser)await browser.close();if(server){server.kill('SIGTERM');await new Promise(resolve=>{server.once('exit',resolve);setTimeout(resolve,3000).unref();});}
  process.chdir(repo);await rm(temporary,{recursive:true,force:true});
}
