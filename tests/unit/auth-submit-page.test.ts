import assert from "node:assert/strict";
import {test} from "node:test";
import {build} from "esbuild";
import {chromium} from "playwright";

test("authentication submits once while pending and retains the password step on failure",async()=>{
  const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {AuthForm} from './components/portal/AuthForm';import {AuthEntryForm} from './components/portal/AuthEntryForm';import {getMessages} from './lib/i18n/messages';const root=createRoot(document.getElementById('root'));window.mount=(locale,entry)=>flushSync(()=>root.render(entry?<AuthEntryForm key={locale+'entry'} locale={locale} copy={getMessages(locale).auth} returnTo={'/'+locale+'/account/my-learning'}/>:<AuthForm key={locale} locale={locale} mode="sign-in" initialEmail="learner@example.test" copy={getMessages(locale).auth} returnTo={'/'+locale+'/account/my-learning'}/>));`,resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,platform:"browser",jsx:"automatic",plugins:[{name:"stubs",setup(b){b.onResolve({filter:/AuthProviders$/},()=>({path:"providers",namespace:"stub"}));b.onResolve({filter:/^next\//},()=>({path:"next",namespace:"stub"}));b.onLoad({filter:/.*/,namespace:"stub"},a=>({loader:"tsx",contents:a.path==="providers"?"export const AuthProviders=()=>null":"import React from 'react';export default function Component(props){return props.src?<img {...props}/>:<a {...props}/>}",resolveDir:process.cwd()}));}}]});
  const browser=await chromium.launch({channel:"msedge"});
  try {for(const locale of ["en-GB","zh-CN"]){
    const page=await browser.newPage();let requests=0;let success=false;let finish:()=>void=()=>{};
    const waitForRequests=async(count:number)=>{for(let i=0;i<100&&requests<count;i++)await page.waitForTimeout(20);};
    await page.route("http://auth.test/**",route=>route.request().isNavigationRequest()?route.fulfill({body:'<div id="root"></div>',contentType:"text/html"}):route.fulfill({body:""}));
    await page.route("**/api/auth/**",async route=>{requests++;await new Promise<void>(resolve=>{finish=resolve;});await route.fulfill({status:success?200:401,json:success?{ok:true}:{ok:false,code:"AUTHENTICATION_FAILED"}});});
    await page.goto(`http://auth.test/${locale}/portal/sign-in?step=password`);await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.evaluate(locale=>(window as any).mount(locale,false),locale);
    await page.locator('input[autocomplete="current-password"]').fill("CorrectPassword123!");
    const twice=()=>page.locator("form").evaluate(form=>{form.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));form.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));});
    await twice();await page.waitForFunction(()=>document.querySelector("button.auth-submit")?.hasAttribute("disabled"));
    await waitForRequests(1);await page.waitForTimeout(100);assert.equal(requests,1,"duplicate Enter/click must not create competing sessions");finish();
    await page.getByRole("alert").waitFor();assert.equal(await page.locator('input[autocomplete="current-password"]').inputValue(),"CorrectPassword123!");assert.equal(new URL(page.url()).searchParams.get("step"),"password");
    await twice();await waitForRequests(2);await page.waitForTimeout(100);assert.equal(requests,2,"retry sends one new request");finish();await page.getByRole("alert").waitFor();
    await page.evaluate(locale=>(window as any).mount(locale,true),locale);await page.locator('input[type="email"]').fill("learner@example.test");await twice();await waitForRequests(3);await page.waitForTimeout(100);assert.equal(requests,3,"email step also suppresses duplicate requests");finish();await page.getByRole("alert").waitFor();
    await page.evaluate(locale=>(window as any).mount(locale,false),locale);await page.locator('input[autocomplete="current-password"]').fill("CorrectPassword123!");success=true;await twice();await waitForRequests(4);await page.waitForTimeout(100);assert.equal(requests,4);finish();await page.waitForURL(`http://auth.test/${locale}/account/my-learning`);await page.close();
  }}finally{await browser.close();}
});
