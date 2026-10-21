import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import { mkdir, readFile } from "node:fs/promises";
import { getMessages } from "../../lib/i18n/messages";

test("contact submits in-page, suppresses duplicate submits and retains data/key for retry in both locales",async()=>{
  const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {ContactForm} from './app/[locale]/contact/ContactForm';import {getMessages} from './lib/i18n/messages';window.mount=locale=>createRoot(document.getElementById('root')).render(<main className="portal-page contact-design-page"><ContactForm locale={locale} copy={getMessages(locale).contactPage}/></main>);`,resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,platform:"browser",jsx:"automatic"});
  const browser=await chromium.launch();await mkdir("test-results/contact",{recursive:true});
  try{for(const locale of ["en-GB","zh-CN"] as const){
    const page=await browser.newPage();const requests:any[]=[];let success=false,code="CONTACT_UNAVAILABLE",release:()=>void=()=>{};
    await page.route("http://localhost:43123/**",route=>route.fulfill({body:'<div id="root"></div>',contentType:"text/html"}));
    await page.route("**/api/contact",async route=>{requests.push(route.request().postDataJSON());await new Promise<void>(resolve=>{release=resolve;});await route.fulfill({status:success?201:503,json:success?{ok:true,data:{id:"saved"}}:{ok:false,code}});});
    await page.goto("http://localhost:43123/");for(const file of ["app/styles.css","app/portal-design.css"])await page.addStyleTag({content:await readFile(file,"utf8")});
    await page.addScriptTag({content:bundle.outputFiles[0].text});await page.evaluate(locale=>(window as any).mount(locale),locale);
    for(const [name,value] of Object.entries({firstName:"小明",lastName:"张",email:"learner@example.test",subject:"Course question",message:"Please help with my course."}))await page.locator(`[name="${name}"]`).fill(value);
    const button=page.getByRole("button",{name:getMessages(locale).contactPage.submit});await button.click();assert.equal(requests.length,0,"consent is mandatory");await page.locator('[name="consent"]').check();
    const submit=()=>page.locator("form").evaluate(form=>{form.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));form.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));});
    await submit();await page.waitForFunction(()=>document.querySelector('button[type="submit"]')?.hasAttribute('disabled'));
    while(requests.length<1)await page.waitForTimeout(10);assert.equal(requests.length,1);assert.equal(await page.locator('[name="message"]').isDisabled(),true);release();
    await page.getByRole("alert").waitFor();assert.equal(await page.getByRole("alert").textContent(),getMessages(locale).contactPage.failed);assert.equal(await page.locator('[name="message"]').inputValue(),"Please help with my course.");
    await page.screenshot({path:`test-results/contact/${locale}-failure.png`,fullPage:true});
    success=true;await submit();while(requests.length<2)await page.waitForTimeout(10);assert.equal(requests[0].clientEventId,requests[1].clientEventId);release();await page.getByRole("status").waitFor();
    assert.equal(await page.getByRole("status").textContent(),getMessages(locale).contactPage.success);assert.equal(await page.locator('[name="message"]').inputValue(),"");assert.equal(page.url(),"http://localhost:43123/");
    await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:`test-results/contact/${locale}-success-mobile.png`,fullPage:true});
    await page.close();
  }}finally{await browser.close();}
});
