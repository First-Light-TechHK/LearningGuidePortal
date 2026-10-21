import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import { getMessages } from "../../lib/i18n/messages";
import { readFile, mkdir } from "node:fs/promises";

test("password validation follows the UI locale across browser languages and retains input for retry",async()=>{
  const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {SettingsForm} from './components/portal/SettingsForm';import {getMessages} from './lib/i18n/messages';window.mount=locale=>createRoot(document.getElementById('root')).render(<SettingsForm countries={['China']} uiLocale={locale} initialLocale="en-GB" initialCountry="China" initialNickname="Learner" initialEmail="learner@example.test" hasAvatar={false} copy={getMessages(locale).settingsPage}/>);`,resolveDir:process.cwd(),loader:"tsx"},bundle:true,write:false,platform:"browser",jsx:"automatic",plugins:[{name:"cropper",setup(b){b.onResolve({filter:/AvatarCropper$/},()=>({path:"cropper",namespace:"stub"}));b.onLoad({filter:/.*/,namespace:"stub"},()=>({contents:"export const AvatarCropper=()=>null"}));}}]});
  const browser=await chromium.launch();
  try{for(const [locale,browserLocale] of [["en-GB","en-GB"],["en-GB","zh-CN"],["zh-CN","en-GB"],["zh-CN","zh-CN"]] as const){
    const page=await browser.newPage({locale:browserLocale});let code="CURRENT_PASSWORD_INCORRECT",success=true,networkFailure=false;const requests:any[]=[];
    await page.route("http://settings.test/**",async route=>route.fulfill({body:new URL(route.request().url()).pathname.endsWith('.svg')?await readFile('public/portal/subscriptions/design/chevron-down.svg'):'<div id="root"></div>',contentType:new URL(route.request().url()).pathname.endsWith('.svg')?'image/svg+xml':'text/html'}));
    await page.route("**/api/me/profile",route=>{requests.push(route.request().postDataJSON());return networkFailure?route.abort():route.fulfill({status:success?200:400,json:success?{ok:true}:{ok:false,code,error:"Current password is incorrect."}});});
    await page.goto("http://settings.test/");await page.addScriptTag({content:bundle.outputFiles[0].text});await page.evaluate(locale=>(window as any).mount(locale),locale);
    for(const file of ['app/styles.css','app/portal-design.css'])await page.addStyleTag({content:await readFile(file,'utf8')});
    const submit=()=>page.locator('button[type="submit"],.settings-save-row button').click();
    const name=page.locator('input[autocomplete="name"]');
    await name.waitFor();
    assert.equal(await page.getByRole('heading', {name:getMessages(locale).settingsPage.deviceManagement,exact:true}).count(), 0);
    assert.equal(await page.getByRole('heading', {name:getMessages(locale).settingsPage.emailNotifications,exact:true}).count(), 0);
    assert.equal(await page.locator('#settings-device-heading,#settings-email-heading,.settings-disabled-section').count(), 0);
    assert.equal(await page.locator('.avatar-upload').isVisible(), false);
    assert.equal(await page.getByLabel(getMessages(locale).settingsPage.uploadAvatar).isVisible(), false);
    assert.equal(await page.locator('.avatar-upload input[type="file"]').count(), 1);
    await name.fill('张伟');await submit();await page.getByRole('status').waitFor();assert.equal(requests.at(-1).nickname,'张伟');
    await name.fill('');await submit();assert.equal(await name.evaluate(e=>(e as HTMLInputElement).validationMessage),getMessages(locale).auth.nameInvalid);
    await name.evaluate(e=>{const data=new DataTransfer();data.setData('text','  **Ada Lovelace**  ');e.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));});
    assert.equal(await name.inputValue(),'Ada Lovelace');const nameSaved=page.waitForResponse('**/api/me/profile');await submit();await nameSaved;assert.equal(requests.at(-1).nickname,'Ada Lovelace');
    const arrows=await page.locator('.settings-details-grid select,.settings-interest-menu summary').evaluateAll(elements=>elements.map(e=>({image:getComputedStyle(e).backgroundImage,position:getComputedStyle(e).backgroundPosition,size:getComputedStyle(e).backgroundSize})));
    assert.equal(arrows.length,4);assert.ok(arrows.every(arrow=>JSON.stringify(arrow)===JSON.stringify(arrows[0])));
    assert.equal(await page.locator('.settings-interest-menu summary').evaluate(e=>getComputedStyle(e).listStyleType),'none');
    await page.locator('.settings-interest-menu summary').click();await page.locator('.settings-interest-menu input[type="checkbox"]').first().check();
    assert.equal(await page.locator('.settings-interest-menu input:checked').count(),1);
    await mkdir('test-results/settings-fields',{recursive:true});await page.screenshot({path:`test-results/settings-fields/${locale}.png`,fullPage:true});
    success=false;
    const current=page.locator('input[autocomplete="current-password"]'),passwords=page.locator('input[autocomplete="new-password"]');
    assert.equal(await page.evaluate(()=>navigator.language),browserLocale);
    for(const input of await passwords.all()){
      const before=requests.length;
      await input.fill("short");await submit();
      assert.equal(await input.evaluate(e=>(e as HTMLInputElement).validity.tooShort),true);
      assert.equal(await input.evaluate(e=>(e as HTMLInputElement).validationMessage),getMessages(locale).settingsDesign.newPasswordTooShort,`${locale} UI / ${browserLocale} browser`);
      assert.equal(requests.length,before,"short passwords must not reach the profile API");
      await input.fill("12345678");
      assert.equal(await input.evaluate(e=>(e as HTMLInputElement).validationMessage),"");
      await input.fill("");
      assert.equal(await input.evaluate(e=>(e as HTMLInputElement).validity.valid),true,"password changes stay optional for profile-only saves");
    }
    await current.fill("WrongPassword123");await passwords.nth(0).fill("NewPassword123");await passwords.nth(1).fill("NewPassword123");
    for(const [nextCode,expected] of [["CURRENT_PASSWORD_INCORRECT","currentPasswordIncorrect"],["NEW_PASSWORD_TOO_SHORT","newPasswordTooShort"],["UNKNOWN","saveError"]] as const){
      code=nextCode;await submit();await page.waitForFunction(expected=>document.querySelector('[role="alert"]')?.textContent===expected,getMessages(locale).settingsDesign[expected]);
      assert.equal(await current.inputValue(),"WrongPassword123");
    }
    networkFailure=true;await submit();await page.waitForFunction(expected=>document.querySelector('[role="alert"]')?.textContent===expected,getMessages(locale).settingsDesign.saveError);
    networkFailure=false;success=true;await current.fill("CorrectPassword123");await submit();await page.getByRole("status").waitFor();assert.equal(await current.inputValue(),"");assert.equal(await passwords.nth(0).inputValue(),"");
    await page.close();
  }}finally{await browser.close();}
});
